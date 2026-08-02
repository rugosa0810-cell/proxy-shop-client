// api/line-webhook.js
// LINE Messaging API Webhook - Vercel Serverless Function
//
// 環境變數需求(在 Vercel 專案設定 → Environment Variables 新增):
//   LINE_CHANNEL_ACCESS_TOKEN   → LINE Developers Console 取得的 Channel access token
//   LINE_CHANNEL_SECRET         → LINE Developers Console 取得的 Channel secret

import crypto from "crypto";

// Vercel 預設會自動 parse JSON body,但驗證簽章需要「原始 raw body」字串,
// 所以這裡關掉自動 parse,自己讀 raw body。
export const config = {
  api: {
    bodyParser: false,
  },
};

// 讀取 raw body(因為關掉了 bodyParser)
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// 驗證 X-Line-Signature
function verifySignature(rawBody, signature, channelSecret) {
  const hash = crypto
    .createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");
  return hash === signature;
}

// 呼叫 LINE Reply API 回覆訊息
async function replyMessage(replyToken, messages) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("LINE reply API error:", res.status, errText);
  }
  return res;
}

export default async function handler(req, res) {
  // LINE 只會用 POST 呼叫 Webhook
  if (req.method !== "POST") {
    res.status(200).send("LINE Webhook is alive. Please use POST.");
    return;
  }

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers["x-line-signature"];
    const channelSecret = process.env.LINE_CHANNEL_SECRET;

    // 1. 驗證簽章
    if (!signature || !channelSecret) {
      console.error("缺少 signature 或 channelSecret");
      res.status(401).send("Unauthorized");
      return;
    }

    const isValid = verifySignature(rawBody, signature, channelSecret);
    if (!isValid) {
      console.error("簽章驗證失敗");
      res.status(401).send("Invalid signature");
      return;
    }

    // 2. 解析事件
    const body = JSON.parse(rawBody);
    const events = body.events || [];

    // 3. 逐一處理事件(先做最簡單的文字訊息回覆)
    for (const event of events) {
      // 只處理「收到文字訊息」這種事件,其他先忽略(例如加好友、貼圖等)
      if (event.type === "message" && event.message.type === "text") {
        const userText = event.message.text;
        const replyToken = event.replyToken;

        // TODO: 未來在這裡擴充邏輯,例如:
        //   - userText === "+1" → 自動建單
        //   - userText.startsWith("採購") → 查詢採購統計
        // 目前先簡單回覆確認 Bot 有活著

        await replyMessage(replyToken, [
          {
            type: "text",
            text: `收到:${userText}`,
          },
        ]);
      }
      // 其他事件類型(follow / unfollow / postback 等)之後再擴充
    }

    // LINE 規定 Webhook 必須回 200,否則 LINE 會判定失敗並重試
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook 處理錯誤:", err);
    // 即使出錯,也盡量回 200,避免 LINE 一直重送同一筆造成混亂(除非是簽章錯誤)
    res.status(200).json({ ok: false, error: String(err) });
  }
}
