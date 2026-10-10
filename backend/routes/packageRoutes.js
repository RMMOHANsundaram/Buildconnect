const express = require("express");
const { protect, authorize } = require("../middleware/authMiddleware");
const { listPackages, getPackageById, myPackages, savePackage, deletePackage } = require("../controllers/packageController");

const router = express.Router();
router.get("/", listPackages);
router.get("/my", protect, authorize("provider"), myPackages);
router.get("/:id", getPackageById);
router.post("/", protect, authorize("provider"), savePackage);
router.put("/:id", protect, authorize("provider"), savePackage);
router.delete("/:id", protect, authorize("provider", "admin"), deletePackage);

module.exports = router;
