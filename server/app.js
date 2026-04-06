require("dotenv").config();

const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const removeBgRoutes = require("./routes/removeBg");
const userWorkflowRoutes = require("./routes/userWorkflow");

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "comxpress-server",
    message: "Use /api routes.",
    routes: [
      "GET /api/health",
      "POST /api/signup",
      "POST /api/login",
      "GET /api/me",
      "POST /api/forgot-password",
      "POST /api/reset-password",
      "POST /api/remove-bg",
      "POST /api/process-passport",
      "POST /api/assets/compressed",
      "POST /api/assets/passport",
      "POST /api/billing/subscribe",
      "GET /api/assets/recent/compressed"
    ]
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "comxpress-server" });
});

app.use("/api", authRoutes);
app.use("/api", removeBgRoutes);
app.use("/api", userWorkflowRoutes);
app.use("/", authRoutes);
app.use("/", removeBgRoutes);
app.use("/", userWorkflowRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Route not found." });
});

app.use((error, _req, res, _next) => {
  res.status(500).json({ error: "Internal server error.", details: error.message });
});

module.exports = app;
