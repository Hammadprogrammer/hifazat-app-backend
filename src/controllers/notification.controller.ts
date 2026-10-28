import { Response } from 'express';
import prisma from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

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
} as const;

/** GET /api/notifications?unread=1&limit=50 — alerts received from other users */
export async function getNotifications(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const notifications = await prisma.notification.findMany({
      where: { recipientId: req.userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: NOTIFICATION_SELECT,
    });

    res.json({ success: true, data: { notifications } });
  } catch (err) {
    console.error('[notification.getNotifications]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
}

/** GET /api/notifications/unread-count */
export async function getUnreadCount(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const count = await prisma.notification.count({ where: { recipientId: req.userId, readAt: null } });
    res.json({ success: true, data: { count } });
  } catch (err) {
    console.error('[notification.getUnreadCount]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch unread count' });
  }
}

/** POST /api/notifications/read-all */
export async function markAllRead(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { count } = await prisma.notification.updateMany({
      where: { recipientId: req.userId, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ success: true, data: { updated: count } });
  } catch (err) {
    console.error('[notification.markAllRead]', err);
    res.status(500).json({ success: false, message: 'Failed to mark notifications read' });
  }
}

/** POST /api/notifications/:id/read */
export async function markRead(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const id = String(req.params.id);
    const existing = await prisma.notification.findFirst({ where: { id, recipientId: req.userId } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Notification not found' });
      return;
    }
    const notification = await prisma.notification.update({
      where: { id },
      data: { readAt: existing.readAt ?? new Date() },
      select: NOTIFICATION_SELECT,
    });
    res.json({ success: true, data: { notification } });
  } catch (err) {
    console.error('[notification.markRead]', err);
    res.status(500).json({ success: false, message: 'Failed to mark notification read' });
  }
}
