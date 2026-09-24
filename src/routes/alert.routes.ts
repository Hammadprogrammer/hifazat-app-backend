import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { sosRateLimiter } from '../middlewares/rateLimiter';
import {
  triggerAlert,
  getAlertHistory,
  getActiveAlert,
  getAlertById,
  cancelAlert,
  markSafe,
  updateAlertLocation,
  getAlertLocations,
} from '../controllers/alert.controller';

const router = Router();

router.use(authenticate);

router.post('/trigger', sosRateLimiter, triggerAlert);
router.get('/history', getAlertHistory);
router.get('/active', getActiveAlert);
router.get('/:id', getAlertById);
router.post('/:id/cancel', cancelAlert);
router.post('/:id/safe', markSafe);
router.post('/:id/location', updateAlertLocation);
router.get('/:id/locations', getAlertLocations);

export default router;
