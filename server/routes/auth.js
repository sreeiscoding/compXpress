const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

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
      subscribed: false
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

module.exports = router;
