// ===============================================
// ARCHIVE BACKUP (ZIP + archive_backups bucket)
// ===============================================
const JSZip = require("jszip");

app.post("/api/archive-backup", async (req, res) => {
  try {
    const { start_date, end_date } = req.body;

    if (!start_date || !end_date)
      return res.json({ success: false, error: "Missing dates" });

    // Fetch data
    const [purchases, sales, returns] = await Promise.all([
      supabase.from("purchases")
        .select("*")
        .gte("purchase_date", start_date)
        .lte("purchase_date", end_date),

      supabase.from("sales")
        .select("*")
        .gte("sale_date", start_date)
        .lte("sale_date", end_date),

      supabase.from("sale_returns")
        .select("*")
        .gte("created_at", start_date)
        .lte("created_at", end_date)
    ]);

    // ZIP file create
    const zip = new JSZip();
    zip.file("purchases.json", JSON.stringify(purchases.data || []));
    zip.file("sales.json", JSON.stringify(sales.data || []));
    zip.file("returns.json", JSON.stringify(returns.data || []));

    const zipData = await zip.generateAsync({ type: "nodebuffer" });

    const fileName = `archive_${start_date}_to_${end_date}.zip`;

    // Upload ZIP to "archive_backups" bucket
    const upload = await supabase.storage
      .from("archive_backups")
      .upload(fileName, zipData, {
        contentType: "application/zip",
        upsert: true,
      });

    if (upload.error) {
      return res.json({ success: false, error: upload.error.message });
    }

    // Send ZIP to PC
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    res.send(zipData);

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});
