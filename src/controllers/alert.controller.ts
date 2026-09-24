import { Response } from 'express';
import prisma from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSms } from '../services/sms.service';
import { sendWhatsAppMessage } from '../services/whatsapp.service';

function buildAlertMessage(
  userName: string,
  latitude?: number | null,
  longitude?: number | null,
  customMessage?: string | null,
): string {
  const lines = [
    '🚨 HIFATZAT EMERGENCY ALERT 🚨',
    `${userName} has triggered an SOS and may need immediate help.`,
  ];

  if (customMessage) {
    lines.push(`Message: ${customMessage}`);
  }

  if (latitude != null && longitude != null) {
    lines.push(`Location: https://maps.google.com/?q=${latitude},${longitude}`);
  } else {
    lines.push('Location: not available');
  }

  lines.push(`Time: ${new Date().toISOString()}`);
  return lines.join('\n');
}

/** POST /api/alerts/trigger — sends SMS + WhatsApp to all emergency contacts */
export async function triggerAlert(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { latitude, longitude, message, address, source } = req.body as {
      latitude?: number;
      longitude?: number;
      message?: string;
      address?: string;
      source?: string;
    };

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: { contacts: true },
    });

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    if (user.contacts.length === 0) {
      res.status(400).json({
        success: false,
        message: 'No emergency contacts configured. Add at least one contact before triggering SOS.',
      });
      return;
    }

    const alert = await prisma.alert.create({
      data: {
        userId: user.id,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        address: address?.trim() || null,
        message: message?.trim() || null,
        source: source?.trim() || 'sos',
        status: 'PENDING',
      },
    });

    if (latitude != null && longitude != null) {
      await prisma.alertLocation.create({
        data: { alertId: alert.id, latitude, longitude },
      });
    }

    const body = buildAlertMessage(user.name, latitude, longitude, message);

    // Dispatch SMS + WhatsApp to every contact in parallel
    const dispatches = await Promise.all(
      user.contacts.map(async (contact) => {
        const [sms, whatsapp] = await Promise.all([
          sendSms({ to: contact.phone, body }),
          sendWhatsAppMessage(contact.phone, body),
        ]);
        return {
          contact: { id: contact.id, name: contact.name, phone: contact.phone },
          sms: { success: sms.success, error: sms.error },
          whatsapp: { success: whatsapp.success, error: whatsapp.error },
        };
      }),
    );

    const total = dispatches.length * 2;
    const delivered = dispatches.reduce(
      (acc, d) => acc + (d.sms.success ? 1 : 0) + (d.whatsapp.success ? 1 : 0),
      0,
    );

    const status = delivered === total ? 'SENT' : delivered > 0 ? 'PARTIAL' : 'FAILED';

    const updated = await prisma.alert.update({
      where: { id: alert.id },
      data: { status },
    });

    res.status(status === 'FAILED' ? 502 : 200).json({
      success: status !== 'FAILED',
      data: { alert: updated, dispatches },
    });
  } catch (err) {
    console.error('[alert.triggerAlert]', err);
    res.status(500).json({ success: false, message: 'Failed to trigger SOS alert' });
  }
}

/** GET /api/alerts/history */
export async function getAlertHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const alerts = await prisma.alert.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        latitude: true,
        longitude: true,
        address: true,
        message: true,
        source: true,
        status: true,
        cancelledAt: true,
        resolvedAt: true,
        createdAt: true,
      },
    });

    res.json({ success: true, data: { alerts } });
  } catch (err) {
    console.error('[alert.getAlertHistory]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch alert history' });
  }
}

const ACTIVE_STATUSES = ['PENDING', 'SENT', 'PARTIAL'] as const;

/** GET /api/alerts/active — most recent alert that is not cancelled/resolved */
export async function getActiveAlert(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const alert = await prisma.alert.findFirst({
      where: { userId: req.userId, status: { in: [...ACTIVE_STATUSES] } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: { alert } });
  } catch (err) {
    console.error('[alert.getActiveAlert]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch active alert' });
  }
}

/** GET /api/alerts/:id */
export async function getAlertById(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const alert = await prisma.alert.findFirst({
      where: { id, userId: req.userId },
      include: { locations: { orderBy: { recordedAt: 'asc' }, take: 200 } },
    });
    if (!alert) {
      res.status(404).json({ success: false, message: 'Alert not found' });
      return;
    }
    res.json({ success: true, data: { alert } });
  } catch (err) {
    console.error('[alert.getAlertById]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch alert' });
  }
}

async function notifyContacts(userId: string, body: string): Promise<number> {
  const contacts = await prisma.contact.findMany({ where: { userId } });
  await Promise.all(
    contacts.map((c) =>
      Promise.all([sendSms({ to: c.phone, body }), sendWhatsAppMessage(c.phone, body)]),
    ),
  );
  return contacts.length;
}

/** POST /api/alerts/:id/cancel — false alarm */
export async function cancelAlert(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const existing = await prisma.alert.findFirst({
      where: { id, userId: req.userId },
      include: { user: { select: { name: true } } },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Alert not found' });
      return;
    }
    if (!(ACTIVE_STATUSES as readonly string[]).includes(existing.status)) {
      res.status(409).json({ success: false, message: 'Alert is not active' });
      return;
    }
    const alert = await prisma.alert.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    const notified = await notifyContacts(
      req.userId!,
      `ℹ️ HIFATZAT UPDATE\n${existing.user.name} cancelled the SOS alert — it was a false alarm. No action needed.`,
    );
    res.json({ success: true, data: { alert, notified } });
  } catch (err) {
    console.error('[alert.cancelAlert]', err);
    res.status(500).json({ success: false, message: 'Failed to cancel alert' });
  }
}

/** POST /api/alerts/:id/safe — user confirms they are safe */
export async function markSafe(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const existing = await prisma.alert.findFirst({
      where: { id, userId: req.userId },
      include: { user: { select: { name: true } } },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Alert not found' });
      return;
    }
    if (!(ACTIVE_STATUSES as readonly string[]).includes(existing.status)) {
      res.status(409).json({ success: false, message: 'Alert is not active' });
      return;
    }
    const alert = await prisma.alert.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    const notified = await notifyContacts(
      req.userId!,
      `✅ HIFATZAT UPDATE\n${existing.user.name} has confirmed they are SAFE. The emergency is resolved.`,
    );
    res.json({ success: true, data: { alert, notified } });
  } catch (err) {
    console.error('[alert.markSafe]', err);
    res.status(500).json({ success: false, message: 'Failed to mark alert safe' });
  }
}

/** POST /api/alerts/:id/location — live location update while alert is active */
export async function updateAlertLocation(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const { latitude, longitude, accuracy, heading, speed } = req.body as {
      latitude?: number;
      longitude?: number;
      accuracy?: number;
      heading?: number;
      speed?: number;
    };
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      res.status(400).json({ success: false, message: 'latitude and longitude are required' });
      return;
    }
    const existing = await prisma.alert.findFirst({ where: { id, userId: req.userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Alert not found' });
      return;
    }
    if (!(ACTIVE_STATUSES as readonly string[]).includes(existing.status)) {
      res.status(409).json({ success: false, message: 'Alert is not active' });
      return;
    }
    const [location] = await Promise.all([
      prisma.alertLocation.create({
        data: {
          alertId: id,
          latitude,
          longitude,
          accuracy: accuracy ?? null,
          heading: heading ?? null,
          speed: speed ?? null,
        },
      }),
      prisma.alert.update({ where: { id }, data: { latitude, longitude } }),
    ]);
    res.json({ success: true, data: { location } });
  } catch (err) {
    console.error('[alert.updateAlertLocation]', err);
    res.status(500).json({ success: false, message: 'Failed to update location' });
  }
}

/** GET /api/alerts/:id/locations */
export async function getAlertLocations(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const existing = await prisma.alert.findFirst({ where: { id, userId: req.userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Alert not found' });
      return;
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const locations = await prisma.alertLocation.findMany({
      where: { alertId: id },
      orderBy: { recordedAt: 'desc' },
      take: limit,
    });
    res.json({ success: true, data: { locations: locations.reverse() } });
  } catch (err) {
    console.error('[alert.getAlertLocations]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch alert locations' });
  }
}
