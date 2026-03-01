const router = require("express").Router();
const { body, param, query: qv, validationResult } = require("express-validator");
const { query, withTransaction } = require("../db/pool");
const { authenticate, requireRole, MANAGER_ROLES } = require("../middleware/auth");

router.use(authenticate);

const STAGES     = ["New","Contacted","Qualified","Proposal","Closed Won","Closed Lost"];
const DEAL_TYPES = ["Direct","Agency"];

// ── Visibility helper ─────────────────────────────────────────
// Managers/admins see all; reps see only their own
function buildLeadFilter(user, extraWhere = [], extraParams = []) {
  const where  = [...extraWhere];
  const params = [...extraParams];
  if (!MANAGER_ROLES.includes(user.role)) {
    params.push(user.user_id);
    where.push(`l.assigned_to = $${params.length}`);
  }
  return { where, params };
}

// ── GET /api/leads ────────────────────────────────────────────
router.get("/",
  qv("stage").optional().isIn(STAGES),
  qv("assignedTo").optional().isUUID(),
  qv("search").optional().isString(),
  async (req, res, next) => {
    try {
      const { stage, assignedTo, search } = req.query;
      let where = [], params = [];

      if (stage) { params.push(stage); where.push(`l.stage = $${params.length}`); }
      if (assignedTo && MANAGER_ROLES.includes(req.user.role)) { params.push(assignedTo); where.push(`l.assigned_to = $${params.length}`); }
      if (search) { params.push(`%${search}%`); where.push(`(l.company ILIKE $${params.length} OR l.contact ILIKE $${params.length} OR l.category ILIKE $${params.length})`); }

      const filtered = buildLeadFilter(req.user, where, params);

      const sql = `
        SELECT l.*,
          u.name AS assigned_to_name,
          cb.name AS created_by_name
        FROM leads l
        LEFT JOIN users u  ON l.assigned_to = u.id
        LEFT JOIN users cb ON l.created_by  = cb.id
        ${filtered.where.length ? "WHERE " + filtered.where.join(" AND ") : ""}
        ORDER BY l.created_at DESC`;

      const result = await query(sql, filtered.params);
      res.json(result.rows);
    } catch (err) { next(err); }
  }
);

// ── GET /api/leads/:id ────────────────────────────────────────
router.get("/:id", param("id").isUUID(), async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { where, params } = buildLeadFilter(req.user, ["l.id = $1"], [req.params.id]);
    const result = await query(
      `SELECT l.*, u.name AS assigned_to_name FROM leads l LEFT JOIN users u ON l.assigned_to=u.id WHERE ${where.join(" AND ")}`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: "Lead not found." });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ── POST /api/leads ────────────────────────────────────────────
router.post("/",
  body("company").trim().notEmpty(),
  body("stage").optional().isIn(STAGES),
  body("value").optional().isNumeric(),
  body("probability").optional().isInt({ min:0, max:100 }),
  body("dealType").optional().isIn(DEAL_TYPES),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const {
        company, contact, email, phone, stage="New", value=0, probability=20,
        source, category, property, dealType="Direct", assignedTo, notes
      } = req.body;

      const result = await query(
        `INSERT INTO leads (company,contact,email,phone,stage,value,probability,source,category,property,deal_type,assigned_to,notes,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [company,contact,email,phone,stage,value,probability,source,category,property,dealType,
         assignedTo||req.user.user_id, notes, req.user.user_id]
      );

      await query(
        `INSERT INTO audit_log (user_id,action,target,ip_address) VALUES ($1,'Deal Created',$2,$3)`,
        [req.user.user_id, company, req.ip]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) { next(err); }
  }
);

// ── PATCH /api/leads/:id ──────────────────────────────────────
router.patch("/:id", param("id").isUUID(),
  body("stage").optional().isIn(STAGES),
  body("value").optional().isNumeric(),
  body("probability").optional().isInt({ min:0, max:100 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      if (req.user.role === "viewer") return res.status(403).json({ error: "Read-only access." });

      const allowed = ["company","contact","email","phone","stage","value","probability","source","category","property","deal_type","assigned_to","notes"];
      // Map camelCase → snake_case
      const fieldMap = { dealType:"deal_type", assignedTo:"assigned_to", probability:"probability" };
      const updates = Object.entries(req.body)
        .map(([k,v]) => [fieldMap[k]||k, v])
        .filter(([k]) => allowed.includes(k));

      if (!updates.length) return res.status(400).json({ error: "No valid fields." });

      const { where: baseWhere, params: baseParams } = buildLeadFilter(req.user, ["id = $1"], [req.params.id]);
      const setClauses = updates.map(([k], i) => `${k} = $${baseParams.length + i + 1}`).join(", ");
      const allParams  = [...baseParams, ...updates.map(([,v]) => v)];

      const result = await query(
        `UPDATE leads SET ${setClauses}, updated_at=NOW() WHERE ${baseWhere.join(" AND ")} RETURNING *`,
        allParams
      );
      if (!result.rows.length) return res.status(404).json({ error: "Lead not found or access denied." });

      await query(
        `INSERT INTO audit_log (user_id,action,target,ip_address) VALUES ($1,'Deal Updated',$2,$3)`,
        [req.user.user_id, result.rows[0].company, req.ip]
      );

      res.json(result.rows[0]);
    } catch (err) { next(err); }
  }
);

// ── DELETE /api/leads/:id (manager+ only) ─────────────────────
router.delete("/:id", requireRole(...MANAGER_ROLES), param("id").isUUID(), async (req, res, next) => {
  try {
    const result = await query(`DELETE FROM leads WHERE id=$1 RETURNING company`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Lead not found." });
    await query(
      `INSERT INTO audit_log (user_id,action,target,ip_address) VALUES ($1,'Deal Deleted',$2,$3)`,
      [req.user.user_id, result.rows[0].company, req.ip]
    );
    res.json({ message: "Lead deleted." });
  } catch (err) { next(err); }
});

module.exports = router;
