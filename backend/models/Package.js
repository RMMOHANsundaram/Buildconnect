const mongoose = require("mongoose");

const allowedCategories = ["Plumbing", "Electrical", "Painting", "Carpentry"];

const packageSchema = new mongoose.Schema({
  provider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 160 },
  category: { type: String, enum: allowedCategories, required: true },
  description: { type: String, required: true, trim: true, minlength: 10, maxlength: 2000 },
  price: { type: Number, required: true, min: 0.01 },
  duration: { type: String, required: true, trim: true, maxlength: 120 },
  includes: [{ type: String, trim: true, maxlength: 300 }],
  helpers: [{ name: { type: String, trim: true, maxlength: 120 }, role: { type: String, trim: true, maxlength: 120 }, phone: { type: String, trim: true, maxlength: 40 } }],
  availability: { type: Boolean, default: true },
  images: [{ type: String, trim: true }],
  rating: { type: Number, default: 0, min: 0, max: 5 },
  bookingsCount: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model("Package", packageSchema);
