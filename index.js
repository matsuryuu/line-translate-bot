// index.js — LINE × OpenAI 翻訳Bot（JA↔ZHTW, KO→JA+ZHTW）
import express from "express";
import { Client, middleware } from "@line/bot-sdk";
import OpenAI from "openai";

const {
LINE_ACCESS_TOKEN,
LINE_CHANNEL_SECRET,
OPENAI_API_KEY,
ALLOWED_USER_ID,
PORT = 10000,
} = process.env;

const lineConfig = {
channelAccessToken: LINE_ACCESS_TOKEN,
channelSecret: LINE_CHANNEL_SECRET,
};
const client = new Client(lineConfig);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* 文字種判定（厳格化） */
const reHangul = /[\u3130-\u318F\uAC00-\uD7AF]/; // ハングル
const reHiragana = /[\u3040-\u309F]/; // ひらがな
const reKatakana = /[\u30A0-\u30FF\u31F0-\u31FF]/; // カタカナ
const reKana = /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF]/;
const reCJK = /[\u4E00-\u9FFF]/; // CJK 漢字（簡体/繁体/日常漢字）

function detectMode(text) {
const hasHangul = reHangul.test(text);
const hasKana = reKana.test(text);
const hasCJK = reCJK.test(text);

if (hasHangul) return "ko2both"; // 韓→（日・繁）
if (hasKana) return "ja2zh"; // 日→繁
if (hasCJK && !hasKana && !hasHangul) return "zh2ja"; // 華→日
return "unknown";
}

/* OpenAI で翻訳（日本語プロンプト） */
async function translateStrict(text, target) {
// target: "JA" | "ZHTW"
const prompt = `
あなたは高精度の翻訳エンジンです。出力は訳文のみ。説明や前置きは不要。
直訳ではなく意図を理解し、その言語の話者に自然で読みやすい文にしてください。
ただし要点となる情報の増減は避けること。
なお専門用語（半導体・フォトレジストなど）は文脈に応じて原義を保ち、不要な意訳や脚色はしない。
出力言語：${target === "JA" ? "日本語" : "台湾華語（繁體中文）"}
原文：
"""${text}"""
`.trim();

const r = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [{ role: "user", content: prompt }],
temperature: 0.2,
});
return (r.choices[0]?.message?.content || "").trim();
}

/* “そのまま返った”ときの救済（再試行） */
async function translateWithRetry(input, target) {
const out1 = await translateStrict(input, target);
// 出力が入力と完全一致/ほぼ一致なら再試行（句読点・空白差を除去して比較）
const norm = s => s.replace(/\s+/g, "").replace(/[。、，．!?！？]/g, "");
if (norm(out1) === norm(input)) {
const out2 = await translateStrict(
input,
target
);
return out2 || out1;
}
return out1;
}

const app = express();

app.use((req, _res, next) => {
console.log(`[REQ] ${new Date().toISOString()} ${req.method} ${req.path}`);
next();
});

app.post("/webhook", middleware(lineConfig), async (req, res) => {
const events = req.body.events || [];
console.log(`[WEBHOOK] events=${events.length}`);
try {
const results = await Promise.all(events.map(handleEvent));
res.json(results);
} catch (e) {
console.error("Webhook Error:", e);
res.status(500).end();
}
});

async function handleEvent(event) {
console.log(
`[EVENT] type=${event.type} src=${event.source?.type} user=${event.source?.userId || "-"} text=${event.message?.text || ""}`
);

if (event.source?.type === "user" && ALLOWED_USER_ID && event.source.userId !== ALLOWED_USER_ID) {
console.log("[INFO] Unauthorized user; ignore.");
return;
}
if (event.type !== "message" || event.message.type !== "text") return;

const input = (event.message.text || "").trim();
if (!input) return;

const mode = detectMode(input);
console.log(`[MODE] ${mode}`);

try {
if (mode === "ko2both") {
const [ja, zh] = await Promise.all([
translateWithRetry(input, "JA"),
translateWithRetry(input, "ZHTW"),
]);
// 1メッセージに集約（見落とし防止）
const text = `【日本語】\n${ja}\n\n【繁体字】\n${zh}`;
return client.replyMessage(event.replyToken, { type: "text", text });
} else if (mode === "ja2zh") {
const zh = await translateWithRetry(input, "ZHTW");
return client.replyMessage(event.replyToken, { type: "text", text: zh });
} else if (mode === "zh2ja") {
const ja = await translateWithRetry(input, "JA");
return client.replyMessage(event.replyToken, { type: "text", text: ja });
} else {
return client.replyMessage(event.replyToken, {
type: "text",
text: "翻訳方向が特定できませんでした。日本語・繁体字・韓国語のいずれかで入力してください。",
});
}
} catch (err) {
console.error("Translation Error:", err);
return client.replyMessage(event.replyToken, { type: "text", text: "翻訳中にエラーが発生しました。" });
}
}

app.listen(PORT, () => console.log(`Server started on ${PORT}`));
