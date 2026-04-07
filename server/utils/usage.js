const User = require("../models/User");

function getCurrentMonthKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getMonthlyFreeLimit() {
  return 10;
}

function normalizeUserUsage(user) {
  const monthKey = getCurrentMonthKey();
  if (!user) {
    return {
      monthKey,
      used: 0,
      limit: getMonthlyFreeLimit(),
      remaining: getMonthlyFreeLimit()
    };
  }

  if (user.usageMonthKey !== monthKey) {
    user.usageMonthKey = monthKey;
    user.usageCount = 0;
  }

  const used = Number(user.usageCount || 0);
  const limit = user.subscribed ? null : getMonthlyFreeLimit();
  const remaining = limit === null ? null : Math.max(0, limit - used);

  return {
    monthKey,
    used,
    limit,
    remaining
  };
}

function getUsageSnapshot(user) {
  const normalized = normalizeUserUsage(user);
  return {
    ...normalized,
    includes: "remove.bg calls"
  };
}

function hasUsageAllowance(user, units = 1) {
  const amount = Math.max(1, Number(units || 1));
  const usage = normalizeUserUsage(user);
  if (usage.limit === null) {
    return { allowed: true, usage };
  }
  const allowed = usage.used + amount <= usage.limit;
  return { allowed, usage };
}

async function incrementUsage(user, units = 1) {
  if (!user) return getUsageSnapshot(null);
  const amount = Math.max(1, Number(units || 1));
  normalizeUserUsage(user);
  user.usageCount = Number(user.usageCount || 0) + amount;
  await user.save();
  return getUsageSnapshot(user);
}

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

module.exports = {
  getCurrentMonthKey,
  getMonthlyFreeLimit,
  normalizeUserUsage,
  getUsageSnapshot,
  hasUsageAllowance,
  incrementUsage,
  resolveUserFromRequest
};
