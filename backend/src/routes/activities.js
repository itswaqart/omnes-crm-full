// ── Activities ────────────────────────────────────────────────
const actRouter = require("express").Router();
const { body, param, validationResult } = require("express-validator");
const { query } = require("../db/pool");
const { authenticate, MANAGER_ROLES } = require("../middleware/auth");

actRouter.use(authenticate);

const ACTIVITY_TYPES = ["Call","Email","Meeting","Note","Task"];

// GET /api/activities  (optionally filter by leadId)
actRouter.get("/", async (req, res, next) => {
  try {
    const { leadId } = req.query;
    const where = [], params = [];

    if (leadId) { params.push(leadId); where.push(`a.lead_id = $${params.length}`); }
    if (!MANAGER_ROLES.includes(req.user.role)) { params.push(req.user.user_id); where.push(`a.user_id = $${params.length}`); }

    const result = await query(
      `SELECT a.*, u.name AS user_name, l.company AS lead_company
       FROM activities a
       JOIN users u ON a.user_id = u.id
       JOIN leads l ON a.lead_id = l.id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY a.created_at DESC LIMIT 500`,
      params
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/activities
actRouter.post("/",
  body("leadId").isUUID(),
  body("type").isIn(ACTIVITY_TYPES),
  body("note").trim().notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      if (req.user.role === "viewer") return res.status(403).json({ error: "Read-only access." });

      const { leadId, type, note } = req.body;
      const result = await query(
        `INSERT INTO activities (lead_id,type,note,user_id) VALUES ($1,$2,$3,$4)
         RETURNING *, (SELECT name FROM users WHERE id=$4) AS user_name,
                       (SELECT company FROM leads WHERE id=$1) AS lead_company`,
        [leadId, type, note, req.user.user_id]
      );

      await query(
        `INSERT INTO audit_log (user_id,action,target,ip_address) VALUES ($1,$2,$3,$4)`,
        [req.user.user_id, `Activity: ${type}`, `Lead ID ${leadId}`, req.ip]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────────────────────
const repRouter = require("express").Router();
const { requireRole } = require("../middleware/auth");

repRouter.use(authenticate);
repRouter.use(requireRole("super_admin","admin","sales_manager"));

// GET /api/reports/summary
repRouter.get("/summary", async (req, res, next) => {
  try {
    const [pipeline, byStage, byProperty, bySource, repPerf] = await Promise.all([
      query(`SELECT
               COUNT(*) FILTER (WHERE stage NOT IN ('Closed Won','Closed Lost')) AS active_deals,
               SUM(value) FILTER (WHERE stage NOT IN ('Closed Won','Closed Lost')) AS pipeline_value,
               SUM(value) FILTER (WHERE stage='Closed Won') AS won_value,
               COUNT(*) FILTER (WHERE stage='Closed Won') AS won_count,
               COUNT(*) AS total_deals
             FROM leads`),
      query(`SELECT stage, COUNT(*) AS count, SUM(value) AS total FROM leads GROUP BY stage`),
      query(`SELECT property, COUNT(*) AS count, SUM(value) AS total FROM leads GROUP BY property ORDER BY total DESC`),
      query(`SELECT source, COUNT(*) AS count FROM leads GROUP BY source ORDER BY count DESC`),
      query(`SELECT u.id, u.name, u.role,
               COUNT(l.id) AS deals,
               SUM(l.value) FILTER (WHERE l.stage='Closed Won') AS won_value,
               SUM(l.value) FILTER (WHERE l.stage NOT IN ('Closed Won','Closed Lost')) AS pipeline_value,
               COUNT(a.id) AS activities
             FROM users u
             LEFT JOIN leads      l ON l.assigned_to = u.id
             LEFT JOIN activities a ON a.user_id     = u.id
             WHERE u.role IN ('sales_rep','sales_manager')
             GROUP BY u.id, u.name, u.role
             ORDER BY won_value DESC NULLS LAST`),
    ]);

    res.json({
      summary:    pipeline.rows[0],
      byStage:    byStage.rows,
      byProperty: byProperty.rows,
      bySource:   bySource.rows,
      repPerf:    repPerf.rows,
    });
  } catch (err) { next(err); }
});

// GET /api/reports/audit (super_admin only)
repRouter.get("/audit", requireRole("super_admin"), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT al.*, u.name AS user_name
       FROM audit_log al LEFT JOIN users u ON al.user_id = u.id
       ORDER BY al.created_at DESC LIMIT 1000`
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = { actRouter, repRouter };
