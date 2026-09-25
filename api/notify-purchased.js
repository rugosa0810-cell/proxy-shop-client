// 商品標記「已採買」時,通知客人 —— 由 admin 後台呼叫這支 API
// 放在這裡(不是 admin 前端)的原因:推播 LINE 訊息需要用到 Channel Access Token,
// 這個金鑰只能留在伺服器端,不能讓 admin 網頁的前端程式碼直接拿到。
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function pushMessage(to, messages) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("LINE push API error:", res.status, errText);
  }
  return res;
}

function validImageUrl(url) {
  return typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { orderId } = req.body || {};
    if (!orderId) {
      res.status(400).json({ error: "缺少 orderId" });
      return;
    }

    const { data: order, error } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();

    if (error || !order) {
      res.status(404).json({ error: "找不到訂單" });
      return;
    }

    // 沒有真正的 LINE 用戶(例如臨時客人 temp:xxx)就不推播,靜默略過
    if (!order.customer_line_id || order.customer_line_id.startsWith("temp:")) {
      res.status(200).json({ ok: true, skipped: "非 LINE 客人,略過推播" });
      return;
    }

    const purchasedItems = (order.items || []).filter(it => it.purchased);
    const itemsToShow = purchasedItems.length > 0 ? purchasedItems : (order.items || []);
    const itemsText = itemsToShow.map(it => `${it.name} × ${it.qty || 1}`).join("\n") || "-";

    const bubble = {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "✅ 商品已買到", weight: "bold", size: "lg", color: "#a8847e" },
          { type: "text", text: `${order.customer_name || "您"} 好~`, size: "sm", color: "#888888" },
          { type: "separator", margin: "md" },
          { type: "text", text: "今天幫您買到:", size: "sm", weight: "bold", margin: "md" },
          { type: "text", text: itemsText, size: "sm", wrap: true },
          { type: "separator", margin: "md" },
          { type: "text", text: "商品已成功買到,結帳金額會另外通知您。如需修改數量或資料,請聯繫我們協助處理。", size: "xs", color: "#999999", wrap: true, margin: "md" },
        ],
      },
    };

    const heroImage = itemsToShow[0]?.image;
    if (validImageUrl(heroImage)) {
      bubble.hero = { type: "image", url: heroImage, size: "full", aspectRatio: "20:13", aspectMode: "cover" };
    }

    await pushMessage(order.customer_line_id, [
      { type: "flex", altText: "商品已買到", contents: bubble },
    ]);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("notify-purchased 錯誤:", err);
    res.status(500).json({ error: String(err) });
  }
}
