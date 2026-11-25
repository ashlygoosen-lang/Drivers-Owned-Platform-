import * as WebBrowser from 'expo-web-browser';
import { api } from '@drop/shared';

/** Paystack's secure checkout for a group travel booking (deposit, full amount or balance), then confirmed server-to-server. */
export async function payGroupBooking(id: string) {
  const co = await api<{ authorizationUrl: string; reference: string }>(`/payments/travel/${id}/checkout`, { body: {} });
  await WebBrowser.openBrowserAsync(co.authorizationUrl, { dismissButtonStyle: 'close', presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
  await api(`/payments/verify/${encodeURIComponent(co.reference)}`).catch(() => undefined);
}
