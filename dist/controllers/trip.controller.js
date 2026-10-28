"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTrips = getTrips;
exports.getActiveTrip = getActiveTrip;
exports.startTrip = startTrip;
exports.endTrip = endTrip;
exports.notifyOverdue = notifyOverdue;
const db_1 = __importDefault(require("../config/db"));
const notification_service_1 = require("../services/notification.service");
/** GET /api/trips */
async function getTrips(req, res) {
    try {
        const trips = await db_1.default.trip.findMany({
            where: { userId: req.userId },
            orderBy: { startedAt: 'desc' },
            take: 20,
        });
        res.json({ success: true, data: { trips } });
    }
    catch (err) {
        console.error('[trip.getTrips]', err);
        res.status(500).json({ success: false, message: 'Failed to fetch trips' });
    }
}
/** GET /api/trips/active */
async function getActiveTrip(req, res) {
    try {
        const trip = await db_1.default.trip.findFirst({
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
    }
    catch (err) {
        console.error('[trip.getActiveTrip]', err);
        res.status(500).json({ success: false, message: 'Failed to fetch active trip' });
    }
}
/** POST /api/trips — body: { destination, estimatedMinutes } */
async function startTrip(req, res) {
    try {
        const { destination, estimatedMinutes } = req.body;
        const mins = Number(estimatedMinutes);
        if (!destination?.trim() || !Number.isFinite(mins) || mins < 1 || mins > 1440) {
            res.status(400).json({
                success: false,
                message: 'destination and estimatedMinutes (1-1440) are required',
            });
            return;
        }
        const existing = await db_1.default.trip.findFirst({ where: { userId: req.userId, status: 'active' } });
        if (existing) {
            res.status(409).json({ success: false, message: 'A trip is already active. End it first.' });
            return;
        }
        const trip = await db_1.default.trip.create({
            data: { userId: req.userId, destination: destination.trim(), estimatedMinutes: mins },
        });
        res.status(201).json({ success: true, data: { trip } });
    }
    catch (err) {
        console.error('[trip.startTrip]', err);
        res.status(500).json({ success: false, message: 'Failed to start trip' });
    }
}
/** POST /api/trips/:id/end */
async function endTrip(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await db_1.default.trip.findFirst({ where: { id, userId: req.userId } });
        if (!existing) {
            res.status(404).json({ success: false, message: 'Trip not found' });
            return;
        }
        if (existing.status !== 'active') {
            res.status(409).json({ success: false, message: 'Trip is not active' });
            return;
        }
        const trip = await db_1.default.trip.update({
            where: { id },
            data: { status: 'arrived', endedAt: new Date() },
        });
        res.json({ success: true, data: { trip } });
    }
    catch (err) {
        console.error('[trip.endTrip]', err);
        res.status(500).json({ success: false, message: 'Failed to end trip' });
    }
}
/**
 * POST /api/trips/:id/overdue — client reports trip is overdue;
 * notifies contacts once and marks overdueNotified.
 */
async function notifyOverdue(req, res) {
    try {
        const id = String(req.params.id);
        const { latitude, longitude } = req.body;
        const trip = await db_1.default.trip.findFirst({
            where: { id, userId: req.userId },
            include: { user: { select: { name: true } } },
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
            `${trip.user.name} started a trip to "${trip.destination}" and has not confirmed arrival (expected in ${trip.estimatedMinutes} min).`,
        ];
        if (latitude != null && longitude != null) {
            lines.push(`Last location: https://maps.google.com/?q=${latitude},${longitude}`);
        }
        lines.push('Please try to reach them.');
        const { dispatches, skipped } = await (0, notification_service_1.notifyContacts)(req.userId, {
            type: 'TRIP_OVERDUE',
            title: '⏰ HIFAZAT TRIP OVERDUE',
            body: lines.join('\n'),
            tripId: id,
            latitude: latitude ?? null,
            longitude: longitude ?? null,
        });
        const updated = await db_1.default.trip.update({
            where: { id },
            data: { status: 'overdue', overdueNotified: true },
        });
        res.json({ success: true, data: { trip: updated, notified: dispatches.length, skipped } });
    }
    catch (err) {
        console.error('[trip.notifyOverdue]', err);
        res.status(500).json({ success: false, message: 'Failed to send overdue notification' });
    }
}
