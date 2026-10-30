import { Response } from 'express';
import prisma from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { notifyContacts } from '../services/notification.service';

/** Real GPS fix only: finite, in range, and not the (0,0) "null island" default. */
function isValidCoords(lat?: unknown, lng?: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function buildAlertMessage(
  userName: string,
  latitude?: number | null,
  longitude?: number | null,
  customMessage?: string | null,
): string {
  const lines = [`${userName} sent an EMERGENCY ALERT and may need immediate help.`];

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

/** POST /api/alerts/trigger — sends an in-app alert (push + inbox) to all registered emergency contacts */
export async function triggerAlert(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const body = req.body as {
      latitude?: number;
      longitude?: number;
      accuracy?: number;
      message?: string;
      address?: string;
      source?: string;
    };
    const { message, address, source } = body;
    const coords = isValidCoords(body.latitude, body.longitude) ? body : null;
    const latitude = (coords?.latitude as number | undefined) ?? null;
    const longitude = (coords?.longitude as number | undefined) ?? null;

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
        message: 'No emergency contacts configured. Add at least one contact before sending an alert.',
      });
      return;
    }

    const alert = await prisma.alert.create({
      data: {
        userId: user.id,
        latitude,
        longitude,
        address: address?.trim() || null,
        message: message?.trim() || null,
        source: source?.trim() || 'sos',
        status: 'PENDING',
      },
    });

    if (latitude != null && longitude != null) {
      await prisma.alertLocation.create({
        data: { alertId: alert.id, latitude, longitude, accuracy: coords?.accuracy ?? null },
      });
    }

    const { dispatches, skipped } = await notifyContacts(user.id, {
      type: 'SOS',
      title: '🚨 HIFAZAT EMERGENCY ALERT',
      body: buildAlertMessage(user.name, latitude, longitude, message),
      alertId: alert.id,
      latitude,
      longitude,
    });

    const status =
      dispatches.length === 0 ? 'FAILED' : skipped.length === 0 ? 'SENT' : 'PARTIAL';

    const updated = await prisma.alert.update({
      where: { id: alert.id },
      data: { status },
    });

    res.status(status === 'FAILED' ? 422 : 200).json({
      success: status !== 'FAILED',
      message:
        status === 'FAILED'
          ? 'None of your emergency contacts are registered on HIFAZAT, so no one could be alerted.'
          : undefined,
      data: { alert: updated, dispatches, skipped },
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

/**
 * GET /api/alerts/:id/track — live tracking view for the alert owner OR any
 * emergency contact who received a notification for this alert.
 * Returns the sender, alert status, latest real GPS fix and recent trail.
 */
export async function trackAlert(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const alert = await prisma.alert.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, phone: true } },
        locations: { orderBy: { recordedAt: 'desc' }, take: 50 },
      },
    });
    if (!alert) {
      res.status(404).json({ success: false, message: 'Alert not found' });
      return;
    }

    const isOwner = alert.userId === req.userId;
    const isRecipient = isOwner
      ? true
      : Boolean(
          await prisma.notification.findFirst({
            where: { alertId: id, recipientId: req.userId },
            select: { id: true },
          }),
        );
    if (!isRecipient) {
      res.status(403).json({ success: false, message: 'You are not allowed to track this alert' });
      return;
    }

    const latest = alert.locations[0] ?? null;
    res.json({
      success: true,
      data: {
        alert: {
          id: alert.id,
          status: alert.status,
          source: alert.source,
          message: alert.message,
          address: alert.address,
          createdAt: alert.createdAt,
          cancelledAt: alert.cancelledAt,
          resolvedAt: alert.resolvedAt,
        },
        sender: alert.user,
        isOwner,
        active: (ACTIVE_STATUSES as readonly string[]).includes(alert.status),
        latest,
        trail: [...alert.locations].reverse(),
      },
    });
  } catch (err) {
    console.error('[alert.trackAlert]', err);
    res.status(500).json({ success: false, message: 'Failed to track alert' });
  }
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
    const { dispatches, skipped } = await notifyContacts(req.userId!, {
      type: 'SOS_CANCELLED',
      title: 'ℹ️ HIFAZAT UPDATE',
      body: `${existing.user.name} cancelled the emergency alert — it was a false alarm. No action needed.`,
      alertId: id,
    });
    res.json({ success: true, data: { alert, notified: dispatches.length, skipped } });
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
    const { dispatches, skipped } = await notifyContacts(req.userId!, {
      type: 'SOS_SAFE',
      title: '✅ HIFAZAT UPDATE',
      body: `${existing.user.name} has confirmed they are SAFE. The emergency is resolved.`,
      alertId: id,
    });
    res.json({ success: true, data: { alert, notified: dispatches.length, skipped } });
  } catch (err) {
    console.error('[alert.markSafe]', err);
    res.status(500).json({ success: false, message: 'Failed to mark alert safe' });
  }
}

/** POST /api/alerts/:id/location — live location update while alert is active */
export async function updateAlertLocation(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const body = req.body as {
      latitude?: number;
      longitude?: number;
      accuracy?: number;
      heading?: number;
      speed?: number;
    };
    if (!isValidCoords(body.latitude, body.longitude)) {
      res.status(400).json({ success: false, message: 'A valid latitude and longitude are required' });
      return;
    }
    const latitude = body.latitude as number;
    const longitude = body.longitude as number;
    const { accuracy, heading, speed } = body;
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
