// index.js — LINE × OpenAI 翻訳Bot（方向を文字種で自動判定）
import express from "express";
import { Client, middleware } from "@line/bot-sdk";
import OpenAI from "openai";

const {
LINE_ACCESS_TOKEN,
LINE_CHANNEL_SECRET,
OPENAI_API_KEY,
ALLOWED_USER_ID, // 個チャ制限（未設定なら誰でもOK）
PORT = 10000,
} = process.env;

const lineConfig = {
channelAccessToken: LINE_ACCESS_TOKEN,
channelSecret: LINE_CHANNEL_SECRET,
};
const client = new Client(lineConfig);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* 文字種判定 */
const reHangul = /[\u3130-\u318F\uAC00-\uD7AF]/; // ハングル
const reHiragana = /[\u3040-\u309F]/; // ひらがな
const reKatakana = /[\u30A0-\u30FF\u31F0-\u31FF]/; // カタカナ
const reCJK = /[\u4E00-\u9FFF]/; // CJK漢字

function detectMode(text) {
const hasHangul = reHangul.test(text);
const hasHiragana = reHiragana.test(text);
const hasKatakana = reKatakana.test(text);
const hasKana = hasHiragana || hasKatakana;
const hasCJK = reCJK.test(text);

if (hasHangul) return "ko2both"; // 韓→日＆繁
if (hasKana) return "ja2zh"; // 日→繁
if (hasCJK) return "zh2ja"; // 華→日（かな無しの漢字文は華語とみなす）
return "unknown";
}

/* OpenAI へ翻訳依頼（★ 指定プロンプト） */
async function translateWithPrompt(text, target) {
// target: "JA" | "ZHTW"
const translationPrompt = `
あなたは高精度の翻訳エンジンです。出力は訳文のみ。説明や前置きは不要。
専門用語（半導体・フォトレジスト分野など）は文脈に応じてできるだけ原義を保ち、不要な意訳や脚色はしない。
直訳をするのではなく意図を理解してその国の人が分かりやすいように意訳してください。
ただし話の主題となるような情報を過増減させないように気をつけて。

出力言語：${target === "JA" ? "日本語" : "台湾華語（繁體中文）"}
原文：
"""${text}"""
`.trim();

const r = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [{ role: "user", content: translationPrompt }],
temperature: 0.2,
});
return r.choices[0]?.message?.content?.trim() || "";
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

// 個別チャットのアクセス制御（必要なときのみ）
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
const [toJa, toZh] = await Promise.all([
translateWithPrompt(input, "JA"),
translateWithPrompt(input, "ZHTW"),
]);
return client.replyMessage(event.replyToken, [
{ type: "text", text: toJa || "（韓→日 翻訳なし）" },
{ type: "text", text: toZh || "（韓→繁 翻訳なし）" },
]);
} else if (mode === "ja2zh") {
const toZh = await translateWithPrompt(input, "ZHTW");
return client.replyMessage(event.replyToken, { type: "text", text: toZh || "（日→繁 翻訳なし）" });
} else if (mode === "zh2ja") {
const toJa = await translateWithPrompt(input, "JA");
return client.replyMessage(event.replyToken, { type: "text", text: toJa || "（繁→日 翻訳なし）" });
} else {
return client.replyMessage(event.replyToken, {
type: "text",
text: "翻訳方向が特定できませんでした。日本語・台湾華語（繁体字）・韓国語のいずれかで入力してください。",
});
}
} catch (err) {
console.error("Translation Error:", err);
return client.replyMessage(event.replyToken, { type: "text", text: "翻訳中にエラーが発生しました。" });
}
}

app.listen(PORT, () => {
console.log(`Server started on ${PORT}`);
});
