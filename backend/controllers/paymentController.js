const Razorpay = require("razorpay");
const crypto = require("crypto");
const Payment = require("../models/Payment");
const Booking = require("../models/Booking");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_dummykeyid123456",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "dummysecret1234567890dummy",
});

// POST /api/payments/create-order
exports.createOrder = async (req, res) => {
  try {
    const { bookingId } = req.body;
    const booking = await Booking.findById(bookingId).populate("provider");
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (booking.customer.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Not your booking" });
    if (booking.status !== "COMPLETED") return res.status(400).json({ message: "Booking must be completed before payment" });

    // Check if already paid
    const existingPayment = await Payment.findOne({ booking: bookingId, status: "PAID" });
    if (existingPayment) return res.status(400).json({ message: "Already paid" });

    const materialsTotal = booking.materials?.reduce((sum, m) => sum + m.cost, 0) || 0;
    const finalPrice = booking.price + materialsTotal;
    const amount = Math.round(finalPrice * 100); // Razorpay expects amount in paise, ensure integer
    const options = {
      amount,
      currency: "INR",
      receipt: `booking_${bookingId}`,
      notes: { bookingId, customerId: req.user._id.toString(), providerId: booking.provider._id.toString() },
    };

    const order = await razorpay.orders.create(options);

    const payment = await Payment.create({
      booking: bookingId,
      customer: req.user._id,
      provider: booking.provider._id,
      amount: finalPrice,
      razorpayOrderId: order.id,
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      paymentId: payment._id,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error("Create order error:", error);
    // Razorpay sometimes throws an object with an 'error' property instead of a standard Error
    const errMsg = error.error ? error.error.description : error.message || JSON.stringify(error);
    res.status(500).json({ message: errMsg });
  }
};

// POST /api/payments/verify
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    // Verify signature
    const body = razorpayOrderId + "|" + razorpayPaymentId;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpaySignature) {
      return res.status(400).json({ message: "Payment verification failed" });
    }

    // Update payment record
    const payment = await Payment.findOneAndUpdate(
      { razorpayOrderId },
      { razorpayPaymentId, razorpaySignature, status: "PAID", paidAt: new Date() },
      { new: true }
    );

    if (!payment) return res.status(404).json({ message: "Payment record not found" });

    // Update booking to reflect payment
    await Booking.findByIdAndUpdate(payment.booking, { paymentStatus: "PAID" });

    res.json({ message: "Payment verified successfully", payment });
  } catch (error) {
    console.error("Verify payment error:", error);
    res.status(500).json({ message: error.message });
  }
};

// GET /api/payments/booking/:bookingId
exports.getPaymentByBooking = async (req, res) => {
  try {
    const payment = await Payment.findOne({ booking: req.params.bookingId }).sort({ createdAt: -1 });
    res.json(payment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/payments/my — all payments for the logged in user
exports.getMyPayments = async (req, res) => {
  try {
    const filter = req.user.role === "provider"
      ? { provider: req.user._id }
      : { customer: req.user._id };
    const payments = await Payment.find(filter)
      .populate("booking")
      .populate("customer", "name email")
      .populate("provider", "name email")
      .sort({ createdAt: -1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
