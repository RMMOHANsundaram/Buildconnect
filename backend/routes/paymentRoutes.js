const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { createOrder, verifyPayment, getPaymentByBooking, getMyPayments } = require("../controllers/paymentController");
const router = express.Router();

router.use(protect);
router.post("/create-order", createOrder);
router.post("/verify", verifyPayment);
router.get("/booking/:bookingId", getPaymentByBooking);
router.get("/my", getMyPayments);

module.exports = router;
