const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");
const authMiddleware = require("../middleware/authMiddleware");
const { removeBackgroundBuffer } = require("../utils/removeBgClient");
const { resolveUserFromRequest, hasUsageAllowance, incrementUsage } = require("../utils/usage");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024
  }
});

function parseInnerBgColor(color) {
  return color === "blue" ? "#2563eb" : "#eef1f4";
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

function computePassportPlacement(boxW, boxH, innerW, innerH, headTargetPct) {
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

router.post("/remove-bg", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "Image file is required." });
    }

    const user = await resolveUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: "User not found for current token." });
    }

    const allowance = hasUsageAllowance(user, 1);
    if (!allowance.allowed) {
      return res.status(403).json({
        error: "Free-tier monthly limit reached.",
        usage: allowance.usage,
        message: "Free plan allows 10 image operations per month (includes remove.bg calls)."
      });
    }

    const removed = await removeBackgroundBuffer({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype
    });

    await incrementUsage(user, 1);
    res.setHeader("Content-Type", "image/png");
    return res.status(200).send(removed);
  } catch (error) {
    const status = Number(error.status) || 502;
    console.error("[remove-bg] failed:", error.message);
    return res.status(status).json({ error: "remove.bg processing failed.", details: error.message });
  }
});

router.post("/process-passport", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "Image file is required." });
    }


    const bgColor = parseInnerBgColor(String(req.body.bgColor || "white").toLowerCase());
    const targetW = clampNumber(req.body.targetWidthPx, 280, 1200, 413);
    const targetH = clampNumber(req.body.targetHeightPx, 280, 1200, 531);
    const headTargetPct = clampNumber(req.body.headTargetPct, 0.45, 0.86, 0.68);
    const outFormat = String(req.body.outputFormat || "png").toLowerCase() === "jpg" ? "jpg" : "png";
    const margin = 24;
    const innerW = targetW - margin * 2;
    const innerH = targetH - margin * 2;

    const user = await resolveUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: "User not found for current token." });
    }

    const allowance = hasUsageAllowance(user, 1);
    if (!allowance.allowed) {
      return res.status(403).json({
        error: "Free-tier monthly limit reached.",
        usage: allowance.usage,
        message: "Free plan allows 10 image operations per month (includes remove.bg calls)."
      });
    }

    const removed = await removeBackgroundBuffer({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype
    });

    const innerBg = await sharp({
      create: {
        width: innerW,
        height: innerH,
        channels: 4,
        background: bgColor
      }
    })
      .png()
      .toBuffer();

    const sourceMeta = await sharp(removed).metadata();
    const sourceWidth = Number(sourceMeta.width || innerW);
    const sourceHeight = Number(sourceMeta.height || innerH);
    const alphaBox = await getAlphaBoundingBox(removed);
    const cropBox = {
      left: Math.max(0, Math.min(sourceWidth - 1, alphaBox.x)),
      top: Math.max(0, Math.min(sourceHeight - 1, alphaBox.y)),
      width: Math.max(1, Math.min(sourceWidth, alphaBox.width || sourceWidth)),
      height: Math.max(1, Math.min(sourceHeight, alphaBox.height || sourceHeight))
    };
    const placement = computePassportPlacement(cropBox.width, cropBox.height, innerW, innerH, headTargetPct);

    const foregroundSource = await sharp(removed)
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

    const left = margin + placement.left;
    const top = margin + placement.top;

    let output = sharp({
      create: {
        width: targetW,
        height: targetH,
        channels: 4,
        background: "#ffffff"
      }
    }).composite([
      { input: innerBg, left: margin, top: margin },
      { input: foreground, left, top }
    ]);

    if (outFormat === "jpg") {
      output = output.jpeg({ quality: 92, mozjpeg: true, progressive: true });
      res.setHeader("Content-Type", "image/jpeg");
    } else {
      output = output.png();
      res.setHeader("Content-Type", "image/png");
    }

    await incrementUsage(user, 1);
    return res.status(200).send(await output.toBuffer());
  } catch (error) {
    const status = Number(error.status) || 502;
    console.error("[process-passport] failed:", error.message);
    return res.status(status).json({ error: "Passport processing failed.", details: error.message });
  }
});

router.post("/passport/print-pdf", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "Passport image file is required." });
    }

    const copies = clampNumber(req.body.copies, 4, 8, 4);
    if (![4, 6, 8].includes(copies)) {
      return res.status(400).json({ error: "Supported copy count is 4, 6, or 8." });
    }

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]);
    const imageMime = String(req.file.mimetype || "").toLowerCase();
    const img = imageMime.includes("jpeg") || imageMime.includes("jpg")
      ? await pdf.embedJpg(req.file.buffer)
      : await pdf.embedPng(req.file.buffer);

    const pageW = page.getWidth();
    const pageH = page.getHeight();
    const margin = 24;
    const gap = 12;
    const cols = 2;
    const rows = copies === 4 ? 2 : (copies === 6 ? 3 : 4);

    const cellW = (pageW - margin * 2 - gap * (cols - 1)) / cols;
    const cellH = (pageH - margin * 2 - gap * (rows - 1)) / rows;
    const imgRatio = img.width / Math.max(1, img.height);

    let placed = 0;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (placed >= copies) break;
        let drawW = cellW;
        let drawH = drawW / imgRatio;
        if (drawH > cellH) {
          drawH = cellH;
          drawW = drawH * imgRatio;
        }

        const x = margin + c * (cellW + gap) + (cellW - drawW) / 2;
        const yTop = pageH - margin - r * (cellH + gap);
        const y = yTop - drawH - (cellH - drawH) / 2;
        page.drawImage(img, { x, y, width: drawW, height: drawH });
        placed += 1;
      }
    }

    const pdfBytes = await pdf.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="passport-sheet-${copies}.pdf"`);
    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (error) {
    return res.status(500).json({ error: "Failed to generate print PDF.", details: error.message });
  }
});

module.exports = router;


