// ===============================================
// 2) ARCHIVE BACKUP API  (DOWNLOAD + BUCKET UPLOAD)
// ===============================================
const JSZip = require("jszip");

app.post("/api/archive-backup", async (req, res) => {
  try {
    const { start_date, end_date } = req.body;

    if (!start_date || !end_date)
      return res.json({ success: false, error: "Missing dates" });

    // ----------------------------------------------------
    // Fetch records
    // ----------------------------------------------------
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

    // ----------------------------------------------------
    // Create ZIP
    // ----------------------------------------------------
    const zip = new JSZip();
    zip.file("purchases.json", JSON.stringify(purchases.data || []));
    zip.file("sales.json", JSON.stringify(sales.data || []));
    zip.file("returns.json", JSON.stringify(returns.data || []));

    const zipData = await zip.generateAsync({ type: "nodebuffer" });

    // ----------------------------------------------------
    // Upload to Supabase bucket: archive_backups
    // ----------------------------------------------------
    const fileName = `archive_${start_date}_to_${end_date}.zip`;

    await supabase.storage
      .from("archive_backups")
      .upload(fileName, zipData, {
        contentType: "application/zip",
        upsert: true
      });

    // PC download
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    res.send(zipData);

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});
