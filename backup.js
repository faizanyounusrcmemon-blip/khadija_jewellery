const fs = require("fs");
const path = require("path");
const os = require("os");
const archiver = require("archiver");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const supabase = require("./db");

module.exports = async function doBackup() {
  try {
    const BUCKET = "backups";

    const timestamp = dayjs().tz("Asia/Karachi").format("YYYY-MM-DD_HH-mm-ss");
    const tmp = os.tmpdir();
    const folder = path.join(tmp, `backup_${timestamp}`);

    fs.mkdirSync(folder, { recursive: true });

    const TABLES = ["sales", "purchases", "items", "customers", "app_users", "sale_returns"];
    const csvFiles = [];

    for (const table of TABLES) {
      const { data, error } = await supabase.from(table).select("*");
      if (error || !data) continue;

      const filePath = path.join(folder, `${table}.csv`);
      const keys = Object.keys(data[0] || {});
      const header = keys.join(",") + "\n";

      const rows = data
        .map((r) => keys.map((k) => JSON.stringify(r[k] ?? "")).join(","))
        .join("\n");

      fs.writeFileSync(filePath, header + rows);
      csvFiles.push(filePath);
    }

    const zipPath = path.join(tmp, `backup_${timestamp}.zip`);

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      output.on("close", resolve);
      archive.on("error", reject);

      archive.pipe(output);
      csvFiles.forEach((f) => archive.file(f, { name: path.basename(f) }));
      archive.finalize();
    });

    const zipData = fs.readFileSync(zipPath);
    await supabase.storage
      .from(BUCKET)
      .upload(`backup_${timestamp}.zip`, zipData, {
        contentType: "application/zip",
        upsert: true
      });

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
};