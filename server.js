
// server.js
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import connectDB from './src/config/database.js';
import { validateRazorpayConfig } from './src/config/razorpay.js';
import Plan from './src/models/Plan.js';
import { errorHandler, notFound } from './src/middleware/errorHandler.js';
import logger from './src/utils/logger.js';

// Import routes
import authRoutes from './src/routes/authRoutes.js';
import planRoutes from './src/routes/planRoutes.js';
import paymentRoutes from './src/routes/paymentRoutes.js';
import subscriptionRoutes from './src/routes/subscriptionRoutes.js';

// Webhook route (must receive raw body)
import webhookRoutes from './src/routes/webhookRoutes.js';

// Cron job (subscription expiry) — corrected path to jobs (you have jobs folder)
import subscriptionCron from './src/jobs/subscriptionCron.js';

const app = express();

/**
 * Middlewares (mounted before routes)
 */
app.use(helmet());

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  })
);

app.use('/', (req,res)=>{
  res.send('Subscription Management backend is running is running....')
});
// For webhook route we need raw body to verify signature. Mount raw-body middleware for that path only.
app.use('/api/payments/webhook', express.raw({ type: '*/*' }));

// Regular JSON / urlencoded parsers for the rest of the API
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many authentication attempts, please try again later.',
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

/**
 * Health
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Mount routes
 *
 * Note:
 * - webhookRoutes is mounted at /api/payments/webhook and expects the raw body (set above)
 * - paymentRoutes remains mounted at /api/payments for normal JSON endpoints like /create-order and /verify
 */


app.use('/api/auth', authRoutes);
app.use('/api/plans', planRoutes);

// Webhook route: the raw middleware above applies to this path.
app.use('/api/payments/webhook', webhookRoutes);

// Normal payment routes (JSON)
app.use('/api/payments', paymentRoutes);

app.use('/api/subscriptions', subscriptionRoutes);

// 404 and error handler (order matters)
app.use(notFound);
app.use(errorHandler);

/**
 * Start-up sequence: connect DB -> validate razorpay -> seed plans -> start server
 */
const start = async () => {
  try {
    // 1) Connect DB (dotenv already loaded)
    await connectDB();

    // 2) Validate Razorpay config (will throw if keys missing)
    validateRazorpayConfig();

    // 3) Seed fixed plans (idempotent)
    try {
      const seedResult = await Plan.seedDefaultPlans();
      logger.info('Plan seeder result', { seedResult });
    } catch (err) {
      logger.error('Plan seeding failed', err);
      // Not fatal — continue
    }

    // 4) Start server
    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, () => {
      logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
    });

    // 5) Start subscription cron (non-blocking)
    try {
      if (subscriptionCron && typeof subscriptionCron.start === 'function') {
        subscriptionCron.start();
        logger.info('Subscription cron started');
      } else {
        logger.warn('Subscription cron not available or missing start()');
      }
    } catch (err) {
      logger.warn('Subscription cron failed to start', { err: err?.message || err });
    }

    // 6) Graceful shutdown & global error handling
    process.on('unhandledRejection', (err) => {
      logger.error(`Unhandled Rejection: ${err?.message ?? err}`);
      server.close(() => process.exit(1));
    });

    process.on('uncaughtException', (err) => {
      logger.error(`Uncaught Exception: ${err?.message ?? err}`);
      process.exit(1);
    });

    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully');
      server.close(() => {
        logger.info('Process terminated');
      });
    });
  } catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
  }
};

start();

export default app;
