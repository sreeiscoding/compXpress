const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const { sendPasswordRecoveryEmail } = require("../utils/mailer");

const router = express.Router();

function buildTokenPayload(user) {
  return {
    userId: String(user._id || ""),
    email: user.email,
    name: user.name,
    subscribed: !!user.subscribed
  };
}

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });
}

function hashRecoveryToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function generateRecoveryToken() {
  return crypto.randomBytes(24).toString("hex");
}

router.post("/signup", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email and password are required." });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const existing = await User.findOne({ email }).lean();
    if (existing) {
      return res.status(409).json({ error: "User already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name,
      email,
      passwordHash,
      subscribed: false,
      passwordResetTokenHash: "",
      passwordResetExpiresAt: null
    });

    const token = signToken(buildTokenPayload(user));
    return res.status(201).json({
      message: "Signup successful.",
      token,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        subscribed: user.subscribed
      }
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ error: "User already exists." });
    }
    return res.status(500).json({ error: "Failed to sign up." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const token = signToken(buildTokenPayload(user));
    return res.json({
      message: "Login successful.",
      token,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        subscribed: user.subscribed
      }
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to login." });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.json({
        message: "If an account exists for this email, a recovery message has been sent."
      });
    }

    const recoveryToken = generateRecoveryToken();
    user.passwordResetTokenHash = hashRecoveryToken(recoveryToken);
    user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();

    await sendPasswordRecoveryEmail({
      to: user.email,
      name: user.name,
      token: recoveryToken
    });

    return res.json({
      message: "If an account exists for this email, a recovery message has been sent."
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to process forgot password request." });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const token = String(req.body.token || "").trim();
    const newPassword = String(req.body.newPassword || "");

    if (!email || !token || !newPassword) {
      return res.status(400).json({ error: "Email, token and new password are required." });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const user = await User.findOne({ email });
    if (!user || !user.passwordResetTokenHash || !user.passwordResetExpiresAt) {
      return res.status(400).json({ error: "Invalid or expired reset token." });
    }

    if (new Date(user.passwordResetExpiresAt).getTime() < Date.now()) {
      user.passwordResetTokenHash = "";
      user.passwordResetExpiresAt = null;
      await user.save();
      return res.status(400).json({ error: "Invalid or expired reset token." });
    }

    const incomingTokenHash = hashRecoveryToken(token);
    if (incomingTokenHash !== user.passwordResetTokenHash) {
      return res.status(400).json({ error: "Invalid or expired reset token." });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.passwordResetTokenHash = "";
    user.passwordResetExpiresAt = null;
    await user.save();

    return res.json({ message: "Password reset successful. Please sign in." });
  } catch (error) {
    return res.status(500).json({ error: "Failed to reset password." });
  }
});

module.exports = router;
