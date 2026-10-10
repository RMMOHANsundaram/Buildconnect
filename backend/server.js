const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const serviceRoutes = require("./routes/serviceRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const adminRoutes = require("./routes/adminRoutes");
const packageRoutes = require("./routes/packageRoutes");
const messageRoutes = require("./routes/messageRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const portfolioRoutes = require("./routes/portfolioRoutes");
const http = require("http");
const { Server } = require("socket.io");
const Message = require("./models/Message");
const Notification = require("./models/Notification");
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Socket.io logic
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("join_chat", (bookingId) => {
    console.log(`Socket ${socket.id} joining room ${bookingId}`);
    socket.join(bookingId);
  });

  socket.on("register_user", (userId) => {
    console.log(`Socket ${socket.id} registered for user ${userId}`);
    socket.join(`user_${userId}`);
  });

  socket.on("send_message", async (data) => {
    console.log("Received send_message event with data:", data);
    try {
      const message = await Message.create(data);
      console.log("Message created in DB:", message._id);
      io.to(data.bookingId).emit("receive_message", message);
      console.log("Emitted receive_message to room:", data.bookingId);
      // Notify the receiver if they are offline
      // Notify the receiver if they are offline
      if (data.receiverId) {
        const notifData = {
          recipient: data.receiverId,
          title: "New Message",
          message: data.text,
          type: "message",
          relatedBooking: data.bookingId
        };
        const savedNotif = await Notification.create(notifData);
        io.to(`user_${data.receiverId}`).emit("notification", savedNotif);
      }
    } catch (err) {
      console.error("send_message error:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(require("path").join(__dirname, "uploads")));

// Inject socket.io into request object for use in controllers
app.use((req, res, next) => {
  req.io = io;
  next();
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Generous limit to accommodate dashboard views & polling
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again in a few minutes." },
});

app.use("/api", apiLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/packages", packageRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/portfolio", portfolioRoutes);

app.get("/api", (req, res) => {
  res.status(200).json({
    message: "BuildConnect Backend is Running",
  });
});

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
  connectDB().catch((err) => {
    console.error("Initial MongoDB connection error:", err.message);
  });
} else {
  // For testing
  connectDB();
}

module.exports = app;