import { Response } from 'express';
import prisma from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { getTodayDate, subtractDays, computeStreak } from '../lib/dates';

const MILESTONES = [7, 30, 100, 365];

export async function recalculateStreak(userId: string) {
  const rows = await prisma.checkin.findMany({ where: { userId }, select: { date: true } });
  const dates = rows.map((r) => r.date);
  const currentStreak = computeStreak(dates);
  const lastFullDate = dates.length ? [...dates].sort().reverse()[0]! : null;

  const existing = await prisma.userStreak.findUnique({ where: { userId } });
  const bestStreak = Math.max(existing?.bestStreak ?? 0, currentStreak);
  const prevMilestones = existing?.milestones ?? [];
  const milestones = [
    ...new Set([...prevMilestones, ...MILESTONES.filter((m) => currentStreak >= m)]),
  ].sort((a, b) => a - b);

  const streak = await prisma.userStreak.upsert({
    where: { userId },
    create: { userId, currentStreak, bestStreak, lastFullDate, milestones },
    update: { currentStreak, bestStreak, lastFullDate, milestones },
  });
  return streak;
}

/** GET /api/streak */
export async function getStreak(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const today = getTodayDate();
    const streak = await recalculateStreak(userId);

    const [todayRows, allDateRows] = await Promise.all([
      prisma.checkin.findMany({ where: { userId, date: today }, orderBy: { completedAt: 'asc' } }),
      prisma.checkin.findMany({ where: { userId }, select: { date: true } }),
    ]);
    const todayCheckedIn = todayRows.length > 0;
    const checkedDates = new Set(allDateRows.map((r) => r.date));

    const calendarHistory: { date: string; status: 'full' | 'today' | 'missed' }[] = [];
    for (let i = 29; i >= 0; i--) {
      const dateStr = subtractDays(today, i);
      calendarHistory.push({
        date: dateStr,
        status:
          dateStr === today ? (todayCheckedIn ? 'full' : 'today') : checkedDates.has(dateStr) ? 'full' : 'missed',
      });
    }

    const milestones = MILESTONES.map((m) => ({
      milestone: m,
      unlocked: streak.milestones.includes(m),
    }));
    const nextMilestone = MILESTONES.find((m) => streak.currentStreak < m) ?? null;

    res.json({
      success: true,
      data: {
        currentStreak: streak.currentStreak,
        bestStreak: streak.bestStreak,
        lastFullDate: streak.lastFullDate,
        todayCheckedIn,
        todayCheckInTime: todayRows[0]?.completedAt ?? null,
        calendarHistory,
        milestones,
        nextMilestone,
      },
    });
  } catch (err) {
    console.error('[streak.getStreak]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch streak' });
  }
}
