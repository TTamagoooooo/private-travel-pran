import { json } from "./util.js";

const SYSTEM_PROMPT = `あなたはホテル検索アシスタントです。web検索ツールを使って、指定された条件に一致する実在するホテルを調べてください。

出力は以下の形式のJSON配列のみとし、前置きやMarkdownのコードフェンス、説明文は一切含めないでください。

[
  {
    "name": "ホテル名",
    "area": "所在エリアや最寄り駅など、簡潔な場所の説明",
    "price": 数値(1泊あたりの目安料金。不明な場合はnull),
    "currency": "JPY等の通貨コード",
    "rating": 0から5の数値評価(不明な場合は0),
    "distance": "中心部や最寄り駅からの距離(例: 駅から600m)。不明なら空文字",
    "access": "交通アクセスの目安(例: 新幹線口から徒歩3分)。不明なら空文字",
    "note": "選定理由や特徴を20文字程度で",
    "url": "参考にしたページのURL(なければ空文字)"
  }
]

評価の高い順に最大6件まで返してください。条件に合う実在のホテルが見つからない場合は空配列 [] を返してください。価格や距離は検索結果から分かる範囲で構いません。JSON以外は絶対に出力しないでください。`;

function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error("モデルの応答からJSONを抽出できませんでした");
  }
}

export async function searchHotels(request, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "ANTHROPIC_API_KEY が設定されていません" }, 500);
  }
  const body = await request.json();

  const userPrompt = [
    `目的地: ${body.destination}`,
    body.checkin ? `チェックイン: ${body.checkin}` : null,
    body.checkout ? `チェックアウト: ${body.checkout}` : null,
    body.guests ? `人数: ${body.guests}名` : null,
    body.budget ? `予算上限(1泊): ${body.budget}円程度` : null,
    body.notes ? `希望条件: ${body.notes}` : null,
    "上記条件で実在するホテルを検索し、候補を提示してください。",
  ]
    .filter(Boolean)
    .join("\n");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55000);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return json({ error: `Anthropic API error ${res.status}: ${errText.slice(0, 300)}` }, 502);
    }
    const data = await res.json();
    if (data.error) return json({ error: data.error.message || JSON.stringify(data.error) }, 502);

    const textBlocks = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const cleaned = textBlocks.replace(/```json|```/g, "").trim();
    const hotels = extractJSON(cleaned);
    return json(hotels);
  } catch (e) {
    const message = e.name === "AbortError" ? "検索がタイムアウトしました(55秒)" : String(e.message || e);
    return json({ error: message }, 500);
  } finally {
    clearTimeout(timeoutId);
  }
}
