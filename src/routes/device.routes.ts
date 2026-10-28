import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { registerDevice, unregisterDevice } from '../controllers/device.controller';

const router = Router();

router.use(authenticate);

router.post('/', registerDevice);
router.delete('/:token', unregisterDevice);

export default router;
