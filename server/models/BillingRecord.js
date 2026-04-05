const mongoose = require("mongoose");

const billingRecordSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    plan: {
      type: String,
      default: "pro"
    },
    amount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      default: "USD"
    },
    method: {
      type: String,
      enum: ["upi", "razorpay", "stripe"],
      required: true
    },
    status: {
      type: String,
      enum: ["paid", "failed", "pending"],
      default: "paid"
    },
    billingName: {
      type: String,
      required: true
    },
    billingEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    transactionRef: {
      type: String,
      default: ""
    },
    meta: {
      type: Object,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("BillingRecord", billingRecordSchema);
