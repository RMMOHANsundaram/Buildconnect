const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { getMessages } = require("../controllers/messageController");
const router = express.Router();

router.use(protect);
router.get("/:bookingId", getMessages);

module.exports = router;
