const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const authMiddleware = require("../middleware/authMiddleware");
const { removeBackgroundBuffer } = require("../utils/removeBgClient");

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

router.post("/remove-bg", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "Image file is required." });
    }

    const removed = await removeBackgroundBuffer({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype
    });

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
    const targetW = 413;
    const targetH = 531;
    const margin = 24;
    const innerW = targetW - margin * 2;
    const innerH = targetH - margin * 2;

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

    const foreground = await sharp(removed)
      .resize(innerW, innerH, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();

    const output = await sharp({
      create: {
        width: targetW,
        height: targetH,
        channels: 4,
        background: "#ffffff"
      }
    })
      .composite([
        { input: innerBg, left: margin, top: margin },
        { input: foreground, left: margin, top: margin }
      ])
      .png()
      .toBuffer();

    res.setHeader("Content-Type", "image/png");
    return res.status(200).send(output);
  } catch (error) {
    const status = Number(error.status) || 502;
    console.error("[process-passport] failed:", error.message);
    return res.status(status).json({ error: "Passport processing failed.", details: error.message });
  }
});

module.exports = router;


