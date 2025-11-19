// src/routes/webhookRoutes.js
import express from 'express';
import { razorpayWebhook } from '../controllers/webhookController.js';

const router = express.Router();

// No auth - Razorpay will call it. Express.raw must be mounted for this path in server.js
router.post('/', razorpayWebhook);

export default router;
