// index.js — LINE × OpenAI 翻訳Bot (JA↔ZH-TW, KO↔JA↔ZH-TW)
import express from "express";
import { Client, middleware } from "@line/bot-sdk";
import OpenAI from "openai";

/* ======== 環境変数 ======== */
const {
LINE_ACCESS_TOKEN,
LINE_CHANNEL_SECRET,
OPENAI_API_KEY,
ALLOWED_USER_ID, // 個チャで許可する唯一の userId（未設定なら誰でも可）
PORT = 10000,
} = process.env;

/* ======== LINE & OpenAI クライアント設定 ======== */
const lineConfig = {
channelAccessToken: LINE_ACCESS_TOKEN,
channelSecret: LINE_CHANNEL_SECRET,
};
const client = new Client(lineConfig);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ======== Express アプリ ======== */
const app = express();

// 共通リクエストログ
app.use((req, res, next) => {
console.log(`[REQ] ${new Date().toISOString()} ${req.method} ${req.path}`);
next();
});

// Webhook エンドポイント
app.post("/webhook", middleware(lineConfig), async (req, res) => {
const events = req.body.events || [];
console.log(`[WEBHOOK] events=${events.length}`);
Promise.all(events.map(handleEvent))
.then((result) => res.json(result))
.catch((err) => {
console.error("Webhook Error:", err);
res.status(500).end();
});
});

/* ======== イベント処理 ======== */
async function handleEvent(event) {
console.log(
`[EVENT] type=${event.type} src=${event.source?.type} ` +
`user=${event.source?.userId || "-"} text=${event.message?.text || ""}`
);

// 個別チャットの制限（ALLOWED_USER_ID が設定されている場合）
if (event.source?.type === "user" && ALLOWED_USER_ID && event.source.userId !== ALLOWED_USER_ID) {
console.log("[INFO] Unauthorized user, ignoring message.");
return;
}

// メッセージ以外は無視
if (event.type !== "message" || event.message.type !== "text") {
console.log("[INFO] Non-text message ignored.");
return;
}

const inputText = event.message.text.trim();
if (!inputText) {
console.log("[INFO] Empty text received.");
return;
}

try {
const translationPrompt = `
あなたは高精度の翻訳エンジンです。出力は訳文のみ。説明や前置きは不要。
専門用語（半導体・フォトレジスト分野など）は文脈に応じてできるだけ原義を保ち、不要な意訳や脚色はしない。
直訳をするのではなく意味を理解してその国の人が分かりやすいように意訳してください。
ただし話の主題となるような情報を増減させないように気をつけて。
対応する翻訳方向は以下です：
- 日本語 ↔ 台湾華語（繁体字）
- 韓国語 ↔ 日本語
- 韓国語 ↔ 台湾華語
- 日本語 ↔ 韓国語
入力がこれらの言語のいずれでもない場合は、翻訳せずそのまま返してください。

テキスト: """${inputText}"""
`;

const aiResponse = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [{ role: "user", content: translationPrompt }],
});

const translatedText = aiResponse.choices[0].message.content.trim();
console.log(`[REPLY] ${translatedText}`);

await client.replyMessage(event.replyToken, {
type: "text",
text: translatedText,
});

} catch (error) {
console.error("Translation Error:", error);
await client.replyMessage(event.replyToken, {
type: "text",
text: "翻訳中にエラーが発生しました。",
});
}
}

/* ======== サーバー起動 ======== */
app.listen(PORT, () => {
console.log(`Server is running on port ${PORT}`);
});
