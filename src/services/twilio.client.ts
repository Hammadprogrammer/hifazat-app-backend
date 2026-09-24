/**
 * Minimal Twilio REST client (no SDK). Used for SMS and WhatsApp (Twilio sandbox / approved sender).
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (or TWILIO_MESSAGING_SERVICE_SID), TWILIO_WHATSAPP_FROM
 */

export interface TwilioSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export function twilioConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

export function twilioSmsConfigured(): boolean {
  return twilioConfigured() && Boolean(process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID);
}

export function twilioWhatsAppConfigured(): boolean {
  return twilioConfigured() && Boolean(process.env.TWILIO_WHATSAPP_FROM);
}

export async function twilioSend(params: {
  to: string;
  body: string;
  from?: string;
  messagingServiceSid?: string;
}): Promise<TwilioSendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;

  const form = new URLSearchParams({ To: params.to, Body: params.body });
  if (params.messagingServiceSid) form.set('MessagingServiceSid', params.messagingServiceSid);
  else if (params.from) form.set('From', params.from);

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!res.ok) {
      return { success: false, error: `Twilio ${data.code ?? res.status}: ${data.message ?? 'request failed'}` };
    }
    return { success: true, messageId: data.sid };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Twilio network error' };
  }
}
