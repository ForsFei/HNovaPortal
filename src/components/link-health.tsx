"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { Website, WebsiteCheck } from "@/lib/db";
import type { SecretItem } from "@/lib/vault";

type PrivateCheck = { state: "reachable" | "unknown"; checkedAt: string };
const label = { ok: "正常", broken: "失效（404/410）", unknown: "无法确认", reachable: "已连接，状态码不可见" };

export default function LinkHealth({ websites, checks, secrets, unlocked, onChecks, notify }: { websites: Website[]; checks: WebsiteCheck[]; secrets: SecretItem[]; unlocked: boolean; onChecks: (checks: WebsiteCheck[]) => void; notify: (message: string) => void }) {
  const [privateChecks, setPrivateChecks] = useState<Record<string, PrivateCheck>>({});
  const [busy, setBusy] = useState<"public" | "private" | null>(null);
  const [progress, setProgress] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const privateController = useRef<AbortController | null>(null);
  useEffect(() => { if (!unlocked) { privateController.current?.abort(); setPrivateChecks({}); } }, [unlocked]);
  useEffect(() => () => privateController.current?.abort(), []);
  const publicCheck = async () => {
    try {
      setBusy("public"); setProgress(0);
      for (let index = 0; index < websites.length; index += 25) {
        const response = await fetch("/api/link-health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: websites.slice(index, index + 25).map(value => value.id) }) });
        const body = await response.json(); if (!response.ok) throw new Error(body.error || "检查失败");
        onChecks(body.data.websiteChecks); setProgress(Math.min(index + 25, websites.length));
      }
      notify("公开网站检查完成");
    } catch (error) { notify((error as Error).message); }
    finally { setBusy(null); }
  };
  const privateCheck = async () => {
    if (!unlocked) return;
    try {
      setBusy("private"); setProgress(0);
      const controller = new AbortController();
      privateController.current = controller;
      const next: Record<string, PrivateCheck> = {};
      for (let index = 0; index < secrets.length; index += 10) {
        if (controller.signal.aborted) return;
        const batch = secrets.slice(index, index + 10);
        await Promise.all(batch.map(async item => {
          try {
            await fetch(item.url, { method: "HEAD", mode: "no-cors", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
            next[item.id] = { state: "reachable", checkedAt: new Date().toISOString() };
          } catch { next[item.id] = { state: "unknown", checkedAt: new Date().toISOString() }; }
        }));
        if (controller.signal.aborted) return;
        setPrivateChecks({ ...next }); setProgress(Math.min(index + 10, secrets.length));
      }
      notify("加密网址的浏览器检查完成");
    } finally { privateController.current = null; setBusy(null); }
  };
  const publicRows = websites.map(website => ({ id: website.id, name: website.name, area: "网站", check: checks.find(value => value.websiteId === website.id) }));
  const privateRows = unlocked ? secrets.map(item => ({ id: item.id, name: item.name, area: item.kind === "private" ? "私密" : "已导入", check: privateChecks[item.id] })) : [];
  const rows = [...publicRows, ...privateRows].filter(row => showAll || row.check?.state === "broken" || row.check?.state === "unknown");
  return <div className="settings-card health-card"><div className="settings-card-icon"><RefreshCw size={20}/></div><div><h3>网址可用性检查</h3><p>公开网站由本机服务检查，只有 404/410 判为失效。加密网址仅在当前浏览器检查，跨域限制下不读取状态码，失败时显示“无法确认”。</p><div className="settings-actions"><button className="btn btn-secondary" disabled={!!busy || !websites.length} onClick={() => void publicCheck()}>检查网站</button><button className="btn btn-secondary" disabled={!!busy || !unlocked || !secrets.length} onClick={() => void privateCheck()}>检查已解锁网址</button><button className="btn btn-secondary" onClick={() => setShowAll(value => !value)}>{showAll ? "只看需关注" : "显示全部"}</button></div>{busy && <p className="health-progress">正在检查：{progress} 项 · {busy === "public" ? "公开网站" : "加密网址"}</p>}<div className="health-list">{rows.length ? rows.map(row => <div key={`${row.area}-${row.id}`}><strong>{row.name}</strong><small>{row.area}</small><span className={`health-state ${row.check?.state || "unchecked"}`}>{row.check ? label[row.check.state as keyof typeof label] : "未检查"}</span><small>{row.check ? new Date(row.check.checkedAt).toLocaleString() : ""}</small></div>) : <span className="muted">没有需要关注的结果。可点“显示全部”查看所有记录。</span>}</div></div></div>;
}
