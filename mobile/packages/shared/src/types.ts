/** Types and formatting shared by the DROP apps. Generated from frontend/src/lib/api.ts (the website's API types); keep them in step. */
export type Role = 'passenger' | 'driver' | 'business' | 'admin' | 'compliance' | 'support' | 'finance';
export const STAFF_ROLES: Role[] = ['admin', 'compliance', 'support', 'finance'];
export type Service = 'Ride' | 'Delivery' | 'Premium Drive';
export type BookingStatus = 'awaiting_payment' | 'requested' | 'accepted' | 'arriving' | 'in_progress' | 'completed' | 'cancelled';
export interface User {
  id: string; name: string; email: string; phone: string; role: Role; company?: string;
  driverStatus?: 'pending' | 'approved' | 'suspended'; online?: boolean; vehicle?: string; vehicleProfile?: { type: string; make: string; model: string } | null; rating?: number | null;
  savedPlaces?: { home: string; work: string }; paymentPreference?: string; notifications?: string;
  employees?: Employee[]; disabled?: boolean; createdAt: string; verificationStatus?: VerificationStatus; demo?: boolean; mfaEnabled?: boolean;
}
export interface Employee { id: string; name: string; email: string; department: string; addedAt: string }
export interface FareOption { category: string; description: string; seats: number; fare: number; passengerCommission: number; driverServiceFee: number; driverEarnings: number; etaMin: number }
export interface Quote { service: Service; distanceKm: number; durationMin: number; approximate: boolean; currency: 'ZAR'; options: FareOption[]; selected: FareOption; serviceFeeRate: number }
export interface Booking {
  id: string; ref: string; service: Service; category: string; pickup: string; destination: string; passengers: number;
  parcel: string; notes: string; passengerName: string; scheduledFor: string | null; payment: string; distanceKm: number; durationMin: number;
  approximate: boolean; fare: number; driverServiceFee: number; driverEarnings: number; status: BookingStatus; paymentStatus?: 'pending' | 'paid' | 'refunded' | 'refund_pending' | 'cash' | 'invoice';
  rating: number | null; feedback: string; createdAt: string; history: { status: BookingStatus; at: string }[];
  driver: { name: string; phone: string; vehicle: string; vehicleType?: string; rating: number | null } | null;
  passenger?: { name: string; phone: string } | null; comms?: boolean;
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
  bankAccount: { holder: string; bank: string; branchCode: string; accountType: string; masked: string; holdUntil?: string | null } | null;
  withdrawals: Withdrawal[]; rules: { minWithdrawal: number; withdrawalFee: number; cashDebtLimit: number }; banks: string[];
}
export interface FinanceOverview { balanced: boolean; pool: number; escrow: number; driverWallets: number; driversInDebt: number; fees: number; cardSettlement: number; payoutsPending: number; businessReceivable: number; cardSpendToday: number; cardTransactionsToday: number; activeCards: number; withdrawalsRequested: number; providers: { paystack: string; paymentology: string; cardsEnabled: boolean }; accounts: { account: string; balance: number }[] }
export interface ChatMessage { id: string; bookingId: string; from: 'me' | 'driver' | 'passenger' | 'system'; senderName: string; kind: 'text' | 'system'; text: string; createdAt: string; readAt: string | null }
export interface TripCall { id: string; kind: 'audio' | 'video' | 'phone'; status: string; by: 'me' | 'them'; durationSec: number; createdAt: string }
export interface Thread { messages: ChatMessage[]; calls: TripCall[]; open: boolean; side: 'passenger' | 'driver' | null; phone: 'masked' | 'direct' | 'off'; with: { name: string; role: 'driver' | 'passenger'; online: boolean } | null }

export interface Tracking {
  bookingId: string; ref: string; status: string; stage: string;
  pickup: { lat: number; lng: number; label: string } | null; destination: { lat: number; lng: number; label: string } | null;
  driver: { lat: number; lng: number; heading: number; speed: number | null; accuracy: number | null; at: string; stale?: boolean; name?: string; vehicle?: string; vehicleType?: string } | null;
  passenger: { lat: number; lng: number; accuracy: number | null; at: string } | null;
  eta: { durationSec: number; distanceM: number; estimated: boolean } | null; route: { polyline: string; version: number } | null; trail: [number, number][];
}
