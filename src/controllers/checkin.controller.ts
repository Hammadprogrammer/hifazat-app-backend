import { Response } from 'express';
import prisma from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { getTodayDate, subtractDays, computeStreak } from '../lib/dates';
import { sendSms } from '../services/sms.service';
import { sendWhatsAppMessage } from '../services/whatsapp.service';
import { recalculateStreak } from './streak.controller';

const DEFAULT_ALARMS = [
  { label: 'Morning', hour: 9, minute: 0, sortOrder: 0 },
  { label: 'Afternoon', hour: 14, minute: 0, sortOrder: 1 },
  { label: 'Evening', hour: 17, minute: 0, sortOrder: 2 },
  { label: 'Night', hour: 22, minute: 0, sortOrder: 3 },
];

async function ensureDefaultAlarms(userId: string) {
  const existing = await prisma.alarmSchedule.findMany({ where: { userId } });
  const labels = new Set(existing.map((a) => a.label.toLowerCase()));
  const missing = DEFAULT_ALARMS.filter((a) => !labels.has(a.label.toLowerCase()));
  if (missing.length > 0) {
    await prisma.alarmSchedule.createMany({
      data: missing.map((a) => ({ ...a, userId })),
      skipDuplicates: true,
    });
  }
}

/** GET /api/checkins — today's check-ins */
export async function getTodayCheckins(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const checkins = await prisma.checkin.findMany({
      where: { userId: req.userId, date: getTodayDate() },
      orderBy: { completedAt: 'desc' },
    });
    res.json({ success: true, data: { checkins } });
  } catch (err) {
    console.error('[checkin.getTodayCheckins]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch check-ins' });
  }
}

/** GET /api/checkins/history */
export async function getCheckinHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const checkins = await prisma.checkin.findMany({
      where: { userId: req.userId },
      orderBy: { completedAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: { checkins } });
  } catch (err) {
    console.error('[checkin.getCheckinHistory]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch check-in history' });
  }
}

/** POST /api/checkins — body: { type, label?, status? } */
export async function createCheckin(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { type, label, status } = req.body as { type?: string; label?: string; status?: string };
    const validStatus = status === 'not_safe' ? 'not_safe' : 'safe';

    const checkin = await prisma.checkin.create({
      data: {
        userId: req.userId!,
        type: type || 'manual',
        label: label || type || 'manual',
        status: validStatus,
        date: getTodayDate(),
      },
    });

    let alertedContacts = 0;
    if (validStatus === 'not_safe') {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        include: { contacts: true },
      });
      if (user && user.contacts.length > 0) {
        const body = `⚠️ HIFATZAT CHECK-IN ALERT\n${user.name} marked themselves as NOT SAFE during a scheduled check-in (${checkin.label}). Please contact them immediately.\nTime: ${new Date().toISOString()}`;
        await Promise.all(
          user.contacts.map((c) =>
            Promise.all([sendSms({ to: c.phone, body }), sendWhatsAppMessage(c.phone, body)]),
          ),
        );
        alertedContacts = user.contacts.length;
      }
    }

    await recalculateStreak(req.userId!);

    res.status(201).json({ success: true, data: { checkin, alertedContacts } });
  } catch (err) {
    console.error('[checkin.createCheckin]', err);
    res.status(500).json({ success: false, message: 'Failed to record check-in' });
  }
}

/** GET /api/checkins/alarms */
export async function getAlarms(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    await ensureDefaultAlarms(req.userId!);
    const alarms = await prisma.alarmSchedule.findMany({
      where: { userId: req.userId },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: { alarms } });
  } catch (err) {
    console.error('[checkin.getAlarms]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch alarms' });
  }
}

/** PUT /api/checkins/alarms/:id */
export async function updateAlarm(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const { hour, minute, enabled, label, soundEnabled } = req.body as {
      hour?: number;
      minute?: number;
      enabled?: boolean;
      label?: string;
      soundEnabled?: boolean;
    };

    const existing = await prisma.alarmSchedule.findFirst({ where: { id, userId: req.userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Alarm not found' });
      return;
    }

    if (hour !== undefined && (hour < 0 || hour > 23)) {
      res.status(400).json({ success: false, message: 'hour must be 0-23' });
      return;
    }
    if (minute !== undefined && (minute < 0 || minute > 59)) {
      res.status(400).json({ success: false, message: 'minute must be 0-59' });
      return;
    }

    const alarm = await prisma.alarmSchedule.update({
      where: { id },
      data: {
        ...(hour !== undefined && { hour }),
        ...(minute !== undefined && { minute }),
        ...(enabled !== undefined && { enabled }),
        ...(label !== undefined && { label }),
        ...(soundEnabled !== undefined && { soundEnabled }),
      },
    });
    res.json({ success: true, data: { alarm } });
  } catch (err) {
    console.error('[checkin.updateAlarm]', err);
    res.status(500).json({ success: false, message: 'Failed to update alarm' });
  }
}

/** GET /api/checkins/score — safety score breakdown */
export async function getSafetyScore(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const today = getTodayDate();
    const sevenDaysAgo = subtractDays(today, 6);

    await ensureDefaultAlarms(userId);
    const [alarms, weekRows, allDateRows, recentTrips, contactCount] = await Promise.all([
      prisma.alarmSchedule.findMany({ where: { userId } }),
      prisma.checkin.findMany({ where: { userId, date: { gte: sevenDaysAgo } } }),
      prisma.checkin.findMany({ where: { userId }, select: { date: true } }),
      prisma.trip.count({
        where: {
          userId,
          status: { in: ['arrived', 'ended'] },
          startedAt: { gte: new Date(sevenDaysAgo + 'T00:00:00Z') },
        },
      }),
      prisma.contact.count({ where: { userId } }),
    ]);

    const enabledAlarmCount = Math.max(alarms.filter((a) => a.enabled).length, 1);
    const todayRows = weekRows.filter((r) => r.date === today);
    const safeCount = todayRows.filter((r) => r.status === 'safe').length;
    const notSafeCount = todayRows.filter((r) => r.status === 'not_safe').length;

    // Component 1: Check-in rate (40)
    let checkinScore: number;
    if (weekRows.length === 0) {
      checkinScore = 40;
    } else {
      const uniqueDays = new Set(weekRows.map((r) => r.date)).size;
      const expectedTotal = enabledAlarmCount * Math.max(uniqueDays, 1);
      const doneTotal = weekRows.filter((r) => r.status === 'safe').length;
      checkinScore = Math.round(Math.min(doneTotal / expectedTotal, 1) * 40);
    }

    // Component 2: Trip usage (20)
    const tripScore = Math.min(recentTrips * 5, 20);

    // Component 3: Streak (20)
    const streak = computeStreak(allDateRows.map((r) => r.date), today);
    const streakScore = Math.min(streak, 20);

    // Component 4: Profile (20)
    const profileScore = 10 + (contactCount > 0 ? 10 : 0);

    const score = Math.max(0, Math.min(100, checkinScore + tripScore + streakScore + profileScore));
    const label =
      score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Needs Attention';

    res.json({
      success: true,
      data: {
        score,
        label,
        factors: [
          { label: 'Check-in rate (this week)', points: checkinScore, maxPoints: 40, completed: checkinScore >= 30 },
          { label: 'Trip mode usage', points: tripScore, maxPoints: 20, completed: tripScore > 0 },
          { label: `Daily streak (${streak} day${streak !== 1 ? 's' : ''})`, points: streakScore, maxPoints: 20, completed: streak > 0 },
          { label: 'Profile completeness', points: profileScore, maxPoints: 20, completed: profileScore >= 20 },
        ],
        streak,
        weekCheckins: weekRows.filter((r) => r.status === 'safe').length,
        safeCount,
        notSafeCount,
        totalToday: todayRows.length,
        contactCount,
      },
    });
  } catch (err) {
    console.error('[checkin.getSafetyScore]', err);
    res.status(500).json({ success: false, message: 'Failed to compute safety score' });
  }
}
