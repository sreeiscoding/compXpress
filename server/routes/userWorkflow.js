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
      originalName: String(req.body.originalName || req.file.originalname || "compressed-image"),
      mimeType: String(req.file.mimetype || "image/png"),
      size: Number(req.file.size || req.file.buffer.length || 0),
      format: inferFormatFromMime(req.file.mimetype),
      originalSize: Number(req.body.originalSize || 0),
      data: req.file.buffer
    });

    return res.status(201).json({
      ok: true,
      id: String(doc._id),
      type: doc.type,
      createdAt: doc.createdAt
    });
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
      originalName: String(req.body.originalName || req.file.originalname || "passport-photo"),
      mimeType: String(req.file.mimetype || "image/png"),
      size: Number(req.file.size || req.file.buffer.length || 0),
      format: inferFormatFromMime(req.file.mimetype),
      sourceType: sourceType === "original" ? "original" : "compressed",
      bgColor: bgColor === "blue" ? "blue" : "white",
      data: req.file.buffer
    });

    return res.status(201).json({
      ok: true,
      id: String(doc._id),
      type: doc.type,
      createdAt: doc.createdAt
    });
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

router.get("/assets/recent/compressed", authMiddleware, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      return res.status(401).json({ error: "User not found for current token." });
    }

    const limit = Math.min(20, Math.max(1, Number(req.query.limit || 4)));
    const docs = await ImageAsset.find({ userId: user._id, type: "compressed" })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const items = docs.map((doc) => ({
      id: String(doc._id),
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

module.exports = router;
