
// src/models/Plan.js
import mongoose from 'mongoose';

const ALLOWED_PLAN_NAMES = ['Basic', 'Standard', 'Premium'];

const planSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Plan name is required'],
      unique: true,
      trim: true,
      enum: {
        values: ALLOWED_PLAN_NAMES,
        message: 'Plan name must be Basic, Standard, or Premium',
      },
    },
    // Display price in rupees (e.g., 199)
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    // Amount in paise (integer) used for Razorpay orders (e.g., 19900)
    amount: {
      type: Number,
      required: [true, 'Amount in paise is required'],
      min: [0, 'Amount cannot be negative'],
    },

    // Duration in days.
    duration: {
      type: Number,
      required: [true, 'Duration is required'],
      min: [1, 'Duration must be at least 1 day'],
      default: 30,
    },

    features: [
      {
        type: String,
        trim: true,
      },
    ],

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    razorpayPlanId: {
      type: String,
      sparse: true,
    },

    billingCycle: {
      type: String,
      enum: ['monthly', 'quarterly', 'yearly'],
      default: 'monthly',
    },

    /* New fields to support business rules */
    // priority: higher number = more premium (Basic=1, Standard=2, Premium=3)
    priority: {
      type: Number,
      required: true,
      default: 1,
      index: true,
    },
    // renewLimit: how many renews allowed in a given window (month) before additional renewals blocked.
    renewLimit: {
      type: Number,
      default: 2, // can be overwritten per plan
    },
    // allowDowngrade: whether a user can switch from a higher plan to this plan (defaults false for Basic)
    allowDowngrade: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for display price like "₹199"
planSchema.virtual('formattedPrice').get(function () {
  return `₹${this.price}`;
});

// Default durations by plan name (days)
const DEFAULT_DURATIONS = {
  Basic: 30,      // 1 month
  Standard: 90,   // 3 months
  Premium: 365,   // 12 months
};

// Defaults for new fields by plan name
const DEFAULT_PLAN_META = {
  Basic: { priority: 1, renewLimit: 1, allowDowngrade: false, billingCycle: 'monthly' },
  Standard: { priority: 2, renewLimit: 2, allowDowngrade: false, billingCycle: 'monthly' },
  Premium: { priority: 3, renewLimit: 0, allowDowngrade: true, billingCycle: 'yearly' }, // renewLimit 0 = unlimited
};

planSchema.pre('save', function (next) {
  // default duration
  if (this.name && (!this.duration || this.isNew)) {
    const def = DEFAULT_DURATIONS[this.name];
    if (def) this.duration = def;
  }

  // ensure features array
  if (!Array.isArray(this.features)) {
    this.features = this.features ? [this.features] : [];
  }

  // set default meta when creating
  if (this.name && this.isNew) {
    const meta = DEFAULT_PLAN_META[this.name] || {};
    if (meta.priority && !this.priority) this.priority = meta.priority;
    if (typeof meta.renewLimit !== 'undefined' && !this.renewLimit) this.renewLimit = meta.renewLimit;
    if (typeof meta.allowDowngrade !== 'undefined' && typeof this.allowDowngrade === 'undefined') {
      this.allowDowngrade = meta.allowDowngrade;
    }
    if (meta.billingCycle && !this.billingCycle) this.billingCycle = meta.billingCycle;
  }

  next();
});

// findByNameCI remains
planSchema.statics.findByNameCI = function (name) {
  return this.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
};

planSchema.statics.seedDefaultPlans = async function (customPlans = []) {
  const Plan = this;
  const defaults = {
    Basic: {
      name: 'Basic',
      price: 199,
      amount: 19900,
      duration: DEFAULT_DURATIONS.Basic,
      features: ['Basic support', 'Limited usage', '1 month plan validity'],
      billingCycle: 'monthly',
      priority: 1,
      renewLimit: 1,
      allowDowngrade: false,
    },
    Standard: {
      name: 'Standard',
      price: 499,
      amount: 49900,
      duration: DEFAULT_DURATIONS.Standard,
      features: ['Standard support', 'More usage', 'Analytics', '3 month plan validity'],
      billingCycle: 'monthly',
      priority: 2,
      renewLimit: 2,
      allowDowngrade: false,
    },
    Premium: {
      name: 'Premium',
      price: 999,
      amount: 99900,
      duration: DEFAULT_DURATIONS.Premium,
      features: ['Priority support', 'Unlimited usage', 'Advanced analytics', 'Custom reports', '12 month plan validity'],
      billingCycle: 'yearly',
      priority: 3,
      renewLimit: 0, // 0 = unlimited
      allowDowngrade: true,
    },
  };

  for (const p of customPlans) {
    if (p && p.name && ALLOWED_PLAN_NAMES.includes(p.name)) {
      defaults[p.name] = { ...defaults[p.name], ...p };
    }
  }

  const results = [];
  for (const name of ALLOWED_PLAN_NAMES) {
    const data = defaults[name];
    const existing = await Plan.findOne({ name });
    if (existing) {
      existing.price = data.price;
      existing.amount = data.amount;
      existing.duration = data.duration;
      existing.features = data.features;
      existing.billingCycle = data.billingCycle;
      existing.isActive = data.isActive ?? true;
      existing.priority = data.priority ?? existing.priority;
      existing.renewLimit = typeof data.renewLimit !== 'undefined' ? data.renewLimit : existing.renewLimit;
      existing.allowDowngrade = typeof data.allowDowngrade !== 'undefined' ? data.allowDowngrade : existing.allowDowngrade;
      existing.razorpayPlanId = existing.razorpayPlanId || data.razorpayPlanId || null;
      await existing.save();
      results.push({ action: 'updated', plan: existing });
    } else {
      const created = await Plan.create(data);
      results.push({ action: 'created', plan: created });
    }
  }

  return results;
};

planSchema.index({ name: 1, isActive: 1 });
planSchema.index({ price: 1 });

const Plan = mongoose.model('Plan', planSchema);
export default Plan;
