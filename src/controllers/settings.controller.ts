import { Response } from 'express';
import prisma from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

const BOOL_FIELDS = [
  'shakeToAlert',
  'keepScreenOn',
  'secretRecording',
  'lowBatteryAlert',
  'simChangeAlert',
  'offlineDetection',
] as const;

async function getOrCreateSettings(userId: string) {
  return prisma.settings.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

/** GET /api/settings */
export async function getSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const settings = await getOrCreateSettings(req.userId!);
    res.json({ success: true, data: { settings } });
  } catch (err) {
    console.error('[settings.getSettings]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch settings' });
  }
}

/** PUT /api/settings */
export async function updateSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    await getOrCreateSettings(req.userId!);
    const body = req.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};

    for (const f of BOOL_FIELDS) {
      if (typeof body[f] === 'boolean') data[f] = body[f];
    }
    if (typeof body.countryCode === 'string' && /^\+\d{1,4}$/.test(body.countryCode)) {
      data.countryCode = body.countryCode;
    }

    const settings = await prisma.settings.update({ where: { userId: req.userId! }, data });
    res.json({ success: true, data: { settings } });
  } catch (err) {
    console.error('[settings.updateSettings]', err);
    res.status(500).json({ success: false, message: 'Failed to update settings' });
  }
}
