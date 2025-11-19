
// src/controllers/authController.js
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import Payment from '../models/Payment.js';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import { sendTokenResponse } from '../utils/jwt.js';
import logger from '../utils/logger.js';

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 * @access  Public
 */
export const register = asyncHandler(async (req, res, next) => {
  const { name, email, password } = req.body;

  // Basic presence checks (detailed validation should be handled by validation middleware)
  if (!name || !email || !password) {
    return next(new ApiError('Name, email and password are required', 400));
  }

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return next(new ApiError('User with this email already exists', 400));
  }

  // Create user
  const user = await User.create({ name, email, password });

  logger.info(`New user registered: ${email}`);

  // Send token response (sets cookie and returns token + user)
  sendTokenResponse(user, 201, res, 'User registered successfully');
});

/**
 * @desc    Login user
 * @route   POST /api/auth/login
 * @access  Public
 */
export const login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new ApiError('Email and password are required', 400));
  }

  // Find user and include password for comparison
  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    return next(new ApiError('Invalid credentials', 401));
  }

  // Check if user is active
  if (!user.isActive) {
    return next(new ApiError('Your account has been deactivated', 403));
  }

  // Check password
  const isPasswordMatch = await user.comparePassword(password);
  if (!isPasswordMatch) {
    return next(new ApiError('Invalid credentials', 401));
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save();

  // Run quick expiry sweep (keeps subscription state fresh on login)
  try {
    await Subscription.expireOldSubscriptions();
  } catch (err) {
    logger.warn('Subscription expiry run failed during login', { err: err?.message || err });
    // not fatal for login — continue
  }

  logger.info(`User logged in: ${email}`);

  // Send token response
  sendTokenResponse(user, 200, res, 'Login successful');
});

/**
 * @desc    Get current logged in user + active subscription + recent payments
 * @route   GET /api/auth/me
 * @access  Private
 */
export const getMe = asyncHandler(async (req, res, next) => {
  // req.user is set by auth middleware (protect)
  if (!req.user || !req.user._id) {
    return next(new ApiError('Not authenticated', 401));
  }

  // Fetch fresh user document (so we have latest fields) and don't include password
  const user = await User.findById(req.user._id).select('-password');
  if (!user) return next(new ApiError('User not found', 404));

  // Ensure subscriptions that expired are marked expired
  try {
    await Subscription.expireOldSubscriptions();
  } catch (err) {
    logger.warn('Subscription expiry run failed during getMe', { err: err?.message || err });
  }

  // Load active subscription (populates plan)
  const activeSubscription = await Subscription.findActiveByUser(user._id);

  // Get recent payments (completed + pending) for dashboard
  const payments = await Payment.getUserPayments(user._id, 20);

  res.status(200).json({
    success: true,
    data: {
      user,
      activeSubscription: activeSubscription || null,
      payments,
    },
  });
});

/**
 * @desc    Update user profile (name, email)
 * @route   PUT /api/auth/profile
 * @access  Private
 */
export const updateProfile = asyncHandler(async (req, res, next) => {
  const { name, email } = req.body;

  if (!req.user || !req.user._id) {
    return next(new ApiError('Not authenticated', 401));
  }

  const updates = {};
  if (name) updates.name = name;
  if (email) {
    // Ensure email not taken by another user
    const existingUser = await User.findOne({ email });
    if (existingUser && existingUser._id.toString() !== req.user._id.toString()) {
      return next(new ApiError('Email already in use', 400));
    }
    updates.email = email;
  }

  const updatedUser = await User.findByIdAndUpdate(req.user._id, updates, {
    new: true,
    runValidators: true,
  }).select('-password');

  logger.info(`User profile updated: ${updatedUser.email}`);

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    data: updatedUser,
  });
});

/**
 * @desc    Update password
 * @route   PUT /api/auth/password
 * @access  Private
 */
export const updatePassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return next(new ApiError('Please provide current and new password', 400));
  }

  if (!req.user || !req.user._id) {
    return next(new ApiError('Not authenticated', 401));
  }

  // Get user with password
  const user = await User.findById(req.user._id).select('+password');
  if (!user) return next(new ApiError('User not found', 404));

  // Check current password
  const isPasswordMatch = await user.comparePassword(currentPassword);
  if (!isPasswordMatch) {
    return next(new ApiError('Current password is incorrect', 401));
  }

  // Update password (pre-save hook will hash it)
  user.password = newPassword;
  await user.save();

  logger.info(`Password updated for user: ${user.email}`);

  // Send token response with new token (optional)
  sendTokenResponse(user, 200, res, 'Password updated successfully');
});

/**
 * @desc    Logout user / clear cookie
 * @route   POST /api/auth/logout
 * @access  Private
 */
export const logout = asyncHandler(async (req, res, next) => {
  const cookieOptions = {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  };

  // In production use secure cookies (HTTPS)
  if (process.env.NODE_ENV === 'production') {
    cookieOptions.secure = true;
    cookieOptions.sameSite = 'none';
  }

  res.cookie('token', 'none', cookieOptions);

  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
});
