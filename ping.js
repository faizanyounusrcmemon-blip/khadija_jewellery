const { Client } = require("pg");

module.exports = async function pingDatabase() {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query("SELECT 1"); // 🔥 simple ping
    await client.end();

    return { success: true, message: "DB is awake" };
  } catch (err) {
    console.error("❌ DB Ping failed:", err.message);
    return { success: false, error: err.message };
  }
};
