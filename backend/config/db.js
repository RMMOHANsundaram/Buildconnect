const mongoose = require('mongoose');
const dns = require('dns');

// Fix for querySrv ECONNREFUSED issues on local WiFi / ISP DNS
try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (e) {
  // Ignore if unsupported
}

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) throw new Error("MONGODB_URI is not configured in .env");
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 8000,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    if (error.message && error.message.includes("IP")) {
      console.error('HINT: Check if your current IP address is whitelisted in MongoDB Atlas Network Access (0.0.0.0/0).');
    }
  }
};

module.exports = connectDB;
