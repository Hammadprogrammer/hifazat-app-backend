import { Router } from 'express';
import { signup, login, verifyLoginOtp } from '../controllers/auth.controller';

const router = Router();

router.post('/signup', signup);
router.post('/login', login);
router.post('/verify-otp', verifyLoginOtp);

export default router;
