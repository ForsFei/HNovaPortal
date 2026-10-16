import db from "@/lib/db";
import { discoverSiteIcon } from "@/lib/site-icon-discovery";
import { localRequest } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    localRequest(request);
    const id = new URL(request.url).searchParams.get("id") || "";
    if (id.length > 80) return new Response(null, { status: 400 });
    const website = db.prepare("SELECT url FROM websites WHERE id = ?").get(id) as { url: string } | undefined;
    if (!website) return new Response(null, { status: 404 });
    const icon = await discoverSiteIcon(website.url);
    if (!icon) return new Response(null, { status: 404, headers: { "Cache-Control": "private, max-age=3600" } });
    return new Response(icon.bytes as BodyInit, {
      headers: {
        "Content-Type": icon.contentType,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Content-Security-Policy": "default-src 'none'"
      }
    });
  } catch { return new Response(null, { status: 404 }); }
}
