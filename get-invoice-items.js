import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    if (req.method !== "GET")
      return res.status(405).json({ success: false, error: "Method not allowed" });

    const invoice_no = req.query.invoice_no;

    if (!invoice_no)
      return res.status(400).json({ success: false, error: "Invoice number required" });

    // ⭐ FETCH FROM PURCHASES TABLE (NOT SALES)
    const { data, error } = await supabase
      .from("purchases")
      .select("item_code, item_name, qty, barcode, sale_price")
      .eq("invoice_no", invoice_no)
      .eq("is_deleted", false);

    if (error) throw error;

    return res.json({
      success: true,
      items: data || []
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}
