/**
 * WhatsApp service — provider auto-selected from env.
 *
 *   WHATSAPP_PROVIDER=auto (default) | meta | twilio | mock
 *
 *   meta   : WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN  (Meta Cloud API)
 *            optional WHATSAPP_TEMPLATE_NAME + WHATSAPP_TEMPLATE_LANG — when set, sends an approved
 *            template with the message as the single {{1}} body parameter (required for
 *            business-initiated messages outside the 24h window).
 *   twilio : TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM (e.g. whatsapp:+14155238886)
 *   mock   : logs to console
 */
import { normalizePhone, toWhatsAppNumber } from '../lib/phone';
import { twilioSend, twilioWhatsAppConfigured } from './twilio.client';

export interface WhatsAppResult {
  success: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}

function metaConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}

export function resolveWhatsAppProvider(): 'meta' | 'twilio' | 'mock' {
  const pref = (process.env.WHATSAPP_PROVIDER ?? 'auto').toLowerCase();
  if (pref === 'meta' || pref === 'twilio' || pref === 'mock') return pref;
  if (metaConfigured()) return 'meta';
  if (twilioWhatsAppConfigured()) return 'twilio';
  return 'mock';
}

export function whatsappIsLive(): boolean {
  return resolveWhatsAppProvider() !== 'mock';
}

async function sendViaMeta(to: string, body: string): Promise<WhatsAppResult> {
  const version = process.env.WHATSAPP_API_VERSION ?? 'v21.0';
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    return { success: false, provider: 'meta', error: 'WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN missing' };
  }

  const template = process.env.WHATSAPP_TEMPLATE_NAME;
  const payload = template
    ? {
        messaging_product: 'whatsapp',
        to: toWhatsAppNumber(to),
        type: 'template',
        template: {
          name: template,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: body }] }],
        },
      }
    : {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toWhatsAppNumber(to),
        type: 'text',
        text: { preview_url: true, body },
      };

  try {
    const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };
    if (!res.ok) {
      return {
        success: false,
        provider: 'meta',
        error: `Meta ${data.error?.code ?? res.status}: ${data.error?.message ?? 'request failed'}`,
      };
    }
    return { success: true, provider: 'meta', messageId: data.messages?.[0]?.id };
  } catch (err) {
    return { success: false, provider: 'meta', error: err instanceof Error ? err.message : 'Meta network error' };
  }
}

async function sendViaTwilio(to: string, body: string): Promise<WhatsAppResult> {
  const from = process.env.TWILIO_WHATSAPP_FROM!;
  const r = await twilioSend({
    to: `whatsapp:${to}`,
    body,
    from: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
  });
  return { ...r, provider: 'twilio' };
}

export async function sendWhatsAppMessage(rawTo: string, body: string): Promise<WhatsAppResult> {
  const to = normalizePhone(rawTo);
  const provider = resolveWhatsAppProvider();

  let result: WhatsAppResult;
  if (provider === 'meta') result = await sendViaMeta(to, body);
  else if (provider === 'twilio') result = await sendViaTwilio(to, body);
  else {
    console.log(`[WHATSAPP:MOCK] → ${to}\n${body}`);
    result = { success: true, provider: 'mock', messageId: `wa_mock_${Date.now()}` };
  }

  if (!result.success) console.error(`[WHATSAPP:${result.provider}] → ${to} FAILED: ${result.error}`);
  return result;
}
