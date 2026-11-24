import express from 'express';
import fs from 'node:fs';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { PORT, IS_PROD, CORS_ORIGINS, FRONTEND_DIST, COMPANY, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } from './config.js';
import { db, id, now } from './db.js';
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
import moneyRoutes, { paystackWebhook } from './routes/money.js';
import { remoteRouter } from './money/paymentology/remote.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        // Google Maps JavaScript API needs its script, tile, font and worker hosts.
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://*.ggpht.com', 'https://*.googleusercontent.com', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://*.googleusercontent.com', 'https://*.ggpht.com'],
        connectSrc: ["'self'", ...CORS_ORIGINS, 'https://*.googleapis.com', 'https://*.google.com', 'https://*.gstatic.com', 'data:', 'blob:'],
        workerSrc: ["'self'", 'blob:'],
        frameSrc: ["'self'", 'blob:', 'https://*.google.com'],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  // Trips use the camera and microphone for in-app calls; nothing else on the site does.
  app.use((_req, res, next) => { res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), payment=()'); next(); });
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

  const limiter = (max, windowMin = 15) => rateLimit({ windowMs: windowMin * 60_000, max, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests. Please wait a few minutes and try again.' } });
  app.use('/api', limiter(600));
  app.use(['/api/auth/login', '/api/auth/register'], limiter(25));
  app.use(['/api/enquiries', '/api/drivers/apply'], limiter(15));
  app.post('/api/verification/documents', limiter(60));

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'drop-api', time: now() }));
  app.get('/api/company', (_req, res) => res.json(COMPANY));
  app.use('/api/auth', authRoutes);
  app.use('/api', bookingRoutes, driverRoutes, supportRoutes, dashboardRoutes, verificationRoutes, complianceRoutes, commsRoutes, trackingRoutes, moneyRoutes, adminRoutes);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

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
    if (status >= 500) console.error('[drop]', err);
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

