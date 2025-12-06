// restore.js
const fs = require("fs");
const path = require("path");
const os = require("os");
const unzipper = require("unzipper");
const supabase = require("./db");

const RESTORE_PASSWORD = "faizanyounus";

module.exports = async function restoreBackup(req, res) {
  try {
    const pass = req.body.password;
    if (pass !== RESTORE_PASSWORD) {
      return res.status(403).json({ ok: false, message: "Wrong password" });
    }

    const file = req.file;
    if (!file) return res.json({ ok: false, message: "No backup file" });

    const zipPath = file.path;
    const outDir = path.join(os.tmpdir(), "restore_" + Date.now());

    fs.mkdirSync(outDir);

    await fs
      .createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: outDir }))
      .promise();

    const TABLES = ["sales", "purchases", "items", "customers", "app_users", "sale_returns", "stock_snapshots", "snapshot_logs"];

    for (const table of TABLES) {
      const csvPath = path.join(outDir, `${table}.csv`);
      if (!fs.existsSync(csvPath)) continue;

      // delete old
      await supabase.from(table).delete().gte("id", 0);

      const raw = fs.readFileSync(csvPath, "utf8").trim().split("\n");

      const headers = raw[0].split(",");
      for (let i = 1; i < raw.length; i++) {
        const cols = raw[i].split(",");
        const obj = {};
        headers.forEach((h, j) => (obj[h] = cols[j]));

        await supabase.from(table).insert(obj);
      }
    }

    return res.json({ ok: true, message: "Restore completed" });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }

};
