import express from 'express';
import fs from 'node:fs';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import multer from 'multer';
import { PORT, IS_PROD, CORS_ORIGINS, FRONTEND_DIST, COMPANY, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } from './config.js';
import { db, id, now, settings, setSettings, instanceId } from './db.js';
import { redis } from './kv.js';
import { hashPassword } from './auth.js';
import authRoutes from './routes/auth.js';
import bookingRoutes from './routes/bookings.js';
import driverRoutes from './routes/drivers.js';
import supportRoutes from './routes/support.js';
import dashboardRoutes from './routes/dashboard.js';
import adminRoutes from './routes/admin.js';
import verificationRoutes from './routes/verification.js';
import complianceRoutes from './routes/compliance.js';
import commsRoutes from './routes/comms.js';
import trackingRoutes from './routes/tracking.js';
import accountRoutes from './routes/account.js';
import planRoutes from './routes/plans.js';
import { attestRouter, requireIntegrity } from './attest.js';
import moneyRoutes, { paystackWebhook } from './routes/money.js';
import { remoteRouter } from './money/paymentology/remote.js';

import { migrateIdNumbers, verifyAuditChain, audit } from './kyc.js';
import { limiter, botCheck, turnstileOn, maintenance, maintenanceOn, idempotent } from './edge.js';
import { requestLogger, reportError, securityEvent } from './monitor.js';
import { requireRole } from './auth.js';

export function createApp() {
  migrateIdNumbers();
  const app = express();
  // Railway adds one proxy hop; behind Cloudflare as well set TRUST_PROXY=2 so req.ip is the visitor.
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        // Google Maps JavaScript API needs its script, tile, font and worker hosts.
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://challenges.cloudflare.com', 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://*.ggpht.com', 'https://*.googleusercontent.com', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://*.googleusercontent.com', 'https://*.ggpht.com'],
        connectSrc: ["'self'", ...CORS_ORIGINS, 'https://challenges.cloudflare.com', 'https://*.googleapis.com', 'https://*.google.com', 'https://*.gstatic.com', 'data:', 'blob:'],
        workerSrc: ["'self'", 'blob:'],
        frameSrc: ["'self'", 'blob:', 'https://*.google.com', 'https://challenges.cloudflare.com'],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  // Trips use the camera and microphone for in-app calls; nothing else on the site does.
  app.use((_req, res, next) => { res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), payment=()'); next(); });
  app.use(requestLogger);
  app.use(compression());
  app.use(cors({
    origin(origin, cb) {
      if (!origin || CORS_ORIGINS.includes(origin) || (!IS_PROD && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) return cb(null, true);
      cb(null, false);
    },
  }));
  // Payment provider callbacks need raw bodies and must not be rate limited per IP.
  app.use('/api', remoteRouter(), paystackWebhook());
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', maintenance);
  // High-frequency live endpoints have their own limits so normal trips never hit the general one.
  const live = /^\/(drivers\/location|calls\/[^/]+\/signal|comms\/stream)/;
  const general = limiter('api', Number(process.env.RATE_LIMIT_API || 600), 15);
  app.use('/api', (req, res, next) => (live.test(req.path) ? next() : general(req, res, next)));
  app.use(['/api/drivers/location', '/api/calls'], limiter('live', 1500, 15));
  app.use(['/api/auth/login', '/api/auth/register'], limiter('auth', 25, 15, { byIp: true, message: 'Too many sign-in attempts from this network. Please wait 15 minutes.' }));
  app.use(['/api/auth/mfa'], limiter('mfa', 30, 15, { byIp: true }));
  app.use(['/api/auth/refresh'], limiter('refresh', 120, 15, { byIp: true }));
  app.use(['/api/auth/password'], limiter('password', 10, 15, { byIp: true }));
  app.use(['/api/enquiries', '/api/drivers/apply'], limiter('forms', 15, 15, { byIp: true }));
  app.post('/api/verification/documents', limiter('uploads', 60, 15));
  app.post('/api/bookings', limiter('bookings', Number(process.env.RATE_LIMIT_BOOKINGS || 20), 60, { message: 'You’ve made a lot of bookings in the last hour. Please wait a little, or contact support.' }));
  app.post(['/api/auth/login', '/api/auth/register', '/api/auth/password/forgot', '/api/drivers/apply', '/api/enquiries', '/api/bookings'], botCheck());
  app.post(['/api/bookings', '/api/payments/bookings/:id/checkout', '/api/wallet/withdrawals', '/api/plans', '/api/payments/plans/:id/checkout'], idempotent());

  // Mobile apps: genuine-app checks on sign-in, booking, payments and withdrawals (ATTESTATION_MODE).
  app.use(['/api/app/attest'], limiter('attest', 60, 15, { byIp: true }));
  app.post(['/api/auth/login', '/api/auth/register', '/api/bookings', '/api/payments/bookings/:id/checkout', '/api/wallet/withdrawals', '/api/wallet/bank-account'], requireIntegrity());
  app.put('/api/wallet/bank-account', requireIntegrity());
  app.use('/api', attestRouter);
  app.get('/api/security/config', (_req, res) => res.json({ turnstileSiteKey: turnstileOn() ? process.env.TURNSTILE_SITE_KEY || null : null, maintenance: maintenanceOn() }));
  // Admin: tamper check of the audit log, recent security events, maintenance switch.
  app.get('/api/admin/security', requireRole('admin'), (_req, res) => {
    res.json({ audit: verifyAuditChain(), events: db.all('securityEvents').slice(-200).reverse(), maintenance: settings().maintenance || { on: false } });
  });
  app.post('/api/admin/maintenance', requireRole('admin'), express.json(), (req, res) => {
    const on = Boolean(req.body?.on);
    setSettings({ maintenance: { on, message: String(req.body?.message || '').slice(0, 200), by: req.user.email, at: now() } });
    audit(req.user, on ? 'maintenance_on' : 'maintenance_off', 'platform', {});
    securityEvent(on ? 'maintenance_on' : 'maintenance_off', { by: req.user.id }, 'high');
    res.json({ maintenance: settings().maintenance });
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'drop-api', time: now() }));
  // Readiness for the load balancer: database and Redis reachable, not shutting down.
  app.get('/api/ready', async (_req, res) => {
    if (app.locals.draining) return res.status(503).json({ ready: false, reason: 'shutting down' });
    try {
      const store = await db.health();
      const r = redis();
      if (process.env.REDIS_URL && !r) throw new Error('redis unavailable');
      if (r) await r.ping();
      res.json({ ready: true, store, redis: Boolean(r), instance: instanceId });
    } catch (err) { res.status(503).json({ ready: false, reason: err.message }); }
  });
  app.get('/api/company', (_req, res) => res.json(COMPANY));
  app.use('/api/auth', authRoutes);
  app.use('/api', bookingRoutes, driverRoutes, supportRoutes, dashboardRoutes, verificationRoutes, complianceRoutes, commsRoutes, trackingRoutes, accountRoutes, moneyRoutes, planRoutes, adminRoutes);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // Universal links (iOS) and App Links (Android): reset-password and trip links open the apps.
  app.get('/.well-known/apple-app-site-association', (_req, res) => {
    const team = process.env.APPLE_TEAM_ID;
    const ids = team ? [`${team}.${process.env.IOS_BUNDLE_PASSENGER || 'za.co.drop.passenger'}`, `${team}.${process.env.IOS_BUNDLE_DRIVER || 'za.co.drop.driver'}`] : [];
    res.type('application/json').json({ applinks: { details: [{ appIDs: ids, components: [{ '/': '/reset-password*' }, { '/': '/trip/*' }] }] }, webcredentials: { apps: ids } });
  });
  app.get('/.well-known/assetlinks.json', (_req, res) => {
    const prints = (process.env.ANDROID_CERT_SHA256 || '').split(',').map((s) => s.trim()).filter(Boolean);
    res.json(['za.co.drop.passenger', 'za.co.drop.driver'].map((pkg) => ({ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: prints } })));
  });

  // Serve the built React app (single-service deploy) with SPA fallback.
  if (fs.existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST, {
      index: false,
      setHeaders(res, file) {
        res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
      },
    }));
    app.get('*', (_req, res) => res.sendFile('index.html', { root: FRONTEND_DIST }));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    // Remove any documents saved for a request that then failed.
    for (const f of Object.values(req.files || {}).flat()) fs.promises.unlink(f.path).catch(() => {});
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Each document must be 8 MB or smaller.' : 'There was a problem with the uploaded files.' });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request body.' });
    const status = err.status || 500;
    if (status >= 500) reportError(err, req);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message, ...(status < 500 && typeof err.code === 'string' && !err.code.startsWith('E') && { code: err.code }) });
  });

  return app;
}

export async function seedAdmin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    if (!db.find('users', (u) => u.role === 'admin')) console.warn('[drop] No admin account. Set ADMIN_EMAIL and ADMIN_PASSWORD to create one.');
    return;
  }
  const existing = db.find('users', (u) => u.email === ADMIN_EMAIL);
  if (existing) {
    if (existing.role !== 'admin') db.update('users', existing.id, { role: 'admin' });
    return;
  }
  db.insert('users', {
    id: id(), name: ADMIN_NAME, email: ADMIN_EMAIL, phone: '', role: 'admin',
    passwordHash: await hashPassword(ADMIN_PASSWORD), createdAt: now(),
  });
  console.log(`[drop] Created admin account ${ADMIN_EMAIL}`);
}

