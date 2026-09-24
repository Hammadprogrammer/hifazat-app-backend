import { Response } from 'express';
import prisma from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSms } from '../services/sms.service';
import { sendWhatsAppMessage } from '../services/whatsapp.service';

/** GET /api/trips */
export async function getTrips(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const trips = await prisma.trip.findMany({
      where: { userId: req.userId },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    res.json({ success: true, data: { trips } });
  } catch (err) {
    console.error('[trip.getTrips]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch trips' });
  }
}

/** GET /api/trips/active */
export async function getActiveTrip(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const trip = await prisma.trip.findFirst({
      where: { userId: req.userId, status: 'active' },
      orderBy: { startedAt: 'desc' },
    });
    if (trip) {
      const dueAt = new Date(trip.startedAt.getTime() + trip.estimatedMinutes * 60_000);
      const overdue = Date.now() > dueAt.getTime();
      res.json({ success: true, data: { trip: { ...trip, dueAt, overdue } } });
      return;
    }
    res.json({ success: true, data: { trip: null } });
  } catch (err) {
    console.error('[trip.getActiveTrip]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch active trip' });
  }
}

/** POST /api/trips — body: { destination, estimatedMinutes } */
export async function startTrip(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { destination, estimatedMinutes } = req.body as {
      destination?: string;
      estimatedMinutes?: number;
    };
    const mins = Number(estimatedMinutes);
    if (!destination?.trim() || !Number.isFinite(mins) || mins < 1 || mins > 1440) {
      res.status(400).json({
        success: false,
        message: 'destination and estimatedMinutes (1-1440) are required',
      });
      return;
    }

    const existing = await prisma.trip.findFirst({ where: { userId: req.userId, status: 'active' } });
    if (existing) {
      res.status(409).json({ success: false, message: 'A trip is already active. End it first.' });
      return;
    }

    const trip = await prisma.trip.create({
      data: { userId: req.userId!, destination: destination.trim(), estimatedMinutes: mins },
    });
    res.status(201).json({ success: true, data: { trip } });
  } catch (err) {
    console.error('[trip.startTrip]', err);
    res.status(500).json({ success: false, message: 'Failed to start trip' });
  }
}

/** POST /api/trips/:id/end */
export async function endTrip(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const existing = await prisma.trip.findFirst({ where: { id, userId: req.userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Trip not found' });
      return;
    }
    if (existing.status !== 'active') {
      res.status(409).json({ success: false, message: 'Trip is not active' });
      return;
    }
    const trip = await prisma.trip.update({
      where: { id },
      data: { status: 'arrived', endedAt: new Date() },
    });
    res.json({ success: true, data: { trip } });
  } catch (err) {
    console.error('[trip.endTrip]', err);
    res.status(500).json({ success: false, message: 'Failed to end trip' });
  }
}

/**
 * POST /api/trips/:id/overdue — client reports trip is overdue;
 * notifies contacts once and marks overdueNotified.
 */
export async function notifyOverdue(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const { latitude, longitude } = req.body as { latitude?: number; longitude?: number };

    const trip = await prisma.trip.findFirst({
      where: { id, userId: req.userId },
      include: { user: { include: { contacts: true } } },
    });
    if (!trip) {
      res.status(404).json({ success: false, message: 'Trip not found' });
      return;
    }
    if (trip.status !== 'active') {
      res.status(409).json({ success: false, message: 'Trip is not active' });
      return;
    }
    if (trip.overdueNotified) {
      res.json({ success: true, data: { trip, alreadyNotified: true, notified: 0 } });
      return;
    }

    const dueAt = trip.startedAt.getTime() + trip.estimatedMinutes * 60_000;
    if (Date.now() < dueAt) {
      res.status(409).json({ success: false, message: 'Trip is not overdue yet' });
      return;
    }

    const lines = [
      '⏰ HIFATZAT TRIP OVERDUE',
      `${trip.user.name} started a trip to "${trip.destination}" and has not confirmed arrival (expected in ${trip.estimatedMinutes} min).`,
    ];
    if (latitude != null && longitude != null) {
      lines.push(`Last location: https://maps.google.com/?q=${latitude},${longitude}`);
    }
    lines.push('Please try to reach them.');
    const body = lines.join('\n');

    await Promise.all(
      trip.user.contacts.map((c) =>
        Promise.all([sendSms({ to: c.phone, body }), sendWhatsAppMessage(c.phone, body)]),
      ),
    );

    const updated = await prisma.trip.update({
      where: { id },
      data: { status: 'overdue', overdueNotified: true },
    });
    res.json({ success: true, data: { trip: updated, notified: trip.user.contacts.length } });
  } catch (err) {
    console.error('[trip.notifyOverdue]', err);
    res.status(500).json({ success: false, message: 'Failed to send overdue notification' });
  }
}
