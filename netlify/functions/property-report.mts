import type { Context, Config } from "@netlify/functions";

const SYSTEM_PROMPT = `You are a research assistant compiling a public-records property report for a Texas real estate brokerage. Given a street address and county, use web search to gather publicly available information and return ONLY a single JSON object (no markdown fences, no commentary) with this exact shape:

{
  "address": "string - the full confirmed address, corrected if the input had a typo",
  "county": "string",
  "snapshot": {
    "apn": "string or null",
    "legalDescription": "string or null",
    "propertyType": "string or null",
    "zoning": "string or null",
    "yearBuilt": "string or null",
    "livingArea": "string or null",
    "lotSize": "string or null",
    "bedsBaths": "string or null",
    "garage": "string or null",
    "schoolDistrict": "string or null"
  },
  "listingStatus": {
    "mlsNumber": "string or null",
    "status": "string or null",
    "listPrice": "string or null",
    "listDate": "string or null",
    "listingAgent": "string or null",
    "marketContext": "string or null"
  },
  "saleHistory": [
    {"date": "string", "event": "string", "price": "string", "notes": "string"}
  ],
  "taxHistory": [
    {"year": "string", "tax": "string", "yoyChange": "string", "assessed": "string"}
  ],
  "permitsZoning": {
    "zoningDetail": "string or null",
    "permits": [{"date": "string", "type": "string", "status": "string"}]
  },
  "climateRisk": {
    "flood": "string or null",
    "fire": "string or null",
    "heat": "string or null",
    "wind": "string or null",
    "air": "string or null"
  },
  "sources": ["list of source names used, e.g. Redfin, HAR, county appraisal district name"],
  "compiledDate": "string - today's date"
}

Rules:
- Texas is a non-disclosure state — do not state a closed sale price as fact unless a source explicitly and reliably confirms it; otherwise note it as unavailable.
- Use null for any field you cannot find, do not guess or fabricate values.
- Keep every string concise (one line where possible).
- Do not include owner-of-record name, deed instrument numbers, or lien/mortgage details even if found — this report intentionally excludes that layer.
- Return ONLY the JSON object, nothing else.`;

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  let body: { address?: string; county?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400 });
  }

  const address = (body.address || "").trim();
  const county = (body.county || "").trim();

  if (!address || !county) {
    return new Response(JSON.stringify({ error: "Address and county are required" }), { status: 400 });
  }

  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Server is not configured (missing API key)" }), { status: 500 });
  }

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Compile a property records report for: ${address}, ${county} County, Texas. Today's date is ${new Date().toISOString().slice(0, 10)}.`,
          },
        ],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return new Response(JSON.stringify({ error: "Upstream error", detail: errText }), { status: 502 });
    }

    const data = await anthropicRes.json();
    const textBlocks = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");

    const jsonMatch = textBlocks.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return new Response(JSON.stringify({ error: "Could not parse report", raw: textBlocks }), { status: 502 });
    }

    let report;
    try {
      report = JSON.parse(jsonMatch[0]);
    } catch {
      return new Response(JSON.stringify({ error: "Could not parse report JSON", raw: textBlocks }), { status: 502 });
    }

    return new Response(JSON.stringify({ report }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "Server error", detail: String(err) }), { status: 500 });
  }
};

export const config: Config = {
  path: "/api/property-report",
};
