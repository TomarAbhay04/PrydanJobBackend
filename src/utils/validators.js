// src/utils/validator.js
import crypto from 'crypto';

/**
 * Compute HMAC SHA256 hex digest for order|payment using provided secret.
 * @param {string} orderId
 * @param {string} paymentId
 * @param {string} secret
 * @returns {string} hex digest
 */
export const computeRazorpaySignature = (orderId, paymentId, secret) => {
  if (!orderId || !paymentId) throw new Error('orderId and paymentId are required to compute signature');
  if (!secret) throw new Error('secret is required to compute signature');

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${orderId}|${paymentId}`);
  return hmac.digest('hex');
};

/**
 * Verify Razorpay payment signature for a single payment.
 * Returns true if signature matches, false otherwise.
 * Throws if RAZORPAY_KEY_SECRET is missing (server misconfiguration).
 *
 * @param {string} razorpay_order_id
 * @param {string} razorpay_payment_id
 * @param {string} razorpay_signature
 * @returns {boolean}
 */
export const verifyRazorpaySignature = (razorpay_order_id, razorpay_payment_id, razorpay_signature) => {
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return false;

  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    throw new Error('RAZORPAY_KEY_SECRET not set in environment variables');
  }

  const expected = computeRazorpaySignature(razorpay_order_id, razorpay_payment_id, secret);

  // Use timingSafeEqual for constant-time comparison
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(String(razorpay_signature).trim(), 'hex');

  // lengths must match for timingSafeEqual; if not, return false
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

/**
 * Verify Razorpay webhook signature.
 * rawBody must be the exact raw request body buffer (not JSON.stringified).
 * Returns true if signature matches, false otherwise.
 * Throws if RAZORPAY_WEBHOOK_SECRET missing.
 *
 * @param {Buffer|string} rawBody
 * @param {string} signatureHeader - value from 'x-razorpay-signature' header
 * @returns {boolean}
 */
export const verifyRazorpayWebhookSignature = (rawBody, signatureHeader) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('RAZORPAY_WEBHOOK_SECRET not set in environment variables');
  }
  if (!rawBody || !signatureHeader) return false;

  // Ensure raw body is a Buffer
  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const expected = hmac.digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(String(signatureHeader).trim(), 'hex');

  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

export default {
  computeRazorpaySignature,
  verifyRazorpaySignature,
  verifyRazorpayWebhookSignature,
};
