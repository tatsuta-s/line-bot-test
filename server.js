import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// 環境変数（Renderで設定する）
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// 署名チェック
function validateSignature(req) {
  const signature = req.headers["x-line-signature"];
  const body = JSON.stringify(req.body);
  const hash = crypto.createHmac("sha256", CHANNEL_SECRET).update(body).digest("base64");
  return signature === hash;
}

// LINEへ返信
async function replyMessage(replyToken, text) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }]
    })
  });
}

// Webhook
app.post("/webhook", async (req, res) => {
  if (!validateSignature(req)) {
    return res.status(403).send("Signature error");
  }

  const events = req.body.events;
  for (const ev of events) {
    if (ev.type === "message" && ev.message.type === "text") {
      const text = ev.message.text;
      let reply = `受け取りました: ${text}`;
      if (text.includes("運転")) reply = "遠用メガネが第一候補です。";
      if (text.includes("PC")) reply = "中近メガネ（室内用）が候補です。";
      if (text.includes("読書")) reply = "近用または近々メガネが候補です。";
      await replyMessage(ev.replyToken, reply);
    }
  }

  res.send("ok");
});

// 動作確認用
app.get("/healthz", (req, res) => res.send("ok"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
