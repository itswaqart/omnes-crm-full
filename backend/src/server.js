require("dotenv").config();
const express    = require("express");
const helmet     = require("helmet");
const cors       = require("cors");
const rateLimit  = require("express-rate-limit");
const { pool }   = require("./db/pool");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const leadRoutes = require("./routes/leads");
const { actRouter, repRouter } = require("./routes/activities");
const settingsRoutes = require("./routes/settings");

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Security headers ──────────────────────────────────────────
app.use(helmet());
app.set("trust proxy", 1);

// ── CORS ──────────────────────────────────────────────────────
const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  "http://localhost:5173,https://voluble-rabanadas-e41624.netlify.app/"
)
  .split(",")
  .map(s => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error(`CORS: Origin ${origin} not allowed`));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

// ── Body parsing ──────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));

// ── Global rate limit ─────────────────────────────────────────
app.use(rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX)        || 200,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Health check ──────────────────────────────────────────────
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "db_error" });
  }
});

// ── API Routes ────────────────────────────────────────────────
app.use("/api/auth",       authRoutes);
app.use("/api/users",      userRoutes);
app.use("/api/leads",      leadRoutes);
app.use("/api/activities", actRouter);
app.use("/api/reports",    repRouter);
app.use("/api/settings",   settingsRoutes);

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: "Route not found" }));

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err.message);
  if (process.env.NODE_ENV === "development") console.error(err.stack);
  res.status(err.status || 500).json({ error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  OMNES CRM API running on port ${PORT}`);
  console.log(`    Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`    Health: http://localhost:${PORT}/health\n`);
});

module.exports = app;
