import { Response } from 'express';
import prisma from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { isExpoPushToken } from '../services/push.service';

/** POST /api/devices — register (or re-assign) an Expo push token for this user */
export async function registerDevice(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { pushToken, platform } = req.body as { pushToken?: string; platform?: string };

    if (!pushToken?.trim() || !isExpoPushToken(pushToken.trim())) {
      res.status(400).json({
        success: false,
        message: 'A valid Expo push token is required, e.g. ExponentPushToken[xxxxxxxx]',
      });
      return;
    }

    const device = await prisma.device.upsert({
      where: { pushToken: pushToken.trim() },
      update: { userId: req.userId!, platform: platform?.trim() || null },
      create: { userId: req.userId!, pushToken: pushToken.trim(), platform: platform?.trim() || null },
      select: { id: true, pushToken: true, platform: true, updatedAt: true },
    });

    res.status(201).json({ success: true, data: { device } });
  } catch (err) {
    console.error('[device.registerDevice]', err);
    res.status(500).json({ success: false, message: 'Failed to register device' });
  }
}

/** DELETE /api/devices/:token — remove a push token (e.g. on logout) */
export async function unregisterDevice(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const token = decodeURIComponent(String(req.params.token));
    const { count } = await prisma.device.deleteMany({ where: { pushToken: token, userId: req.userId } });
    res.json({ success: true, data: { removed: count } });
  } catch (err) {
    console.error('[device.unregisterDevice]', err);
    res.status(500).json({ success: false, message: 'Failed to remove device' });
  }
}
