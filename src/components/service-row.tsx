"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, MoreHorizontal, Play } from "lucide-react";
import type { Service } from "@/lib/db";

type Status = { kind: "web" | "desktop"; available: boolean; running: boolean };
const localPorts = new Set([43110, 43120, 43130, 43140, 43150, 43160]);
let statusCache: { at: number; value: Promise<Record<number, Status>> } | null = null;

function statuses() {
  if (statusCache && Date.now() - statusCache.at < 2000) return statusCache.value;
  const value = fetch("/api/local-apps", { cache: "no-store" }).then(async response => {
    if (!response.ok) throw new Error("无法读取运行状态");
    return response.json() as Promise<Record<number, Status>>;
  });
  statusCache = { at: Date.now(), value };
  return value;
}

function url(service: Service) {
  return `${service.protocol}://${service.host}${service.port ? `:${service.port}` : ""}${service.path ? `/${service.path.replace(/^\//, "")}` : ""}`;
}

export default function ServiceRow({ service, edit, notify }: { service: Service; edit: () => void; notify: (message: string) => void }) {
  const local = ["127.0.0.1", "localhost"].includes(service.host) && !!service.port;
  const managed = local && localPorts.has(service.port!);
  const portal = local && service.port === 43100;
  const desktop = managed && [43130, 43140, 43150].includes(service.port!);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (!managed) return;
    try {
      setStatus((await statuses())[service.port!] || null);
    } catch { /* The launch button can still report an error. */ }
  }, [managed, service.port]);
  useEffect(() => {
    void refresh();
    if (!managed) return;
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, [managed, refresh]);

  const start = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/local-apps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ port: service.port }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "启动失败");
      notify(body.message);
      statusCache = null;
      await refresh();
      window.setTimeout(refresh, 3000);
    } catch (error) { notify((error as Error).message); }
    finally { setBusy(false); }
  };

  return <div className="managed-service-row">
    <span className={`service-dot ${managed && status && !status.running ? "service-dot-off" : ""}`} />
    <span className="managed-service-name"><strong>{service.name}</strong><small>{desktop ? "Windows 桌面应用" : `${service.protocol}://${service.host}${service.port ? `:${service.port}` : ""}`}{portal ? " · 当前门户" : managed && status ? ` · ${status.running ? "运行中" : status.available ? "未启动" : "尚未构建"}` : ""}</small></span>
    {managed && !status?.running && <button className="service-action" onClick={start} disabled={busy || status?.available === false} title={desktop ? "启动桌面应用" : "启动网页服务"}><Play size={13}/>{busy ? "启动中" : desktop ? "启动应用" : "启动服务"}</button>}
    {!desktop && <a className="service-action" href={url(service)} target="_blank" rel="noopener noreferrer" title="打开网页"><ExternalLink size={14}/><span>打开</span></a>}
    <button className="service-edit" title="编辑服务" onClick={edit}><MoreHorizontal size={17}/></button>
  </div>;
}
