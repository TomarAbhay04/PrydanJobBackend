// src/utils/generateToken.js
import jwt from 'jsonwebtoken';

/**
 * Generate a JWT for a user id.
 * @param {String|ObjectId} userId
 * @param {String} expiresIn - e.g. '7d' or '1h' (defaults to env JWT_EXPIRE or '7d')
 * @returns {String} JWT token
 */
export const generateToken = (userId, expiresIn = process.env.JWT_EXPIRE || '7d') => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables');
  }
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn });
};

/**
 * Verify a JWT and return the decoded payload (throws on invalid/expired).
 * @param {String} token
 * @returns {Object} decoded payload
 */
export const verifyToken = (token) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables');
  }
  return jwt.verify(token, process.env.JWT_SECRET);
};

export default { generateToken, verifyToken };
