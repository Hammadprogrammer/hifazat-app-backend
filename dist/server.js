"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const contact_routes_1 = __importDefault(require("./routes/contact.routes"));
const alert_routes_1 = __importDefault(require("./routes/alert.routes"));
const checkin_routes_1 = __importDefault(require("./routes/checkin.routes"));
const trip_routes_1 = __importDefault(require("./routes/trip.routes"));
const settings_routes_1 = require("./routes/settings.routes");
const device_routes_1 = __importDefault(require("./routes/device.routes"));
const notification_routes_1 = __importDefault(require("./routes/notification.routes"));
const app = (0, express_1.default)();
const PORT = Number(process.env.PORT ?? 4000);
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '1mb' }));
// Browser test page (public/index.html)
app.use(express_1.default.static(path_1.default.join(__dirname, '..', 'public')));
// Health check
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'hifatzat-emergency-api',
        time: new Date().toISOString(),
        providers: {
            push: 'expo',
            redis: Boolean(process.env.UPSTASH_REDIS_REST_URL),
        },
    });
});
// API routes
app.use('/api/auth', auth_routes_1.default);
app.use('/api/contacts', contact_routes_1.default);
app.use('/api/alerts', alert_routes_1.default);
app.use('/api/checkins', checkin_routes_1.default);
app.use('/api/trips', trip_routes_1.default);
app.use('/api/settings', settings_routes_1.settingsRouter);
app.use('/api/streak', settings_routes_1.streakRouter);
app.use('/api/devices', device_routes_1.default);
app.use('/api/notifications', notification_routes_1.default);
// 404 handler
app.use((_req, res) => {
    res.status(404).json({ success: false, message: 'Route not found' });
});
// Global error handler
app.use((err, _req, res, _next) => {
    console.error('[server] Unhandled error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
});
// Only bind a port when running locally (Vercel runs this as a serverless function)
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`🚀 HIFATZAT Emergency API running on http://localhost:${PORT}`);
    });
}
exports.default = app;
