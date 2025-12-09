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

// Auto backup at 2AM
cron.schedule("0 2 * * *", () => {
  console.log("⏰ Auto Backup Running...");
  doBackup();
}, { timezone: "Asia/Karachi" });


// =====================================================================
// ⭐ NEW — SNAPSHOT SYSTEM WITH BASE SNAPSHOT
// =====================================================================

// NEW Correct SQL (with base snapshot logic)
const STOCK_SNAPSHOT_SQL = `
WITH last_snap AS (
    SELECT MAX(snap_date) AS snap_date
    FROM stock_snapshots
    WHERE snap_date <= $1
),

base AS (
    SELECT 
        i.barcode::text AS barcode,
        i.item_name,
        COALESCE(s.stock_qty, 0) AS base_qty
    FROM items i
    LEFT JOIN stock_snapshots s
      ON s.barcode::text = i.barcode::text
     AND s.snap_date = (SELECT snap_date FROM last_snap)
),

pur AS (
    SELECT barcode::text AS barcode, SUM(qty) AS total_purchase
    FROM purchases, last_snap
    WHERE purchase_date > COALESCE(last_snap.snap_date,'1900-01-01')
      AND purchase_date <= $1
      AND is_deleted = FALSE
    GROUP BY barcode::text
),

sal AS (
    SELECT barcode::text AS barcode, SUM(qty) AS total_sale
    FROM sales, last_snap
    WHERE sale_date > COALESCE(last_snap.snap_date,'1900-01-01')
      AND sale_date <= $1
      AND is_deleted = FALSE
    GROUP BY barcode::text
),

ret AS (
    SELECT barcode::text AS barcode, SUM(return_qty) AS total_return
    FROM sale_returns, last_snap
    WHERE created_at::date > COALESCE(last_snap.snap_date,'1900-01-01')
      AND created_at::date <= $1
    GROUP BY barcode::text
)

SELECT 
    b.barcode,
    b.item_name,
    b.base_qty
      + COALESCE(pur.total_purchase,0)
      - COALESCE(sal.total_sale,0)
      + COALESCE(ret.total_return,0)
    AS stock_qty
FROM base b
LEFT JOIN pur ON pur.barcode = b.barcode
LEFT JOIN sal ON sal.barcode = b.barcode
LEFT JOIN ret ON ret.barcode = b.barcode
`;

// =====================================================================
// SNAPSHOT PREVIEW
// =====================================================================
// =====================================================================
// ⭐ FINAL SNAPSHOT PREVIEW (uses full base snapshot SQL)
// =====================================================================
app.post("/api/snapshot-preview", async (req, res) => {
  try {
    const { end_date } = req.body;

    if (!end_date)
      return res.json({ success: false, error: "End date is required" });

    // run STOCK_SNAPSHOT_SQL (but do NOT insert into table)
    const sql = `
      SELECT 
        q.barcode,
        q.item_name,
        q.stock_qty
      FROM (${STOCK_SNAPSHOT_SQL}) q
      WHERE q.stock_qty <> 0
    `;

    const result = await pg.query(sql, [end_date]);

    res.json({ success: true, rows: result.rows });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});


// =====================================================================
// SNAPSHOT CREATE + LOG
// =====================================================================
app.post("/api/snapshot-create", async (req, res) => {
  try {
    const { start_date, end_date, password } = req.body;

    if (password !== "faizanyounus2122")
      return res.json({ success: false, error: "Wrong password" });

    if (!end_date)
      return res.json({ success: false, error: "End date is required" });

    const sqlInsert = `
      INSERT INTO stock_snapshots (snap_date, barcode, item_name, stock_qty)
      SELECT 
        $1::date AS snap_date,
        q.barcode,
        q.item_name,
        q.stock_qty
      FROM (${STOCK_SNAPSHOT_SQL}) q
      WHERE q.stock_qty <> 0;
    `;

    const result = await pg.query(sqlInsert, [end_date]);

    await pg.query(
      `INSERT INTO snapshot_logs (from_date, to_date, items_inserted)
       VALUES ($1, $2, $3)`,
      [start_date, end_date, result.rowCount]
    );

    res.json({
      success: true,
      message: "Snapshot created!",
      inserted: result.rowCount,
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
// STOCK REPORT (Snapshot + Live Movements)
// =====================================================================
app.get("/api/stock-report", async (req, res) => {
  try {
    // 1) Last Snapshot
    const lastSnapRes = await pg.query(`
      SELECT snap_date 
      FROM stock_snapshots
      ORDER BY snap_date DESC
      LIMIT 1
    `);

    let baseDate = "1900-01-01";
    if (lastSnapRes.rows.length > 0) baseDate = lastSnapRes.rows[0].snap_date;

    // 2) Base stock from snapshot
    const base = await pg.query(`
      SELECT barcode::text, item_name, SUM(stock_qty) AS qty
      FROM stock_snapshots
      WHERE snap_date = $1
      GROUP BY barcode::text, item_name
    `, [baseDate]);

    let map = {};
    base.rows.forEach(r => {
      map[r.barcode] = {
        barcode: r.barcode,
        item_name: r.item_name,
        stock_qty: Number(r.qty)
      };
    });

    // 3) Purchases
    const pur = await pg.query(`
      SELECT barcode::text, SUM(qty) AS qty
      FROM purchases
      WHERE is_deleted = false AND purchase_date > $1
      GROUP BY barcode::text
    `, [baseDate]);

    pur.rows.forEach(r => {
      if (!map[r.barcode]) map[r.barcode] = { barcode: r.barcode, item_name: "", stock_qty: 0 };
      map[r.barcode].stock_qty += Number(r.qty);
    });

    // 4) Sales
    const sal = await pg.query(`
      SELECT barcode::text, SUM(qty) AS qty
      FROM sales
      WHERE is_deleted = false AND sale_date > $1
      GROUP BY barcode::text
    `, [baseDate]);

    sal.rows.forEach(r => {
      if (!map[r.barcode]) map[r.barcode] = { barcode: r.barcode, item_name: "", stock_qty: 0 };
      map[r.barcode].stock_qty -= Number(r.qty);
    });

    // 5) Returns
    const ret = await pg.query(`
      SELECT barcode::text, SUM(return_qty) AS qty
      FROM sale_returns
      WHERE created_at::date > $1
      GROUP BY barcode::text
    `, [baseDate]);

    ret.rows.forEach(r => {
      if (!map[r.barcode]) map[r.barcode] = { barcode: r.barcode, item_name: "", stock_qty: 0 };
      map[r.barcode].stock_qty += Number(r.qty);
    });

    // Filter zero stock
    const final = Object.values(map).filter(r => r.stock_qty !== 0);

    res.json({ success: true, rows: final });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});


// =====================================================================
// ARCHIVE PREVIEW / TRANSFER / DELETE (NO CHANGES)
// =====================================================================

app.post("/api/archive-preview", async (req, res) => {
  try {
    const { start_date, end_date } = req.body;

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
const PORT = process.env.PORT || 5000;

