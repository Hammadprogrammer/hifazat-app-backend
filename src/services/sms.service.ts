/**
 * SMS service — provider auto-selected from env.
 *
 *   SMS_PROVIDER=auto (default) | twilio | gateway | mock
 *
 *   twilio  : TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + (TWILIO_FROM | TWILIO_MESSAGING_SERVICE_SID)
 *   gateway : SMS_GATEWAY_URL + SMS_GATEWAY_API_KEY  (generic JSON POST { to, message })
 *   mock    : logs to console (used automatically when nothing is configured)
 */
import { normalizePhone } from '../lib/phone';
import { twilioSend, twilioSmsConfigured } from './twilio.client';

export interface SmsPayload {
  to: string;
  body: string;
}

export interface SmsResult {
  success: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}

interface SmsProvider {
  name: string;
  send(payload: SmsPayload): Promise<SmsResult>;
}

const mockProvider: SmsProvider = {
  name: 'mock',
  async send({ to, body }) {
    console.log(`[SMS:MOCK] → ${to}\n${body}`);
    return { success: true, provider: 'mock', messageId: `mock_${Date.now()}` };
  },
};

const twilioProvider: SmsProvider = {
  name: 'twilio',
  async send({ to, body }) {
    const r = await twilioSend({
      to,
      body,
      from: process.env.TWILIO_FROM,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
    });
    return { ...r, provider: 'twilio' };
  },
};

const gatewayProvider: SmsProvider = {
  name: 'gateway',
  async send({ to, body }) {
    const url = process.env.SMS_GATEWAY_URL;
    const apiKey = process.env.SMS_GATEWAY_API_KEY;
    if (!url || !apiKey) {
      return { success: false, provider: 'gateway', error: 'SMS_GATEWAY_URL / SMS_GATEWAY_API_KEY missing' };
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, message: body }),
      });
      if (!res.ok) {
        return { success: false, provider: 'gateway', error: `HTTP ${res.status}: ${await res.text()}` };
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      return { success: true, provider: 'gateway', messageId: data.id };
    } catch (err) {
      return { success: false, provider: 'gateway', error: err instanceof Error ? err.message : 'gateway error' };
    }
  },
};

export function resolveSmsProvider(): SmsProvider {
  const pref = (process.env.SMS_PROVIDER ?? 'auto').toLowerCase();
  if (pref === 'twilio') return twilioProvider;
  if (pref === 'gateway') return gatewayProvider;
  if (pref === 'mock') return mockProvider;
  if (twilioSmsConfigured()) return twilioProvider;
  if (process.env.SMS_GATEWAY_URL && process.env.SMS_GATEWAY_API_KEY) return gatewayProvider;
  return mockProvider;
}

export function smsIsLive(): boolean {
  return resolveSmsProvider().name !== 'mock';
}

export async function sendSms(payload: SmsPayload): Promise<SmsResult> {
  const to = normalizePhone(payload.to);
  const result = await resolveSmsProvider().send({ to, body: payload.body });
  if (!result.success) console.error(`[SMS:${result.provider}] → ${to} FAILED: ${result.error}`);
  return result;
}
