import * as WebBrowser from 'expo-web-browser';
import { api } from '@drop/shared';

/** Paystack's secure checkout in an in-app browser; the payment is then confirmed server-to-server. */
export async function payPlan(id: string) {
  const co = await api<{ authorizationUrl: string; reference: string }>(`/payments/plans/${id}/checkout`, { body: {} });
  await WebBrowser.openBrowserAsync(co.authorizationUrl, { dismissButtonStyle: 'close', presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
  await api(`/payments/verify/${encodeURIComponent(co.reference)}`).catch(() => undefined);
}
