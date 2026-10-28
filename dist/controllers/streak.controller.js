"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recalculateStreak = recalculateStreak;
exports.getStreak = getStreak;
const db_1 = __importDefault(require("../config/db"));
const dates_1 = require("../lib/dates");
const MILESTONES = [7, 30, 100, 365];
async function recalculateStreak(userId) {
    const rows = await db_1.default.checkin.findMany({ where: { userId }, select: { date: true } });
    const dates = rows.map((r) => r.date);
    const currentStreak = (0, dates_1.computeStreak)(dates);
    const lastFullDate = dates.length ? [...dates].sort().reverse()[0] : null;
    const existing = await db_1.default.userStreak.findUnique({ where: { userId } });
    const bestStreak = Math.max(existing?.bestStreak ?? 0, currentStreak);
    const prevMilestones = existing?.milestones ?? [];
    const milestones = [
        ...new Set([...prevMilestones, ...MILESTONES.filter((m) => currentStreak >= m)]),
    ].sort((a, b) => a - b);
    const streak = await db_1.default.userStreak.upsert({
        where: { userId },
        create: { userId, currentStreak, bestStreak, lastFullDate, milestones },
        update: { currentStreak, bestStreak, lastFullDate, milestones },
    });
    return streak;
}
/** GET /api/streak */
async function getStreak(req, res) {
    try {
        const userId = req.userId;
        const today = (0, dates_1.getTodayDate)();
        const streak = await recalculateStreak(userId);
        const [todayRows, allDateRows] = await Promise.all([
            db_1.default.checkin.findMany({ where: { userId, date: today }, orderBy: { completedAt: 'asc' } }),
            db_1.default.checkin.findMany({ where: { userId }, select: { date: true } }),
        ]);
        const todayCheckedIn = todayRows.length > 0;
        const checkedDates = new Set(allDateRows.map((r) => r.date));
        const calendarHistory = [];
        for (let i = 29; i >= 0; i--) {
            const dateStr = (0, dates_1.subtractDays)(today, i);
            calendarHistory.push({
                date: dateStr,
                status: dateStr === today ? (todayCheckedIn ? 'full' : 'today') : checkedDates.has(dateStr) ? 'full' : 'missed',
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
    }
    catch (err) {
        console.error('[streak.getStreak]', err);
        res.status(500).json({ success: false, message: 'Failed to fetch streak' });
    }
}
