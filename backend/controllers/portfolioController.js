const mongoose = require("mongoose");
const PortfolioWork = require("../models/PortfolioWork");

const createPortfolioWork = async (req, res) => {
  try {
    const { title, description, taggedCustomer, taggedBooking } = req.body;
    
    if (!title?.trim()) {
      return res.status(400).json({ message: "Title is required" });
    }

    const photos = [];
    const videos = [];
    if (req.files) {
      req.files.forEach((file) => {
        if (file.mimetype.startsWith("video/")) {
          videos.push(`/uploads/${file.filename}`);
        } else if (file.mimetype.startsWith("image/")) {
          photos.push(`/uploads/${file.filename}`);
        }
      });
    }

    const portfolioWork = await PortfolioWork.create({
      provider: req.user._id,
      title: title.trim(),
      description: description?.trim() || "",
      taggedCustomer: taggedCustomer || undefined,
      taggedBooking: taggedBooking || undefined,
      photos,
      videos,
    });

    return res.status(201).json(portfolioWork);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create portfolio work", error: error.message });
  }
};

const getProviderPortfolio = async (req, res) => {
  try {
    const { providerId } = req.params;
    if (!mongoose.isValidObjectId(providerId)) {
      return res.status(400).json({ message: "Invalid provider ID" });
    }
    
    const works = await PortfolioWork.find({ provider: providerId })
      .populate("taggedCustomer", "name profileImage")
      .populate("taggedBooking", "date status")
      .sort({ createdAt: -1 });
      
    return res.json(works);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch portfolio" });
  }
};

const deletePortfolioWork = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid portfolio work ID" });
    }
    
    const work = await PortfolioWork.findById(id);
    if (!work) return res.status(404).json({ message: "Portfolio work not found" });
    
    if (!work.provider.equals(req.user._id) && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized to delete this work" });
    }
    
    await PortfolioWork.deleteOne({ _id: id });
    return res.json({ message: "Portfolio work deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete portfolio work" });
  }
};

module.exports = {
  createPortfolioWork,
  getProviderPortfolio,
  deletePortfolioWork
};
