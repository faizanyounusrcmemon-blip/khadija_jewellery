// ===============================================
// 1) ARCHIVE PREVIEW API (OPTIMIZED VERSION)
// ===============================================
app.post("/api/archive-preview", async (req, res) => {
  try {
    const { start_date, end_date } = req.body;

    if (!start_date || !end_date) {
      return res.json({ success: false, error: "Missing dates" });
    }

    // ------------------------------------------------
    // 1) ITEMS: barcode → item_code, item_name
    // ------------------------------------------------
    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("id, item_code, item_name, barcode");

    if (itemsErr) {
      return res.json({ success: false, error: itemsErr.message });
    }

    // Create barcode lookup map
    const barcodeMap = new Map();
    (items || []).forEach((it) => {
      if (!it.barcode) return;
      const code = it.item_code || it.id;
      barcodeMap.set(String(it.barcode), {
        item_code: String(code),
        item_name: it.item_name || "",
      });
    });

    // ------------------------------------------------
    // 2) PURCHASES
    // ------------------------------------------------
    const { data: pur, error: purErr } = await supabase
      .from("purchases")
      .select("item_code, item_name, qty, purchase_date, is_deleted")
      .gte("purchase_date", start_date)
      .lte("purchase_date", end_date)
      .eq("is_deleted", false);

    if (purErr) {
      return res.json({ success: false, error: purErr.message });
    }

    // ------------------------------------------------
    // 3) SALES
    // ------------------------------------------------
    const { data: sal, error: salErr } = await supabase
      .from("sales")
      .select("item_code, item_name, qty, sale_date, is_deleted")
      .gte("sale_date", start_date)
      .lte("sale_date", end_date)
      .eq("is_deleted", false);

    if (salErr) {
      return res.json({ success: false, error: salErr.message });
    }

    // ------------------------------------------------
    // 4) SALE RETURNS (barcode → item_code)
    // ------------------------------------------------
    const { data: ret, error: retErr } = await supabase
      .from("sale_returns")
      .select("barcode, return_qty, created_at")
      .gte("created_at", start_date)
      .lte("created_at", end_date + "T23:59:59");

    if (retErr) {
      return res.json({ success: false, error: retErr.message });
    }

    // ------------------------------------------------
    // 5) SUMMARY MAP
    // ------------------------------------------------
    const map = new Map();

    function ensure(code, name) {
      if (!map.has(code)) {
        map.set(code, {
          item_code: code,
          item_name: name || "",
          purchase_qty: 0,
          sale_qty: 0,
          return_qty: 0,
        });
      }
      return map.get(code);
    }

    // Purchases
    (pur || []).forEach((p) => {
      const row = ensure(p.item_code, p.item_name);
      row.purchase_qty += Number(p.qty || 0);
    });

    // Sales
    (sal || []).forEach((s) => {
      const row = ensure(s.item_code, s.item_name);
      row.sale_qty += Number(s.qty || 0);
    });

    // Sale Returns
    (ret || []).forEach((r) => {
      const info = barcodeMap.get(String(r.barcode));
      if (!info) return; // skip unknown items

      const row = ensure(info.item_code, info.item_name);
      row.return_qty += Number(r.return_qty || 0);
    });

    // Final sorted rows
    const rows = Array.from(map.values()).sort((a, b) =>
      a.item_code.localeCompare(b.item_code)
    );

    return res.json({ success: true, rows });
  } catch (err) {
    console.error("archive-preview error:", err);
    return res.json({ success: false, error: err.message });
  }
});