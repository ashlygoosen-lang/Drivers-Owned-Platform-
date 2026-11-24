/** DROP API client. Same-origin by default; set VITE_API_URL when the API runs on another host. */
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '') + '/api';
const KEY = 'drop.token';

export type Role = 'passenger' | 'driver' | 'business' | 'admin' | 'compliance' | 'support' | 'finance';
export const STAFF_ROLES: Role[] = ['admin', 'compliance', 'support', 'finance'];
export type Service = 'Ride' | 'Delivery' | 'Premium Drive';
export type BookingStatus = 'awaiting_payment' | 'requested' | 'accepted' | 'arriving' | 'in_progress' | 'completed' | 'cancelled';

export interface User {
  id: string; name: string; email: string; phone: string; role: Role; company?: string;
  driverStatus?: 'pending' | 'approved' | 'suspended'; online?: boolean; vehicle?: string; rating?: number | null;
  savedPlaces?: { home: string; work: string }; paymentPreference?: string; notifications?: string;
  employees?: Employee[]; disabled?: boolean; createdAt: string; verificationStatus?: VerificationStatus; demo?: boolean;
}
export interface Employee { id: string; name: string; email: string; department: string; addedAt: string }
export interface FareOption { category: string; description: string; seats: number; fare: number; passengerCommission: number; driverServiceFee: number; driverEarnings: number; etaMin: number }
export interface Quote { service: Service; distanceKm: number; durationMin: number; approximate: boolean; currency: 'ZAR'; options: FareOption[]; selected: FareOption; serviceFeeRate: number }
export interface Booking {
  id: string; ref: string; service: Service; category: string; pickup: string; destination: string; passengers: number;
  parcel: string; notes: string; passengerName: string; scheduledFor: string | null; payment: string; distanceKm: number; durationMin: number;
  approximate: boolean; fare: number; driverServiceFee: number; driverEarnings: number; status: BookingStatus; paymentStatus?: 'pending' | 'paid' | 'refunded' | 'refund_pending' | 'cash' | 'invoice';
  rating: number | null; feedback: string; createdAt: string; history: { status: BookingStatus; at: string }[];
  driver: { name: string; phone: string; vehicle: string; rating: number | null } | null;
  passenger?: { name: string; phone: string } | null;
}
export interface Application {
  id: string; ref: string; userId: string; participation: string; city: string; vehicle: string; status: 'submitted' | 'under_review' | 'approved' | 'rejected';
  checks: { identity: string; inspection: string; activation: string }; notes: string; createdAt: string;
  documents: Record<string, { file: string; originalName: string; size: number; type: string }>;
  applicant?: { name: string; email: string; phone: string } | null;
}
export interface Ticket { id: string; ref: string; type: string; priority: string; bookingRef: string; message: string; status: string; replies: { by: string; message: string; at: string }[]; createdAt: string; user?: { name: string; email: string } | null }
export interface Enquiry { id: string; ref: string; topic: string; name: string; email: string; phone: string; company: string; message: string; status: string; createdAt: string }
export interface Stat { label: string; value: number; money?: boolean }
export interface DashboardData { stats: Stat[]; chart: { title: string; money?: boolean; data: { day: string; value: number }[] }; driverStatus?: string; online?: boolean; rating?: number | null; invoices?: { ref: string; period: string; trips: number; total: number; status: string }[] }

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export type VerificationStatus = 'not_started' | 'in_progress' | 'submitted' | 'action_required' | 'verified';
export type DocStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export interface VerificationDoc { id: string; type: string; mime: string; ext: string; originalName: string; size: number; status: DocStatus; reason: string; expiresAt: string | null; issuedAt: string | null; uploadedAt: string; reviewedAt: string | null; reviewedBy: string | null; archived?: boolean }
export interface Requirement { type: string; required: boolean; label: string; hint: string; expires: boolean; maxAgeDays?: number; imageOnly?: boolean }
export interface VerificationProfile { legalName?: string; idType?: 'sa_id' | 'passport'; idNumber?: string; dateOfBirth?: string; nationality?: string; addressLine1?: string; addressLine2?: string; suburb?: string; city?: string; province?: string; postalCode?: string; emergencyName?: string; emergencyPhone?: string; companyName?: string; registrationNumber?: string; vatNumber?: string }
export interface Verification { id: string; userId: string; role: Role; status: VerificationStatus; profile: VerificationProfile; missingProfile: string[]; documents: VerificationDoc[]; requirements: Requirement[]; history: { status: string; at: string; by?: string; note?: string }[]; consentAt: string | null; submittedAt: string | null; decidedAt: string | null; decisionNote: string }
export interface QueueItem { userId: string; role: Role; status: VerificationStatus; submittedAt: string | null; decidedAt: string | null; name: string; email: string; phone: string; documents: { total: number; pending: number; rejected: number } }
export interface Notice { id: string; title: string; body: string; link: string; read: boolean; createdAt: string }
export interface AuditEntry { id: string; actorName: string; actorRole: string; action: string; subjectId: string; subjectName: string; detail: Record<string, string>; at: string }
export const VERIFICATION_LABEL: Record<VerificationStatus, string> = { not_started: 'Not started', in_progress: 'In progress', submitted: 'Under review', action_required: 'Action required', verified: 'Verified' };

export const token = {
  get(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } },
  set(value: string | null) { try { value ? localStorage.setItem(KEY, value) : localStorage.removeItem(KEY); } catch { /* storage unavailable */ } },
};

export async function api<T>(path: string, options: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = token.get();
  if (t) headers.authorization = `Bearer ${t}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: options.method || (options.body || options.form ? 'POST' : 'GET'),
      headers,
      body: options.form || (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'We could not reach DROP. Please check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Something went wrong. Please try again.', data.code);
  return data as T;
}

/** Fetch a protected file and return an object URL (caller revokes it). */
export async function protectedBlobUrl(path: string) {
  const res = await fetch(BASE + path, { headers: { authorization: `Bearer ${token.get()}` } });
  if (!res.ok) throw new ApiError(res.status, 'Could not open this document.');
  return URL.createObjectURL(await res.blob());
}

/** Fetch a protected file (e.g. an uploaded document) and open it in a new tab. */
export async function openProtectedFile(path: string) {
  const res = await fetch(BASE + path, { headers: { authorization: `Bearer ${token.get()}` } });
  if (!res.ok) throw new ApiError(res.status, 'Could not open this document.');
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const money = (n: number) => `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const date = (iso: string) => new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const STATUS_LABEL: Record<BookingStatus, string> = {
  awaiting_payment: 'Awaiting payment', requested: 'Finding your driver', accepted: 'Driver assigned', arriving: 'Driver arriving', in_progress: 'On the way', completed: 'Completed', cancelled: 'Cancelled',
};

export interface WalletTx { id: string; type: string; memo: string; amount: number; createdAt: string; meta?: { category?: string; merchant?: string; bookingRef?: string } }
export interface DropCard { id: string; programme: string; maskedNumber: string; validDate: string; status: 'active' | 'frozen' | 'stopped' | 'lost' | 'stolen' | 'retired'; type: string; issuedAt: string; sandbox: boolean; stopReason: number | null }
export interface Withdrawal { id: string; ref: string; amount: number; fee: number; status: 'requested' | 'paid' | 'rejected'; bank: string; masked: string; holder: string; bankReference?: string; reason?: string; createdAt: string; paidAt?: string; driver?: string; userId?: string }
export interface Wallet {
  balance: number; pendingWithdrawals: number; transactions: WalletTx[]; declined: { id: string; merchant: string; amount: number; reason: string; createdAt: string }[];
  card: DropCard | null; cardProgramme: { enabled: boolean; sandbox: boolean; name: string; limits: { perTransaction: number; daily: number; spentToday: number; atm: boolean } };
  bankAccount: { holder: string; bank: string; branchCode: string; accountType: string; masked: string } | null;
  withdrawals: Withdrawal[]; rules: { minWithdrawal: number; withdrawalFee: number; cashDebtLimit: number }; banks: string[];
}
export interface FinanceOverview { balanced: boolean; pool: number; escrow: number; driverWallets: number; driversInDebt: number; fees: number; cardSettlement: number; payoutsPending: number; businessReceivable: number; cardSpendToday: number; cardTransactionsToday: number; activeCards: number; withdrawalsRequested: number; providers: { paystack: string; paymentology: string; cardsEnabled: boolean }; accounts: { account: string; balance: number }[] }
