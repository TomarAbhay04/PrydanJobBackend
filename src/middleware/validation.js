
// src/middleware/validation.js
import { body, param, validationResult } from 'express-validator';
import mongoose from 'mongoose';

/**
 * Central validation result handler.
 * Use this as the last middleware in your validation arrays.
 */
export const checkValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  const extractedErrors = errors.array().map(err => ({
    param: err.param,
    msg: err.msg,
  }));

  return res.status(400).json({
    success: false,
    message: 'Validation failed',
    errors: extractedErrors,
  });
};

/**
 * Helper validator to check Mongoose ObjectId params
 * Usage: router.get('/:id', validateObjectId('id'), handler)
 */
export const validateObjectId = (paramName = 'id') => {
  return [
    param(paramName)
      .custom((value) => mongoose.Types.ObjectId.isValid(value))
      .withMessage(`${paramName} must be a valid ObjectId`),
    checkValidation,
  ];
};

/* -----------------------
   Auth / User Validators
   ----------------------- */

export const validateSignup = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  checkValidation,
];

export const validateLogin = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required'),
  checkValidation,
];

/* -----------------------
   Plan Validators (admin)
   ----------------------- */

export const validatePlan = [
  body('name')
    .trim()
    .notEmpty().withMessage('Plan name is required')
    .isIn(['Basic', 'Standard', 'Premium']).withMessage('Plan name must be Basic, Standard or Premium'),
  body('price')
    .notEmpty().withMessage('Price is required (in rupees)')
    .isFloat({ min: 0 }).withMessage('Price must be a non-negative number')
    .toFloat(),
  body('amount')
    .notEmpty().withMessage('Amount is required (in paise)')
    .isInt({ min: 0 }).withMessage('Amount must be an integer (paise)')
    .toInt(),
  body('duration')
    .optional()
    .isInt({ min: 1 }).withMessage('Duration must be at least 1 day')
    .toInt(),
  body('features')
    .optional()
    .isArray().withMessage('Features must be an array of strings'),
  checkValidation,
];

/* -----------------------
   Payment Validators
   ----------------------- */

/**
 * Create payment (order) validator
 * Body: { planId, action?, subscriptionId? }
 * - server computes amount
 * - action optional: 'purchase' (default) | 'renew' | 'upgrade'
 * - if action is 'renew' or 'upgrade', subscriptionId is required and must be a valid ObjectId
 */
export const validateCreatePayment = [
  body('planId')
    .notEmpty().withMessage('planId is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value)).withMessage('planId must be a valid ObjectId'),

  body('action')
    .optional()
    .isIn(['purchase', 'renew', 'upgrade']).withMessage('action must be purchase, renew or upgrade'),

  // conditional subscriptionId: required (valid ObjectId) when action is renew/upgrade
  body('subscriptionId')
    .optional()
    .custom((value, { req }) => {
      const action = (req.body && req.body.action) || 'purchase';
      if (action === 'renew' || action === 'upgrade') {
        if (!value) throw new Error('subscriptionId is required when action is renew or upgrade');
        if (!mongoose.Types.ObjectId.isValid(value)) throw new Error('subscriptionId must be a valid ObjectId');
      }
      // if action is purchase and subscriptionId present, still validate ObjectId
      if (value && !mongoose.Types.ObjectId.isValid(value)) throw new Error('subscriptionId must be a valid ObjectId');
      return true;
    }),
  checkValidation,
];

/**
 * Verify payment validator (used when client posts Razorpay payment info)
 * Expected fields from client: razorpay_payment_id, razorpay_order_id, razorpay_signature, paymentId
 */
export const validateVerifyPayment = [
  body('razorpay_payment_id')
    .notEmpty().withMessage('razorpay_payment_id is required'),
  body('razorpay_order_id')
    .notEmpty().withMessage('razorpay_order_id is required'),
  body('razorpay_signature')
    .notEmpty().withMessage('razorpay_signature is required'),
  body('paymentId')
    .notEmpty().withMessage('paymentId is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value)).withMessage('paymentId must be a valid ObjectId'),
  checkValidation,
];

/* -----------------------
   Subscription Validators
   ----------------------- */

export const validateActivateSubscription = [
  body('paymentId')
    .notEmpty().withMessage('paymentId is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value)).withMessage('paymentId must be a valid ObjectId'),
  body('planId')
    .notEmpty().withMessage('planId is required')
    .custom((value) => mongoose.Types.ObjectId.isValid(value)).withMessage('planId must be a valid ObjectId'),
  checkValidation,
];

/* -----------------------
   Misc helpers
   ----------------------- */

export const validateOptionalEmail = [
  body('email')
    .optional()
    .trim()
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail(),
  checkValidation,
];

export default {
  checkValidation,
  validateObjectId,
  validateSignup,
  validateLogin,
  validatePlan,
  validateCreatePayment,
  validateVerifyPayment,
  validateActivateSubscription,
  validateOptionalEmail,
};
