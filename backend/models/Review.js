const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  provider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  service: { type: mongoose.Schema.Types.ObjectId, ref: "Service" },
  package: { type: mongoose.Schema.Types.ObjectId, ref: "Package" },
  booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, unique: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true, trim: true },
  photos: [{ type: String }],
  videos: [{ type: String }],
}, { timestamps: true });

reviewSchema.index({ provider: 1, createdAt: -1 });
reviewSchema.index({ service: 1, createdAt: -1 });
reviewSchema.index({ package: 1, createdAt: -1 });

module.exports = mongoose.model("Review", reviewSchema);
