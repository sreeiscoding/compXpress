const express = require("express");
const multer = require("multer");
const authMiddleware = require("../middleware/authMiddleware");
const User = require("../models/User");
const ImageAsset = require("../models/ImageAsset");
const BillingRecord = require("../models/BillingRecord");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024
  }
});

async function resolveUser(req) {
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

function inferFormatFromMime(mimeType) {
  const type = String(mimeType || "").toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("jpg") || type.includes("jpeg")) return "jpg";
  if (type.includes("webp")) return "webp";
  return "unknown";
}

function resolveWorkflowId(req) {
  const incoming = String(req.body.workflowId || "").trim();
  if (incoming) return incoming;
  return `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

router.post("/assets/compressed", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "Compressed image file is required." });
    }

    const user = await resolveUser(req);
    if (!user) {
      return res.status(401).json({ error: "User not found for current token." });
    }

    const doc = await ImageAsset.create({
      userId: user._id,
      type: "compressed",
      workflowId: resolveWorkflowId(req),
      originalName: String(req.body.originalName || req.file.originalname || "compressed-image"),
      mimeType: String(req.file.mimetype || "image/png"),
      size: Number(req.file.size || req.file.buffer.length || 0),
      format: inferFormatFromMime(req.file.mimetype),
      originalSize: Number(req.body.originalSize || 0),
      data: req.file.buffer
    });

    return res.status(201).json({ ok: true, ...toAssetSummary(doc) });
  } catch (error) {
    return res.status(500).json({ error: "Failed to store compressed image.", details: error.message });
  }
});

router.post("/assets/passport", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "Passport image file is required." });
    }

    const user = await resolveUser(req);
    if (!user) {
      return res.status(401).json({ error: "User not found for current token." });
    }

    const sourceType = String(req.body.sourceType || "").toLowerCase();
    const bgColor = String(req.body.bgColor || "").toLowerCase();

    const doc = await ImageAsset.create({
      userId: user._id,
      type: "passport",
      workflowId: resolveWorkflowId(req),
      originalName: String(req.body.originalName || req.file.originalname || "passport-photo"),
      mimeType: String(req.file.mimetype || "image/png"),
      size: Number(req.file.size || req.file.buffer.length || 0),
      format: inferFormatFromMime(req.file.mimetype),
      sourceType: sourceType === "original" ? "original" : "compressed",
      bgColor: bgColor === "blue" ? "blue" : "white",
      data: req.file.buffer
    });

    return res.status(201).json({ ok: true, ...toAssetSummary(doc) });
  } catch (error) {
    return res.status(500).json({ error: "Failed to store passport image.", details: error.message });
  }
});

router.post("/billing/subscribe", authMiddleware, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      return res.status(401).json({ error: "User not found for current token." });
    }

    const method = String(req.body.method || "").toLowerCase();
    const billingName = String(req.body.billingName || "").trim();
    const billingEmail = String(req.body.billingEmail || "").trim().toLowerCase();
    const plan = String(req.body.plan || "pro").trim().toLowerCase();
    const currency = String(req.body.currency || "USD").trim().toUpperCase();
    const amount = Number(req.body.amount || 9);

    if (!billingName || !billingEmail || !method) {
      return res.status(400).json({ error: "Billing name, email and payment method are required." });
    }

    if (!["upi", "razorpay", "stripe"].includes(method)) {
      return res.status(400).json({ error: "Unsupported billing method." });
    }

    const billing = await BillingRecord.create({
      userId: user._id,
      plan,
      amount,
      currency,
      method,
      status: "paid",
      billingName,
      billingEmail,
      transactionRef: String(req.body.transactionRef || `txn_${Date.now()}`),
      meta: {
        source: "web-app",
        upiId: String(req.body.upiId || "").trim(),
        razorpayPhone: String(req.body.razorpayPhone || "").trim()
      }
    });

    user.subscribed = true;
    await user.save();

    return res.status(201).json({
      ok: true,
      message: "Subscription activated.",
      billingId: String(billing._id),
      subscribed: true
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to store billing record.", details: error.message });
  }
});

router.get("/assets/recent/groups", authMiddleware, async (req, res) => {
  try {
    const user = await resolveUser(req);
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

router.get("/assets/recent/compressed", authMiddleware, async (req, res) => {
  try {
    const user = await resolveUser(req);
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

router.delete("/assets/group/:workflowId", authMiddleware, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      return res.status(401).json({ error: "User not found for current token." });
    }

    const workflowId = String(req.params.workflowId || "").trim();
    if (!workflowId) {
      return res.status(400).json({ error: "Workflow id is required." });
    }

    const deleteQuery = {
      userId: user._id,
      $or: [{ workflowId }]
    };

    if (/^[a-f\d]{24}$/i.test(workflowId)) {
      deleteQuery.$or.push({ _id: workflowId });
    }

    const result = await ImageAsset.deleteMany(deleteQuery);
    if (!result.deletedCount) {
      return res.status(404).json({ error: "No files found for this workflow." });
    }

    return res.json({ ok: true, deletedCount: result.deletedCount, message: "Workflow files deleted." });
  } catch (error) {
    return res.status(500).json({ error: "Failed to delete workflow files.", details: error.message });
  }
});

router.get("/assets/:id", authMiddleware, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      return res.status(401).json({ error: "User not found for current token." });
    }

    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Asset id is required." });
    }

    const asset = await ImageAsset.findOne({ _id: id, userId: user._id });
    if (!asset || !asset.data) {
      return res.status(404).json({ error: "Asset not found." });
    }

    res.setHeader("Content-Type", asset.mimeType || "application/octet-stream");
    return res.status(200).send(asset.data);
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch asset.", details: error.message });
  }
});

router.delete("/assets/:id", authMiddleware, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      return res.status(401).json({ error: "User not found for current token." });
    }

    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Asset id is required." });
    }

    const deleted = await ImageAsset.findOneAndDelete({ _id: id, userId: user._id });
    if (!deleted) {
      return res.status(404).json({ error: "Asset not found." });
    }

    return res.json({ ok: true, message: "Asset deleted." });
  } catch (error) {
    return res.status(500).json({ error: "Failed to delete asset.", details: error.message });
  }
});

router.get("/assets/compressed/:id", authMiddleware, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      return res.status(401).json({ error: "User not found for current token." });
    }

    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Asset id is required." });
    }

    const asset = await ImageAsset.findOne({ _id: id, userId: user._id, type: "compressed" });
    if (!asset || !asset.data) {
      return res.status(404).json({ error: "Compressed asset not found." });
    }

    res.setHeader("Content-Type", asset.mimeType || "image/png");
    return res.status(200).send(asset.data);
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch compressed asset.", details: error.message });
  }
});

router.delete("/assets/compressed/:id", authMiddleware, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      return res.status(401).json({ error: "User not found for current token." });
    }

    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Asset id is required." });
    }

    const deleted = await ImageAsset.findOneAndDelete({ _id: id, userId: user._id, type: "compressed" });
    if (!deleted) {
      return res.status(404).json({ error: "Compressed asset not found." });
    }

    return res.json({ ok: true, message: "Compressed asset deleted." });
  } catch (error) {
    return res.status(500).json({ error: "Failed to delete compressed asset.", details: error.message });
  }
});

module.exports = router;
