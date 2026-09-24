import { Response } from 'express';
import prisma from '../config/db';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { isValidE164, normalizePhone } from '../lib/phone';

const MAX_CONTACTS = 2;

/** GET /api/contacts */
export async function getContacts(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const contacts = await prisma.contact.findMany({
      where: { userId: req.userId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, phone: true, relation: true, priority: true, createdAt: true },
    });

    res.json({ success: true, data: { contacts, max: MAX_CONTACTS } });
  } catch (err) {
    console.error('[contact.getContacts]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch contacts' });
  }
}

/** POST /api/contacts — strict limit of 2 emergency contacts per user */
export async function addContact(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { name, phone, relation, priority } = req.body as {
      name?: string;
      phone?: string;
      relation?: string;
      priority?: number;
    };
    const prio = Number.isInteger(priority) && priority! >= 1 && priority! <= 3 ? priority! : 3;

    if (!name?.trim() || !phone?.trim()) {
      res.status(400).json({ success: false, message: 'name and phone are required' });
      return;
    }

    const normalized = normalizePhone(phone);
    if (!isValidE164(normalized)) {
      res.status(400).json({ success: false, message: 'Enter a valid phone number, e.g. +92 300 1234567' });
      return;
    }

    const count = await prisma.contact.count({ where: { userId: req.userId } });
    if (count >= MAX_CONTACTS) {
      res.status(400).json({
        success: false,
        message: `Maximum of ${MAX_CONTACTS} emergency contacts allowed. Remove one to add another.`,
      });
      return;
    }

    const duplicate = await prisma.contact.findFirst({
      where: { userId: req.userId, phone: normalized },
    });
    if (duplicate) {
      res.status(409).json({ success: false, message: 'This contact is already saved' });
      return;
    }

    const contact = await prisma.contact.create({
      data: {
        name: name.trim(),
        phone: normalized,
        relation: relation?.trim() || null,
        priority: prio,
        userId: req.userId!,
      },
      select: { id: true, name: true, phone: true, relation: true, priority: true, createdAt: true },
    });

    res.status(201).json({ success: true, data: { contact } });
  } catch (err) {
    console.error('[contact.addContact]', err);
    res.status(500).json({ success: false, message: 'Failed to add contact' });
  }
}

/** DELETE /api/contacts/:id */
export async function deleteContact(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };

    const contact = await prisma.contact.findFirst({
      where: { id, userId: req.userId },
    });

    if (!contact) {
      res.status(404).json({ success: false, message: 'Contact not found' });
      return;
    }

    await prisma.contact.delete({ where: { id } });

    res.json({ success: true, message: 'Contact removed' });
  } catch (err) {
    console.error('[contact.deleteContact]', err);
    res.status(500).json({ success: false, message: 'Failed to delete contact' });
  }
}
