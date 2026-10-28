"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getContacts = getContacts;
exports.addContact = addContact;
exports.deleteContact = deleteContact;
const db_1 = __importDefault(require("../config/db"));
const phone_1 = require("../lib/phone");
const MAX_CONTACTS = 2;
const NOT_REGISTERED_WARNING = 'This number is not registered on HIFAZAT. They will not receive in-app alerts until they sign up with this number.';
/** Returns the set of phones (from the given list) that belong to registered users. */
async function registeredPhones(phones) {
    if (phones.length === 0)
        return new Set();
    const users = await db_1.default.user.findMany({ where: { phone: { in: phones } }, select: { phone: true } });
    return new Set(users.map((u) => u.phone));
}
/** GET /api/contacts */
async function getContacts(req, res) {
    try {
        const rows = await db_1.default.contact.findMany({
            where: { userId: req.userId },
            orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
            select: { id: true, name: true, phone: true, relation: true, priority: true, createdAt: true },
        });
        const registered = await registeredPhones(rows.map((c) => c.phone));
        const contacts = rows.map((c) => ({ ...c, isAppUser: registered.has(c.phone) }));
        res.json({ success: true, data: { contacts, max: MAX_CONTACTS } });
    }
    catch (err) {
        console.error('[contact.getContacts]', err);
        res.status(500).json({ success: false, message: 'Failed to fetch contacts' });
    }
}
/** POST /api/contacts — strict limit of 2 emergency contacts per user */
async function addContact(req, res) {
    try {
        const { name, phone, relation, priority } = req.body;
        const prio = Number.isInteger(priority) && priority >= 1 && priority <= 3 ? priority : 3;
        if (!name?.trim() || !phone?.trim()) {
            res.status(400).json({ success: false, message: 'name and phone are required' });
            return;
        }
        const normalized = (0, phone_1.normalizePhone)(phone);
        if (!(0, phone_1.isValidE164)(normalized)) {
            res.status(400).json({ success: false, message: 'Enter a valid phone number, e.g. +92 300 1234567' });
            return;
        }
        const self = await db_1.default.user.findUnique({ where: { id: req.userId }, select: { phone: true } });
        if (self?.phone === normalized) {
            res.status(400).json({ success: false, message: 'You cannot add your own number as an emergency contact' });
            return;
        }
        const count = await db_1.default.contact.count({ where: { userId: req.userId } });
        if (count >= MAX_CONTACTS) {
            res.status(400).json({
                success: false,
                message: `Maximum of ${MAX_CONTACTS} emergency contacts allowed. Remove one to add another.`,
            });
            return;
        }
        const duplicate = await db_1.default.contact.findFirst({
            where: { userId: req.userId, phone: normalized },
        });
        if (duplicate) {
            res.status(409).json({ success: false, message: 'This contact is already saved' });
            return;
        }
        const [created, appUser] = await Promise.all([
            db_1.default.contact.create({
                data: {
                    name: name.trim(),
                    phone: normalized,
                    relation: relation?.trim() || null,
                    priority: prio,
                    userId: req.userId,
                },
                select: { id: true, name: true, phone: true, relation: true, priority: true, createdAt: true },
            }),
            db_1.default.user.findUnique({ where: { phone: normalized }, select: { id: true } }),
        ]);
        const isAppUser = Boolean(appUser);
        res.status(201).json({
            success: true,
            message: isAppUser ? 'Contact added' : NOT_REGISTERED_WARNING,
            data: {
                contact: { ...created, isAppUser },
                isAppUser,
                ...(isAppUser ? {} : { warning: NOT_REGISTERED_WARNING }),
            },
        });
    }
    catch (err) {
        console.error('[contact.addContact]', err);
        res.status(500).json({ success: false, message: 'Failed to add contact' });
    }
}
/** DELETE /api/contacts/:id */
async function deleteContact(req, res) {
    try {
        const { id } = req.params;
        const contact = await db_1.default.contact.findFirst({
            where: { id, userId: req.userId },
        });
        if (!contact) {
            res.status(404).json({ success: false, message: 'Contact not found' });
            return;
        }
        await db_1.default.contact.delete({ where: { id } });
        res.json({ success: true, message: 'Contact removed' });
    }
    catch (err) {
        console.error('[contact.deleteContact]', err);
        res.status(500).json({ success: false, message: 'Failed to delete contact' });
    }
}
