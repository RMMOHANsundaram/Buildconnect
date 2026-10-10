const Razorpay = require("razorpay");

const razorpay = new Razorpay({
  key_id: "rzp_test_ThRR7c451LvZMr",
  key_secret: "lZqhpW3zAI3DDS4cV0pOAkvl",
});

async function test() {
  try {
    const order = await razorpay.orders.create({
      amount: 100,
      currency: "INR",
      receipt: "receipt_1",
    });
    console.log("Success:", order);
  } catch (error) {
    console.error("Error:", error);
  }
}
test();
