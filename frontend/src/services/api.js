const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export const getToken = () => sessionStorage.getItem("buildconnect_token");
export const getStoredUser = () => {
  try { return JSON.parse(sessionStorage.getItem("buildconnect_user") || "null"); }
  catch { return null; }
};
export const clearAuth = () => {
  sessionStorage.removeItem("buildconnect_token");
  sessionStorage.removeItem("buildconnect_user");
};

export async function apiRequest(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch (err) {
    throw new Error("Unable to connect to server. Please check your backend is running.");
  }

  let data = {};
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    data = await response.json().catch(() => ({}));
  } else {
    const rawText = await response.text().catch(() => "");
    if (rawText) data = { message: rawText };
  }

  if (response.status === 401) clearAuth();
  if (!response.ok) {
    const message = data.message || data.error || (response.status === 429 ? "Too many requests. Please slow down." : `Request failed (${response.status})`);
    throw new Error(message);
  }
  return data;
}

/**
 * Download a protected file (e.g. the PDF bill) through the API so it carries
 * the auth header, then save it with the filename the server sent.
 */
export async function downloadFile(path, fallbackName = "download") {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) clearAuth();
    throw new Error(data.message || "Download failed");
  }
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = match ? match[1] : fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const authApi = {
  login: (body) => apiRequest("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  register: (body) => apiRequest("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  googleLogin: (credential, role) => apiRequest("/auth/google", { method: "POST", body: JSON.stringify({ credential, role }) }),
};
export const serviceApi = {
  list: (query = "") => apiRequest(`/services${query ? `?${query}` : ""}`),
  get: (id) => apiRequest(`/services/${id}`),
  my: () => apiRequest("/services/my"),
  create: (body) => apiRequest("/services", { method: "POST", body: JSON.stringify(body) }),
  update: (id, body) => apiRequest(`/services/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  delete: (id) => apiRequest(`/services/${id}`, { method: "DELETE" }),
};
export const packageApi = {
  list: (query = "") => apiRequest(`/packages${query ? `?${query}` : ""}`),
  get: (id) => apiRequest(`/packages/${id}`),
  my: () => apiRequest("/packages/my"),
  create: (body) => apiRequest("/packages", { method: "POST", body: JSON.stringify(body) }),
  update: (id, body) => apiRequest(`/packages/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  delete: (id) => apiRequest(`/packages/${id}`, { method: "DELETE" }),
};
export const bookingApi = {
  createBooking: (body) => apiRequest("/bookings", { method: "POST", body: JSON.stringify(body) }),
  getMyBookings: () => apiRequest("/bookings/my"),
  getProviderBookings: () => apiRequest("/bookings/provider"),
  getBooking: (id) => apiRequest(`/bookings/${id}`),
  updateStatus: (id, status) => apiRequest(`/bookings/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) }),
  provideEstimate: (id, price) => apiRequest(`/bookings/${id}/estimate`, { method: "PUT", body: JSON.stringify({ price }) }),
  cancelBooking: (id) => apiRequest(`/bookings/${id}/cancel`, { method: "PUT" }),
  addMaterials: (id, materials) => apiRequest(`/bookings/${id}/materials`, { method: "PUT", body: JSON.stringify({ materials }) }),
  all: () => apiRequest("/bookings"),
  getBookedSlots: (providerId, date) => apiRequest(`/bookings/provider/${providerId}/slots?date=${date}`),
  invoicePreview: (id) => apiRequest(`/bookings/${id}/invoice/preview`),
  downloadInvoice: (id, fallbackName) => downloadFile(`/bookings/${id}/invoice`, fallbackName || `bill-${id}.pdf`),
};
export const userApi = {
  profile: () => apiRequest("/users/profile"),
  update: (body) => apiRequest("/users/profile", { method: "PUT", body: JSON.stringify(body) }),
  changePassword: (body) => apiRequest("/users/change-password", { method: "POST", body: JSON.stringify(body) }),
  providers: () => apiRequest("/users/providers"),
};
export const notificationApi = {
  list: () => apiRequest("/notifications"),
  channelStatus: () => apiRequest("/notifications/status"),
  markRead: (id) => apiRequest(`/notifications/${id}/read`, { method: "PUT" }),
  markAllRead: () => apiRequest("/notifications/read-all", { method: "PUT" }),
};
export const reviewApi = {
  create: (body) => apiRequest("/reviews", { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body) }),
  service: (serviceId) => apiRequest(`/reviews/service/${serviceId}`),
  provider: (providerId) => apiRequest(`/reviews/provider/${providerId}`),
  package: (packageId) => apiRequest(`/reviews/package/${packageId}`),
  remove: (id) => apiRequest(`/reviews/${id}`, { method: "DELETE" }),
};
export const adminApi = {
  dashboard: () => apiRequest("/admin/dashboard"),
  users: () => apiRequest("/admin/users"),
  services: () => apiRequest("/admin/services"),
  packages: () => apiRequest("/admin/packages"),
  bookings: () => apiRequest("/admin/bookings"),
  reviews: () => apiRequest("/admin/reviews"),
  removeReview: (id) => apiRequest(`/admin/reviews/${id}`, { method: "DELETE" }),
  approveProvider: (id) => apiRequest(`/admin/approve-provider/${id}`, { method: "PUT" }),
  removeUser: (id) => apiRequest(`/admin/users/${id}`, { method: "DELETE" }),
  removeService: (id) => apiRequest(`/admin/services/${id}`, { method: "DELETE" }),
  removePackage: (id) => apiRequest(`/admin/packages/${id}`, { method: "DELETE" }),
};
export const messageApi = {
  getMessages: (bookingId) => apiRequest(`/messages/${bookingId}`),
};
export const paymentApi = {
  createOrder: (bookingId) => apiRequest("/payments/create-order", { method: "POST", body: JSON.stringify({ bookingId }) }),
  verify: (body) => apiRequest("/payments/verify", { method: "POST", body: JSON.stringify(body) }),
  getByBooking: (bookingId) => apiRequest(`/payments/booking/${bookingId}`),
  my: () => apiRequest("/payments/my"),
};
export const portfolioApi = {
  create: (body) => apiRequest("/portfolio", { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body) }),
  getProviderPortfolio: (providerId) => apiRequest(`/portfolio/provider/${providerId}`),
  delete: (id) => apiRequest(`/portfolio/${id}`, { method: "DELETE" }),
};
