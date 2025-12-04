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

// PostgreSQL Connection
const pg = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

pg.connect()
  .then(() => console.log("✅ PostgreSQL connected"))
  .catch((err) => console.error("❌ PG Error:", err));

const app = express();
app.use(cors({ origin: "*" }));
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

// AUTO BACKUP (2 AM)
cron.schedule(
  "0 2 * * *",
  () => {
    console.log("⏰ Auto Backup Running...");
    doBackup();
  },
  { timezone: "Asia/Karachi" }
);

// =====================================================================
// ARCHIVE PREVIEW  (یہ ویسا ہی رہے گا جیسا ابھی چل رہا ہے)
// =====================================================================
app.post("/api/archive-preview", async (req, res) => {
  try {
    const { start_date, end_date } = req.body;

    if (!start_date || !end_date)
      return res.json({ success: false, error: "Missing dates" });

    const sql = `
      SELECT 
        barcode,
        item_name,
        SUM(purchase_qty) AS purchase_qty,
        SUM(sale_qty) AS sale_qty,
        SUM(return_qty) AS return_qty
      FROM (
        SELECT barcode, item_name, qty AS purchase_qty, 0 AS sale_qty, 0 AS return_qty
        FROM purchases
        WHERE is_deleted = FALSE 
          AND purchase_date BETWEEN $1 AND $2

        UNION ALL

        SELECT barcode, item_name, 0, qty, 0
        FROM sales
        WHERE is_deleted = FALSE 
          AND sale_date BETWEEN $1 AND $2

        UNION ALL

        SELECT barcode, item_name, 0, 0, return_qty
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
// ARCHIVE TRANSFER (جو ابھی تمہارا چل رہا ہے) – فی الحال as-is چھوڑ رہے
// =====================================================================
app.post("/api/archive-transfer", async (req, res) => {
  try {
    const { start_date, end_date, password } = req.body;

    if (password !== "faizanyounus2122")
      return res.json({ success: false, error: "Wrong password" });

    const sql = `
      INSERT INTO archive (
        barcode,
        item_name,
        purchase_qty,
        sale_qty,
        return_qty,
        date,
        created_at
      )
      SELECT 
        barcode,
        item_name,
        purchase_qty,
        sale_qty,
        return_qty,
        $1::date,
        NOW()
      FROM (
        SELECT 
          barcode,
          item_name,
          SUM(purchase_qty) AS purchase_qty,
          SUM(sale_qty) AS sale_qty,
          SUM(return_qty) AS return_qty
        FROM (
          SELECT barcode, item_name, qty AS purchase_qty, 0 AS sale_qty, 0 AS return_qty
          FROM purchases
          WHERE is_deleted = FALSE 
            AND purchase_date BETWEEN $1 AND $2

          UNION ALL

          SELECT barcode, item_name, 0, qty, 0
          FROM sales
          WHERE is_deleted = FALSE 
            AND sale_date BETWEEN $1 AND $2

          UNION ALL

          SELECT barcode, item_name, 0, 0, return_qty
          FROM sale_returns
          WHERE created_at::date BETWEEN $1 AND $2
        ) x
        GROUP BY barcode, item_name
      ) y;
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

app.post("/api/snapshot-create", async (req, res) => {
  try {
    const { start_date, end_date, password } = req.body;

    if (password !== "faizanyounus2122")
      return res.json({ success: false, error: "Wrong password" });

    // --- آج کے دن کا stock summary calculate کرو ---
    const sql = `
      SELECT 
        i.barcode::text AS barcode,
        i.item_name,
        COALESCE(p.total_purchase, 0) 
          - COALESCE(s.total_sale, 0)
          - COALESCE(r.total_return, 0)
        AS stock_qty
      FROM items i

      LEFT JOIN (
        SELECT barcode::text AS barcode, SUM(qty) AS total_purchase
        FROM purchases
        WHERE purchase_date <= $2 AND is_deleted = FALSE
        GROUP BY barcode::text
      ) p ON p.barcode = i.barcode::text

      LEFT JOIN (
        SELECT barcode::text AS barcode, SUM(qty) AS total_sale
        FROM sales
        WHERE sale_date <= $2 AND is_deleted = FALSE
        GROUP BY barcode::text
      ) s ON s.barcode = i.barcode::text

      LEFT JOIN (
        SELECT barcode::text AS barcode, SUM(return_qty) AS total_return
        FROM sale_returns
        WHERE created_at::date <= $2
        GROUP BY barcode::text
      ) r ON r.barcode = i.barcode::text
    `;

    const result = await pg.query(sql, [start_date, end_date]);

    // --- Insert snapshot into table ---
    for (const row of result.rows) {
      await pg.query(
        `INSERT INTO stock_snapshots (snap_date, barcode, item_name, stock_qty) 
         VALUES ($1, $2, $3, $4)`,
        [end_date, row.barcode, row.item_name, row.stock_qty]
      );
    }

    res.json({ success: true, message: "Snapshot created!", inserted: result.rowCount });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});



// =====================================================================
// ⭐ NEW: STOCK SNAPSHOT (for reports)  ← یہ نیا حصہ ہے
// =====================================================================
app.post("/api/stock-snapshot", async (req, res) => {
  try {
    let { snap_date, password } = req.body;

    if (password !== "faizanyounus2122")
      return res.json({ success: false, error: "Wrong password" });

    // اگر front-end سے date نہ آئے تو آج کی date لے لو
    if (!snap_date) {
      snap_date = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    }

    // پہلے اس دن کے purane snapshot delete (تاکہ duplicate نہ ہو)
    await pg.query(`DELETE FROM stock_snapshot WHERE snap_date = $1`, [
      snap_date,
    ]);

    const sql = `
      INSERT INTO stock_snapshot (snap_date, barcode, item_name, stock_qty)
      SELECT 
        $1::date AS snap_date,
        barcode,
        item_name,
        SUM(purchase_qty) - SUM(sale_qty) + SUM(return_qty) AS stock_qty
      FROM (
        SELECT barcode, item_name, qty AS purchase_qty, 0::numeric AS sale_qty, 0::numeric AS return_qty
        FROM purchases
        WHERE is_deleted = FALSE 
          AND purchase_date <= $1

        UNION ALL

        SELECT barcode, item_name, 0::numeric, qty, 0::numeric
        FROM sales
        WHERE is_deleted = FALSE 
          AND sale_date <= $1

        UNION ALL

        SELECT barcode, item_name, 0::numeric, 0::numeric, return_qty
        FROM sale_returns
        WHERE created_at::date <= $1
      ) t
      GROUP BY barcode, item_name;
    `;

    const result = await pg.query(sql, [snap_date]);

    res.json({
      success: true,
      message: "Snapshot created!",
      snap_date,
      rows: result.rowCount,
    });
  } catch (err) {
    console.error("snapshot error:", err);
    res.json({ success: false, error: err.message });
  }
});

// =====================================================================
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log("🚀 Server running on port " + PORT));
