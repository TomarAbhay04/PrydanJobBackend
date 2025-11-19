// src/routes/paymentRoutes.js
import express from 'express';
import { createOrder, verifyPayment, getInvoice } from '../controllers/paymentController.js';
import { protect } from '../middleware/auth.js';
import validation from '../middleware/validation.js';

const router = express.Router();

/**
 * Create Razorpay order (returns order id + public key)
 * Protected: user must be logged in
 */
router.post(
  '/create-order',
  protect,
  validation.validateCreatePayment,
  createOrder
);

/**
 * Verify payment after client completes checkout
 * Protected: user must be logged in
 */
router.post(
  '/verify',
  protect,
  validation.validateVerifyPayment,
  verifyPayment
);

/**
 * Download invoice PDF (protected)
 * GET /api/payments/:paymentId/invoice
 */
router.get('/:paymentId/invoice', protect, getInvoice);


export default router;
