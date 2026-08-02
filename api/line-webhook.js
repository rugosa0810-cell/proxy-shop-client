// api/line-webhook.js
// LINE Messaging API Webhook - Vercel Serverless Function
//
// 環境變數需求(Vercel → Settings → Environment Variables):
//   LINE_CHANNEL_ACCESS_TOKEN   → LINE Basic settings 分頁的 Channel access token
//   LINE_CHANNEL_SECRET         → LINE Basic settings 分頁的 Channel secret
//   SUPABASE_URL                → Supabase 專案 URL
//   SUPABASE_SERVICE_ROLE_KEY   → Supabase Settings → API 的 service_role key(不是 anon key!)

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: {
    bodyParser: false,
  },
};

// service role key 繞過 RLS,只能在後端使用
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CUSTOMER_LIFF_URL = "https://liff.line.me/2009872512-JJAaJ7Bi";

// ── 工具函式 ──────────────────────────────────────────────
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

// 跟 admin 後台 secureUid() 一致的 ID 產生器
function secureUid() {
  const arr = new Uint8Array(9);
  crypto.randomFillSync(arr);
  return Array.from(arr, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
}

function fmtMoney(n) {
  return `NT$${Number(n || 0).toLocaleString()}`;
}

// ── +1 指令解析 ──────────────────────────────────────────
// 格式: "A1 紅色 M +1" / "A1 +1" / "白色針織衫 +1"
// 回傳 { productToken, specTokens, qty } 或 null(格式不符)
function parsePlusOneCommand(text) {
  const m = text.trim().match(/^(.+?)\s*\+(\d{1,3})$/);
  if (!m) return null;
  const qty = parseInt(m[2], 10);
  if (!qty || qty <= 0 || qty > 999) return null;
  const tokens = m[1].trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const [productToken, ...specTokens] = tokens;
  return { productToken, specTokens, fullProductText: m[1].trim(), qty };
}

// 找商品:先比對 short_code,比對不到再用名稱模糊比對
async function findProduct(productToken, fullProductText) {
  // 1. 短編號完全比對(不分大小寫)
  const { data: byCode } = await supabase
    .from("products")
    .select("*")
    .ilike("short_code", productToken)
    .eq("status", "on")
    .maybeSingle();
  if (byCode) return byCode;

  // 2. 名稱模糊比對(用完整文字,因為商品名稱可能有空白,例如「白色 針織衫」)
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

// 找款式:用剩下的文字(去掉商品名稱後)去比對 variants[].name
function findVariant(product, specTokens) {
  const variants = product.variants || [];
  if (variants.length === 0) return { variant: null, needsSpec: false };
  if (variants.length === 1) return { variant: variants[0], needsSpec: false };

  if (specTokens.length === 0) {
    return { variant: null, needsSpec: true, options: variants };
  }
  const specText = specTokens.join(" ");
  const matched = variants.filter((v) =>
    String(v.name).replace(/\s+/g, "").includes(specText.replace(/\s+/g, ""))
  );
  if (matched.length === 1) return { variant: matched[0], needsSpec: false };
  return { variant: null, needsSpec: true, options: variants };
}

// 組出款式清單文字(給客人看的錯誤提示)
function buildSpecListText(product, options) {
  const lines = options.map((v) => `・${v.name}(${fmtMoney(v.price)})`);
  return `「${product.name}」有多種款式,請重打一次並註明款式:\n\n${lines.join("\n")}\n\n例如:${product.short_code || product.name} ${options[0].name} +1`;
}

const CONTACT_TEXT = "若持續有問題,請直接留言告訴我們商品名稱和數量,我們會盡快協助您 🙏";

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
    await replyMessage(replyToken, [
      {
        type: "text",
        text: `尚未綁定會員資料,無法直接建單 😅\n請先到會員中心完成綁定:\n${CUSTOMER_LIFF_URL}\n\n${CONTACT_TEXT}`,
      },
    ]);
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
    const names = product.candidates.map((p) => `・${p.short_code || ""} ${p.name}`).join("\n");
    await replyMessage(replyToken, [
      { type: "text", text: `找到多個符合的商品,請用更精確的編號或名稱:\n\n${names}\n\n${CONTACT_TEXT}` },
    ]);
    return;
  }

  // 3. 找款式
  const { variant, needsSpec, options } = findVariant(product, cmd.specTokens);

  if (needsSpec) {
    await replyMessage(replyToken, [
      { type: "text", text: `${buildSpecListText(product, options)}\n\n${CONTACT_TEXT}` },
    ]);
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
    {
      name: fullItemName,
      cost,
      price,
      qty,
      note: "",
      image: product.image || "",
    },
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

  // 5. 回覆確認訊息
  await replyMessage(replyToken, [
    {
      type: "text",
      text: `✅ 已建立訂單 #${no}\n\n${fullItemName}\n數量:${qty}\n金額:${fmtMoney(total)}\n\n我們會盡快為您安排採買,謝謝!`,
    },
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
        // +1 建單指令
        try {
          await handlePlusOne(event, cmd);
        } catch (err) {
          console.error("handlePlusOne 錯誤:", err);
          await replyMessage(replyToken, [
            { type: "text", text: `處理訂單時發生錯誤,請稍後再試 🙏\n\n${CONTACT_TEXT}` },
          ]);
        }
      } else {
        // 非 +1 指令 → 先簡單回覆確認 Bot 活著(未來可擴充其他指令)
        await replyMessage(replyToken, [{ type: "text", text: `收到:${userText}` }]);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook 處理錯誤:", err);
    res.status(200).json({ ok: false, error: String(err) });
  }
}
