app.post("/api/archive-transfer", async (req, res) => {
  try {
    const { start_date, end_date, password } = req.body;

    if (password !== "faizanyounus2122")
      return res.json({ success: false, error: "Wrong password" });

    const sql = `
      INSERT INTO archive (barcode, item_name, purchase_qty, sale_qty, return_qty, date, created_at)
      SELECT 
        barcode,
        item_name,
        purchase_qty,
        sale_qty,
        return_qty,
        $1::date,     -- archive date will be the fromDate (or you can use endDate)
        NOW()
      FROM summary_view
      WHERE final_date IS NOT NULL;
    `;

    const result = await pg.query(sql, [start_date]);

    res.json({
      success: true,
      message: "Data transferred to archive!",
      transferred_rows: result.rowCount
    });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});
