// ===============================================
// 4) ARCHIVE DELETE  (DATE RANGE DELETE)
// ===============================================
app.post("/api/archive-delete", async (req, res) => {
  try {
    const { start_date, end_date, password } = req.body;

    if (password !== "faizanyounus")
      return res.json({ success: false, error: "Wrong password" });

    // DELETE PURCHASES
    await supabase
      .from("purchases")
      .delete()
      .gte("purchase_date", start_date)
      .lte("purchase_date", end_date);

    // DELETE SALES
    await supabase
      .from("sales")
      .delete()
      .gte("sale_date", start_date)
      .lte("sale_date", end_date);

    // DELETE RETURNS
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
