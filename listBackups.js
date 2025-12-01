const supabase = require("./db");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

module.exports = async function listBackups() {
  const { data, error } = await supabase.storage
    .from("backups")
    .list("", { sortBy: { column: "name", order: "desc" } });

  if (error) {
    return [];
  }

  return data.map((file) => ({
    name: file.name,
    // HERE IS THE FIX 🔥
    date: dayjs.utc(file.created_at).tz("Asia/Karachi").format("MM/DD/YYYY, hh:mm:ss A"),
    size: file.metadata?.size || 0,
  }));
};