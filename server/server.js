require("dotenv").config();

const { connectDatabase } = require("./lib/db");
const app = require("./app");

const PORT = Number(process.env.PORT || 4000);

async function start() {
  try {
    await connectDatabase();
    console.log("MongoDB connected.");
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

start();
