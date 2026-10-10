const mongoose = require("mongoose");
const Package = require("../models/Package");

const providerFields = "name email phone city role profileImage trade rating availability isApproved";
const populate = { path: "provider", select: providerFields };

const isValidId = (value) => mongoose.isValidObjectId(value);

const listPackages = async (req, res) => {
  try {
    const { search, category, availability, provider } = req.query;
    const filter = {};
    if (search) filter.$or = [{ title: new RegExp(search, "i") }, { description: new RegExp(search, "i") }];
    if (category && category !== "All") filter.category = category;
    if (availability !== undefined) filter.availability = availability === "true";
    if (provider) {
      if (!isValidId(provider)) return res.status(400).json({ message: "Invalid provider id" });
      filter.provider = provider;
    }
    return res.json(await Package.find(filter).populate(populate).sort({ bookingsCount: -1, rating: -1 }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load packages" });
  }
};

const getPackageById = async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: "Invalid package id" });
  try {
    const item = await Package.findById(req.params.id).populate(populate);
    if (!item) return res.status(404).json({ message: "Package not found" });
    return res.json(item);
  } catch (error) {
    return res.status(500).json({ message: "Unable to load package" });
  }
};

const myPackages = async (req, res) => {
  try {
    return res.json(await Package.find({ provider: req.user._id }).populate(populate).sort({ createdAt: -1 }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load your packages" });
  }
};

const savePackage = async (req, res) => {
  try {
    const values = {
      title: req.body.title,
      category: req.body.category,
      description: req.body.description,
      price: req.body.price,
      duration: req.body.duration,
      includes: Array.isArray(req.body.includes) ? req.body.includes : [],
      helpers: Array.isArray(req.body.helpers) ? req.body.helpers : [],
      images: Array.isArray(req.body.images) ? req.body.images : (req.body.imageUrl ? [req.body.imageUrl] : []),
      availability: req.body.availability,
      provider: req.user._id,
    };
    const item = req.params.id
      ? await Package.findOneAndUpdate({ _id: req.params.id, provider: req.user._id }, values, { new: true, runValidators: true }).populate(populate)
      : await Package.create(values);
    if (!item) return res.status(404).json({ message: "Package not found" });
    return res.status(req.params.id ? 200 : 201).json(req.params.id ? item : await item.populate(populate));
  } catch (error) {
    return res.status(400).json({ message: error.name === "ValidationError" ? error.message : "Invalid package data" });
  }
};

const deletePackage = async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: "Invalid package id" });
  try {
    const filter = req.user.role === "admin" ? { _id: req.params.id } : { _id: req.params.id, provider: req.user._id };
    const item = await Package.findOneAndDelete(filter);
    if (!item) return res.status(404).json({ message: "Package not found" });
    return res.json({ message: "Package deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Unable to delete package" });
  }
};

module.exports = { listPackages, getPackageById, myPackages, savePackage, deletePackage };
