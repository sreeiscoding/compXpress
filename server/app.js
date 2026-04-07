require("dotenv").config();

const express = require("express");
const cors = require("cors");
const authMiddleware = require("./middleware/authMiddleware");
const User = require("./models/User");
const ImageAsset = require("./models/ImageAsset");

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
      "POST /api/batch/process-zip",
      "POST /api/billing/subscribe",
      "GET /api/assets/recent/compressed"
    ]
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "comxpress-server" });
});

async function resolveUserFromRequest(req) {
  const tokenUserId = String(req.user && req.user.userId ? req.user.userId : "").trim();
  const tokenEmail = String(req.user && req.user.email ? req.user.email : "").trim().toLowerCase();

  if (tokenUserId) {
    const byId = await User.findById(tokenUserId);
    if (byId) return byId;
  }
  if (tokenEmail) {
    return User.findOne({ email: tokenEmail });
  }
  return null;
}

function toGroupDisplayName(name) {
  const source = String(name || "generated-file");
  return source.replace(/\.[^./\\]+$/, "") || "generated-file";
}

function toAssetSummary(doc) {
  return {
    id: String(doc._id),
    workflowId: String(doc.workflowId || doc._id),
    name: doc.originalName,
    type: doc.type,
    size: doc.size,
    originalSize: doc.originalSize || 0,
    sourceType: doc.sourceType || "",
    bgColor: doc.bgColor || "",
    createdAt: doc.createdAt
  };
}

// Explicit recent endpoints in app-level router as a stable fallback in production deployments.
app.get("/api/assets/recent/compressed", authMiddleware, async (req, res) => {
  try {
    const user = await resolveUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: "User not found for current token." });
    }

    const docs = await ImageAsset.find({ userId: user._id, type: "compressed" })
      .sort({ createdAt: -1 })
      .lean();

    const items = docs.map((doc) => ({
      id: String(doc._id),
      workflowId: String(doc.workflowId || doc._id),
      name: doc.originalName,
      size: doc.size,
      originalSize: doc.originalSize || 0,
      createdAt: doc.createdAt
    }));

    return res.json({ ok: true, items });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch recent compressed assets.", details: error.message });
  }
});

app.get("/api/assets/recent/groups", authMiddleware, async (req, res) => {
  try {
    const user = await resolveUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: "User not found for current token." });
    }

    const docs = await ImageAsset.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .lean();

    const groupMap = new Map();
    for (const doc of docs) {
      const workflowId = String(doc.workflowId || doc._id);
      const file = toAssetSummary(doc);

      if (!groupMap.has(workflowId)) {
        groupMap.set(workflowId, {
          workflowId,
          name: toGroupDisplayName(doc.originalName),
          totalFiles: 0,
          latestCreatedAt: doc.createdAt,
          files: []
        });
      }

      const group = groupMap.get(workflowId);
      if (doc.type === "compressed" && doc.originalName) {
        group.name = toGroupDisplayName(doc.originalName);
      }
      group.files.push(file);
      group.totalFiles += 1;
      if (new Date(doc.createdAt).getTime() > new Date(group.latestCreatedAt).getTime()) {
        group.latestCreatedAt = doc.createdAt;
      }
    }

    const groups = Array.from(groupMap.values()).sort(
      (a, b) => new Date(b.latestCreatedAt).getTime() - new Date(a.latestCreatedAt).getTime()
    );

    return res.json({ ok: true, groups });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch recent grouped assets.", details: error.message });
  }
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

