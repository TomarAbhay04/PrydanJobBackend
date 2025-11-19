// src/controllers/subscriptionController.js
import Subscription from '../models/Subscription.js';
import Payment from '../models/Payment.js';
import Plan from '../models/Plan.js';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * @desc    Activate subscription after successful payment (protected)
 * @route   POST /api/subscriptions/activate
 * @access  Private
 *
 * Expected body: { paymentId, planId }
 * If the payment was already used to create a subscription, returns existing subscription.
 */
export const activate = asyncHandler(async (req, res, next) => {
  const { paymentId, planId } = req.body;

  if (!paymentId || !planId) return next(new ApiError('paymentId and planId are required', 400));

  // Validate payment
  const payment = await Payment.findById(paymentId);
  if (!payment) return next(new ApiError('Payment record not found', 404));
  if (payment.status !== 'completed') return next(new ApiError('Payment is not completed', 400));

  // Validate plan
  const plan = await Plan.findById(planId);
  if (!plan) return next(new ApiError('Plan not found', 404));

  // Ensure payment belongs to requesting user (security)
  if (String(payment.user) !== String(req.user._id)) {
    return next(new ApiError('Payment does not belong to the authenticated user', 403));
  }

  // If payment already has subscription, return it
  if (payment.subscription) {
    const existingSub = await Subscription.findById(payment.subscription).populate('plan');
    return res.status(200).json({ success: true, data: existingSub });
  }

  // Create subscription (pre-save will set endDate using plan.duration)
  const subscription = await Subscription.create({
    user: payment.user,
    plan: plan._id,
    paymentId: payment._id,
    status: 'active',
    startDate: new Date(),
  });

  // link subscription back to payment
  payment.subscription = subscription._id;
  await payment.save();

  logger.info(`Subscription activated for user ${payment.user} on plan ${plan.name}`);
  res.status(201).json({ success: true, data: subscription });
});

/**
 * @desc    Get current user's active subscription
 * @route   GET /api/subscriptions/me
 * @access  Private
 */
export const getMySubscription = asyncHandler(async (req, res, next) => {
  const sub = await Subscription.findActiveByUser(req.user._id);
  res.status(200).json({ success: true, data: sub || null });
});

/**
 * @desc    Cancel user's subscription (simple cancel)
 * @route   POST /api/subscriptions/:id/cancel
 * @access  Private
 */
export const cancelSubscription = asyncHandler(async (req, res, next) => {
  const sub = await Subscription.findById(req.params.id);
  if (!sub) return next(new ApiError('Subscription not found', 404));

  // Only owner or admin can cancel
  if (String(sub.user) !== String(req.user._id) && req.user.role !== 'admin') {
    return next(new ApiError('Not authorized to cancel this subscription', 403));
  }

  if (sub.status === 'cancelled') {
    return res.status(200).json({ success: true, message: 'Subscription already cancelled' });
  }

  sub.status = 'cancelled';
  await sub.save();

  logger.info(`Subscription cancelled: ${sub._id} by user ${req.user._id}`);
  res.status(200).json({ success: true, message: 'Subscription cancelled' });
});

/**
 * @desc    Admin: list subscriptions with basic filters
 * @route   GET /api/subscriptions
 * @access  Admin
 *
 * Query params: status, planId, userId, page, limit
 */
export const adminList = asyncHandler(async (req, res) => {
  const { status, planId, userId, page = 1, limit = 20 } = req.query;
  const q = {};

  if (status) q.status = status;
  if (planId) q.plan = planId;
  if (userId) q.user = userId;

  const skip = (Math.max(1, Number(page)) - 1) * Number(limit);
  const subs = await Subscription.find(q)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit))
    .populate('user plan');

  const total = await Subscription.countDocuments(q);
  res.status(200).json({
    success: true,
    data: subs,
    meta: { total, page: Number(page), limit: Number(limit) },
  });
});
