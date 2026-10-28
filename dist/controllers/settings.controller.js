"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSettings = getSettings;
exports.updateSettings = updateSettings;
const db_1 = __importDefault(require("../config/db"));
const BOOL_FIELDS = [
    'shakeToAlert',
    'keepScreenOn',
    'secretRecording',
    'lowBatteryAlert',
    'simChangeAlert',
    'offlineDetection',
];
async function getOrCreateSettings(userId) {
    return db_1.default.settings.upsert({
        where: { userId },
        create: { userId },
        update: {},
    });
}
/** GET /api/settings */
async function getSettings(req, res) {
    try {
        const settings = await getOrCreateSettings(req.userId);
        res.json({ success: true, data: { settings } });
    }
    catch (err) {
        console.error('[settings.getSettings]', err);
        res.status(500).json({ success: false, message: 'Failed to fetch settings' });
    }
}
/** PUT /api/settings */
async function updateSettings(req, res) {
    try {
        await getOrCreateSettings(req.userId);
        const body = req.body;
        const data = {};
        for (const f of BOOL_FIELDS) {
            if (typeof body[f] === 'boolean')
                data[f] = body[f];
        }
        if (typeof body.countryCode === 'string' && /^\+\d{1,4}$/.test(body.countryCode)) {
            data.countryCode = body.countryCode;
        }
        const settings = await db_1.default.settings.update({ where: { userId: req.userId }, data });
        res.json({ success: true, data: { settings } });
    }
    catch (err) {
        console.error('[settings.updateSettings]', err);
        res.status(500).json({ success: false, message: 'Failed to update settings' });
    }
}
