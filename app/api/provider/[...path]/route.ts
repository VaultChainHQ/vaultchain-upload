import { FORWARD_REQUEST_HEADERS, FORWARD_RESPONSE_HEADERS, isAllowedProviderPath, providerTarget } from "@/lib/proxy";

// Same-origin pass-through to the storage provider, because the provider does not send CORS
// headers for this site's origin. It forwards only whitelisted paths and headers. It holds no
// secrets: requests carry chunks and signed read tokens made in the browser.
type Ctx = { params: Promise<{ path: string[] }> };

async function forward(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  const joined = path.join("/");
  if (!isAllowedProviderPath(joined)) {
    return Response.json({ error: "path not allowed by the proxy" }, { status: 404 });
  }
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "PUT") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }
  const headers = new Headers();
  for (const h of FORWARD_REQUEST_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const hasBody = req.method === "PUT";
  const upstream = await fetch(`${providerTarget()}/${joined}`, {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    cache: "no-store",
  });
  const out = new Headers();
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(req.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: out });
}

export const GET = forward;
export const HEAD = forward;
export const PUT = forward;
