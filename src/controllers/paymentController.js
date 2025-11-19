// src/controllers/paymentController.js
import { getRazorpay } from '../config/razorpay.js';
import Subscription from '../models/Subscription.js';
import Plan from '../models/Plan.js';
import Payment from '../models/Payment.js';
import { verifyRazorpaySignature } from '../utils/validators.js';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';
import mongoose from 'mongoose';
import { generateInvoicePdfBuffer } from '../utils/pdfGenerator.js';
import { sendInvoiceEmail } from '../utils/emailService.js';

/**
 * Create an order (server determines amount from plan)
 * POST /api/payments/create-order
 *
 * Body: { planId, action?: 'purchase'|'renew'|'upgrade', subscriptionId?: string }
 */
export const createOrder = asyncHandler(async (req, res, next) => {
  const { planId, action = 'purchase', subscriptionId } = req.body;

  logger.info('createOrder called', { planId, action, userId: req?.user?._id?.toString?.() ?? null });

  if (!req.user || !req.user._id) return next(new ApiError('Not authenticated', 401));

  const allowedActions = ['purchase', 'renew', 'upgrade'];
  if (!allowedActions.includes(action)) return next(new ApiError('Invalid action', 400));

  if (!planId) return next(new ApiError('planId is required', 400));
  const plan = await Plan.findById(planId);
  if (!plan) return next(new ApiError('Invalid planId', 400));

  const amountPaise = Number(plan.amount);
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    logger.error('Plan amount misconfigured', { planId, amount: plan.amount });
    return next(new ApiError('Server misconfiguration: plan amount invalid', 500));
  }

  let targetSubscription = null;
  if (action === 'renew' || action === 'upgrade') {
    if (!subscriptionId) return next(new ApiError('subscriptionId is required for renew/upgrade', 400));
    if (!mongoose.Types.ObjectId.isValid(subscriptionId)) return next(new ApiError('subscriptionId invalid', 400));
    targetSubscription = await Subscription.findById(subscriptionId);
    if (!targetSubscription) return next(new ApiError('Target subscription not found', 404));
    if (String(targetSubscription.user) !== String(req.user._id)) return next(new ApiError('Target subscription not owned by user', 403));
    // Prevent upgrade to same plan
    if (action === 'upgrade' && String(targetSubscription.plan) === String(plan._id)) {
      return next(new ApiError('Cannot upgrade to the same plan', 400));
    }
  } else {
    // purchase: don't allow purchase if user already has an active subscription for the same plan
    const existingActive = await Subscription.findOne({ user: req.user._id, status: 'active', endDate: { $gt: new Date() } });
    if (existingActive && String(existingActive.plan) === String(plan._id)) {
      return next(new ApiError('You already have an active subscription for this plan. Use renew or upgrade.', 400));
    }
  }

  // create Payment doc
  let payment;
  try {
    payment = await Payment.create({
      user: req.user._id,
      plan: plan._id,
      amount: amountPaise,
      action,
      targetSubscription: targetSubscription ? targetSubscription._id : undefined,
    });
  } catch (err) {
    logger.error('Payment.create failed', { err: err.message });
    return next(new ApiError('Failed to create payment record', 500));
  }

  // create Razorpay order
  const razorpay = getRazorpay();
  const options = {
    amount: amountPaise,
    currency: 'INR',
    receipt: payment.receipt,
    payment_capture: 1,
  };

  let order;
  try {
    order = await razorpay.orders.create(options);
  } catch (err) {
    logger.error('Razorpay order create error', { err: err?.message || err, options });
    try { await payment.markFailed(`Razorpay order creation failed: ${err?.message ?? err}`); } catch (_) {}
    return next(new ApiError('Failed to create Razorpay order', 502));
  }

  payment.razorpayOrderId = order.id;
  await payment.save();

  res.json({
    success: true,
    data: {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID,
      paymentId: payment._id,
    },
  });
});



// export const verifyPayment = asyncHandler(async (req, res, next) => {
//   const { razorpay_order_id, razorpay_payment_id, razorpay_signature, paymentId } = req.body;

//   if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !paymentId) {
//     return next(new ApiError('Missing required fields for verification', 400));
//   }

//   const payment = await Payment.findById(paymentId);
//   if (!payment) return next(new ApiError('Payment record not found', 404));

//   if (payment.razorpayOrderId && payment.razorpayOrderId !== razorpay_order_id) {
//     return next(new ApiError('Order id mismatch', 400));
//   }

//   // Verify signature (existing util)
//   let ok = false;
//   try {
//     ok = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
//   } catch (err) {
//     logger.error('Razorpay signature verify error', { err: err?.message || err });
//     await payment.markFailed('Signature verification error');
//     return next(new ApiError('Payment verification failed', 400));
//   }

//   if (!ok) {
//     await payment.markFailed('Signature verification failed');
//     return next(new ApiError('Payment verification failed', 400));
//   }

//   // Avoid double-processing: if already completed, return existing subscription
//   if (payment.status === 'completed' && payment.subscription) {
//     const existingSub = await Subscription.findById(payment.subscription).populate('plan');
//     return res.json({ success: true, message: 'Payment already processed', data: { payment, subscription: existingSub } });
//   }

//   // mark payment completed
//   try {
//     await payment.markCompleted({
//       razorpayPaymentId: razorpay_payment_id,
//       razorpaySignature: razorpay_signature,
//       gatewayResponse: req.body,
//     });
//   } catch (err) {
//     logger.error('Payment.markCompleted failed', { err: err?.message || err });
//     return next(new ApiError('Failed to finalize payment', 500));
//   }

//   // Load plan (defensive)
//   const plan = await Plan.findById(payment.plan);
//   if (!plan) {
//     logger.error('Plan not found after payment', { planId: payment.plan, paymentId: payment._id });
//     await payment.markFailed('Associated plan not found');
//     return next(new ApiError('Associated plan not found', 500));
//   }

//   const now = new Date();

//   // RETRIEVE user's current active subscription (if any)
//   const existingActive = await Subscription.findOne({ user: payment.user, status: 'active', endDate: { $gt: now } });

//   // Handle renew
//   if (payment.action === 'renew') {
//     const subId = payment.targetSubscription || payment.subscription;
//     const sub = await Subscription.findById(subId);
//     if (!sub) {
//       await payment.markFailed('Target subscription not found for renewal');
//       return next(new ApiError('Target subscription not found for renewal', 400));
//     }

//     // Enforce plan renewLimit (0 = unlimited)
//     const planForSub = await Plan.findById(sub.plan);
//     const renewLimit = planForSub.renewLimit || 0;
//     if (renewLimit > 0) {
//       const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
//       const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
//       const renewCount = await Payment.countDocuments({
//         action: 'renew',
//         targetSubscription: sub._id,
//         status: 'completed',
//         createdAt: { $gte: startOfMonth, $lt: startOfNextMonth },
//       });

//       if (renewCount >= renewLimit) {
//         await payment.markFailed('Renew limit exceeded for this month');
//         return next(new ApiError('You have reached the maximum renewals for this period', 400));
//       }
//     }

//     // extend end date logically
//     const currentEnd = sub.endDate && new Date(sub.endDate) > now ? new Date(sub.endDate) : now;
//     const addDays = Number.isFinite(Number(plan.duration)) ? Number(plan.duration) : 30;
//     sub.endDate = new Date(currentEnd.getTime() + addDays * 24 * 60 * 60 * 1000);

//     sub.billingHistory = sub.billingHistory || [];
//     sub.billingHistory.push({ date: now, amount: payment.amount, paymentId: payment._id, status: 'success' });

//     sub.status = 'active';
//     await sub.save();

//     payment.subscription = sub._id;
//     await payment.save();

//     logger.info('Subscription renewed', { subscriptionId: sub._id.toString(), userId: sub.user.toString() });
//     return res.json({ success: true, message: 'Subscription renewed', data: { subscription: sub } });
//   }

//   // Handle upgrade
//   if (payment.action === 'upgrade') {
//     if (!payment.targetSubscription) {
//       await payment.markFailed('Target subscription missing for upgrade');
//       return next(new ApiError('Target subscription is required for upgrade', 400));
//     }

//     const oldSub = await Subscription.findById(payment.targetSubscription);
//     if (!oldSub) {
//       await payment.markFailed('Old subscription not found for upgrade');
//       return next(new ApiError('Old subscription not found for upgrade', 400));
//     }

//     // Prevent downgrade: check plan priority
//     const oldPlan = await Plan.findById(oldSub.plan);
//     if (!oldPlan) {
//       await payment.markFailed('Old plan not found for upgrade');
//       return next(new ApiError('Old plan not found', 400));
//     }

//     if (oldPlan.priority >= plan.priority) {
//       // oldPlan priority >= new plan priority means this is downgrade or same level
//       await payment.markFailed('Downgrade / same-level upgrade attempted');
//       return next(new ApiError('Cannot downgrade or choose same level plan. Upgrade only to higher plans.', 400));
//     }

//     // expire old subscription
//     oldSub.status = 'expired';
//     await oldSub.save();

//     // create new subscription (start now)
//     const startDate = now;
//     const durationDays = Number.isFinite(Number(plan.duration)) ? Number(plan.duration) : 30;
//     const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

//     const newSub = await Subscription.create({
//       user: payment.user,
//       plan: payment.plan,
//       paymentId: payment._id,
//       status: 'active',
//       startDate,
//       endDate,
//       billingHistory: [{ date: now, amount: payment.amount, paymentId: payment._id, status: 'success' }],
//     });

//     payment.subscription = newSub._id;
//     await payment.save();

//     logger.info('Plan upgraded - new subscription created', { newSubscriptionId: newSub._id.toString(), userId: payment.user.toString() });
//     return res.json({ success: true, message: 'Plan upgraded', data: { subscription: newSub } });
//   }

//   // Default: purchase
//   try {
//     // If user already has an active subscription of the same plan -> block (defensive)
//     if (existingActive && String(existingActive.plan) === String(plan._id)) {
//       await payment.markFailed('User already has an active subscription for this plan');
//       return next(new ApiError('You already have an active subscription for this plan', 400));
//     }

//     const startDate = now;
//     const durationDays = Number.isFinite(Number(plan.duration)) ? Number(plan.duration) : 30;
//     const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

//     const subscription = await Subscription.create({
//       user: payment.user,
//       plan: payment.plan,
//       paymentId: payment._id,
//       status: 'active',
//       startDate,
//       endDate,
//       billingHistory: [{ date: now, amount: payment.amount, paymentId: payment._id, status: 'success' }],
//     });

//     payment.subscription = subscription._id;
//     await payment.save();

//     logger.info('Subscription created after purchase', { subscriptionId: subscription._id.toString(), userId: payment.user.toString() });
//     return res.json({ success: true, message: 'Payment verified and subscription activated', data: { subscription } });
//   } catch (err) {
//     logger.error('Subscription.create failed after payment', { err: err?.message || err });
//     await payment.markFailed('Failed to create subscription after payment');
//     return next(new ApiError('Failed to create subscription after payment', 500));
//   }
// });

export const verifyPayment = asyncHandler(async (req, res, next) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, paymentId } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !paymentId) {
    return next(new ApiError('Missing required fields for verification', 400));
  }

  const payment = await Payment.findById(paymentId);
  if (!payment) return next(new ApiError('Payment record not found', 404));

  if (payment.razorpayOrderId && payment.razorpayOrderId !== razorpay_order_id) {
    return next(new ApiError('Order id mismatch', 400));
  }

  // Verify signature (existing util)
  let ok = false;
  try {
    ok = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
  } catch (err) {
    logger.error('Razorpay signature verify error', { err: err?.message || err });
    await payment.markFailed('Signature verification error');
    return next(new ApiError('Payment verification failed', 400));
  }

  if (!ok) {
    await payment.markFailed('Signature verification failed');
    return next(new ApiError('Payment verification failed', 400));
  }

  // Avoid double-processing: if already completed, return existing subscription
  if (payment.status === 'completed' && payment.subscription) {
    const existingSub = await Subscription.findById(payment.subscription).populate('plan');
    return res.json({ success: true, message: 'Payment already processed', data: { payment, subscription: existingSub } });
  }

  // mark payment completed
  try {
    await payment.markCompleted({
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      gatewayResponse: req.body,
    });
  } catch (err) {
    logger.error('Payment.markCompleted failed', { err: err?.message || err });
    return next(new ApiError('Failed to finalize payment', 500));
  }

  // Load plan (defensive)
  const plan = await Plan.findById(payment.plan);
  if (!plan) {
    logger.error('Plan not found after payment', { planId: payment.plan, paymentId: payment._id });
    await payment.markFailed('Associated plan not found');
    return next(new ApiError('Associated plan not found', 500));
  }

  const now = new Date();

  // RETRIEVE user's current active subscription (if any)
  const existingActive = await Subscription.findOne({ user: payment.user, status: 'active', endDate: { $gt: now } });

  // helper: send a simple transactional email (best-effort, non-blocking)
  const attemptSendSimplePaymentEmail = async (paymentDoc, planDoc) => {
    try {
      // Ensure we have fresh user details
      const userObj = await User.findById(paymentDoc.user).select('name email');
      const to = userObj?.email || (req.user && req.user.email) || '';
      if (!to) {
        logger.warn('No recipient email available for payment notification', { paymentId: paymentDoc._id.toString() });
        return;
      }

      const rupees = ((Number(paymentDoc.amount) || 0) / 100).toFixed(2);
      const dateStr = paymentDoc.completedAt ? new Date(paymentDoc.completedAt).toLocaleString() : new Date().toLocaleString();

      const subject = `Payment received — ${planDoc?.name || 'Subscription'}`;
      const text = [
        `Hi ${userObj?.name || (req.user && req.user.name) || 'Customer'},`,
        '',
        `Thank you for your purchase.`,
        `Plan: ${planDoc?.name || ''}`,
        `Amount: ₹${rupees}`,
        `Date: ${dateStr}`,
        '',
        'We appreciate your support. If you need help, reply to this email.',
        '',
        'Best regards,',
        'The Prydan Team',
      ].join('\n');

      // sendEmail uses process.env.EMAIL_FROM as the "from"
      const info = await sendEmail({ to, subject, text });
      logger.info('Payment notification email sent', { paymentId: paymentDoc._id.toString(), to, messageId: info?.messageId });
    } catch (err) {
      // log but do not fail main flow
      logger.warn('Failed to send simple payment email (best-effort)', { err: err?.message || err, paymentId: paymentDoc._id.toString() });
    }
  };

  // --- BUSINESS LOGIC: renew / upgrade / purchase ---

  // Handle renew
  if (payment.action === 'renew') {
    const subId = payment.targetSubscription || payment.subscription;
    const sub = await Subscription.findById(subId);
    if (!sub) {
      await payment.markFailed('Target subscription not found for renewal');
      return next(new ApiError('Target subscription not found for renewal', 400));
    }

    // Enforce plan renewLimit (0 = unlimited)
    const planForSub = await Plan.findById(sub.plan);
    const renewLimit = planForSub.renewLimit || 0;
    if (renewLimit > 0) {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const renewCount = await Payment.countDocuments({
        action: 'renew',
        targetSubscription: sub._id,
        status: 'completed',
        createdAt: { $gte: startOfMonth, $lt: startOfNextMonth },
      });

      if (renewCount >= renewLimit) {
        await payment.markFailed('Renew limit exceeded for this month');
        return next(new ApiError('You have reached the maximum renewals for this period', 400));
      }
    }

    // extend end date logically
    const currentEnd = sub.endDate && new Date(sub.endDate) > now ? new Date(sub.endDate) : now;
    const addDays = Number.isFinite(Number(plan.duration)) ? Number(plan.duration) : 30;
    sub.endDate = new Date(currentEnd.getTime() + addDays * 24 * 60 * 60 * 1000);

    sub.billingHistory = sub.billingHistory || [];
    sub.billingHistory.push({ date: now, amount: payment.amount, paymentId: payment._id, status: 'success' });

    sub.status = 'active';
    await sub.save();

    payment.subscription = sub._id;
    await payment.save();

    // fire-and-forget email (non-blocking)
    void attemptSendSimplePaymentEmail(payment, planForSub);

    logger.info('Subscription renewed', { subscriptionId: sub._id.toString(), userId: sub.user.toString() });
    return res.json({ success: true, message: 'Subscription renewed', data: { subscription: sub } });
  }

  // Handle upgrade
  if (payment.action === 'upgrade') {
    if (!payment.targetSubscription) {
      await payment.markFailed('Target subscription missing for upgrade');
      return next(new ApiError('Target subscription is required for upgrade', 400));
    }

    const oldSub = await Subscription.findById(payment.targetSubscription);
    if (!oldSub) {
      await payment.markFailed('Old subscription not found for upgrade');
      return next(new ApiError('Old subscription not found for upgrade', 400));
    }

    // Prevent downgrade: check plan priority
    const oldPlan = await Plan.findById(oldSub.plan);
    if (!oldPlan) {
      await payment.markFailed('Old plan not found for upgrade');
      return next(new ApiError('Old plan not found', 400));
    }

    if (oldPlan.priority >= plan.priority) {
      // oldPlan priority >= new plan priority means this is downgrade or same level
      await payment.markFailed('Downgrade / same-level upgrade attempted');
      return next(new ApiError('Cannot downgrade or choose same level plan. Upgrade only to higher plans.', 400));
    }

    // expire old subscription
    oldSub.status = 'expired';
    await oldSub.save();

    // create new subscription (start now)
    const startDate = now;
    const durationDays = Number.isFinite(Number(plan.duration)) ? Number(plan.duration) : 30;
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const newSub = await Subscription.create({
      user: payment.user,
      plan: payment.plan,
      paymentId: payment._id,
      status: 'active',
      startDate,
      endDate,
      billingHistory: [{ date: now, amount: payment.amount, paymentId: payment._id, status: 'success' }],
    });

    payment.subscription = newSub._id;
    await payment.save();

    // fire-and-forget email
    void attemptSendSimplePaymentEmail(payment, plan);

    logger.info('Plan upgraded - new subscription created', { newSubscriptionId: newSub._id.toString(), userId: payment.user.toString() });
    return res.json({ success: true, message: 'Plan upgraded', data: { subscription: newSub } });
  }

  // Default: purchase
  try {
    // If user already has an active subscription of the same plan -> block (defensive)
    if (existingActive && String(existingActive.plan) === String(plan._id)) {
      await payment.markFailed('User already has an active subscription for this plan');
      return next(new ApiError('You already have an active subscription for this plan', 400));
    }

    const startDate = now;
    const durationDays = Number.isFinite(Number(plan.duration)) ? Number(plan.duration) : 30;
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const subscription = await Subscription.create({
      user: payment.user,
      plan: payment.plan,
      paymentId: payment._id,
      status: 'active',
      startDate,
      endDate,
      billingHistory: [{ date: now, amount: payment.amount, paymentId: payment._id, status: 'success' }],
    });

    payment.subscription = subscription._id;
    await payment.save();

    // fire-and-forget email
    void attemptSendSimplePaymentEmail(payment, plan);

    logger.info('Subscription created after purchase', { subscriptionId: subscription._id.toString(), userId: payment.user.toString() });
    return res.json({ success: true, message: 'Payment verified and subscription activated', data: { subscription } });
  } catch (err) {
    logger.error('Subscription.create failed after payment', { err: err?.message || err });
    await payment.markFailed('Failed to create subscription after payment');
    return next(new ApiError('Failed to create subscription after payment', 500));
  }
});



export const getInvoice = asyncHandler(async (req, res, next) => {
  const { paymentId } = req.params;

  if (!paymentId || !mongoose.Types.ObjectId.isValid(paymentId)) {
    return next(new ApiError('Invalid payment id', 400));
  }

  const payment = await Payment.findById(paymentId).populate('user plan');
  if (!payment) return next(new ApiError('Payment not found', 404));

  // Only allow owner or admin to download invoice
  const paymentUserId = payment.user && (payment.user._id || payment.user);
  if (String(paymentUserId) !== String(req.user._id) && req.user.role !== 'admin') {
    return next(new ApiError('Not authorized to access this invoice', 403));
  }

  if (payment.status !== 'completed') {
    return next(new ApiError('Invoice available only for completed payments', 400));
  }

  // Build invoice data for PDF generator
  const invoiceData = {
    invoiceNumber: payment.invoiceNumber || payment.receipt || `INV-${payment._id}`,
    date: payment.completedAt ? payment.completedAt.toISOString() : new Date().toISOString(),
    user: {
      name: (payment.user && payment.user.name) || (req.user && req.user.name) || '',
      email: (payment.user && payment.user.email) || (req.user && req.user.email) || '',
    },
    planName: (payment.plan && payment.plan.name) || '',
    amount: payment.amount, // amount in paise (expected by generator)
    // optional: billingHistory, notes, items, etc.
  };

  // Generate PDF buffer
  let pdfBuffer;
  

    try {
    pdfBuffer = await generateInvoicePdfBuffer(invoiceData);

    // Normalize: accept Buffer or Uint8Array/ArrayBuffer
    if (!Buffer.isBuffer(pdfBuffer)) {
      if (pdfBuffer instanceof Uint8Array) {
        pdfBuffer = Buffer.from(pdfBuffer);
      } else if (pdfBuffer && pdfBuffer.buffer) {
        pdfBuffer = Buffer.from(pdfBuffer.buffer);
      } else {
        throw new Error('PDF generator did not return a Buffer');
      }
    }
  } catch (err) {
    // log full stack and object for debugging
    logger.error('Failed to generate invoice PDF', {
      message: err?.message || String(err),
      stack: err?.stack,
      invoiceData: { invoiceNumber: invoiceData.invoiceNumber, planName: invoiceData.planName, user: invoiceData.user?.email },
      paymentId,
    });
    return next(new ApiError('Failed to generate invoice', 500));
  }

  
  // Save invoiceGeneratedAt & optionally invoiceUrl (best-effort)
  try {
    if (!payment.invoiceGeneratedAt) {
      payment.invoiceGeneratedAt = new Date();
      await payment.save();
    }
  } catch (err) {
    logger.warn('Failed to update payment.invoiceGeneratedAt', { err: err?.message || err, paymentId });
  }

  // Send PDF as attachment
  const filename = `${invoiceData.invoiceNumber}.pdf`;
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Content-Length': pdfBuffer.length,
    'Cache-Control': 'no-store',
  });

  return res.send(pdfBuffer);
});
