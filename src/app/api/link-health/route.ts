import db, { snapshot } from "@/lib/db";
import { probeHttp } from "@/lib/probe";
import { localRequest, required } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    localRequest(request);
    const origin = request.headers.get("origin");
    if (!origin || new URL(origin).host !== request.headers.get("host")) throw new Error("请求来源不匹配");
    const body = await request.json() as { ids?: unknown };
    if (!Array.isArray(body.ids) || body.ids.length > 25) throw new Error("每次最多检查 25 个网站");
    const ids = [...new Set(body.ids.map(value => required(value, 80)))];
    const find = db.prepare("SELECT id,url FROM websites WHERE id = ?");
    const entries = ids.map(id => find.get(id) as { id: string; url: string } | undefined).filter((value): value is { id: string; url: string } => !!value);
    const results = await Promise.all(entries.map(async entry => ({ websiteId: entry.id, ...await probeHttp(entry.url), checkedAt: new Date().toISOString() })));
    const save = db.prepare("INSERT INTO website_checks (website_id,state,code,checked_at) VALUES (@websiteId,@state,@code,@checkedAt) ON CONFLICT(website_id) DO UPDATE SET state=excluded.state,code=excluded.code,checked_at=excluded.checked_at");
    db.transaction(() => { for (const { websiteId, state, code, checkedAt } of results) save.run({ websiteId, state, code, checkedAt }); })();
    return Response.json({ results, data: snapshot() });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}
