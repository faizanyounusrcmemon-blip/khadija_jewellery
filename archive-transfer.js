app.post("/api/archive-transfer", async (req, res) => {
  try {
    const { start_date, end_date, password } = req.body;

    if (password !== "faizanyounus2122")
      return res.json({ success: false, error: "Wrong password" });

    const sql = `
      INSERT INTO archive (
        barcode,
        item_name,
        purchase_qty,
        sale_qty,
        return_qty,
        date,
        created_at
      )
      SELECT 
        barcode::bigint,      -- 🔥 TYPE FIXED (text → bigint)
        item_name,
        purchase_qty,
        sale_qty,
        return_qty,
        final_date,           -- 🔥 date column
        NOW()
      FROM summary_view
      WHERE final_date BETWEEN $1 AND $2;
    `;

    const result = await pg.query(sql, [start_date, end_date]);

    res.json({
      success: true,
      message: "Data transferred to archive!",
      inserted: result.rowCount
    });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});
