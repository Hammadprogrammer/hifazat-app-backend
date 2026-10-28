/**
 * App-to-app notifications.
 *
 * Emergency contacts only receive alerts if their phone number belongs to a
 * registered HIFAZAT user. Each alert is stored as a Notification row (inbox)
 * and pushed to every device the recipient has registered.
 */
import { NotificationType } from '@prisma/client';
import prisma from '../config/db';
import { sendExpoPush } from './push.service';

export interface ContactInfo {
  id: string;
  name: string;
  phone: string;
}

export interface RegisteredContact extends ContactInfo {
  user: { id: string; name: string };
}

export interface ContactSplit {
  registered: RegisteredContact[];
  unregistered: ContactInfo[];
}

/** Split a user's emergency contacts into app users vs. unregistered numbers. */
export async function findRegisteredContacts(userId: string): Promise<ContactSplit> {
  const contacts = await prisma.contact.findMany({
    where: { userId },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, phone: true },
  });
  if (contacts.length === 0) return { registered: [], unregistered: [] };

  const users = await prisma.user.findMany({
    where: { phone: { in: contacts.map((c) => c.phone) } },
    select: { id: true, name: true, phone: true },
  });
  const byPhone = new Map(users.map((u) => [u.phone, u]));

  const registered: RegisteredContact[] = [];
  const unregistered: ContactInfo[] = [];
  for (const c of contacts) {
    const u = byPhone.get(c.phone);
    if (u) registered.push({ ...c, user: { id: u.id, name: u.name } });
    else unregistered.push(c);
  }
  return { registered, unregistered };
}

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  alertId?: string | null;
  tripId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface Dispatch {
  contact: ContactInfo;
  recipient: { id: string; name: string };
  notificationId: string;
  pushSent: number;
  devices: number;
}

export interface NotifyResult {
  dispatches: Dispatch[];
  skipped: Array<ContactInfo & { reason: string }>;
}

const SKIP_REASON = 'Not registered on HIFAZAT app';

export async function notifyContacts(senderId: string, input: NotifyInput): Promise<NotifyResult> {
  const { registered, unregistered } = await findRegisteredContacts(senderId);
  const skipped = unregistered.map((c) => ({ ...c, reason: SKIP_REASON }));
  if (registered.length === 0) return { dispatches: [], skipped };

  const recipientIds = registered.map((r) => r.user.id);

  const [notifications, devices] = await Promise.all([
    prisma.$transaction(
      registered.map((r) =>
        prisma.notification.create({
          data: {
            recipientId: r.user.id,
            senderId,
            alertId: input.alertId ?? null,
            tripId: input.tripId ?? null,
            type: input.type,
            title: input.title,
            body: input.body,
            latitude: input.latitude ?? null,
            longitude: input.longitude ?? null,
          },
          select: { id: true, recipientId: true },
        }),
      ),
    ),
    prisma.device.findMany({
      where: { userId: { in: recipientIds } },
      select: { userId: true, pushToken: true },
    }),
  ]);

  const notifByRecipient = new Map(notifications.map((n) => [n.recipientId, n.id]));
  const tokensByUser = new Map<string, string[]>();
  for (const d of devices) {
    const list = tokensByUser.get(d.userId) ?? [];
    list.push(d.pushToken);
    tokensByUser.set(d.userId, list);
  }

  const dispatches = await Promise.all(
    registered.map(async (r): Promise<Dispatch> => {
      const tokens = tokensByUser.get(r.user.id) ?? [];
      const notificationId = notifByRecipient.get(r.user.id)!;
      const push =
        tokens.length > 0
          ? await sendExpoPush(tokens, {
              title: input.title,
              body: input.body,
              data: {
                type: input.type,
                notificationId,
                alertId: input.alertId ?? null,
                tripId: input.tripId ?? null,
                senderId,
                latitude: input.latitude ?? null,
                longitude: input.longitude ?? null,
              },
            })
          : { sent: 0, failed: 0, invalidTokens: [] };
      return {
        contact: { id: r.id, name: r.name, phone: r.phone },
        recipient: r.user,
        notificationId,
        pushSent: push.sent,
        devices: tokens.length,
      };
    }),
  );

  return { dispatches, skipped };
}
