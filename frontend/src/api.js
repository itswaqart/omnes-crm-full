// ── OMNES CRM API Client ──────────────────────────────────────
// All API calls go through this module.
// Token is stored in memory (not localStorage) for security.

const BASE = import.meta.env.VITE_API_URL || "";

let _token = null;

export const setToken = (t) => { _token = t; };
export const clearToken = () => { _token = null; };

async function request(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (_token) headers["Authorization"] = `Bearer ${_token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.errors?.[0]?.msg || "Request failed");
  return data;
}

const get  = (path)        => request("GET",    path);
const post = (path, body)  => request("POST",   path, body);
const patch = (path, body) => request("PATCH",  path, body);
const del  = (path)        => request("DELETE", path);

// ── Auth ───────────────────────────────────────────────────────
export const api = {
  auth: {
    login:          (email, password)      => post("/api/auth/login", { email, password }),
    logout:         ()                     => post("/api/auth/logout"),
    me:             ()                     => get("/api/auth/me"),
    changePassword: (currentPassword, newPassword) => post("/api/auth/change-password", { currentPassword, newPassword }),
  },

  users: {
    list:          ()                      => get("/api/users"),
    invite:        (data)                  => post("/api/users", data),
    update:        (id, data)              => patch(`/api/users/${id}`, data),
    resetPassword: (id, tempPassword)      => post(`/api/users/${id}/reset-password`, { tempPassword }),
  },

  leads: {
    list:   (params = {}) => {
      const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v)).toString();
      return get(`/api/leads${qs ? "?" + qs : ""}`);
    },
    get:    (id)           => get(`/api/leads/${id}`),
    create: (data)         => post("/api/leads", data),
    update: (id, data)     => patch(`/api/leads/${id}`, data),
    delete: (id)           => del(`/api/leads/${id}`),
  },

  activities: {
    list:   (leadId)       => get(`/api/activities${leadId ? "?leadId=" + leadId : ""}`),
    create: (data)         => post("/api/activities", data),
  },

  reports: {
    summary: ()            => get("/api/reports/summary"),
    audit:   ()            => get("/api/reports/audit"),
  },

  settings: {
    get:    ()             => get("/api/settings"),
    save:   (data)         => request("PUT", "/api/settings", data),
  },
};
