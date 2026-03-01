const router = require("express").Router();
const bcrypt = require("bcryptjs");
const { body, param, validationResult } = require("express-validator");
const { query, withTransaction } = require("../db/pool");
const { authenticate, requireRole, ADMIN_ROLES } = require("../middleware/auth");

// All user routes require auth
router.use(authenticate);

// ── GET /api/users ────────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, email, role, team, active, must_change_pw, last_login, created_at
       FROM users ORDER BY created_at ASC`
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ── POST /api/users — invite new user (admin only) ────────────
router.post("/", requireRole(...ADMIN_ROLES),
  body("name").trim().notEmpty(),
  body("email").isEmail().normalizeEmail(),
  body("role").isIn(["admin","sales_manager","sales_rep","viewer"]),
  body("team").trim().optional(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { name, email, role, team } = req.body;
      const tempPw   = "Omnes2026!";
      const pwHash   = await bcrypt.hash(tempPw, parseInt(process.env.BCRYPT_ROUNDS) || 12);

      const existing = await query(`SELECT id FROM users WHERE email=$1`, [email]);
      if (existing.rows.length) return res.status(409).json({ error: "Email already registered." });

      const result = await query(
        `INSERT INTO users (name,email,password_hash,role,team,must_change_pw)
         VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id,name,email,role,team,active,must_change_pw,created_at`,
        [name, email, pwHash, role, team || null]
      );

      await query(
        `INSERT INTO audit_log (user_id,action,target,ip_address) VALUES ($1,'User Invited',$2,$3)`,
        [req.user.user_id, `${name} (${email})`, req.ip]
      );

      res.status(201).json({ user: result.rows[0], tempPassword: tempPw });
    } catch (err) { next(err); }
  }
);

// ── PATCH /api/users/:id — update role / team / active ────────
router.patch("/:id", requireRole(...ADMIN_ROLES),
  param("id").isUUID(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { id } = req.params;
      if (id === req.user.user_id && req.body.active === false) {
        return res.status(400).json({ error: "You cannot deactivate your own account." });
      }

      const allowed = ["role","team","active"];
      const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
      if (!updates.length) return res.status(400).json({ error: "No valid fields to update." });

      const setClauses = updates.map(([k], i) => `${k === "active" ? "active" : k} = $${i + 2}`).join(", ");
      const values     = [id, ...updates.map(([,v]) => v)];

      const result = await query(
        `UPDATE users SET ${setClauses}, updated_at=NOW() WHERE id=$1 RETURNING id,name,email,role,team,active`,
        values
      );
      if (!result.rows.length) return res.status(404).json({ error: "User not found." });

      await query(
        `INSERT INTO audit_log (user_id,action,target,ip_address) VALUES ($1,'User Updated',$2,$3)`,
        [req.user.user_id, `User ID ${id}`, req.ip]
      );

      res.json(result.rows[0]);
    } catch (err) { next(err); }
  }
);

// ── POST /api/users/:id/reset-password (super_admin only) ─────
router.post("/:id/reset-password", requireRole("super_admin"),
  param("id").isUUID(),
  body("tempPassword").isLength({ min: 6 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { id }          = req.params;
      const { tempPassword } = req.body;
      const pwHash          = await bcrypt.hash(tempPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE users SET password_hash=$1, must_change_pw=TRUE WHERE id=$2`,
          [pwHash, id]
        );
        // Invalidate all existing sessions for this user
        await client.query(`DELETE FROM sessions WHERE user_id=$1`, [id]);
        await client.query(
          `INSERT INTO audit_log (user_id,action,target,ip_address) VALUES ($1,'Password Reset',$2,$3)`,
          [req.user.user_id, `User ID ${id}`, req.ip]
        );
      });

      res.json({ message: "Password reset. User will be forced to change on next login." });
    } catch (err) { next(err); }
  }
);

module.exports = router;
