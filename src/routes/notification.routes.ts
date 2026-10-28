import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import {
  getNotifications,
  getUnreadCount,
  markAllRead,
  markRead,
} from '../controllers/notification.controller';

const router = Router();

router.use(authenticate);

router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.post('/read-all', markAllRead);
router.post('/:id/read', markRead);

export default router;
