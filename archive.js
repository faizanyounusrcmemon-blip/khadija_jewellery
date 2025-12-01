// ===================================================
// 1) TRANSFER OLD DATA
// ===================================================
app.post("/api/archive-transfer", async (req, res) => {
  try {
    const { start_date, end_date, password } = req.body;

    if (password !== "faizanyounus2122")
      return res.json({ success: false, error: "Wrong password" });

    // COPY DATA: purchases → purchases_archive
    await supabase.rpc("transfer_purchases", { start_date, end_date });

    // COPY DATA: sales → sales_archive
    await supabase.rpc("transfer_sales", { start_date, end_date });

    // COPY DATA: returns → returns_archive
    await supabase.rpc("transfer_returns", { start_date, end_date });

    res.json({ success: true, message: "Transfer completed." });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});
