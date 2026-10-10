import React, { useState, useEffect, useRef, useMemo, createContext, useContext } from "react";
import { Search, Star, MapPin, Phone, Menu, X, Shield, Clock, CheckCircle2, ArrowRight, Building2, Users, Eye, EyeOff, Calendar, Bell, LogOut, DollarSign, MessageSquare, Package, Briefcase, BarChart2, AlertCircle, ArrowLeft, User, LayoutDashboard, Check, PlusCircle, Edit2, Trash2, Download, Inbox, Zap, Droplets, Paintbrush, Hammer, UserPlus, Tag, Lock, Banknote, Settings, RefreshCw, Heart, SlidersHorizontal, FileText, CheckCheck } from "lucide-react";
import { adminApi, authApi, bookingApi, clearAuth, getStoredUser, notificationApi, packageApi, reviewApi, serviceApi, userApi, messageApi, paymentApi } from "../services/api";
import { useSaved } from "../services/favorites";
import { io } from "socket.io-client";
import { GoogleLogin } from "@react-oauth/google";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ThemeToggle } from "../components/ThemeToggle";
import { useTheme } from "../components/ThemeProvider";
import MapLocationPicker from "../components/MapLocationPicker";
import MapRouteViewer from "../components/MapRouteViewer";
import LanguageSelector from "../components/LanguageSelector";
const AppCtx = createContext({ page: "home", go: () => { }, goBack: () => { }, routeData: {}, isLoggedIn: false, setLoggedIn: () => { }, toast: () => { } });
const useApp = () => useContext(AppCtx);
// ─── Shared UI ────────────────────────────────────────────────────────────────
function StarRow({ rating, size = 13 }) {
  return (<div className="flex gap-0.5">
    {Array.from({ length: 5 }).map((_, i) => (<Star key={i} size={size} className={i < Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-gray-300"} />))}
  </div>);
}
function Badge({ children, color = "orange" }) {
  const cls = {
    orange: "bg-orange-100 text-orange-700",
    green: "bg-green-100 text-green-700",
    blue: "bg-blue-100 text-blue-700",
    red: "bg-red-100 text-red-700",
    gray: "bg-gray-100 text-gray-600",
    purple: "bg-purple-100 text-purple-700",
  };
  return (<span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${cls[color]}`}>
    {children}
  </span>);
}

function Skeleton({ className }) {
  return <div className={`animate-pulse bg-muted rounded ${className}`} />;
}

const fmtStamp = (value) => (value
  ? new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : "—");

const bookingStatusColor = (status) => (status === "COMPLETED" ? "blue"
  : status === "CANCELLED" || status === "REJECTED" ? "red"
    : status === "IN_PROGRESS" ? "orange" : "green");

/**
 * Fold a freshly returned booking into the row already on screen. The dashboards
 * map API bookings down to their own shape, so re-map only the fields that a
 * status change can alter (status, timeline, materials, totals, bill number).
 */
const mergeBookingUpdate = (item, updated) => {
  const materials = updated.materials || item.materials || [];
  return {
    ...item,
    status: updated.status,
    color: bookingStatusColor(updated.status),
    paymentStatus: updated.paymentStatus || item.paymentStatus,
    materials,
    total: (updated.price || item.rawPrice || 0) + materials.reduce((sum, material) => sum + (material.cost || 0), 0),
    invoiceNumber: updated.invoiceNumber || item.invoiceNumber || "",
    timeline: {
      requestedAt: updated.createdAt || item.timeline?.requestedAt,
      acceptedAt: updated.acceptedAt || item.timeline?.acceptedAt,
      startedAt: updated.startedAt || item.timeline?.startedAt,
      completedAt: updated.completedAt || item.timeline?.completedAt,
    },
  };
};

/**
 * Accepted → Started → Completed timeline for a booking.
 * Only shows milestones that have actually happened, so a fresh request doesn't
 * imply work was already completed.
 */
function WorkTimeline({ timeline, className = "" }) {
  const steps = [
    { label: "Requested", at: timeline?.requestedAt },
    { label: "Accepted", at: timeline?.acceptedAt },
    { label: "Work started", at: timeline?.startedAt },
    { label: "Work completed", at: timeline?.completedAt },
  ].filter((step) => step.at);
  if (steps.length < 2) return null;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] ${className}`}>
      {steps.map((step, index) => (
        <span key={step.label} className="inline-flex items-center gap-1.5">
          {index > 0 && <ArrowRight size={11} className="text-muted-foreground/60" />}
          {/* Only the completion milestone gets the green tick — "Work started"
              on an in-progress job must not look like it is finished. */}
          <span className={step.label === "Work completed" ? "flex items-center gap-1 font-semibold text-green-700" : "font-semibold text-foreground"}>
            {step.label === "Work completed" && <CheckCheck size={12} />}{step.label}
          </span>
          <span className="text-muted-foreground">{fmtStamp(step.at)}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * "Bill (PDF)" button. Owns its loading + error state so it can be dropped into
 * any dashboard without extra plumbing.
 */
function BillButton({ bookingId, invoiceNumber, label = "Bill (PDF)", className = "" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const download = async () => {
    setBusy(true);
    setError("");
    try {
      await bookingApi.downloadInvoice(bookingId, invoiceNumber ? `${invoiceNumber}.pdf` : undefined);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-accent/90 disabled:opacity-50 transition-colors ${className}`}
      >
        <FileText size={13} /> {busy ? "Preparing…" : label}
      </button>
      {error && <span className="text-[10px] text-red-600 max-w-52 text-right leading-tight">{error}</span>}
    </span>
  );
}

function ProviderOnboardingTour({ onComplete }) {
  const [step, setStep] = useState(0);
  const steps = [
    { title: "Welcome to BuildConnect!", desc: "Let's take a quick tour of your new Provider Dashboard." },
    { title: "Services & Packages", desc: "Use the sidebar to create your service listings and fixed-price packages." },
    { title: "Handle Bookings", desc: "View incoming requests, accept them, and use the map to navigate to your customer." },
    { title: "Track Earnings", desc: "Check the Earnings tab to see your completed jobs and revenue stream." }
  ];

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl relative animate-in zoom-in-95">
        <h3 className="text-xl font-bold mb-2">{steps[step].title}</h3>
        <p className="text-sm text-muted-foreground mb-8">{steps[step].desc}</p>
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <div key={i} className={`h-1.5 w-6 rounded-full transition-colors ${i === step ? 'bg-accent' : 'bg-border'}`} />
            ))}
          </div>
          <div className="flex gap-2">
            {step < steps.length - 1 ? (
              <button onClick={() => setStep(s => s + 1)} className="bg-accent text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-accent/90">Next</button>
            ) : (
              <button onClick={onComplete} className="bg-green-600 text-white px-5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2"><CheckCircle2 size={16} /> Get Started</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
function NotificationBell() {
  const { isLoggedIn, user } = useApp();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [liveToast, setLiveToast] = useState(null);

  useEffect(() => {
    if (!isLoggedIn) return undefined;
    notificationApi.list().then((data) => setItems(data.notifications || [])).catch(() => { });

    const socket = io((import.meta.env.VITE_API_URL || "http://localhost:5000/api").replace("/api", ""));
    const userId = user?._id || user?.id;
    if (userId) {
      socket.emit("register_user", userId);
    }
    socket.on("notification", (newNotification) => {
      setItems((prev) => [newNotification, ...prev]);
      setLiveToast(newNotification);
      setTimeout(() => setLiveToast(null), 5000);
    });

    return () => socket.disconnect();
  }, [isLoggedIn, user]);

  const unread = items.filter((item) => !item.isRead).length;
  const markRead = async (item) => {
    if (!item.isRead) {
      await notificationApi.markRead(item._id).catch(() => { });
      setItems((current) => current.map((entry) => entry._id === item._id ? { ...entry, isRead: true } : entry));
    }
  };
  return (<div className="relative">
    <button onClick={() => setOpen((value) => !value)} className="relative" aria-label="Notifications"><Bell size={18} className="text-white/70" />{unread > 0 && <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-accent rounded-full text-[9px] flex items-center justify-center font-bold">{unread}</span>}</button>
    {open && <div className="absolute right-0 top-8 z-50 w-80 max-w-[calc(100vw-2rem)] bg-card text-foreground border border-border rounded-xl shadow-xl p-3">
      <div className="flex items-center justify-between mb-2"><p className="font-semibold text-sm">Notifications</p>{unread > 0 && <button onClick={() => notificationApi.markAllRead().then(() => setItems((current) => current.map((item) => ({ ...item, isRead: true })))).catch(() => { })} className="text-xs text-accent">Mark all read</button>}</div>
      {items.length === 0 ? <p className="py-5 text-center text-xs text-muted-foreground">No notifications</p> : <div className="max-h-64 overflow-auto space-y-1">{items.slice(0, 8).map((item) => <button key={item._id} onClick={() => markRead(item)} className={`w-full text-left rounded-lg p-2 text-xs ${item.isRead ? "" : "bg-accent/10"}`}><p className="font-semibold">{item.title}</p><p className="text-muted-foreground mt-0.5">{item.message}</p></button>)}</div>}
    </div>}
    {liveToast && (
      <div className="fixed bottom-4 right-4 z-[9999] bg-white border border-border shadow-2xl rounded-xl p-4 w-72 animate-in slide-in-from-bottom-5">
        <div className="flex justify-between items-start mb-1">
          <p className="font-bold text-sm text-foreground">{liveToast.title}</p>
          <button onClick={() => setLiveToast(null)} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
        </div>
        <p className="text-xs text-muted-foreground">{liveToast.message}</p>
      </div>
    )}
  </div>);
}
// Auth-gate: show login prompt instead of booking if not signed in
function AuthGateModal({ onClose, onLogin }) {
  return (<div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
    <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
      <div className="h-1.5 bg-accent" />
      <div className="p-7 text-center">
        <div className="w-14 h-14 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <Lock size={26} className="text-accent" />
        </div>
        <h2 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-xl font-bold mb-2">Sign In Required</h2>
        <p className="text-sm text-muted-foreground mb-6">
          You need to be signed in to book a service. It only takes a minute to create a free account.
        </p>
        <button onClick={onLogin} className="w-full bg-accent text-white font-semibold py-3 rounded-lg hover:bg-accent/90 mb-3">
          Sign In to Book
        </button>
        <button onClick={onClose} className="w-full border border-border font-semibold py-2.5 rounded-lg hover:bg-muted text-sm text-muted-foreground">
          Maybe Later
        </button>
      </div>
    </div>
  </div>);
}
// ─── Data ─────────────────────────────────────────────────────────────────────
const CONSTRUCTION_SERVICES = [
  { icon: Zap, label: "Electrical", color: "bg-yellow-50 text-yellow-600" },
  { icon: Droplets, label: "Plumbing", color: "bg-sky-50 text-sky-600" },
  { icon: Paintbrush, label: "Painting", color: "bg-rose-50 text-rose-600" },
  { icon: Hammer, label: "Carpentry", color: "bg-green-50 text-green-700" },
];
/* const PROVIDERS = [
    { id: 1, name: "Devansh", trade: "Master Electrician", rating: 4.9, reviews: 218, location: "Downtown", jobs: 540, verified: true, image: "https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=400&h=400&fit=crop&auto=format", badge: "Top Rated", rate: "₹95/hr", avail: true, phone: "+1 (555) 312-0088", experience: "12 years", certifications: ["Licensed Master Electrician", "OSHA 30", "Insured & Bonded", "NEC 2023 Compliant"], about: "Specialising in full rewires, panel upgrades, and new-build electrical for residential and light commercial." },
    { id: 2, name: "Muthu", trade: "Architect & Interior Designer", rating: 4.8, reviews: 183, location: "Westside", jobs: 312, verified: true, image: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&h=400&fit=crop&auto=format", badge: "Expert", rate: "₹120/hr", avail: true, phone: "+1 (555) 091-7733", experience: "14 years", certifications: ["Licensed Architect", "LEED Certified", "Member AIA"], about: "Full-service residential design from concept to construction documents. 3D renders, permit drawings, and site supervision." },
    { id: 3, name: "karthi", trade: "Licensed Plumber", rating: 4.9, reviews: 401, location: "Northgate", jobs: 890, verified: true, image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&auto=format", badge: "Pro", rate: "₹80/hr", avail: false, phone: "+1 (555) 448-2291", experience: "10 years", certifications: ["Licensed Master Plumber", "Insured & Bonded"], about: "Emergency repairs to full new-build plumbing. Fast, tidy, and reliable. Most jobs same or next day." },
    { id: 4, name: "Nick", trade: "Painter & Decorator", rating: 4.7, reviews: 256, location: "Midtown", jobs: 445, verified: true, image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop&auto=format", badge: "", rate: "₹60/hr", avail: true, phone: "+1 (555) 778-3321", experience: "8 years", certifications: ["Certified Painter", "Insured"], about: "Interior and exterior painting. Premium-grade materials, minimal disruption, zero mess left behind." },
    { id: 5, name: "Siva", trade: "Master Carpenter", rating: 4.9, reviews: 97, location: "Southside", jobs: 188, verified: true, image: "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=400&h=400&fit=crop&auto=format", badge: "Top Rated", rate: "₹85/hr", avail: false, phone: "+1 (555) 445-9900", experience: "15 years", certifications: ["Journeyman Carpenter", "Insured"], about: "Custom cabinetry, fitted wardrobes, flooring, and structural carpentry. Every piece built to millimetre precision." },
    { id: 6, name: "Hima", trade: "General Contractor", rating: 4.9, reviews: 54, location: "Suburbs", jobs: 120, verified: true, image: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=400&h=400&fit=crop&auto=format", badge: "Certified", rate: "From ₹50k", avail: true, phone: "+1 (555) 388-1200", experience: "20 years", certifications: ["General Contractor License", "Bonded & Insured", "ICC Certified"], about: "Full-service general contracting for new residential builds, additions, and major renovations up to ₹500k." },
]; */
const PROVIDERS = [];
/* const PACKAGES = [
    {
        id: 1, title: "Complete Home Renovation – Premium", category: "Renovation",
        description: "Full-scale interior renovation: kitchen, bathrooms, flooring, painting, and electrical upgrades. Project-managed with weekly reports.",
        price: "₹45,000", duration: "6–8 weeks", rating: 4.9, reviews: 38, tag: "Best Value",
        providerId: 3, providerName: "Darius Okafor", providerImage: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&auto=format", providerTrade: "Licensed Plumber",
        helpers: [{ name: "prajith K.", role: "Electrician", image: "https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=60&h=60&fit=crop&auto=format" }, { name: "Nina P.", role: "Painter", image: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=60&h=60&fit=crop&auto=format" }, { name: "Carlos R.", role: "Tiler", image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=60&h=60&fit=crop&auto=format" }],
        includes: ["Full kitchen remodel", "2 bathroom renovation", "Hardwood flooring", "Full interior repaint", "Electrical panel upgrade", "Dedicated project manager", "Post-completion clean-up"],
        image: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=700&h=400&fit=crop&auto=format",
    },
    {
        id: 2, title: "New House Foundation & Structural Build", category: "New Construction",
        description: "Foundation, framing, roofing skeleton, and utility rough-in for new residential construction up to 2,500 sq ft.",
        price: "₹85,000", duration: "3–4 months", rating: 4.9, reviews: 22, tag: "Top Rated",
        providerId: 6, providerName: "Summit Builders", providerImage: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=100&h=100&fit=crop&auto=format", providerTrade: "General Contractor",
        helpers: [{ name: "ram S.", role: "Structural Engineer", image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=60&h=60&fit=crop&auto=format" }, { name: "Marco V.", role: "Concrete Specialist", image: "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=60&h=60&fit=crop&auto=format" }, { name: "Priya A.", role: "MEP Coordinator", image: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=60&h=60&fit=crop&auto=format" }, { name: "Hiro T.", role: "Framing Carpenter", image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=60&h=60&fit=crop&auto=format" }],
        includes: ["Site survey & soil testing", "Foundation excavation & pour", "Load-bearing wall framing", "Roof truss installation", "Rough plumbing & electrical", "Window & door framing", "Insulation (walls & roof)", "Structural inspection coordination"],
        image: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=700&h=400&fit=crop&auto=format",
    },
    {
        id: 3, title: "Architectural Design – Full Residential Package", category: "Architecture",
        description: "Concept to construction-ready blueprints: floor plans, 3D renders, elevations, and full permit documentation.",
        price: "₹8,500", duration: "4–6 weeks", rating: 4.8, reviews: 41, tag: "Expert",
        providerId: 2, providerName: "Sandra Khoury", providerImage: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100&h=100&fit=crop&auto=format", providerTrade: "Architect",
        helpers: [{ name: "mass .", role: "Structural Drafter", image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=60&h=60&fit=crop&auto=format" }, { name: "Chloe N.", role: "3D Visualization", image: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=60&h=60&fit=crop&auto=format" }],
        includes: ["Site visit & consultation", "3 concept options", "Detailed floor plans", "Elevation & section drawings", "3D renders (exterior & interior)", "Permit documentation", "2 revision rounds"],
        image: "https://images.unsplash.com/photo-1487958449943-2429e8be8625?w=700&h=400&fit=crop&auto=format",
    },
    {
        id: 4, title: "Kitchen & Bathroom Carpentry Package", category: "Carpentry",
        description: "Custom hardwood kitchen cabinets, vanity units, and fitted wardrobes. Measured and installed to the millimetre.",
        price: "₹7,200", duration: "2–3 weeks", rating: 4.9, reviews: 55, tag: "Popular",
        providerId: 5, providerName: "Tom Nakamura", providerImage: "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=100&h=100&fit=crop&auto=format", providerTrade: "Master Carpenter",
        helpers: [{ name: "karthi .", role: "Apprentice Carpenter", image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=60&h=60&fit=crop&auto=format" }],
        includes: ["Site measurement & design", "Custom hardwood fabrication", "Kitchen cabinet installation", "Bathroom vanity (custom)", "Fitted wardrobe (1 room)", "Hardware supply & fitting", "2-year workmanship warranty"],
        image: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=700&h=400&fit=crop&auto=format",
    },
    {
        id: 5, title: "Electrical + Plumbing Bundle – New Build Ready", category: "Electrical",
        description: "Coordinated rough-in and finish electrical & plumbing. One team, one schedule, zero conflicts.",
        price: "₹12,400", duration: "3–5 days", rating: 4.8, reviews: 29, tag: "Bundle Deal",
        providerId: 1, providerName: "Marcus Reyes", providerImage: "https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=100&h=100&fit=crop&auto=format", providerTrade: "Master Electrician",
        helpers: [{ name: "Dhariq.", role: "Licensed Plumber", image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=60&h=60&fit=crop&auto=format" }, { name: "Sam T.", role: "Electrical Apprentice", image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=60&h=60&fit=crop&auto=format" }],
        includes: ["200A panel installation", "Full copper wiring", "GFCI outlets in wet areas", "Rough & finish plumbing", "Hot water heater install", "Drainage & vent stack", "Code inspection coordination"],
        image: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=700&h=400&fit=crop&auto=format",
    },
    {
        id: 6, title: "Interior Painting – Full House Package", category: "Painting",
        description: "Whole-home professional painting: walls, ceilings, trims, and doors. Premium paint, zero mess left.",
        price: "₹3,800", duration: "3–4 days", rating: 4.7, reviews: 88, tag: "Popular",
        providerId: 4, providerName: "Leo Ferreira", providerImage: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&auto=format", providerTrade: "Painter & Decorator",
        helpers: [{ name: "vankat.", role: "Painter", image: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=60&h=60&fit=crop&auto=format" }, { name: "Felix B.", role: "Painter", image: "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=60&h=60&fit=crop&auto=format" }],
        includes: ["Surface preparation & patching", "Primer coat all surfaces", "2 top-coat on walls", "Ceilings painted bright white", "Trim, skirting & door frames", "Premium Sherwin-Williams paint", "Complete clean-up & furniture reset"],
        image: "https://images.unsplash.com/photo-1562259949-e8e7689d7828?w=700&h=400&fit=crop&auto=format",
    },
]; */
const PACKAGES = [];
// STATS removed to avoid hardcoded values
const TAMIL_NADU_CITIES = ["Ariyalur", "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore", "Dharmapuri", "Dindigul", "Erode", "Kallakurichi", "Kanchipuram", "Kanyakumari", "Karur", "Krishnagiri", "Madurai", "Mayiladuthurai", "Nagapattinam", "Namakkal", "Nilgiris", "Perambalur", "Pudukkottai", "Ramanathapuram", "Ranipet", "Salem", "Sivaganga", "Tenkasi", "Thanjavur", "Theni", "Thoothukudi", "Tiruchirappalli", "Trichy", "Tirunelveli", "Tirupathur", "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur", "Vellore", "Viluppuram", "Virudhunagar"];
// ─── Navbar ───────────────────────────────────────────────────────────────────
function Navbar() {
  const { go, isLoggedIn, setLoggedIn } = useApp();
  const [open, setOpen] = useState(false);
  const { count: savedCount } = useSaved();
  const navLinks = [
    { label: "Services", page: "services" },
    { label: "Packages", page: "packages" },
    { label: "Providers", page: "providers" },
  ];
  return (<header className="sticky top-0 z-50 bg-primary border-b border-white/10">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
      <button onClick={() => go("home")} className="flex items-center gap-2.5">
        <div className="w-8 h-8 bg-accent rounded flex items-center justify-center"><Building2 size={18} className="text-white" /></div>
        <span style={{ fontFamily: "'Roboto Slab',serif" }} className="text-lg font-bold text-white tracking-tight">Build<span className="text-accent">Connect</span></span>
      </button>
      <nav className="hidden md:flex items-center gap-7">
        {navLinks.map(l => <button key={l.label} onClick={() => go(l.page)} className="text-sm text-white/70 hover:text-white transition-colors">{l.label}</button>)}
        <button onClick={() => go("saved")} className="relative text-sm text-white/70 hover:text-white transition-colors flex items-center gap-1.5">
          <Heart size={15} /> Saved
          {savedCount > 0 && <span className="min-w-4 h-4 px-1 bg-accent rounded-full text-[9px] flex items-center justify-center font-bold text-white">{savedCount}</span>}
        </button>
      </nav>
      <div className="hidden md:flex items-center gap-3">
        {isLoggedIn ? (() => {
          const user = getStoredUser();
          return (
            <>
              <button onClick={() => go(user?.role === "provider" ? "provider-dashboard" : "customer-dashboard")} className="text-sm text-white/80 hover:text-white px-3 py-1.5 flex items-center gap-1.5">
                {user?.profileImage ? <img src={user.profileImage} alt="Profile" className="w-6 h-6 rounded-full object-cover border border-white/20" /> : <User size={15} />}
                Profile
              </button>
              <button onClick={() => { clearAuth(); setLoggedIn(false); go("home"); }} className="text-sm text-white/60 hover:text-white flex items-center gap-1"><LogOut size={14} />Sign out</button>
            </>
          );
        })() : (<>
          <button onClick={() => go("login")} className="text-sm text-white/80 hover:text-white px-3 py-1.5">Log in</button>
          <button onClick={() => go("register")} className="bg-accent text-white text-sm font-semibold px-4 py-2 rounded hover:bg-accent/90">Get Started</button>
        </>)}
      </div>
      <button className="md:hidden text-white" onClick={() => setOpen(!open)}>{open ? <X size={22} /> : <Menu size={22} />}</button>
    </div>
    {open && (<div className="md:hidden bg-primary border-t border-white/10 px-4 pb-4 flex flex-col gap-3 pt-3">
      {navLinks.map(l => <button key={l.label} onClick={() => { go(l.page); setOpen(false); }} className="text-sm text-white/70 hover:text-white py-1 text-left">{l.label}</button>)}
      <button onClick={() => { go("saved"); setOpen(false); }} className="text-sm text-white/70 hover:text-white py-1 text-left flex items-center gap-1.5">
        <Heart size={14} /> Saved{savedCount > 0 ? ` (${savedCount})` : ""}
      </button>
      {isLoggedIn ? (<>
        <button onClick={() => {
          const u = getStoredUser();
          go(u?.role === "provider" ? "provider-dashboard" : u?.role === "admin" ? "admin-dashboard" : "customer-dashboard");
          setOpen(false);
        }} className="text-sm text-white/70 hover:text-white py-1 text-left flex items-center gap-1.5">
          <LayoutDashboard size={14} /> My Dashboard
        </button>
        <button onClick={() => { clearAuth(); setLoggedIn(false); go("home"); }} className="border border-white/30 text-white text-sm py-2 rounded">Sign Out</button>
      </>) : (<div className="flex gap-3 pt-2">
        <button onClick={() => go("login")} className="flex-1 border border-white/30 text-white text-sm py-2 rounded">Log in</button>
        <button onClick={() => go("register")} className="flex-1 bg-accent text-white text-sm font-semibold py-2 rounded">Get Started</button>
      </div>)}
    </div>)}
  </header>);
}
function Footer() {
  const { go } = useApp();
  return (<footer className="bg-primary text-primary-foreground mt-auto">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
      <div className="grid md:grid-cols-4 gap-10 mb-10">
        <div>
          <div className="flex items-center gap-2 mb-3"><div className="w-7 h-7 bg-accent rounded flex items-center justify-center"><Building2 size={14} className="text-white" /></div><span style={{ fontFamily: "'Roboto Slab',serif" }} className="font-bold">Build<span className="text-accent">Connect</span></span></div>
          <p className="text-xs text-white/40 leading-relaxed">Connecting homeowners with trusted construction professionals.</p>
        </div>
        {[{ h: "Services", ls: ["Electrical", "Plumbing", "Painting", "Carpentry"] }, { h: "Company", ls: ["About Us", "Careers", "Blog", "Contact"] }, { h: "Legal", ls: ["Privacy", "Terms", "Cookies"] }].map(({ h, ls }) => (<div key={h}><h4 style={{ fontFamily: "'Roboto Slab',serif" }} className="font-bold text-sm mb-3">{h}</h4><ul className="space-y-2">{ls.map(l => <li key={l}><a href="#" className="text-xs text-white/40 hover:text-white">{l}</a></li>)}</ul></div>))}
      </div>
      <div className="border-t border-white/10 pt-5 flex justify-between items-center">
        <p className="text-xs text-white/30">© 2026 BuildConnect Inc. All rights reserved.</p>
        <button onClick={() => go("home")} className="text-xs text-white/30 hover:text-white/60">Back to top ↑</button>
      </div>
    </div>
  </footer>);
}
// ─── HOME PAGE ────────────────────────────────────────────────────────────────
function HomePage() {
  const { go } = useApp();
  const [q, setQ] = useState("");
  const [packages, setPackages] = useState([]);
  const [providers, setProviders] = useState([]);

  useEffect(() => {
    Promise.all([packageApi.list(), userApi.providers()]).then(([pkgItems, provs]) => {
      setPackages(pkgItems);
      setProviders(provs);
    }).catch(() => {});
  }, []);
  const HOW_STEPS = [
    { title: "Browse Packages or Providers", desc: "Search by trade, location, or browse provider-posted packages with fixed pricing.", icon: Search },
    { title: "Sign In to Book", desc: "Create a free account or sign in. Your details are saved for faster future bookings.", icon: User },
    { title: "Confirm Your Job", desc: "Pick a date, describe the work. No upfront payment — all billing is post-job.", icon: CheckCircle2 },
    { title: "Pay After Completion", desc: "Once satisfied, pay directly to the provider. No hidden platform fees.", icon: Banknote },
  ];
  return (<div className="min-h-screen flex flex-col bg-background">
    <Navbar />
    {/* Hero */}
    <section className="relative bg-primary text-primary-foreground overflow-hidden">
      <div className="absolute inset-0 opacity-5" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.3) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.3) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
      <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-accent" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20 md:py-28 relative">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-3 py-1 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <span className="text-xs text-white/80 font-medium tracking-wide uppercase">Post-Paid · No Upfront Cost · Book Freely</span>
            </div>
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-5xl md:text-6xl font-extrabold leading-tight mb-5">Build Your<br /><span className="text-accent">Dream.</span></h1>
            <p className="text-white/60 text-lg leading-relaxed mb-8 max-w-md">Connect with construction professionals. Browse packages, pick a provider, book your job — and pay only after the work is done.</p>
            <div className="flex items-center bg-white rounded-lg overflow-hidden shadow-xl mb-6 max-w-lg">
              <Search size={18} className="ml-4 text-muted-foreground shrink-0" />
              <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") go("services", { search: q.trim() }); }} placeholder="Search services or packages…" className="flex-1 px-3 py-3.5 text-foreground text-sm outline-none bg-transparent placeholder:text-muted-foreground" />
              <button onClick={() => go("services", { search: q.trim() })} className="bg-accent text-white text-sm font-semibold px-5 py-3.5 hover:bg-accent/90">Find Pros</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {["Electrical", "Plumbing", "Painting", "Carpentry"].map(t => (<button key={t} onClick={() => go("services", { category: t })} className="text-xs bg-white/10 border border-white/20 text-white/70 hover:text-white rounded-full px-3 py-1 transition-colors">{t}</button>))}
            </div>
          </div>
          <div className="relative hidden md:block">
            <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
              <img src="https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=700&h=500&fit=crop&auto=format" alt="Construction professionals at work" className="w-full h-80 object-cover opacity-90" />
              {/* Post-paid badge */}
              <div className="absolute bottom-4 left-4 bg-white rounded-xl p-3 shadow-xl">
                <div className="flex items-center gap-2 mb-1">
                  <Banknote size={14} className="text-green-600" />
                  <span className="text-xs font-bold text-green-700 uppercase tracking-wide">Post-Paid Booking</span>
                </div>
                <p className="text-xs text-muted-foreground">No charge until job is complete</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    {/* Stats section removed to avoid hardcoded dummy data */}
    {/* Post-paid banner */}
    <section className="bg-green-50 border-b border-green-200 py-4">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-center gap-6 flex-wrap text-sm text-green-800">
        <span className="flex items-center gap-2"><Banknote size={16} className="text-green-600" /><strong>Post-Paid Only</strong> — you never pay before the job is done</span>
        <span className="text-green-300 hidden md:block">|</span>
        <span className="flex items-center gap-2"><Lock size={14} className="text-green-600" />Sign in required to book — free & instant</span>
        <span className="text-green-300 hidden md:block">|</span>
        <span className="flex items-center gap-2"><CheckCircle2 size={14} className="text-green-600" />All providers verified</span>
      </div>
    </section>

    {/* Services */}
    <section className="py-20 max-w-7xl mx-auto px-4 sm:px-6">
      <div className="flex items-end justify-between mb-10">
        <div>
          <p className="text-xs font-semibold tracking-widest uppercase text-accent mb-2">Construction Specialties</p>
          <h2 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-3xl md:text-4xl font-bold">Our Service Categories</h2>
        </div>
        <button onClick={() => go("services")} className="hidden md:flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">View all <ArrowRight size={15} /></button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {CONSTRUCTION_SERVICES.map(({ icon: Icon, label, count, color }) => (<button key={label} onClick={() => go("services", { category: label })} className="group bg-card border border-border rounded-xl p-5 text-left hover:border-accent/50 hover:shadow-md transition-all duration-200">
          <div className={`w-11 h-11 rounded-lg flex items-center justify-center mb-4 ${color}`}><Icon size={22} /></div>
          <p className="font-semibold text-foreground text-sm group-hover:text-accent transition-colors">{label}</p>
        </button>))}
      </div>
    </section>

    {/* Featured Packages */}
    <section className="py-20 bg-secondary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-end justify-between mb-10">
          <div>
            <p className="text-xs font-semibold tracking-widest uppercase text-accent mb-2">Provider-Posted</p>
            <h2 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-3xl md:text-4xl font-bold">Featured Packages</h2>
            <p className="text-sm text-muted-foreground mt-2">Each package includes the lead provider's full team. Pay after completion.</p>
          </div>
          <button onClick={() => go("packages")} className="hidden md:flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">Browse all <ArrowRight size={15} /></button>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {packages.slice(0, 3).map(pkg => <PackageCard key={pkg._id || pkg.id} pkg={pkg} />)}
        </div>
      </div>
    </section>

    {/* Featured Providers */}
    <section className="py-20 max-w-7xl mx-auto px-4 sm:px-6">
      <div className="flex items-end justify-between mb-10">
        <div>
          <p className="text-xs font-semibold tracking-widest uppercase text-accent mb-2">Top Professionals</p>
          <h2 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-3xl md:text-4xl font-bold">Featured Providers</h2>
        </div>
        <button onClick={() => go("providers")} className="hidden md:flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">Browse all <ArrowRight size={15} /></button>
      </div>
      <div className="grid md:grid-cols-3 gap-6">
        {providers.slice(0, 3).map(p => <ProviderCard key={p._id || p.id} provider={p} />)}
      </div>
    </section>

    {/* How it works */}
    <section className="bg-primary text-primary-foreground py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-14">
          <p className="text-xs font-semibold tracking-widest uppercase text-accent mb-2">Simple Process</p>
          <h2 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-3xl md:text-4xl font-bold">How It Works</h2>
        </div>
        <div className="grid md:grid-cols-4 gap-6">
          {HOW_STEPS.map(({ title, desc, icon: Icon }, idx) => (<div key={title} className="relative">
            {idx < 3 && <div className="hidden md:block absolute top-8 left-[calc(50%+2.5rem)] right-0 h-px bg-white/15" />}
            <div className="flex flex-col items-center text-center">
              <div className="relative mb-4">
                <div className="w-16 h-16 rounded-full border-2 border-accent/40 bg-white/5 flex items-center justify-center"><Icon size={26} className="text-accent" /></div>
                <span style={{ fontFamily: "'DM Mono',monospace" }} className="absolute -top-2 -right-2 bg-accent text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">{idx + 1}</span>
              </div>
              <h3 style={{ fontFamily: "'Roboto Slab',serif" }} className="font-bold text-base mb-2">{title}</h3>
              <p className="text-sm text-white/55 leading-relaxed">{desc}</p>
            </div>
          </div>))}
        </div>
        <div className="mt-12 text-center flex flex-col sm:flex-row gap-4 justify-center">
          <button onClick={() => go("packages")} className="bg-accent text-white font-semibold px-7 py-3 rounded-lg hover:bg-accent/90">Browse Packages</button>
          <button onClick={() => go("register")} className="border border-white/30 text-white font-semibold px-7 py-3 rounded-lg hover:bg-white/10">Join as a Provider</button>
        </div>
      </div>
    </section>

    <section className="bg-muted py-10 border-y border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-3 gap-6 text-center">
          {[{ icon: Shield, label: "All Providers Vetted", sub: "License & insurance verified" }, { icon: Banknote, label: "Pay After Job Done", sub: "Zero upfront cost, ever" }, { icon: Users, label: "Team Transparency", sub: "Know who's on every job" }].map(({ icon: Icon, label, sub }) => (<div key={label} className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center"><Icon size={20} className="text-accent" /></div>
            <p className="font-semibold text-sm">{label}</p>
            <p className="text-xs text-muted-foreground hidden md:block">{sub}</p>
          </div>))}
        </div>
      </div>
    </section>
    <Footer />
  </div>);
}
// ─── PACKAGE CARD ─────────────────────────────────────────────────────────────
function PackageCard({ pkg }) {
  const { go } = useApp();
  const id = pkg._id || pkg.id;
  const image = pkg.images?.[0] || pkg.image || "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=700&h=400&fit=crop";
  const title = pkg.title;
  const category = pkg.category;
  const helpers = pkg.helpers || [];
  const providerName = pkg.provider?.name || pkg.providerName || "Provider";
  const providerImage = pkg.provider?.profileImage || pkg.providerImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(providerName)}&background=random`;
  const rating = pkg.provider?.rating || pkg.rating || 0;
  const reviews = pkg.provider?.reviews || pkg.reviews || 0;
  const duration = pkg.duration;
  const price = pkg.price;

  return (<div className="bg-card border border-border rounded-2xl overflow-hidden hover:shadow-lg hover:border-accent/30 transition-all duration-300 group cursor-pointer flex flex-col" onClick={() => go("package-details", { packageId: id })}>
    <div className="h-44 bg-muted relative overflow-hidden shrink-0">
      <img src={image} alt={title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
      <span className="absolute top-3 left-3 bg-accent text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase">{category}</span>
      <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
        <div className="flex -space-x-1.5">
          {helpers.slice(0, 3).map((h, i) => <img key={i} src={h.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(h.name || 'H')}&background=random`} alt={h.name} className="w-6 h-6 rounded-full border-2 border-white object-cover" />)}
        </div>
        <span className="text-white text-[10px] font-semibold bg-black/40 rounded px-1.5 py-0.5">{helpers.length} helper{helpers.length !== 1 ? "s" : ""} included</span>
      </div>
    </div>
    <div className="p-5 flex flex-col flex-1">
      <div className="flex justify-between items-start mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-accent bg-accent/10 px-2 py-0.5 rounded-full">{category}</span>
        <div className="flex items-center gap-1 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-100">
          <Star size={10} className="text-amber-500 fill-amber-500" />
          <span className="text-[10px] font-bold text-amber-700">{rating}</span>
        </div>
      </div>
      <h3 className="font-semibold text-base mb-1.5 group-hover:text-accent transition-colors line-clamp-2 leading-snug">{title}</h3>
      {pkg.description && <p className="text-xs text-muted-foreground line-clamp-2 mb-3 leading-relaxed">{pkg.description}</p>}
      
      {pkg.includes?.length > 0 && (
        <div className="mb-4 bg-muted/30 p-2.5 rounded-lg border border-border/50">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">What's Included:</p>
          <div className="space-y-1">
            {pkg.includes.slice(0, 2).map((item, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-foreground">
                <CheckCircle2 size={13} className="text-green-500 shrink-0 mt-0.5" />
                <span className="line-clamp-1">{item}</span>
              </div>
            ))}
            {pkg.includes.length > 2 && <span className="text-[10px] text-accent font-medium pl-5 block mt-1">+{pkg.includes.length - 2} more item{pkg.includes.length - 2 !== 1 ? 's' : ''}</span>}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4 pt-4 border-t border-border">
        <div className="flex items-center gap-2">
          <img src={providerImage} alt={providerName} className="w-6 h-6 rounded-full object-cover border border-border" />
          <div className="flex flex-col">
            <span className="text-xs font-semibold">{providerName}</span>
            <span className="text-[10px] text-muted-foreground">Provider</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-md"><Clock size={12} />{duration}</div>
      </div>
      
      <div className="flex items-center justify-between mt-auto">
        <div>
          <span style={{ fontFamily: "'Roboto Slab',serif" }} className="text-xl font-bold text-foreground">₹{price}</span>
          <p className="text-[10px] text-green-600 font-semibold tracking-wide uppercase mt-0.5">Post-paid</p>
        </div>
        <button onClick={e => { e.stopPropagation(); go("package-details", { packageId: id }); }} className="bg-foreground text-background text-xs font-semibold px-4 py-2 rounded-lg hover:bg-accent hover:text-white transition-all shadow-md group-hover:shadow-lg">View Package</button>
      </div>
    </div>
  </div>);
}
// ─── PROVIDER CARD ────────────────────────────────────────────────────────────
function ProviderCard({ provider: p }) {
  const { go } = useApp();
  const id = p._id || p.id;
  const name = p.name || "Provider";
  const image = p.profileImage || p.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;
  const avail = p.availability ?? p.avail ?? true;
  const verified = p.isApproved ?? p.verified ?? true;
  const trade = p.trade || "Professional";
  const rating = p.rating || 0;
  const reviews = p.reviews || 0;
  const location = p.city || p.location || "Tamil Nadu";
  const jobs = p.jobs || 0;
  
  return (<div className="bg-card border border-border rounded-2xl overflow-hidden hover:shadow-lg hover:border-accent/30 transition-all group cursor-pointer" onClick={() => go("provider-profile", { providerId: id })}>
    <div className="h-40 bg-muted relative overflow-hidden">
      <img src={image} alt={name} className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-500" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />

    </div>
    <div className="p-5">
      <div className="flex items-start justify-between mb-1">
        <h3 className="font-semibold">{name}</h3>
        {verified && <div className="flex items-center gap-1 text-green-600 text-[10px] font-bold"><CheckCircle2 size={12} />Verified</div>}
      </div>
      <p className="text-xs text-muted-foreground mb-3">{trade}</p>
      <div className="flex items-center gap-1.5 mb-3"><StarRow rating={rating} /><span className="text-xs font-medium">{rating}</span><span className="text-xs text-muted-foreground">({reviews})</span></div>
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-4">
        <span className="flex items-center gap-1"><MapPin size={11} />{location}</span>
        <span>{jobs} jobs</span>
      </div>
      <button onClick={e => { e.stopPropagation(); go("provider-profile", { providerId: id }); }} className="w-full bg-primary text-primary-foreground text-sm font-semibold py-2.5 rounded-lg hover:bg-accent transition-colors">View Profile & Book</button>
    </div>
  </div>);
}
// ─── SERVICES PAGE ────────────────────────────────────────────────────────────
const SERVICE_CATEGORIES = ["All", "Plumbing", "Electrical", "Painting", "Carpentry"];
function ServicesPage() {
  const { go, routeData } = useApp();
  const { isSaved: isItemSaved, toggle: toggleSavedItem } = useSaved();
  const initialSearch = routeData?.search || "";
  const [search, setSearch] = useState(initialSearch);
  const [cat, setCat] = useState(routeData?.category || "All");
  const [sort, setSort] = useState("recommended");
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const loadServices = () => setReloadKey(key => key + 1);
  // Debounce typing so we don't hammer the API on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (cat !== "All") params.set("category", cat);
    serviceApi.list(params.toString())
      .then(items => { setServices(items); setError(""); })
      .catch(requestError => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [debouncedSearch, cat, reloadKey]);
  const cats = SERVICE_CATEGORIES;
  const filtered = useMemo(() => {
    const list = [...services];
    if (sort === "price-asc") list.sort((a, b) => Number(a.price) - Number(b.price));
    else if (sort === "price-desc") list.sort((a, b) => Number(b.price) - Number(a.price));
    else if (sort === "rating") list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else if (sort === "newest") list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return list;
  }, [services, sort]);
  return (<div className="min-h-screen flex flex-col bg-background">
    <Navbar />
    <div className="relative py-24 bg-primary overflow-hidden">
      <div className="absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-accent/60 via-primary to-primary"></div>
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 text-center">
        <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-4xl md:text-5xl font-extrabold text-white mb-6 tracking-tight">Construction <span className="text-accent">Services</span></h1>
        <p className="text-white/80 max-w-2xl mx-auto mb-10 text-lg">Browse and book top-rated construction and maintenance services, with transparent pricing and no upfront costs.</p>
        <div className="flex flex-col sm:flex-row items-center bg-white rounded-2xl sm:rounded-full overflow-hidden shadow-2xl max-w-3xl mx-auto p-2">
          <div className="flex items-center flex-1 w-full px-4 py-2 border-b sm:border-b-0 sm:border-r border-border/50">
            <Search size={20} className="text-muted-foreground shrink-0 mr-3" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search for plumbing, electrical..." className="flex-1 bg-transparent border-none outline-none text-foreground py-2" />
          </div>
          <button className="bg-accent text-white text-sm font-bold px-8 py-4 sm:py-3.5 rounded-xl sm:rounded-full w-full sm:w-auto mt-2 sm:mt-0 hover:bg-accent/90 transition-colors shadow-md hover:shadow-lg">Search Services</button>
        </div>
        <div className="flex gap-2 mt-8 flex-wrap justify-center max-w-3xl mx-auto">
          {cats.map(c => <button key={c} onClick={() => setCat(c)} className={`text-sm font-semibold px-5 py-2 rounded-full border transition-all duration-300 shadow-sm backdrop-blur-sm ${cat === c ? "bg-accent text-white border-accent scale-105" : "bg-white/10 text-white/80 border-white/20 hover:bg-white/20 hover:text-white"}`}>{c}</button>)}
        </div>
      </div>
    </div>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 flex-1 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4 border-b border-border pb-6">
        <p className="text-muted-foreground font-medium"><span className="text-foreground font-bold text-lg">{filtered.length}</span> services found{debouncedSearch ? <> for <span className="text-foreground font-semibold">“{debouncedSearch}”</span></> : null}</p>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-2">
            <SlidersHorizontal size={14} className="text-muted-foreground" />
            <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort services" className="bg-transparent text-sm font-medium outline-none">
              <option value="recommended">Recommended</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
              <option value="rating">Top Rated</option>
              <option value="newest">Newest</option>
            </select>
          </div>
          <div className="flex items-center gap-2 bg-green-50/80 backdrop-blur-md border border-green-200 rounded-xl px-4 py-2 shadow-sm">
            <Banknote size={16} className="text-green-600" />
            <span className="text-sm font-bold text-green-700">100% Post-paid Bookings</span>
          </div>
        </div>
      </div>
      {loading && <div className="py-20 flex justify-center"><div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin"></div></div>}
      {error && !loading && <div role="alert" className="py-16 text-center text-sm text-red-600 bg-red-50 rounded-2xl">{error}<button onClick={loadServices} className="block mx-auto mt-3 text-accent font-semibold hover:underline">Retry Loading</button></div>}
      {!loading && !error && filtered.length === 0 && <div className="py-24 text-center bg-card border border-border border-dashed rounded-3xl"><Search size={40} className="mx-auto mb-4 text-muted-foreground opacity-30" /><h3 className="text-xl font-bold mb-2">No services found</h3><p className="text-muted-foreground max-w-md mx-auto">We couldn't find any services matching your search criteria. Try adjusting your filters.</p></div>}
      {!loading && !error && filtered.length > 0 && <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filtered.map(svc => (<div key={svc._id} className="bg-card border border-border rounded-2xl overflow-hidden hover:shadow-xl hover:-translate-y-1 hover:border-accent/30 transition-all duration-300 group cursor-pointer flex flex-col" onClick={() => go("service-details", { serviceId: svc._id })}>
          <div className="relative h-48 bg-muted overflow-hidden">
            <img src={svc.images?.[0] || "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=400&h=300&fit=crop&auto=format"} alt={svc.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <button
              type="button"
              aria-label={isItemSaved(svc._id) ? "Remove from saved" : "Save service"}
              onClick={e => { e.stopPropagation(); toggleSavedItem({ id: svc._id, kind: "service", title: svc.name, image: svc.images?.[0] || "", price: svc.price, category: svc.category, providerName: svc.provider?.name || "" }); }}
              className={`absolute top-3 right-3 p-2 rounded-full backdrop-blur-sm shadow-md transition-all ${isItemSaved(svc._id) ? "bg-accent text-white" : "bg-white/90 text-foreground hover:text-accent"}`}
            >
              <Heart size={14} className={isItemSaved(svc._id) ? "fill-white" : ""} />
            </button>
          </div>
          <div className="p-5 flex-1 flex flex-col">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-accent mb-2 inline-block">{svc.category}</span>
            <h3 className="font-bold text-base mb-2 group-hover:text-accent transition-colors line-clamp-2">{svc.name}</h3>
            {svc.description && <p className="text-sm text-muted-foreground line-clamp-2 mb-4 leading-relaxed flex-1">{svc.description}</p>}
            
            <div className="flex items-center gap-2 mb-4 bg-muted/50 p-2 rounded-xl">
              <img src={svc.provider?.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(svc.provider?.name || 'Provider')}&background=random`} alt={svc.provider?.name || "Provider"} className="w-8 h-8 rounded-full object-cover border border-border shadow-sm" />
              <div className="overflow-hidden">
                <p className="text-xs font-semibold truncate">{svc.provider?.name || "Provider"}</p>
                <div className="flex items-center text-[10px] text-muted-foreground mt-0.5">
                  <Star size={10} className="text-amber-400 fill-amber-400 mr-0.5" /> <span>{svc.rating || 'New'}</span>
                  <span className="mx-1.5">•</span>
                  <MapPin size={10} className="mr-0.5" /> <span className="truncate">{svc.city}</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center justify-between pt-4 border-t border-border/60 mt-auto">
              <div>
                <span className="text-lg font-extrabold">₹{svc.price}</span>
                <p className="text-[10px] text-green-600 font-bold uppercase tracking-wide">Post-paid</p>
              </div>
              <button onClick={e => { e.stopPropagation(); go("service-details", { serviceId: svc._id }); }} className="bg-accent/10 text-accent group-hover:bg-accent group-hover:text-white text-sm font-bold px-4 py-2 rounded-xl transition-all duration-300">Details</button>
            </div>
          </div>
        </div>))}
      </div>}
    </div>
    <Footer />
  </div>);
}
function ServiceDetailsPage() {
  const { go, routeData, isLoggedIn } = useApp();
  const [showAuth, setShowAuth] = useState(false);
  const [service, setService] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [lightboxImg, setLightboxImg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (routeData?.serviceId) {
      Promise.all([
        serviceApi.get(routeData.serviceId),
        reviewApi.service(routeData.serviceId).catch(() => [])
      ])
      .then(([svc, revs]) => { setService(svc); setReviews(revs || []); })
      .catch(requestError => setError(requestError.message))
      .finally(() => setLoading(false));
    }
  }, [routeData?.serviceId]);
  const detailError = error || (!routeData?.serviceId ? "Service not found" : "");
  const detailLoading = Boolean(routeData?.serviceId) && loading;
  const handleBook = () => {
    if (!isLoggedIn) {
      setShowAuth(true);
    }
    else {
      go("booking", { bookingMode: "general", serviceId: routeData?.serviceId, providerId: service?.provider?._id || service?.provider });
    }
  };
  return (<div className="min-h-screen flex flex-col bg-background">
    <Navbar />
    {showAuth && <AuthGateModal onClose={() => setShowAuth(false)} onLogin={() => go("login", { redirect: { page: "booking", data: { bookingMode: "general", serviceId: routeData?.serviceId, providerId: service?.provider?._id || service?.provider } } })} />}
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex-1 w-full">
      <button onClick={() => go("services")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"><ArrowLeft size={15} />Back to Services</button>
      {detailLoading && <div className="py-20 text-center text-sm text-muted-foreground">Loading service...</div>}
      {detailError && !detailLoading && <div role="alert" className="py-20 text-center text-sm text-red-600">{detailError}</div>}
      {!detailLoading && !detailError && service && <>
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="rounded-2xl overflow-hidden h-72 bg-muted mb-6"><img src={service.images?.[0] || "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=900&h=400&fit=crop&auto=format"} alt={service.name} className="w-full h-full object-cover" /></div>
            <span className="text-xs font-bold uppercase tracking-wide text-accent">{service.category}</span>
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl md:text-3xl font-bold mt-1 mb-3">{service.name}</h1>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">{service.description}</p>
            <div className="grid sm:grid-cols-2 gap-3 mb-5 text-sm"><span className="flex items-center gap-2"><MapPin size={15} className="text-accent" />{service.city}</span><span className="flex items-center gap-2"><User size={15} className="text-accent" />{service.provider?.name || "Provider"}</span><span className="flex items-center gap-2"><Phone size={15} className="text-accent" />{service.provider?.phone || service.provider?.email || "Contact available after booking"}</span></div>
            <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 text-sm text-muted-foreground flex items-start gap-2">
              <Tag size={14} className="text-accent shrink-0 mt-0.5" />
              For bundled team packages, <button onClick={() => go("packages")} className="text-accent font-semibold hover:underline mx-1">browse Packages</button> where providers bring their own helpers.
            </div>
          </div>
          <div>
            <div className="bg-card border border-border rounded-2xl p-6 sticky top-20">
              <div className="flex items-baseline justify-between mb-4"><div><span className="text-2xl font-bold">₹{service.price}</span></div></div>
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4 flex items-center gap-2"><Banknote size={15} className="text-green-600 shrink-0" /><p className="text-xs text-green-700 font-semibold">Post-paid — you only pay after the job is complete and you're satisfied.</p></div>
              <div className="space-y-3 mb-5">
                <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Preferred Date</label><input type="date" className="w-full bg-input-background border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent" /></div>
                <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Notes</label><textarea rows={2} placeholder="Any special requirements…" className="w-full bg-input-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent resize-none placeholder:text-muted-foreground" /></div>
              </div>
              <button onClick={handleBook} className="w-full bg-accent text-white font-semibold py-3 rounded-lg hover:bg-accent/90 mb-3 flex items-center justify-center gap-2">
                {!isLoggedIn && <Lock size={14} />}Book Service
              </button>
              {!isLoggedIn && <p className="text-center text-xs text-muted-foreground">Sign in required to book</p>}
            </div>
          </div>
        </div>

        {/* Reviews Section */}
        <div className="mt-12">
          <div className="flex items-center gap-3 mb-6">
            <h2 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold">Customer Reviews</h2>
            <Badge color="orange">{reviews.length}</Badge>
          </div>
          {reviews.length === 0 ? (
            <div className="bg-muted border border-border border-dashed rounded-2xl p-10 text-center">
              <MessageSquare size={30} className="mx-auto text-muted-foreground opacity-30 mb-3" />
              <p className="text-sm font-semibold">No reviews yet for this service.</p>
              <p className="text-xs text-muted-foreground">Be the first to review after booking!</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-5">
              {reviews.map(rev => (
                <div key={rev._id} className="bg-card border border-border rounded-2xl p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-sm font-bold text-accent shrink-0 overflow-hidden">
                        {rev.customer?.profileImage ? <img src={rev.customer.profileImage} className="w-full h-full object-cover" alt={rev.customer?.name} /> : (rev.customer?.name || "U")[0]}
                      </div>
                      <div>
                        <p className="font-bold text-sm">{rev.customer?.name || "Customer"}</p>
                        <p className="text-[10px] text-muted-foreground">{new Date(rev.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="bg-amber-50 px-2 py-1 rounded-lg border border-amber-100 flex items-center gap-1"><Star size={12} className="text-amber-500 fill-amber-500" /><span className="text-xs font-bold text-amber-700">{rev.rating}</span></div>
                  </div>
                  <p className="text-sm text-foreground/90 leading-relaxed mb-4">{rev.comment}</p>
                  
                  {rev.videos?.length > 0 && (
                    <div className="mb-4">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Video Review</p>
                      <video src={rev.videos[0]} controls className="w-full h-48 object-cover rounded-xl border border-border bg-black" />
                    </div>
                  )}

                  {rev.photos?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Photos</p>
                      <div className="flex gap-2 flex-wrap">
                        {rev.photos.map((photo, pi) => (
                          <button key={pi} onClick={() => setLightboxImg(photo)} className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-muted border border-border hover:border-accent hover:shadow-md transition-all relative group/photo">
                            <img src={photo} alt="" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/photo:opacity-100 transition-opacity flex items-center justify-center"><Search size={14} className="text-white drop-shadow-md" /></div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </>}
      
      {lightboxImg && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-200">
          <button onClick={() => setLightboxImg(null)} className="absolute top-4 right-4 sm:top-6 sm:right-6 text-white/50 hover:text-white bg-white/10 hover:bg-white/20 p-2 rounded-full transition-colors"><X size={24} /></button>
          <img src={lightboxImg} className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl" alt="Enlarged review photo" />
        </div>
      )}
    </div>
    <Footer />
  </div>);
}
// ─── PACKAGES PAGE ────────────────────────────────────────────────────────────
const PKG_CATS = ["All", "Plumbing", "Electrical", "Painting", "Carpentry"];
function PackagesPage() {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("All");
  const filtered = PACKAGES.filter(p => {
    if (cat !== "All" && p.category !== cat)
      return false;
    if (search && !p.title.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });
  return (<div className="min-h-screen flex flex-col bg-background">
    <Navbar />
    <div className="bg-primary py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center gap-2 mb-3"><Tag size={16} className="text-accent" /><p className="text-xs font-semibold tracking-widest uppercase text-accent">All packages posted by verified providers</p></div>
        <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-3xl font-bold text-white mb-4">Construction Packages</h1>
        <div className="flex items-center bg-white rounded-xl overflow-hidden shadow-xl max-w-2xl">
          <Search size={18} className="ml-4 text-muted-foreground shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search renovation, construction…" className="flex-1 px-3 py-3.5 text-sm outline-none bg-transparent placeholder:text-muted-foreground" />
          <button className="bg-accent text-white text-sm font-semibold px-5 py-3.5 hover:bg-accent/90">Search</button>
        </div>
        <div className="flex gap-2 mt-4 flex-wrap">
          {PKG_CATS.map(c => <button key={c} onClick={() => setCat(c)} className={`text-xs font-semibold px-4 py-1.5 rounded-full border transition-colors ${cat === c ? "bg-accent text-white border-accent" : "bg-white/10 text-white/70 border-white/20 hover:bg-white/20"}`}>{c}</button>)}
        </div>
      </div>
    </div>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex-1">
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-muted-foreground"><span className="font-bold text-foreground">{filtered.length}</span> packages available</p>
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5"><Banknote size={14} className="text-green-600" /><span className="text-xs font-semibold text-green-700">All post-paid — pay after completion</span></div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map(pkg => <PackageCard key={pkg.id} pkg={pkg} />)}
      </div>
    </div>
    <Footer />
  </div>);
}
// ─── PACKAGE DETAILS ──────────────────────────────────────────────────────────
function PackageDetailsPage() {
  const { go, routeData, isLoggedIn } = useApp();
  const pkg = PACKAGES.find(p => p.id === routeData?.packageId);
  const provider = pkg && PROVIDERS.find(p => p.id === pkg.providerId);
  const [tab, setTab] = useState("overview");
  const [showAuth, setShowAuth] = useState(false);
  if (!pkg) return <div className="min-h-screen flex flex-col bg-background"><Navbar /><div className="flex-1 py-20 text-center text-sm text-muted-foreground">No packages are available yet.</div><Footer /></div>;
  const handleBook = () => {
    if (!isLoggedIn) {
      setShowAuth(true);
    }
    else {
      go("booking", { bookingMode: "package", packageId: pkg.id });
    }
  };
  return (<div className="min-h-screen flex flex-col bg-background">
    <Navbar />
    {showAuth && <AuthGateModal onClose={() => setShowAuth(false)} onLogin={() => go("login")} />}
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex-1 w-full">
      <button onClick={() => go("packages")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"><ArrowLeft size={15} />Back to Packages</button>
      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="rounded-2xl overflow-hidden h-72 bg-muted mb-6 relative">
            <img src={pkg.image} alt={pkg.title} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
            {pkg.tag && <span className="absolute top-4 left-4 bg-accent text-white text-xs font-bold px-3 py-1 rounded uppercase">{pkg.tag}</span>}
          </div>
          <span className="text-xs font-bold uppercase tracking-wide text-accent">{pkg.category}</span>
          <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl md:text-3xl font-bold mt-1 mb-3">{pkg.title}</h1>
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            <StarRow rating={pkg.rating} size={15} /><span className="font-medium">{pkg.rating}</span>
            <span className="text-sm text-muted-foreground">({pkg.reviews} reviews)</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-sm text-muted-foreground flex items-center gap-1"><Clock size={13} />{pkg.duration}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-sm text-muted-foreground flex items-center gap-1"><Users size={13} />{pkg.helpers.length + 1} people on this job</span>
          </div>
          <div className="flex border-b border-border mb-6">
            {["overview", "team", "reviews"].map(t => (<button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-sm font-semibold capitalize border-b-2 -mb-px transition-colors ${tab === t ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t === "team" ? `Team (${pkg.helpers.length + 1})` : t}
            </button>))}
          </div>

          {tab === "overview" && (<div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-5">{pkg.description}</p>
            <h3 className="font-semibold mb-3">What's Included</h3>
            <ul className="space-y-2.5 mb-5">
              {pkg.includes.map(item => <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground"><CheckCircle2 size={15} className="text-accent shrink-0 mt-0.5" />{item}</li>)}
            </ul>
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
              <Banknote size={18} className="text-green-600 shrink-0" />
              <div><p className="text-sm font-semibold text-green-800">Post-Paid Booking</p><p className="text-xs text-green-700 mt-0.5">No upfront payment required. You confirm the job, the provider and their team complete it, and you pay only when satisfied.</p></div>
            </div>
          </div>)}

          {tab === "team" && (<div>
            <p className="text-sm text-muted-foreground mb-5">Full team composition for this package. The lead provider coordinates all helpers and is your single point of contact.</p>
            {/* Lead */}
            <div className="bg-primary text-primary-foreground rounded-2xl p-5 mb-4 flex items-start gap-4">
              <img src={pkg.providerImage} alt={pkg.providerName} className="w-14 h-14 rounded-xl object-cover border-2 border-accent shrink-0" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1"><h3 className="font-bold">{pkg.providerName}</h3><Badge color="orange">Lead Provider</Badge><Badge color="green"><CheckCircle2 size={10} />Verified</Badge></div>
                <p className="text-white/70 text-xs mb-2">{pkg.providerTrade}</p>
                <div className="flex items-center gap-3"><StarRow rating={provider.rating} size={12} /><span className="text-xs font-medium ml-1">{provider.rating}</span><span className="text-xs text-white/60">{provider.jobs} jobs done</span></div>
              </div>
              <button onClick={() => go("provider-profile", { providerId: pkg.providerId })} className="text-xs text-accent border border-accent/40 px-3 py-1.5 rounded-lg hover:bg-accent hover:text-white transition-colors shrink-0">View Profile</button>
            </div>
            {pkg.helpers.length > 0 && (<>
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><UserPlus size={15} className="text-accent" />Helpers Brought by Provider ({pkg.helpers.length})</h3>
              <div className="space-y-3 mb-4">
                {pkg.helpers.map((h, i) => (<div key={i} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
                  <img src={h.image} alt={h.name} className="w-11 h-11 rounded-full object-cover bg-muted border border-border shrink-0" />
                  <div className="flex-1"><p className="font-semibold text-sm">{h.name}</p><p className="text-xs text-muted-foreground">{h.role}</p></div>
                  <Badge color="gray">Helper</Badge>
                </div>))}
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
                <Users size={16} className="text-blue-600 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700"><strong>Total team: {pkg.helpers.length + 1} people.</strong> The lead provider coordinates all helpers and handles the full scope of work.</p>
              </div>
            </>)}
          </div>)}

          {tab === "reviews" && (<div className="space-y-5">
            {[{ name: "Carlos M.", date: "Jan 14, 2026", rating: 5, comment: "Exceptional team. Arrived punctually and finished ahead of schedule. The helpers were just as professional as the lead." }, { name: "Lily Zhang", date: "Dec 28, 2025", rating: 5, comment: "Loved that I could see the full team before booking. No surprises. All 4 of them were professional and tidy." }, { name: "Robert K.", date: "Nov 12, 2025", rating: 4, comment: "Good work overall. Post-paid model gave me confidence — I only paid once I was happy with everything." }].map(({ name, date, rating, comment }) => (<div key={name} className="border-b border-border pb-5 last:border-0">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-xs font-bold text-accent">{name[0]}</div><div><p className="text-sm font-semibold">{name}</p><p className="text-xs text-muted-foreground">{date}</p></div></div>
                <StarRow rating={rating} />
              </div>
              <p className="text-sm text-muted-foreground">{comment}</p>
            </div>))}
          </div>)}
        </div>

        {/* Sidebar */}
        <div>
          {/* Provider quick card */}
          <div className="bg-primary text-primary-foreground rounded-2xl p-5 mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-accent mb-3">Package by</p>
            <div className="flex items-center gap-3 mb-4">
              <img src={pkg.providerImage} alt={pkg.providerName} className="w-12 h-12 rounded-xl object-cover border border-white/20 shrink-0" />
              <div><p className="font-bold text-sm">{pkg.providerName}</p><p className="text-white/60 text-xs">{pkg.providerTrade}</p><div className="flex items-center gap-1 mt-0.5"><StarRow rating={provider.rating} size={11} /><span className="text-xs ml-1 text-white/70">{provider.rating}</span></div></div>
            </div>
            <button onClick={() => go("provider-profile", { providerId: pkg.providerId })} className="w-full border border-accent/50 text-accent text-xs font-semibold py-2 rounded-lg hover:bg-accent hover:text-white transition-colors">View Full Profile</button>
          </div>

          {/* Booking card */}
          <div className="bg-card border border-border rounded-2xl p-5 sticky top-20">
            <div className="flex items-baseline justify-between mb-1">
              <span style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold">{pkg.price}</span>
              <Badge color="green">Fixed Price</Badge>
            </div>
            <p className="text-xs text-green-600 font-semibold mb-4 flex items-center gap-1"><Banknote size={12} />Post-paid — no upfront charge</p>
            <div className="bg-muted rounded-xl p-3 mb-4">
              <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5"><Users size={13} className="text-accent" />Team on this Job</p>
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2">
                  <img src={pkg.providerImage} alt={pkg.providerName} className="w-7 h-7 rounded-full border-2 border-white object-cover" />
                  {pkg.helpers.slice(0, 3).map((h, i) => <img key={i} src={h.image} alt={h.name} className="w-7 h-7 rounded-full border-2 border-white object-cover" />)}
                </div>
                <span className="text-xs text-muted-foreground">{pkg.helpers.length + 1} people total</span>
              </div>
            </div>
            <div className="space-y-3 mb-4">
              <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Preferred Start Date</label><input type="date" className="w-full bg-input-background border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent" /></div>
              <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Notes</label><textarea rows={2} placeholder="Any specific requirements…" className="w-full bg-input-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent resize-none placeholder:text-muted-foreground" /></div>
            </div>
            <button onClick={handleBook} className="w-full bg-accent text-white font-semibold py-3 rounded-lg hover:bg-accent/90 mb-3 flex items-center justify-center gap-2">
              {!isLoggedIn && <Lock size={14} />}Book This Package
            </button>
            {!isLoggedIn && <p className="text-center text-xs text-muted-foreground mb-3">Sign in required to book</p>}
          </div>
        </div>
      </div>
    </div>
    <Footer />
  </div>);
}
// ─── PROVIDERS PAGE ───────────────────────────────────────────────────────────
function ProvidersPage() {
  const [search, setSearch] = useState("");
  const [tradeCat, setTradeCat] = useState("All");
  const filtered = PROVIDERS.filter(p => {
    if (tradeCat !== "All" && !p.trade.toLowerCase().includes(tradeCat.toLowerCase()))
      return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.trade.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });
  return (<div className="min-h-screen flex flex-col bg-background">
    <Navbar />
    <div className="bg-primary py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-3xl font-bold text-white mb-4">Construction Professionals</h1>
        <div className="flex items-center bg-white rounded-xl overflow-hidden shadow-xl max-w-lg">
          <Search size={18} className="ml-4 text-muted-foreground shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or trade…" className="flex-1 px-3 py-3 text-sm outline-none bg-transparent placeholder:text-muted-foreground" />
        </div>
        <div className="flex gap-2 mt-4 flex-wrap">
          {["All", "Electrician", "Plumber", "Architect", "Carpenter", "Painter", "Contractor"].map(c => <button key={c} onClick={() => setTradeCat(c)} className={`text-xs font-semibold px-4 py-1.5 rounded-full border transition-colors ${tradeCat === c ? "bg-accent text-white border-accent" : "bg-white/10 text-white/70 border-white/20 hover:bg-white/20"}`}>{c}</button>)}
        </div>
      </div>
    </div>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex-1">
      <p className="text-sm text-muted-foreground mb-6"><span className="font-bold text-foreground">{filtered.length}</span> professionals found</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map(p => <ProviderCard key={p.id} provider={p} />)}
      </div>
    </div>
    <Footer />
  </div>);
}
// ─── PROVIDER PROFILE PAGE ────────────────────────────────────────────────────
function ProviderProfilePage() {
  const { go, routeData, isLoggedIn } = useApp();
  const provider = PROVIDERS.find(p => p.id === routeData?.providerId);
  const providerPackages = provider ? PACKAGES.filter(p => p.providerId === provider.id) : [];
  const [tab, setTab] = useState("general");
  const [showAuth, setShowAuth] = useState(false);
  // General booking form state
  const [genDate, setGenDate] = useState("");
  const [genTime, setGenTime] = useState("");
  const [genDesc, setGenDesc] = useState("");
  const [extraHelpers, setExtraHelpers] = useState(0);
  if (!provider) return <div className="min-h-screen flex flex-col bg-background"><Navbar /><div className="flex-1 py-20 text-center text-sm text-muted-foreground">No provider profiles are available yet.</div><Footer /></div>;
  const handleBook = (type, pkgId) => {
    if (!isLoggedIn) {
      setShowAuth(true);
      return;
    }
    go("booking", { bookingMode: type, packageId: pkgId });
  };
  const submitGeneral = (e) => {
    e.preventDefault();
    if (!isLoggedIn) {
      setShowAuth(true);
      return;
    }
    go("booking", { bookingMode: "general" });
  };
  return (<div className="min-h-screen flex flex-col bg-background">
    <Navbar />
    {showAuth && <AuthGateModal onClose={() => setShowAuth(false)} onLogin={() => go("login")} />}
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex-1 w-full">
      <button onClick={() => go("providers")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"><ArrowLeft size={15} />Back</button>

      {/* Profile header */}
      <div className="bg-primary text-primary-foreground rounded-2xl overflow-hidden mb-6">
        <div className="h-40 relative">
          <img src="https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1200&h=300&fit=crop&auto=format" alt="Cover" className="w-full h-full object-cover opacity-40" />
        </div>
        <div className="px-6 pb-6 -mt-12">
          <div className="flex items-end gap-5">
            <img src={provider.image} alt={provider.name} className="w-20 h-20 rounded-2xl border-4 border-primary object-cover shrink-0 bg-muted" />
            <div className="pb-1">
              <div className="flex items-center gap-2 mb-1">
                <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-xl font-bold">{provider.name}</h1>
                {provider.verified && <Badge color="green"><CheckCircle2 size={10} />Verified</Badge>}
                {provider.badge && <Badge color="orange">{provider.badge}</Badge>}
              </div>
              <p className="text-white/70 text-sm">{provider.trade} · {provider.experience} experience</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-6 mt-5">
            {[{ icon: Star, label: `${provider.rating} Rating` }, { icon: CheckCircle2, label: `${provider.jobs} Jobs Done` }, { icon: MapPin, label: provider.location }, { icon: Package, label: `${providerPackages.length} Package${providerPackages.length !== 1 ? "s" : ""} Posted` }].map(({ icon: Icon, label }) => (<div key={label} className="flex items-center gap-1.5 text-sm text-white/70"><Icon size={15} className="text-accent" />{label}</div>))}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main tabs */}
        <div className="lg:col-span-2">
          <div className="flex border-b border-border mb-6 overflow-x-auto">
            {[
              { id: "general", label: "General Booking" },
              { id: "packages", label: `Packages (${providerPackages.length})` },
              { id: "reviews", label: "Reviews" },
              { id: "portfolio", label: "Portfolio" },
            ].map(t => (<button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${tab === t.id ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t.label}
            </button>))}
          </div>

          {/* ── GENERAL BOOKING TAB ── */}
          {tab === "general" && (<div>
            <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 mb-5 flex items-start gap-3">
              <AlertCircle size={16} className="text-accent shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold mb-0.5">General Booking — Custom Job</p>
                <p className="text-xs text-muted-foreground">Describe exactly what you need. {provider.name} will review and quote. No upfront cost — post-paid only. You can also request extra helpers if needed.</p>
              </div>
            </div>

            <form onSubmit={submitGeneral} className="space-y-5">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Preferred Date</label>
                  <input type="date" value={genDate} onChange={e => setGenDate(e.target.value)} className="w-full bg-input-background border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Preferred Time</label>
                  <select value={genTime} onChange={e => setGenTime(e.target.value)} className="w-full bg-input-background border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-accent">
                    <option value="">Select time slot</option>
                    {["8 AM – 12 PM", "12 PM – 4 PM", "4 PM – 8 PM", "Flexible"].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Property Address</label>
                <input placeholder="Door number, street, Tamil Nadu" className="w-full bg-input-background border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-accent placeholder:text-muted-foreground" />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Describe the Job</label>
                <textarea value={genDesc} onChange={e => setGenDesc(e.target.value)} rows={4} placeholder="Describe the work needed in as much detail as possible — scope, materials, access, any special requirements…" className="w-full bg-input-background border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-accent resize-none placeholder:text-muted-foreground" />
              </div>

              {/* Extra helpers section */}
              <div className="bg-muted rounded-xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-sm flex items-center gap-2"><UserPlus size={15} className="text-accent" />Request Extra Helpers</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">If your job is large, you can request the provider to bring additional helpers. This may affect the final price.</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setExtraHelpers(Math.max(0, extraHelpers - 1))} className="w-8 h-8 rounded-lg border border-border flex items-center justify-center font-bold text-lg hover:bg-card disabled:opacity-40" disabled={extraHelpers === 0}>−</button>
                  <div className="flex-1 text-center">
                    <span style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold">{extraHelpers}</span>
                    <p className="text-xs text-muted-foreground">extra helper{extraHelpers !== 1 ? "s" : ""} requested</p>
                  </div>
                  <button type="button" onClick={() => setExtraHelpers(Math.min(5, extraHelpers + 1))} className="w-8 h-8 rounded-lg border border-border flex items-center justify-center font-bold text-lg hover:bg-card">+</button>
                </div>
                {extraHelpers > 0 && (<div className="mt-3 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                  <Users size={13} className="text-blue-600" />
                  <p className="text-xs text-blue-700">
                    Total team: <strong>{extraHelpers + 1} people</strong> ({provider.name} + {extraHelpers} helper{extraHelpers > 1 ? "s" : ""}). Provider will confirm availability.
                  </p>
                </div>)}
              </div>

              <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
                <Banknote size={16} className="text-green-600 shrink-0" />
                <div><p className="text-sm font-semibold text-green-800">Post-Paid — No Upfront Cost</p><p className="text-xs text-green-700 mt-0.5">The provider will assess and quote. You only pay after the work is completed and you're happy with it.</p></div>
              </div>

              <button type="submit" className="w-full bg-accent text-white font-semibold py-3 rounded-lg hover:bg-accent/90 flex items-center justify-center gap-2">
                {!isLoggedIn && <Lock size={14} />}
                {isLoggedIn ? "Send Booking Request" : "Sign In to Book"}
              </button>
            </form>
          </div>)}

          {/* ── PACKAGES TAB ── */}
          {tab === "packages" && (<div>
            <p className="text-sm text-muted-foreground mb-5">
              Packages posted by {provider.name}. Each package has fixed pricing and a defined team. <span className="text-green-600 font-semibold">All post-paid.</span>
            </p>
            {providerPackages.length === 0 ? (<div className="text-center py-12 bg-muted rounded-xl">
              <Package size={36} className="mx-auto text-muted-foreground mb-3" />
              <p className="font-semibold">No packages posted yet</p>
              <p className="text-sm text-muted-foreground mt-1">Use General Booking to request a custom job</p>
            </div>) : (<div className="space-y-4">
              {providerPackages.map(pkg => (<div key={pkg.id} className="bg-card border border-border rounded-xl overflow-hidden hover:border-accent/40 hover:shadow-md transition-all cursor-pointer group" onClick={() => go("package-details", { packageId: pkg.id })}>
                <div className="flex items-stretch">
                  <img src={pkg.image} alt={pkg.title} className="w-32 object-cover shrink-0 group-hover:opacity-90 transition-opacity" />
                  <div className="p-4 flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <div>
                        <span className="text-[10px] font-bold uppercase text-accent">{pkg.category}</span>
                        <h3 className="font-semibold text-sm group-hover:text-accent transition-colors">{pkg.title}</h3>
                      </div>
                      <div className="text-right shrink-0">
                        <p style={{ fontFamily: "'Roboto Slab',serif" }} className="font-bold text-accent">{pkg.price}</p>
                        <p className="text-[10px] text-green-600 font-semibold">Post-paid</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
                      <span className="flex items-center gap-1"><Clock size={11} />{pkg.duration}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1"><StarRow rating={pkg.rating} size={11} />{pkg.rating} ({pkg.reviews})</span>
                    </div>
                    {/* Team row */}
                    <div className="flex items-center gap-2 mt-auto">
                      <div className="flex -space-x-1.5">
                        <img src={pkg.providerImage} alt={pkg.providerName} className="w-6 h-6 rounded-full border-2 border-white object-cover" />
                        {pkg.helpers.slice(0, 3).map((h, i) => <img key={i} src={h.image} alt={h.name} className="w-6 h-6 rounded-full border-2 border-white object-cover" />)}
                      </div>
                      <span className="text-xs text-muted-foreground">{pkg.helpers.length + 1} people on this job</span>
                      <button onClick={e => { e.stopPropagation(); handleBook("package", pkg.id); }} className="ml-auto bg-accent text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-accent/90 flex items-center gap-1">
                        {!isLoggedIn && <Lock size={11} />}Book
                      </button>
                    </div>
                  </div>
                </div>
              </div>))}
            </div>)}
          </div>)}

          {/* ── REVIEWS TAB ── */}
          {tab === "reviews" && (<div className="space-y-4">
            {[{ name: "Carlos M.", date: "Jan 14, 2026", rating: 5, comment: "Exceptional work. Arrived right on time and had everything fixed in under 2 hours." }, { name: "Lily Zhang", date: "Dec 28, 2025", rating: 5, comment: "Very professional. Explained every step of the process." }, { name: "Robert K.", date: "Nov 12, 2025", rating: 4, comment: "Good work overall. Quality of the final install is solid." }].map(({ name, date, rating, comment }) => (<div key={name} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent">{name[0]}</div><div><p className="text-sm font-semibold">{name}</p><p className="text-xs text-muted-foreground">{date}</p></div></div>
                <StarRow rating={rating} />
              </div>
              <p className="text-sm text-muted-foreground">{comment}</p>
            </div>))}
          </div>)}

          {/* ── PORTFOLIO TAB ── */}
          {tab === "portfolio" && (<div className="grid grid-cols-3 gap-3">
            {["https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=300&h=200&fit=crop", "https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=300&h=200&fit=crop", "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=300&h=200&fit=crop", "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=300&h=200&fit=crop", "https://images.unsplash.com/photo-1562259949-e8e7689d7828?w=300&h=200&fit=crop", "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=300&h=200&fit=crop"].map((src, i) => (<div key={i} className="aspect-square bg-muted rounded-xl overflow-hidden"><img src={src} alt={`Portfolio ${i + 1}`} className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" /></div>))}
          </div>)}
        </div>

        {/* Right sidebar */}
        <div>
          <div className="bg-card border border-border rounded-2xl p-5 mb-4">
            <h3 className="font-semibold mb-4">About {provider.name}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">{provider.about}</p>
            <div className="space-y-2 mb-4">
              {[{ icon: MapPin, label: provider.location }, { icon: Clock, label: `${provider.experience} experience` }, { icon: Star, label: `${provider.rating} avg rating` }, { icon: CheckCircle2, label: `${provider.jobs} jobs completed` }].map(({ icon: Icon, label }) => (<div key={label} className="flex items-center gap-2 text-sm text-muted-foreground"><Icon size={14} className="text-accent shrink-0" />{label}</div>))}
            </div>
            <div className={`text-center py-1.5 rounded-lg text-xs font-bold ${provider.avail ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
              {provider.avail ? "✓ Currently Available" : "✗ Currently Busy"}
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-5 mb-4">
            <h3 className="font-semibold mb-3 text-sm">Certifications</h3>
            {provider.certifications.map(c => <div key={c} className="flex items-center gap-2 text-xs text-muted-foreground mb-2"><CheckCircle2 size={13} className="text-accent" />{c}</div>)}
          </div>

          {/* Quick booking CTA */}
          <div className="bg-accent text-white rounded-2xl p-5">
            <h3 className="font-bold mb-1">Ready to Book?</h3>
            <p className="text-white/70 text-xs mb-4">Choose how you'd like to work with {provider.name}. All bookings are post-paid.</p>
            <button onClick={() => { setTab("general"); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="w-full bg-white text-accent text-sm font-semibold py-2.5 rounded-lg hover:bg-white/90 mb-2">
              General Booking
            </button>
            {providerPackages.length > 0 && (<button onClick={() => { setTab("packages"); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="w-full border border-white/30 text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-white/10">
              View Packages ({providerPackages.length})
            </button>)}
          </div>
        </div>
      </div>
    </div>
    <Footer />
  </div>);
}
function LivePackagesPage() {
  const { go, routeData } = useApp();
  const { isSaved: isItemSaved, toggle: toggleSavedItem } = useSaved();
  const initialSearch = routeData?.search || "";
  const [search, setSearch] = useState(initialSearch);
  const [category, setCategory] = useState(routeData?.category || "All");
  const [sort, setSort] = useState("recommended");
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const query = new URLSearchParams();
    if (debouncedSearch) query.set("search", debouncedSearch);
    if (category !== "All") query.set("category", category);
    packageApi.list(query.toString())
      .then(items => { setPackages(items); setError(""); })
      .catch(requestError => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [debouncedSearch, category]);
  const sortedPackages = useMemo(() => {
    const list = [...packages];
    if (sort === "price-asc") list.sort((a, b) => Number(a.price) - Number(b.price));
    else if (sort === "price-desc") list.sort((a, b) => Number(b.price) - Number(a.price));
    else if (sort === "rating") list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else if (sort === "newest") list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return list;
  }, [packages, sort]);
  const categories = [
    { name: "All", icon: null },
    { name: "Plumbing", icon: <Droplets size={14} /> },
    { name: "Electrical", icon: <Zap size={14} /> },
    { name: "Painting", icon: <Paintbrush size={14} /> },
    { name: "Carpentry", icon: <Hammer size={14} /> },
  ];
  const categoryImages = {
    Plumbing: "https://images.unsplash.com/photo-1585704032915-c3400ca199e7?w=600&h=400&fit=crop",
    Electrical: "https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=600&h=400&fit=crop",
    Painting: "https://images.unsplash.com/photo-1562259929-b4e1fd3aef09?w=600&h=400&fit=crop",
    Carpentry: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=600&h=400&fit=crop",
  };
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      {/* Hero Section */}
      <div className="relative bg-primary py-16 overflow-hidden">
        <div className="absolute inset-0 opacity-15 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-accent via-primary to-primary"></div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-accent/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-2 mb-3">
            <Package size={20} className="text-accent" />
            <span className="text-accent text-sm font-bold uppercase tracking-widest">Browse & Book</span>
          </div>
          <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-4xl md:text-5xl font-extrabold text-white mb-3 tracking-tight">
            Service <span className="text-accent">Packages</span>
          </h1>
          <p className="text-white/60 text-lg mb-8 max-w-xl">Fixed-price packages from verified professionals. Browse, compare, and book with confidence.</p>
          <div className="flex items-center bg-white/95 backdrop-blur-md rounded-2xl overflow-hidden shadow-2xl max-w-2xl border border-white/20">
            <Search size={20} className="ml-5 text-muted-foreground shrink-0" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search packages by name, description..." className="flex-1 px-4 py-4 text-sm outline-none bg-transparent text-foreground" />
            {search && <button onClick={() => setSearch("")} className="mr-4 text-muted-foreground hover:text-foreground"><X size={16} /></button>}
          </div>
          <div className="flex gap-2 mt-5 flex-wrap">
            {categories.map(item => (
              <button key={item.name} onClick={() => setCategory(item.name)} className={`flex items-center gap-1.5 text-xs font-semibold px-5 py-2 rounded-full border transition-all duration-300 ${category === item.name ? "bg-accent text-white border-accent shadow-lg shadow-accent/20 scale-105" : "bg-white/10 text-white/70 border-white/20 hover:bg-white/20 hover:border-white/40"}`}>
                {item.icon}{item.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10 flex-1 w-full">
        <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
          <p className="text-sm text-muted-foreground font-medium">{loading ? "Loading packages..." : <><span className="text-foreground font-bold text-lg">{sortedPackages.length}</span> packages available{debouncedSearch ? <> for <span className="text-foreground font-semibold">“{debouncedSearch}”</span></> : null}</>}</p>
          <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-2">
            <SlidersHorizontal size={14} className="text-muted-foreground" />
            <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort packages" className="bg-transparent text-sm font-medium outline-none">
              <option value="recommended">Recommended</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
              <option value="rating">Top Rated</option>
              <option value="newest">Newest</option>
            </select>
          </div>
        </div>
        {error && <p role="alert" className="py-10 text-center text-sm text-red-600 bg-red-50 rounded-2xl border border-red-200">{error}</p>}
        {!loading && !error && packages.length === 0 && (
          <div className="py-24 text-center">
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-4"><Package size={32} className="text-muted-foreground opacity-40" /></div>
            <h3 className="font-semibold text-lg mb-2">No packages found</h3>
            <p className="text-sm text-muted-foreground">Try adjusting your search or category filters.</p>
          </div>
        )}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-7">
          {sortedPackages.map((item, index) => (
            <button
              key={item._id}
              onClick={() => go("package-details", { packageId: item._id })}
              className="group text-left bg-card border border-border rounded-2xl overflow-hidden hover:border-accent/40 hover:shadow-2xl hover:-translate-y-1 transition-all duration-500 flex flex-col"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              {/* Card Image */}
              <div className="relative h-48 overflow-hidden bg-muted">
                <img
                  src={item.images?.[0] || categoryImages[item.category] || "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=600&h=400&fit=crop"}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                {/* Save to favourites */}
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={isItemSaved(item._id) ? "Remove from saved" : "Save package"}
                  onClick={e => { e.preventDefault(); e.stopPropagation(); toggleSavedItem({ id: item._id, kind: "package", title: item.title, image: item.images?.[0] || "", price: item.price, category: item.category, providerName: item.provider?.name || "" }); }}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleSavedItem({ id: item._id, kind: "package", title: item.title, image: item.images?.[0] || "", price: item.price, category: item.category, providerName: item.provider?.name || "" }); } }}
                  className={`absolute top-3 right-3 z-10 p-2 rounded-full backdrop-blur-sm shadow-md transition-all cursor-pointer ${isItemSaved(item._id) ? "bg-accent text-white" : "bg-white/90 text-foreground hover:text-accent"}`}
                >
                  <Heart size={14} className={isItemSaved(item._id) ? "fill-white" : ""} />
                </span>
                {/* Category Badge */}
                <span className="absolute top-3 left-3 inline-flex items-center gap-1 bg-accent/90 backdrop-blur-sm text-white text-[10px] font-extrabold px-3 py-1 rounded-full uppercase tracking-widest shadow-lg">
                  {item.category === "Plumbing" && <Droplets size={10} />}
                  {item.category === "Electrical" && <Zap size={10} />}
                  {item.category === "Painting" && <Paintbrush size={10} />}
                  {item.category === "Carpentry" && <Hammer size={10} />}
                  {item.category}
                </span>
                {/* Price Badge */}
                <div className="absolute bottom-3 right-3 bg-white/95 backdrop-blur-sm text-foreground font-extrabold text-lg px-4 py-1.5 rounded-xl shadow-lg">
                  ₹{item.price?.toLocaleString?.() || item.price}
                </div>
                {/* Rating Badge */}
                {item.rating > 0 && (
                  <div className="absolute top-3 right-12 bg-black/60 backdrop-blur-sm text-white text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                    <Star size={11} className="fill-amber-400 text-amber-400" /> {item.rating.toFixed(1)}
                  </div>
                )}
              </div>
              {/* Card Content */}
              <div className="p-5 flex-1 flex flex-col">
                <h2 className="font-bold text-lg leading-snug group-hover:text-accent transition-colors duration-300 line-clamp-2">{item.title}</h2>
                <p className="text-sm text-muted-foreground mt-2 line-clamp-2 leading-relaxed flex-1">{item.description}</p>
                {/* Duration & Info */}
                <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1 bg-muted px-2.5 py-1 rounded-lg"><Clock size={12} /> {item.duration}</span>
                  {item.bookingsCount > 0 && <span className="flex items-center gap-1 bg-muted px-2.5 py-1 rounded-lg"><Users size={12} /> {item.bookingsCount} booked</span>}
                </div>
                {/* Provider Info */}
                <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border/60">
                  <img
                    src={item.provider?.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.provider?.name || 'P')}&background=f97316&color=fff&size=40`}
                    alt={item.provider?.name}
                    className="w-8 h-8 rounded-full object-cover border-2 border-border shadow-sm shrink-0"
                  />
                  <div className="overflow-hidden flex-1">
                    <p className="text-sm font-semibold truncate">{item.provider?.name || "Provider"}</p>
                    {item.provider?.rating > 0 && (
                      <p className="text-[11px] text-muted-foreground flex items-center gap-0.5">
                        <Star size={10} className="fill-amber-400 text-amber-400" /> {item.provider.rating.toFixed(1)} rating
                      </p>
                    )}
                  </div>
                  <ArrowRight size={16} className="text-muted-foreground group-hover:text-accent group-hover:translate-x-1 transition-all duration-300 shrink-0" />
                </div>
              </div>
            </button>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}
function LivePackageDetailsPage() {
  const { go, routeData, isLoggedIn } = useApp();
  const [item, setItem] = useState(null);
  const [error, setError] = useState("");
  const [reviews, setReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [activeImage, setActiveImage] = useState(0);
  const [lightboxImg, setLightboxImg] = useState(null);

  useEffect(() => {
    if (!routeData?.packageId) return;
    packageApi.get(routeData.packageId).then(pkg => setItem(pkg)).catch(requestError => setError(requestError.message));
    reviewApi.package(routeData.packageId).then(setReviews).catch(() => setReviews([])).finally(() => setReviewsLoading(false));
  }, [routeData?.packageId]);

  const book = () => {
    const target = { bookingMode: "package", packageId: item._id, providerId: item.provider?._id || item.provider };
    if (!isLoggedIn) { go("login", { redirect: { page: "booking", data: target } }); return; }
    go("booking", target);
  };

  const avgRating = reviews.length ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length) : 0;
  const ratingCounts = [5, 4, 3, 2, 1].map(star => ({ star, count: reviews.filter(r => r.rating === star).length }));

  const allImages = item ? [...(item.images || [])].filter(Boolean) : [];
  if (allImages.length === 0 && item) allImages.push("https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1200&h=800&fit=crop");

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      {/* Lightbox */}
      {lightboxImg && (
        <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4" onClick={() => setLightboxImg(null)}>
          <button onClick={() => setLightboxImg(null)} className="absolute top-6 right-6 text-white/80 hover:text-white"><X size={28} /></button>
          <img src={lightboxImg} alt="Preview" className="max-w-full max-h-[90vh] rounded-2xl shadow-2xl object-contain" onClick={e => e.stopPropagation()} />
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12 flex-1 w-full">
        <button onClick={() => go("packages")} className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground mb-8 transition-colors">
          <ArrowLeft size={16} />Back to Packages
        </button>
        
        {error && <p role="alert" className="text-red-600 text-sm mb-4 bg-red-50 p-4 rounded-xl border border-red-200">{error}</p>}
        {!item && !error && (
          <div className="py-24 text-center">
            <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-muted-foreground font-medium">Loading package details...</p>
          </div>
        )}
        
        {item && (
          <div className="grid lg:grid-cols-3 gap-10">
            <div className="lg:col-span-2 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Image Gallery */}
              <div className="space-y-3">
                <div className="rounded-3xl overflow-hidden h-80 md:h-[420px] bg-muted relative shadow-xl group cursor-pointer" onClick={() => setLightboxImg(allImages[activeImage])}>
                  <img src={allImages[activeImage]} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                  <div className="absolute bottom-6 left-6 right-6">
                    <span className="inline-flex items-center gap-1.5 bg-accent/90 backdrop-blur text-white text-[10px] font-extrabold px-3 py-1 rounded-full uppercase tracking-widest shadow-sm mb-4">
                      {item.category === "Plumbing" && <Droplets size={10} />}
                      {item.category === "Electrical" && <Zap size={10} />}
                      {item.category === "Painting" && <Paintbrush size={10} />}
                      {item.category === "Carpentry" && <Hammer size={10} />}
                      {item.category}
                    </span>
                    <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-3xl md:text-5xl font-extrabold text-white leading-tight drop-shadow-lg">
                      {item.title}
                    </h1>
                    {reviews.length > 0 && (
                      <div className="flex items-center gap-3 mt-3">
                        <StarRow rating={avgRating} size={16} />
                        <span className="text-white/90 text-sm font-semibold">{avgRating.toFixed(1)}</span>
                        <span className="text-white/60 text-sm">({reviews.length} {reviews.length === 1 ? "review" : "reviews"})</span>
                      </div>
                    )}
                  </div>
                  <div className="absolute top-4 right-4 bg-black/50 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5">
                    <Eye size={12} /> Click to zoom
                  </div>
                </div>
                {/* Thumbnail Strip */}
                {allImages.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {allImages.map((img, i) => (
                      <button key={i} onClick={() => setActiveImage(i)} className={`shrink-0 w-20 h-16 rounded-xl overflow-hidden border-2 transition-all duration-300 ${i === activeImage ? "border-accent shadow-lg scale-105" : "border-border opacity-60 hover:opacity-100"}`}>
                        <img src={img} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-card border border-border rounded-3xl p-8 shadow-sm hover:shadow-md transition-shadow">
                <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><Briefcase size={24} className="text-accent" /> Overview</h2>
                <p className="text-muted-foreground leading-relaxed text-lg">{item.description}</p>
                
                <div className="grid sm:grid-cols-3 gap-6 mt-8 p-6 bg-muted/30 rounded-2xl border border-border/60">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center text-accent shrink-0"><Clock size={24} /></div>
                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Duration</p>
                      <p className="font-bold text-lg text-foreground">{item.duration}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center text-accent shrink-0"><Users size={24} /></div>
                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Team Size</p>
                      <p className="font-bold text-lg text-foreground">{(item.helpers?.length || 0) + 1} People</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0"><Star size={24} /></div>
                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Rating</p>
                      <p className="font-bold text-lg text-foreground">{reviews.length > 0 ? `${avgRating.toFixed(1)} / 5` : "New"}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-3xl p-8 shadow-sm hover:shadow-md transition-shadow">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2"><CheckCircle2 size={24} className="text-accent" /> What's Included</h2>
                <ul className="grid sm:grid-cols-2 gap-4">
                  {item.includes?.filter(Boolean).map((entry, idx) => (
                    <li key={idx} className="flex gap-3 bg-card border border-border p-4 rounded-xl shadow-sm hover:border-accent/40 transition-colors">
                      <CheckCircle2 size={20} className="text-green-500 shrink-0 mt-0.5" />
                      <span className="text-foreground font-medium text-sm leading-relaxed">{entry}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* ─── Customer Reviews Section ─────────────────────────────────── */}
              <div className="bg-card border border-border rounded-3xl p-8 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <MessageSquare size={24} className="text-accent" /> Customer Reviews
                    {reviews.length > 0 && <span className="text-sm font-normal text-muted-foreground ml-2">({reviews.length})</span>}
                  </h2>
                </div>

                {reviewsLoading && (
                  <div className="py-12 text-center">
                    <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                    <p className="text-sm text-muted-foreground">Loading reviews...</p>
                  </div>
                )}

                {!reviewsLoading && reviews.length === 0 && (
                  <div className="py-12 text-center bg-muted/30 rounded-2xl border border-border/50 border-dashed">
                    <MessageSquare size={36} className="mx-auto mb-3 text-muted-foreground opacity-30" />
                    <p className="text-muted-foreground font-medium">No reviews yet for this package</p>
                    <p className="text-xs text-muted-foreground mt-1">Be the first to book and share your experience!</p>
                  </div>
                )}

                {/* Rating Summary */}
                {!reviewsLoading && reviews.length > 0 && (
                  <div className="mb-8 p-6 bg-gradient-to-br from-amber-50/80 to-orange-50/50 rounded-2xl border border-amber-200/40">
                    <div className="flex flex-col sm:flex-row gap-8 items-center">
                      <div className="text-center sm:pr-8 sm:border-r sm:border-amber-200/60">
                        <div className="text-6xl font-extrabold text-foreground tracking-tight">{avgRating.toFixed(1)}</div>
                        <StarRow rating={avgRating} size={18} />
                        <p className="text-sm text-muted-foreground mt-2 font-medium">{reviews.length} {reviews.length === 1 ? "review" : "reviews"}</p>
                      </div>
                      <div className="flex-1 w-full space-y-2.5">
                        {ratingCounts.map(({ star, count }) => (
                          <div key={star} className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-muted-foreground w-8 text-right flex items-center justify-end gap-0.5">{star} <Star size={10} className="fill-amber-400 text-amber-400" /></span>
                            <div className="flex-1 h-3 bg-amber-100/80 rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-amber-400 to-orange-400 rounded-full transition-all duration-700 ease-out" style={{ width: reviews.length ? `${(count / reviews.length) * 100}%` : "0%" }} />
                            </div>
                            <span className="text-xs text-muted-foreground font-medium w-8">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Individual Reviews */}
                <div className="space-y-5">
                  {reviews.map((rev, idx) => (
                    <div key={rev._id} className="bg-card border border-border rounded-2xl p-6 hover:shadow-lg hover:border-accent/20 transition-all duration-300" style={{ animationDelay: `${idx * 80}ms` }}>
                      {/* Review Header */}
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={rev.customer?.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(rev.customer?.name || 'C')}&background=f97316&color=fff&size=48`}
                            alt={rev.customer?.name}
                            className="w-12 h-12 rounded-full object-cover border-2 border-border shadow-sm shrink-0"
                          />
                          <div>
                            <p className="font-bold text-base">{rev.customer?.name || "Verified Customer"}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Calendar size={11} /> {new Date(rev.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })}
                              </span>
                              {rev.service?.name && <span className="text-xs text-accent bg-accent/10 px-2 py-0.5 rounded-full font-medium">{rev.service.name}</span>}
                              {rev.package?.title && <span className="text-xs text-accent bg-accent/10 px-2 py-0.5 rounded-full font-medium">{rev.package.title}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-200/60 shrink-0">
                          <Star size={14} className="fill-amber-400 text-amber-400" />
                          <span className="font-bold text-sm text-amber-700">{rev.rating}</span>
                        </div>
                      </div>

                      {/* Star Row */}
                      <div className="mb-3">
                        <StarRow rating={rev.rating} size={14} />
                      </div>

                      {/* Review Comment */}
                      <p className="text-foreground/90 leading-relaxed text-[15px]">"{rev.comment}"</p>

                      {/* Review Photos */}
                      {rev.photos && rev.photos.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-border/50">
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-1.5">
                            <Eye size={12} /> Customer Photos
                          </p>
                          <div className="flex gap-2 flex-wrap">
                            {rev.photos.map((photo, pi) => (
                              <button key={pi} onClick={() => setLightboxImg(photo)} className="group/photo rounded-xl overflow-hidden w-24 h-24 sm:w-28 sm:h-28 bg-muted border border-border hover:border-accent/60 transition-all duration-300 hover:shadow-lg hover:scale-105 relative">
                                <img src={photo} alt={`Review photo ${pi + 1}`} className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-black/0 group-hover/photo:bg-black/20 transition-colors flex items-center justify-center">
                                  <Search size={16} className="text-white opacity-0 group-hover/photo:opacity-100 transition-opacity drop-shadow-lg" />
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Review Videos */}
                      {rev.videos && rev.videos.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-border/50">
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-1.5">
                            📹 Customer Videos
                          </p>
                          <div className="flex gap-3 flex-wrap">
                            {rev.videos.map((video, vi) => (
                              <video key={vi} src={video} controls className="rounded-xl w-64 h-44 object-cover border border-border shadow-sm" />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="lg:col-span-1">
              <div className="bg-card border border-border rounded-3xl p-6 shadow-xl sticky top-24 animate-in fade-in slide-in-from-right-4 duration-500 delay-150">
                <div className="text-center mb-6 pb-6 border-b border-border">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">Total Package Cost</p>
                  <div className="text-5xl font-extrabold text-foreground mb-3 tracking-tight">₹{item.price?.toLocaleString?.() || item.price}</div>
                  <div className="inline-flex items-center gap-1.5 bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase">
                    <Banknote size={14} /> Post-Paid Booking
                  </div>
                </div>

                {/* Rating Summary Mini */}
                {reviews.length > 0 && (
                  <div className="mb-6 p-4 bg-amber-50/60 rounded-2xl border border-amber-200/40 flex items-center gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-extrabold text-foreground">{avgRating.toFixed(1)}</div>
                      <StarRow rating={avgRating} size={12} />
                    </div>
                    <div className="text-sm text-muted-foreground leading-snug">
                      <span className="font-bold text-foreground">{reviews.length}</span> verified {reviews.length === 1 ? "review" : "reviews"} from customers
                    </div>
                  </div>
                )}
                
                <div className="mb-6 flex items-center gap-4 p-4 bg-muted/30 rounded-2xl border border-border/50 hover:border-accent/30 transition-colors cursor-pointer" onClick={() => go("provider-profile", { providerId: item.provider?._id || item.provider })}>
                   <img src={item.provider?.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.provider?.name || 'P')}`} alt={item.provider?.name} className="w-14 h-14 rounded-full object-cover border-2 border-border shadow-sm shrink-0" />
                   <div className="overflow-hidden">
                     <p className="text-[10px] font-bold text-accent uppercase tracking-widest">Service by</p>
                     <p className="font-bold text-base truncate">{item.provider?.name || "Professional"}</p>
                     <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                       <Star size={12} className="fill-amber-400 text-amber-400"/> {item.provider?.rating ? item.provider.rating.toFixed(1) : "New"}
                     </p>
                   </div>
                   <ArrowRight size={16} className="text-muted-foreground shrink-0 ml-auto" />
                </div>

                <div className="bg-green-50/80 border border-green-200/60 rounded-2xl p-5 mb-6 flex items-start gap-3 backdrop-blur-sm">
                   <CheckCircle2 size={20} className="text-green-600 shrink-0 mt-0.5" />
                   <div>
                     <p className="font-bold text-green-800 text-sm mb-1">Zero Upfront Cost</p>
                     <p className="text-xs text-green-700/90 leading-relaxed">Book this package now and pay directly to the provider only after the job is completely done to your satisfaction.</p>
                   </div>
                </div>

                {/* Quick review highlight */}
                {reviews.length > 0 && (
                  <div className="mb-6 p-4 bg-muted/30 rounded-2xl border border-border/50">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Latest Review</p>
                    <div className="flex items-center gap-2 mb-2">
                      <img src={reviews[0].customer?.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(reviews[0].customer?.name || 'C')}&background=f97316&color=fff&size=32`} alt="" className="w-7 h-7 rounded-full object-cover border border-border shrink-0" />
                      <span className="text-xs font-semibold">{reviews[0].customer?.name || "Customer"}</span>
                      <StarRow rating={reviews[0].rating} size={10} />
                    </div>
                    <p className="text-xs text-muted-foreground italic line-clamp-3">"{reviews[0].comment}"</p>
                    {reviews[0].photos?.[0] && (
                      <img src={reviews[0].photos[0]} alt="Review" className="mt-2 rounded-lg w-full h-20 object-cover border border-border" />
                    )}
                  </div>
                )}

                <button onClick={book} className="w-full bg-foreground text-background font-bold text-lg py-4 rounded-2xl hover:bg-accent hover:text-white transition-all duration-300 shadow-md hover:shadow-xl hover:-translate-y-1 flex justify-center items-center gap-2">
                   {!isLoggedIn && <Lock size={18} />} Request Booking
                </button>
                {!isLoggedIn && <p className="text-center text-xs text-muted-foreground mt-4 flex justify-center items-center gap-1"><Lock size={12}/> Sign in required to book</p>}
              </div>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
function LiveProvidersPage() {
  const { go } = useApp();
  const [search, setSearch] = useState("");
  const [allProviders, setAllProviders] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => { 
    userApi.providers().then(setAllProviders).catch(requestError => setError(requestError.message)); 
  }, []);
  const providers = allProviders.filter(provider => `${provider.name} ${provider.trade || ""} ${provider.city || ""}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <div className="relative py-20 bg-primary overflow-hidden">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-accent via-primary to-primary"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 text-center">
          <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-4xl md:text-5xl font-extrabold text-white mb-6 tracking-tight">Meet Our <span className="text-accent">Professionals</span></h1>
          <p className="text-white/80 max-w-2xl mx-auto mb-8 text-lg">Find the best construction experts for your next big project.</p>
          <div className="max-w-xl mx-auto flex items-center bg-white rounded-full p-2 shadow-2xl">
            <Search size={20} className="text-muted-foreground ml-3" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name, trade, or city..." className="flex-1 bg-transparent border-none outline-none px-4 py-2 text-foreground" />
          </div>
        </div>
      </div>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-12 flex-1 w-full">
        {error && <p role="alert" className="text-red-600 text-sm text-center bg-red-50 p-4 rounded-lg">{error}</p>}
        {!error && providers.length === 0 && (
          <div className="py-20 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4"><Search size={24} className="text-muted-foreground" /></div>
            <h3 className="text-lg font-semibold mb-2">No professionals found</h3>
            <p className="text-muted-foreground">Try adjusting your search criteria.</p>
          </div>
        )}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {providers.map((provider) => (
            <button key={provider._id} onClick={() => go("provider-profile", { providerId: provider._id })} className="group text-left bg-card border border-border rounded-2xl overflow-hidden hover:shadow-xl hover:-translate-y-1 hover:border-accent/30 transition-all duration-300 flex flex-col">
              <div className="h-32 w-full relative overflow-hidden bg-muted">
                <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-transparent z-10"></div>
                <img src="https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=500&h=200&fit=crop&auto=format" alt="Cover" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out opacity-80" />
                <div className="absolute top-3 right-3 z-20">
                  {provider.isApproved !== false && <div className="bg-white/90 backdrop-blur text-green-700 text-[10px] font-bold px-2.5 py-1 rounded-full shadow-sm flex items-center gap-1"><Shield size={12} className="fill-green-600"/> Verified</div>}
                </div>
              </div>
              <div className="px-5 pb-5 pt-0 relative flex-1 flex flex-col">
                <div className="w-20 h-20 rounded-full border-4 border-card shadow-md relative -mt-10 mb-3 bg-muted z-20 overflow-hidden">
                  {provider.profileImage ? (
                    <img src={provider.profileImage} alt={provider.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-accent to-orange-600 text-white flex items-center justify-center text-3xl font-extrabold">{provider.name?.[0] || "P"}</div>
                  )}
                </div>
                <h2 className="font-bold text-lg group-hover:text-accent transition-colors line-clamp-1">{provider.name}</h2>
                <p className="text-xs font-bold uppercase tracking-widest text-accent mb-4">{provider.trade || "Expert"}</p>
                
                <div className="mt-auto space-y-2.5 pt-4 border-t border-border/60">
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5"><MapPin size={14} className="opacity-70 text-accent" /> <span className="truncate max-w-[120px] font-medium text-foreground/80">{provider.city || "Tamil Nadu"}</span></span>
                    <span className="flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded-lg text-amber-700 font-bold border border-amber-200/50">
                      <Star size={12} className="fill-amber-500 text-amber-500" /> {provider.rating ? provider.rating.toFixed(1) : "New"}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}
function LiveProviderProfilePage() {
  const { go, routeData } = useApp();
  const [services, setServices] = useState([]);
  const [packages, setPackages] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [provider, setProvider] = useState(null);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("services");
  const [lightboxImg, setLightboxImg] = useState(null);

  useEffect(() => {
    if (!routeData?.providerId) return;
    Promise.all([
      serviceApi.list(),
      packageApi.list(`provider=${routeData.providerId}`),
      reviewApi.provider(routeData.providerId),
      userApi.providers()
    ]).then(([items, packageItems, revs, allProvs]) => {
      const providerServices = items.filter(item => item.provider?._id === routeData.providerId);
      setServices(providerServices);
      setPackages(packageItems);
      setReviews(revs);
      
      const foundProv = allProvs.find(p => p._id === routeData.providerId) || providerServices[0]?.provider || packageItems[0]?.provider || null;
      setProvider(foundProv);
    }).catch(requestError => setError(requestError.message));
  }, [routeData?.providerId]);

  if (error) return <div className="min-h-screen flex flex-col bg-background"><Navbar /><p role="alert" className="flex-1 py-16 text-center text-red-600 text-sm">{error}</p><Footer /></div>;
  if (!provider) return <div className="min-h-screen flex flex-col bg-background"><Navbar /><div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin"></div></div><Footer /></div>;

  const avgRating = reviews.length ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length) : 0;
  const ratingCounts = [5, 4, 3, 2, 1].map(star => ({ star, count: reviews.filter(r => r.rating === star).length }));

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      
      {/* Lightbox */}
      {lightboxImg && (
        <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4" onClick={() => setLightboxImg(null)}>
          <button onClick={() => setLightboxImg(null)} className="absolute top-6 right-6 text-white/80 hover:text-white"><X size={28} /></button>
          <img src={lightboxImg} alt="Preview" className="max-w-full max-h-[90vh] rounded-2xl shadow-2xl object-contain" onClick={e => e.stopPropagation()} />
        </div>
      )}

      <main className="flex-1 w-full pb-16">
        {/* Cover Photo */}
        <div className="h-64 md:h-80 w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-accent/90 via-primary to-primary relative overflow-hidden">
          <div className="absolute inset-0 bg-black/40 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-30 mix-blend-overlay"></div>
          <button onClick={() => go("providers")} className="absolute top-6 left-4 sm:left-8 flex items-center gap-2 text-sm text-white/90 hover:text-white transition-colors bg-black/30 hover:bg-black/50 px-5 py-2.5 rounded-full backdrop-blur-md shadow-sm border border-white/10">
            <ArrowLeft size={16} /> Back to Professionals
          </button>
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 relative -mt-24 md:-mt-32">
          {/* Profile Header Card */}
          <div className="bg-card border border-border rounded-3xl p-6 md:p-10 shadow-2xl flex flex-col md:flex-row md:items-end justify-between gap-8 mb-10 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
            
            <div className="flex flex-col md:flex-row md:items-end gap-8 relative z-10">
              {/* Avatar */}
              <div className="w-32 h-32 md:w-44 md:h-44 rounded-full bg-card p-2 shrink-0 shadow-xl relative -mt-16 md:-mt-24 border border-border group">
                {provider.profileImage ? (
                  <img src={provider.profileImage} alt={provider.name} className="w-full h-full rounded-full object-cover" />
                ) : (
                  <div className="w-full h-full rounded-full bg-gradient-to-br from-accent to-orange-600 text-white flex items-center justify-center text-6xl font-extrabold shadow-inner group-hover:scale-105 transition-transform">
                    {provider.name?.[0]}
                  </div>
                )}
                {provider.isApproved !== false && (
                  <div className="absolute bottom-2 right-2 bg-blue-500 text-white p-1.5 rounded-full border-4 border-card shadow-sm" title="Verified Professional">
                    <Shield size={16} className="fill-white text-blue-500" />
                  </div>
                )}
              </div>
              
              {/* Info */}
              <div className="pb-2">
                <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-3xl md:text-4xl font-extrabold mb-3">{provider.name}</h1>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-muted-foreground font-medium text-sm">
                  <span className="bg-accent/10 text-accent px-3 py-1.5 rounded-full shadow-sm border border-accent/20 font-bold tracking-wide uppercase text-xs">
                    {provider.trade || "Professional"}
                  </span>
                  <span className="flex items-center gap-1.5"><MapPin size={16} className="opacity-70" /> {provider.city || "Tamil Nadu"}</span>
                  <span className="flex items-center gap-1.5">
                    <Star size={16} className="text-amber-500 fill-amber-500" /> 
                    <span className="text-foreground font-bold">{provider.rating ? provider.rating.toFixed(1) : "New"}</span> 
                    <span className="font-normal opacity-75">({reviews.length} {reviews.length === 1 ? 'review' : 'reviews'})</span>
                  </span>
                  {provider.joinedDate && (
                    <span className="flex items-center gap-1.5 opacity-75"><Calendar size={15} /> Joined {new Date(provider.joinedDate).getFullYear()}</span>
                  )}
                </div>
              </div>
            </div>

            <button onClick={() => go("booking", { providerId: provider._id, bookingMode: "custom" })} className="bg-foreground text-background px-8 py-4 rounded-2xl font-bold text-lg hover:bg-accent hover:text-white transition-all hover:-translate-y-1 hover:shadow-xl shadow-md whitespace-nowrap w-full md:w-auto relative z-10 flex items-center justify-center gap-2">
              <MessageSquare size={20} /> Request Custom Quote
            </button>
          </div>

          <div className="grid lg:grid-cols-3 gap-10">
            {/* Left Column (Main Content) */}
            <div className="lg:col-span-2 space-y-8">
              
              {/* Custom Tabs */}
              <div className="flex overflow-x-auto gap-2 p-1 bg-muted/50 rounded-2xl border border-border/50 backdrop-blur-sm sticky top-24 z-20">
                {[
                  { id: "services", label: "Services", count: services.length, icon: <Briefcase size={16} /> },
                  { id: "packages", label: "Packages", count: packages.length, icon: <Package size={16} /> },
                  { id: "reviews", label: "Reviews", count: reviews.length, icon: <MessageSquare size={16} /> }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-300 whitespace-nowrap ${activeTab === tab.id ? 'bg-card text-foreground shadow-sm border border-border/60' : 'text-muted-foreground hover:text-foreground hover:bg-black/5'}`}
                  >
                    {tab.icon} {tab.label}
                    <span className={`ml-1 px-2 py-0.5 rounded-full text-xs ${activeTab === tab.id ? 'bg-accent/10 text-accent' : 'bg-black/5'}`}>
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              <div className="min-h-[400px]">
                {/* Services Tab */}
                {activeTab === "services" && (
                  <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-2xl font-bold flex items-center gap-2"><Briefcase size={24} className="text-accent" /> Offered Services</h2>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-5">
                      {services.map(service => (
                        <div key={service._id} className="group bg-card border border-border rounded-2xl p-6 hover:border-accent/40 hover:shadow-xl transition-all duration-300 flex flex-col">
                          <div className="flex-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-accent bg-accent/10 px-2 py-1 rounded-md mb-3 inline-block">{service.category}</span>
                            <h3 className="font-bold text-lg mb-2 group-hover:text-accent transition-colors line-clamp-2">{service.name}</h3>
                            <p className="text-sm text-muted-foreground line-clamp-2">{service.description || "Professional service."}</p>
                          </div>
                          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border/50">
                            <div>
                              <span className="text-xs text-muted-foreground uppercase tracking-wider font-bold block mb-0.5">Starting at</span>
                              <span className="font-extrabold text-xl">₹{service.price}</span>
                            </div>
                            <button onClick={() => go("booking", { serviceId: service._id, providerId: provider._id, bookingMode: "general" })} className="bg-muted text-foreground px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-accent hover:text-white transition-colors shadow-sm">
                              Book Now
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {services.length === 0 && (
                      <div className="text-muted-foreground bg-muted/50 p-12 rounded-3xl text-center border border-border border-dashed">
                        <Briefcase size={40} className="mx-auto mb-4 opacity-20" />
                        <p className="text-lg font-semibold">No services listed yet.</p>
                        <p className="text-sm opacity-80 mt-1">Check back later or request a custom quote.</p>
                      </div>
                    )}
                  </section>
                )}

                {/* Packages Tab */}
                {activeTab === "packages" && (
                  <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-2xl font-bold flex items-center gap-2"><Package size={24} className="text-accent" /> Fixed-Price Packages</h2>
                    </div>
                    <div className="space-y-5">
                      {packages.map((item, i) => (
                        <button key={item._id} onClick={() => go("package-details", { packageId: item._id })} className="w-full text-left bg-card border border-border rounded-2xl overflow-hidden hover:border-accent/40 hover:shadow-xl transition-all duration-300 flex flex-col sm:flex-row group" style={{ animationDelay: `${i * 50}ms` }}>
                          {item.images?.[0] && (
                            <div className="sm:w-48 h-40 sm:h-auto shrink-0 bg-muted overflow-hidden">
                              <img src={item.images[0]} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                            </div>
                          )}
                          <div className="p-6 flex-1 flex flex-col justify-center">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-accent mb-1.5 block">{item.category}</span>
                            <h3 className="font-bold text-xl mb-2 group-hover:text-accent transition-colors">{item.title}</h3>
                            <p className="text-sm text-muted-foreground line-clamp-2 max-w-xl mb-4">{item.description}</p>
                            <div className="flex items-center gap-4 text-xs font-semibold text-muted-foreground mt-auto">
                              <span className="flex items-center gap-1"><Clock size={14} className="text-foreground" /> {item.duration}</span>
                              <span className="flex items-center gap-1"><CheckCircle2 size={14} className="text-foreground" /> {item.includes?.length || 0} inclusions</span>
                            </div>
                          </div>
                          <div className="bg-muted/50 sm:bg-transparent p-6 sm:w-48 sm:border-l border-border/50 flex flex-col sm:items-end justify-center shrink-0 border-t sm:border-t-0">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest mb-1">Package Cost</span>
                            <div className="font-extrabold text-2xl text-foreground mb-3">₹{item.price}</div>
                            <span className="text-xs font-bold bg-foreground text-background px-4 py-2 rounded-lg text-center w-full sm:w-auto group-hover:bg-accent group-hover:text-white transition-colors shadow-sm">View Details</span>
                          </div>
                        </button>
                      ))}
                    </div>
                    {packages.length === 0 && (
                      <div className="text-muted-foreground bg-muted/50 p-12 rounded-3xl text-center border border-border border-dashed">
                        <Package size={40} className="mx-auto mb-4 opacity-20" />
                        <p className="text-lg font-semibold">No packages available.</p>
                      </div>
                    )}
                  </section>
                )}

                {/* Reviews Tab */}
                {activeTab === "reviews" && (
                  <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-2xl font-bold flex items-center gap-2"><MessageSquare size={24} className="text-accent" /> Customer Reviews</h2>
                    </div>

                    {/* Rating Summary */}
                    {reviews.length > 0 && (
                      <div className="mb-8 p-6 bg-card border border-border rounded-2xl shadow-sm">
                        <div className="flex flex-col sm:flex-row gap-8 items-center">
                          <div className="text-center sm:pr-8 sm:border-r border-border">
                            <div className="text-6xl font-extrabold text-foreground tracking-tight">{avgRating.toFixed(1)}</div>
                            <div className="mt-2 mb-1"><StarRow rating={avgRating} size={18} /></div>
                            <p className="text-sm text-muted-foreground font-medium">{reviews.length} {reviews.length === 1 ? "review" : "reviews"}</p>
                          </div>
                          <div className="flex-1 w-full space-y-2.5">
                            {ratingCounts.map(({ star, count }) => (
                              <div key={star} className="flex items-center gap-3">
                                <span className="text-sm font-semibold text-muted-foreground w-8 text-right flex items-center justify-end gap-0.5">{star} <Star size={10} className="fill-amber-400 text-amber-400" /></span>
                                <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
                                  <div className="h-full bg-accent rounded-full" style={{ width: reviews.length ? `${(count / reviews.length) * 100}%` : "0%" }} />
                                </div>
                                <span className="text-xs text-muted-foreground font-medium w-8">{count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-5">
                      {reviews.map((rev, idx) => (
                        <div key={rev._id} className="bg-card border border-border rounded-2xl p-6 hover:shadow-md transition-shadow" style={{ animationDelay: `${idx * 50}ms` }}>
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <img
                                src={rev.customer?.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(rev.customer?.name || 'C')}&background=f97316&color=fff&size=40`}
                                alt={rev.customer?.name}
                                className="w-10 h-10 rounded-full object-cover border border-border shrink-0"
                              />
                              <div>
                                <p className="font-bold text-sm">{rev.customer?.name || "Verified Customer"}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[11px] text-muted-foreground">
                                    {new Date(rev.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })}
                                  </span>
                                  {(rev.service?.name || rev.package?.title) && (
                                    <>
                                      <span className="w-1 h-1 rounded-full bg-border"></span>
                                      <span className="text-[11px] text-accent font-medium bg-accent/5 px-2 py-0.5 rounded-full">
                                        {rev.package ? 'Package: ' : 'Service: '} {rev.package?.title || rev.service?.name}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 bg-amber-50 px-2 py-1 rounded-lg border border-amber-100">
                              <span className="font-bold text-xs text-amber-700">{rev.rating}</span>
                              <Star size={12} className="fill-amber-400 text-amber-400" />
                            </div>
                          </div>
                          
                          <p className="text-foreground/90 text-sm leading-relaxed mb-4">"{rev.comment}"</p>

                          {/* Review Photos */}
                          {rev.photos && rev.photos.length > 0 && (
                            <div className="flex gap-2 flex-wrap mt-3">
                              {rev.photos.map((photo, pi) => (
                                <button key={pi} onClick={() => setLightboxImg(photo)} className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-muted border border-border hover:border-accent hover:shadow-md transition-all relative group/photo">
                                  <img src={photo} alt="" className="w-full h-full object-cover" />
                                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/photo:opacity-100 transition-opacity flex items-center justify-center">
                                    <Search size={14} className="text-white drop-shadow-md" />
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {reviews.length === 0 && (
                      <div className="text-muted-foreground bg-muted/50 p-12 rounded-3xl text-center border border-border border-dashed">
                        <MessageSquare size={40} className="mx-auto mb-4 opacity-20" />
                        <p className="text-lg font-semibold">No reviews yet.</p>
                      </div>
                    )}
                  </section>
                )}
              </div>
            </div>

            {/* Right Column (Sidebar) */}
            <div className="lg:col-span-1 space-y-6">
              
              {/* Trust Card */}
              <section className="bg-card border border-border rounded-3xl p-6 shadow-md">
                <h3 className="font-bold text-sm uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
                  <Shield size={16} /> Trust & Verification
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                      <CheckCircle2 size={20} className="text-green-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">Identity Verified</p>
                      <p className="text-xs text-muted-foreground">ID and phone number checked.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                      <Banknote size={20} className="text-blue-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">Post-Paid Bookings</p>
                      <p className="text-xs text-muted-foreground">Pay only after work is completed.</p>
                    </div>
                  </div>
                </div>
              </section>

              {/* Location Card */}
              <section className="bg-card border border-border rounded-3xl p-6 shadow-md sticky top-24">
                <h3 className="font-bold text-lg mb-4 flex items-center"><MapPin size={20} className="mr-2 text-accent" /> Location</h3>
                <div className="bg-muted rounded-2xl overflow-hidden h-48 w-full ring-1 ring-border group">
                  <iframe 
                    src={`https://maps.google.com/maps?q=${encodeURIComponent(provider.city || "Tamil Nadu")}&t=&z=13&ie=UTF8&iwloc=&output=embed`} 
                    width="100%" height="100%" frameBorder="0" style={{ border: 0 }} allowFullScreen="" aria-hidden="false" tabIndex="0"
                    className="grayscale group-hover:grayscale-0 transition-all duration-500"
                  ></iframe>
                </div>
                <div className="mt-5 text-sm">
                  <p className="mb-2 flex items-center justify-between">
                    <span className="text-muted-foreground">City</span>
                    <span className="font-bold">{provider.city || "Tamil Nadu"}</span>
                  </p>
                  <p className="flex items-center justify-between">
                    <span className="text-muted-foreground">State</span>
                    <span className="font-bold">{provider.state || "Tamil Nadu, India"}</span>
                  </p>
                </div>
              </section>

            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
void PackagesPage;
void PackageDetailsPage;
void ProvidersPage;
void ProviderProfilePage;
// ─── SAVED / FAVOURITES PAGE ──────────────────────────────────────────────────
function SavedPage() {
  const { go } = useApp();
  const { items, remove, clear } = useSaved();
  return (<div className="min-h-screen flex flex-col bg-background">
    <Navbar />
    <div className="bg-primary py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-2"><Heart size={16} className="text-accent" /><p className="text-xs font-semibold tracking-widest uppercase text-accent">Your shortlist</p></div>
          <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-3xl font-bold text-white">Saved Services &amp; Packages</h1>
          <p className="text-white/60 text-sm mt-1">Keep track of the professionals and packages you like, and come back to book anytime.</p>
        </div>
        {items.length > 0 && <button onClick={clear} className="border border-white/30 text-white/80 hover:text-white text-xs font-semibold px-4 py-2 rounded-lg">Clear all</button>}
      </div>
    </div>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 flex-1 w-full">
      {items.length === 0 ? (
        <div className="py-24 text-center bg-card border border-border border-dashed rounded-3xl">
          <Heart size={40} className="mx-auto mb-4 text-muted-foreground opacity-30" />
          <h3 className="text-xl font-bold mb-2">Nothing saved yet</h3>
          <p className="text-muted-foreground max-w-md mx-auto mb-6">Tap the heart on any service or package to save it here for later.</p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => go("services")} className="bg-accent text-white font-semibold px-5 py-2.5 rounded-lg hover:bg-accent/90">Browse Services</button>
            <button onClick={() => go("packages")} className="border border-border font-semibold px-5 py-2.5 rounded-lg hover:bg-muted">Browse Packages</button>
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map(item => (
            <div key={item.id} className="bg-card border border-border rounded-2xl overflow-hidden hover:shadow-lg hover:border-accent/30 transition-all flex flex-col group">
              <div className="h-40 bg-muted relative overflow-hidden cursor-pointer" onClick={() => go(item.kind === "package" ? "package-details" : "service-details", item.kind === "package" ? { packageId: item.id } : { serviceId: item.id })}>
                <img src={item.image || "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=600&h=400&fit=crop"} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                <span className="absolute top-3 left-3 bg-accent text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase">{item.kind === "package" ? "Package" : "Service"}</span>
                <button onClick={e => { e.stopPropagation(); remove(item.id); }} aria-label="Remove from saved" className="absolute top-3 right-3 bg-white/90 hover:bg-white text-red-500 rounded-full p-1.5 shadow-md"><X size={14} /></button>
              </div>
              <div className="p-4 flex flex-col flex-1">
                {item.category && <span className="text-[10px] font-bold uppercase tracking-wide text-accent mb-1">{item.category}</span>}
                <h3 className="font-semibold mb-1 line-clamp-2">{item.title}</h3>
                {item.providerName && <p className="text-xs text-muted-foreground mb-3">by {item.providerName}</p>}
                <div className="flex items-center justify-between mt-auto pt-3 border-t border-border">
                  <span style={{ fontFamily: "'Roboto Slab',serif" }} className="font-bold">₹{item.price}</span>
                  <button onClick={() => go(item.kind === "package" ? "package-details" : "service-details", item.kind === "package" ? { packageId: item.id } : { serviceId: item.id })} className="bg-accent text-white text-xs font-semibold px-3.5 py-2 rounded-lg hover:bg-accent/90">View &amp; Book</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    <Footer />
  </div>);
}
// ─── BOOKING PAGE (Post-Paid) ─────────────────────────────────────────────────
function BookingPage() {
  const { go, routeData, isLoggedIn, user, setUser } = useApp();
  const mode = routeData?.bookingMode || "general";
  const [step, setStep] = useState(1);
  const [date, setDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [time, setTime] = useState("");
  const [teamsCount, setTeamsCount] = useState(1);
  const [addressMode, setAddressMode] = useState(user?.addressLine1 ? "home" : "new");
  const [newAddress, setNewAddress] = useState({ line1: "", line2: "", state: user?.state || "Tamil Nadu", pincode: user?.pincode || "", city: user?.city || "" });
  const [saveNewAddress, setSaveNewAddress] = useState(true);
  const [desc, setDesc] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [service, setService] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [createdBooking, setCreatedBooking] = useState(null);
  const [loading, setLoading] = useState(false);
  const [bookedSlots, setBookedSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const resolvedProviderId = routeData?.providerId || service?.provider?._id || service?.provider?.id || (typeof service?.provider === "string" ? service.provider : null);

  useEffect(() => {
    if (date && resolvedProviderId) {
      setLoadingSlots(true);
      bookingApi.getBookedSlots(resolvedProviderId, date)
        .then(res => {
          const slots = res.bookedSlots || [];
          setBookedSlots(slots);
          if (time && slots.includes(time)) {
            setTime("");
          }
        })
        .catch(() => setBookedSlots([]))
        .finally(() => setLoadingSlots(false));
    } else {
      setBookedSlots([]);
    }
  }, [date, resolvedProviderId]);
  useEffect(() => {
    if (mode === "general" && routeData?.serviceId) {
      serviceApi.get(routeData.serviceId).then(setService).catch(() => { });
    } else if (mode === "package" && routeData?.packageId) {
      packageApi.get(routeData.packageId).then(setService).catch(() => { }); // We reuse setService for simplicity
    }
  }, [routeData?.serviceId, routeData?.packageId, mode]);
  // Redirect if not logged in
  if (!isLoggedIn) {
    return (<div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="bg-card border border-border rounded-2xl shadow-lg p-10 text-center max-w-sm w-full">
          <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4"><Lock size={30} className="text-accent" /></div>
          <h2 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-xl font-bold mb-2">Sign In Required</h2>
          <p className="text-sm text-muted-foreground mb-6">You need to sign in to make a booking. It's free and takes under a minute.</p>
          <button onClick={() => go("login", { redirect: { page: "booking", data: routeData } })} className="w-full bg-accent text-white font-semibold py-3 rounded-lg hover:bg-accent/90 mb-3">Sign In to Book</button>
          <button onClick={() => go("home")} className="w-full border border-border font-semibold py-2.5 rounded-lg hover:bg-muted text-sm text-muted-foreground">Back to Home</button>
        </div>
      </div>
      <Footer />
    </div>);
  }
  const confirm = async () => {
    setLoading(true);
    try {
      let finalAddress = "";
      if (addressMode === "home") {
        finalAddress = [user.addressLine1, user.addressLine2, user.city, user.state, user.pincode].filter(Boolean).join(", ");
      } else {
        finalAddress = [newAddress.line1, newAddress.line2, newAddress.city, newAddress.state, newAddress.pincode].filter(Boolean).join(", ");
        if (saveNewAddress) {
          const updatedUser = await userApi.update({ addressLine1: newAddress.line1, addressLine2: newAddress.line2, city: newAddress.city, state: newAddress.state, pincode: newAddress.pincode });
          setUser(updatedUser);
          sessionStorage.setItem("buildconnect_user", JSON.stringify(updatedUser));
        }
      }

      // Send the start date and (for packages) the optional end date as
      // separate fields. Never merge them into one string — the backend
      // expects each date to be a valid ``YYYY-MM-DD`` value.
      const bookingPayload = { date, time, address: finalAddress, requirements: mode === "package" ? `Teams needed: ${teamsCount}\n\n${desc}` : desc };
      if (mode === "package") {
        bookingPayload.package = routeData?.packageId;
        if (toDate) bookingPayload.endDate = toDate;
      } else if (mode === "custom") {
        bookingPayload.isCustomQuote = true;
        bookingPayload.providerId = routeData?.providerId;
        bookingPayload.customCategory = customCategory;
      } else {
        bookingPayload.service = routeData?.serviceId;
      }
      const booking = await bookingApi.createBooking(bookingPayload);
      setDate(""); setTime(""); setDesc("");
      setCreatedBooking(booking);
      setConfirmed(true);
      setTimeout(() => go("customer-dashboard"), 1800);
    } catch (requestError) {
      window.alert(requestError.message);
    } finally {
      setLoading(false);
    }
  };
  if (confirmed) {
    return (<div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="bg-card border border-border rounded-2xl p-10 text-center max-w-md w-full">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle2 size={32} className="text-green-600" /></div>
          <h2 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-2">Booking Confirmed!</h2>
          <p className="text-muted-foreground mb-2">Booking ID: <span style={{ fontFamily: "'DM Mono',monospace" }} className="font-bold text-foreground">{createdBooking?._id}</span></p>
          <p className="text-sm text-muted-foreground mb-5">The provider has been notified and will confirm within a few hours.</p>
          {/* Post-paid reminder */}
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 flex items-start gap-3 text-left">
            <Banknote size={18} className="text-green-600 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-800">Post-Paid Booking</p>
              <p className="text-xs text-green-700 mt-0.5">You will <strong>not</strong> be charged now. Payment is made directly to the provider <strong>after</strong> the work is completed and you confirm satisfaction.</p>
            </div>
          </div>
          <div className="bg-muted rounded-xl p-4 text-left mb-6 text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="font-semibold capitalize">{mode === "package" ? "Package Booking" : mode === "custom" ? "Custom Request" : "General Booking"}</span></div>
            {mode === "package" && service && <div className="flex justify-between"><span className="text-muted-foreground">Package</span><span className="font-semibold">{service.title}</span></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span className="font-semibold">{date || "TBC with provider"}</span></div>
            {mode === "package" && toDate && <div className="flex justify-between"><span className="text-muted-foreground">End Date</span><span className="font-semibold">{toDate}</span></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">Time</span><span className="font-semibold">{time}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Price</span><span className="font-semibold">{createdBooking?.price ? `₹${createdBooking.price}` : "Quoted"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span className="font-semibold text-amber-700">PENDING</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Payment</span><span className="font-semibold text-green-700">Post-paid (after job)</span></div>
          </div>
          <div className="flex gap-3 justify-center">
            <button onClick={() => go("customer-dashboard")} className="bg-accent text-white font-semibold px-6 py-2.5 rounded-lg hover:bg-accent/90">My Bookings</button>
            <button onClick={() => go("home")} className="border border-border font-semibold px-6 py-2.5 rounded-lg hover:bg-muted text-sm">Back to Home</button>
          </div>
        </div>
      </div>
      <Footer />
    </div>);
  }
  return (<div className="min-h-screen flex flex-col bg-background">
    <Navbar />
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 flex-1 w-full">
      <button onClick={() => go(
        mode === "package" ? "package-details" : (service?.provider?._id ? "provider-profile" : "services"),
        mode === "package"
          ? { packageId: routeData?.packageId }
          : service?.provider?._id
            ? { providerId: service.provider._id }
            : {}
      )} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"><ArrowLeft size={15} />Back</button>
      <div className="flex items-center gap-3 mb-2">
        <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold">{mode === "package" ? "Book Package" : mode === "custom" ? "Request Custom Quote" : "General Booking"}</h1>
        {mode === "package" && service && <Badge color="orange">{service.category}</Badge>}
        {mode === "general" && <Badge color="blue">Standard Service</Badge>}
        {mode === "custom" && <Badge color="purple">Custom Request</Badge>}
      </div>
      <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-8 w-fit">
        <Banknote size={14} className="text-green-600" />
        <span className="text-xs font-semibold text-green-700">Post-paid — no payment required now</span>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {["Schedule", "Details", "Confirm"].map((s, i) => (<div key={s} className="flex items-center gap-2 flex-1">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${step > i + 1 ? "bg-green-600 text-white" : step === i + 1 ? "bg-accent text-white" : "bg-muted text-muted-foreground"}`}>{step > i + 1 ? <Check size={13} /> : i + 1}</div>
          <span className={`text-xs font-medium ${step === i + 1 ? "text-foreground" : "text-muted-foreground"}`}>{s}</span>
          {i < 2 && <div className={`flex-1 h-px ${step > i + 1 ? "bg-green-600" : "bg-border"}`} />}
        </div>))}
      </div>

      {step === 1 && (<div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-5">Schedule</h2>
        {mode === "package" && service && (<div className="flex items-center gap-3 bg-muted rounded-xl p-3 mb-5">
          <img src={service.images?.[0] || service.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(service.title)}&background=random`} alt={service.title} className="w-12 h-12 rounded-lg object-cover shrink-0" />
          <div><p className="text-sm font-semibold">{service.title}</p><p className="text-xs text-muted-foreground">{service.provider?.name || "Provider"} · {service.duration}</p></div>
        </div>)}
        <div className="mb-5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center justify-between">
            <span>{mode === "package" ? "From Date" : "Preferred Start Date"}</span>
            {date && <span className="text-[11px] text-accent font-medium">Selected: {new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>}
          </label>
          <input
            type="date"
            value={date}
            min={new Date().toISOString().split("T")[0]}
            onChange={e => setDate(e.target.value)}
            className="w-full bg-input-background border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-accent"
          />
        </div>
        {mode === "package" && (
          <div className="mb-5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center justify-between">
              <span>To Date</span>
              {toDate && <span className="text-[11px] text-accent font-medium">Selected: {new Date(toDate + "T00:00:00").toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>}
            </label>
            <input
              type="date"
              value={toDate}
              min={date || new Date().toISOString().split("T")[0]}
              onChange={e => setToDate(e.target.value)}
              className="w-full bg-input-background border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-accent"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">Optional — leave blank if the work is a single day. The provider confirms the final schedule.</p>
          </div>
        )}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Time Slot Preference
            </label>
            {loadingSlots && (
              <span className="text-xs text-muted-foreground flex items-center gap-1.5 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-ping inline-block"></span>
                Checking booked slots...
              </span>
            )}
            {!loadingSlots && date && (
              <span className="text-xs text-muted-foreground font-medium">
                {bookedSlots.length > 0 ? `${bookedSlots.length} slot(s) already booked` : "All slots available"}
              </span>
            )}
          </div>
          {!date ? (
            <div className="p-4 rounded-xl border border-dashed border-border bg-muted/40 text-center text-xs text-muted-foreground">
              Please select a date first to view slot availability.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {["Morning (8–12)", "Afternoon (12–4)", "Evening (4–8)", "Flexible"].map(t => {
                const isBooked = bookedSlots.includes(t);
                const isSelected = time === t;
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={isBooked || loadingSlots}
                    onClick={() => {
                      if (!isBooked) setTime(t);
                    }}
                    className={`relative p-3 rounded-xl border text-left transition-all flex flex-col justify-between min-h-[76px] ${
                      isBooked
                        ? "bg-red-50/70 dark:bg-red-950/20 border-red-200 dark:border-red-900/50 cursor-not-allowed opacity-85"
                        : isSelected
                        ? "bg-accent text-white border-accent shadow-md shadow-accent/20 scale-[1.02]"
                        : "bg-card border-border hover:border-accent/50 hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className={`text-xs font-bold ${isBooked ? "text-muted-foreground line-through decoration-red-500" : isSelected ? "text-white" : "text-foreground"}`}>
                        {t}
                      </span>
                      {isBooked ? (
                        <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="Booked slot"></span>
                      ) : isSelected ? (
                        <Check size={14} className="text-white shrink-0" />
                      ) : null}
                    </div>

                    <div className="mt-auto">
                      {isBooked ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 rounded">
                          Booked
                        </span>
                      ) : (
                        <span className={`text-[10px] font-medium ${isSelected ? "text-white/80" : "text-green-600 dark:text-green-500"}`}>
                          Available
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {date && bookedSlots.length >= 4 && (
            <div className="mt-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-3 flex items-center gap-2 text-xs text-red-700 dark:text-red-300">
              <AlertCircle size={15} className="shrink-0 text-red-600" />
              <span>All slots are booked for this date. Please pick a different date.</span>
            </div>
          )}
          {date && bookedSlots.length > 0 && bookedSlots.length < 4 && (
            <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
              <AlertCircle size={12} className="text-amber-500" />
              Slots marked in red with "Booked" are already reserved for this provider on {date}.
            </p>
          )}
        </div>
        <button onClick={() => setStep(2)} disabled={!date || !time} className="w-full bg-accent text-white font-semibold py-3 rounded-lg hover:bg-accent/90 disabled:opacity-40">Continue</button>
      </div>)}

      {step === 2 && (<div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-5">Job Details</h2>
        <div className="space-y-5">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 block">Property Address</label>
            <div className="flex gap-2 mb-4">
              {user?.addressLine1 && (
                <button type="button" onClick={() => setAddressMode("home")} className={`flex-1 text-sm font-semibold py-2.5 rounded-lg border transition-colors ${addressMode === "home" ? "bg-accent text-white border-accent" : "bg-muted border-border text-muted-foreground hover:bg-input-background"}`}>
                  My Saved Home Address
                </button>
              )}
              <button type="button" onClick={() => setAddressMode("new")} className={`flex-1 text-sm font-semibold py-2.5 rounded-lg border transition-colors ${addressMode === "new" ? "bg-accent text-white border-accent" : "bg-muted border-border text-muted-foreground hover:bg-input-background"}`}>
                Enter New Address
              </button>
            </div>
            
            {addressMode === "home" ? (
              <div className="bg-muted border border-border rounded-lg p-4 text-sm text-foreground">
                <div className="font-semibold">{user.name}</div>
                <div className="text-muted-foreground mt-1">
                  {[user.addressLine1, user.addressLine2].filter(Boolean).join(", ")}<br />
                  {[user.city, user.state, user.pincode].filter(Boolean).join(", ")}<br />
                  India
                </div>
              </div>
            ) : (
              <div className="space-y-3 p-4 bg-muted/50 border border-border rounded-lg">
                <MapLocationPicker onLocationSelected={(data) => {
                  setNewAddress(a => ({
                    ...a,
                    line1: data.addressLine1 || a.line1,
                    city: data.city || a.city,
                    state: data.state || a.state,
                    pincode: data.pincode || a.pincode
                  }));
                }} />
                <p className="text-xs font-semibold text-muted-foreground mt-4 mb-2 uppercase tracking-wide">Verify Address Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Address Line 1</label><input value={newAddress.line1} onChange={e => setNewAddress(a => ({ ...a, line1: e.target.value }))} placeholder="House/Flat No, Street" className="w-full bg-input-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent" /></div>
                  <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Address Line 2 (Optional)</label><input value={newAddress.line2} onChange={e => setNewAddress(a => ({ ...a, line2: e.target.value }))} placeholder="Area, Landmark" className="w-full bg-input-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent" /></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">City</label><input value={newAddress.city} onChange={e => setNewAddress(a => ({ ...a, city: e.target.value }))} placeholder="City" className="w-full bg-input-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent" /></div>
                  <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">State</label><input value={newAddress.state} onChange={e => setNewAddress(a => ({ ...a, state: e.target.value }))} placeholder="State" className="w-full bg-input-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent" /></div>
                  <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Pincode</label><input value={newAddress.pincode} onChange={e => setNewAddress(a => ({ ...a, pincode: e.target.value }))} placeholder="Pincode" className="w-full bg-input-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent" /></div>
                </div>
                <label className="flex items-center gap-2 mt-2 cursor-pointer w-fit">
                  <input type="checkbox" checked={saveNewAddress} onChange={e => setSaveNewAddress(e.target.checked)} className="rounded text-accent focus:ring-accent accent-accent" />
                  <span className="text-xs font-medium text-foreground">Save as my default address for future bookings</span>
                </label>
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Property Type</label>
            <select className="w-full bg-input-background border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-accent">
              {["Single Family Home", "Apartment", "Condo", "Commercial"].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          {mode === "custom" && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Job Category</label>
              <select value={customCategory} onChange={e => setCustomCategory(e.target.value)} className="w-full bg-input-background border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-accent">
                <option value="">Select a category</option>
                {["Plumbing", "Electrical", "Painting", "Carpentry", "Masonry", "General Maintenance"].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
          {mode === "package" && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">How Many Teams Do You Need?</label>
              <p className="text-xs text-muted-foreground mb-3">Request multiple teams if you have a large project. Each team includes the provider's full crew. Provider will confirm availability.</p>
              <div className="flex items-center gap-4 bg-muted/50 border border-border rounded-xl p-4">
                <button type="button" onClick={() => setTeamsCount(c => Math.max(1, c - 1))} disabled={teamsCount <= 1} className="w-10 h-10 rounded-xl bg-card border border-border flex items-center justify-center font-bold text-xl hover:bg-muted hover:border-accent transition-colors disabled:opacity-40 shrink-0">−</button>
                <div className="flex-1 text-center">
                  <span className="text-3xl font-extrabold" style={{ fontFamily: "'Roboto Slab',serif" }}>{teamsCount}</span>
                  <p className="text-xs text-muted-foreground mt-1">{teamsCount === 1 ? "1 team (standard)" : `${teamsCount} teams requested`}</p>
                </div>
                <button type="button" onClick={() => setTeamsCount(c => Math.min(10, c + 1))} disabled={teamsCount >= 10} className="w-10 h-10 rounded-xl bg-card border border-border flex items-center justify-center font-bold text-xl hover:bg-muted hover:border-accent transition-colors disabled:opacity-40 shrink-0">+</button>
              </div>
              {teamsCount > 1 && (
                <div className="mt-3 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                  <Users size={14} className="text-blue-600 shrink-0" />
                  <p className="text-xs text-blue-700">You're requesting <strong>{teamsCount} teams</strong>. The provider will confirm if this is possible for the selected dates.</p>
                </div>
              )}
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">{mode === "general" ? "Describe the Job" : mode === "custom" ? "Describe Custom Work" : "Additional Notes"}</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={4} placeholder={mode === "general" ? "Describe the work needed in detail — scope, materials, access requirements…" : mode === "custom" ? "Describe exactly what custom work you need an estimate for..." : "Any specific requirements or details for the provider team…"} className="w-full bg-input-background border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-accent resize-none placeholder:text-muted-foreground" />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => setStep(1)} className="flex items-center gap-1.5 border border-border px-5 py-3 rounded-lg text-sm font-semibold hover:bg-muted"><ArrowLeft size={15} />Back</button>
          <button onClick={() => setStep(3)} disabled={(mode !== "custom" && !routeData?.serviceId && !routeData?.packageId) || (mode === "custom" && (!customCategory || !desc)) || (addressMode === "new" && (!newAddress.line1 || !newAddress.city || !newAddress.state || !newAddress.pincode))} className="flex-1 bg-accent text-white font-semibold py-3 rounded-lg hover:bg-accent/90 disabled:opacity-40">Continue</button>
        </div>
      </div>)}

      {step === 3 && (<div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-5">Review & Confirm</h2>
        <div className="bg-muted rounded-xl p-4 space-y-2.5 text-sm mb-5">
          <div className="flex justify-between"><span className="text-muted-foreground">Booking Type</span><span className="font-semibold capitalize">{mode === "package" ? "Package Booking" : "General Booking"}</span></div>
          {mode === "general" && service && <><div className="flex justify-between"><span className="text-muted-foreground">Service</span><span className="font-semibold">{service.name}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Provider</span><span className="font-semibold">{service.provider?.name || "Provider"}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Price</span><span className="font-semibold">₹{service.price}</span></div></>}
          {mode === "package" && service && <><div className="flex justify-between"><span className="text-muted-foreground">Package</span><span className="font-semibold">{service.title}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Team Size</span><span className="font-semibold">{(service.helpers?.length || 0) + 1} people</span></div>{teamsCount > 1 && <div className="flex justify-between"><span className="text-muted-foreground">Teams Requested</span><span className="font-semibold text-accent">{teamsCount} teams</span></div>}<div className="flex justify-between"><span className="text-muted-foreground">Price</span><span className="font-semibold">₹{service.price}</span></div></>}
          <div className="flex justify-between"><span className="text-muted-foreground">{mode === "package" && toDate ? "Start Date" : "Date"}</span><span className="font-semibold">{date}</span></div>
          {mode === "package" && toDate && <div className="flex justify-between"><span className="text-muted-foreground">End Date</span><span className="font-semibold">{toDate}</span></div>}
          <div className="flex justify-between"><span className="text-muted-foreground">Time</span><span className="font-semibold">{time}</span></div>
        </div>

        {/* Post-paid highlight */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-5">
          <div className="flex items-center gap-2 mb-2"><Banknote size={18} className="text-green-600" /><p className="font-semibold text-green-800">Post-Paid Booking</p></div>
          <ul className="text-xs text-green-700 space-y-1">
            <li className="flex items-center gap-1.5"><Check size={12} />No payment required now</li>
            <li className="flex items-center gap-1.5"><Check size={12} />Provider completes the job first</li>
            <li className="flex items-center gap-1.5"><Check size={12} />You confirm satisfaction, then pay the provider directly</li>
            <li className="flex items-center gap-1.5"><Check size={12} />Dispute support available if needed</li>
          </ul>
        </div>

        {(!routeData?.serviceId && !routeData?.packageId && mode !== "custom") && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-center gap-2">
            <AlertCircle size={15} className="text-amber-600 shrink-0" />
            <p className="text-xs text-amber-700">No service linked to this booking. Please go back and select a service or package before confirming.</p>
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={() => setStep(2)} className="flex items-center gap-1.5 border border-border px-5 py-3 rounded-lg text-sm font-semibold hover:bg-muted"><ArrowLeft size={15} />Back</button>
          <button onClick={confirm} disabled={loading || (mode !== "custom" && !routeData?.serviceId && !routeData?.packageId)} className="flex-1 bg-accent text-white font-semibold py-3 rounded-lg hover:bg-accent/90 disabled:opacity-60 flex items-center justify-center gap-2">
            {loading ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Confirming…</> : "Confirm Booking"}
          </button>
        </div>
      </div>)}
    </div>
    <Footer />
  </div>);
}
// ─── LOGIN / REGISTER ─────────────────────────────────────────────────────────
function LoginPage() {
  const { go, setLoggedIn, setUser, routeData } = useApp();
  const [show, setShow] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Honour the page the user was trying to reach before being sent to sign in.
  const afterLogin = (userData) => {
    const redirect = routeData?.redirect;
    if (redirect?.page) { go(redirect.page, redirect.data || {}); return; }
    go(userData.role === "provider" ? "provider-dashboard" : userData.role === "admin" ? "admin-dashboard" : "customer-dashboard");
  };
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await authApi.login(form);
      sessionStorage.setItem("buildconnect_token", data.token);
      sessionStorage.setItem("buildconnect_user", JSON.stringify(data.user));
      setUser(data.user);
      setLoggedIn(true);
      afterLogin(data.user);
    }
    catch (requestError) {
      setError(requestError.message);
    }
    finally {
      setLoading(false);
    }
  };
  const googleSignIn = async (credentialResponse) => {
    setLoading(true); setError("");
    try {
      const data = await authApi.googleLogin(credentialResponse.credential, "customer");
      sessionStorage.setItem("buildconnect_token", data.token); sessionStorage.setItem("buildconnect_user", JSON.stringify(data.user)); setUser(data.user); setLoggedIn(true);
      afterLogin(data.user);
    } catch (requestError) { setError(requestError.message); } finally { setLoading(false); }
  };
  return (<div className="min-h-screen flex flex-col bg-background">
    <Navbar />
    {showForgot && (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowForgot(false)}>
        <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="h-1.5 bg-accent" />
          <div className="p-7">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-accent/10 rounded-full flex items-center justify-center"><Lock size={22} className="text-accent" /></div>
              <button onClick={() => setShowForgot(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <h2 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-lg font-bold mb-2">Reset your password</h2>
            <p className="text-sm text-muted-foreground mb-4">For your security, password resets are handled by our support team. What best describes you?</p>
            <div className="space-y-3">
              <div className="bg-muted rounded-xl p-3">
                <p className="text-xs font-semibold mb-1">Signed up with Google?</p>
                <p className="text-xs text-muted-foreground">Just use the “Sign in with Google” button — no password needed.</p>
              </div>
              <div className="bg-muted rounded-xl p-3">
                <p className="text-xs font-semibold mb-1">Signed up with email &amp; password?</p>
                <p className="text-xs text-muted-foreground">Email us at <span className="font-semibold text-foreground">support@buildconnect.app</span> from your registered address and we'll help you regain access.</p>
              </div>
            </div>
            <a href={`mailto:support@buildconnect.app?subject=${encodeURIComponent("Password reset request")}&body=${encodeURIComponent(`My registered email is: ${form.email || ""}`)}`} className="mt-5 w-full flex items-center justify-center gap-2 bg-accent text-white font-semibold py-2.5 rounded-lg hover:bg-accent/90">
              <Phone size={14} /> Contact Support
            </a>
          </div>
        </div>
      </div>
    )}
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="bg-card border border-border rounded-2xl shadow-lg overflow-hidden">
          <div className="h-1.5 bg-accent" />
          <div className="p-8">
            <div className="flex items-center gap-2 mb-6"><div className="w-8 h-8 bg-accent/10 rounded-lg flex items-center justify-center"><Building2 size={18} className="text-accent" /></div><span style={{ fontFamily: "'Roboto Slab',serif" }} className="font-bold text-lg">Build<span className="text-accent">Connect</span></span></div>
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-1">Welcome back</h1>
            <p className="text-sm text-muted-foreground mb-7">Sign in to book services and manage your projects</p>
            {routeData?.message && <p role="status" className="bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 mb-5 text-sm">{routeData.message}</p>}
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Email Address</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Enter your email address" required className="w-full bg-input-background border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 placeholder:text-muted-foreground" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Password</label><button type="button" onClick={() => setShowForgot(true)} className="text-xs text-accent hover:underline">Forgot password?</button></div>
                <div className="relative">
                  <input type={show ? "text" : "password"} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" required className="w-full bg-input-background border border-border rounded-lg px-4 py-3 pr-11 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 placeholder:text-muted-foreground" />
                  <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </div>
              </div>
              <button type="submit" disabled={loading} className="w-full bg-accent text-white font-semibold py-3 rounded-lg hover:bg-accent/90 disabled:opacity-60 flex items-center justify-center gap-2">
                {loading ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Signing in…</> : "Sign In"}
              </button>
              {import.meta.env.VITE_GOOGLE_CLIENT_ID && <div className="flex justify-center pt-1"><GoogleLogin onSuccess={googleSignIn} onError={() => setError("Google sign-in was cancelled or failed")} useOneTap={false} /></div>}
              {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            </form>
            <p className="text-center text-sm text-muted-foreground mt-5">Don't have an account?{" "}<button onClick={() => go("register", routeData?.redirect ? { redirect: routeData.redirect } : {})} className="text-accent font-semibold hover:underline">Sign up free</button></p>
          </div>
        </div>
      </div>
    </div>
    <Footer />
  </div>);
}
function RegisterPage() {
  const { go, setLoggedIn, setUser, routeData } = useApp();
  const [role, setRole] = useState("customer");
  const [step, setStep] = useState(1);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", city: "", trade: "", storeName: "", addressLine1: "", addressLine2: "", state: "", pincode: "", country: "India" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const googleRegister = async (credentialResponse) => {
    setLoading(true); setError("");
    try {
      const data = await authApi.googleLogin(credentialResponse.credential, role);
      sessionStorage.setItem("buildconnect_token", data.token); sessionStorage.setItem("buildconnect_user", JSON.stringify(data.user)); setUser(data.user); setLoggedIn(true);
      if (routeData?.redirect?.page) go(routeData.redirect.page, routeData.redirect.data || {});
      else go(data.user.role === "provider" ? "provider-dashboard" : "customer-dashboard");
    } catch (requestError) { setError(requestError.message); } finally { setLoading(false); }
  };
  const next = async (e) => {
    e.preventDefault();
    if (step < 2) {
      setStep(2);
      return;
    }
    setLoading(true);
    setError("");
    try {
      await authApi.register({ ...form, role });
      setUser(null);
      setLoggedIn(false);
      go("login", { message: "Account created successfully. Please sign in to continue.", ...(routeData?.redirect ? { redirect: routeData.redirect } : {}) });
    }
    catch (requestError) {
      setError(requestError.message);
    }
    finally {
      setLoading(false);
    }
  };
  return (<div className="min-h-screen flex flex-col bg-background">
    <Navbar />
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg">
        <div className="bg-card border border-border rounded-2xl shadow-lg overflow-hidden">
          <div className="h-1.5 bg-accent" />
          <div className="p-8">
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-1">Create your account</h1>
            <p className="text-sm text-muted-foreground mb-6">Join construction professionals and homeowners on BuildConnect</p>
            <div className="flex bg-muted rounded-lg p-1 mb-6 gap-1">
              {["customer", "provider"].map(r => <button key={r} onClick={() => setRole(r)} className={`flex-1 text-sm font-semibold py-2 rounded-md capitalize transition-colors ${role === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{r === "customer" ? "👤 Customer" : "👷 Provider"}</button>)}
            </div>
            <div className="flex items-center gap-3 mb-7">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${step >= 1 ? "bg-accent text-white" : "bg-muted text-muted-foreground"}`}>{step > 1 ? <Check size={13} /> : 1}</div>
              <div className={`flex-1 h-px ${step > 1 ? "bg-accent" : "bg-border"}`} />
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${step >= 2 ? "bg-accent text-white" : "bg-muted text-muted-foreground"}`}>2</div>
            </div>
            <form onSubmit={next} className="space-y-4">
              {step === 1 ? (<>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Full Name</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Enter your full name" required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent placeholder:text-muted-foreground" /></div>
                  <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Phone</label><input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Enter phone number" required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent placeholder:text-muted-foreground" /></div>
                </div>
                <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Email</label><input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Enter your email address" required className="w-full bg-input-background border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-accent placeholder:text-muted-foreground" /></div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Password</label>
                  <div className="relative"><input type={show ? "text" : "password"} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Min. 8 characters" required minLength={8} className="w-full bg-input-background border border-border rounded-lg px-4 py-3 pr-11 text-sm outline-none focus:border-accent placeholder:text-muted-foreground" /><button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
                  <div className="flex gap-1 mt-2">{[0, 1, 2, 3].map(i => <div key={i} className={`h-1 flex-1 rounded-full ${form.password.length > i * 2 ? "bg-accent" : "bg-border"}`} />)}</div>
                </div>
              </>) : (<>
                  <div className="space-y-3 mb-4">
                    {role === "provider" && <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Store Name</label><input value={form.storeName} onChange={e => setForm(f => ({ ...f, storeName: e.target.value }))} placeholder="Store Name" required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent placeholder:text-muted-foreground" /></div>}
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">{role === "provider" ? "Shop Address Line 1" : "Home Address Line 1"}</label><input value={form.addressLine1} onChange={e => setForm(f => ({ ...f, addressLine1: e.target.value }))} placeholder="123 Main St" required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent placeholder:text-muted-foreground" /></div>
                      <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Address Line 2 (Optional)</label><input value={form.addressLine2} onChange={e => setForm(f => ({ ...f, addressLine2: e.target.value }))} placeholder="Apt 4B" className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent placeholder:text-muted-foreground" /></div>
                    </div>
                    <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">City</label><input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="City" required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent placeholder:text-muted-foreground" /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">State</label><input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} placeholder="Tamil Nadu" required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent placeholder:text-muted-foreground" /></div>
                      <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Pincode</label><input value={form.pincode} onChange={e => setForm(f => ({ ...f, pincode: e.target.value }))} placeholder="600001" required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent placeholder:text-muted-foreground" /></div>
                    </div>
                    {role === "provider" && <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Primary Trade</label><select value={form.trade} onChange={e => setForm(f => ({ ...f, trade: e.target.value }))} required className="w-full bg-input-background border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-accent"><option value="">Select trade</option>{["Electrical", "Plumbing", "Painting", "Carpentry"].map(t => <option key={t}>{t}</option>)}</select></div>}
                  </div>
                <div className="bg-accent/5 border border-accent/20 rounded-lg p-4 mt-4"><p className="text-xs font-semibold mb-2">By registering you agree to:</p><ul className="text-xs text-muted-foreground space-y-1">{["Terms of Service", "Privacy Policy", "Post-paid billing terms"].map(t => <li key={t} className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-accent" />{t}</li>)}</ul></div>
              </>)}
              <div className="flex gap-3">
                {step > 1 && <button type="button" onClick={() => setStep(1)} className="flex items-center gap-1.5 border border-border px-5 py-3 rounded-lg text-sm font-semibold hover:bg-muted"><ArrowLeft size={15} />Back</button>}
                <button type="submit" disabled={loading} className="flex-1 bg-accent text-white font-semibold py-3 rounded-lg hover:bg-accent/90 disabled:opacity-60">{loading ? "Creating account..." : step === 1 ? "Continue" : "Create Account"}</button>
              </div>
              {import.meta.env.VITE_GOOGLE_CLIENT_ID && <div className="flex justify-center pt-1"><GoogleLogin onSuccess={googleRegister} onError={() => setError("Google registration was cancelled or failed")} useOneTap={false} /></div>}
              {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            </form>
            <p className="text-center text-sm text-muted-foreground mt-5">Have an account?{" "}<button onClick={() => go("login")} className="text-accent font-semibold hover:underline">Sign in</button></p>
          </div>
        </div>
      </div>
    </div>
    <Footer />
  </div>);
}
// ─── CUSTOMER DASHBOARD ───────────────────────────────────────────────────────
// ─── DASHBOARD MOBILE NAV ────────────────────────────────────────────────────
function DashboardMobileNav({ items, active, onChange }) {
  return (
    <div className="md:hidden sticky top-14 z-40 bg-card border-b border-border overflow-x-auto">
      <div className="flex items-center gap-1 px-3 py-2 min-w-max">
        {items.map(({ id, icon: Icon, label }) => (
          <button key={id} onClick={() => onChange(id)} className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${active === id ? "bg-accent text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>
    </div>
  );
}
function AppearanceSettingsPanel() {
  const { colorTheme, changeColorTheme } = useTheme();

  return (
    <>
      <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-6">Settings</h1>
      <div className="bg-card border border-border rounded-xl p-6 max-w-lg space-y-8 animate-in fade-in">
        
        {/* Appearance */}
        <div>
          <h2 className="text-lg font-semibold mb-4 border-b border-border pb-2">Appearance</h2>
          
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="font-medium">Light / Dark Mode</p>
              <p className="text-sm text-muted-foreground">Toggle between light and dark backgrounds</p>
            </div>
            <ThemeToggle />
          </div>

          <div>
            <p className="font-medium mb-2">Accent Color Theme</p>
            <p className="text-sm text-muted-foreground mb-4">Choose your primary brand color</p>
            <div className="flex gap-4">
              {[
                { id: "theme-orange", color: "#e8751a", label: "Orange" },
                { id: "theme-blue", color: "#2563eb", label: "Blue" },
                { id: "theme-green", color: "#16a34a", label: "Green" },
                { id: "theme-purple", color: "#9333ea", label: "Purple" }
              ].map(t => (
                <button 
                  key={t.id} 
                  onClick={() => changeColorTheme(t.id)}
                  className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${colorTheme === t.id ? 'border-foreground scale-110 shadow-md' : 'border-transparent hover:scale-105'}`}
                  style={{ backgroundColor: t.color }}
                  title={t.label}
                >
                  {colorTheme === t.id && <Check size={20} color="white" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Language Preferences */}
        <div>
          <h2 className="text-lg font-semibold mb-4 border-b border-border pb-2">Language Preferences</h2>
          <div className="mb-6">
            <p className="font-medium mb-2">Select Language</p>
            <p className="text-sm text-muted-foreground mb-4">Choose your preferred language. The entire application will be instantly translated to help you navigate and interact seamlessly.</p>
            <LanguageSelector />
          </div>
        </div>

      </div>
    </>
  );
}

function CustomerDashboard() {
  const { go, setLoggedIn, user, setUser } = useApp();
  const [section, setSection] = useState("overview");
  const [profileForm, setProfileForm] = useState({ name: user?.name || "", phone: user?.phone || "", city: user?.city || "", profileImage: user?.profileImage || "", addressLine1: user?.addressLine1 || "", pincode: user?.pincode || "", state: user?.state || "" });
  const [profileMessage, setProfileMessage] = useState("");
  
  const handleImageUpload = (e, setForm) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setForm(f => ({ ...f, profileImage: reader.result }));
      reader.readAsDataURL(file);
    }
  };

  const handlePincodeChange = async (e, setForm) => {
    const pin = e.target.value;
    setForm(f => ({ ...f, pincode: pin }));
    if (pin.length === 6) {
      try {
        const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
        const data = await res.json();
        if (data && data[0].Status === "Success") {
          const po = data[0].PostOffice[0];
          setForm(f => ({ ...f, city: po.District, state: po.State }));
        }
      } catch (err) { console.error(err); }
    }
  };
  const saveProfile = async (event) => { event.preventDefault(); try { const updated = await userApi.update(profileForm); setUser(updated); sessionStorage.setItem("buildconnect_user", JSON.stringify(updated)); setProfileMessage("Profile updated"); } catch (error) { setProfileMessage(error.message); } };
  const [passwordMessage, setPasswordMessage] = useState("");
  const changeCustomerPassword = async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { await userApi.changePassword(Object.fromEntries(form)); event.currentTarget.reset(); setPasswordMessage("Password changed"); } catch (error) { setPasswordMessage(error.message); } };
  const [bookings, setBookings] = useState([]);
  const [bookingLoading, setBookingLoading] = useState(true);
  const [bookingError, setBookingError] = useState("");
  const [reviewBooking, setReviewBooking] = useState(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewMessage, setReviewMessage] = useState("");
  const CATEGORY_IMAGES = {
    Plumbing: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=500&h=200&fit=crop",
    Electrical: "https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=500&h=200&fit=crop",
    Painting: "https://images.unsplash.com/photo-1562259929-b4e1fd3aef09?w=500&h=200&fit=crop",
    Carpentry: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=500&h=200&fit=crop",
    default: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=500&h=200&fit=crop",
  };
  useEffect(() => {
    const fetchBookings = () => {
      bookingApi.getMyBookings().then(items => setBookings(items.map(item => {
        const category = item.package?.category || item.service?.category || "default";
        const fallbackImage = CATEGORY_IMAGES[category] || CATEGORY_IMAGES.default;
        return {
          id: item._id,
          svc: item.package?.title || item.service?.name || "Service booking",
          image: item.package?.images?.[0] || item.package?.image || item.service?.images?.[0] || item.service?.image || fallbackImage,
          category,
          provider: item.provider?.name || "Provider",
          providerImage: item.provider?.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.provider?.name || 'Provider')}&background=f97316&color=fff&size=80`,
          providerId: item.provider?._id,
          date: new Date(item.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
          endDate: item.endDate ? new Date(item.endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null,
          time: item.time,
          address: item.address,
          requirements: item.requirements,
          serviceId: item.service?._id || item.package?._id,
          status: item.status,
          price: item.price ? `₹${item.price}` : "Quoted",
          color: bookingStatusColor(item.status),
          type: item.package ? "Package" : "Service",
          bookingId: item._id,
          paymentStatus: item.paymentStatus || "UNPAID",
          materials: item.materials || [],
          rawPrice: item.price || 0,
          isPackage: !!item.package,
          total: (item.price || 0) + (item.materials || []).reduce((sum, material) => sum + (material.cost || 0), 0),
          timeline: { requestedAt: item.createdAt, acceptedAt: item.acceptedAt, startedAt: item.startedAt, completedAt: item.completedAt },
          invoiceNumber: item.invoiceNumber || "",
        };
      }))).catch(error => setBookingError(error.message)).finally(() => setBookingLoading(false));
    };
    
    fetchBookings();
    const intervalId = setInterval(fetchBookings, 2000);
    return () => clearInterval(intervalId);
  }, []);
  const [reviewMedia, setReviewMedia] = useState([]);
  const submitReview = async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData();
      formData.append("booking", reviewBooking.bookingId);
      formData.append("rating", reviewRating);
      formData.append("comment", reviewComment);
      reviewMedia.forEach(file => formData.append("media", file));

      await reviewApi.create(formData);
      setReviewMessage("Review submitted"); 
      setReviewBooking(null); 
      setReviewComment("");
      setReviewMedia([]);
    } catch (error) { setReviewMessage(error.message); }
  };

  // --- Chat state & socket ---
  const [chatSocket, setChatSocket] = useState(null);
  const [chatBookingId, setChatBookingId] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [newChatMsg, setNewChatMsg] = useState("");
  const chatEndRef = useRef(null);

  useEffect(() => {
    const s = io((import.meta.env.VITE_API_URL || "http://localhost:5000/api").replace("/api", ""));
    setChatSocket(s);
    s.on("receive_message", (msg) => setChatMessages(prev => [...prev, msg]));
    return () => { s.disconnect(); };
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  const openChat = async (bookingId) => {
    setChatBookingId(bookingId);
    try {
      const msgs = await messageApi.getMessages(bookingId);
      setChatMessages(msgs);
      chatSocket?.emit("join_chat", bookingId);
    } catch (e) { console.error(e); }
  };

  const sendChat = () => {
    if (!newChatMsg.trim() || !chatBookingId) return;
    const booking = bookings.find(b => b.bookingId === chatBookingId);
    if (!booking) return;
    chatSocket?.emit("send_message", { bookingId: chatBookingId, senderId: user?._id || user?.id, receiverId: booking.providerId, text: newChatMsg.trim() });
    setNewChatMsg("");
  };

  const handlePayment = async (booking) => {
    try {
      const order = await paymentApi.createOrder(booking.bookingId);
      const options = {
        key: order.key,
        amount: order.amount,
        currency: order.currency,
        name: "BuildConnect",
        description: `Payment for ${booking.svc}`,
        order_id: order.orderId,
        handler: async (response) => {
          try {
            await paymentApi.verify({
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            setBookings(items => items.map(item => item.bookingId === booking.bookingId ? { ...item, paymentStatus: "PAID" } : item));
            alert("Payment successful! Thank you.");
          } catch (err) { alert("Payment verification failed: " + err.message); }
        },
        prefill: { name: user?.name || "", email: user?.email || "", contact: user?.phone || "" },
        theme: { color: "#F97316" },
      };
      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err) { alert("Could not initiate payment: " + err.message); }
  };

  const sidebar = [{ id: "overview", icon: LayoutDashboard, label: "Overview" }, { id: "bookings", icon: Calendar, label: "My Bookings" }, { id: "messages", icon: MessageSquare, label: "Messages" }, { id: "profile", icon: User, label: "Profile" }, { id: "settings", icon: Settings, label: "Settings" }];
  return (<div className="min-h-screen flex flex-col bg-background">
    <header className="bg-primary text-primary-foreground h-14 flex items-center justify-between px-4 sm:px-6 sticky top-0 z-50">
      <button onClick={() => go("home")} className="flex items-center gap-2"><Building2 size={20} className="text-accent" /><span style={{ fontFamily: "'Roboto Slab',serif" }} className="font-bold">Build<span className="text-accent">Connect</span></span></button>
      <div className="flex items-center gap-3">
        <NotificationBell />
        {user?.profileImage ? <img src={user.profileImage} alt={user?.name || "Customer"} className="w-8 h-8 rounded-full object-cover" /> : <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-xs font-bold text-white">{(user?.name || "C")[0].toUpperCase()}</div>}
        <button onClick={() => { setLoggedIn(false); go("home"); }} className="text-white/60 hover:text-white"><LogOut size={16} /></button>
      </div>
    </header>
    <DashboardMobileNav items={sidebar} active={section} onChange={setSection} />
    <div className="flex flex-1">
      <aside className="w-56 bg-card border-r border-border shrink-0 hidden md:block">
        <div className="p-4 border-b border-border"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-sm font-bold text-accent">{(user?.name || "U")[0]}</div><div><p className="text-sm font-semibold">{user?.name || "Customer"}</p><p className="text-xs text-muted-foreground">Customer</p></div></div></div>
        <nav className="p-3">{sidebar.map(({ id, icon: Icon, label }) => <button key={id} onClick={() => setSection(id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium mb-1 transition-colors ${section === id ? "bg-accent text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Icon size={16} />{label}</button>)}</nav>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-4 sm:p-6">
          {section === "overview" && (<>
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-6">Dashboard</h1>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[{ label: "Total Bookings", value: bookings.length, icon: Calendar, color: "text-blue-600 bg-blue-50" }, { label: "Completed", value: bookings.filter(b => b.status === "COMPLETED").length, icon: CheckCircle2, color: "text-green-600 bg-green-50" }, { label: "Pending / Active", value: bookings.filter(b => ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(b.status)).length, icon: Banknote, color: "text-amber-600 bg-amber-50" }, { label: "Cancelled / Rejected", value: bookings.filter(b => ["CANCELLED", "REJECTED"].includes(b.status)).length, icon: DollarSign, color: "text-accent bg-orange-50" }].map(({ label, value, icon: Icon, color }) => (<div key={label} className="bg-card border border-border rounded-xl p-4"><div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${color}`}><Icon size={18} /></div><p style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold">{bookingLoading ? "…" : value}</p><p className="text-xs text-muted-foreground mt-0.5">{label}</p></div>))}
            </div>
            <h2 className="font-semibold mb-4">Recent Bookings</h2>
            <div className="bg-card border border-border rounded-xl overflow-x-auto mb-8">
              <table className="w-full text-sm">
                <thead className="bg-muted"><tr>{["ID", "Service / Package", "Type", "Provider", "Date", "Status", "Amount"].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">
                  {bookings.map(b => (<tr key={b.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3"><span style={{ fontFamily: "'DM Mono',monospace" }} className="text-xs text-muted-foreground">{b.id}</span></td>
                    <td className="px-4 py-3 font-medium">{b.svc}</td>
                    <td className="px-4 py-3"><Badge color={b.type === "Package" ? "orange" : "blue"}>{b.type}</Badge></td>
                    <td className="px-4 py-3 text-muted-foreground">{b.provider}</td>
                    <td className="px-4 py-3 text-muted-foreground">{b.date}</td>
                    <td className="px-4 py-3"><Badge color={b.color}>{b.status}</Badge></td>
                    <td className="px-4 py-3 font-semibold">{b.price}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-accent text-white rounded-xl p-5"><h3 className="font-bold mb-1">Browse Packages</h3><p className="text-white/70 text-sm mb-4">Provider-posted packages with fixed pricing and full team details.</p><button onClick={() => go("packages")} className="bg-white text-accent text-sm font-semibold px-4 py-2 rounded-lg">View Packages</button></div>
              <div className="bg-accent text-white rounded-xl p-5"><h3 className="font-bold mb-1">Book a Provider Directly</h3><p className="text-white/70 text-sm mb-4">Use general booking for custom jobs with any provider.</p><button onClick={() => go("providers")} className="bg-white text-accent text-sm font-semibold px-4 py-2 rounded-lg">Find Providers</button></div>
            </div>
          </>)}
          {section === "bookings" && (<>
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-6">My Bookings</h1>
            <div className="grid md:grid-cols-2 gap-5">
              {bookingLoading && <p className="py-10 text-center text-sm text-muted-foreground col-span-2">Loading bookings...</p>}
              {bookingError && <p role="alert" className="py-4 text-sm text-red-600 col-span-2">{bookingError}</p>}
              {!bookingLoading && !bookingError && bookings.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground col-span-2">No bookings yet</p>}
              {!bookingLoading && bookings.map(b => (
                <div key={b.id} className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg transition-all group flex flex-col">
                  <div className={`h-2 w-full ${b.status === 'COMPLETED' ? 'bg-blue-500' : b.status === 'CANCELLED' || b.status === 'REJECTED' ? 'bg-red-500' : b.status === 'IN_PROGRESS' ? 'bg-orange-500' : 'bg-green-500'}`} />
                  
                  <div className="h-36 w-full bg-muted overflow-hidden relative shrink-0">
                    <img 
                      src={b.image} 
                      alt={b.svc} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      onError={e => { e.currentTarget.src = `https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=500&h=200&fit=crop`; }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                    <div className="absolute top-3 right-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${b.isPackage ? 'bg-accent text-white' : 'bg-white/90 text-accent'}`}>{b.isPackage ? '📦 Package' : '🔧 Service'}</span>
                    </div>
                    <div className="absolute bottom-3 left-3 flex items-center gap-2">
                      <img src={b.providerImage} alt={b.provider} className="w-7 h-7 rounded-full border-2 border-white/70 object-cover shadow-md" 
                        onError={e => { e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(b.provider)}&background=f97316&color=fff&size=40`; }}
                      />
                      <span className="text-white text-xs font-semibold drop-shadow">{b.provider}</span>
                    </div>
                  </div>

                  <div className="p-5 flex flex-col flex-1">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Badge color={b.color}>{b.status}</Badge>
                          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{b.type}</span>
                        </div>
                        <h3 className="font-bold text-lg leading-tight mb-1 line-clamp-2">{b.svc}</h3>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-xl text-foreground">₹{b.rawPrice + (b.materials?.reduce((sum, m) => sum + m.cost, 0) || 0)}</p>
                        {b.materials?.length > 0 && <p className="text-[10px] text-muted-foreground mt-0.5">(Base: ₹{b.rawPrice})</p>}
                      </div>
                    </div>
                    
                    <div className="bg-muted/30 rounded-lg p-3 mb-4 space-y-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar size={13} className="text-accent shrink-0" />
                        <span>{b.endDate ? `${b.date} → ${b.endDate}` : b.date} at {b.time}</span>
                      </div>
                      <div className="flex items-start gap-2 text-xs text-muted-foreground">
                        <MapPin size={13} className="text-accent shrink-0 mt-0.5" />
                        <span className="line-clamp-2 leading-relaxed">{b.address}</span>
                      </div>
                      {b.requirements && (
                        <div className="flex items-start gap-2 text-xs text-muted-foreground">
                          <Tag size={13} className="text-accent shrink-0 mt-0.5" />
                          <span className="line-clamp-2 italic">"{b.requirements}"</span>
                        </div>
                      )}
                    </div>

                    {b.materials && b.materials.length > 0 && (
                      <div className="mb-4 bg-orange-50/50 p-3 rounded-lg border border-orange-100 text-xs">
                        <p className="font-semibold mb-2 text-orange-900 flex items-center gap-1.5"><Banknote size={13} /> Materials & Expenses</p>
                        <div className="space-y-1 mb-2">
                          {b.materials.map((m, i) => <div key={i} className="flex justify-between text-orange-800/80"><span>{m.name}</span><span>₹{m.cost}</span></div>)}
                        </div>
                        <div className="flex justify-between font-bold text-orange-900 pt-2 border-t border-orange-200"><span>Total Extra</span><span>₹{b.materials.reduce((sum, m) => sum + m.cost, 0)}</span></div>
                      </div>
                    )}

                    <WorkTimeline timeline={b.timeline} className="mb-3" />
                    {b.status === "COMPLETED" && b.invoiceNumber && (
                      <p className="text-[11px] text-muted-foreground mb-3 flex items-center gap-1.5"><FileText size={12} /> Bill {b.invoiceNumber}</p>
                    )}

                    <div className="mt-auto pt-4 border-t border-border flex items-center justify-between">
                      <div>
                        {b.status === "COMPLETED" && b.paymentStatus === "UNPAID" && <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wide">Payment Required</p>}
                        {b.status === "COMPLETED" && b.paymentStatus === "PAID" && <p className="text-[10px] font-semibold text-green-600 flex items-center gap-1"><CheckCircle2 size={12}/> PAID</p>}
                        {(b.status === "ACCEPTED" || b.status === "IN_PROGRESS") && <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Pay after completion</p>}
                      </div>
                      <div className="flex gap-2 items-center">
                        {b.status === "COMPLETED" && <BillButton bookingId={b.bookingId} invoiceNumber={b.invoiceNumber} label="Bill" />}
                        {(b.status === "PENDING" || b.status === "ACCEPTED") && <button onClick={() => bookingApi.cancelBooking(b.bookingId).then(() => setBookings(items => items.map(item => item.bookingId === b.bookingId ? { ...item, status: "CANCELLED", color: "red" } : item))).catch(error => setBookingError(error.message))} className="text-xs text-red-600 font-semibold px-3 py-1.5 hover:bg-red-50 rounded-lg transition-colors">Cancel</button>}
                        {b.status === "COMPLETED" && <button onClick={() => setReviewBooking(b)} className="text-xs font-semibold bg-muted text-foreground px-3 py-1.5 rounded-lg hover:bg-accent hover:text-white transition-colors">Leave Review</button>}
                        {b.status === "COMPLETED" && b.paymentStatus === "UNPAID" && <button onClick={() => handlePayment(b)} className="text-xs bg-green-600 text-white px-4 py-1.5 rounded-lg font-bold hover:bg-green-700 shadow-sm transition-colors">Pay Now</button>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {reviewBooking && (
              <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                <form onSubmit={submitReview} className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg shadow-2xl relative animate-in zoom-in-95 duration-200">
                  <button type="button" onClick={() => { setReviewBooking(null); setReviewMedia([]); }} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground bg-muted p-2 rounded-full"><X size={16} /></button>
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center text-accent shrink-0"><Star size={24} /></div>
                    <div>
                      <h2 className="font-bold text-lg">Leave a Review</h2>
                      <p className="text-xs text-muted-foreground line-clamp-1">{reviewBooking.svc}</p>
                    </div>
                  </div>
                  <div className="mb-4">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Rating</label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button key={value} type="button" onClick={() => setReviewRating(value)} className={`w-10 h-10 flex items-center justify-center rounded-xl border transition-all ${reviewRating >= value ? "bg-amber-500 border-amber-500 text-white shadow-sm" : "bg-muted border-transparent text-muted-foreground hover:bg-amber-100 hover:text-amber-500"}`}>
                          <Star size={16} className={reviewRating >= value ? "fill-white" : ""} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mb-4">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Comment</label>
                    <textarea required value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} rows={3} placeholder="Tell us about the completed work" className="w-full bg-input-background border border-border rounded-xl p-3 text-sm outline-none focus:border-accent resize-none placeholder:text-muted-foreground" />
                  </div>
                  <div className="mb-6">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Add Photos/Videos</label>
                    <div className="relative border-2 border-dashed border-border hover:border-accent rounded-xl p-4 text-center transition-colors">
                      <input type="file" multiple accept="image/*,video/*" onChange={e => setReviewMedia(Array.from(e.target.files))} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                      <p className="text-sm font-semibold text-accent mb-1">Click to browse or drag media</p>
                      <p className="text-xs text-muted-foreground">Up to 5 images or short videos</p>
                      {reviewMedia.length > 0 && <p className="text-xs font-bold text-foreground mt-2">{reviewMedia.length} file(s) selected</p>}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button type="submit" className="flex-1 bg-accent text-white py-3 rounded-xl text-sm font-semibold hover:bg-accent/90 transition-all shadow-md">Submit Review</button>
                  </div>
                  {reviewMessage && <p className="text-sm text-green-600 font-semibold mt-3 text-center bg-green-50 py-2 rounded-lg">{reviewMessage}</p>}
                </form>
              </div>
            )}
          </>)}
          {section === "messages" && (<>
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-6">Messages</h1>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="p-3 border-b border-border"><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your Bookings</p></div>
                <div className="divide-y divide-border max-h-96 overflow-y-auto">
                  {bookings.length === 0 && <p className="p-4 text-sm text-muted-foreground text-center">No bookings yet</p>}
                  {bookings.map(b => (<button key={b.bookingId} onClick={() => openChat(b.bookingId)} className={`w-full text-left p-3 hover:bg-muted/50 transition-colors ${chatBookingId === b.bookingId ? "bg-accent/10 border-l-2 border-accent" : ""}`}><p className="text-sm font-medium truncate">{b.svc}</p><p className="text-xs text-muted-foreground">{b.provider} · {b.date}</p><Badge color={b.color}>{b.status}</Badge></button>))}
                </div>
              </div>
              <div className="md:col-span-2 bg-card border border-border rounded-xl flex flex-col" style={{ minHeight: 400 }}>
                {!chatBookingId ? (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm"><MessageSquare size={20} className="mr-2 opacity-50" />Select a booking to start chatting</div>
                ) : (<>
                  <div className="p-3 border-b border-border flex items-center gap-2"><MessageSquare size={16} className="text-accent" /><p className="text-sm font-semibold">{bookings.find(b => b.bookingId === chatBookingId)?.svc || "Chat"}</p></div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {chatMessages.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">No messages yet. Say hello!</p>}
                    {chatMessages.map((msg, idx) => (
                      <div key={idx} className={`flex ${msg.senderId === (user?._id || user?.id) ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[70%] px-3 py-2 rounded-xl text-sm ${msg.senderId === (user?._id || user?.id) ? "bg-accent text-white rounded-br-sm" : "bg-muted rounded-bl-sm"}`}>
                          <p>{msg.text}</p>
                          <p className={`text-[10px] mt-1 ${msg.senderId === (user?._id || user?.id) ? "text-white/60" : "text-muted-foreground"}`}>{new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                        </div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="p-3 border-t border-border flex gap-2">
                    <input value={newChatMsg} onChange={e => setNewChatMsg(e.target.value)} onKeyDown={e => e.key === "Enter" && sendChat()} placeholder="Type a message..." className="flex-1 bg-input-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent" />
                    <button onClick={sendChat} className="bg-accent text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-accent/90">Send</button>
                  </div>
                </>)}
              </div>
            </div>
          </>)}
          {section === "profile" && (<>
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-6">My Profile</h1>
            <div className="bg-card border border-border rounded-xl p-6 max-w-lg">
              <div className="flex items-center gap-4 mb-6 pb-6 border-b border-border"><div className="w-16 h-16 rounded-xl bg-accent/10 flex items-center justify-center text-2xl font-bold text-accent overflow-hidden">{user?.profileImage ? <img src={user.profileImage} alt="Profile" className="w-full h-full object-cover" /> : (user?.name || "U")[0]}</div><div><p className="font-bold">{user?.name || "Customer"}</p><p className="text-sm text-muted-foreground">{user?.city || "Tamil Nadu"}</p></div></div>
              <div className="space-y-4">
                <form onSubmit={saveProfile} className="space-y-4"><div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Profile picture</label><input type="file" accept="image/*" onChange={e => handleImageUpload(e, setProfileForm)} className="w-full bg-input-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent mb-2" /><input type="url" value={profileForm.profileImage || ""} onChange={e => setProfileForm(f => ({ ...f, profileImage: e.target.value }))} placeholder="Or paste an image URL" className="w-full bg-input-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent" /></div><div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Full Name</label><input value={profileForm.name} onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))} required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent" /></div><div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Email</label><input value={user?.email || ""} disabled className="w-full bg-muted border border-border rounded-lg px-4 py-2.5 text-sm" /></div><div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Phone</label><input value={profileForm.phone} onChange={e => setProfileForm(f => ({ ...f, phone: e.target.value }))} className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent" /></div><div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Address Line 1</label><input value={profileForm.addressLine1} onChange={e => setProfileForm(f => ({ ...f, addressLine1: e.target.value }))} className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent" /></div><div className="grid grid-cols-2 gap-4"><div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Pincode</label><input value={profileForm.pincode} onChange={e => handlePincodeChange(e, setProfileForm)} maxLength={6} className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent" /></div><div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">State</label><input value={profileForm.state} onChange={e => setProfileForm(f => ({ ...f, state: e.target.value }))} className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent" /></div></div><div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">City / District</label><input value={profileForm.city} onChange={e => setProfileForm(f => ({ ...f, city: e.target.value }))} className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent" /></div><button type="submit" className="bg-accent text-white font-semibold px-5 py-2.5 rounded-lg hover:bg-accent/90 text-sm">Save Changes</button>{profileMessage && <p role="status" className="text-sm text-muted-foreground">{profileMessage}</p>}</form>
                <form onSubmit={changeCustomerPassword} className="mt-4 pt-6 border-t border-border space-y-3"><h2 className="font-semibold">Change Password</h2><input name="currentPassword" type="password" required placeholder="Current password" className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm" /><input name="newPassword" type="password" minLength="8" required placeholder="New password (min. 8 characters)" className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm" /><button type="submit" className="border border-border font-semibold px-5 py-2.5 rounded-lg text-sm">Update Password</button>{passwordMessage && <p role="status" className="text-sm text-muted-foreground">{passwordMessage}</p>}</form>
              </div>
            </div>
          </>)}
          {section === "settings" && <AppearanceSettingsPanel />}
        </div>
      </main>
    </div>
  </div>);
}
function ProviderDashboard() {
  const { go, setLoggedIn, user, setUser } = useApp();
  const [section, setSection] = useState("overview");
  const [showTour, setShowTour] = useState(() => !localStorage.getItem("buildconnect_provider_tour_done"));
  const [providerProfile, setProviderProfile] = useState({ name: user?.name || "", phone: user?.phone || "", city: user?.city || "", trade: user?.trade || "", profileImage: user?.profileImage || "", availability: user?.availability !== false, addressLine1: user?.addressLine1 || "", pincode: user?.pincode || "", state: user?.state || "" });
  const [profileMessage, setProfileMessage] = useState("");
  
  const handleImageUpload = (e, setForm) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setForm(f => ({ ...f, profileImage: reader.result }));
      reader.readAsDataURL(file);
    }
  };

  const handlePincodeChange = async (e, setForm) => {
    const pin = e.target.value;
    setForm(f => ({ ...f, pincode: pin }));
    if (pin.length === 6) {
      try {
        const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
        const data = await res.json();
        if (data && data[0].Status === "Success") {
          const po = data[0].PostOffice[0];
          setForm(f => ({ ...f, city: po.District, state: po.State }));
        }
      } catch (err) { console.error(err); }
    }
  };
  
  const saveProviderProfile = async (event) => { event.preventDefault(); try { const updated = await userApi.update(providerProfile); setUser(updated); sessionStorage.setItem("buildconnect_user", JSON.stringify(updated)); setProfileMessage("Profile updated"); } catch (error) { setProfileMessage(error.message); } };
  const changeProviderPassword = async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { await userApi.changePassword(Object.fromEntries(form)); event.currentTarget.reset(); setProfileMessage("Password changed"); } catch (error) { setProfileMessage(error.message); } };
  const [bookings, setBookings] = useState([]);
  const [bookingLoading, setBookingLoading] = useState(true);
  const [bookingError, setBookingError] = useState("");
  const [bookingAction, setBookingAction] = useState("");
  const [materialFormFor, setMaterialFormFor] = useState(null);
  const [newMaterialName, setNewMaterialName] = useState("");
  const [newMaterialCost, setNewMaterialCost] = useState("");

  const handleAddMaterial = async (e, bookingId) => {
    e.preventDefault();
    if (!newMaterialName || !newMaterialCost) return;
    try {
      setBookingAction(bookingId);
      const booking = bookings.find(b => b.bookingId === bookingId);
      const updatedMaterials = [...(booking.materials || []), { name: newMaterialName, cost: Number(newMaterialCost) }];
      const res = await bookingApi.addMaterials(bookingId, updatedMaterials);
      setBookings(items => items.map(item => item.bookingId === bookingId ? { ...item, materials: res.materials } : item));
      setNewMaterialName("");
      setNewMaterialCost("");
    } catch (err) { setBookingError(err.message); } finally { setBookingAction(""); }
  };
  useEffect(() => {
    const fetchBookings = () => {
      bookingApi.getProviderBookings().then(items => setBookings(items.map(item => ({
        id: item._id,
        svc: item.package?.title || item.service?.name || "Service booking",
        customer: item.customer?.name || "Customer",
        customerId: item.customer?._id,
        customerPhone: item.customer?.phone || "",
        date: new Date(item.date).toLocaleDateString(),
        endDate: item.endDate ? new Date(item.endDate).toLocaleDateString() : null,
        time: item.time,
        address: item.address,
        requirements: item.requirements,
        price: item.price ? `₹${item.price}` : "Quoted",
        rawPrice: item.price || 0,
        materials: item.materials || [],
        rawDate: new Date(item.date),
        status: item.status,
        type: item.package ? "Package" : "Service",
        color: bookingStatusColor(item.status),
        bookingId: item._id,
        paymentStatus: item.paymentStatus || "UNPAID",
        total: (item.price || 0) + (item.materials || []).reduce((sum, material) => sum + (material.cost || 0), 0),
        timeline: { requestedAt: item.createdAt, acceptedAt: item.acceptedAt, startedAt: item.startedAt, completedAt: item.completedAt },
        invoiceNumber: item.invoiceNumber || "",
      })))).catch(error => setBookingError(error.message)).finally(() => setBookingLoading(false));
    };

    fetchBookings();
    const intervalId = setInterval(fetchBookings, 2000);
    return () => clearInterval(intervalId);
  }, []);
  const updateBookingStatus = async (id, status) => {
    try {
      setBookingAction(id);
      const updated = await bookingApi.updateStatus(id, status);
      // Merge the server's view of the booking, not just the status: accepting /
      // starting / completing also stamps the timeline and (on completion) the
      // bill number, and those need to show up without a page reload.
      setBookings(items => items.map(item => (item.bookingId === id ? mergeBookingUpdate(item, updated) : item)));
    } catch (requestError) { setBookingError(requestError.message); } finally { setBookingAction(""); }
  };
  const cancelProviderBooking = async (id) => {
    try {
      setBookingAction(id);
      await bookingApi.cancelBooking(id);
      setBookings(items => items.map(item => item.bookingId === id ? { ...item, status: "CANCELLED", color: "red" } : item));
    } catch (requestError) { setBookingError(requestError.message); } finally { setBookingAction(""); }
  };

  const handleWhatsAppUpdate = (b) => {
    if (!b.customerPhone) {
      alert("Customer has no phone number on their profile.");
      return;
    }
    const phone = b.customerPhone.replace(/[^\d]/g, "");
    const providerName = user?.name || "Your provider";
    let text = "";
    
    if (b.status === "ACCEPTED") {
      text = `Hi ${b.customer},\n\nGood news — ${providerName} has accepted your booking for ${b.svc}.\n\nCost so far: ${b.price}\nWe'll update you when the work starts!`;
    } else if (b.status === "IN_PROGRESS") {
      text = `Hi ${b.customer},\n\n${providerName} has started work on your booking (${b.svc}).\n\nCost so far: ${b.price}\nWe'll send the final bill when the work is completed.`;
    } else if (b.status === "COMPLETED") {
      const materialsText = b.materials && b.materials.length > 0 ? `\nMaterials:\n` + b.materials.map(m => `- ${m.name}: ₹${m.cost}`).join("\n") : "";
      text = `Hi ${b.customer},\n\n${providerName} has completed your booking (${b.svc}).\n\nService Charge: ${b.price}${materialsText}\nTotal Bill: ₹${b.total}\nPayment Status: ${b.paymentStatus === 'PAID' ? 'Paid' : 'Payment due'}\n\nYou can download the full PDF bill from your dashboard!`;
    } else {
      text = `Hi ${b.customer},\n\nYour booking (${b.svc}) has been updated.`;
    }
    
    window.open(`https://wa.me/${phone.length === 10 ? '91' + phone : phone}?text=${encodeURIComponent(text)}`, '_blank');
  };

  // --- Chat state & socket ---
  const [chatSocket, setChatSocket] = useState(null);
  const [chatBookingId, setChatBookingId] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [newChatMsg, setNewChatMsg] = useState("");
  const chatEndRef = useRef(null);

  useEffect(() => {
    const s = io((import.meta.env.VITE_API_URL || "http://localhost:5000/api").replace("/api", ""));
    setChatSocket(s);
    s.on("receive_message", (msg) => setChatMessages(prev => [...prev, msg]));
    return () => { s.disconnect(); };
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  const openChat = async (bookingId) => {
    setChatBookingId(bookingId);
    try {
      const msgs = await messageApi.getMessages(bookingId);
      setChatMessages(msgs);
      chatSocket?.emit("join_chat", bookingId);
    } catch (e) { console.error(e); }
  };

  const sendChat = () => {
    if (!newChatMsg.trim() || !chatBookingId) return;
    const booking = bookings.find(b => b.bookingId === chatBookingId);
    if (!booking) return;
    chatSocket?.emit("send_message", { bookingId: chatBookingId, senderId: user?._id || user?.id, receiverId: booking.customerId, text: newChatMsg.trim() });
    setNewChatMsg("");
  };
  const [showForm, setShowForm] = useState(false);
  const [services, setServices] = useState([]);
  const [serviceForm, setServiceForm] = useState({ name: "", description: "", category: "", price: "", city: user?.city || "", imageUrl: "", availability: true });
  const [editingService, setEditingService] = useState(null);
  const [serviceMessage, setServiceMessage] = useState("");
  const [serviceError, setServiceError] = useState("");
  const [serviceLoading, setServiceLoading] = useState(false);
  const loadServices = async () => { try { setServiceLoading(true); setServices(await serviceApi.my()); } catch (error) { setServiceError(error.message); } finally { setServiceLoading(false); } };
  useEffect(() => { serviceApi.my().then(setServices).catch(error => setServiceError(error.message)).finally(() => setServiceLoading(false)); }, []);
  const openServiceForm = (service = null) => {
    setEditingService(service);
    setServiceForm(service ? { name: service.name, description: service.description, category: service.category, price: service.price, city: service.city, imageUrl: service.images?.[0] || "", availability: service.availability, experience: service.experience || "" } : { name: "", description: "", category: "", price: "", city: user?.city || "", imageUrl: "", availability: true, experience: "" });
    setServiceMessage(""); setServiceError("");
  };
  const submitService = async (event) => {
    event.preventDefault(); setServiceMessage(""); setServiceError("");
    if (!serviceForm.name || !serviceForm.description || !serviceForm.category || !serviceForm.city || Number(serviceForm.price) <= 0) { setServiceError("Name, description, category, city, and a price greater than 0 are required."); return; }
    try { if (editingService) await serviceApi.update(editingService._id, serviceForm); else await serviceApi.create(serviceForm); setServiceMessage(editingService ? "Service updated" : "Service created"); setEditingService(null); setShowForm(false); await loadServices(); } catch (error) { setServiceError(error.message); }
  };
  const removeService = async (service) => { if (!window.confirm(`Delete ${service.name}?`)) return; try { await serviceApi.delete(service._id); setServiceMessage("Service deleted"); await loadServices(); } catch (error) { setServiceError(error.message); } };
  const [pkgForm, setPkgForm] = useState({ title: "", category: "", price: "", duration: "", description: "", imageUrl: "" });
  const [editingPackage, setEditingPackage] = useState(null);
  const [packages, setPackages] = useState([]);
  const [packageError, setPackageError] = useState("");
  const [helpers, setHelpers] = useState([{ name: "", role: "", phone: "" }]);
  const [includes, setIncludes] = useState(["", ""]);
  const [submitting, setSubmitting] = useState(false);
  const [posted, setPosted] = useState(false);
  const addHelper = () => setHelpers(h => [...h, { name: "", role: "", phone: "" }]);
  const removeHelper = (i) => setHelpers(h => h.filter((_, idx) => idx !== i));
  const updateHelper = (i, field, val) => setHelpers(h => h.map((e, idx) => idx === i ? { ...e, [field]: val } : e));
  const loadPackages = async () => { try { setPackages(await packageApi.my()); } catch (error) { setPackageError(error.message); } };
  useEffect(() => { packageApi.my().then(setPackages).catch(error => setPackageError(error.message)); }, []);
  const openPackageForm = (pkg = null) => {
    setEditingPackage(pkg);
    setPkgForm(pkg ? { title: pkg.title, category: pkg.category, price: pkg.price, duration: pkg.duration, description: pkg.description, imageUrl: pkg.images?.[0] || "" } : { title: "", category: "", price: "", duration: "", description: "", imageUrl: "" });
    setIncludes(pkg && pkg.includes?.length ? pkg.includes : ["", ""]);
    setHelpers(pkg && pkg.helpers?.length ? pkg.helpers : [{ name: "", role: "", phone: "" }]);
    setPackageError("");
    setPosted(false);
    setShowForm(true);
  };
  const submitPackage = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setPackageError("");
    try { 
      const payload = { ...pkgForm, price: Number(pkgForm.price), includes: includes.filter(Boolean), helpers: helpers.filter(helper => helper.name.trim()), images: pkgForm.imageUrl ? [pkgForm.imageUrl] : [] };
      if (editingPackage) {
        await packageApi.update(editingPackage._id, payload);
      } else {
        await packageApi.create(payload);
        setPosted(true);
      }
      setShowForm(false); 
      setPkgForm({ title: "", category: "", price: "", duration: "", description: "", imageUrl: "" }); 
      setIncludes(["", ""]); 
      setHelpers([{ name: "", role: "", phone: "" }]); 
      setEditingPackage(null);
      await loadPackages(); 
    } catch (error) { setPackageError(error.message); } finally { setSubmitting(false); }
  };
  const sidebar = [{ id: "overview", icon: LayoutDashboard, label: "Overview" }, { id: "services", icon: Briefcase, label: "My Services" }, { id: "packages", icon: Package, label: "My Packages" }, { id: "bookings", icon: Inbox, label: "Bookings" }, { id: "messages", icon: MessageSquare, label: "Messages" }, { id: "profile", icon: User, label: "Profile" }, { id: "earnings", icon: DollarSign, label: "Earnings" }, { id: "settings", icon: Settings, label: "Settings" }];
  return (<div className="min-h-screen flex flex-col bg-background">
    {showTour && <ProviderOnboardingTour onComplete={() => {
      localStorage.setItem("buildconnect_provider_tour_done", "true");
      setShowTour(false);
    }} />}
    <header className="bg-primary text-primary-foreground h-14 flex items-center justify-between px-4 sm:px-6 sticky top-0 z-50">
      <button onClick={() => go("home")} className="flex items-center gap-2"><Building2 size={20} className="text-accent" /><span style={{ fontFamily: "'Roboto Slab',serif" }} className="font-bold">Build<span className="text-accent">Connect</span></span><span className="ml-2 text-xs bg-accent/20 text-accent px-2 py-0.5 rounded font-semibold">Provider</span></button>
      <div className="flex items-center gap-3">
        <NotificationBell />
        {user?.profileImage ? <img src={user.profileImage} alt={user.name || "Provider"} className="w-8 h-8 rounded-full object-cover" /> : <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-xs font-bold">{(user?.name || "P")[0]}</div>}
        <button onClick={() => { setLoggedIn(false); go("home"); }} className="text-white/60 hover:text-white"><LogOut size={16} /></button>
      </div>
    </header>
    <DashboardMobileNav items={sidebar} active={section} onChange={setSection} />
    <div className="flex flex-1">
      <aside className="w-56 bg-card border-r border-border shrink-0 hidden md:block">
        <div className="p-4 border-b border-border"><div className="flex items-center gap-3">{user?.profileImage ? <img src={user.profileImage} alt={user.name || "Provider"} className="w-10 h-10 rounded-xl object-cover bg-muted" /> : <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center text-sm font-bold">{(user?.name || "P")[0]}</div>}<div><p className="text-sm font-semibold">{user?.name || "Provider"}</p><p className="text-xs text-muted-foreground flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />Online</p></div></div></div>
        <nav className="p-3">{sidebar.map(({ id, icon: Icon, label }) => <button key={id} onClick={() => setSection(id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium mb-1 transition-colors ${section === id ? "bg-accent text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Icon size={16} />{label}</button>)}</nav>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-4 sm:p-6">
          {section === "overview" && (() => {
            const completedPaidBookings = bookings.filter(b => b.status === 'COMPLETED' && b.paymentStatus === 'PAID');
            const totalEarned = completedPaidBookings.reduce((sum, b) => sum + (b.rawPrice || 0), 0);
            
            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const now = new Date();
            const chartData = [];
            for (let i = 5; i >= 0; i--) {
              const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
              const mName = monthNames[d.getMonth()];
              const mYear = d.getFullYear();
              
              const monthEarnings = completedPaidBookings.filter(b => {
                const bd = b.rawDate;
                return bd && bd.getMonth() === d.getMonth() && bd.getFullYear() === mYear;
              }).reduce((sum, b) => sum + (b.rawPrice || 0), 0);
              
              chartData.push({ name: mName, earnings: monthEarnings });
            }

            return (
            <>
            <div className="flex items-center justify-between mb-6">
              <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold">Provider Overview</h1>
              <button onClick={() => { setSection("services"); openServiceForm(); setShowForm(true); }} className="bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 hover:bg-accent/90"><PlusCircle size={15} />Create Service</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[{ label: "Total Earned", value: `₹${totalEarned}`, icon: DollarSign, color: "text-accent bg-orange-50" }, { label: "Services Posted", value: services.length, icon: Briefcase, color: "text-blue-600 bg-blue-50" }, { label: "Pending Bookings", value: bookings.filter(booking => booking.status === "PENDING").length, icon: Clock, color: "text-amber-600 bg-amber-50" }, { label: "Avg Rating", value: user?.rating ? user.rating.toFixed(1) : "New", icon: Star, color: "text-yellow-600 bg-yellow-50" }].map(({ label, value, icon: Icon, color }) => (<div key={label} className="bg-card border border-border rounded-xl p-4"><div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${color}`}><Icon size={18} /></div><p style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>))}
            </div>
            <div className="bg-card border border-border rounded-xl p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4">Earnings Analytics (Last 6 Months)</h2>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} tickFormatter={val => `₹${val}`} />
                    <Tooltip cursor={{ fill: '#f3f4f6' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="earnings" fill="#F97316" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
            );
          })()}

          {section === "services" && (<>
            <div className="flex items-center justify-between mb-6"><h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold">My Services</h1><button onClick={() => { openServiceForm(); setShowForm(true); }} className="bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 hover:bg-accent/90"><PlusCircle size={15} />Create Service</button></div>
            {serviceMessage && <p role="status" className="bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 mb-4 text-sm">{serviceMessage}</p>}
            {serviceError && <p role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mb-4 text-sm">{serviceError}</p>}
            {showForm && <div className="bg-card border border-border rounded-2xl p-6 mb-6"><h2 className="font-semibold text-lg mb-5">{editingService ? "Edit Service" : "Create Service"}</h2><form onSubmit={submitService} className="space-y-4"><div className="grid md:grid-cols-2 gap-4"><input value={serviceForm.name} onChange={e => setServiceForm(f => ({ ...f, name: e.target.value }))} placeholder="Service name" required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm" /><select value={serviceForm.category} onChange={e => setServiceForm(f => ({ ...f, category: e.target.value }))} required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm"><option value="">Select category</option>{SERVICE_CATEGORIES.slice(1).map(category => <option key={category}>{category}</option>)}</select><input type="number" min="0.01" step="0.01" value={serviceForm.price} onChange={e => setServiceForm(f => ({ ...f, price: e.target.value }))} placeholder="Price" required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm" /><input value={serviceForm.city} onChange={e => setServiceForm(f => ({ ...f, city: e.target.value }))} placeholder="City" required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm" /><input type="number" min="0" value={serviceForm.experience} onChange={e => setServiceForm(f => ({ ...f, experience: e.target.value }))} placeholder="Years of Experience" required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm md:col-span-2" /></div><textarea value={serviceForm.description} onChange={e => setServiceForm(f => ({ ...f, description: e.target.value }))} rows={4} placeholder="Description" required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm resize-none" /><input type="url" value={serviceForm.imageUrl} onChange={e => setServiceForm(f => ({ ...f, imageUrl: e.target.value }))} placeholder="Image URL (optional)" className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm" /><div className="flex gap-3"><button type="button" onClick={() => setShowForm(false)} className="border border-border px-5 py-2.5 rounded-lg text-sm font-semibold">Cancel</button><button type="submit" className="flex-1 bg-accent text-white font-semibold py-2.5 rounded-lg">{editingService ? "Save Changes" : "Create Service"}</button></div></form></div>}
            {serviceLoading && <p className="py-10 text-center text-sm text-muted-foreground">Loading your services...</p>}
            {!serviceLoading && services.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">You have not created any services yet.</p>}
            <div className="space-y-4">{services.map(service => <div key={service._id} className="bg-card border border-border rounded-xl p-5 flex items-start gap-4"><img src={service.images?.[0] || "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=160&h=100&fit=crop&auto=format"} alt={service.name} className="w-24 h-20 rounded-lg object-cover" /><div className="flex-1"><h3 className="font-semibold">{service.name}</h3><p className="text-xs text-muted-foreground mt-1">{service.category} · ₹{service.price} · {service.city}</p></div><div className="flex gap-2"><button onClick={() => { openServiceForm(service); setShowForm(true); }} className="border border-border p-2 rounded-lg" aria-label="Edit service"><Edit2 size={14} /></button><button onClick={() => removeService(service)} className="border border-red-200 text-red-500 p-2 rounded-lg" aria-label="Delete service"><Trash2 size={14} /></button></div></div>)}</div>
          </>)}

          {section === "packages" && (<>
            <div className="flex items-center justify-between mb-6">
              <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold">My Packages</h1>
              <button onClick={() => openPackageForm()} className="bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 hover:bg-accent/90"><PlusCircle size={15} />Post New Package</button>
            </div>
            {posted && <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-5 flex items-center gap-3"><CheckCircle2 size={18} className="text-green-600" /><p className="text-sm text-green-800 font-semibold">Package posted! It's now live on the platform for customers to book.</p></div>}
            {packageError && <p role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mb-4 text-sm">{packageError}</p>}

            {showForm && (<div className="bg-card border border-border rounded-2xl p-6 mb-6">
              <h2 className="font-semibold text-lg mb-1 flex items-center gap-2"><Package size={18} className="text-accent" />{editingPackage ? "Edit Package" : "New Package"}</h2>
              <p className="text-sm text-muted-foreground mb-5">Set a fixed price, define what's included, and add any helpers you'll bring. Customers see the full team before booking.</p>
              <form onSubmit={submitPackage} className="space-y-5">
                <div className="grid md:grid-cols-2 gap-4">
                  <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Package Title</label><input value={pkgForm.title} onChange={e => setPkgForm(f => ({ ...f, title: e.target.value }))} placeholder="Enter package title" required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent placeholder:text-muted-foreground" /></div>
                  <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Category</label><select value={pkgForm.category} onChange={e => setPkgForm(f => ({ ...f, category: e.target.value }))} required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent"><option value="">Select</option>{["Plumbing", "Electrical", "Painting", "Carpentry"].map(c => <option key={c}>{c}</option>)}</select></div>
                  <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Fixed Price</label><input value={pkgForm.price} onChange={e => setPkgForm(f => ({ ...f, price: e.target.value }))} placeholder="Enter price in ₹" required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent placeholder:text-muted-foreground" /></div>
                  <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Duration</label><input value={pkgForm.duration} onChange={e => setPkgForm(f => ({ ...f, duration: e.target.value }))} placeholder="Enter duration" required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent placeholder:text-muted-foreground" /></div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Package Image</label>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input type="file" accept="image/*" onChange={e => {
                      const file = e.target.files[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => setPkgForm(f => ({ ...f, imageUrl: reader.result }));
                        reader.readAsDataURL(file);
                      }
                    }} className="w-full bg-input-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent" />
                    <input type="url" value={pkgForm.imageUrl} onChange={e => setPkgForm(f => ({ ...f, imageUrl: e.target.value }))} placeholder="Or Image URL" className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent" />
                  </div>
                  {pkgForm.imageUrl && <div className="mt-3 w-32 h-20 rounded-lg border border-border overflow-hidden bg-muted"><img src={pkgForm.imageUrl} alt="Preview" className="w-full h-full object-cover" /></div>}
                </div>
                <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Description</label><textarea value={pkgForm.description} onChange={e => setPkgForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Describe what this package covers…" required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent resize-none placeholder:text-muted-foreground" /></div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">What's Included</label>
                  <div className="space-y-2">
                    {includes.map((v, i) => (<div key={i} className="flex items-center gap-2">
                      <input value={v} onChange={e => setIncludes(prev => prev.map((p, idx) => idx === i ? e.target.value : p))} placeholder={`Deliverable ${i + 1}`} className="flex-1 bg-input-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent placeholder:text-muted-foreground" />
                      {includes.length > 2 && <button type="button" onClick={() => setIncludes(prev => prev.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-red-500"><X size={14} /></button>}
                    </div>))}
                  </div>
                  <button type="button" onClick={() => setIncludes(prev => [...prev, ""])} className="mt-2 text-xs text-accent font-semibold flex items-center gap-1 hover:underline"><PlusCircle size={12} />Add item</button>
                </div>

                {/* Helpers */}
                <div>
                  <div className="flex items-start justify-between mb-2">
                    <div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">Team / Helpers You'll Bring</label><p className="text-xs text-muted-foreground mt-0.5">Customers see the full team before booking. Add as many helpers as needed.</p></div>
                    <button type="button" onClick={addHelper} className="flex items-center gap-1.5 text-xs font-semibold text-accent border border-accent/30 px-3 py-1.5 rounded-lg hover:bg-accent hover:text-white transition-colors"><UserPlus size={13} />Add Helper</button>
                  </div>
                  <div className="space-y-3">
                    {helpers.map((h, i) => (<div key={i} className="bg-muted rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3"><UserPlus size={13} className="text-accent" /><span className="text-xs font-semibold">Helper {i + 1}</span>{helpers.length > 1 && <button type="button" onClick={() => removeHelper(i)} className="ml-auto text-muted-foreground hover:text-red-500"><X size={13} /></button>}</div>
                      <div className="grid grid-cols-3 gap-3">
                        <div><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Name</label><input value={h.name} onChange={e => updateHelper(i, "name", e.target.value)} placeholder="Enter helper name" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs outline-none focus:border-accent placeholder:text-muted-foreground" /></div>
                        <div><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Role</label><input value={h.role} onChange={e => updateHelper(i, "role", e.target.value)} placeholder="Enter helper role" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs outline-none focus:border-accent placeholder:text-muted-foreground" /></div>
                        <div><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">Phone (optional)</label><input value={h.phone} onChange={e => updateHelper(i, "phone", e.target.value)} placeholder="Enter phone number" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs outline-none focus:border-accent placeholder:text-muted-foreground" /></div>
                      </div>
                    </div>))}
                  </div>
                  {helpers.some(h => h.name) && (<div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
                    <Users size={13} className="text-blue-600" />
                    <p className="text-xs text-blue-700"><strong>Total team: {helpers.filter(h => h.name).length + 1} people</strong> — you + {helpers.filter(h => h.name).length} helper{helpers.filter(h => h.name).length !== 1 ? "s" : ""}. Displayed to customers on your package.</p>
                  </div>)}
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2"><Banknote size={14} className="text-green-600" /><p className="text-xs text-green-700 font-semibold">This package will be post-paid. Customers pay you directly after completion.</p></div>

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowForm(false)} className="border border-border px-5 py-3 rounded-lg text-sm font-semibold hover:bg-muted">Cancel</button>
                  <button type="submit" disabled={submitting} className="flex-1 bg-accent text-white font-semibold py-3 rounded-lg hover:bg-accent/90 disabled:opacity-60 flex items-center justify-center gap-2">
                    {submitting ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{editingPackage ? "Saving…" : "Publishing…"}</> : (editingPackage ? "Save Changes" : "Publish Package")}
                  </button>
                </div>
              </form>
            </div>)}

            <div className="grid md:grid-cols-2 gap-5">
              {packages.map(pkg => (<div key={pkg._id} className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg hover:border-accent/30 transition-all group flex flex-col">
                <div className="h-32 bg-muted relative overflow-hidden shrink-0">
                  <img src={pkg.images?.[0] || "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=500&h=300&fit=crop"} alt={pkg.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  <span className="absolute top-3 left-3 bg-accent text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase">{pkg.category}</span>
                  <Badge color="green" className="absolute top-3 right-3 shadow-md">Live</Badge>
                </div>
                <div className="p-4 flex flex-col flex-1">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="font-semibold text-sm line-clamp-1">{pkg.title}</h3>
                    <p className="font-bold text-accent shrink-0">₹{pkg.price}</p>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-3 h-8">{pkg.description}</p>
                  
                  <div className="grid grid-cols-2 gap-2 mb-4 pt-3 border-t border-border">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock size={12} className="text-accent" />
                      <span className="truncate">{pkg.duration}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users size={12} className="text-accent" />
                      <span>{pkg.helpers?.length || 0} Helper{pkg.helpers?.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-auto gap-2">
                    <div className="flex -space-x-1.5 shrink-0">
                      {(pkg.helpers || []).slice(0, 3).map((h, i) => <img key={i} src={h.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(h.name || 'H')}&background=random`} alt={h.name} className="w-6 h-6 rounded-full border-2 border-white object-cover" />)}
                      {pkg.helpers?.length === 0 && <span className="text-[10px] text-muted-foreground italic">No helpers</span>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => openPackageForm(pkg)} className="bg-muted text-foreground hover:bg-accent hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors" aria-label="Edit package"><Edit2 size={12} /> Edit</button>
                      <button onClick={() => { if(window.confirm(`Delete ${pkg.title}?`)) packageApi.delete(pkg._id).then(loadPackages).catch(error => setPackageError(error.message)); }} className="bg-red-50 text-red-600 hover:bg-red-600 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" aria-label="Delete package"><Trash2 size={12} /></button>
                    </div>
                  </div>
                </div>
              </div>))}
            </div>
          </>)}

          {section === "bookings" && (<>
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-6">Booking Requests</h1>
            <div className="space-y-4">
              {bookingLoading && (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="bg-card border border-border rounded-xl p-5 animate-pulse">
                      <div className="flex gap-2 mb-3">
                        <Skeleton className="h-5 w-16" />
                        <Skeleton className="h-5 w-16" />
                      </div>
                      <Skeleton className="h-6 w-1/3 mb-2" />
                      <Skeleton className="h-4 w-1/2 mb-3" />
                      <Skeleton className="h-4 w-full mb-2" />
                      <Skeleton className="h-48 w-full max-w-sm rounded-lg mb-2 mt-4" />
                    </div>
                  ))}
                </div>
              )}
              {bookingError && <p role="alert" className="py-4 text-sm text-red-600">{bookingError}</p>}
              {!bookingLoading && !bookingError && bookings.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No booking requests yet</p>}
              {!bookingLoading && bookings.map(b => (<div key={b.id} className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge color={b.color}>{b.status}</Badge>
                      <Badge color={b.type === "Package" ? "orange" : "blue"}>{b.type}</Badge>
                    </div>
                    <h3 className="font-semibold">{b.svc}</h3>
                    <p className="text-sm text-muted-foreground">{b.customer} &middot; {b.endDate ? `${b.date} → ${b.endDate}` : b.date} &middot; {b.time}</p>
                    <p className="text-xs text-muted-foreground mt-1 mb-2">Address: {b.address}</p>
                    <div className="mb-2 w-full max-w-sm">
                      <MapRouteViewer destinationAddress={b.address} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Price: {b.price}</p>
                    {b.requirements ? <p className="text-xs text-muted-foreground mt-1">Requirements: {b.requirements}</p> : null}
                    {b.type === "General" ? <p className="text-xs text-muted-foreground mt-1">Customer may have requested extra helpers.</p> : null}
                    {b.materials && b.materials.length > 0 ? (
                      <div className="mt-2 bg-muted p-2 rounded text-xs border border-border">
                        <p className="font-semibold mb-1 text-foreground">Materials Used:</p>
                        {b.materials.map((m, i) => <div key={i} className="flex justify-between text-muted-foreground"><span>{m.name}</span><span>₹{m.cost}</span></div>)}
                      </div>
                    ) : null}
                    <WorkTimeline timeline={b.timeline} className="mt-3" />
                    {b.status === "IN_PROGRESS" ? (
                      <div className="mt-3 bg-muted/50 border border-border p-3 rounded-lg">
                        <p className="text-xs font-semibold mb-2">Add Material / Expense</p>
                        <form onSubmit={(e) => handleAddMaterial(e, b.bookingId)} className="flex gap-2">
                          <input placeholder="Material Name" value={materialFormFor === b.bookingId ? newMaterialName : ""} onFocus={() => setMaterialFormFor(b.bookingId)} onChange={e => setNewMaterialName(e.target.value)} className="flex-1 text-xs px-2 py-1.5 rounded border border-border bg-input-background outline-none focus:border-accent" required />
                          <input type="number" min="1" placeholder="₹ Cost" value={materialFormFor === b.bookingId ? newMaterialCost : ""} onFocus={() => setMaterialFormFor(b.bookingId)} onChange={e => setNewMaterialCost(e.target.value)} className="w-20 text-xs px-2 py-1.5 rounded border border-border bg-input-background outline-none focus:border-accent" required />
                          <button type="submit" disabled={bookingAction === b.bookingId} className="bg-accent text-white text-xs px-3 py-1.5 rounded font-semibold disabled:opacity-50">Add</button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right shrink-0">
                    {b.status === "PENDING" && <div className="flex gap-2 mb-2"><button disabled={bookingAction === b.bookingId} onClick={() => updateBookingStatus(b.bookingId, "ACCEPTED")} className="bg-green-600 text-white text-xs font-semibold px-2.5 py-1.5 rounded flex items-center gap-1 disabled:opacity-50"><Check size={12} />Accept</button><button disabled={bookingAction === b.bookingId} onClick={() => updateBookingStatus(b.bookingId, "REJECTED")} className="bg-red-100 text-red-700 text-xs font-semibold px-2.5 py-1.5 rounded disabled:opacity-50"><X size={12} /></button></div>}
                    {b.status === "ACCEPTED" && <div className="flex gap-2 mb-2"><button disabled={bookingAction === b.bookingId} onClick={() => updateBookingStatus(b.bookingId, "IN_PROGRESS")} className="text-xs border border-border px-3 py-1.5 rounded-lg hover:bg-muted disabled:opacity-50">Start Work</button><button disabled={bookingAction === b.bookingId} onClick={() => cancelProviderBooking(b.bookingId)} className="text-xs text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 disabled:opacity-50">Cancel</button></div>}
                    {b.status === "IN_PROGRESS" && <div className="mb-2"><button disabled={bookingAction === b.bookingId} onClick={() => updateBookingStatus(b.bookingId, "COMPLETED")} className="text-xs border border-border px-3 py-1.5 rounded-lg hover:bg-muted disabled:opacity-50">Mark Complete</button></div>}
                    {b.status === "COMPLETED" && b.paymentStatus === "UNPAID" && <span className="text-xs font-semibold text-orange-600 mb-2 block">Awaiting payment</span>}
                    {b.paymentStatus === "PAID" && <span className="text-xs font-semibold text-green-700 mb-2 block">Paid ✓</span>}
                    
                    {["ACCEPTED", "IN_PROGRESS", "COMPLETED"].includes(b.status) && (
                      <button onClick={() => handleWhatsAppUpdate(b)} className="bg-green-500 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg flex items-center justify-end gap-1.5 hover:bg-green-600 transition-colors shadow-sm ml-auto mt-2 w-full text-center">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                        Send Update
                      </button>
                    )}
                    {b.status === "COMPLETED" && <div className="mt-2 flex justify-end"><BillButton bookingId={b.bookingId} invoiceNumber={b.invoiceNumber} label="Download Bill" /></div>}
                  </div>
                </div>
              </div>))}
            </div>
          </>)}
          {section === "messages" && (<>
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-6">Messages</h1>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="p-3 border-b border-border"><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Booking Chats</p></div>
                <div className="divide-y divide-border max-h-96 overflow-y-auto">
                  {bookings.length === 0 && <p className="p-4 text-sm text-muted-foreground text-center">No bookings yet</p>}
                  {bookings.map(b => (<button key={b.bookingId} onClick={() => openChat(b.bookingId)} className={`w-full text-left p-3 hover:bg-muted/50 transition-colors ${chatBookingId === b.bookingId ? "bg-accent/10 border-l-2 border-accent" : ""}`}><p className="text-sm font-medium truncate">{b.svc}</p><p className="text-xs text-muted-foreground">{b.customer} · {b.date}</p><Badge color={b.color}>{b.status}</Badge></button>))}
                </div>
              </div>
              <div className="md:col-span-2 bg-card border border-border rounded-xl flex flex-col" style={{ minHeight: 400 }}>
                {!chatBookingId ? (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm"><MessageSquare size={20} className="mr-2 opacity-50" />Select a booking to start chatting</div>
                ) : (<>
                  <div className="p-3 border-b border-border flex items-center gap-2"><MessageSquare size={16} className="text-accent" /><p className="text-sm font-semibold">{bookings.find(b => b.bookingId === chatBookingId)?.svc || "Chat"}</p></div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {chatMessages.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">No messages yet. Say hello!</p>}
                    {chatMessages.map((msg, idx) => (
                      <div key={idx} className={`flex ${msg.senderId === (user?._id || user?.id) ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[70%] px-3 py-2 rounded-xl text-sm ${msg.senderId === (user?._id || user?.id) ? "bg-accent text-white rounded-br-sm" : "bg-muted rounded-bl-sm"}`}>
                          <p>{msg.text}</p>
                          <p className={`text-[10px] mt-1 ${msg.senderId === (user?._id || user?.id) ? "text-white/60" : "text-muted-foreground"}`}>{new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                        </div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="p-3 border-t border-border flex gap-2">
                    <input value={newChatMsg} onChange={e => setNewChatMsg(e.target.value)} onKeyDown={e => e.key === "Enter" && sendChat()} placeholder="Type a message..." className="flex-1 bg-input-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent" />
                    <button onClick={sendChat} className="bg-accent text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-accent/90">Send</button>
                  </div>
                </>)}
              </div>
            </div>
          </>)}

          {section === "profile" && (<>
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-6">Provider Profile</h1>
            <div className="bg-card border border-border rounded-xl p-4 max-w-lg mb-4"><div className="flex items-center gap-3"><div className="w-12 h-12 rounded-full bg-accent/10 overflow-hidden flex items-center justify-center text-accent font-bold">{providerProfile.profileImage ? <img src={providerProfile.profileImage} alt={providerProfile.name || "Profile"} className="w-full h-full object-cover" /> : (providerProfile.name || "P")[0]}</div><div className="flex-1"><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Profile picture</label><input type="file" accept="image/*" onChange={e => handleImageUpload(e, setProviderProfile)} className="w-full bg-input-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent mb-2" /><input type="url" value={providerProfile.profileImage || ""} onChange={e => setProviderProfile(f => ({ ...f, profileImage: e.target.value }))} placeholder="Or paste an image URL" className="w-full bg-input-background border border-border rounded-lg px-3 py-2 text-sm" /></div></div></div>
            <div className="bg-card border border-border rounded-xl p-6 max-w-lg">
              <form onSubmit={saveProviderProfile} className="space-y-4"><div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Full Name</label><input value={providerProfile.name} onChange={e => setProviderProfile(f => ({ ...f, name: e.target.value }))} required className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm" /></div><div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Phone</label><input value={providerProfile.phone} onChange={e => setProviderProfile(f => ({ ...f, phone: e.target.value }))} className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm" /></div><div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Address Line 1</label><input value={providerProfile.addressLine1} onChange={e => setProviderProfile(f => ({ ...f, addressLine1: e.target.value }))} className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm" /></div><div className="grid grid-cols-2 gap-4"><div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Pincode</label><input value={providerProfile.pincode} onChange={e => handlePincodeChange(e, setProviderProfile)} maxLength={6} className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm" /></div><div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">State</label><input value={providerProfile.state} onChange={e => setProviderProfile(f => ({ ...f, state: e.target.value }))} className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm" /></div></div><div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">City / District</label><input value={providerProfile.city} onChange={e => setProviderProfile(f => ({ ...f, city: e.target.value }))} className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm" /></div><div><label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Primary Trade</label><select value={providerProfile.trade} onChange={e => setProviderProfile(f => ({ ...f, trade: e.target.value }))} className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm"><option>Plumbing</option><option>Electrical</option><option>Painting</option><option>Carpentry</option></select></div><button type="submit" className="bg-accent text-white font-semibold px-5 py-2.5 rounded-lg text-sm">Save Profile</button></form>
              <form onSubmit={changeProviderPassword} className="mt-6 pt-6 border-t border-border space-y-3"><h2 className="font-semibold">Change Password</h2><input name="currentPassword" type="password" required placeholder="Current password" className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm" /><input name="newPassword" type="password" minLength="8" required placeholder="New password" className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm" /><button type="submit" className="border border-border font-semibold px-5 py-2.5 rounded-lg text-sm">Change Password</button></form>{profileMessage && <p role="status" className="text-sm text-muted-foreground mt-4">{profileMessage}</p>}
            </div>
          </>)}

          {section === "earnings" && (() => {
            const completedJobs = bookings.filter(b => b.status === "COMPLETED" && b.paymentStatus === "PAID");
            const now = new Date();
            const currentMonth = now.getMonth();
            const currentYear = now.getFullYear();
            
            let thisMonthEarnings = 0;
            let lastMonthEarnings = 0;
            let allTimeEarnings = 0;
            
            completedJobs.forEach(b => {
              allTimeEarnings += b.rawPrice;
              const d = b.rawDate;
              if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
                thisMonthEarnings += b.rawPrice;
              } else if (
                (d.getFullYear() === currentYear && d.getMonth() === currentMonth - 1) ||
                (currentMonth === 0 && d.getFullYear() === currentYear - 1 && d.getMonth() === 11)
              ) {
                lastMonthEarnings += b.rawPrice;
              }
            });

            return (
              <>
                <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-6">Earnings</h1>
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 flex items-center gap-3"><Banknote size={18} className="text-green-600" /><p className="text-sm text-green-800">All payments are received directly from customers after job completion. No platform deductions.</p></div>
                <div className="grid grid-cols-3 gap-4 mb-6">{[{ label: "This Month", val: `₹${thisMonthEarnings}` }, { label: "Last Month", val: `₹${lastMonthEarnings}` }, { label: "All Time", val: `₹${allTimeEarnings}` }].map(({ label, val }) => <div key={label} className="bg-card border border-border rounded-xl p-4"><p className="text-xs text-muted-foreground mb-1">{label}</p><p style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold text-accent">{val}</p></div>)}</div>
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex justify-between items-center"><h3 className="font-semibold text-sm">Completed Jobs</h3><button className="text-xs text-accent flex items-center gap-1"><Download size={13} />Export</button></div>
                  <table className="w-full text-sm"><thead className="bg-muted"><tr>{["Job", "Type", "Date", "Amount"].map(h => <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>)}</tr></thead><tbody className="divide-y divide-border">
                    {completedJobs.map(r => <tr key={r.bookingId} className="hover:bg-muted/50"><td className="px-4 py-3 font-medium">{r.svc}</td><td className="px-4 py-3"><Badge color={r.type === "Package" ? "orange" : "blue"}>{r.type}</Badge></td><td className="px-4 py-3 text-muted-foreground">{r.date}</td><td className="px-4 py-3 font-bold text-green-700">{r.price}</td></tr>)}
                    {completedJobs.length === 0 && <tr><td colSpan="4" className="px-4 py-8 text-center text-muted-foreground">No completed and paid jobs yet.</td></tr>}
                  </tbody></table>
                </div>
              </>
            );
          })()}
          {section === "settings" && <GeneralSettingsPanel />}
        </div>
      </main>
    </div>
  </div>);
}
// ─── SETTINGS PANEL ─────────────────────────────────────────────────────────────
function GeneralSettingsPanel() {
  const { colorTheme, changeColorTheme } = useTheme();

  return (
    <>
      <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-6">Settings</h1>
      
      <div className="bg-card border border-border rounded-xl p-6 max-w-2xl mb-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path></svg>
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold mb-2">Appearance</h2>
            <p className="text-sm text-muted-foreground mb-4">Customize the look and feel of your dashboard.</p>
            
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="font-medium text-sm">Light / Dark Mode</p>
                <p className="text-xs text-muted-foreground">Toggle between light and dark backgrounds</p>
              </div>
              <ThemeToggle />
            </div>

            <div>
              <p className="font-medium text-sm mb-2">Accent Color Theme</p>
              <p className="text-xs text-muted-foreground mb-3">Choose your primary brand color</p>
              <div className="flex gap-3">
                {[
                  { id: "theme-orange", color: "#e8751a", label: "Orange" },
                  { id: "theme-blue", color: "#2563eb", label: "Blue" },
                  { id: "theme-green", color: "#16a34a", label: "Green" },
                  { id: "theme-purple", color: "#9333ea", label: "Purple" }
                ].map(t => (
                  <button 
                    key={t.id} 
                    onClick={() => changeColorTheme(t.id)}
                    className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${colorTheme === t.id ? 'border-foreground scale-110 shadow-md' : 'border-transparent hover:scale-105'}`}
                    style={{ backgroundColor: t.color }}
                    title={t.label}
                  >
                    {colorTheme === t.id && <Check size={18} color="white" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 max-w-2xl mb-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-2">Language Preferences</h2>
            <p className="text-sm text-muted-foreground mb-4">Choose your preferred language. The entire application will be instantly translated to help you navigate and interact seamlessly.</p>
            <LanguageSelector />
          </div>
        </div>
      </div>
    </>
  );
}

// ─── ADMIN DASHBOARD ──────────────────────────────────────────────────────────
function AdminDashboard() {
  const { go, setLoggedIn } = useApp();
  const [section, setSection] = useState("overview");
  const [services, setServices] = useState([]);
  const [serviceMessage, setServiceMessage] = useState("");
  const [bookings, setBookings] = useState([]);
  const [bookingLoading, setBookingLoading] = useState(true);
  const [bookingError, setBookingError] = useState("");
  const [adminStats, setAdminStats] = useState(null);
  useEffect(() => { serviceApi.list().then(setServices).catch(() => { }); }, []);
  useEffect(() => { bookingApi.all().then(setBookings).catch(error => setBookingError(error.message)).finally(() => setBookingLoading(false)); }, []);
  useEffect(() => { adminApi.dashboard().then(setAdminStats).catch(() => { }); }, []);
  const removeAdminService = async (service) => { if (!window.confirm(`Delete ${service.name}?`)) return; try { await serviceApi.delete(service._id); setServices(items => items.filter(item => item._id !== service._id)); setServiceMessage("Service deleted"); } catch (error) { setServiceMessage(error.message); } };
  const [adminPackages, setAdminPackages] = useState([]);
  const [adminPackageLoading, setAdminPackageLoading] = useState(true);
  const [adminPackageError, setAdminPackageError] = useState("");
  useEffect(() => { packageApi.list().then(setAdminPackages).catch(e => setAdminPackageError(e.message)).finally(() => setAdminPackageLoading(false)); }, []);
  const removeAdminPackage = async (pkg) => { if (!window.confirm(`Delete "${pkg.title}"?`)) return; try { await packageApi.delete(pkg._id); setAdminPackages(items => items.filter(item => item._id !== pkg._id)); } catch (error) { setAdminPackageError(error.message); } };
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(true);
  useEffect(() => { adminApi.users().then(setAdminUsers).catch(() => { }).finally(() => setAdminUsersLoading(false)); }, []);
  const adminProviders = adminUsers.filter(u => u.role === "provider");
  const adminProvidersLoading = adminUsersLoading;
  const removeAdminUser = async (user) => { if (!window.confirm(`Delete user ${user.name}?`)) return; try { await adminApi.removeUser(user._id); setAdminUsers(items => items.filter(item => item._id !== user._id)); } catch (error) { alert(error.message); } };
  const sidebar = [{ id: "overview", icon: LayoutDashboard, label: "Overview" }, { id: "users", icon: Users, label: "All Users" }, { id: "services", icon: Briefcase, label: "All Services" }, { id: "packages", icon: Package, label: "All Packages" }, { id: "providers", icon: Briefcase, label: "Providers" }, { id: "bookings", icon: Calendar, label: "Bookings" }, { id: "reports", icon: BarChart2, label: "Reports" }, { id: "settings", icon: Settings, label: "Settings" }];
  const PENDING_PROVIDERS = [];
  const getChartData = () => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        name: d.toLocaleString('default', { month: 'short' }),
        month: d.getMonth(),
        year: d.getFullYear(),
        bookings: 0,
        revenue: 0
      });
    }

    bookings.forEach(b => {
      const bDate = new Date(b.createdAt);
      const mInfo = months.find(m => m.month === bDate.getMonth() && m.year === bDate.getFullYear());
      if (mInfo) {
        mInfo.bookings += 1;
        if (b.status === "COMPLETED" || b.paymentStatus === "PAID") {
          mInfo.revenue += b.price || 0;
        }
      }
    });
    return months;
  };
  const chartData = getChartData();
  return (<div className="min-h-screen flex flex-col bg-background">
    <header className="bg-primary text-primary-foreground h-14 flex items-center justify-between px-4 sm:px-6 sticky top-0 z-50">
      <button onClick={() => go("home")} className="flex items-center gap-2"><Building2 size={20} className="text-accent" /><span style={{ fontFamily: "'Roboto Slab',serif" }} className="font-bold">Build<span className="text-accent">Connect</span></span><span className="ml-2 text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded font-semibold">Admin</span></button>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center text-xs font-bold">A</div>
        <button onClick={() => { setLoggedIn(false); go("home"); }} className="text-white/60 hover:text-white"><LogOut size={16} /></button>
      </div>
    </header>
    <DashboardMobileNav items={sidebar} active={section} onChange={setSection} />
    <div className="flex flex-1">
      <aside className="w-56 bg-card border-r border-border shrink-0 hidden md:block">
        <div className="p-4 border-b border-border"><div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-sm font-bold text-red-600 mb-1">A</div><p className="text-sm font-semibold">Admin Panel</p></div>
        <nav className="p-3">{sidebar.map(({ id, icon: Icon, label }) => <button key={id} onClick={() => setSection(id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium mb-1 transition-colors ${section === id ? "bg-accent text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Icon size={16} />{label}</button>)}</nav>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-4 sm:p-6">
          {section === "overview" && (<>
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-6">Platform Overview</h1>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[{ label: "Total Users", value: adminStats?.users ?? "—", icon: Users, color: "text-blue-600 bg-blue-50", trend: "Live" }, { label: "Active Providers", value: adminStats?.providers ?? "—", icon: Briefcase, color: "text-accent bg-orange-50", trend: "Live" }, { label: "Total Services", value: adminStats?.services ?? "—", icon: Package, color: "text-purple-600 bg-purple-50", trend: "Live" }, { label: "Total Bookings", value: adminStats?.bookings ?? "—", icon: Calendar, color: "text-green-600 bg-green-50", trend: "Live" }].map(({ label, value, icon: Icon, color, trend }) => (<div key={label} className="bg-card border border-border rounded-xl p-4"><div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${color}`}><Icon size={18} /></div><p style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold">{value}</p><div className="flex items-center gap-2"><p className="text-xs text-muted-foreground">{label}</p><span className="text-[10px] bg-green-100 text-green-700 font-bold px-1.5 py-0.5 rounded">{trend}</span></div></div>))}
            </div>
            <div className="grid md:grid-cols-2 gap-6 mb-6">
              <div className="bg-card border border-border rounded-xl p-6">
                <h2 className="text-lg font-semibold mb-4">Platform Bookings (Last 6 Months)</h2>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} />
                      <YAxis axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: '#f3f4f6' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Bar dataKey="bookings" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-6">
                <h2 className="text-lg font-semibold mb-4">Revenue Growth (Estimated)</h2>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} />
                      <YAxis axisLine={false} tickLine={false} tickFormatter={val => `₹${val/1000}k`} />
                      <Tooltip cursor={{ fill: '#f3f4f6' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Bar dataKey="revenue" fill="#10B981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
              <h3 className="font-semibold text-amber-800 mb-3 flex items-center gap-2"><AlertCircle size={16} />Pending Provider Approvals ({adminProviders.filter(p => !p.isApproved).length})</h3>
              {adminProviders.filter(p => !p.isApproved).length === 0 ? (
                <div className="p-3 text-sm text-amber-700">No pending provider approvals.</div>
              ) : (
                <div className="space-y-3">
                  {adminProviders.filter(p => !p.isApproved).map(p => (
                    <div key={p._id} className="bg-white/50 rounded-lg p-4 flex items-center justify-between border border-amber-200/50">
                      <div>
                        <p className="font-semibold text-sm">{p.name} <span className="text-xs text-muted-foreground font-normal">({p.email})</span></p>
                        <p className="text-xs text-muted-foreground mt-1">Trade: {p.trade || "—"} · City: {p.city || "—"}</p>
                        {(p.storeName || p.addressLine1) && (
                          <p className="text-xs text-muted-foreground mt-0.5">Store: {p.storeName || "—"} · Addr: {[p.addressLine1, p.addressLine2, p.state, p.pincode].filter(Boolean).join(", ")}</p>
                        )}
                      </div>
                      <button onClick={async () => {
                        try {
                          await adminApi.approveProvider(p._id);
                          setAdminUsers(prev => prev.map(u => u._id === p._id ? { ...u, isApproved: true } : u));
                        } catch (err) { alert(err.message); }
                      }} className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
                        Approve Provider
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>)}
          {section === "users" && (<>
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-6">All Users</h1>
            <div className="bg-card border border-border rounded-xl overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted"><tr>{["User", "Role", "City", "Email", "Phone", "Status", ""].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">
                  {adminUsers.map(u => <tr key={u._id} className="hover:bg-muted/50"><td className="px-4 py-3"><div className="flex items-center gap-2">{u.profileImage ? <img src={u.profileImage} alt={u.name} className="w-7 h-7 rounded-full object-cover" /> : <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent">{(u.name || "U")[0]}</div>}<div><span className="font-medium block">{u.name}</span></div></div></td><td className="px-4 py-3"><Badge color={u.role === "admin" ? "red" : u.role === "provider" ? "blue" : "gray"}>{u.role}</Badge></td><td className="px-4 py-3 text-muted-foreground">{u.city || "—"}</td><td className="px-4 py-3 text-muted-foreground">{u.email}</td><td className="px-4 py-3 text-muted-foreground">{u.phone || "—"}</td><td className="px-4 py-3"><Badge color="green">Active</Badge></td><td className="px-4 py-3"><button onClick={() => removeAdminUser(u)} className="text-xs text-red-500 hover:underline">Remove</button></td></tr>)}
                </tbody>
              </table>
              {adminUsersLoading && <p className="p-8 text-center text-sm text-muted-foreground">Loading users...</p>}
            </div>
          </>)}
          {section === "services" && (<>
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-6">All Services</h1>
            {serviceMessage && <p role="status" className="text-sm text-muted-foreground mb-4">{serviceMessage}</p>}
            <div className="bg-card border border-border rounded-xl overflow-auto"><table className="w-full text-sm"><thead className="bg-muted"><tr>{["Service", "Category", "Provider", "City", "Price", "Availability", ""].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">{h}</th>)}</tr></thead><tbody className="divide-y divide-border">{services.map(service => <tr key={service._id}><td className="px-4 py-3 font-medium">{service.name}</td><td className="px-4 py-3"><Badge color="orange">{service.category}</Badge></td><td className="px-4 py-3">{service.provider?.name || "Provider"}</td><td className="px-4 py-3 text-muted-foreground">{service.city}</td><td className="px-4 py-3 font-semibold">₹{service.price}</td><td className="px-4 py-3"><Badge color={service.availability ? "green" : "gray"}>{service.availability ? "Available" : "Busy"}</Badge></td><td className="px-4 py-3"><button onClick={() => removeAdminService(service)} className="text-xs text-red-500 hover:underline">Delete</button></td></tr>)}</tbody></table>{services.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No services found.</p>}</div>
          </>)}
          {section === "packages" && (<>
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-6">All Platform Packages</h1>
            {adminPackageError && <p role="alert" className="text-sm text-red-600 mb-4">{adminPackageError}</p>}
            <div className="bg-card border border-border rounded-xl overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted"><tr>{["Package", "Category", "Provider", "Team", "Price", "Status", ""].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">
                  {adminPackages.map(pkg => <tr key={pkg._id} className="hover:bg-muted/50"><td className="px-4 py-3"><p className="font-medium text-sm">{pkg.title}</p></td><td className="px-4 py-3"><Badge color="orange">{pkg.category}</Badge></td><td className="px-4 py-3 text-muted-foreground">{pkg.provider?.name || "Provider"}</td><td className="px-4 py-3"><span className="text-xs text-muted-foreground">{(pkg.helpers?.length || 0) + 1} people</span></td><td className="px-4 py-3 font-semibold">₹{pkg.price}</td><td className="px-4 py-3"><Badge color="green">Live</Badge></td><td className="px-4 py-3"><button onClick={() => removeAdminPackage(pkg)} className="text-xs text-red-500 hover:underline">Remove</button></td></tr>)}
                </tbody>
              </table>
              {adminPackageLoading && <p className="p-8 text-center text-sm text-muted-foreground">Loading packages...</p>}
              {!adminPackageLoading && adminPackages.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No packages found.</p>}
            </div>
          </>)}
          {section === "providers" && (<>
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-6">Providers</h1>
            <div className="bg-card border border-border rounded-xl overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted"><tr>{["Provider", "Trade", "City", "Rating", "Availability", "Status", ""].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">
                  {adminProviders.map(p => <tr key={p._id} className="hover:bg-muted/50"><td className="px-4 py-3"><div className="flex items-center gap-2">{p.profileImage ? <img src={p.profileImage} alt={p.name} className="w-7 h-7 rounded-full object-cover" /> : <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent">{(p.name || "P")[0]}</div>}<div><span className="font-medium block">{p.name}</span><span className="text-xs text-muted-foreground">{p.email}</span></div></div></td><td className="px-4 py-3 text-muted-foreground">{p.trade || "—"}</td><td className="px-4 py-3 text-muted-foreground">{p.city || "—"}</td><td className="px-4 py-3"><div className="flex items-center gap-1"><StarRow rating={p.rating || 0} /><span className="text-xs">{p.rating || 0}</span></div></td><td className="px-4 py-3"><Badge color={p.availability ? "green" : "gray"}>{p.availability ? "Available" : "Busy"}</Badge></td><td className="px-4 py-3"><Badge color={p.isApproved ? "green" : "orange"}>{p.isApproved ? "Approved" : "Pending"}</Badge></td><td className="px-4 py-3"><button onClick={() => removeAdminUser(p)} className="text-xs text-red-500 hover:underline">Remove</button></td></tr>)}
                </tbody>
              </table>
              {adminProvidersLoading && <p className="p-8 text-center text-sm text-muted-foreground">Loading providers...</p>}
              {!adminProvidersLoading && adminProviders.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No providers registered yet.</p>}
            </div>
          </>)}
          {section === "bookings" && (<>
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-6">All Bookings</h1>
            <div className="bg-card border border-border rounded-xl overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted"><tr>{["ID", "Service", "Type", "Customer", "Provider", "Date", "Status"].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">{bookings.map(b => <tr key={b._id} className="hover:bg-muted/50"><td className="px-4 py-3"><span style={{ fontFamily: "'DM Mono',monospace" }} className="text-xs text-muted-foreground">{b._id}</span></td><td className="px-4 py-3 font-medium">{b.service?.name || "Service booking"}</td><td className="px-4 py-3"><Badge color="blue">Service</Badge></td><td className="px-4 py-3 text-muted-foreground">{b.customer?.name || "Customer"}</td><td className="px-4 py-3 text-muted-foreground">{b.provider?.name || "Provider"}</td><td className="px-4 py-3 text-muted-foreground">{new Date(b.date).toLocaleDateString()}{b.endDate ? ` → ${new Date(b.endDate).toLocaleDateString()}` : ""} · {b.time}</td><td className="px-4 py-3"><Badge color={b.status === "COMPLETED" ? "blue" : b.status === "REJECTED" || b.status === "CANCELLED" ? "red" : "orange"}>{b.status}</Badge></td></tr>)} </tbody>
              </table>
              {bookingLoading && <p className="p-8 text-center text-sm text-muted-foreground">Loading bookings...</p>}
              {bookingError && <p role="alert" className="p-8 text-center text-sm text-red-600">{bookingError}</p>}
              {!bookingLoading && !bookingError && bookings.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No bookings yet</p>}
            </div>
          </>)}
          {section === "reports" && (<>
            <h1 style={{ fontFamily: "'Roboto Slab',serif" }} className="text-2xl font-bold mb-6">Reports</h1>
            <div className="grid md:grid-cols-2 gap-6 mb-6">
              {[{ label: "Total Bookings", value: adminStats?.bookings ?? "—", sub: "All time", color: "text-accent" }, { label: "Completed Jobs", value: adminStats?.completed ?? "—", sub: "Successfully finished", color: "text-purple-600" }, { label: "Pending Requests", value: adminStats?.pending ?? "—", sub: "Awaiting action", color: "text-blue-600" }, { label: "Total Reviews", value: adminStats?.reviews ?? "—", sub: "User feedback", color: "text-orange-600" }].map(({ label, value, sub, color }) => <div key={label} className="bg-card border border-border rounded-xl p-6"><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{label}</p><p style={{ fontFamily: "'Roboto Slab',serif" }} className={`text-4xl font-bold mb-1 ${color}`}>{value}</p><p className="text-xs text-green-600 font-semibold">{sub}</p></div>)}
            </div>
          </>)}
          {section === "settings" && <GeneralSettingsPanel />}
        </div>
      </main>
    </div>
  </div>);
}
// ─── ROOT ─────────────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: "red", fontFamily: "monospace" }}>
          <h2>Something went wrong.</h2>
          <pre>{this.state.error?.toString()}</pre>
          <pre>{this.state.error?.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

let toastCounter = 0;

function MainApp() {
  const [page, setPage] = useState("home");
  const [historyStack, setHistoryStack] = useState([]);
  const [routeData, setRouteData] = useState({});
  const [user, setUser] = useState(getStoredUser);
  const [toasts, setToasts] = useState([]);
  
  const toast = (message, type = "success") => {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const isLoggedIn = Boolean(user && sessionStorage.getItem("buildconnect_token"));
  const setLoggedIn = (value) => {
    if (!value) {
      clearAuth();
      setUser(null);
    }
  };
  const go = (p, data) => {
    setHistoryStack(prev => [...prev, { page, routeData }]);
    setPage(p);
    setRouteData(data || {});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const goBack = () => {
    setHistoryStack(prev => {
      if (prev.length === 0) return prev;
      const newStack = [...prev];
      const lastState = newStack.pop();
      setPage(lastState.page);
      setRouteData(lastState.routeData);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return newStack;
    });
  };
  const protectedPage = ["booking", "customer-dashboard", "provider-dashboard", "admin-dashboard"].includes(page);
  
  const ctxValue = { page, go, goBack, routeData, isLoggedIn, user, setLoggedIn, setUser, toast };

  if (protectedPage && !isLoggedIn) {
    return (<AppCtx.Provider value={ctxValue}>
      <div style={{ fontFamily: "'Inter', sans-serif" }}><LoginPage /></div>
    </AppCtx.Provider>);
  }

  if (page === "admin-dashboard" && user?.role !== "admin") {
    return (<AppCtx.Provider value={ctxValue}>
      <div style={{ fontFamily: "'Inter', sans-serif" }}><HomePage /></div>
    </AppCtx.Provider>);
  }
  if (page === "provider-dashboard" && user?.role !== "provider") {
    return (<AppCtx.Provider value={ctxValue}>
      <div style={{ fontFamily: "'Inter', sans-serif" }}><HomePage /></div>
    </AppCtx.Provider>);
  }
  if (page === "customer-dashboard" && user?.role !== "customer") {
    return (<AppCtx.Provider value={ctxValue}>
      <div style={{ fontFamily: "'Inter', sans-serif" }}><HomePage /></div>
    </AppCtx.Provider>);
  }
  return (<AppCtx.Provider value={ctxValue}>
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
      {page === "home" && <HomePage />}
      {page === "login" && <LoginPage />}
      {page === "register" && <RegisterPage />}
      {page === "services" && <ServicesPage />}
      {page === "service-details" && <ServiceDetailsPage />}
      {page === "packages" && <LivePackagesPage />}
      {page === "package-details" && <LivePackageDetailsPage />}
      {page === "providers" && <LiveProvidersPage />}
      {page === "provider-profile" && <LiveProviderProfilePage />}
      {page === "saved" && <SavedPage />}
      {page === "booking" && <BookingPage />}
      {page === "customer-dashboard" && <CustomerDashboard />}
      {page === "provider-dashboard" && <ProviderDashboard />}
      {page === "admin-dashboard" && <AdminDashboard />}
      
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`pointer-events-auto px-5 py-3.5 rounded-xl shadow-2xl font-semibold text-sm flex items-center gap-3 transform transition-all duration-300 animate-in slide-in-from-bottom-5 ${t.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
            {t.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            {t.message}
          </div>
        ))}
      </div>
    </div>
  </AppCtx.Provider>);
}

export default function App() {
  return (
    <MainApp />
  );
}