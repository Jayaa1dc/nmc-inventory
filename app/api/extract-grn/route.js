import { NextResponse } from "next/server";

export const maxDuration = 60;

const schema = {
  type: "OBJECT",
  properties: {
    grn_no: { type: "STRING" }, invoice_no: { type: "STRING" }, date: { type: "STRING" },
    center: { type: "STRING" }, supplier_code: { type: "STRING" }, received_by: { type: "STRING" },
    lines: { type: "ARRAY", items: { type: "OBJECT", properties: {
      text: { type: "STRING" }, item_code: { type: "STRING" }, qty: { type: "NUMBER" }, unit_price: { type: "NUMBER" } },
      required: ["text", "qty"] } },
  },
  required: ["lines"],
};

export async function POST(req) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: "GEMINI_API_KEY is not set on the server" }, { status: 500 });

  const form = await req.formData();
  const file = form.get("file");
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: "File is over 4 MB. Use a smaller scan or a PDF export." }, { status: 413 });
  const items = JSON.parse(String(form.get("items") || "[]"));
  const sups = JSON.parse(String(form.get("suppliers") || "[]"));
  const branches = JSON.parse(String(form.get("branches") || "[]"));
  const data = Buffer.from(await file.arrayBuffer()).toString("base64");

  const prompt = `This is a goods received note (GRN) report from a hospital information system.
Extract it exactly as printed. Do not invent values; leave unknown fields empty.
- date: YYYY-MM-DD
- center: one of [${branches.join(", ")}] or empty
- supplier_code: from the supplier list only if clearly the same supplier, else empty
- lines[].text: item description as printed
- lines[].item_code: from the item list only if clearly the same product (same size/colour/pack), else empty
Suppliers: ${sups.map((s) => `${s.code}=${s.name}`).join("; ")}
Items: ${items.map((i) => `${i.code}=${i.name}`).join("; ")}`;

  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: file.type || "application/pdf", data } }, { text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
  };
  const models = [process.env.GEMINI_MODEL || "gemini-flash-latest", process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-lite-latest"];
  let last = "";
  for (const m of models) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body),
    });
    if (r.ok) {
      const j = await r.json();
      try { return NextResponse.json(JSON.parse(j?.candidates?.[0]?.content?.parts?.[0]?.text)); }
      catch { last = "Gemini returned unreadable data"; continue; }
    }
    last = `Gemini error ${r.status}`;
    if (![429, 500, 503].includes(r.status)) break;
  }
  return NextResponse.json({ error: last + ". The free quota may be used up: enter the GRN manually or try later." }, { status: 502 });
}
