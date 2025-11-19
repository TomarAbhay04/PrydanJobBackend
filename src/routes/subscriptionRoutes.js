// src/routes/subscriptionRoutes.js
import express from 'express';
import {
  activate,
  getMySubscription,
  cancelSubscription,
  adminList,
} from '../controllers/subscriptionController.js';
import { protect, authorize } from '../middleware/auth.js';
import validation from '../middleware/validation.js';

const router = express.Router();

/**
 * Protected user routes
 */
router.post('/activate', protect, validation.validateActivateSubscription, activate);
router.get('/me', protect, getMySubscription);
router.post('/:id/cancel', protect, validation.validateObjectId('id'), cancelSubscription);

/**
 * Admin routes
 */
router.get('/', protect, authorize('admin'), adminList);

export default router;
