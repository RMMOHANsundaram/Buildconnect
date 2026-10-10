const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  provider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  amount: { type: Number, required: true, min: 1 },
  currency: { type: String, default: "INR" },
  razorpayOrderId: { type: String, required: true },
  razorpayPaymentId: { type: String, default: "" },
  razorpaySignature: { type: String, default: "" },
  status: { type: String, enum: ["CREATED", "PAID", "FAILED", "REFUNDED"], default: "CREATED" },
  paidAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model("Payment", paymentSchema);
