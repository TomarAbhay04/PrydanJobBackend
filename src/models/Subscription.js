
// src/models/Subscription.js
import mongoose from 'mongoose';
import logger from '../utils/logger.js';

const subscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true, index: true },
    status: { type: String, enum: ['active', 'expired', 'cancelled', 'pending'], default: 'pending', index: true },
    startDate: { type: Date, required: true, default: Date.now },
    endDate: { type: Date, required: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    cancelledAt: Date,
    cancellationReason: { type: String, trim: true, maxlength: [500, 'Cancellation reason cannot exceed 500 characters'] },
    billingHistory: [
      {
        date: Date,
        amount: Number,
        paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
        status: { type: String, enum: ['success', 'failed'] },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/* Virtuals */
subscriptionSchema.virtual('daysRemaining').get(function () {
  if (!this.endDate || this.status !== 'active') return 0;
  const now = new Date();
  const diff = new Date(this.endDate) - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
});

subscriptionSchema.virtual('isExpired').get(function () {
  if (!this.endDate) return false;
  return new Date() > new Date(this.endDate);
});

subscriptionSchema.virtual('totalDays').get(function () {
  const start = new Date(this.startDate);
  const end = new Date(this.endDate);
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24));
});

/* IMPORTANT: use pre('validate') so endDate exists before validation runs */
subscriptionSchema.pre('validate', async function (next) {
  try {
    // Only set endDate when creating a new subscription (or when endDate missing)
    if (this.isNew && !this.endDate) {
      const Plan = mongoose.model('Plan');
      const plan = await Plan.findById(this.plan).select('duration');
      if (!plan) {
        logger.error('Subscription pre-validate: plan not found; using fallback 30 days', { planId: this.plan });
        this.endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      } else {
        const durationDays = Number.isFinite(Number(plan.duration)) ? Number(plan.duration) : 30;
        const start = this.startDate ? new Date(this.startDate) : new Date();
        this.endDate = new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000);
      }
      if (!this.status) this.status = 'active';
    }

    // If status changed to cancelled, set cancelledAt
    if (this.isModified('status') && this.status === 'cancelled' && !this.cancelledAt) {
      this.cancelledAt = new Date();
    }

    next();
  } catch (err) {
    logger.error('Subscription pre-validate error', { err: err?.message || err });
    next(err);
  }
});

/* Instance methods */
subscriptionSchema.methods.isCurrentlyActive = function () {
  return this.status === 'active' && new Date() <= new Date(this.endDate);
};

subscriptionSchema.methods.cancel = async function (reason) {
  this.status = 'cancelled';
  this.cancelledAt = new Date();
  this.cancellationReason = reason || 'User cancelled';
  return this.save();
};

/* Statics */
subscriptionSchema.statics.findActiveByUser = function (userId) {
  return this.findOne({ user: userId, status: 'active', endDate: { $gt: new Date() } }).populate('plan');
};

// (inside subscriptionSchema.statics)
subscriptionSchema.statics.countRenewsThisMonth = async function (subscriptionId) {
  const Payment = mongoose.model('Payment');
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const q = {
    action: 'renew',
    targetSubscription: subscriptionId,
    status: 'completed',
    createdAt: { $gte: firstDay, $lt: lastDay },
  };
  return Payment.countDocuments(q);
};

subscriptionSchema.statics.findExpiringSoon = function (days = 3) {
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return this.find({ status: 'active', endDate: { $gte: now, $lte: future } }).populate('user plan');
};

subscriptionSchema.statics.expireOldSubscriptions = async function () {
  const now = new Date();
  return this.updateMany({ status: 'active', endDate: { $lt: now } }, { $set: { status: 'expired' } });
};

subscriptionSchema.statics.getUserHistory = function (userId, limit = 10) {
  return this.find({ user: userId }).sort({ createdAt: -1 }).limit(limit).populate('plan');
};

/* Indexes */
subscriptionSchema.index({ user: 1, status: 1 });
subscriptionSchema.index({ endDate: 1, status: 1 });
subscriptionSchema.index({ createdAt: -1 });

const Subscription = mongoose.model('Subscription', subscriptionSchema);
export default Subscription;
