const router  = require("express").Router();
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const rateLimit = require("express-rate-limit");
const { query, withTransaction } = require("../db/pool");
const { authenticate } = require("../middleware/auth");

// Strict rate limit for login endpoint
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── POST /api/auth/login ──────────────────────────────────────
router.post("/login", loginLimiter,
  body("email").isEmail().normalizeEmail(),
  body("password").notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { email, password } = req.body;

      const userRes = await query(
        `SELECT id, name, email, password_hash, role, team, active, must_change_pw, last_login
         FROM users WHERE email = $1`,
        [email]
      );

      const user = userRes.rows[0];

      // Constant-time compare to prevent timing attacks
      const valid = user ? await bcrypt.compare(password, user.password_hash) : await bcrypt.compare(password, "$2b$12$dummy.hash.to.prevent.timing.attacks.padding");

      if (!user || !valid) {
        // Audit failed attempt
        await query(`INSERT INTO audit_log (action, target, ip_address) VALUES ('Login Failed', $1, $2)`, [email, req.ip]);
        return res.status(401).json({ error: "Invalid email or password." });
      }

      if (!user.active) {
        return res.status(403).json({ error: "Your account has been deactivated. Contact your administrator." });
      }

      // Create JWT
      const token = jwt.sign(
        { sub: user.id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
      );

      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);

      await withTransaction(async (client) => {
        // Store session
        await client.query(
          `INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)`,
          [user.id, token, expiresAt]
        );
        // Update last login
        await client.query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);
        // Audit
        await client.query(
          `INSERT INTO audit_log (user_id, action, target, ip_address) VALUES ($1,'Login','Session started',$2)`,
          [user.id, req.ip]
        );
      });

      res.json({
        token,
        expiresAt,
        user: {
          id: user.id, name: user.name, email: user.email,
          role: user.role, team: user.team,
          mustChangePw: user.must_change_pw,
          lastLogin: user.last_login,
        },
      });
    } catch (err) { next(err); }
  }
);

// ── POST /api/auth/logout ─────────────────────────────────────
router.post("/logout", authenticate, async (req, res, next) => {
  try {
    await query(`DELETE FROM sessions WHERE token = $1`, [req.token]);
    await query(
      `INSERT INTO audit_log (user_id, action, target, ip_address) VALUES ($1,'Logout','Session ended',$2)`,
      [req.user.user_id, req.ip]
    );
    res.json({ message: "Logged out." });
  } catch (err) { next(err); }
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get("/me", authenticate, async (req, res) => {
  res.json({ user: req.user });
});

// ── POST /api/auth/change-password ────────────────────────────
router.post("/change-password", authenticate,
  body("currentPassword").notEmpty(),
  body("newPassword").isLength({ min: 8 }).withMessage("Minimum 8 characters"),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { currentPassword, newPassword } = req.body;

      const userRes = await query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.user_id]);
      const valid   = await bcrypt.compare(currentPassword, userRes.rows[0].password_hash);
      if (!valid) return res.status(400).json({ error: "Current password is incorrect." });

      const newHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
      await withTransaction(async (client) => {
        await client.query(`UPDATE users SET password_hash=$1, must_change_pw=FALSE WHERE id=$2`, [newHash, req.user.user_id]);
        await client.query(`DELETE FROM sessions WHERE user_id=$1 AND token != $2`, [req.user.user_id, req.token]);
        await client.query(`INSERT INTO audit_log (user_id,action,target,ip_address) VALUES ($1,'Password Changed','Self-service',$2)`, [req.user.user_id, req.ip]);
      });

      res.json({ message: "Password updated." });
    } catch (err) { next(err); }
  }
);

module.exports = router;
