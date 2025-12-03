app.post("/api/archive-transfer", async (req, res) => {
  try {
    const { start_date, end_date, password } = req.body;

    if (password !== "faizanyounus2122")
      return res.json({ success: false, error: "Wrong password" });

    const sql = `
      INSERT INTO archive (barcode, item_name, purchase_qty, sale_qty, return_qty, date, created_at)
      SELECT 
        i.barcode,
        i.item_name,
        COALESCE(p.purchase_qty, 0),
        COALESCE(s.sale_qty, 0),
        COALESCE(r.return_qty, 0),
        GREATEST(
          COALESCE(p.last_purchase, '1900-01-01'),
          COALESCE(s.last_sale, '1900-01-01'),
          COALESCE(r.last_return, '1900-01-01')
        ) AS date,
        NOW()
      FROM items i
      
      LEFT JOIN (
        SELECT 
          barcode,
          SUM(qty) AS purchase_qty,
          MAX(purchase_date) AS last_purchase
        FROM purchases
        WHERE purchase_date BETWEEN $1 AND $2
        GROUP BY barcode
      ) p ON p.barcode = i.barcode

      LEFT JOIN (
        SELECT 
          barcode,
          SUM(qty) AS sale_qty,
          MAX(sale_date) AS last_sale
        FROM sales
        WHERE sale_date BETWEEN $1 AND $2
        GROUP BY barcode
      ) s ON s.barcode = i.barcode

      LEFT JOIN (
        SELECT 
          barcode,
          SUM(return_qty) AS return_qty,
          MAX(created_at::date) AS last_return
        FROM sale_returns
        WHERE created_at::date BETWEEN $1 AND $2
        GROUP BY barcode
      ) r ON r.barcode = i.barcode

      WHERE 
        COALESCE(p.purchase_qty, 0) +
        COALESCE(s.sale_qty, 0) +
        COALESCE(r.return_qty, 0) > 0;
    `;

    const result = await pg.query(sql, [start_date, end_date]);

    res.json({
      success: true,
      message: "Transfer Completed!",
      inserted: result.rowCount
    });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});
