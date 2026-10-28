"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNotifications = getNotifications;
exports.getUnreadCount = getUnreadCount;
exports.markAllRead = markAllRead;
exports.markRead = markRead;
const db_1 = __importDefault(require("../config/db"));
const NOTIFICATION_SELECT = {
    id: true,
    type: true,
    title: true,
    body: true,
    alertId: true,
    tripId: true,
    latitude: true,
    longitude: true,
    readAt: true,
    createdAt: true,
    sender: { select: { id: true, name: true, phone: true } },
};
/** GET /api/notifications?unread=1&limit=50 — alerts received from other users */
async function getNotifications(req, res) {
    try {
        const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const notifications = await db_1.default.notification.findMany({
            where: { recipientId: req.userId, ...(unreadOnly ? { readAt: null } : {}) },
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: NOTIFICATION_SELECT,
        });
        res.json({ success: true, data: { notifications } });
    }
    catch (err) {
        console.error('[notification.getNotifications]', err);
        res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
    }
}
/** GET /api/notifications/unread-count */
async function getUnreadCount(req, res) {
    try {
        const count = await db_1.default.notification.count({ where: { recipientId: req.userId, readAt: null } });
        res.json({ success: true, data: { count } });
    }
    catch (err) {
        console.error('[notification.getUnreadCount]', err);
        res.status(500).json({ success: false, message: 'Failed to fetch unread count' });
    }
}
/** POST /api/notifications/read-all */
async function markAllRead(req, res) {
    try {
        const { count } = await db_1.default.notification.updateMany({
            where: { recipientId: req.userId, readAt: null },
            data: { readAt: new Date() },
        });
        res.json({ success: true, data: { updated: count } });
    }
    catch (err) {
        console.error('[notification.markAllRead]', err);
        res.status(500).json({ success: false, message: 'Failed to mark notifications read' });
    }
}
/** POST /api/notifications/:id/read */
async function markRead(req, res) {
    try {
        const id = String(req.params.id);
        const existing = await db_1.default.notification.findFirst({ where: { id, recipientId: req.userId } });
        if (!existing) {
            res.status(404).json({ success: false, message: 'Notification not found' });
            return;
        }
        const notification = await db_1.default.notification.update({
            where: { id },
            data: { readAt: existing.readAt ?? new Date() },
            select: NOTIFICATION_SELECT,
        });
        res.json({ success: true, data: { notification } });
    }
    catch (err) {
        console.error('[notification.markRead]', err);
        res.status(500).json({ success: false, message: 'Failed to mark notification read' });
    }
}
