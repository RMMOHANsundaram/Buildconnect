const mongoose = require("mongoose");
const { z } = require("zod");
const Booking = require("../models/Booking");
const Service = require("../models/Service");
const Notification = require("../models/Notification");
const { sendNotification } = require("../services/notificationService");
const { buildInvoice, renderInvoicePdf, fmtDate, fmtDateTime, money } = require("../services/invoiceService");

const populate = [
  { path: "customer", select: "name email phone communicationPreferences" },
  { path: "provider", select: "name email phone city trade storeName communicationPreferences" },
  { path: "service", select: "name category price description" },
  { path: "package", select: "title category price description" },
];

/**
 * Compose the lifecycle message a customer receives when their booking moves
 * forward. Every message carries the current cost so the customer is never
 * surprised at the end.
 */
const buildLifecycleMessage = (booking, event) => {
  const invoice = buildInvoice(booking);
  const providerName = booking.provider?.storeName || booking.provider?.name || "Your provider";
  const customerName = booking.customer?.name?.split(" ")[0] || "there";
  const schedule = invoice.schedule.endDate
    ? `${fmtDate(invoice.schedule.startDate)} to ${fmtDate(invoice.schedule.endDate)} (${invoice.schedule.days} days) at ${invoice.work.timeSlot}`
    : `${fmtDate(invoice.schedule.startDate)} at ${invoice.work.timeSlot}`;
  const costLine = `Cost so far: ${money(invoice.basePrice)} (service)${invoice.materialsTotal ? ` + ${money(invoice.materialsTotal)} (materials)` : ""} = ${money(invoice.grandTotal)}`;
  const base = [
    `Booking: ${invoice.work.title}`,
    `Provider: ${providerName}`,
    `Scheduled: ${schedule}`,
    `Site address: ${invoice.work.address}`,
    costLine,
  ];

  if (event === "accepted") {
    return {
      subject: `Booking accepted by ${providerName}`,
      text: [
        `Hi ${customerName},`,
        "",
        `Good news — ${providerName} has accepted your booking.`,
        "",
        ...base,
        `Accepted on: ${fmtDateTime(booking.acceptedAt)}`,
        "",
        "You'll get another update as soon as the work starts.",
      ].join("\n"),
    };
  }

  if (event === "started") {
    return {
      subject: `Work started — ${invoice.work.title}`,
      text: [
        `Hi ${customerName},`,
        "",
        `${providerName} has started work on your booking.`,
        "",
        ...base,
        `Work started on: ${fmtDateTime(booking.startedAt)}`,
        "",
        "We'll send the final bill as soon as the work is completed.",
      ].join("\n"),
    };
  }

  if (event === "completed") {
    const charges = invoice.lineItems.map((item) => `  - ${item.description}: ${money(item.amount)}`).join("\n");
    return {
      subject: `Work completed — bill ${invoice.invoiceNumber}`,
      text: [
        `Hi ${customerName},`,
        "",
        `${providerName} has marked your booking as completed. Your itemised PDF bill has been emailed to you and is also available to download from your dashboard.`,
        "",
        ...base,
        `Work started: ${fmtDateTime(booking.startedAt)}`,
        `Work completed: ${fmtDateTime(booking.completedAt)}`,
        invoice.timeline.workingDuration ? `Total working time: ${invoice.timeline.workingDuration}` : "",
        "",
        `Bill number: ${invoice.invoiceNumber}`,
        "Charges:",
        charges,
        "",
        `TOTAL: ${money(invoice.grandTotal)}`,
        `In words: ${invoice.amountInWords}`,
        `Payment status: ${invoice.paymentStatus === "PAID" ? "Paid" : "Payment due"}`,
        "",
        "You can download the bill any time from your dashboard.",
      ].filter(Boolean).join("\n"),
    };
  }

  return { subject: "Booking update", text: `Your booking ${invoice.work.title} was updated.` };
};

/**
 * Deliver a lifecycle message over email + WhatsApp and record the outcome on
 * the booking so a failed send can be spotted (and retried) later.
 */
const sendLifecycleNotification = async (req, booking, event) => {
  try {
    const customer = booking.customer;
    if (!customer) return;
    const message = buildLifecycleMessage(booking, event);

    let attachments = [];
    if (event === "completed") {
      try {
        const pdf = await renderInvoicePdf(booking);
        attachments = [{ filename: `${buildInvoice(booking).invoiceNumber}.pdf`, content: pdf, contentType: "application/pdf" }];
      } catch (error) {
        console.error("Invoice PDF generation failed:", error.message);
      }
    }

    const results = await sendNotification(customer, {
      subject: message.subject,
      body: message.text,
      attachments,
    });

    const delivered = results.filter((result) => result.status === "SENT");
    if (delivered.length) {
      console.log(`[booking ${booking._id}] ${event} sent via ${delivered.map((d) => d.channel).join(", ")}`);
    } else {
      console.warn(`[booking ${booking._id}] ${event} not delivered: ${results.map((r) => `${r.channel}:${r.status}`).join(", ")}`);
    }

    booking.notifications.push(...results.map((result) => ({
      channel: result.channel,
      event,
      status: result.status,
      detail: String(result.detail || "").slice(0, 200),
      sentAt: new Date(),
    })));
    await booking.save();
  } catch (error) {
    console.error("Lifecycle notification error:", error.message);
  }
};

const notify = async (req, recipient, title, message, type, relatedBooking) => {
  try {
    const notification = await Notification.create({ recipient, title, message, type, relatedBooking });
    if (req?.io) {
      req.io.to(`user_${recipient.toString()}`).emit("notification", notification);
    }
  } catch (error) {
    console.error("Booking notification error:", error.message);
  }
};

const createBookingSchema = z.object({
  service: z.string().optional(),
  package: z.string().optional(),
  providerId: z.string().optional(),
  isCustomQuote: z.boolean().optional(),
  customCategory: z.string().optional(),
  date: z.string().min(1, "Date is required"),
  endDate: z.string().optional(),
  time: z.string().min(1, "Time is required"),
  address: z.string().min(1, "Address is required"),
  requirements: z.string().optional(),
  description: z.string().optional(),
});

/** Sequential, human-readable bill number, e.g. INV-2610-0007. */
const nextInvoiceNumber = async () => {
  const now = new Date();
  const prefix = `INV-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const used = await Booking.countDocuments({ invoiceNumber: new RegExp(`^${prefix}-`) });
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = `${prefix}-${String(used + 1 + attempt).padStart(4, "0")}`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await Booking.exists({ invoiceNumber: candidate }))) return candidate;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
};

const createBooking = async (req, res) => {
  try {
    const validatedData = createBookingSchema.parse(req.body);
    const { service, package: packageId, providerId, isCustomQuote, customCategory, date, endDate, time, address, requirements, description } = validatedData;

    let provider;
    let price = 0;
    let name = "Custom Request";
    let item;

    if (isCustomQuote) {
      if (!providerId) return res.status(400).json({ message: "Provider ID is required for custom quotes" });
      if (!customCategory) return res.status(400).json({ message: "Category is required for custom quotes" });
      provider = providerId;
    } else {
      if (!service && !packageId) return res.status(400).json({ message: "Service or Package is required for standard bookings" });
      if (service) {
        item = await Service.findById(service).select("provider name price availability");
      } else {
        item = await require("../models/Package").findById(packageId).select("provider title price availability");
        if (item) item.name = item.title;
      }
      if (!item) return res.status(404).json({ message: "Service or Package not found" });

      provider = item.provider;
      price = item.price;
      name = item.name;
    }

    // Turn a ``YYYY-MM-DD`` string into that calendar day at UTC midnight.
    // Using an explicit UTC anchor keeps the booking on the day the customer
    // picked, no matter what timezone the server runs in.
    const toUtcDay = (value) => {
      const day = String(value || "").split("T")[0].trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
      const parsed = new Date(`${day}T00:00:00.000Z`);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const startOfDay = toUtcDay(date);
    if (!startOfDay) {
      return res.status(400).json({ message: "Please choose a valid booking date." });
    }
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);

    // Optional multi-day range (used by package bookings).
    let endOfRange;
    if (endDate) {
      endOfRange = toUtcDay(endDate);
      if (!endOfRange) {
        return res.status(400).json({ message: "Please choose a valid end date." });
      }
      if (endOfRange < startOfDay) {
        return res.status(400).json({ message: "End date cannot be before the start date." });
      }
    }

    const existingBooking = await Booking.findOne({
      provider: provider,
      date: { $gte: startOfDay, $lte: endOfDay },
      time: time,
      status: { $nin: ["CANCELLED", "REJECTED"] }
    });

    if (existingBooking) {
      return res.status(400).json({ message: "This time slot is already booked for this provider." });
    }

    const booking = await Booking.create({
      customer: req.user._id,
      provider: provider,
      service: service || undefined,
      package: packageId || undefined,
      isCustomQuote: isCustomQuote || false,
      customCategory: customCategory || undefined,
      date: startOfDay,
      endDate: endOfRange,
      time,
      address,
      requirements: requirements ?? description ?? "",
      price: price,
    });

    if (service) {
      await Service.findByIdAndUpdate(service, { $inc: { bookingsCount: 1 } });
    } else if (packageId) {
      await require("../models/Package").findByIdAndUpdate(packageId, { $inc: { bookingsCount: 1 } });
    }
    await notify(req, provider, "New booking request", `New booking request for ${name}`, "booking_created", booking._id);
    return res.status(201).json(await booking.populate(populate));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.errors[0].message });
    }
    return res.status(400).json({ message: error.name === "ValidationError" ? error.message : "Invalid booking data" });
  }
};

const myBookings = async (req, res) => {
  try {
    return res.json(await Booking.find({ customer: req.user._id }).populate(populate).sort({ createdAt: -1 }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load bookings" });
  }
};

const providerBookings = async (req, res) => {
  try {
    return res.json(await Booking.find({ provider: req.user._id }).populate(populate).sort({ createdAt: -1 }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load bookings" });
  }
};

const allBookings = async (req, res) => {
  try {
    return res.json(await Booking.find().populate(populate).sort({ createdAt: -1 }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load bookings" });
  }
};

const getBooking = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid booking id" });
    const booking = await Booking.findById(req.params.id).populate(populate);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    const canView = req.user.role === "admin"
      || booking.customer._id.equals(req.user._id)
      || booking.provider._id.equals(req.user._id);
    if (!canView) return res.status(403).json({ message: "You do not have permission to view this booking" });
    return res.json(booking);
  } catch (error) {
    return res.status(400).json({ message: "Invalid booking id" });
  }
};

const changeStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const isProvider = booking.provider.equals(req.user._id);
    const isCustomer = booking.customer.equals(req.user._id);
    const isAdmin = req.user.role === "admin";

    // Customer can only Accept or Reject an estimate
    if (isCustomer && !isAdmin && booking.status === "ESTIMATE_PROVIDED") {
      if (status !== "ACCEPTED" && status !== "REJECTED") {
        return res.status(403).json({ message: "Customers can only accept or reject an estimate" });
      }
    } else if (!isProvider && !isAdmin) {
      return res.status(403).json({ message: "You do not have permission to update this booking" });
    }

    const transitions = {
      PENDING: ["ACCEPTED", "REJECTED"],
      ESTIMATE_PROVIDED: ["ACCEPTED", "REJECTED"],
      ACCEPTED: ["IN_PROGRESS"],
      IN_PROGRESS: ["COMPLETED"],
    };
    if (!transitions[booking.status]?.includes(status)) {
      return res.status(400).json({ message: `Cannot change ${booking.status} to ${status}` });
    }

    const now = new Date();
    booking.status = status;

    // Stamp the lifecycle timeline. The first time each milestone happens wins,
    // so re-saving a booking never rewrites when the work actually started.
    if (status === "ACCEPTED") booking.acceptedAt = booking.acceptedAt || now;
    if (status === "IN_PROGRESS") {
      booking.acceptedAt = booking.acceptedAt || now;
      booking.startedAt = booking.startedAt || now;
    }
    if (status === "COMPLETED") {
      booking.acceptedAt = booking.acceptedAt || now;
      booking.startedAt = booking.startedAt || booking.acceptedAt;
      booking.completedAt = now;
      if (!booking.invoiceNumber) booking.invoiceNumber = await nextInvoiceNumber();
      booking.invoiceGeneratedAt = now;
    }
    await booking.save();

    await notify(req, booking.customer, "Booking status updated", `Your booking was marked ${status.toLowerCase()}`, `booking_${status.toLowerCase()}`, booking._id);
    await booking.populate(populate);

    // Email + WhatsApp the customer for the milestones they care about.
    const lifecycleEvent = { ACCEPTED: "accepted", IN_PROGRESS: "started", COMPLETED: "completed" }[status];
    if (lifecycleEvent) {
      await sendLifecycleNotification(req, booking, lifecycleEvent);
    }

    return res.json(booking);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

const cancelBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const isAdmin = req.user.role === "admin";
    const isCustomer = req.user.role === "customer" && booking.customer.equals(req.user._id);
    const isProvider = req.user.role === "provider" && booking.provider.equals(req.user._id);
    if (!isAdmin && !isCustomer && !isProvider) {
      return res.status(403).json({ message: "You do not have permission to cancel this booking" });
    }
    if (!["PENDING", "ACCEPTED"].includes(booking.status)) {
      return res.status(400).json({ message: "This booking cannot be cancelled" });
    }

    booking.status = "CANCELLED";
    booking.cancelledAt = new Date();
    await booking.save();
    const recipient = isProvider || isAdmin ? booking.customer : booking.provider;
    await notify(req, recipient, "Booking cancelled", "A booking was cancelled", "booking_cancelled", booking._id);
    return res.json(await booking.populate(populate));
  } catch (error) {
    return res.status(400).json({ message: "Invalid booking id" });
  }
};

const provideEstimate = async (req, res) => {
  try {
    const { price } = req.body;
    if (price === undefined || price < 0) return res.status(400).json({ message: "Valid price is required" });
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (req.user.role !== "admin" && !booking.provider.equals(req.user._id)) {
      return res.status(403).json({ message: "You do not have permission to update this booking" });
    }
    if (booking.status !== "PENDING" || !booking.isCustomQuote) {
      return res.status(400).json({ message: "Cannot provide estimate for this booking state" });
    }
    booking.price = price;
    booking.status = "ESTIMATE_PROVIDED";
    await booking.save();
    await notify(req, booking.customer, "Estimate Provided", `An estimate of ₹${price} has been provided for your custom request`, "booking_estimate", booking._id);
    return res.json(await booking.populate(populate));
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

const addMaterials = async (req, res) => {
  try {
    const { materials } = req.body;
    if (!Array.isArray(materials)) return res.status(400).json({ message: "Materials must be an array" });
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (req.user.role !== "admin" && !booking.provider.equals(req.user._id)) {
      return res.status(403).json({ message: "You do not have permission to update this booking" });
    }
    if (booking.status !== "IN_PROGRESS") {
      return res.status(400).json({ message: "Cannot add materials unless the booking is in progress" });
    }
    booking.materials = materials;
    await booking.save();
    return res.json(await booking.populate(populate));
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

const getBookedSlots = async (req, res) => {
  try {
    const providerId = req.params.providerId || req.query.providerId;
    const { date } = req.query;
    if (!providerId || !date) return res.status(400).json({ message: "Provider ID and date are required" });
    
    const dateStr = String(date).split("T")[0];
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

    const bookings = await Booking.find({
      provider: providerId,
      date: { $gte: startOfDay, $lte: endOfDay },
      status: { $nin: ["CANCELLED", "REJECTED"] }
    }).select("time");

    const bookedSlots = bookings.map(b => b.time);
    return res.json({ bookedSlots });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load booked slots" });
  }
};

/**
 * GET /api/bookings/:id/invoice — download the bill as a PDF.
 * Customers can pull it once the work is completed; the provider and admins can
 * preview it at any point during the job.
 */
const downloadInvoice = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid booking id" });
    const booking = await Booking.findById(req.params.id).populate(populate);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const isAdmin = req.user.role === "admin";
    const isProvider = booking.provider._id.equals(req.user._id);
    const isCustomer = booking.customer._id.equals(req.user._id);
    if (!isAdmin && !isProvider && !isCustomer) {
      return res.status(403).json({ message: "You do not have permission to view this bill" });
    }
    if (isCustomer && !isAdmin && booking.status !== "COMPLETED") {
      return res.status(400).json({ message: "The bill is available once the work is marked complete" });
    }

    if (!booking.invoiceNumber) {
      booking.invoiceNumber = await nextInvoiceNumber();
      booking.invoiceGeneratedAt = new Date();
      await booking.save();
    }

    const pdf = await renderInvoicePdf(booking);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${booking.invoiceNumber}.pdf"`);
    res.setHeader("Content-Length", pdf.length);
    return res.send(pdf);
  } catch (error) {
    console.error("Invoice generation error:", error);
    return res.status(500).json({ message: "Unable to generate the bill right now" });
  }
};

/** GET /api/bookings/:id/invoice/preview — same bill but as JSON (handy for testing/UI). */
const previewInvoice = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid booking id" });
    const booking = await Booking.findById(req.params.id).populate(populate);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    const isAdmin = req.user.role === "admin";
    if (!isAdmin && !booking.provider._id.equals(req.user._id) && !booking.customer._id.equals(req.user._id)) {
      return res.status(403).json({ message: "You do not have permission to view this bill" });
    }
    return res.json(buildInvoice(booking));
  } catch (error) {
    return res.status(500).json({ message: "Unable to build the bill" });
  }
};

module.exports = { createBooking, myBookings, providerBookings, allBookings, getBooking, changeStatus, cancelBooking, provideEstimate, addMaterials, getBookedSlots, downloadInvoice, previewInvoice };
