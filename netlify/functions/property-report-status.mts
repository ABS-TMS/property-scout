import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");

  if (!jobId) {
    return new Response(JSON.stringify({ status: "error", error: "Missing jobId" }), { status: 400 });
  }

  const store = getStore("property-reports");
  const result = await store.get(jobId, { type: "json" });

  if (!result) {
    // Background function may not have written its first "pending" state yet
    return new Response(JSON.stringify({ status: "pending" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
