const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { OAuth2Client } = require("google-auth-library");
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const publicUser = (user) => ({
  id: user._id,
  _id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  city: user.city,
  trade: user.trade,
  role: user.role,
  profileImage: user.profileImage,
  availability: user.availability,
  isApproved: user.isApproved,
  storeName: user.storeName,
  addressLine1: user.addressLine1,
  addressLine2: user.addressLine2,
  state: user.state,
  pincode: user.pincode,
  country: user.country,
  theme: user.theme,
  rating: user.rating,
});


// Generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
};


// ==========================
// REGISTER USER
// ==========================
const register = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      city,
      trade,
      role,
      storeName,
      addressLine1,
      addressLine2,
      state,
      pincode,
      country,
    } = req.body;

    const normalizedEmail = email?.trim().toLowerCase();

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Name, email and password are required",
      });
    }

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      return res.status(400).json({ message: "Please provide a valid email" });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }

    const allowedRoles = ["customer", "provider"];
    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({ message: "Invalid registration role" });
    }

    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(400).json({
        message: "User already exists",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userRole = role || "customer";
    const user = await User.create({
      name,
      email: normalizedEmail,
      password: hashedPassword,
      phone: phone || "",
      ...(city ? { city } : {}),
      trade: trade || "",
      role: userRole,
      storeName: storeName || "",
      addressLine1: addressLine1 || "",
      addressLine2: addressLine2 || "",
      state: state || "",
      pincode: pincode || "",
      ...(country ? { country } : {}),
      isApproved: userRole !== "provider",
    });

    // Generate token
    const token = generateToken(user);

    res.status(201).json({
      message: "Registration successful",
      token,
      user: publicUser(user),
    });

  } catch (error) {
    console.error("Registration error:", error);

    res.status(500).json({
      message: "Server error",
    });
  }
};


// ==========================
// LOGIN USER
// ==========================
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    if (!/^\S+@\S+\.\S+$/.test(email.trim().toLowerCase())) {
      return res.status(400).json({ message: "Please provide a valid email" });
    }

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    }).select("+password");

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    if (!user.isApproved) {
      return res.status(403).json({
        message: "Your account is pending admin approval.",
      });
    }

    // Check password
    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatch) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    // Generate token
    const token = generateToken(user);

    res.status(200).json({
      message: "Login successful",
      token,
      user: publicUser(user),
    });

  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      message: "Server error",
    });
  }
};


const googleLogin = async (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ message: "Google sign-in is not configured" });
    const ticket = await googleClient.verifyIdToken({ idToken: req.body.credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || !payload.email_verified) return res.status(401).json({ message: "Google account could not be verified" });
    const role = ["customer", "provider"].includes(req.body.role) ? req.body.role : "customer";
    let user = await User.findOne({ $or: [{ googleId: payload.sub }, { email: payload.email.toLowerCase() }] }).select("+password");
    if (!user) user = await User.create({ name: payload.name || payload.email.split("@")[0], email: payload.email.toLowerCase(), password: await bcrypt.hash(`${payload.sub}:${process.env.JWT_SECRET}`, 10), googleId: payload.sub, profileImage: payload.picture || "", role });
    else if (!user.googleId) { user.googleId = payload.sub; if (payload.picture && !user.profileImage) user.profileImage = payload.picture; await user.save(); }
    return res.json({ message: "Google sign-in successful", token: generateToken(user), user: publicUser(user) });
  } catch (error) {
    return res.status(401).json({ message: "Google sign-in failed" });
  }
};

module.exports = {
  register,
  login,
  googleLogin,
};