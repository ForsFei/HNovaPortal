"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, RefreshCw } from "lucide-react";
import type { Service } from "@/lib/db";

type Status = { serviceId: string; state: "running" | "stopped" | "not-ready"; launchable: boolean; kind: "web" | "desktop"; checkedAt: string };
const labels = { running: "运行中", stopped: "无法连接或未启动", "not-ready": "尚未构建" };

export default function ServiceOverview({ services, notify }: { services: Service[]; notify: (message: string) => void }) {
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/service-status", { cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "无法读取服务状态");
      setStatuses(body.results);
    } catch (error) { notifyRef.current((error as Error).message); }
  }, []);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 30000); return () => window.clearInterval(timer); }, [refresh]);
  const start = async (service: Service) => {
    try {
      setStarting(service.id);
      const response = await fetch("/api/local-apps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ port: service.port }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "启动失败");
      notify(body.message); await refresh(); window.setTimeout(() => void refresh(), 3000);
    } catch (error) { notify((error as Error).message); }
    finally { setStarting(null); }
  };
  return <section className="service-overview"><div className="service-overview-head"><div><h3>服务状态</h3><p>{services.length} 个入口 · {statuses.filter(value => value.state === "running").length} 个运行中</p></div><button onClick={() => { setBusy(true); void refresh().finally(() => setBusy(false)); }} disabled={busy}><RefreshCw size={15}/>{busy ? "检查中" : "刷新状态"}</button></div>
    <div className="service-overview-list">{services.map(service => { const status = statuses.find(value => value.serviceId === service.id); return <div key={service.id}><span className={`service-dot ${status?.state !== "running" ? "service-dot-off" : ""}`}/><strong>{service.name}</strong><small>{status ? labels[status.state] : "等待检查"}</small>{status?.launchable && status.state !== "running" && <button disabled={starting === service.id} onClick={() => void start(service)}><Play size={13}/>{starting === service.id ? "启动中" : "启动"}</button>}</div>; })}</div>
  </section>;
}
