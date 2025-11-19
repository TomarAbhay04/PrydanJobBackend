// src/utils/jwt.js
import { generateToken, verifyToken } from './generateToken.js';

/**
 * Send token response with cookie and sanitized user object.
 * - Cookie options: 7 days by default (same as token expiry).
 * - In production we set secure and sameSite accordingly.
 *
 * @param {Object} user - Mongoose user document (can be populated)
 * @param {Number} statusCode
 * @param {Object} res - Express response
 * @param {String} message - optional message
 */
export const sendTokenResponse = (user, statusCode, res, message = 'Success') => {
  // create token
  const token = generateToken(user._id);

  // build cookie options
  const cookieOptions = {
    expires: new Date(Date.now() + (process.env.JWT_COOKIE_EXPIRE_DAYS ? Number(process.env.JWT_COOKIE_EXPIRE_DAYS) : 7) * 24 * 60 * 60 * 1000),
    httpOnly: true,
  };

  // In production prefer secure cookies. If you need cross-site cookies (mobile webviews), set sameSite='none' and secure=true.
  if (process.env.NODE_ENV === 'production') {
    cookieOptions.secure = true;
    // If your front-end is on a different origin and you need cookies to be sent, use 'none' and ensure HTTPS.
    cookieOptions.sameSite = process.env.COOKIE_SAMESITE || 'none';
  } else {
    // Development: avoid strict cross-site restrictions
    cookieOptions.sameSite = process.env.COOKIE_SAMESITE || 'lax';
  }

  // Safely build user object to return (strip sensitive fields if present)
  let userObj = user;
  try {
    userObj = typeof user.toJSON === 'function' ? user.toJSON() : JSON.parse(JSON.stringify(user));
  } catch (e) {
    userObj = { id: user._id, email: user.email, name: user.name, role: user.role };
  }

  // Ensure sensitive fields are not returned
  if (userObj.password) delete userObj.password;
  if (userObj.resetPasswordToken) delete userObj.resetPasswordToken;
  if (userObj.resetPasswordExpire) delete userObj.resetPasswordExpire;
  if (userObj.__v) delete userObj.__v;

  // Send cookie + JSON
  res
    .status(statusCode)
    .cookie('token', token, cookieOptions)
    .json({
      success: true,
      message,
      token,
      user: userObj,
    });
};

export { generateToken, verifyToken };
export default { sendTokenResponse, generateToken, verifyToken };
