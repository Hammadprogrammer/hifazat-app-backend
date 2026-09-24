import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import {
  getTodayCheckins,
  getCheckinHistory,
  createCheckin,
  getAlarms,
  updateAlarm,
  getSafetyScore,
} from '../controllers/checkin.controller';

const router = Router();

router.use(authenticate);

router.get('/', getTodayCheckins);
router.get('/history', getCheckinHistory);
router.post('/', createCheckin);
router.get('/alarms', getAlarms);
router.put('/alarms/:id', updateAlarm);
router.get('/score', getSafetyScore);

export default router;
