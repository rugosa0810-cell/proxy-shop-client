// api/line-webhook.js
// LINE Messaging API Webhook - Vercel Serverless Function
//
// 環境變數需求(Vercel → Settings → Environment Variables):
//   LINE_CHANNEL_ACCESS_TOKEN   → LINE Basic settings 分頁的 Channel access token
//   LINE_CHANNEL_SECRET         → LINE Basic settings 分頁的 Channel secret
//   SUPABASE_URL                → Supabase 專案 URL
//   SUPABASE_SERVICE_ROLE_KEY   → Supabase Settings → API 的 secret / service_role key

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: {
    bodyParser: false,
  },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CUSTOMER_LIFF_URL = "https://liff.line.me/2009872512-JJAaJ7Bi";

// 機器人設定者 —— 只有這個 LINE 用戶 ID 可以下「報價」等管理指令
const OWNER_LINE_USER_ID = "U0b1a787b6b6d9e8320ef96181901028f";
const CONTACT_TEXT = "若持續有問題,請直接留言告訴我們商品名稱和數量,我們會盡快協助您 🙏";

// ── 基礎工具 ──────────────────────────────────────────────
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function verifySignature(rawBody, signature, channelSecret) {
  const hash = crypto.createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  return hash === signature;
}

async function replyMessage(replyToken, messages) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("LINE reply API error:", res.status, errText);
  }
  return res;
}

// 主動推播訊息(不需要 replyToken,用於通知業者/客人)
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

function secureUid() {
  const arr = new Uint8Array(9);
  crypto.randomFillSync(arr);
  return Array.from(arr, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
}

function fmtMoney(n) {
  return `NT$${Number(n || 0).toLocaleString()}`;
}

// 判斷圖片是不是可以放進 Flex Message(必須是 http(s) 網址,base64 不行)
function validImageUrl(url) {
  return typeof url === "string" && /^https?:\/\//.test(url);
}

// ── +1 指令解析 ──────────────────────────────────────────
// 支援:「A1 紅色 M +1」「A1+1」「A1紅色M +1」(有無空格都可以)
function parsePlusOneCommand(text) {
  const m = text.trim().match(/^(.+?)\s*\+(\d{1,3})$/);
  if (!m) return null;
  const qty = parseInt(m[2], 10);
  if (!qty || qty <= 0 || qty > 999) return null;

  const body = m[1].trim();
  let tokens = body.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  // 只有一個詞時,嘗試把「英數字短編號」跟後面黏在一起的文字拆開
  // 例如 "JP080201東京限定2號吊飾娃" → ["JP080201", "東京限定2號吊飾娃"]
  if (tokens.length === 1) {
    const splitMatch = tokens[0].match(/^([A-Za-z0-9]{1,10})([^\sA-Za-z0-9].*)$/);
    if (splitMatch) tokens = [splitMatch[1], splitMatch[2]];
  }

  const [productToken, ...specTokens] = tokens;
  return { productToken, specTokens, fullProductText: body, qty };
}

// ── 找商品 / 找款式 ───────────────────────────────────────
async function findProduct(productToken, fullProductText) {
  const { data: byCode } = await supabase
    .from("products")
    .select("*")
    .ilike("short_code", productToken)
    .eq("status", "on")
    .maybeSingle();
  if (byCode) return byCode;

  const { data: byName } = await supabase
    .from("products")
    .select("*")
    .ilike("name", `%${fullProductText}%`)
    .eq("status", "on")
    .limit(5);
  if (byName && byName.length === 1) return byName[0];
  if (byName && byName.length > 1) return { _ambiguous: true, candidates: byName };

  return null;
}

function findVariant(product, specTokens) {
  const variants = product.variants || [];
  if (variants.length === 0) return { variant: null, needsSpec: false };
  if (variants.length === 1) return { variant: variants[0], needsSpec: false };

  if (specTokens.length === 0) {
    return { variant: null, needsSpec: true, options: variants };
  }
  const specText = specTokens.join(" ").replace(/\s+/g, "");
  const matched = variants.filter((v) => String(v.name).replace(/\s+/g, "").includes(specText));
  if (matched.length === 1) return { variant: matched[0], needsSpec: false };
  return { variant: null, needsSpec: true, options: variants };
}

// ── Flex Message 產生器 ───────────────────────────────────

// 1. 款式選擇卡片:每個款式一顆按鈕,點了直接送出對應指令
function buildVariantSelectFlex(product, options) {
  const buttons = options.slice(0, 11).map((v) => ({
    type: "button",
    style: "secondary",
    height: "sm",
    action: {
      type: "message",
      label: `${v.name}(${fmtMoney(v.price)})`.slice(0, 40),
      text: `${product.short_code || product.name} ${v.name} +1`,
    },
  }));

  const bodyContents = [
    { type: "text", text: product.name, weight: "bold", size: "md", wrap: true },
    { type: "text", text: "請選擇款式:", size: "sm", color: "#888888", margin: "sm" },
  ];

  const bubble = {
    type: "bubble",
    body: { type: "box", layout: "vertical", spacing: "md", contents: bodyContents },
    footer: { type: "box", layout: "vertical", spacing: "sm", contents: buttons },
  };

  if (validImageUrl(product.image)) {
    bubble.hero = { type: "image", url: product.image, size: "full", aspectRatio: "20:13", aspectMode: "cover" };
  }

  return {
    type: "flex",
    altText: `請選擇「${product.name}」的款式`,
    contents: bubble,
  };
}

// 2. 多個候選商品卡片(carousel)
function buildProductAmbiguousFlex(candidates) {
  const bubbles = candidates.slice(0, 10).map((p) => {
    const prices = (p.variants || []).map((v) => Number(v.price) || 0).filter((x) => x > 0);
    const minP = prices.length ? Math.min(...prices) : 0;
    const maxP = prices.length ? Math.max(...prices) : 0;
    const priceLabel = prices.length === 0 ? "" : minP === maxP ? fmtMoney(minP) : `${fmtMoney(minP)} ~ ${fmtMoney(maxP)}`;

    const bubble = {
      type: "bubble",
      size: "micro",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: p.name, weight: "bold", size: "sm", wrap: true },
          ...(priceLabel ? [{ type: "text", text: priceLabel, size: "xs", color: "#a8847e" }] : []),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            action: { type: "message", label: "選這個 +1", text: `${p.short_code || p.name} +1` },
          },
        ],
      },
    };
    if (validImageUrl(p.image)) {
      bubble.hero = { type: "image", url: p.image, size: "full", aspectRatio: "1:1", aspectMode: "cover" };
    }
    return bubble;
  });

  return {
    type: "flex",
    altText: "找到多個符合的商品,請選擇",
    contents: { type: "carousel", contents: bubbles },
  };
}

// 3. 建單成功卡片
function buildOrderConfirmFlex({ no, itemName, image, qty, total }) {
  const bubble = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        { type: "text", text: "✅ 已建立訂單", weight: "bold", size: "lg", color: "#a8847e" },
        { type: "text", text: `#${no}`, size: "sm", color: "#888888" },
        { type: "separator", margin: "md" },
        { type: "text", text: itemName, weight: "bold", size: "md", wrap: true, margin: "md" },
        {
          type: "box",
          layout: "horizontal",
          margin: "sm",
          contents: [
            { type: "text", text: "數量", size: "sm", color: "#888888" },
            { type: "text", text: `${qty}`, size: "sm", align: "end" },
          ],
        },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: "金額", size: "sm", color: "#888888" },
            { type: "text", text: fmtMoney(total), size: "sm", align: "end", weight: "bold", color: "#a8847e" },
          ],
        },
        { type: "text", text: "我們會盡快為您安排採買,謝謝!", size: "xs", color: "#aaaaaa", wrap: true, margin: "md" },
      ],
    },
  };
  if (validImageUrl(image)) {
    bubble.hero = { type: "image", url: image, size: "full", aspectRatio: "20:13", aspectMode: "cover" };
  }
  return {
    type: "flex",
    altText: `已建立訂單 #${no}`,
    contents: bubble,
  };
}

// 4. 尚未綁定會員卡片
function buildBindMemberFlex() {
  return {
    type: "flex",
    altText: "請先綁定會員資料",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "尚未綁定會員資料 😅", weight: "bold", size: "md", wrap: true },
          { type: "text", text: "請先完成會員綁定才能使用 +1 快速下單", size: "sm", color: "#888888", wrap: true },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "button", style: "primary", action: { type: "uri", label: "前往綁定會員", uri: CUSTOMER_LIFF_URL } },
        ],
      },
    },
  };
}

// 5. 圖片許願建立成功卡片
function buildWishCreatedFlex(imageUrl) {
  const bubble = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        { type: "text", text: "✅ 訂單已建立", weight: "bold", size: "lg", color: "#a8847e" },
        { type: "text", text: "我們會盡快為您報價,報價後會直接更新這筆訂單,不需要再操作", size: "sm", color: "#888888", wrap: true },
      ],
    },
  };
  if (validImageUrl(imageUrl)) {
    bubble.hero = { type: "image", url: imageUrl, size: "full", aspectRatio: "20:13", aspectMode: "cover" };
  }
  return { type: "flex", altText: "訂單已建立", contents: bubble };
}

// 6. 通知業者(Owner)有新的訂單待報價(客人傳圖 +1 直接建立,價格待補)
function buildOwnerNotifyFlex({ customerName, imageUrl }) {
  const bubble = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        { type: "text", text: "📥 新訂單待報價", weight: "bold", size: "lg", color: "#a8847e" },
        { type: "text", text: `客人:${customerName}`, size: "sm", color: "#888888" },
        { type: "separator", margin: "md" },
        { type: "text", text: "回覆「品名+價格」即可完成設定,例如「東京限定娃娃+850」,會直接更新這筆訂單並通知客人", size: "sm", wrap: true, margin: "md" },
      ],
    },
  };
  if (validImageUrl(imageUrl)) {
    bubble.hero = { type: "image", url: imageUrl, size: "full", aspectRatio: "20:13", aspectMode: "cover" };
  }
  return { type: "flex", altText: `新訂單待報價 · ${customerName}`, contents: bubble };
}

// 7. 通知客人:報價完成,點擊即可下單
function buildCustomerOrderFlex({ imageUrl, price, orderNo, itemName }) {
  const myOrdersUrl = `${CUSTOMER_LIFF_URL}`;
  const bubble = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        { type: "text", text: "🎉 訂單已完成報價", weight: "bold", size: "lg", color: "#a8847e" },
        { type: "text", text: itemName || "您的訂單", size: "md", weight: "bold", wrap: true },
        { type: "text", text: `NT$ ${Number(price || 0).toLocaleString()}`, size: "xl", weight: "bold", color: "#a8847e" },
        { type: "text", text: `訂單編號 #${orderNo || ""}`, size: "sm", color: "#888888" },
        { type: "text", text: "訂單已經建立好囉,業者會盡快與您聯繫確認取貨與付款方式,不用再操作", size: "sm", wrap: true, margin: "md" },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "button", style: "primary", action: { type: "uri", label: "查看我的訂單", uri: myOrdersUrl } },
      ],
    },
  };
  if (validImageUrl(imageUrl)) {
    bubble.hero = { type: "image", url: imageUrl, size: "full", aspectRatio: "20:13", aspectMode: "cover" };
  }
  return { type: "flex", altText: "訂單已完成報價", contents: bubble };
}

// 下載 LINE 傳來的圖片(回傳 Buffer)
async function fetchLineImage(messageId) {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`下載圖片失敗:${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ── 處理客人傳圖片:下載後暫存,等待接續的 +1 ──────────────
async function handleImageMessage(event) {
  const lineUserId = event.source.userId;
  try {
    // 若之前已有暫存但客人沒接 +1 就傳新圖 → 先清掉舊的實體檔案,避免佔空間
    const { data: oldPending, error: selErr } = await supabase
      .from("pending_images")
      .select("image_path")
      .eq("line_user_id", lineUserId)
      .maybeSingle();
    if (selErr) throw new Error(`查詢 pending_images 失敗:${selErr.message}`);
    if (oldPending?.image_path) {
      await supabase.storage.from("product-images").remove([oldPending.image_path]).catch(() => {});
    }

    const buffer = await fetchLineImage(event.message.id);
    const fileName = `wish_${Date.now()}_${secureUid()}.jpg`;
    const { error: upErr } = await supabase.storage
      .from("product-images")
      .upload(fileName, buffer, { contentType: "image/jpeg", upsert: false });
    if (upErr) throw upErr;

    const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(fileName);

    const { error: writeErr } = await supabase.from("pending_images").upsert(
      [{ line_user_id: lineUserId, image_url: urlData.publicUrl, image_path: fileName, created_at: new Date().toISOString() }],
      { onConflict: "line_user_id" }
    );
    if (writeErr) throw new Error(`寫入 pending_images 失敗:${writeErr.message}`);
    // 圖片先靜默暫存,不主動回覆,避免干擾;等客人打 +1 才回應
  } catch (err) {
    console.error("處理圖片失敗:", err.message || err);
  }
}

// ── 處理裸「+1」:把剛才暫存的圖片變成許願清單項目 ──────────
const PENDING_IMAGE_TTL_MS = 10 * 60 * 1000; // 10 分鐘內有效

async function handleBarePlusOne(event) {
  const replyToken = event.replyToken;
  const lineUserId = event.source.userId;

  const { data: member } = await supabase
    .from("members")
    .select("*")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (!member) {
    await replyMessage(replyToken, [buildBindMemberFlex()]);
    return;
  }

  // 圖片跟 +1 可能是兩個幾乎同時到的獨立請求,圖片那邊可能還在處理中
  // → 查不到就短暫重試幾次,而不是立刻判定失敗
  let pending = null;
  const RETRY_DELAYS_MS = [400, 700, 1000]; // 共重試 3 次,累積約 2.1 秒
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const { data } = await supabase
      .from("pending_images")
      .select("*")
      .eq("line_user_id", lineUserId)
      .maybeSingle();
    if (data) { pending = data; break; }
    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }

  if (!pending) {
    await replyMessage(replyToken, [
      { type: "text", text: `請先傳一張圖片,再打 +1 快速建立賣場 📷\n\n${CONTACT_TEXT}` },
    ]);
    return;
  }

  const ageMs = Date.now() - new Date(pending.created_at).getTime();
  await supabase.from("pending_images").delete().eq("line_user_id", lineUserId);

  if (ageMs > PENDING_IMAGE_TTL_MS) {
    if (pending.image_path) {
      await supabase.storage.from("product-images").remove([pending.image_path]).catch(() => {});
    }
    await replyMessage(replyToken, [
      { type: "text", text: `圖片已逾時失效(超過 10 分鐘),請重新傳一次圖片再打 +1 📷` },
    ]);
    return;
  }

  const customerName = member.community_name || member.line_name || member.name || "LINE 客人";
  const orderData = {
    id: secureUid(),
    no: String(100000 + Math.floor(Math.random() * 900000)),
    customer_line_id: lineUserId,
    customer_name: customerName,
    status: "pending_review",
    items: [
      {
        name: "待業者命名(LINE 傳圖建立)",
        qty: 1,
        price: 0,
        cost: 0,
        image: pending.image_url,
        payment_type: "full",
        deposit_amount: 0,
        supply_type: "presale",
        product_id: null,
        variant_ids: [],
      },
    ],
    total: 0,
    profit: 0,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("orders").insert([orderData]);

  if (error) {
    console.error("建立訂單失敗:", error);
    await replyMessage(replyToken, [
      { type: "text", text: `建立失敗,請稍後再試一次 🙏\n\n${CONTACT_TEXT}` },
    ]);
    return;
  }

  // 建立「待報價」紀錄,並推播通知業者(機器人設定者)
  try {
    const { error: pqError } = await supabase.from("pending_quotes").insert([
      {
        id: secureUid(),
        order_id: orderData.id,
        customer_line_id: lineUserId,
        customer_name: customerName,
        image_url: pending.image_url,
        quoted: false,
        created_at: new Date().toISOString(),
      },
    ]);
    if (pqError) {
      console.error("寫入 pending_quotes 失敗:", pqError.message || pqError);
    } else {
      await pushMessage(OWNER_LINE_USER_ID, [
        buildOwnerNotifyFlex({ customerName, imageUrl: pending.image_url }),
      ]);
    }
  } catch (err) {
    console.error("通知業者失敗:", err);
  }

  await replyMessage(replyToken, [buildWishCreatedFlex(pending.image_url)]);
}

// ── 業者報價指令:「品名+價格」,例如「東京限定娃娃+850」 ──────────
// 只有 OWNER_LINE_USER_ID 可以下這個指令,依先來後到套用到最舊一筆待報價項目
// 格式:「品名+價格」,例如「東京限定娃娃+850」
// 價格限制至少兩位數(>=10),避免跟客人的「品名+1」下單指令搞混
function parseQuoteCommand(text) {
  const m = text.trim().match(/^(.+?)\+(\d+)$/);
  if (!m) return null;
  const name = m[1].trim();
  if (!name) return null;
  const price = parseInt(m[2], 10);
  if (!price || price < 10) return null;
  return { name, price };
}

async function handleOwnerQuote(event, quote) {
  const replyToken = event.replyToken;

  const { data: pendingQuote } = await supabase
    .from("pending_quotes")
    .select("*")
    .eq("quoted", false)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!pendingQuote) {
    await replyMessage(replyToken, [{ type: "text", text: "目前沒有待報價的訂單 📭" }]);
    return;
  }

  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", pendingQuote.order_id)
    .maybeSingle();

  if (!order) {
    console.error("找不到對應訂單:", pendingQuote.order_id);
    await replyMessage(replyToken, [{ type: "text", text: "找不到對應訂單,可能已被刪除" }]);
    await supabase.from("pending_quotes").update({ quoted: true }).eq("id", pendingQuote.id);
    return;
  }

  const newItems = (order.items || []).map((it, idx) =>
    idx === 0 ? { ...it, name: quote.name, price: quote.price } : it
  );
  const newTotal = newItems.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);

  const { error } = await supabase
    .from("orders")
    .update({ items: newItems, total: newTotal, status: "pending", updated_at: new Date().toISOString() })
    .eq("id", order.id);

  if (error) {
    console.error("報價寫入失敗:", error);
    await replyMessage(replyToken, [{ type: "text", text: `報價失敗:${error.message}` }]);
    return;
  }

  await supabase.from("pending_quotes").update({ quoted: true }).eq("id", pendingQuote.id);

  await replyMessage(replyToken, [
    { type: "text", text: `✅ 已為「${pendingQuote.customer_name}」的訂單報價\n品名:${quote.name}\n價格:NT$${quote.price}\n訂單編號:#${order.no}` },
  ]);

  // 通知客人:訂單已完成報價,不用再操作,直接等業者聯繫
  try {
    await pushMessage(pendingQuote.customer_line_id, [
      buildCustomerOrderFlex({
        imageUrl: pendingQuote.image_url,
        price: quote.price,
        orderNo: order.no,
        itemName: quote.name,
      }),
    ]);
  } catch (err) {
    console.error("通知客人失敗:", err);
  }
}

// ── 主流程:處理 +1 建單 ─────────────────────────────────
async function handlePlusOne(event, cmd) {
  const replyToken = event.replyToken;
  const lineUserId = event.source.userId;


  // 1. 確認客人已綁定會員
  const { data: member } = await supabase
    .from("members")
    .select("*")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (!member) {
    await replyMessage(replyToken, [buildBindMemberFlex()]);
    return;
  }

  // 2. 找商品
  const product = await findProduct(cmd.productToken, cmd.fullProductText);

  if (!product) {
    await replyMessage(replyToken, [
      { type: "text", text: `找不到「${cmd.fullProductText}」這個商品 😅\n請確認商品編號或名稱是否正確。\n\n${CONTACT_TEXT}` },
    ]);
    return;
  }

  if (product._ambiguous) {
    await replyMessage(replyToken, [buildProductAmbiguousFlex(product.candidates)]);
    return;
  }

  // 3. 找款式
  const { variant, needsSpec, options } = findVariant(product, cmd.specTokens);

  if (needsSpec) {
    await replyMessage(replyToken, [buildVariantSelectFlex(product, options)]);
    return;
  }

  const price = Number(variant?.price) || 0;
  const cost = Number(variant?.cost) || 0;
  if (price <= 0) {
    await replyMessage(replyToken, [
      { type: "text", text: `「${product.name}」目前無法建單(價格未設定)。\n\n${CONTACT_TEXT}` },
    ]);
    return;
  }

  // 4. 組建單資料(格式對齊 admin AddOrderModal.save())
  const variantName = variant?.name && variant.name !== product.name ? variant.name : "";
  const fullItemName = [product.name, variantName].filter(Boolean).join(" / ");
  const qty = cmd.qty;

  const items = [
    { name: fullItemName, cost, price, qty, note: "", image: product.image || "" },
  ];
  const total = price * qty;
  const profit = (price - cost) * qty;
  const no = String(100000 + Math.floor(Math.random() * 900000));

  const orderData = {
    id: secureUid(),
    no,
    customer_line_id: lineUserId,
    customer_name: member.community_name || member.line_name || member.name || "LINE 客人",
    status: "pending",
    items,
    total,
    profit,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("orders").insert([orderData]);

  if (error) {
    console.error("建單失敗:", error);
    await replyMessage(replyToken, [
      { type: "text", text: `建單時發生錯誤,請稍後再試一次 🙏\n\n${CONTACT_TEXT}` },
    ]);
    return;
  }

  // 5. 回覆訂單卡片
  await replyMessage(replyToken, [
    buildOrderConfirmFlex({ no, itemName: fullItemName, image: product.image, qty, total }),
  ]);
}

// ── Webhook 進入點 ──────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(200).send("LINE Webhook is alive. Please use POST.");
    return;
  }

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers["x-line-signature"];
    const channelSecret = process.env.LINE_CHANNEL_SECRET;

    if (!signature || !channelSecret) {
      console.error("缺少 signature 或 channelSecret");
      res.status(401).send("Unauthorized");
      return;
    }
    if (!verifySignature(rawBody, signature, channelSecret)) {
      console.error("簽章驗證失敗");
      res.status(401).send("Invalid signature");
      return;
    }

    const body = JSON.parse(rawBody);
    const events = body.events || [];

// ── 客人自助綁定社群名稱:「綁定 小明」 ──────────────────────
function parseBindCommand(text) {
  const m = text.trim().match(/^綁定\s*(.+)$/);
  if (!m) return null;
  const name = m[1].trim();
  if (!name) return null;
  return { name };
}

async function handleBindCommunityName(event, bind) {
  const replyToken = event.replyToken;
  const lineUserId = event.source.userId;

  const { data: member } = await supabase
    .from("members")
    .select("line_user_id, username, community_name")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (!member || !member.username) {
    await replyMessage(replyToken, [buildBindMemberFlex()]);
    return;
  }

  const newName = bind.name.slice(0, 50);
  const { error } = await supabase
    .from("members")
    .update({ community_name: newName })
    .eq("line_user_id", lineUserId);

  if (error) {
    console.error("綁定社群名稱失敗:", error);
    await replyMessage(replyToken, [
      { type: "text", text: `更新失敗,請稍後再試 🙏\n\n${CONTACT_TEXT}` },
    ]);
    return;
  }

  await replyMessage(replyToken, [
    { type: "text", text: `✅ 社群名稱已更新為「${newName}」` },
  ]);
}

    for (const event of events) {
      if (event.type !== "message") continue;

      // 圖片訊息:先暫存,等待接續的 +1
      if (event.message.type === "image") {
        try {
          await handleImageMessage(event);
        } catch (err) {
          console.error("handleImageMessage 錯誤:", err);
        }
        continue;
      }

      if (event.message.type !== "text") continue;

      const userText = event.message.text;
      const replyToken = event.replyToken;
      const trimmed = userText.trim();

      // 業者(機器人設定者)下報價指令 —— 只有 OWNER_LINE_USER_ID 才會被處理
      if (event.source.userId === OWNER_LINE_USER_ID) {
        const quote = parseQuoteCommand(trimmed);
        if (quote) {
          try {
            await handleOwnerQuote(event, quote);
          } catch (err) {
            console.error("handleOwnerQuote 錯誤:", err);
            await replyMessage(replyToken, [{ type: "text", text: "報價處理時發生錯誤,請稍後再試" }]);
          }
          continue;
        }
      }

      // 客人自助綁定/修改社群名稱 —— 「綁定 小明」
      const bind = parseBindCommand(trimmed);
      if (bind) {
        try {
          await handleBindCommunityName(event, bind);
        } catch (err) {
          console.error("handleBindCommunityName 錯誤:", err);
          await replyMessage(replyToken, [{ type: "text", text: "處理時發生錯誤,請稍後再試" }]);
        }
        continue;
      }

      // 裸 +1(前面沒帶商品名稱/編號)→ 檢查是否有剛傳的圖片,建立許願清單
      if (trimmed === "+1") {
        try {
          await handleBarePlusOne(event);
        } catch (err) {
          console.error("handleBarePlusOne 錯誤:", err);
          await replyMessage(replyToken, [
            { type: "text", text: `處理時發生錯誤,請稍後再試 🙏\n\n${CONTACT_TEXT}` },
          ]);
        }
        continue;
      }

      const cmd = parsePlusOneCommand(userText);

      if (cmd) {
        try {
          await handlePlusOne(event, cmd);
        } catch (err) {
          console.error("handlePlusOne 錯誤:", err);
          await replyMessage(replyToken, [
            { type: "text", text: `處理訂單時發生錯誤,請稍後再試 🙏\n\n${CONTACT_TEXT}` },
          ]);
        }
      }
      // 非 +1 建單指令 → Bot 不回應,交由業者人工回覆(避免每句話都被 Bot 洗版)
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook 處理錯誤:", err);
    res.status(200).json({ ok: false, error: String(err) });
  }
}
