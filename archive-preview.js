// ===============================================
// 1) ARCHIVE PREVIEW API (FINAL FIXED VERSION)
// ===============================================
app.post("/api/archive-preview", async (req, res) => {
  try {
    const { start_date, end_date } = req.body;

    if (!start_date || !end_date) {
      return res.json({ success: false, error: "Missing dates" });
    }

    // -------------------------------------------
    // PURCHASES
    // -------------------------------------------
    const { data: pur, error: purErr } = await supabase
      .from("purchases")
      .select("barcode, name, qty, purchase_date, is_deleted")
      .gte("purchase_date", start_date)
      .lte("purchase_date", end_date)
      .eq("is_deleted", false);

    if (purErr) return res.json({ success: false, error: purErr.message });

    // -------------------------------------------
    // SALES
    // -------------------------------------------
    const { data: sal, error: salErr } = await supabase
      .from("sales")
      .select("barcode, name, qty, sale_date, is_deleted")
      .gte("sale_date", start_date)
      .lte("sale_date", end_date)
      .eq("is_deleted", false);

    if (salErr) return res.json({ success: false, error: salErr.message });

    // -------------------------------------------
    // SALE RETURNS
    // -------------------------------------------
    const { data: ret, error: retErr } = await supabase
      .from("sale_returns")
      .select("barcode, name, return_qty, created_at")
      .gte("created_at", start_date)
      .lte("created_at", end_date + "T23:59:59");

    if (retErr) return res.json({ success: false, error: retErr.message });

    // -------------------------------------------
    // SUMMARY MAP
    // -------------------------------------------
    const map = new Map();

    function ensure(barcode, name) {
      if (!map.has(barcode)) {
        map.set(barcode, {
          barcode,
          name: name || "",
          purchase_qty: 0,
          sale_qty: 0,
          return_qty: 0,
        });
      }
      return map.get(barcode);
    }

    // PURCHASES
    (pur || []).forEach((p) => {
      const row = ensure(p.barcode, p.name);
      row.purchase_qty += Number(p.qty || 0);
    });

    // SALES
    (sal || []).forEach((s) => {
      const row = ensure(s.barcode, s.name);
      row.sale_qty += Number(s.qty || 0);
    });

    // RETURNS
    (ret || []).forEach((r) => {
      const row = ensure(r.barcode, r.name);
      row.return_qty += Number(r.return_qty || 0);
    });

    // FINAL SORTED RESULT
    const rows = Array.from(map.values()).sort((a, b) =>
      String(a.barcode).localeCompare(String(b.barcode))
    );

    return res.json({ success: true, rows });
  } catch (err) {
    console.error("archive-preview error:", err);
    return res.json({ success: false, error: err.message });
  }
});
