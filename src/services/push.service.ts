/**
 * Expo Push Notifications.
 * Docs: https://docs.expo.dev/push-notifications/sending-notifications/
 *
 * No SDK needed — plain HTTPS POST. Optional EXPO_ACCESS_TOKEN enables
 * "Enhanced Security" on the Expo project.
 */
import prisma from '../config/db';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Emergency (SOS / not-safe / overdue): siren channel + time-sensitive. Status updates are not critical. */
  critical?: boolean;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[.+\]$/.test(token);
}

export interface PushResult {
  sent: number;
  failed: number;
  invalidTokens: string[];
}

export async function sendExpoPush(tokens: string[], payload: PushPayload): Promise<PushResult> {
  const result: PushResult = { sent: 0, failed: 0, invalidTokens: [] };
  const valid = tokens.filter(isExpoPushToken);
  if (valid.length === 0) return result;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (process.env.EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  }

  for (let i = 0; i < valid.length; i += CHUNK_SIZE) {
    const chunk = valid.slice(i, i + CHUNK_SIZE);
    const messages = chunk.map((to) => ({
      to,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      // Android: sound/vibration come from the app's "emergency" channel (siren, MAX importance).
      // iOS: custom sound bundled in the app + time-sensitive interruption level.
      sound: payload.critical ? 'siren.wav' : 'default',
      priority: 'high',
      channelId: payload.critical ? 'emergency' : 'default',
      interruptionLevel: payload.critical ? 'timeSensitive' : 'active',
      ttl: 3600,
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(messages) });
      const json = (await res.json()) as { data?: ExpoTicket[]; errors?: unknown };
      const tickets = json.data ?? [];

      tickets.forEach((ticket, idx) => {
        if (ticket.status === 'ok') {
          result.sent += 1;
        } else {
          result.failed += 1;
          if (ticket.details?.error === 'DeviceNotRegistered') result.invalidTokens.push(chunk[idx]);
        }
      });
      if (tickets.length === 0) result.failed += chunk.length;
    } catch (err) {
      console.error('[push] Expo request failed:', err);
      result.failed += chunk.length;
    }
  }

  if (result.invalidTokens.length > 0) {
    await prisma.device
      .deleteMany({ where: { pushToken: { in: result.invalidTokens } } })
      .catch((err) => console.error('[push] failed to prune dead tokens:', err));
  }

  return result;
}
