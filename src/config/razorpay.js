
// // src/config/razorpay.js
// import Razorpay from 'razorpay';
// import logger from '../utils/logger.js';

// let instance = null;

// /**
//  * Validate that Razorpay-related env vars exist.
//  * Throws if missing so server startup can fail fast.
//  */
// export const validateRazorpayConfig = () => {
//   const id = process.env.RAZORPAY_KEY_ID;
//   const secret = process.env.RAZORPAY_KEY_SECRET;

//   if (!id || !secret) {
//     logger.error('Razorpay configuration missing: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set');
//     throw new Error('Razorpay configuration missing. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env');
//   }

//   logger.info('Razorpay config validated');
// };

// /**
//  * Lazily create and return Razorpay instance.
//  * Call this only after dotenv.config() has run (i.e., at runtime in server code or controllers).
//  */
// export const getRazorpay = () => {
//   if (instance) return instance;

//   // Double-check config
//   validateRazorpayConfig();

//   instance = new Razorpay({
//     key_id: process.env.RAZORPAY_KEY_ID,
//     key_secret: process.env.RAZORPAY_KEY_SECRET,
//   });

//   logger.info('Razorpay client initialized');
//   return instance;
// };

// export default { getRazorpay, validateRazorpayConfig };






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





