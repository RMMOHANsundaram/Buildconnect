const mongoose = require("mongoose");
const Review = require("../models/Review");
const Booking = require("../models/Booking");
const Service = require("../models/Service");
const User = require("../models/User");
const Notification = require("../models/Notification");

const reviewPopulate = [
  { path: "customer", select: "name profileImage" },
  { path: "service", select: "name category price rating" },
  { path: "package", select: "title category price rating" },
];

const getReviews = (filter) => Review.find(filter).populate(reviewPopulate).sort({ createdAt: -1 });

const getProviderReviews = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.providerId)) return res.status(400).json({ message: "Invalid provider id" });
    return res.json(await getReviews({ provider: req.params.providerId }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load reviews" });
  }
};

const getServiceReviews = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.serviceId)) return res.status(400).json({ message: "Invalid service id" });
    return res.json(await getReviews({ service: req.params.serviceId }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load reviews" });
  }
};

const getPackageReviews = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.packageId)) return res.status(400).json({ message: "Invalid package id" });
    return res.json(await getReviews({ package: req.params.packageId }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load reviews" });
  }
};

const refreshRatings = async (serviceId, packageId, providerId) => {
  const [serviceReviews, packageReviews, providerReviews] = await Promise.all([
    serviceId ? Review.find({ service: serviceId }).select("rating") : [],
    packageId ? Review.find({ package: packageId }).select("rating") : [],
    Review.find({ provider: providerId }).select("rating"),
  ]);
  const average = (items) => items.length ? Math.round((items.reduce((sum, item) => sum + item.rating, 0) / items.length) * 10) / 10 : 0;
  await Promise.all([
    serviceId ? Service.findByIdAndUpdate(serviceId, { rating: average(serviceReviews) }) : Promise.resolve(),
    packageId ? require("../models/Package").findByIdAndUpdate(packageId, { rating: average(packageReviews) }) : Promise.resolve(),
    User.findByIdAndUpdate(providerId, { $set: { rating: average(providerReviews) } }),
  ]);
};

const createReview = async (req, res) => {
  try {
    const { booking: bookingId, rating, comment } = req.body;
    if (!mongoose.isValidObjectId(bookingId)) return res.status(400).json({ message: "A valid booking is required" });
    if (!Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5) return res.status(400).json({ message: "Rating must be an integer from 1 to 5" });
    if (!comment?.trim()) return res.status(400).json({ message: "A review comment is required" });

    const booking = await Booking.findOne({ _id: bookingId, customer: req.user._id, status: "COMPLETED" });
    if (!booking) return res.status(400).json({ message: "Reviews require your completed booking" });

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

    const review = await Review.create({
      customer: req.user._id,
      provider: booking.provider,
      service: booking.service || undefined,
      package: booking.package || undefined,
      booking: booking._id,
      rating: Number(rating),
      comment: comment.trim(),
      photos,
      videos,
    });
    await refreshRatings(booking.service, booking.package, booking.provider);
    await Notification.create({ recipient: booking.provider, title: "New review", message: "You received a new review", type: "review_created" });
    return res.status(201).json(await review.populate(reviewPopulate));
  } catch (error) {
    return res.status(400).json({ message: error.code === 11000 ? "This booking already has a review" : error.message });
  }
};

const deleteReview = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid review id" });
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ message: "Review not found" });
    if (req.user.role !== "admin" && !review.customer.equals(req.user._id)) return res.status(403).json({ message: "You do not have permission to delete this review" });
    await Review.deleteOne({ _id: review._id });
    await refreshRatings(review.service, review.package, review.provider);
    return res.json({ message: "Review deleted" });
  } catch (error) {
    return res.status(400).json({ message: "Invalid review id" });
  }
};

module.exports = { getProviderReviews, getServiceReviews, getPackageReviews, createReview, deleteReview };
