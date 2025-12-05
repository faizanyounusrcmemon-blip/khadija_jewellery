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
cron.schedule(
  "0 2 * * *",
  () => {
    console.log("⏰ Auto Backup Running...");
    doBackup();
  },
  { timezone: "Asia/Karachi" }
);

// =====================================================================
// 🔹 STOCK SNAPSHOT SHARED QUERY  (WITH OLD SNAPSHOT AS BASE)
// =====================================================================
//
// 1) last_snap  → آخری snapshot date ≤ $1
// 2) base       → ہر item کا quantity اس last_snap date پر (اگر snapshot نہیں تو 0)
// 3) p / s / r  → صرف اسی last_snap کے بعد والی movement $1 تک
// 4) final      → base_qty + purchases - sales + returns
//
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

  p AS (
    SELECT
      pur.barcode::text AS barcode,
      SUM(pur.qty) AS total_purchase
    FROM purchases pur
    CROSS JOIN last_snap
    WHERE pur.is_deleted = FALSE
      AND pur.purchase_date > COALESCE(last_snap.snap_date, '1900-01-01')
      AND pur.purchase_date <= $1
    GROUP BY pur.barcode::text
  ),

  s AS (
    SELECT
      sal.barcode::text AS barcode,
      SUM(sal.qty) AS total_sale
    FROM sales sal
    CROSS JOIN last_snap
    WHERE sal.is_deleted = FALSE
      AND sal.sale_date > COALESCE(last_snap.snap_date, '1900-01-01')
      AND sal.sale_date <= $1
    GROUP BY sal.barcode::text
  ),

  r AS (
    SELECT
      ret.barcode::text AS barcode,
      SUM(ret.return_qty) AS total_return
    FROM sale_returns ret
    CROSS JOIN last_snap
    WHERE ret.created_at::date > COALESCE(last_snap.snap_date, '1900-01-01')
      AND ret.created_at::date <= $1
    GROUP BY ret.barcode::text
  )

  SELECT
    b.barcode,
    b.item_name,
    b.base_qty
      + COALESCE(p.total_purchase, 0)
      - COALESCE(s.total_sale, 0)
      + COALESCE(r.total_return, 0)
    AS stock_qty
  FROM base b
  LEFT JOIN p ON p.barcode = b.barcode
  LEFT JOIN s ON s.barcode = b.barcode
  LEFT JOIN r ON r.barcode = b.barcode
`;

// =====================================================================
// SNAPSHOT PREVIEW (صرف دیکھنے کیلئے)
// =====================================================================
app.post("/api/snapshot-preview", async (req, res) => {
  try {
    const { end_date } = req.body;

    if (!end_date)
      return res.json({ success: false, error: "End date is required" });

    const result = await pg.query(STOCK_SNAPSHOT_SQL, [end_date]);

    // Zero stock hide کرو
    const rows = result.rows.filter((r) => Number(r.stock_qty) !== 0);

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

    // 1) snapshot rows insert (base snapshot + اس کے بعد کی movement)
    const sqlInsert = `
      INSERT INTO stock_snapshots (snap_date, barcode, item_name, stock_qty)
      SELECT
        $1::date AS snap_date,
        q.barcode,
        q.item_name,
        q.stock_qty
      FROM ( ${STOCK_SNAPSHOT_SQL} ) AS q
      WHERE q.stock_qty <> 0;
    `;

    const insertResult = await pg.query(sqlInsert, [end_date]);

    // 2) snapshot log save
    await pg.query(
      `INSERT INTO snapshot_logs (from_date, to_date, items_inserted)
       VALUES ($1, $2, $3)`,
      [start_date, end_date, insertResult.rowCount]
    );

    res.json({
      success: true,
      message: "Snapshot created!",
      inserted: insertResult.rowCount,
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
// ARCHIVE PREVIEW
// =====================================================================
app.post("/api/archive-preview", async (req, res) => {
  try {
    const { start_date, end_date } = req.body;

    if (!start_date || !end_date)
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

// =====================================================================
// ARCHIVE TRANSFER  (summary_view → archive)
// =====================================================================
app.post("/api/archive-transfer", async (req, res) => {
  try {
    const { start_date, end_date, password } = req.body;

    if (password !== "faizanyounus2122")
      return res.json({ success: false, error: "Wrong password" });

    const sql = `
      INSERT INTO archive (barcode, item_name, purchase_qty, sale_qty, return_qty, created_at)
      SELECT 
        barcode,
        item_name,
        purchase_qty,
        sale_qty,
        return_qty,
        NOW()
      FROM summary_view
      WHERE final_date BETWEEN $1 AND $2;
    `;

    const result = await pg.query(sql, [start_date, end_date]);

    res.json({
      success: true,
      message: "Transfer Completed Successfully!",
      inserted: result.rowCount,
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// =====================================================================
// ARCHIVE DELETE
// =====================================================================
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
