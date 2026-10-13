import { snapshot, type Service } from "@/lib/db";
import { appStatus, launchablePorts } from "@/lib/local-launcher";
import { probeHttp } from "@/lib/probe";
import { localRequest } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function address(service: Service) { return `${service.protocol}://${service.host}${service.port ? `:${service.port}` : ""}${service.path ? `/${service.path.replace(/^\//, "")}` : ""}`; }

export async function GET(request: Request) {
  try {
    localRequest(request);
    const services = snapshot().services;
    const checkedAt = new Date().toISOString();
    const results = await Promise.all(services.map(async service => {
      const managed = ["127.0.0.1", "localhost"].includes(service.host) && !!service.port && launchablePorts.includes(service.port);
      if (managed) {
        const app = await appStatus(service.port!);
        return { serviceId: service.id, state: app?.running ? "running" : app?.available ? "stopped" : "not-ready", launchable: !!app?.available, kind: app?.kind || "web", checkedAt };
      }
      const result = await probeHttp(address(service), 3000);
      return { serviceId: service.id, state: result.reachable ? "running" : "stopped", launchable: false, kind: "web", checkedAt };
    }));
    return Response.json({ results, checkedAt });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 403 }); }
}
