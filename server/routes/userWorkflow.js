const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const JSZip = require("jszip");
const path = require("path");
const authMiddleware = require("../middleware/authMiddleware");
const User = require("../models/User");
const ImageAsset = require("../models/ImageAsset");
const BillingRecord = require("../models/BillingRecord");
const { removeBackgroundBuffer } = require("../utils/removeBgClient");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024
  }
});
const batchUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 75
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

function sanitizeBaseName(name, index) {
  const raw = String(name || `image-${index + 1}`);
  const withoutExt = raw.replace(/\.[^./\\]+$/, "");
  const safe = withoutExt.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || `image-${index + 1}`;
}

function parseSourceType(value) {
  return String(value || "").toLowerCase() === "original" ? "original" : "compressed";
}

function parseBgColor(value) {
  return String(value || "").toLowerCase() === "blue" ? "blue" : "white";
}

function parseOutputFormat(value) {
  return String(value || "").toLowerCase() === "jpg" ? "jpg" : "png";
}

function toMimeFromFormat(format) {
  return format === "jpg" ? "image/jpeg" : "image/png";
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function getAlphaBoundingBox(imageBuffer) {
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width || 0;
  const height = info.height || 0;
  const channels = info.channels || 4;
  if (!width || !height || channels < 4) {
    return { x: 0, y: 0, width, height };
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      const alpha = data[offset + 3];
      if (alpha > 8) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, width, height };
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX + 1),
    height: Math.max(1, maxY - minY + 1)
  };
}

function computePassportPlacement(boxW, boxH, innerW, innerH, headTargetPct = 0.68) {
  const normalizedHeadTarget = clampNumber(headTargetPct, 0.45, 0.86, 0.68);
  const subjectTargetPct = Math.min(0.92, Math.max(0.72, normalizedHeadTarget * 1.28));
  const topPadding = Math.max(8, Math.round(innerH * 0.06));
  const maxDrawHeight = Math.max(1, innerH - topPadding);

  let drawH = Math.min(maxDrawHeight, Math.round(innerH * subjectTargetPct));
  let drawW = Math.max(1, Math.round((Math.max(1, boxW) / Math.max(1, boxH)) * drawH));

  if (drawW > innerW) {
    const widthScale = innerW / drawW;
    drawW = innerW;
    drawH = Math.max(1, Math.round(drawH * widthScale));
  }

  const left = Math.max(0, Math.floor((innerW - drawW) / 2));
  let top = topPadding;
  if (top + drawH > innerH) {
    top = Math.max(0, Math.floor((innerH - drawH) / 2));
  }

  return { drawW, drawH, left, top };
}

function getCompressionSettings(size) {
  const bytes = Number(size || 0);
  if (bytes <= 150 * 1024) return { quality: 76, maxDim: 2200 };
  if (bytes <= 700 * 1024) return { quality: 72, maxDim: 2200 };
  if (bytes <= 2 * 1024 * 1024) return { quality: 68, maxDim: 2000 };
  if (bytes <= 8 * 1024 * 1024) return { quality: 64, maxDim: 1800 };
  return { quality: 60, maxDim: 1600 };
}

async function compressInputBuffer(fileBuffer, sourceSize, outputFormat) {
  const settings = getCompressionSettings(sourceSize);
  const base = sharp(fileBuffer, { failOnError: false }).rotate().resize({
    width: settings.maxDim,
    height: settings.maxDim,
    fit: "inside",
    withoutEnlargement: true
  });

  if (outputFormat === "jpg") {
    return base
      .jpeg({ quality: settings.quality, mozjpeg: true, progressive: true })
      .toBuffer();
  }

  return base
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, quality: settings.quality })
    .toBuffer();
}

async function buildPassportBuffer(removedBuffer, bgColor, outputFormat, headTargetPct = 0.68) {
  const targetW = 413;
  const targetH = 531;
  const margin = 24;
  const innerW = targetW - margin * 2;
  const innerH = targetH - margin * 2;
  const innerBackground = bgColor === "blue" ? "#2563eb" : "#eef1f4";

  const innerBg = await sharp({
    create: {
      width: innerW,
      height: innerH,
      channels: 4,
      background: innerBackground
    }
  })
    .png()
    .toBuffer();

  const sourceMeta = await sharp(removedBuffer).metadata();
  const sourceWidth = Number(sourceMeta.width || innerW);
  const sourceHeight = Number(sourceMeta.height || innerH);
  const alphaBox = await getAlphaBoundingBox(removedBuffer);
  const cropBox = {
    left: Math.max(0, Math.min(sourceWidth - 1, alphaBox.x)),
    top: Math.max(0, Math.min(sourceHeight - 1, alphaBox.y)),
    width: Math.max(1, Math.min(sourceWidth, alphaBox.width || sourceWidth)),
    height: Math.max(1, Math.min(sourceHeight, alphaBox.height || sourceHeight))
  };
  const placement = computePassportPlacement(cropBox.width, cropBox.height, innerW, innerH, headTargetPct);

  const foregroundSource = await sharp(removedBuffer)
    .extract(cropBox)
    .png()
    .toBuffer();

  const foreground = await sharp(foregroundSource)
    .resize(placement.drawW, placement.drawH, {
      fit: "fill",
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();

  const composed = sharp({
    create: {
      width: targetW,
      height: targetH,
      channels: 4,
      background: "#ffffff"
    }
  }).composite([
    { input: innerBg, left: margin, top: margin },
    { input: foreground, left: margin + placement.left, top: margin + placement.top }
  ]);

  if (outputFormat === "jpg") {
    return composed.jpeg({ quality: 92, mozjpeg: true, progressive: true }).toBuffer();
  }

  return composed.png().toBuffer();
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

router.post("/batch/process-zip", authMiddleware, batchUpload.array("images", 75), async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      return res.status(401).json({ error: "User not found for current token." });
    }

    if (!user.subscribed) {
      return res.status(403).json({ error: "Batch processing is available for Pro users only." });
    }

    const files = Array.isArray(req.files)
      ? req.files.filter((entry) => entry && entry.buffer && String(entry.mimetype || "").startsWith("image/"))
      : [];

    if (files.length < 5) {
      return res.status(400).json({ error: "Batch workflow requires at least 5 images." });
    }
    if (files.length > 75) {
      return res.status(400).json({ error: "Batch workflow supports up to 75 images per request." });
    }

    const sourceType = parseSourceType(req.body.sourceType);
    const bgColor = parseBgColor(req.body.bgColor);
    const outputFormat = parseOutputFormat(req.body.outputFormat);
    const outputMime = toMimeFromFormat(outputFormat);
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const zip = new JSZip();
    const docsToInsert = [];
    const failures = [];
    let successCount = 0;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const baseName = sanitizeBaseName(file.originalname, index);
      const workflowId = `${batchId}_${index + 1}`;

      try {
        const compressedBuffer = await compressInputBuffer(file.buffer, Number(file.size || file.buffer.length || 0), outputFormat);
        const passportSourceBuffer = sourceType === "compressed" ? compressedBuffer : file.buffer;
        const passportSourceMime = sourceType === "compressed" ? outputMime : String(file.mimetype || "image/png");
        const removedBuffer = await removeBackgroundBuffer({
          buffer: passportSourceBuffer,
          filename: `${baseName}-source.${outputFormat}`,
          mimeType: passportSourceMime
        });
        const passportBuffer = await buildPassportBuffer(removedBuffer, bgColor, outputFormat);

        zip.file(`${baseName}/${baseName}-compressed.${outputFormat}`, compressedBuffer);
        zip.file(`${baseName}/${baseName}-passport.${outputFormat}`, passportBuffer);

        docsToInsert.push({
          userId: user._id,
          type: "compressed",
          workflowId,
          originalName: `${baseName}-compressed.${outputFormat}`,
          mimeType: outputMime,
          size: compressedBuffer.length,
          format: outputFormat === "jpg" ? "jpg" : "png",
          originalSize: Number(file.size || file.buffer.length || 0),
          data: compressedBuffer
        });
        docsToInsert.push({
          userId: user._id,
          type: "passport",
          workflowId,
          originalName: `${baseName}-passport.${outputFormat}`,
          mimeType: outputMime,
          size: passportBuffer.length,
          format: outputFormat === "jpg" ? "jpg" : "png",
          sourceType,
          bgColor,
          originalSize: Number(file.size || file.buffer.length || 0),
          data: passportBuffer
        });

        successCount += 1;
      } catch (itemError) {
        failures.push(`${path.basename(file.originalname || `image-${index + 1}`)}: ${itemError.message}`);
      }
    }

    if (!successCount) {
      return res.status(502).json({
        error: "Batch processing failed for all images.",
        details: failures.slice(0, 10).join(" | ")
      });
    }

    if (failures.length) {
      zip.file("batch-errors.txt", failures.join("\n"));
    }

    if (docsToInsert.length) {
      await ImageAsset.insertMany(docsToInsert, { ordered: false });
    }

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 }
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="com-pass-batch-${Date.now()}.zip"`);
    res.setHeader("X-Batch-Success-Count", String(successCount));
    res.setHeader("X-Batch-Failed-Count", String(failures.length));
    return res.status(200).send(zipBuffer);
  } catch (error) {
    return res.status(500).json({ error: "Failed to process batch request.", details: error.message });
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
    const billingCountry = String(req.body.billingCountry || "US").trim().toUpperCase();

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
        billingCountry,
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

router.patch("/assets/:id/rename", authMiddleware, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) {
      return res.status(401).json({ error: "User not found for current token." });
    }

    const id = String(req.params.id || "").trim();
    const name = String(req.body.name || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Asset id is required." });
    }
    if (!name) {
      return res.status(400).json({ error: "New file name is required." });
    }

    const safeName = name.slice(0, 140);
    const updated = await ImageAsset.findOneAndUpdate(
      { _id: id, userId: user._id },
      { $set: { originalName: safeName } },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: "Asset not found." });
    }

    return res.json({ ok: true, message: "Asset renamed.", item: toAssetSummary(updated) });
  } catch (error) {
    return res.status(500).json({ error: "Failed to rename asset.", details: error.message });
  }
});
module.exports = router;

