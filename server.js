// server.js（Node.js + Express）
// 必要: 環境変数 LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET
import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// --- ENV ---
const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

// --- utils ---
function sign(body) {
  return crypto.createHmac("sha256", CHANNEL_SECRET).update(body).digest("base64");
}
async function reply(replyToken, messages) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ACCESS_TOKEN}` },
    body: JSON.stringify({ replyToken, messages }),
  });
}
function addFromAge(age) {
  if (!age || age < 40) return 0;
  if (age < 45) return 0.75;
  if (age < 50) return 1.25;
  if (age < 55) return 1.75;
  if (age < 60) return 2.25;
  return 2.5;
}
function demand(cm) {
  return cm ? +(100 / cm).toFixed(2) : 0;
}

// --- domain ---
const TASKS = {
  "運転": { far: 3, mid: 0, near: 0 },
  "PC": { far: 0, mid: 3, near: 1 },
  "読書": { far: 0, mid: 0, near: 3 },
  "スマホ": { far: 0, mid: 0, near: 3 },
  "家事": { far: 0, mid: 2, near: 2 },
  "手芸": { far: 0, mid: 1, near: 3 },
  "散歩/外出": { far: 2, mid: 1, near: 0 },
  "スポーツ": { far: 3, mid: 0, near: 0 },
};
function decide(weights) {
  const { far, mid, near } = weights;
  if (far >= near + mid + 1) return "単焦点（遠用）";
  if (near >= far + mid && near >= 3) return "単焦点（近用）";
  if (far >= 2 && (near >= 2 || mid >= 2)) return "遠近両用（デイリー）";
  if (mid + near >= 3) return near >= mid + 1 ? "近々（デスク）" : "中近（室内）";
  return "遠近両用（デイリー）";
}

// --- webhook ---
app.post("/webhook", async (req, res) => {
  // 署名検証
  const signature = req.headers["x-line-signature"];
  const bodyStr = JSON.stringify(req.body);
  if (sign(bodyStr) !== signature) return res.status(403).end();

  for (const ev of req.body.events || []) {
    if (ev.type !== "message" || ev.message.type !== "text") continue;
    const text = (ev.message.text || "").trim();

    // 0) ヘルプ
    if (/^(ヘルプ|help|？|\?|使い方)$/i.test(text)) {
      await reply(ev.replyToken, [{
        type: "text",
        text:
          "3行で送ると自動診断します。\n" +
          "例：\n運転,PC,スマホ\n48\n40,60\n（行ごとに改行して送ってね）\n" +
          "まずは「診断開始」と送るとボタンが出ます。",
      }]);
      continue;
    }

    // 1) 入口（クイックリプライ表示）
    if (text === "診断" || text === "診断開始") {
      await reply(ev.replyToken, [
        {
          type: "text",
          text: "用途を選んでください（複数OK）→ 次に年齢と距離を送ります",
          quickReply: {
            items: [
              { type: "action", action: { type: "message", label: "運転", text: "運転" } },
              { type: "action", action: { type: "message", label: "PC", text: "PC" } },
              { type: "action", action: { type: "message", label: "読書", text: "読書" } },
              { type: "action", action: { type: "message", label: "スマホ", text: "スマホ" } },
              { type: "action", action: { type: "message", label: "家事", text: "家事" } },
              { type: "action", action: { type: "message", label: "手芸", text: "手芸" } },
              { type: "action", action: { type: "message", label: "散歩/外出", text: "散歩/外出" } },
              { type: "action", action: { type: "message", label: "スポーツ", text: "スポーツ" } },
              { type: "action", action: { type: "message", label: "入力例", text: "運転,PC,スマホ\n48\n40,60" } },
            ],
          },
        },
      ]);
      continue;
    }

    // 2) 3行プロトコルを解析
    // 1行目: 用途（カンマ区切り） 2行目: 年齢 3行目: 手元cm,PCcm
    const lines = text.split(/\n/);
    const picks = (lines[0] || "").split(/[,、]/).map((s) => s.trim()).filter(Boolean);
    const age = parseInt(lines[1]) || 0;
    const [nearCm, pcCm] = (lines[2] || "").split(/[,、]/).map((v) => parseInt(v) || 0);

    // 用途が1つも含まれない＆3行形式でないときはヘルプを返す
    const hasKnownTask = picks.some((p) => TASKS[p]);
    if (!hasKnownTask) {
      await reply(ev.replyToken, [{
        type: "text",
        text: "入力例：\n運転,PC,スマホ\n48\n40,60\n（まずは「診断開始」と送るとボタンが出ます）",
      }]);
      continue;
    }

    // スコア集計
    const w = { far: 0, mid: 0, near: 0 };
    for (const p of picks) {
      const t = TASKS[p];
      if (!t) continue;
      w.far += t.far;
      w.mid += t.mid;
      w.near += t.near;
    }
    const cat = decide(w);
    const addAge = addFromAge(age);
    const dNear = demand(nearCm);
    const dPc = demand(pcCm);

    // 3) Flexメッセージ（カード風の結果）
    const flex = {
      type: "flex",
      altText: `提案：${cat}`,
      contents: {
        type: "bubble",
        header: {
          type: "box",
          layout: "vertical",
          contents: [
            { type: "text", text: "メガネ簡易診断", weight: "bold", size: "sm", color: "#888888" },
            { type: "text", text: `提案：${cat}`, weight: "bold", size: "xl" },
          ],
        },
        body: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            { type: "text", text: "用途スコア", weight: "bold", size: "sm" },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: `遠 ${w.far}`, size: "sm" },
                { type: "text", text: `中 ${w.mid}`, size: "sm" },
                { type: "text", text: `近 ${w.near}`, size: "sm" },
              ],
            },
            { type: "separator", margin: "md" },
            { type: "text", text: "作業距離からの焦点要求", weight: "bold", size: "sm", margin: "md" },
            { type: "text", text: `手元 ${nearCm || "?"}cm ≈ ${dNear || "?"}D`, size: "sm" },
            { type: "text", text: `PC ${pcCm || "?"}cm ≈ ${dPc || "?"}D`, size: "sm" },
            { type: "text", text: `年齢ADD目安：${addAge.toFixed(2)}D`, size: "sm", margin: "sm" },
            { type: "separator", margin: "md" },
            {
              type: "text",
              text: "※最終度数は検眼・装用テストで決定",
              size: "xs",
              color: "#888888",
              wrap: true,
