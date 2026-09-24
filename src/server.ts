import 'dotenv/config';
import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes';
import contactRoutes from './routes/contact.routes';
import alertRoutes from './routes/alert.routes';
import checkinRoutes from './routes/checkin.routes';
import tripRoutes from './routes/trip.routes';
import { settingsRouter, streakRouter } from './routes/settings.routes';
import { resolveSmsProvider } from './services/sms.service';
import { resolveWhatsAppProvider } from './services/whatsapp.service';
import { otpIsLive } from './services/otp.service';

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Browser test page (public/index.html)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'hifatzat-emergency-api',
    time: new Date().toISOString(),
    providers: {
      sms: resolveSmsProvider().name,
      whatsapp: resolveWhatsAppProvider(),
      otp: otpIsLive() ? 'live' : 'static',
      redis: Boolean(process.env.UPSTASH_REDIS_REST_URL),
    },
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/checkins', checkinRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/settings', settingsRouter);
app.use('/api/streak', streakRouter);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// Only bind a port when running locally (Vercel runs this as a serverless function)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 HIFATZAT Emergency API running on http://localhost:${PORT}`);
  });
}

export default app;
