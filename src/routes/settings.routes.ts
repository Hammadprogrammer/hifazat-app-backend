import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { getSettings, updateSettings } from '../controllers/settings.controller';
import { getStreak } from '../controllers/streak.controller';

const settingsRouter = Router();
settingsRouter.use(authenticate);
settingsRouter.get('/', getSettings);
settingsRouter.put('/', updateSettings);

const streakRouter = Router();
streakRouter.use(authenticate);
streakRouter.get('/', getStreak);

export { settingsRouter, streakRouter };
