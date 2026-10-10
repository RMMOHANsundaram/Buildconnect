const express = require("express");
const { protect, authorize } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const { createPortfolioWork, getProviderPortfolio, deletePortfolioWork } = require("../controllers/portfolioController");

const router = express.Router();

router.post("/", protect, authorize("provider"), upload.array("media"), createPortfolioWork);
router.get("/provider/:providerId", getProviderPortfolio);
router.delete("/:id", protect, authorize("provider"), deletePortfolioWork);

module.exports = router;
