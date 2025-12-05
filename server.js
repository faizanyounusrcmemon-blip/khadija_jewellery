// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const cron = require("node-cron");

const doBackup = require("./backup");
const listBackups = require("./listBackups");
const restoreFromBucket = require("./restoreFromBucket");
const supabase = require("./db");

const { Client } = require("pg");

// --------------------------------------
// PostgreSQL Connection
// --------------------------------------
const pg = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

pg.connect()
  .then(() => console.log("✅ PostgreSQL connected"))
  .catch((err) => console.error("❌ PG Error:", err));

const app = express();

// =====================================================
// 🔥 SUPER CORS FIX (KOYEB + LOCALHOST)
// =====================================================
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );

  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

app.get("/", (req, res) => res.json({ ok: true }));

// =====================================================================
// BACKUP SYSTEM
// =====================================================================
app.post("/api/backup", async (req, res) => {
  const result = await doBackup();
  res.json(result);
});

app.get("/api/list-backups", async (req, res) => {
  const files = await listBackups();
  res.json({ success: true, files });
});

app.post("/api/restore-from-bucket", upload.any(), async (req, res) => {
  try {
    const result = await restoreFromBucket({ body: req.body });
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Download backup
app.get("/api/download-backup/:name", async (req, res) => {
  try {
    const name = req.params.name;

    const { data, error } = await supabase.storage
      .from("backups")
      .download(name);

    if (error || !data) return res.status(404).send("File not found");

    const buffer = Buffer.from(await data.arrayBuffer());

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);

    res.send(buffer);
  } catch {
    res.status(500).send("Download failed");
  }
});

// Delete backup
app.post("/api/delete-backup", async (req, res) => {
  try {
    const { fileName, password } = req.body;

    if (password !== "faizanyounus")
      return res.json({ success: false, error: "Invalid password" });

    const { error } = await supabase.storage
      .from("backups")
      .remove([fileName]);

    if (error) return res.json({ success: false, error: error.message });

    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Auto backup daily at 2AM
cron.schedule("0 2 * * *", () => {
  console.log("⏰ Auto Backup Running...");
  doBackup();
}, { timezone: "Asia/Karachi" });


// =====================================================================
// STOCK SNAPSHOT SHARED QUERY
// =====================================================================
const STOCK_SNAPSHOT_SQL = `
  SELECT 
    i.barcode::text AS barcode,
    i.item_name,

    COALESCE(p.total_purchase, 0)
      - COALESCE(s.total_sale, 0)
      + COALESCE(r.total_return, 0)
    AS stock_qty

  FROM items i

  LEFT JOIN (
    SELECT barcode::text AS barcode, SUM(qty) AS total_purchase
    FROM purchases
    WHERE is_deleted = FALSE AND purchase_date <= $1
    GROUP BY barcode::text
  ) p ON p.barcode = i.barcode::text

  LEFT JOIN (
    SELECT barcode::text AS barcode, SUM(qty) AS total_sale
    FROM sales
    WHERE is_deleted = FALSE AND sale_date <= $1
    GROUP BY barcode::text
  ) s ON s.barcode = i.barcode::text

  LEFT JOIN (
    SELECT barcode::text AS barcode, SUM(return_qty) AS total_return
    FROM sale_returns
    WHERE created_at::date <= $1
    GROUP BY barcode::text
  ) r ON r.barcode = i.barcode::text
`;


// =====================================================================
// SNAPSHOT PREVIEW
// =====================================================================
app.post("/api/snapshot-preview", async (req, res) => {
  try {
    const { end_date } = req.body;

    if (!end_date)
      return res.json({ success: false, error: "End date is required" });

    const result = await pg.query(STOCK_SNAPSHOT_SQL, [end_date]);

    const rows = result.rows.filter(r => Number(r.stock_qty) !== 0);

    res.json({ success: true, rows });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});


// =====================================================================
// SNAPSHOT CREATE + LOG SAVE
// =====================================================================
app.post("/api/snapshot-create", async (req, res) => {
  try {
    const { start_date, end_date, password } = req.body;

    if (password !== "faizanyounus2122")
      return res.json({ success: false, error: "Wrong password" });

    if (!end_date)
      return res.json({ success: false, error: "End date is required" });

    // Insert snapshot rows
    const sqlInsert = `
      INSERT INTO stock_snapshots (snap_date, barcode, item_name, stock_qty)
      SELECT 
        $1::date AS snap_date,
        q.barcode,
        q.item_name,
        q.stock_qty
      FROM ( ${STOCK_SNAPSHOT_SQL} ) q
      WHERE q.stock_qty <> 0;
    `;

    const result = await pg.query(sqlInsert, [end_date]);

    // ⭐ Save snapshot log
    await pg.query(
      `INSERT INTO snapshot_logs (from_date, to_date, items_inserted)
       VALUES ($1, $2, $3)`,
      [start_date, end_date, result.rowCount]
    );

    res.json({
      success: true,
      message: "Snapshot created!",
      inserted: result.rowCount
    });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});


// =====================================================================
// SNAPSHOT HISTORY REPORT API
// =====================================================================
app.get("/api/snapshot-history", async (req, res) => {
  try {
    const result = await pg.query(`
      SELECT id, from_date, to_date, items_inserted, created_at
      FROM snapshot_logs
      ORDER BY id DESC
    `);

    res.json({ success: true, rows: result.rows });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});


// =====================================================================
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log("🚀 Server running on port " + PORT));
