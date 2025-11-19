
// src/controllers/planController.js
import Plan from '../models/Plan.js';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';

/**
 * Get all active plans (public)
 * GET /api/plans
 */
export const getPlans = asyncHandler(async (req, res) => {
  const plans = await Plan.find({ isActive: true }).sort({ amount: 1 });
  res.status(200).json({ success: true, data: plans });
});

/**
 * Get plan by id (public)
 * GET /api/plans/:id
 */
export const getPlanById = asyncHandler(async (req, res, next) => {
  const plan = await Plan.findById(req.params.id);
  if (!plan) return next(new ApiError('Plan not found', 404));
  res.status(200).json({ success: true, data: plan });
});
  