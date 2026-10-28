"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isExpoPushToken = isExpoPushToken;
exports.sendExpoPush = sendExpoPush;
/**
 * Expo Push Notifications.
 * Docs: https://docs.expo.dev/push-notifications/sending-notifications/
 *
 * No SDK needed — plain HTTPS POST. Optional EXPO_ACCESS_TOKEN enables
 * "Enhanced Security" on the Expo project.
 */
const db_1 = __importDefault(require("../config/db"));
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;
function isExpoPushToken(token) {
    return /^Expo(nent)?PushToken\[.+\]$/.test(token);
}
async function sendExpoPush(tokens, payload) {
    const result = { sent: 0, failed: 0, invalidTokens: [] };
    const valid = tokens.filter(isExpoPushToken);
    if (valid.length === 0)
        return result;
    const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
    };
    if (process.env.EXPO_ACCESS_TOKEN) {
        headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    }
    for (let i = 0; i < valid.length; i += CHUNK_SIZE) {
        const chunk = valid.slice(i, i + CHUNK_SIZE);
        const messages = chunk.map((to) => ({
            to,
            title: payload.title,
            body: payload.body,
            data: payload.data ?? {},
            sound: 'default',
            priority: 'high',
            channelId: 'emergency',
        }));
        try {
            const res = await fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(messages) });
            const json = (await res.json());
            const tickets = json.data ?? [];
            tickets.forEach((ticket, idx) => {
                if (ticket.status === 'ok') {
                    result.sent += 1;
                }
                else {
                    result.failed += 1;
                    if (ticket.details?.error === 'DeviceNotRegistered')
                        result.invalidTokens.push(chunk[idx]);
                }
            });
            if (tickets.length === 0)
                result.failed += chunk.length;
        }
        catch (err) {
            console.error('[push] Expo request failed:', err);
            result.failed += chunk.length;
        }
    }
    if (result.invalidTokens.length > 0) {
        await db_1.default.device
            .deleteMany({ where: { pushToken: { in: result.invalidTokens } } })
            .catch((err) => console.error('[push] failed to prune dead tokens:', err));
    }
    return result;
}
