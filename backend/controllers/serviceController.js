const Service = require("../models/Service");
const mongoose = require("mongoose");

const providerFields = "name email phone city role trade profileImage rating availability isApproved";

const getServices = async (req, res) => {
  try {
    const { search, category, city, minPrice, maxPrice, availability } = req.query;
    const filter = {};
    if (search) filter.$or = [{ name: new RegExp(search, "i") }, { description: new RegExp(search, "i") }];
    if (category && category !== "All") filter.category = category;
    if (city) filter.city = new RegExp(city, "i");
    if (minPrice || maxPrice) filter.price = { ...(minPrice && { $gte: Number(minPrice) }), ...(maxPrice && { $lte: Number(maxPrice) }) };
    if (availability !== undefined) filter.availability = availability === "true";
    const services = await Service.find(filter).populate("provider", providerFields).sort({ bookingsCount: -1, rating: -1 });
    return res.json(services);
  } catch (error) {
    console.error("List services error:", error);
    return res.status(500).json({ message: "Unable to load services" });
  }
};

const getServiceById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid service id" });
    const service = await Service.findById(req.params.id).populate("provider", providerFields);
    if (!service) return res.status(404).json({ message: "Service not found" });
    return res.json(service);
  } catch (error) {
    return res.status(400).json({ message: "Invalid service id" });
  }
};

const getMyServices = async (req, res) => {
  try {
    const services = await Service.find({ provider: req.user._id }).populate("provider", providerFields).sort({ createdAt: -1 });
    return res.json(services);
  } catch (error) {
    console.error("List my services error:", error);
    return res.status(500).json({ message: "Unable to load your services" });
  }
};

const createService = async (req, res) => {
  try {
    const service = await Service.create({
      name: req.body.name,
      description: req.body.description,
      category: req.body.category,
      price: req.body.price,
      city: req.body.city,
      images: req.body.images || (req.body.imageUrl ? [req.body.imageUrl] : []),
      availability: req.body.availability,
      experience: req.body.experience || 0,
      provider: req.user._id,
    });
    return res.status(201).json(await service.populate("provider", providerFields));
  } catch (error) {
    console.error("Create service error:", error);
    return res.status(400).json({ message: error.name === "ValidationError" ? error.message : "Invalid service data" });
  }
};

const updateService = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid service id" });
    const query = { _id: req.params.id, provider: req.user._id };
    const updates = { ...req.body };
    if (updates.imageUrl !== undefined) {
      updates.images = updates.imageUrl ? [updates.imageUrl] : [];
      delete updates.imageUrl;
    }
    delete updates.provider;
    const service = await Service.findOneAndUpdate(query, updates, { new: true, runValidators: true }).populate("provider", providerFields);
    if (!service) return res.status(404).json({ message: "Service not found" });
    return res.json(service);
  } catch (error) {
    return res.status(400).json({ message: error.name === "ValidationError" ? error.message : "Invalid service data" });
  }
};

const deleteService = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid service id" });
    const query = req.user.role === "admin" ? { _id: req.params.id } : { _id: req.params.id, provider: req.user._id };
    const service = await Service.findOneAndDelete(query);
    if (!service) return res.status(404).json({ message: "Service not found" });
    return res.json({ message: "Service deleted" });
  } catch (error) {
    return res.status(400).json({ message: "Invalid service id" });
  }
};

module.exports = { getServices, getServiceById, getMyServices, createService, updateService, deleteService };
