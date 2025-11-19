// src/controllers/webhookController.js
import Payment from '../models/Payment.js';
import Subscription from '../models/Subscription.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { verifyRazorpayWebhookSignature } from '../utils/validators.js';
import logger from '../utils/logger.js';

/**
 * Razorpay webhook endpoint
 * NOTE: server must receive raw body (express.raw) to verify signature
 */
export const razorpayWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.body; // Buffer from express.raw

  try {
    const ok = verifyRazorpayWebhookSignature(rawBody, signature);
    if (!ok) {
      logger.warn('Invalid webhook signature');
      return res.status(400).send('invalid signature');
    }
  } catch (err) {
    logger.error('Webhook signature verify error', { err: err?.message || err });
    return res.status(400).send('signature verification error');
  }

  let payload;
  try {
    // rawBody is a Buffer — parse it
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    logger.error('Failed to parse webhook payload', { err: err?.message || err });
    return res.status(400).send('invalid payload');
  }

  // handle events of interest
  try {
    const { event, payload: data } = payload;

    // For payment.authorized / payment.captured
    if (event === 'payment.captured' || event === 'payment.authorized' || event === 'payment.failed') {
      const paymentEntity = data && (data.payment || data.entity) ? (data.payment || data.entity) : null;
      if (paymentEntity) {
        const razorpayOrderId = paymentEntity.order_id;
        const razorpayPaymentId = paymentEntity.id;
        const status = paymentEntity.status;

        // find Payment record by razorpayOrderId
        const p = await Payment.findOne({ razorpayOrderId: razorpayOrderId });
        if (p) {
          p.webhookReceived = true;
          p.webhookData = payload;
          p.gatewayResponse = p.gatewayResponse || {};
          p.gatewayResponse.webhook = p.gatewayResponse.webhook || {};
          p.gatewayResponse.webhook[status] = paymentEntity;
          // if captured/authorized then mark completed if not already
          if (status === 'captured' || status === 'authorized') {
            if (p.status !== 'completed') {
              p.razorpayPaymentId = razorpayPaymentId;
              p.status = 'completed';
              p.completedAt = new Date();
            }
          } else if (status === 'failed') {
            p.status = 'failed';
            p.failureReason = `Webhook: payment failed`;
          }
          await p.save();

          // Optionally, if completed and subscription not created, trigger subscription creation
          if (p.status === 'completed' && !p.subscription) {
            // best-effort: create subscription (simple purchase flow)
            try {
              const Subscription = await import('../models/Subscription.js');
              // Keep it simple here: client should call verify flow to finalize subscription
            } catch (err) {
              logger.warn('Failed to do auto-activate via webhook', { err: err?.message || err });
            }
          }
        } else {
          logger.warn('Webhook: no Payment record for order', { razorpayOrderId });
        }
      }
    }

    // respond success
    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    logger.error('Webhook handler error', { err: err?.message || err });
    return res.status(500).send('error processing webhook');
  }
});
