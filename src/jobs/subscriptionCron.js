// src/jobs/subscriptionCron.js
import cron from 'node-cron';
import Subscription from '../models/Subscription.js';
import logger from '../utils/logger.js';

const job = cron.schedule('0 2 * * *', async () => {
  // runs daily at 02:00 server time
  try {
    const result = await Subscription.expireOldSubscriptions();
    logger.info('subscriptionCron: expireOldSubscriptions result', { result });
  } catch (err) {
    logger.error('subscriptionCron error', { err: err?.message || err });
  }
}, { scheduled: false });

export default {
  start: () => job.start(),
  stop: () => job.stop(),
};
