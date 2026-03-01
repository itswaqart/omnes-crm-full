const router = require("express").Router();
const { query } = require("../db/pool");
const { authenticate, requireRole } = require("../middleware/auth");

// All settings routes require auth
router.use(authenticate);

// ── GET /api/settings — fetch categories and properties ───────────────────
router.get("/", async (req, res, next) => {
  try {
    const result = await query(
      `SELECT key, value FROM app_settings WHERE key IN ('categories','properties')`
    );
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = JSON.parse(row.value);
    });
    res.json(settings);
  } catch (err) { next(err); }
});

// ── PUT /api/settings — update categories or properties (admin only) ──────
router.put("/", requireRole("super_admin", "admin"),
  async (req, res, next) => {
    try {
      const { categories, properties } = req.body;

      if (categories) {
        if (!Array.isArray(categories)) return res.status(400).json({ error: "categories must be an array" });
        await query(
          `INSERT INTO app_settings (key, value) VALUES ('categories', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [JSON.stringify(categories)]
        );
        await query(
          `INSERT INTO audit_log (user_id, action, target, ip_address) VALUES ($1, 'Settings Updated', 'Lead Categories', $2)`,
          [req.user.user_id, req.ip]
        );
      }

      if (properties) {
        if (!Array.isArray(properties)) return res.status(400).json({ error: "properties must be an array" });
        await query(
          `INSERT INTO app_settings (key, value) VALUES ('properties', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [JSON.stringify(properties)]
        );
        await query(
          `INSERT INTO audit_log (user_id, action, target, ip_address) VALUES ($1, 'Settings Updated', 'Business Units', $2)`,
          [req.user.user_id, req.ip]
        );
      }

      res.json({ message: "Settings saved." });
    } catch (err) { next(err); }
  }
);

module.exports = router;
