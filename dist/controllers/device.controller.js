"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDevice = registerDevice;
exports.unregisterDevice = unregisterDevice;
const db_1 = __importDefault(require("../config/db"));
const push_service_1 = require("../services/push.service");
/** POST /api/devices — register (or re-assign) an Expo push token for this user */
async function registerDevice(req, res) {
    try {
        const { pushToken, platform } = req.body;
        if (!pushToken?.trim() || !(0, push_service_1.isExpoPushToken)(pushToken.trim())) {
            res.status(400).json({
                success: false,
                message: 'A valid Expo push token is required, e.g. ExponentPushToken[xxxxxxxx]',
            });
            return;
        }
        const device = await db_1.default.device.upsert({
            where: { pushToken: pushToken.trim() },
            update: { userId: req.userId, platform: platform?.trim() || null },
            create: { userId: req.userId, pushToken: pushToken.trim(), platform: platform?.trim() || null },
            select: { id: true, pushToken: true, platform: true, updatedAt: true },
        });
        res.status(201).json({ success: true, data: { device } });
    }
    catch (err) {
        console.error('[device.registerDevice]', err);
        res.status(500).json({ success: false, message: 'Failed to register device' });
    }
}
/** DELETE /api/devices/:token — remove a push token (e.g. on logout) */
async function unregisterDevice(req, res) {
    try {
        const token = decodeURIComponent(String(req.params.token));
        const { count } = await db_1.default.device.deleteMany({ where: { pushToken: token, userId: req.userId } });
        res.json({ success: true, data: { removed: count } });
    }
    catch (err) {
        console.error('[device.unregisterDevice]', err);
        res.status(500).json({ success: false, message: 'Failed to remove device' });
    }
}
