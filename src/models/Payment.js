
// models/Payment.js
import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
    subscription: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription' },

    // Action: purchase, renew, upgrade
    action: {
      type: String,
      enum: ['purchase', 'renew', 'upgrade'],
      default: 'purchase',
      index: true,
    },

    // If action is renew/upgrade, this points to the subscription being renewed/upgraded
    targetSubscription: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', index: true },

    // amount in paise (integer)
    amount: { type: Number, required: true, min: [0, 'Amount cannot be negative'] },

    // Razorpay fields
    razorpayOrderId: { type: String, sparse: true, index: true },
    razorpayPaymentId: { type: String, sparse: true, index: true },
    razorpaySignature: { type: String, sparse: true },

    // status
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },

    // receipt / invoice
    receipt: { type: String, unique: true, sparse: true },
    invoiceNumber: { type: String, unique: true, sparse: true },
    invoiceUrl: String,
    invoiceGeneratedAt: Date,

    gatewayResponse: { type: mongoose.Schema.Types.Mixed },
    webhookReceived: { type: Boolean, default: false },
    webhookData: { type: mongoose.Schema.Types.Mixed },

    completedAt: Date,
    failureReason: { type: String, maxlength: 500 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/* virtuals */
paymentSchema.virtual('formattedAmount').get(function () {
  const rupees = (this.amount || 0) / 100;
  return `₹${rupees.toFixed(2)}`;
});

paymentSchema.virtual('isSuccessful').get(function () {
  return this.status === 'completed';
});

/* pre-save hooks */
paymentSchema.pre('save', function (next) {
  if (this.isNew && !this.receipt) {
    this.receipt = `RCPT_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  if (this.isModified('status') && this.status === 'completed' && !this.invoiceNumber) {
    const d = new Date();
    const ds = d.toISOString().slice(0, 10).replace(/-/g, '');
    const r = Math.random().toString(36).slice(2, 7).toUpperCase();
    this.invoiceNumber = `INV-${ds}-${r}`;
    this.invoiceGeneratedAt = new Date();
    this.completedAt = new Date();
  }

  next();
});

/* methods */
paymentSchema.methods.markCompleted = async function ({ razorpayPaymentId, razorpaySignature, gatewayResponse } = {}) {
  this.status = 'completed';
  if (razorpayPaymentId) this.razorpayPaymentId = razorpayPaymentId;
  if (razorpaySignature) this.razorpaySignature = razorpaySignature;
  if (gatewayResponse) this.gatewayResponse = gatewayResponse;
  this.completedAt = new Date();
  return this.save();
};

paymentSchema.methods.markFailed = async function (reason) {
  this.status = 'failed';
  this.failureReason = reason || 'Payment failed';
  return this.save();
};

paymentSchema.methods.updateWebhook = async function (payload) {
  this.webhookReceived = true;
  this.webhookData = payload;
  return this.save();
};

/* statics */
paymentSchema.statics.findByRazorpayOrderId = function (orderId) {
  return this.findOne({ razorpayOrderId: orderId });
};

paymentSchema.statics.getUserPayments = function (userId, limit = 10) {
  return this.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('plan subscription');
};

/* useful indexes */
paymentSchema.index({ user: 1, createdAt: -1 });
paymentSchema.index({ status: 1, completedAt: -1 });
paymentSchema.index({ action: 1, targetSubscription: 1, createdAt: 1 });

const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
