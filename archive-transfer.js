// ===============================================
// 3) ARCHIVE TRANSFER  (SUMMARY → opening_stock)
// ===============================================
app.post("/api/archive-transfer", async (req, res) => {
  try {
    const { rows, start_date, end_date } = req.body;

    if (!rows || !Array.isArray(rows) || !start_date || !end_date) {
      return res.json({ success: false, error: "Invalid data" });
    }

    // ہر row سے opening_qty خود calculate کریں
    const batch = rows.map((r) => {
      const purchase_qty = Number(r.purchase_qty || 0);
      const sale_qty = Number(r.sale_qty || 0);
      const return_qty = Number(r.return_qty || 0);

      const opening_qty = purchase_qty - sale_qty + return_qty;

      return {
        item_code: String(r.item_code),
        item_name: r.item_name || "",
        purchase_qty,
        sale_qty,
        return_qty,
        opening_qty,      // ✅ نیا فیلڈ
        start_date,
        end_date,
      };
    });

    const { error } = await supabase.from("opening_stock").insert(batch);

    if (error) {
      return res.json({ success: false, error: error.message });
    }

    return res.json({ success: true });
  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
});
