import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { getContacts, addContact, deleteContact } from '../controllers/contact.controller';

const router = Router();

router.use(authenticate);

router.get('/', getContacts);
router.post('/', addContact);
router.delete('/:id', deleteContact);

export default router;
