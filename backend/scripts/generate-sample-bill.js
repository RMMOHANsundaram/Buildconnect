/**
 * Renders a sample bill to ./sample-bill.pdf so the PDF can be previewed without
 * touching the database or creating a real booking.
 *
 *   node scripts/generate-sample-bill.js
 */
const path = require("path");
const fs = require("fs");
const { renderInvoicePdf } = require("../services/invoiceService");

const sampleBooking = {
  _id: "68f2b1c4a1b2c3d4e5f60718",
  createdAt: new Date("2026-10-01T09:00:00Z"),
  acceptedAt: new Date("2026-10-02T05:30:00Z"),
  startedAt: new Date("2026-10-05T04:00:00Z"),
  completedAt: new Date("2026-10-08T13:15:00Z"),
  date: new Date("2026-10-05T00:00:00Z"),
  endDate: new Date("2026-10-08T00:00:00Z"),
  time: "10:00 AM",
  address: "12 Gandhi Street, R.S. Puram, Coimbatore 641002",
  requirements: "Replace the corroded kitchen sink line and reseal the counter joints.",
  price: 12500,
  materials: [
    { name: "CPVC pipe set (10 ft)", cost: 1450 },
    { name: "Brass fittings and valves", cost: 980 },
    { name: "Silicone sealant (2 tubes)", cost: 420 },
  ],
  status: "COMPLETED",
  paymentStatus: "UNPAID",
  invoiceNumber: "INV-2610-0001",
  customer: { name: "Priya Raman", email: "priya.raman@example.com", phone: "9876543210" },
  provider: {
    name: "Suresh Kumar", storeName: "Suresh Plumbing Works", trade: "Plumbing",
    city: "Coimbatore", phone: "9123456780", email: "suresh.plumbing@example.com",
  },
  package: { title: "Kitchen plumbing overhaul", category: "Plumbing" },
};

const target = path.join(__dirname, "..", "sample-bill.pdf");

renderInvoicePdf(sampleBooking)
  .then((pdf) => {
    fs.writeFileSync(target, pdf);
    console.log(`Sample bill written to ${target} (${pdf.length} bytes)`);
  })
  .catch((error) => {
    console.error("Could not generate the sample bill:", error.message);
    process.exit(1);
  });
