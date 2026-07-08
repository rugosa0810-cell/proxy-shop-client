// Vercel serverless function - 接收 EMap 的 POST 回傳,轉成 GET redirect
export default function handler(req, res) {
  const body = req.body || {};
  const query = req.query || {};

  // 從 POST body 或 GET query 讀取(EMap 通常用 POST)
  const stCode = body.stCode || body.storeid || body.CVSStoreID || query.stCode || query.storeid || query.CVSStoreID || "";
  const stName = body.stName || body.storename || body.CVSStoreName || query.stName || query.storename || query.CVSStoreName || "";
  const stAddr = body.stAddr || body.storeaddress || body.CVSAddress || query.stAddr || query.storeaddress || query.CVSAddress || "";

  // Redirect 回首頁,帶 query string
  const redirectUrl = `/?stCode=${encodeURIComponent(stCode)}&stName=${encodeURIComponent(stName)}&stAddr=${encodeURIComponent(stAddr)}`;

  res.setHeader("Location", redirectUrl);
  res.status(302).end();
}
