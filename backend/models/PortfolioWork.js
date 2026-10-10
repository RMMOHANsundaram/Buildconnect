const mongoose = require("mongoose");

const portfolioWorkSchema = new mongoose.Schema(
  {
    provider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    taggedCustomer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    taggedBooking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },
    photos: [{ type: String }],
    videos: [{ type: String }],
  },
  { timestamps: true }
);

portfolioWorkSchema.index({ provider: 1, createdAt: -1 });

module.exports = mongoose.model("PortfolioWork", portfolioWorkSchema);
