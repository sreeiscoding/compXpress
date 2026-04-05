const app = require("../server/app");
const { connectDatabase } = require("../server/lib/db");

let dbReadyPromise = null;

async function ensureDatabase() {
  if (!dbReadyPromise) {
    dbReadyPromise = connectDatabase().catch((error) => {
      dbReadyPromise = null;
      throw error;
    });
  }
  return dbReadyPromise;
}

module.exports = async function handler(req, res) {
  try {
    await ensureDatabase();
    return app(req, res);
  } catch (error) {
    return res.status(500).json({
      error: "Failed to initialize API.",
      details: error.message
    });
  }
};
