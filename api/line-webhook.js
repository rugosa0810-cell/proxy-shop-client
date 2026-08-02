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

    for (const event of events) {
      if (event.type !== "message" || event.message.type !== "text") continue;

      const userText = event.message.text;
      const replyToken = event.replyToken;
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
      } else {
        await replyMessage(replyToken, [{ type: "text", text: `收到:${userText}` }]);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook 處理錯誤:", err);
    res.status(200).json({ ok: false, error: String(err) });
  }
}
