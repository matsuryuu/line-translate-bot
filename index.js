// index.js — LINE × OpenAI 翻訳Bot（JA↔ZH-TW, KO→JA+ZH-TW）
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

const lineConfig = {
channelAccessToken: LINE_ACCESS_TOKEN,
channelSecret: LINE_CHANNEL_SECRET,
};
const client = new Client(lineConfig);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ======== ユーティリティ ======== */
function detectLang(s) {
if (!s) return "other";
if (/[가-힣]/.test(s)) return "ko";
if (/[一-龥]/.test(s) && !/[ぁ-ゔァ-ヴー]/.test(s)) return "zhtw";
if (/[ぁ-ゔァ-ヴー]/.test(s)) return "ja";
return "other";
}

async function translateWithOpenAI({ src, from, to }) {
const system = `
あなたは高精度の翻訳エンジンです。出力は訳文のみ。説明や前置きは不要。
専門用語（半導体・フォトレジスト分野など）は文脈に応じてできるだけ原義を保ち、不要な意訳や脚色はしない。
直訳をするのではなく意味を理解してその国の人が分かりやすいように意訳してください。
ただし話の主題となるような情報を増減させないように気をつけて。
`.trim();
const user = `【原文（${from}）】\n${src}\n\n---\n出力言語：${to}\n出力は訳文のみ。`;

const r = await openai.chat.completions.create({
model: "gpt-4o-mini",
temperature: 0.2,
messages: [
{ role: "system", content: system },
{ role: "user", content: user },
],
});
return r.choices[0]?.message?.content?.trim() || "";
}

async function smartTranslate(input) {
const lang = detectLang(input);

if (lang === "ja") {
const zhtw = await translateWithOpenAI({
src: input,
from: "日本語",
to: "繁體中文（台灣華語）",
});
return { mode: "single", text: zhtw };
}

if (lang === "zhtw") {
const ja = await translateWithOpenAI({
src: input,
from: "繁體中文（台灣華語）",
to: "日本語",
});
return { mode: "single", text: ja };
}

if (lang === "ko") {
const [ja, zhtw] = await Promise.all([
translateWithOpenAI({ src: input, from: "한국어", to: "日本語" }),
translateWithOpenAI({
src: input,
from: "한국어",
to: "繁體中文（台灣華語）",
}),
]);
return { mode: "dual", ja, zhtw };
}

return {
mode: "help",
text:
"対応言語は 日本語↔繁體中文（台灣華語）、韓国語→日本語＋繁體中文 です。翻訳したい文を送ってください。",
};
}

/* ======== Express / Webhook ======== */
const app = express();
app.get("/", (_, res) => res.send("LINE Translator running"));
app.post("/webhook", middleware(lineConfig), async (req, res) => {
const events = req.body.events || [];
try {
await Promise.all(events.map(handleEvent));
} catch (e) {
console.error("handleEvent error:", e);
}
res.sendStatus(200);
});

app.listen(PORT, () => console.log(`Server started on ${PORT}`));

/* ======== メイン処理 ======== */
async function handleEvent(event) {
if (
event.source?.type === "user" &&
ALLOWED_USER_ID &&
event.source.userId !== ALLOWED_USER_ID
) {
return;
}

if (event.type !== "message" || event.message.type !== "text") return;

const input = (event.message.text || "").trim();
if (!input) {
return client.replyMessage(event.replyToken, {
type: "text",
text: "翻訳したい文を送ってください。（日本語／台灣華語／韓国語）",
});
}

let result;
try {
result = await smartTranslate(input);
} catch (e) {
console.error(e);
return client.replyMessage(event.replyToken, {
type: "text",
text: "翻訳に失敗しました。もう一度お試しください。",
});
}

if (result.mode === "dual") {
return client.replyMessage(event.replyToken, [
{ type: "text", text: `【日本語】\n${result.ja}` },
{ type: "text", text: `【台灣華語】\n${result.zhtw}` },
]);
}

if (result.mode === "help") {
return client.replyMessage(event.replyToken, { type: "text", text: result.text });
}

return client.replyMessage(event.replyToken, { type: "text", text: result.text });
}
