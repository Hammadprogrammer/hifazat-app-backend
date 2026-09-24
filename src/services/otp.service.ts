/**
 * Login OTP service.
 *
 *   OTP_MODE=auto (default) | live | static
 *     live   : random 6-digit code, delivered via OTP_CHANNEL
 *     static : STATIC_OTP (default 123456), nothing is sent — dev only
 *     auto   : live if any SMS/WhatsApp provider is configured, else static
 *   OTP_CHANNEL=both (default) | sms | whatsapp
 *
 * Storage: Upstash Redis when configured (survives restarts / multiple instances), else in-memory.
 */
import { redis } from '../config/redis';
import { normalizePhone } from '../lib/phone';
import { sendSms, smsIsLive } from './sms.service';
import { sendWhatsAppMessage, whatsappIsLive } from './whatsapp.service';

const STATIC_OTP = process.env.STATIC_OTP ?? '123456';
const OTP_TTL_SEC = Number(process.env.OTP_TTL_SECONDS ?? 300);
const MAX_ATTEMPTS = 5;

interface PendingOtp {
  code: string;
  attempts: number;
  expiresAt: number;
}

const memory = new Map<string, PendingOtp>();

function redisEnabled(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

const key = (phone: string) => `otp:${phone}`;

async function store(phone: string, entry: PendingOtp): Promise<void> {
  if (redisEnabled()) {
    await redis.set(key(phone), JSON.stringify(entry), { ex: OTP_TTL_SEC });
  } else {
    memory.set(phone, entry);
  }
}

async function load(phone: string): Promise<PendingOtp | null> {
  if (redisEnabled()) {
    const raw = await redis.get<string | PendingOtp>(key(phone));
    if (!raw) return null;
    return typeof raw === 'string' ? (JSON.parse(raw) as PendingOtp) : raw;
  }
  return memory.get(phone) ?? null;
}

async function clear(phone: string): Promise<void> {
  if (redisEnabled()) await redis.del(key(phone));
  else memory.delete(phone);
}

export function otpIsLive(): boolean {
  const mode = (process.env.OTP_MODE ?? 'auto').toLowerCase();
  if (mode === 'live') return true;
  if (mode === 'static') return false;
  return smsIsLive() || whatsappIsLive();
}

export interface IssueOtpResult {
  delivered: boolean;
  channels: { sms?: boolean; whatsapp?: boolean };
  /** Only populated in static/dev mode so the tester can log in */
  devCode?: string;
  error?: string;
}

export async function issueOtp(rawPhone: string): Promise<IssueOtpResult> {
  const phone = normalizePhone(rawPhone);
  const live = otpIsLive();
  const code = live ? String(Math.floor(100000 + Math.random() * 900000)) : STATIC_OTP;

  await store(phone, { code, attempts: 0, expiresAt: Date.now() + OTP_TTL_SEC * 1000 });

  if (!live) {
    console.log(`[OTP:STATIC] → ${phone} | code: ${code}`);
    return { delivered: false, channels: {}, devCode: code };
  }

  const body = `Your HIFAZAT login code is ${code}. It expires in ${Math.round(OTP_TTL_SEC / 60)} minutes. Do not share it.`;
  const channel = (process.env.OTP_CHANNEL ?? 'both').toLowerCase();
  const channels: IssueOtpResult['channels'] = {};

  const tasks: Promise<void>[] = [];
  if ((channel === 'both' || channel === 'sms') && smsIsLive()) {
    tasks.push(sendSms({ to: phone, body }).then((r) => void (channels.sms = r.success)));
  }
  if ((channel === 'both' || channel === 'whatsapp') && whatsappIsLive()) {
    tasks.push(sendWhatsAppMessage(phone, body).then((r) => void (channels.whatsapp = r.success)));
  }
  await Promise.all(tasks);

  const delivered = Boolean(channels.sms || channels.whatsapp);
  if (!delivered) await clear(phone);
  return {
    delivered,
    channels,
    error: delivered ? undefined : 'Could not deliver OTP via any channel',
  };
}

export async function verifyOtp(rawPhone: string, code: string): Promise<{ ok: boolean; reason?: string }> {
  const phone = normalizePhone(rawPhone);
  const entry = await load(phone);

  if (!entry) return { ok: false, reason: 'No OTP requested for this phone. Please log in again.' };

  if (Date.now() > entry.expiresAt) {
    await clear(phone);
    return { ok: false, reason: 'OTP has expired. Please log in again.' };
  }

  if (entry.code !== code.trim()) {
    entry.attempts += 1;
    if (entry.attempts >= MAX_ATTEMPTS) {
      await clear(phone);
      return { ok: false, reason: 'Too many incorrect attempts. Please log in again.' };
    }
    await store(phone, entry);
    return { ok: false, reason: `Incorrect OTP code. ${MAX_ATTEMPTS - entry.attempts} attempt(s) left.` };
  }

  await clear(phone);
  return { ok: true };
}
