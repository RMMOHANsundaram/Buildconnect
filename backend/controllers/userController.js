const bcrypt = require("bcryptjs");
const User = require("../models/User");

const profile = (user) => ({ id: user._id, _id: user._id, name: user.name, email: user.email, phone: user.phone, city: user.city, trade: user.trade, role: user.role, profileImage: user.profileImage, availability: user.availability, storeName: user.storeName, addressLine1: user.addressLine1, addressLine2: user.addressLine2, state: user.state, pincode: user.pincode, country: user.country, theme: user.theme, communicationPreferences: user.communicationPreferences, rating: user.rating });
const getProfile = async (req, res) => res.json(profile(req.user));
const updateProfile = async (req, res) => { try { const allowed = ["name", "phone", "city", "trade", "profileImage", "availability", "storeName", "addressLine1", "addressLine2", "state", "pincode", "country", "theme", "communicationPreferences"]; const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key))); if (updates.name !== undefined && !String(updates.name).trim()) return res.status(400).json({ message: "Name is required" }); const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true }); return res.json(profile(user)); } catch (error) { return res.status(400).json({ message: error.message }); } };
const changePassword = async (req, res) => { try { const { currentPassword, newPassword } = req.body; if (!currentPassword || !newPassword || newPassword.length < 8) return res.status(400).json({ message: "Current password and a new password of at least 8 characters are required" }); const user = await User.findById(req.user._id).select("+password"); if (!(await bcrypt.compare(currentPassword, user.password))) return res.status(401).json({ message: "Current password is incorrect" }); user.password = await bcrypt.hash(newPassword, 10); await user.save(); return res.json({ message: "Password changed successfully" }); } catch (error) { return res.status(500).json({ message: "Unable to change password" }); } };
const getProviders = async (req, res) => {
  try {
    const providers = await User.find({ role: "provider", isApproved: true })
      .select("-password")
      .sort({ createdAt: -1 });
    return res.json(providers);
  } catch (error) {
    return res.status(500).json({ message: "Unable to load providers" });
  }
};

module.exports = { getProfile, updateProfile, changePassword, getProviders };
