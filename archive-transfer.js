app.post("/api/archive-transfer", async (req, res) => {
  try {
    const { start_date, end_date, password } = req.body;

    if (password !== "faizanyounus2122")
      return res.json({ success: false, error: "Wrong password" });

    const sql = `
      INSERT INTO archive (barcode, name, purchase_qty, sale_qty, return_qty, date)
      SELECT barcode, name, purchase_qty, sale_qty, return_qty, NOW()::date
      FROM summary_view
      WHERE date BETWEEN $1 AND $2;
    `;

    await pg.query(sql, [start_date, end_date]);

    return res.json({ success: true, message: "Archive transfer completed." });

  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
});
