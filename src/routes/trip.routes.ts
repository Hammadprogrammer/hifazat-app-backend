import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { getTrips, getActiveTrip, startTrip, endTrip, notifyOverdue } from '../controllers/trip.controller';

const router = Router();

router.use(authenticate);

router.get('/', getTrips);
router.get('/active', getActiveTrip);
router.post('/', startTrip);
router.post('/:id/end', endTrip);
router.post('/:id/overdue', notifyOverdue);

export default router;
