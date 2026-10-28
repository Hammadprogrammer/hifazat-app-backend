"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findRegisteredContacts = findRegisteredContacts;
exports.notifyContacts = notifyContacts;
const db_1 = __importDefault(require("../config/db"));
const push_service_1 = require("./push.service");
/** Split a user's emergency contacts into app users vs. unregistered numbers. */
async function findRegisteredContacts(userId) {
    const contacts = await db_1.default.contact.findMany({
        where: { userId },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, phone: true },
    });
    if (contacts.length === 0)
        return { registered: [], unregistered: [] };
    const users = await db_1.default.user.findMany({
        where: { phone: { in: contacts.map((c) => c.phone) } },
        select: { id: true, name: true, phone: true },
    });
    const byPhone = new Map(users.map((u) => [u.phone, u]));
    const registered = [];
    const unregistered = [];
    for (const c of contacts) {
        const u = byPhone.get(c.phone);
        if (u)
            registered.push({ ...c, user: { id: u.id, name: u.name } });
        else
            unregistered.push(c);
    }
    return { registered, unregistered };
}
const SKIP_REASON = 'Not registered on HIFAZAT app';
async function notifyContacts(senderId, input) {
    const { registered, unregistered } = await findRegisteredContacts(senderId);
    const skipped = unregistered.map((c) => ({ ...c, reason: SKIP_REASON }));
    if (registered.length === 0)
        return { dispatches: [], skipped };
    const recipientIds = registered.map((r) => r.user.id);
    const [notifications, devices] = await Promise.all([
        db_1.default.$transaction(registered.map((r) => db_1.default.notification.create({
            data: {
                recipientId: r.user.id,
                senderId,
                alertId: input.alertId ?? null,
                tripId: input.tripId ?? null,
                type: input.type,
                title: input.title,
                body: input.body,
                latitude: input.latitude ?? null,
                longitude: input.longitude ?? null,
            },
            select: { id: true, recipientId: true },
        }))),
        db_1.default.device.findMany({
            where: { userId: { in: recipientIds } },
            select: { userId: true, pushToken: true },
        }),
    ]);
    const notifByRecipient = new Map(notifications.map((n) => [n.recipientId, n.id]));
    const tokensByUser = new Map();
    for (const d of devices) {
        const list = tokensByUser.get(d.userId) ?? [];
        list.push(d.pushToken);
        tokensByUser.set(d.userId, list);
    }
    const dispatches = await Promise.all(registered.map(async (r) => {
        const tokens = tokensByUser.get(r.user.id) ?? [];
        const notificationId = notifByRecipient.get(r.user.id);
        const push = tokens.length > 0
            ? await (0, push_service_1.sendExpoPush)(tokens, {
                title: input.title,
                body: input.body,
                data: {
                    type: input.type,
                    notificationId,
                    alertId: input.alertId ?? null,
                    tripId: input.tripId ?? null,
                    senderId,
                    latitude: input.latitude ?? null,
                    longitude: input.longitude ?? null,
                },
            })
            : { sent: 0, failed: 0, invalidTokens: [] };
        return {
            contact: { id: r.id, name: r.name, phone: r.phone },
            recipient: r.user,
            notificationId,
            pushSent: push.sent,
            devices: tokens.length,
        };
    }));
    return { dispatches, skipped };
}
