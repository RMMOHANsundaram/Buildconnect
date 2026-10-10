const Razorpay = require("razorpay");

const razorpay = new Razorpay({
  key_id: "rzp_test_dummykeyid123456",
  key_secret: "dummysecret1234567890dummy",
});

async function test() {
  try {
    const order = await razorpay.orders.create({
      amount: 850000,
      currency: "INR",
      receipt: "booking_123",
      notes: { test: "123" }
    });
    console.log("Order:", order);
  } catch (error) {
    console.error("Error message:", error.message);
  }
}
test();
