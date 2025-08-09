// index.js —— LINE × OpenAI 翻訳Bot（JA↔ZH-TW、KO→JA+ZH-TW）
// 仕様：
// ・日本語 → 台湾華語（繁體中文）
// ・台湾華語（繁體中文） → 日本語
// ・韓国語 → 日本語 と 台湾華語 の2通り
// ・軽い意訳OK／情報の削除・追加は極力しない
// ・カラーレジスト分野の用語は台湾向け表現を優先
// ・個チャットは ALLOWED_USER_ID のみ応答／グループは全員応答

import express from "express";
import { Client, middleware } from "@line/bot-sdk";
import OpenAI from "openai";

/* ====== 環境変数（Render の Environment で設定） ======
OPENAI_API_KEY : OpenAIのAPIキー（sk-...）
LINE_ACCESS_TOKEN : LINE チャネルアクセストークン（ロングターム）
LINE_CHANNEL_SECRET : LINE チャネルシークレット
ALLOWED_USER_ID : 個チャットを許可する自分の userId（最初は * でOK。後で置換）
======================================================== */
const {
OPENAI_API_KEY,
LINE_ACCESS_TOKEN,
LINE_CHANNEL_SECRET,
ALLOWED_USER_ID = "*",
PORT = 3000,
} = process.env;

if (!OPENAI_API_KEY || !LINE_ACCESS_TOKEN || !LINE_CHANNEL_SECRET) {
console.error("ENV missing. Please set OPENAI_API_KEY, LINE_ACCESS_TOKEN, LINE_CHANNEL_SECRET.");
process.exit(1);
}

const lineConfig = {
channelAccessToken: LINE_ACCESS_TOKEN,
channelSecret: LINE_CHANNEL_SECRET,
};

const client = new Client(lineConfig);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ============== Express 起動 ============== */
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

/* ============== メイン処理 ============== */
async function handleEvent(event) {
// 個チャットは自分のみ許可
// if (event.source?.type === "user") {
// if (ALLOWED_USER_ID !== "*" && event.source.userId !== ALLOWED_USER_ID) {
// return;
// }
// }
async function handleEvent(event) {
console.log("User ID:", event.source?.userId); // ★ 追加


  
if (event.type !== "message" || event.message.type !== "text") return;

const input = (event.message.text || "").trim();
const result = await smartTranslate(input).catch((e) => {
console.error("smartTranslate error:", e);
return { mode: "single", text: "（翻訳に失敗しました）" };
});

if (result.mode === "dual") {
// 韓国語 → 2通返信
return client.replyMessage(event.replyToken, [
{ type: "text", text: `〔日本語〕\n${result.ja}` },
{ type: "text", text: `〔臺灣華語〕\n${result.zhtw}` },
]);
} else {
// 単一返信（⽇↔臺）
return client.replyMessage(event.replyToken, { type: "text", text: result.text });
}
}

/* ============== 翻訳ロジック ============== */
async function smartTranslate(text) {
const system = [
"You are a professional technical translator.",
"Detect the input language among: Japanese, Traditional Chinese (Taiwan), Korean.",
"Rules:",
"- If input is Japanese → translate to Traditional Chinese (Taiwan).",
"- If input is Traditional Chinese (Taiwan) → translate to Japanese.",
"- If input is Korean → translate to BOTH Japanese and Traditional Chinese (Taiwan).",
"- Slight paraphrase is allowed for naturalness, but DO NOT drop or add information.",
"- Keep numbers, units, chemical names, and product codes exactly.",
"- Prefer Taiwan terms for technical words.",
"Mini glossary (preferred target terms):",
"・カラーレジスト / 彩色光阻 / 컬러레지스트 → 彩色光阻（zh-TW）, カラーレジスト（ja）",
"・複屈折 / 雙折射 / 복굴절 → 雙折射（zh-TW）, 複屈折（ja）",
"・リタデーションRth / 位相差Rth / 리타데이션Rth → 位相差Rth（zh-TW）, リタデーションRth（ja）",
"・PGMEA → PGMEA（丙二醇甲醚醋酸酯）",
"・接触角 / 接觸角 / 접촉각 → 接觸角（zh-TW）, 接触角（ja）",
"・露光 / 顯影 → 台湾では『曝光/顯影』の用語を優先",
].join("\n");

const user = [
"Translate under the above rules.",
"Output format:",
"- For Japanese input: return ONLY the zh-TW translation text.",
"- For zh-TW input: return ONLY the Japanese translation text.",
"- For Korean input: return two labeled blocks:",
" JA: <translation in Japanese>",
" ZH-TW: <translation in Traditional Chinese (Taiwan)>",
"",
`INPUT:\n${text}`,
].join("\n");

const r = await openai.chat.completions.create({
model: "gpt-4o-mini",
messages: [
{ role: "system", content: system },
{ role: "user", content: user },
],
temperature: 0.3,
});

const out = (r.choices?.[0]?.message?.content || "").trim();

// 韓国語ケース（2ブロック出力）を判定
if (out.startsWith("JA:") || out.includes("\nZH-TW:")) {
const ja = out.match(/JA:\s*([\s\S]*?)(?:\nZH-TW:|$)/)?.[1]?.trim() || "";
const zhtw = out.match(/ZH-TW:\s*([\s\S]*)$/)?.[1]?.trim() || "";
return { mode: "dual", ja, zhtw };
}

// 単一出力（日本語↔台湾華語）
return { mode: "single", text: out };
}
