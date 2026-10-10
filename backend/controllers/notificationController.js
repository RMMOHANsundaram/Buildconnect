const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const { getChannelStatus } = require("../services/notificationService");

/** GET /api/notifications/status — which delivery channels are actually configured. */
const channelStatus = (req, res) => res.json(getChannelStatus());

const listNotifications = async (req, res) => {
	try {
		const notifications = await Notification.find({ recipient: req.user._id }).populate("relatedBooking", "status service").sort({ createdAt: -1 });
		return res.json({ notifications, unreadCount: notifications.filter((item) => !item.isRead).length });
	} catch (error) {
		return res.status(500).json({ message: "Unable to load notifications" });
	}
};

const markRead = async (req, res) => {
	try {
		if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid notification id" });
		const notification = await Notification.findOneAndUpdate({ _id: req.params.id, recipient: req.user._id }, { isRead: true }, { new: true });
		if (!notification) return res.status(404).json({ message: "Notification not found" });
		return res.json(notification);
	} catch (error) {
		return res.status(400).json({ message: "Invalid notification id" });
	}
};

const markAllRead = async (req, res) => {
	try {
		await Notification.updateMany({ recipient: req.user._id, isRead: false }, { isRead: true });
		return res.json({ message: "Notifications marked as read" });
	} catch (error) {
		return res.status(500).json({ message: "Unable to update notifications" });
	}
};

module.exports = { listNotifications, markRead, markAllRead, channelStatus };
