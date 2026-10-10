const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  provider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  service: { type: mongoose.Schema.Types.ObjectId, ref: "Service" },
  package: { type: mongoose.Schema.Types.ObjectId, ref: "Package" },
  isCustomQuote: { type: Boolean, default: false },
  customCategory: { type: String, trim: true, maxlength: 100 },
  date: { type: Date, required: true },
  endDate: { type: Date },
  time: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  address: { type: String, required: true, trim: true, minlength: 3, maxlength: 500 },
  requirements: { type: String, trim: true, default: "", maxlength: 2000 },
  price: { type: Number, min: 0, default: 0 },
  materials: [{
    name: { type: String, required: true, trim: true },
    cost: { type: Number, required: true, min: 0 }
  }],
  status: { type: String, enum: ["PENDING", "ACCEPTED", "ESTIMATE_PROVIDED", "IN_PROGRESS", "COMPLETED", "REJECTED", "CANCELLED"], default: "PENDING" },
  paymentStatus: { type: String, enum: ["UNPAID", "PAID"], default: "UNPAID" },
  // Lifecycle timeline — stamped as the provider moves the booking forward.
  // These are what the customer sees in "when it was accepted / started / finished".
  acceptedAt: { type: Date },
  startedAt: { type: Date },
  completedAt: { type: Date },
  cancelledAt: { type: Date },
  // Bill / invoice metadata (the PDF is rendered on demand from this record).
  invoiceNumber: { type: String, trim: true, unique: true, sparse: true },
  invoiceGeneratedAt: { type: Date },
  // Delivery log so a failed email/WhatsApp can be retried and audited.
  notifications: [{
    channel: { type: String, enum: ["email", "whatsapp", "sms"], required: true },
    event: { type: String, required: true },
    status: { type: String, enum: ["SENT", "FAILED", "SKIPPED"], required: true },
    detail: { type: String, trim: true, default: "" },
    sentAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

module.exports = mongoose.model("Booking", bookingSchema);
