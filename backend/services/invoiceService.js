/**
 * Bill / invoice generation.
 *
 * `buildInvoice()` turns a populated Booking into a plain data object (used by
 * the API and by the notification emails). `renderInvoicePdf()` draws the same
 * data onto a single-page A4 PDF and resolves with a Buffer.
 *
 * Totals deliberately match what the payment flow charges:
 *   grandTotal = listed price + all materials/expenses
 * No tax line is added here, because Razorpay is asked for exactly the same
 * amount — inventing tax would make the bill disagree with the receipt.
 */

const PDFDocument = require("pdfkit");

const BRAND = "#f97316";
const INK = "#18181b";
const MUTED = "#71717a";
const LINE = "#e4e4e7";

const company = () => ({
  name: process.env.COMPANY_NAME || "BuildConnect",
  tagline: process.env.COMPANY_TAGLINE || "Verified home service professionals",
  address: process.env.COMPANY_ADDRESS || "Tamil Nadu, India",
  email: process.env.COMPANY_EMAIL || process.env.EMAIL_USER || "",
  phone: process.env.COMPANY_PHONE || "",
  gstin: process.env.COMPANY_GSTIN || "",
});

const fmtDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })
    : "—";

const fmtDateTime = (value) =>
  value
    ? `${new Date(value).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      })} IST`
    : "—";

const money = (value) => `Rs. ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Inclusive difference between two calendar days, in days. */
const daySpan = (start, end) => {
  if (!start || !end) return 1;
  const diff = Math.round((new Date(end).setUTCHours(0, 0, 0, 0) - new Date(start).setUTCHours(0, 0, 0, 0)) / 86400000);
  return Math.max(1, diff + 1);
};

/** Human duration between two timestamps: "2 days 3 hrs", "4 hrs 20 min", "35 min". */
const humanDuration = (from, to) => {
  if (!from || !to) return "";
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "Under a minute";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days} day${days > 1 ? "s" : ""}`);
  if (hours) parts.push(`${hours} hr${hours > 1 ? "s" : ""}`);
  if (mins && !days) parts.push(`${mins} min`);
  return parts.join(" ") || "Under a minute";
};

// ------------------------------------------------------- amount in words (IN)

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const twoDigits = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const threeDigits = (n) =>
  n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${twoDigits(n % 100)}` : ""}` : twoDigits(n);

const integerToWords = (n) => {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  const parts = [];
  if (crore) parts.push(`${integerToWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
};

const amountInWords = (value) => {
  const total = Math.abs(Number(value) || 0);
  const rupees = Math.floor(total);
  const paise = Math.round((total - rupees) * 100);
  const words = [`Rupees ${integerToWords(rupees)}`];
  if (paise) words.push(`and ${twoDigits(paise)} Paise`);
  return `${words.join(" ")} Only`;
};

// -------------------------------------------------------------- buildInvoice

const invoiceNumberOf = (booking) =>
  booking.invoiceNumber || `INV-${String(booking._id || booking.id || "").slice(-8).toUpperCase()}`;

/**
 * Shape a populated booking into bill data.
 * @param {object} booking Mongoose booking (populated: customer, provider, service, package)
 */
const buildInvoice = (booking) => {
  const basePrice = Number(booking.price || 0);
  const materials = (booking.materials || []).map((item) => ({ name: item.name, cost: Number(item.cost || 0) }));
  const materialsTotal = materials.reduce((sum, item) => sum + item.cost, 0);
  const grandTotal = basePrice + materialsTotal;

  const title = booking.service?.name
    || booking.package?.title
    || (booking.isCustomQuote ? `${booking.customCategory || "Custom"} — custom request` : "Service booking");

  const lineItems = [
    {
      description: title,
      detail: booking.package ? "Package booking" : booking.isCustomQuote ? "Custom quote (provider estimate)" : "Service booking",
      amount: basePrice,
    },
    ...materials.map((item) => ({ description: item.name, detail: "Material / expense", amount: item.cost })),
  ];

  return {
    // Marker so renderInvoicePdf can tell a booking apart from already-built data.
    isInvoice: true,
    bookingRef: String(booking._id || booking.id || ""),
    invoiceNumber: invoiceNumberOf(booking),
    issuedAt: booking.completedAt || booking.invoiceGeneratedAt || booking.updatedAt || new Date(),
    status: booking.status,
    paymentStatus: booking.paymentStatus || "UNPAID",
    company: company(),
    customer: {
      name: booking.customer?.name || "Customer",
      email: booking.customer?.email || "",
      phone: booking.customer?.phone || "",
    },
    provider: {
      name: booking.provider?.name || "Provider",
      email: booking.provider?.email || "",
      phone: booking.provider?.phone || "",
      city: booking.provider?.city || "",
      trade: booking.provider?.trade || "",
      storeName: booking.provider?.storeName || "",
    },
    work: {
      title,
      type: booking.package ? "Package" : booking.isCustomQuote ? "Custom Quote" : "Service",
      category: booking.package?.category || booking.service?.category || booking.customCategory || "General",
      description: booking.requirements || "",
      address: booking.address || "",
      timeSlot: booking.time || "",
    },
    schedule: {
      startDate: booking.date,
      endDate: booking.endDate || null,
      days: daySpan(booking.date, booking.endDate || booking.date),
    },
    timeline: {
      requestedAt: booking.createdAt,
      acceptedAt: booking.acceptedAt,
      startedAt: booking.startedAt,
      completedAt: booking.completedAt,
      workingDuration: humanDuration(booking.startedAt, booking.completedAt),
    },
    lineItems,
    materials,
    basePrice,
    materialsTotal,
    grandTotal,
    amountInWords: amountInWords(grandTotal),
  };
};

// ------------------------------------------------------------ PDF rendering

const COLORS = { brand: BRAND, ink: INK, muted: MUTED, line: LINE };
const PAGE = { margin: 44 };

const label = (doc, text, x, y, width = 200) =>
  doc.font("Helvetica").fontSize(8).fillColor(COLORS.muted).text(String(text).toUpperCase(), x, y, { width, characterSpacing: 0.6 });

const value = (doc, text, x, y, width = 200, opts = {}) =>
  doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.size || 10).fillColor(COLORS.ink).text(String(text ?? "—"), x, y, { width, lineGap: 1.5 });

const rule = (doc, y, x1 = PAGE.margin, x2 = doc.page.width - PAGE.margin) => {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(0.7).strokeColor(COLORS.line).stroke();
};

/** Draw a two-column label/value block and return the new y. */
const fieldPair = (doc, rows, x, y, width, gap = 14) => {
  let cursor = y;
  rows.forEach(({ label: text, val }) => {
    label(doc, text, x, cursor, width);
    value(doc, val, x, cursor + 11, width);
    cursor += 11 + gap;
  });
  return cursor;
};

const renderInvoicePdf = (booking, options = {}) => new Promise((resolve, reject) => {
  try {
    const data = booking?.isInvoice ? booking : buildInvoice(booking);
    const doc = new PDFDocument({ size: "A4", margin: PAGE.margin, info: {
      Title: `Bill ${data.invoiceNumber}`,
      Author: data.company.name,
      Subject: `Service bill for ${data.work.title}`,
    } });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = PAGE.margin;
    const right = doc.page.width - PAGE.margin;
    const contentWidth = right - left;

    // ----- header band
    doc.rect(0, 0, doc.page.width, 96).fill(COLORS.brand);
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#ffffff").text(data.company.name, left, 28, { width: contentWidth * 0.6 });
    doc.font("Helvetica").fontSize(9).fillColor("#ffe6d5")
      .text(data.company.tagline, left, 54, { width: contentWidth * 0.6 })
      .text([data.company.address, data.company.phone, data.company.email].filter(Boolean).join("  •  "), left, 68, { width: contentWidth * 0.6 });
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#ffffff").text("SERVICE BILL", left, 30, { width: contentWidth, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor("#ffe6d5")
      .text(data.paymentStatus === "PAID" ? "PAID" : "PAYMENT DUE", left, 50, { width: contentWidth, align: "right" });

    let y = 120;

    // ----- invoice meta
    fieldPair(doc, [
      { label: "Bill number", val: data.invoiceNumber },
      { label: "Bill date", val: fmtDate(data.issuedAt) },
    ], left, y, contentWidth / 2 - 10);

    label(doc, "Booking reference", left + contentWidth / 2, y, contentWidth / 2);
    value(doc, data.bookingRef || "—", left + contentWidth / 2, y + 11, contentWidth / 2 - 10, { bold: true });
    label(doc, "Booking status", left + contentWidth / 2, y + 30, contentWidth / 2);
    value(doc, `${data.status}${data.timeline.workingDuration ? `  (worked ${data.timeline.workingDuration})` : ""}`, left + contentWidth / 2, y + 41, contentWidth / 2 - 10);

    y += 66;
    rule(doc, y);
    y += 18;

    // ----- parties
    label(doc, "Billed to (customer)", left, y, contentWidth / 2 - 10);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.ink).text(data.customer.name, left, y + 12, { width: contentWidth / 2 - 10 });
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted)
      .text([data.customer.phone, data.customer.email].filter(Boolean).join("\n") || "—", left, y + 27, { width: contentWidth / 2 - 10, lineGap: 2 });

    label(doc, "Service provided by", left + contentWidth / 2, y, contentWidth / 2 - 10);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.ink)
      .text(data.provider.storeName || data.provider.name, left + contentWidth / 2, y + 12, { width: contentWidth / 2 - 10 });
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted)
      .text([data.provider.name !== (data.provider.storeName || data.provider.name) ? `Contact: ${data.provider.name}` : "", data.provider.trade, data.provider.city, data.provider.phone, data.provider.email].filter(Boolean).join("\n") || "—",
        left + contentWidth / 2, y + 27, { width: contentWidth / 2 - 10, lineGap: 2 });

    y += 92;
    rule(doc, y);
    y += 18;

    // ----- work + schedule
    label(doc, "Work details", left, y, contentWidth);
    y += 13;
    doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.ink).text(data.work.title, left, y, { width: contentWidth });
    y = doc.y + 4;
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted)
      .text(`${data.work.type} • ${data.work.category} • Slot: ${data.work.timeSlot}`, left, y, { width: contentWidth });
    y = doc.y + 4;
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted).text(`Site address: ${data.work.address}`, left, y, { width: contentWidth });
    y = doc.y + 4;
    if (data.work.description) {
      doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted).text(`Customer's notes: ${data.work.description}`, left, y, { width: contentWidth });
      y = doc.y + 4;
    }
    y += 6;

    // NOTE: the built-in Helvetica face only covers WinAnsi, so avoid glyphs
    // like → (U+2192) — they silently render as garbage. "to" is safe.
    const scheduleLine = data.schedule.endDate
      ? `${fmtDate(data.schedule.startDate)}  to  ${fmtDate(data.schedule.endDate)}  (${data.schedule.days} day${data.schedule.days > 1 ? "s" : ""})`
      : fmtDate(data.schedule.startDate);
    label(doc, "Scheduled for", left, y, contentWidth / 2 - 10);
    value(doc, scheduleLine, left, y + 11, contentWidth / 2 - 10, { bold: true });
    label(doc, "Total working time", left + contentWidth / 2, y, contentWidth / 2 - 10);
    value(doc, data.timeline.workingDuration || "Not recorded", left + contentWidth / 2, y + 11, contentWidth / 2 - 10, { bold: true });

    y += 36;
    rule(doc, y);
    y += 18;

    // ----- timeline
    label(doc, "Timeline", left, y, contentWidth);
    y += 14;
    const timelineRows = [
      ["Booking requested", data.timeline.requestedAt],
      ["Booking accepted", data.timeline.acceptedAt],
      ["Work started", data.timeline.startedAt],
      ["Work completed", data.timeline.completedAt],
    ];
    timelineRows.forEach(([text, stamp], index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = left + col * (contentWidth / 2);
      const ty = y + row * 28;
      label(doc, text, x, ty, contentWidth / 2 - 10);
      value(doc, fmtDateTime(stamp), x, ty + 10, contentWidth / 2 - 10);
    });
    y += 66;
    rule(doc, y);
    y += 18;

    // ----- line items table
    label(doc, "Charges", left, y, contentWidth);
    y += 14;
    doc.rect(left, y, contentWidth, 20).fill("#fafafa");
    doc.font("Helvetica-Bold").fontSize(8).fillColor(COLORS.muted)
      .text("DESCRIPTION", left + 8, y + 6, { width: contentWidth - 140, characterSpacing: 0.6 })
      .text("AMOUNT", left + contentWidth - 128, y + 6, { width: 120, align: "right", characterSpacing: 0.6 });
    y += 24;

    data.lineItems.forEach((item) => {
      const rowHeight = 24;
      doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink).text(item.description, left + 8, y, { width: contentWidth - 150 });
      doc.font("Helvetica").fontSize(8).fillColor(COLORS.muted).text(item.detail, left + 8, y + 11, { width: contentWidth - 150 });
      doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink).text(money(item.amount), left + contentWidth - 128, y, { width: 120, align: "right" });
      y += rowHeight;
      rule(doc, y - 4, left + 8, right - 8);
    });

    y += 6;
    const summaryX = left + contentWidth / 2 + 20;
    const summaryWidth = contentWidth / 2 - 20;
    const summaryRow = (text, amount, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9.5).fillColor(bold ? COLORS.ink : COLORS.muted)
        .text(text, summaryX, y, { width: summaryWidth - 110 })
        .text(money(amount), summaryX + summaryWidth - 110, y, { width: 110, align: "right" });
      y += bold ? 20 : 16;
    };
    summaryRow("Labour / service charge", data.basePrice);
    summaryRow(`Materials & expenses (${data.materials.length})`, data.materialsTotal);
    rule(doc, y - 2, summaryX, right - 8);
    y += 6;
    doc.rect(summaryX - 8, y - 4, summaryWidth + 8, 26).fill("#fff7ed");
    summaryRow("Total payable", data.grandTotal, true);
    y += 4;

    doc.font("Helvetica-Oblique").fontSize(9).fillColor(COLORS.muted)
      .text(`Amount in words: ${data.amountInWords}`, left, y, { width: contentWidth / 2 });

    y += 34;
    rule(doc, y);
    y += 16;

    // ----- payment + notes
    label(doc, data.paymentStatus === "PAID" ? "Payment received" : "Payment pending", left, y, contentWidth - 200);
    value(doc,
      data.paymentStatus === "PAID"
        ? "This bill has been settled online. Thank you for your business."
        : `Please settle ${money(data.grandTotal)} from the booking page. This bill is marked PAYMENT DUE until then.`,
      left, y + 11, contentWidth - 200, { size: 9 });
    label(doc, "Amount due", right - 180, y, 180);
    doc.font("Helvetica-Bold").fontSize(16).fillColor(data.paymentStatus === "PAID" ? "#15803d" : COLORS.brand)
      .text(money(data.grandTotal), right - 180, y + 11, { width: 180, align: "right" });

    // ----- footer
    const footerY = doc.page.height - 96;
    rule(doc, footerY);
    doc.font("Helvetica").fontSize(8).fillColor(COLORS.muted)
      .text([
        data.company.gstin ? `GSTIN: ${data.company.gstin}` : "",
        data.company.email ? `Support: ${data.company.email}` : "",
        data.company.phone ? `Phone: ${data.company.phone}` : "",
      ].filter(Boolean).join("   •   ") || data.company.name, left, footerY + 10, { width: contentWidth })
      .text("This is a computer-generated bill and does not require a physical signature.", left, footerY + 24, { width: contentWidth })
      .text(`Generated on ${fmtDateTime(new Date())}`, left, footerY + 36, { width: contentWidth });

    doc.end();
  } catch (error) {
    reject(error);
  }
});

module.exports = { buildInvoice, renderInvoicePdf, amountInWords, humanDuration, money, fmtDate, fmtDateTime };
