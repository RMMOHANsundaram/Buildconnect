require("dotenv").config();
const Razorpay = require("razorpay");

console.log("Loading keys from .env file...");
console.log("Key ID:", process.env.RAZORPAY_KEY_ID);
console.log("Key Secret:", process.env.RAZORPAY_KEY_SECRET ? "***" + process.env.RAZORPAY_KEY_SECRET.slice(-4) : "MISSING");

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.error("ERROR: Missing Razorpay keys in .env file.");
  process.exit(1);
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

async function verify() {
  try {
    console.log("\nAttempting to create a test order with Razorpay to verify keys...");
    const order = await razorpay.orders.create({
      amount: 100, // 1 INR
      currency: "INR",
      receipt: "test_receipt",
    });
    console.log("SUCCESS! Your Razorpay keys are valid and working.");
    console.log("Test Order ID:", order.id);
  } catch (error) {
    console.error("\nFAILURE: Razorpay rejected the keys.");
    console.error("Error Description:", error.error ? error.error.description : error.message);
    console.error("\nMake sure you copied both the Key ID and Key Secret exactly as they appear in the Razorpay Dashboard (Test Mode).");
  }
}

verify();
