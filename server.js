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
// SUPER CORS FIX
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
cron.schedule(
  "0 2 * * *",
  () => {
    console.log("⏰ Auto Backup Running...");
    doBackup();
  },
  { timezone: "Asia/Karachi" }
);

// =====================================================================
// SNAPSHOT SYSTEM — LATEST SNAPSHOT + NEW CHANGES
// =====================================================================

// 1️⃣ Get latest snapshot date
async function getLatestSnapshot() {
  const sql = `
    SELECT snap_date
    FROM stock_snapshots
    ORDER BY snap_date DESC
    LIMIT 1;
  `;
  const result = await pg.query(sql);
  if (result.rows.length === 0) return null;
  return result.rows[0].snap_date;
}

// 2️⃣ Get base stock from snapshot
async function getSnapshotBase(date) {
  const sql = `
    SELECT barcode, item_name, stock_qty
    FROM stock_snapshots
    WHERE snap_date = $1;
  `;
  const result = await pg.query(sql, [date]);
  return result.rows;
}

// 3️⃣ Get purchases/sales/returns AFTER snapshot until end_date
async function getChangesAfterSnapshot(snapshotDate, endDate) {
  const sql = `
    SELECT 
      barcode::text AS barcode,
      SUM(purchase_qty) AS purchase_qty,
      SUM(sale_qty) AS sale_qty,
      SUM(return_qty) AS return_qty
    FROM (
      SELECT barcode::text, qty AS purchase_qty, 0 AS sale_qty, 0 AS return_qty
      FROM purchases
      WHERE is_deleted = FALSE 
        AND purchase_date > $1
        AND purchase_date <= $2

      UNION ALL

      SELECT barcode::text, 0, qty, 0
      FROM sales
      WHERE is_deleted = FALSE 
        AND sale_date > $1
        AND sale_date <= $2

      UNION ALL

      SELECT barcode::text, 0, 0, return_qty
      FROM sale_returns
      WHERE created_at::date > $1
        AND created_at::date <= $2
    ) x
    GROUP BY barcode;
  `;
  const result = await pg.query(sql, [snapshotDate, endDate]);
  return result.rows;
}

// =====================================================================
// SNAPSHOT PREVIEW
// =====================================================================
app.post("/api/snapshot-preview", async (req, res) => {
  try {
    const { end_date } = req.body;

    if (!end_date)
      return res.json({ success: false, error: "End date is required" });

    // 1) Find latest snapshot
    const latestSnap = await getLatestSnapshot();
    let baseDate = latestSnap || "1900-01-01";

    // 2) Load snapshot base stock
    const baseRows = latestSnap ? await getSnapshotBase(latestSnap) : [];

    const finalStock = {};

    baseRows.forEach((row) => {
      finalStock[row.barcode] = {
        barcode: row.barcode,
        item_name: row.item_name,
        stock_qty: Number(row.stock_qty),
      };
    });

    // 3) Load changes since snapshot
    const changes = await getChangesAfterSnapshot(baseDate, end_date);

    changes.forEach((row) => {
      if (!finalStock[row.barcode]) {
        finalStock[row.barcode] = {
          barcode: row.barcode,
          item_name: row.item_name,
          stock_qty: 0,
        };
      }

      finalStock[row.barcode].stock_qty +=
        Number(row.purchase_qty || 0) -
        Number(row.sale_qty || 0) +
        Number(row.return_qty || 0);
    });

    // Remove zero stock
    const rows = Object.values(finalStock).filter(
      (r) => Number(r.stock_qty) !== 0
    );

    res.json({ success: true, rows });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// =====================================================================
// SNAPSHOT CREATE (SAVE SNAPSHOT + LOG)
// =====================================================================
app.post("/api/snapshot-create", async (req, res) => {
  try {
    const { start_date, end_date, password } = req.body;

    if (password !== "faizanyounus2122")
      return res.json({ success: false, error: "Wrong password" });

    // First call preview API internally
    const previewRes = await fetch("http://localhost:8000/api/snapshot-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ end_date }),
    });

    const preview = await previewRes.json();

    if (!preview.success) return res.json(preview);

    const rows = preview.rows;

    for (const row of rows) {
      await pg.query(
        `INSERT INTO stock_snapshots (snap_date, barcode, item_name, stock_qty)
         VALUES ($1, $2, $3, $4)`,
        [end_date, row.barcode, row.item_name, row.stock_qty]
      );
    }

    // Save snapshot log
    await pg.query(
      `INSERT INTO snapshot_logs (from_date, to_date, items_inserted)
       VALUES ($1, $2, $3)`,
      [start_date, end_date, rows.length]
    );

    res.json({
      success: true,
      message: "Snapshot created successfully!",
      inserted: rows.length,
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// =====================================================================
// SNAPSHOT HISTORY
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
// ARCHIVE SYSTEM (UNCHANGED)
// =====================================================================
app.post("/api/archive-preview", async (req, res) => {
  try {
    const { start_date, end_date } = req.body;

    if (!start_date || !
end_date)
      return res.json({ success: false, error: "Missing dates" });

    const sql = `
      SELECT 
        barcode::text AS barcode,
        item_name,
        SUM(purchase_qty) AS purchase_qty,
        SUM(sale_qty) AS sale_qty,
        SUM(return_qty) AS return_qty
      FROM (
        SELECT barcode::text, item_name, qty AS purchase_qty, 0 AS sale_qty, 0 AS return_qty
        FROM purchases
        WHERE is_deleted = FALSE 
          AND purchase_date BETWEEN $1 AND $2

        UNION ALL

        SELECT barcode::text, item_name, 0, qty, 0
        FROM sales
        WHERE is_deleted = FALSE 
          AND sale_date BETWEEN $1 AND $2

        UNION ALL

        SELECT barcode::text, item_name, 0, 0, return_qty
        FROM sale_returns
        WHERE created_at::date BETWEEN $1 AND $2
      ) t
      GROUP BY barcode, item_name
      ORDER BY barcode;
    `;

    const result = await pg.query(sql, [start_date, end_date]);
    res.json({ success: true, rows: result.rows });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Archive Delete
app.post("/api/archive-delete", async (req, res) => {
  try {
    const { start_date, end_date, password } = req.body;

    if (password !== "faizanyounus2122")
      return res.json({ success: false, error: "Wrong password" });

    await pg.query(
      `DELETE FROM purchases WHERE purchase_date BETWEEN $1 AND $2`,
      [start_date, end_date]
    );

    await pg.query(
      `DELETE FROM sales WHERE sale_date BETWEEN $1 AND $2`,
      [start_date, end_date]
    );

    await pg.query(
      `DELETE FROM sale_returns WHERE created_at::date BETWEEN $1 AND $2`,
      [start_date, end_date]
    );

    res.json({ success: true, message: "Data Deleted Successfully!" });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// =====================================================================
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log("🚀 Server running on port " + PORT));

