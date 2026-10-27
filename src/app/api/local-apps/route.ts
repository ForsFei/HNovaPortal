import { appStatus, launchablePorts, startApp } from "@/lib/local-launcher";
import { localRequest } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    localRequest(request);
    const statuses = await Promise.all(launchablePorts.map(async port => [port, await appStatus(port)]));
    return Response.json(Object.fromEntries(statuses));
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 403 }); }
}

export async function POST(request: Request) {
  try {
    localRequest(request);
    const origin = request.headers.get("origin");
    // Production Next may use an internal hostname in request.url; localRequest
    // already restricts Host to the two supported loopback addresses.
    if (!origin || origin !== `http://${request.headers.get("host")}`) throw new Error("请求来源不匹配");
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("请求格式无效");
    const { port } = await request.json();
    if (!Number.isInteger(port) || !launchablePorts.includes(port)) throw new Error("不支持启动此项目");
    return Response.json(await startApp(port));
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}
