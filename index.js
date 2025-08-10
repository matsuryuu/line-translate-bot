// index.js — LINE × OpenAI 翻訳Bot（軽量・ノーログ）
import express from "express";
import { Client, middleware } from "@line/bot-sdk";
import OpenAI from "openai";

/* ====== 環境変数 ====== */
const {
LINE_ACCESS_TOKEN,
LINE_CHANNEL_SECRET,
OPENAI_API_KEY,
ALLOWED_USER_ID, // 管理者（あなた）の userId
PORT = 10000,
} = process.env;

/* ====== クライアント ====== */
const lineConfig = { channelAccessToken: LINE_ACCESS_TOKEN, channelSecret: LINE_CHANNEL_SECRET };
const client = new Client(lineConfig);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ====== 軽量化パラメータ ====== */
const MODEL = "gpt-4o-mini";
const MAX_TOKENS = 200;
const OPENAI_TIMEOUT_MS = 8000;

/* ====== 文字種判定 ====== */
const reHangul = /[\u3130-\u318F\uAC00-\uD7AF]/; // ハングル
const reKana = /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF]/; // かな・カナ
const reCJK = /[\u4E00-\u9FFF]/; // CJK漢字

function detectMode(text) {
const hasKo = reHangul.test(text);
const hasKana = reKana.test(text);
const hasCJK = reCJK.test(text);

if (hasKo) return "ko2both"; // 韓→日＆繁體字
if (hasKana) return "ja2zhtw"; // 日→繁體字
if (hasCJK && !hasKana && !hasKo) return "zhtw2ja"; // 繁體字→日
return "other2ja"; // その他 → 日
}

/* ====== 管理者がグループ在籍か確認 ====== */
async function isOwnerInThread(source, ownerId) {
try {
if (source?.type === "group") {
await client.getGroupMemberProfile(source.groupId, ownerId);
return true;
}
if (source?.type === "room") {
await client.getRoomMemberProfile(source.roomId, ownerId);
return true;
}
return true; // DM は対象外
} catch {
return false;
}
}

/* ====== OpenAI 翻訳（短い日本語プロンプト＋タイムアウト） ====== */
async function openaiTranslate(text, target) {
// target: "JA" | "ZHTW"
const langName = target === "JA" ? "日本語" : "繁體字";
const prompt = `翻訳のみを出力。説明や原文の繰り返しは不要。専門用語は原義を保ちつつ自然に。情報の増減はしない。
出力言語：${langName}
原文：
"""${text}"""`;

const ac = new AbortController();
const timer = setTimeout(() => ac.abort("timeout"), OPENAI_TIMEOUT_MS);
try {
const r = await openai.chat.completions.create({
model: MODEL,
messages: [{ role: "user", content: prompt }],
temperature: 0.1,
max_tokens: MAX_TOKENS,
}, { signal: ac.signal });
return (r.choices[0]?.message?.content || "").trim();
} finally {
clearTimeout(timer);
}
}

/* ====== Express ====== */
const app = express();

app.get("/", (_req, res) => res.send("LINE Translator running"));

app.post("/webhook", middleware(lineConfig), async (req, res) => {
const events = req.body.events || [];
try {
await Promise.all(events.map(handleEvent));
res.sendStatus(200);
} catch {
res.sendStatus(500);
}
});

/* ====== メイン処理 ====== */
async function handleEvent(event) {
// アクセス制御：DMは管理者のみ、グループ/ルームは管理者在籍時のみ
if (event.source?.type === "user") {
if (ALLOWED_USER_ID && event.source.userId !== ALLOWED_USER_ID) return;
} else if (event.source?.type === "group" || event.source?.type === "room") {
if (ALLOWED_USER_ID) {
const ok = await isOwnerInThread(event.source, ALLOWED_USER_ID);
if (!ok) return;
}
}

if (event.type !== "message" || event.message.type !== "text") return;

const input = (event.message.text || "").trim();
if (!input) {
return client.replyMessage(event.replyToken, {
type: "text",
text: "日本語・繁體字・韓国語の文を送ってください。自動で翻訳します。",
});
}

const mode = detectMode(input);

try {
if (mode === "ko2both") {
const [toJa, toZh] = await Promise.all([
openaiTranslate(input, "JA"),
openaiTranslate(input, "ZHTW"),
]);
const text = `【日本語】\n${toJa}\n\n【繁體字】\n${toZh}`;
return client.replyMessage(event.replyToken, { type: "text", text });
}
if (mode === "ja2zhtw") {
const toZh = await openaiTranslate(input, "ZHTW");
return client.replyMessage(event.replyToken, { type: "text", text: toZh });
}
if (mode === "zhtw2ja") {
const toJa = await openaiTranslate(input, "JA");
return client.replyMessage(event.replyToken, { type: "text", text: toJa });
}
// その他の言語は日本語へ
const toJa = await openaiTranslate(input, "JA");
return client.replyMessage(event.replyToken, { type: "text", text: toJa });
} catch {
return client.replyMessage(event.replyToken, {
type: "text",
text: "翻訳に失敗しました。少し時間をおいて再試行してください。",
});
}
}

app.listen(PORT, () => {});
