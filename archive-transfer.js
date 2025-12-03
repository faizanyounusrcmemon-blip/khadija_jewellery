app.post("/api/archive-transfer", async (req, res) => {
  try {
    const { start_date, end_date, password } = req.body;

    if (password !== "faizanyounus2122")
      return res.json({ success: false, error: "Wrong password" });

    const sql = `
      INSERT INTO archive (barcode, item_name, purchase_qty, sale_qty, return_qty, created_at)
      SELECT barcode, item_name, purchase_qty, sale_qty, return_qty, NOW()
      FROM summary_view
      WHERE date BETWEEN $1 AND $2;
    `;

    await pg.query(sql, [start_date, end_date]);

    res.json({ success: true, message: "Data transferred to archive!" });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});
