app.post("/api/archive-transfer", async (req, res) => {
  try {
    const { start_date, end_date, password } = req.body;

    if (password !== "faizanyounus2122")
      return res.json({ success: false, error: "Wrong password" });

    // -----------------------------
    // 1) PURCHASES
    // -----------------------------
    const purchases = await pg.query(`
      SELECT barcode, item_name, SUM(qty) AS purchase_qty
      FROM purchases
      WHERE is_deleted = FALSE
      AND purchase_date BETWEEN $1 AND $2
      GROUP BY barcode, item_name
    `, [start_date, end_date]);

    // -----------------------------
    // 2) SALES
    // -----------------------------
    const sales = await pg.query(`
      SELECT barcode, item_name, SUM(qty) AS sale_qty
      FROM sales
      WHERE is_deleted = FALSE
      AND sale_date BETWEEN $1 AND $2
      GROUP BY barcode, item_name
    `, [start_date, end_date]);

    // -----------------------------
    // 3) RETURNS
    // -----------------------------
    const returns = await pg.query(`
      SELECT barcode, item_name, SUM(return_qty) AS return_qty
      FROM sale_returns
      WHERE created_at::date BETWEEN $1 AND $2
      GROUP BY barcode, item_name
    `, [start_date, end_date]);

    // -----------------------------
    // 4) Merge Data
    // -----------------------------
    const map = new Map();

    function add(barcode, item, p = 0, s = 0, r = 0) {
      if (!map.has(barcode)) {
        map.set(barcode, { barcode, item_name: item, purchase_qty: 0, sale_qty: 0, return_qty: 0 });
      }
      const row = map.get(barcode);
      row.purchase_qty += Number(p);
      row.sale_qty += Number(s);
      row.return_qty += Number(r);
    }

    purchases.rows.forEach(x => add(x.barcode, x.item_name, x.purchase_qty, 0, 0));
    sales.rows.forEach(x => add(x.barcode, x.item_name, 0, x.sale_qty, 0));
    returns.rows.forEach(x => add(x.barcode, x.item_name, 0, 0, x.return_qty));

    const rows = [...map.values()];

    // -----------------------------
    // 5) Insert into ARCHIVE
    // -----------------------------
    for (const row of rows) {
      await pg.query(`
        INSERT INTO archive (barcode, item_name, purchase_qty, sale_qty, return_qty, date)
        VALUES ($1, $2, $3, $4, $5, NOW()::date)
      `, [
        row.barcode,
        row.item_name,
        row.purchase_qty,
        row.sale_qty,
        row.return_qty
      ]);
    }

    res.json({ success: true, message: "Archive Transfer Successful!" });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});
