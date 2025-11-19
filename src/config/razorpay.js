

// src/config/razorpay.js
import Razorpay from 'razorpay';
import logger from '../utils/logger.js';

let instance = null;

export const validateRazorpayConfig = () => {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) {
    logger.error('Razorpay keys missing in environment');
    throw new Error('Razorpay configuration missing. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env');
  }
  logger.info('Razorpay config validated');
};

export const getRazorpay = () => {
  if (instance) return instance;
  validateRazorpayConfig();
  instance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
  logger.info('Razorpay client initialized');
  return instance;
};

export default { getRazorpay, validateRazorpayConfig };





