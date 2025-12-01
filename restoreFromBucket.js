const supabase = require("./db");
const fs = require("fs");
const path = require("path");
const os = require("os");
const unzipper = require("unzipper");

const TABLES = ["sales", "purchases", "items", "customers", "app_users", "sale_returns"];

// ============================================
// MAIN FUNCTION
// ============================================
module.exports = async function restoreFromBucket({ body }) {
  try {
    const { password, fileName, mode, table } = body;

    // ---- Password Check ----
    if (password !== "faizanyounus") {
      return { success: false, error: "Invalid password" };
    }

    if (!fileName) {
      return { success: false, error: "Missing file name" };
    }

    const BUCKET = "backups";

    // ---- DOWNLOAD FILE ----
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .download(fileName);

    if (error || !data) {
      return { success: false, error: "Cannot download backup file" };
    }

    // ---- CONVERT BUFFER ----
    const buffer =
      typeof data.arrayBuffer === "function"
        ? Buffer.from(await data.arrayBuffer())
        : Buffer.from(data);

    const tmp = os.tmpdir();
    const zipPath = path.join(tmp, fileName);

    fs.writeFileSync(zipPath, buffer);

    // ---- EXTRACT ZIP ----
    const extractPath = path.join(tmp, "restore_" + Date.now());
    fs.mkdirSync(extractPath, { recursive: true });

    await fs
      .createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: extractPath }))
      .promise();

    // ---- FULL RESTORE ----
    if (mode === "full") {
      for (const tbl of TABLES) {
        const file = path.join(extractPath, `${tbl}.csv`);
        if (fs.existsSync(file)) {
          await restoreTable(tbl, file);
        }
      }
    }

    // ---- SPECIFIC TABLE RESTORE ----
    if (mode === "table") {
      if (!table) {
        return { success: false, error: "Table not provided" };
      }

      const file = path.join(extractPath, `${table}.csv`);
      if (!fs.existsSync(file)) {
        return { success: false, error: "CSV not found in backup" };
      }

      await restoreTable(table, file);
    }

    return { success: true };

  } catch (err) {
    // CRITICAL FIX: return JSON so frontend never crashes
    return { success: false, error: err.message };
  }
};

// ============================================
// RESTORE SPECIFIC TABLE
// ============================================
async function restoreTable(table, filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim().split("\n");
  const header = splitCSV(text[0]);

  const rows = [];

  for (let i = 1; i < text.length; i++) {
    const cols = splitCSV(text[i]);
    const obj = {};

    header.forEach((h, idx) => {
      obj[h] = cols[idx] || null;
    });

    rows.push(obj);
  }

  // Delete all rows
  await supabase.from(table).delete().neq("id", 0);

  // Insert new rows
  if (rows.length > 0) {
    await supabase.from(table).insert(rows);
  }
}

// ============================================
// CSV PARSER
// ============================================
function splitCSV(str) {
  const out = [];
  let current = "";
  let insideQuotes = false;

  for (let ch of str) {
    if (ch === '"' && !insideQuotes) {
      insideQuotes = true;
      continue;
    }
    if (ch === '"' && insideQuotes) {
      insideQuotes = false;
      continue;
    }
    if (ch === "," && !insideQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }

  out.push(current);
  return out;
}