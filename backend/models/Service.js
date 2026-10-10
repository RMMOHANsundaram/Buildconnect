const mongoose = require("mongoose");

const tamilNaduCities = ["Ariyalur", "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore", "Dharmapuri", "Dindigul", "Erode", "Kallakurichi", "Kanchipuram", "Kanyakumari", "Karur", "Krishnagiri", "Madurai", "Mayiladuthurai", "Nagapattinam", "Namakkal", "Nilgiris", "Perambalur", "Pudukkottai", "Ramanathapuram", "Ranipet", "Salem", "Sivaganga", "Tenkasi", "Thanjavur", "Theni", "Thoothukudi", "Tiruchirappalli", "Trichy", "Tirunelveli", "Tirupathur", "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur", "Vellore", "Viluppuram", "Virudhunagar"];

const serviceSchema = new mongoose.Schema({
  provider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  category: { type: String, enum: ["Plumbing", "Electrical", "Painting", "Carpentry"], required: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0.01 },
  hourlyRate: { type: Number, min: 0 },
  city: { type: String, required: true, trim: true },
  availability: { type: Boolean, default: true },
  rating: { type: Number, default: 0, min: 0, max: 5 },
  experience: { type: Number, default: 0, min: 0 },
  images: [{ type: String, trim: true }],
  bookingsCount: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model("Service", serviceSchema);
