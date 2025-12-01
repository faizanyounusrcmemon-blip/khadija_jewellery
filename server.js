// ===============================
//   FINAL SERVER.JS (FULL WORKING)
// ===============================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const cron = require("node-cron");

const doBackup = require("./backup");
const listBackups = require("./listBackups");
const restoreFromBucket = require("./restoreFromBucket");

const app = express();
app.use(cors());
app.use(express.json());

const supabase = require("./db");

const upload = multer({ storage: multer.memoryStorage() });

app.get("/", (req, res) => res.json({ ok: true }));

// ---------------------------------------------------
// 1) CREATE BACKUP (ZIP upload)
// ---------------------------------------------------
app.post("/api/backup", async (req, res) => {
  const result = await doBackup();
  res.json(result);
});

// ---------------------------------------------------
// 2) LIST ALL BACKUPS
// ---------------------------------------------------
app.get("/api/list-backups", async (req, res) => {
  const files = await listBackups();
  res.json({ success: true, files });
});

// ---------------------------------------------------
// 3) RESTORE FROM BUCKET
// ---------------------------------------------------
app.post("/api/restore-from-bucket", upload.any(), async (req, res) => {
  try {
    const result = await restoreFromBucket({ body: req.body });
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------
// 4) DOWNLOAD BACKUP FILE
// ---------------------------------------------------
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
  } catch (err) {
    res.status(500).send("Download failed");
  }
});

// ---------------------------------------------------
// 5) DELETE BACKUP (PASSWORD-PROTECTED)
// ---------------------------------------------------
app.post("/api/delete-backup", async (req, res) => {
  try {
    const { fileName, password } = req.body;

    if (!fileName) return res.json({ success: false, error: "Missing file" });
    if (password !== "faizanyounus")
      return res.json({ success: false, error: "Invalid password" });

    const { error } = await supabase.storage
      .from("backups")
      .remove([fileName]);

    if (error)
      return res.json({ success: false, error: error.message });

    return res.json({ success: true });
  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------
// 6) AUTO BACKUP (2 AM DAILY)
// ---------------------------------------------------
cron.schedule(
  "0 2 * * *",
  () => {
    console.log("⏰ Running automatic backup at 2:00 AM PKT...");
    doBackup();
  },
  { timezone: "Asia/Karachi" }
);

// =====================================================
// 7) ARCHIVE PREVIEW (FAST + NO RPC + FIXED)
// =====================================================
app.post("/api/archive-preview", async (req, res) => {
  try {
    const { start_date, end_date } = req.body;

    if (!start_date || !end_date)
      return res.json({ success: false, error: "Missing dates" });

    // ---------- FULL SQL QUERY ----------
    const sql = `
      select 
        item_code,
        item_name,
        sum(purchase_qty) as purchase_qty,
        sum(sale_qty) as sale_qty,
        sum(return_qty) as return_qty
      from (
          select 
              p.item_code,
              p.item_name,
              p.qty as purchase_qty,
              0 as sale_qty,
              0 as return_qty
          from purchases p
          where p.is_deleted = false
            and p.purchase_date between '${start_date}' and '${end_date}'

          union all 

          select 
              s.item_code,
              null as item_name,
              0 as purchase_qty,
              s.qty as sale_qty,
              0 as return_qty
          from sales s
          where s.is_deleted = false
            and s.sale_date between '${start_date}' and '${end_date}'

          union all

          select
              r.item_code,
              null,
              0,
              0,
              r.return_qty
          from sale_returns r
          where r.created_at::date between '${start_date}' and '${end_date}'
      ) t
      group by item_code, item_name
      order by item_code;
    `;

    // ----------- IMPORTANT CHANGE -----------
    // WE RUN SQL DIRECTLY WITHOUT RPC
    const { data, error } = await supabase.query(sql);

    if (error) {
      return res.json({ success: false, error: error.message });
    }

    res.json({ success: true, rows: data });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------


// ===================================================
// 8) ARCHIVE TRANSFER (DATE RANGE)
// ===================================================
app.post("/api/archive-transfer", async (req, res) => {
  try {
    const { start_date, end_date, password } = req.body;

    if (password !== "faizanyounus2122")
      return res.json({ success: false, error: "Wrong password" });

    await supabase.rpc("transfer_purchases", { start_date, end_date });
    await supabase.rpc("transfer_sales", { start_date, end_date });
    await supabase.rpc("transfer_returns", { start_date, end_date });

    res.json({ success: true, message: "Transfer completed." });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ===================================================
// 9) ARCHIVE DELETE (DATE RANGE)
// ===================================================
app.post("/api/archive-delete", async (req, res) => {
  try {
    const { start_date, end_date, password } = req.body;

    if (password !== "faizanyounus2122")
      return res.json({ success: false, error: "Wrong password" });

    await supabase
      .from("purchases")
      .delete()
      .gte("purchase_date", start_date)
      .lte("purchase_date", end_date);

    await supabase
      .from("sales")
      .delete()
      .gte("sale_date", start_date)
      .lte("sale_date", end_date);

    await supabase
      .from("sale_returns")
      .delete()
      .gte("created_at", start_date)
      .lte("created_at", end_date);

    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log("🚀 Server running on port " + PORT)
);