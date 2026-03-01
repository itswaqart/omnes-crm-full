const jwt = require("jsonwebtoken");
const { query } = require("../db/pool");

// ── Verify JWT and attach user to request ─────────────────────
const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }

    const token = header.slice(7);
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // Check session still exists in DB (allows server-side logout)
    const sessRes = await query(
      `SELECT s.id, u.id AS user_id, u.name, u.email, u.role, u.team, u.active, u.must_change_pw
       FROM sessions s JOIN users u ON s.user_id = u.id
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );

    if (!sessRes.rows.length) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    const user = sessRes.rows[0];
    if (!user.active) {
      return res.status(403).json({ error: "Account is deactivated." });
    }

    req.user  = user;
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
};

// ── Role-based access control ─────────────────────────────────
const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }
  next();
};

const ADMIN_ROLES        = ["super_admin", "admin"];
const MANAGER_ROLES      = ["super_admin", "admin", "sales_manager"];
const ALL_AUTHED_ROLES   = ["super_admin", "admin", "sales_manager", "sales_rep", "viewer"];

module.exports = { authenticate, requireRole, ADMIN_ROLES, MANAGER_ROLES, ALL_AUTHED_ROLES };
