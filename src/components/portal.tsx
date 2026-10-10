"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDownToLine, ArrowRight, Check, ChevronDown, Command, Compass, ExternalLink, FileUp, Globe2, HardDrive, Heart, Home, KeyRound, LayoutGrid, LockKeyhole, Menu, Moon, MoreHorizontal, Plus, Search, Server as ServerIcon, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Sun, Trash2, X } from "lucide-react";
import type { ProtectedRow, Server, Service, Website } from "@/lib/db";
import { decrypt, deriveKey, encrypt, newSalt, type SecretItem, verifier } from "@/lib/vault";
import { normalizeUrl } from "@/lib/validation";
import ServiceRow from "@/components/service-row";
import SiteIcon from "@/components/site-icon";

type Section = "Home" | "Websites" | "Imported" | "Private" | "Services" | "Settings";
type Snapshot = { websites: Website[]; servers: Server[]; services: Service[]; protectedRows: ProtectedRow[]; vault: { salt: string; verifierPayload: string; verifierNonce: string; version: number } | null; batches: { id: string; source: string; scanned: number; added: number; skipped: number; importedAt: string }[] };
type ImportEntry = { name: string; url: string; folder: string; browser: string; profile: string };
type Profile = { browser: string; profile: string; label: string };
const empty: Snapshot = { websites: [], servers: [], services: [], protectedRows: [], vault: null, batches: [] };
const icons = { Home, Websites: Globe2, Imported: ArrowDownToLine, Private: LockKeyhole, Services: ServerIcon, Settings: Settings2 };
const nav: Section[] = ["Home", "Websites", "Imported", "Private", "Services", "Settings"];
const sectionLabels: Record<Section, string> = { Home: "首页", Websites: "网站", Imported: "已导入", Private: "私密", Services: "服务", Settings: "设置" };
const pageTitles: Record<Section, string> = { Home: "你的数字空间，一处抵达。", Websites: "网站", Imported: "书签收件箱", Private: "私密保险库", Services: "服务", Settings: "设置" };
const pageSub: Record<Section, string> = { Home: "把常用网站和本地服务，安静地放在一起。", Websites: "整理日常工作与探索所需的网站。", Imported: "先检查浏览器书签，再决定如何归档。", Private: "只有你解锁后才能查看的加密网址。", Services: "集中管理设备和本地服务入口。", Settings: "按照自己的习惯配置门户。" };
const resultLabels: Record<string, string> = { Website: "网站", Service: "服务", Imported: "已导入", Private: "私密" };
const formLabels: Record<string, string> = { website: "网站", server: "设备", service: "服务", private: "私密网址" };

function host(url: string) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } }
function localDesktop(s: Service) { return ["127.0.0.1", "localhost"].includes(s.host) && [43130, 43140, 43150].includes(s.port || 0); }
function serviceUrl(s: Service) { return `${s.protocol}://${s.host}${s.port ? `:${s.port}` : ""}${s.path ? `/${s.path.replace(/^\//, "")}` : ""}`; }
function Btn({ children, onClick, kind = "secondary", type = "button", disabled = false }: { children: React.ReactNode; onClick?: () => void; kind?: "primary" | "secondary" | "ghost" | "danger"; type?: "button" | "submit"; disabled?: boolean }) {
  return <button type={type} disabled={disabled} onClick={onClick} className={`btn btn-${kind}`}>{children}</button>;
}
function EmptyState({ icon: Icon, title, text, action }: { icon: typeof Globe2; title: string; text: string; action?: React.ReactNode }) {
  return <div className="empty"><div className="empty-icon"><Icon size={23} /></div><h3>{title}</h3><p>{text}</p>{action}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Tag({ children }: { children: React.ReactNode }) { return <span className="tag">{children}</span>; }

export default function Portal() {
  const [data, setData] = useState<Snapshot>(empty);
  const [section, setSection] = useState<Section>("Home");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [theme, setTheme] = useState<"dark" | "light" | "system">("system");
  const [modal, setModal] = useState<"website" | "server" | "service" | "private" | "import" | "unlock" | null>(null);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [query, setQuery] = useState("");
  const [palette, setPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [collection, setCollection] = useState("全部分类");
  const [tagFilter, setTagFilter] = useState("全部标签");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [keyReady, setKeyReady] = useState(false);
  const [secrets, setSecrets] = useState<SecretItem[]>([]);
  const keyRef = useRef<CryptoKey | null>(null);
  const lastActivity = useRef(Date.now());
  const [autoLock, setAutoLock] = useState(10);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [preview, setPreview] = useState<{ source: string; entries: ImportEntry[]; folders: number } | null>(null);
  const [duplicateMode, setDuplicateMode] = useState<"skip" | "keep" | "merge">("skip");
  const [busy, setBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3600); };
  const refresh = useCallback(async () => {
    const res = await fetch("/api/data", { cache: "no-store" });
    if (!res.headers.get("content-type")?.includes("application/json")) throw new Error("数据接口未就绪，请检查启动窗口中的构建结果，确认下载包包含 src/app/api/data/route.ts");
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "无法读取数据");
    setData(body);
    return body as Snapshot;
  }, []);
  const mutate = async (action: string, item: Record<string, unknown>) => {
    const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, item }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "保存失败");
    setData(body);
    return body as Snapshot;
  };
  const lock = useCallback(() => {
    keyRef.current = null;
    setKeyReady(false);
    setSecrets([]);
    setQuery("");
    setPaletteQuery("");
    setPalette(false);
    setPreview(null);
    if (section === "Imported" || section === "Private") setSection("Home");
  }, [section]);

  useEffect(() => { refresh().catch(e => setError(e.message)).finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => {
    const saved = localStorage.getItem("hnova-theme") as typeof theme | null;
    const next = saved === "dark" || saved === "light" ? saved : "system";
    setTheme(next);
    const minutes = Number(localStorage.getItem("hnova-autolock"));
    if ([5, 10, 30].includes(minutes)) setAutoLock(minutes);
  }, []);
  useEffect(() => {
    const apply = () => document.documentElement.dataset.theme = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
    apply(); localStorage.setItem("hnova-theme", theme);
    const media = matchMedia("(prefers-color-scheme: dark)"); media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    const activity = () => { lastActivity.current = Date.now(); };
    ["click", "keydown", "pointermove"].forEach(event => window.addEventListener(event, activity));
    const checkIdle = () => { if (keyRef.current && Date.now() - lastActivity.current >= autoLock * 60000) lock(); };
    const timer = window.setInterval(checkIdle, 15000);
    document.addEventListener("visibilitychange", checkIdle);
    return () => { ["click", "keydown", "pointermove"].forEach(event => window.removeEventListener(event, activity)); document.removeEventListener("visibilitychange", checkIdle); window.clearInterval(timer); };
  }, [autoLock, lock]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPalette(v => !v); }
      if (event.key === "Escape") { setPalette(false); setModal(null); }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!keyReady || !keyRef.current) return;
    const key = keyRef.current;
    Promise.all(data.protectedRows.map(async row => {
      try { return await decrypt<SecretItem>(key, row); } catch { return null; }
    })).then(values => { if (keyRef.current === key) setSecrets(values.filter(Boolean) as SecretItem[]); });
  }, [data.protectedRows, keyReady]);

  const enter = (next: Section) => {
    setMobileNav(false);
    if ((next === "Imported" || next === "Private") && !keyReady) { setSection(next); setModal("unlock"); }
    else { setSection(next); setQuery(""); }
  };
  const openForm = (type: typeof modal, item: Record<string, unknown> | null = null) => { setEditing(item); setModal(type); };
  const doDelete = async (action: string, id: string) => {
    if (!confirm("确定删除此项目？")) return;
    try { await mutate(action, { id }); notify("已删除"); } catch (e) { notify((e as Error).message); }
  };
  const saveSecret = async (item: SecretItem) => {
    if (!keyRef.current) throw new Error("请先解锁保险库");
    const cipher = await encrypt(keyRef.current, item);
    await mutate("protected.save", { id: item.id, kind: item.kind, ...cipher });
  };
  const saveForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!modal) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const id = String(editing?.id || crypto.randomUUID());
    const item: Record<string, unknown> = { ...editing, ...values, id };
    if (typeof values.tags === "string") item.tags = values.tags.split(",").map(v => v.trim()).filter(Boolean);
    if (modal === "website") item.favorite = values.favorite === "on";
    try {
      setBusy(true);
      if (modal === "private") await saveSecret({ ...item, kind: "private" } as SecretItem);
      else await mutate(`${modal}.save`, item);
      setModal(null); setEditing(null); notify("已保存");
    } catch (e) { notify((e as Error).message); } finally { setBusy(false); }
  };
  const unlock = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if (password.length < 8) { notify("主密码至少需要 8 个字符"); return; }
    try {
      setBusy(true);
      if (data.vault) {
        const key = await deriveKey(password, data.vault.salt);
        const check = await decrypt<string>(key, { payload: data.vault.verifierPayload, nonce: data.vault.verifierNonce });
        if (check !== verifier) throw new Error("主密码错误");
        keyRef.current = key;
      } else {
        if (password !== String(form.get("confirm") || "")) throw new Error("两次主密码不一致");
        const salt = newSalt();
        const key = await deriveKey(password, salt);
        const proof = await encrypt(key, verifier);
        await mutate("vault.create", { salt, verifierPayload: proof.payload, verifierNonce: proof.nonce });
        keyRef.current = key;
      }
      lastActivity.current = Date.now(); setKeyReady(true); setModal(null); notify("保护区已解锁");
    } catch (e) { notify((e as Error).message || "无法解锁"); } finally { setBusy(false); }
  };
  const discover = async () => {
    try {
      const res = await fetch("/api/browser"); const body = await res.json();
      if (!res.ok) throw new Error(body.error); setProfiles(body.profiles); openForm("import");
    } catch (e) { notify((e as Error).message); }
  };
  const readProfile = async (profile: Profile) => {
    try {
      setBusy(true);
      const res = await fetch("/api/browser", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) });
      const body = await res.json(); if (!res.ok) throw new Error(body.error);
      setPreview({ source: `${profile.browser} · ${profile.label}`, entries: body.entries, folders: body.folders });
    } catch (e) { notify((e as Error).message); } finally { setBusy(false); }
  };
  const readHtml = async (file: File) => {
    const document = new DOMParser().parseFromString(await file.text(), "text/html");
    const entries: ImportEntry[] = [];
    const folders = new Set<string>();
    for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
      const url = anchor.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(url)) continue;
      const trail: string[] = [];
      let current: Element | null = anchor.parentElement;
      while (current) {
        if (current.tagName === "DL") {
          const previous = current.previousElementSibling;
          if (previous?.tagName === "H3") trail.unshift(previous.textContent?.trim() || "文件夹");
          else if (previous?.querySelector("h3")) trail.unshift(previous.querySelector("h3")?.textContent?.trim() || "文件夹");
        }
        current = current.parentElement;
      }
      const folder = trail.join(" / "); if (folder) folders.add(folder);
      entries.push({ name: anchor.textContent?.trim() || url, url, folder, browser: "HTML", profile: file.name });
    }
    setPreview({ source: `HTML · ${file.name}`, entries, folders: folders.size });
  };
  const existingUrls = useMemo(() => new Set([...data.websites.map(w => normalizeUrl(w.url)), ...secrets.map(s => normalizeUrl(s.url))]), [data.websites, secrets]);
  const duplicateCount = useMemo(() => {
    if (!preview) return 0;
    const seen = new Set(existingUrls);
    let count = 0;
    for (const entry of preview.entries) {
      const url = normalizeUrl(entry.url);
      if (seen.has(url)) count++;
      else seen.add(url);
    }
    return count;
  }, [preview, existingUrls]);
  const commitImport = async () => {
    if (!preview || !keyRef.current) return;
    try {
      setBusy(true); let added = 0, skipped = 0;
      const seen = new Set(existingUrls);
      const rows: { id: string; kind: string; payload: string; nonce: string }[] = [];
      for (const entry of preview.entries) {
        const normalized = normalizeUrl(entry.url);
        if (seen.has(normalized) && duplicateMode !== "keep") {
          if (duplicateMode === "merge") {
            const match = secrets.find(s => normalizeUrl(s.url) === normalized && s.kind === "imported");
            if (match) {
              const cipher = await encrypt(keyRef.current, { ...match, name: entry.name, folder: entry.folder, profile: entry.profile, browser: entry.browser });
              rows.push({ id: match.id, kind: "imported", ...cipher });
              continue;
            }
          }
          skipped++; continue;
        }
        const id = crypto.randomUUID();
        const cipher = await encrypt(keyRef.current, { id, kind: "imported", ...entry, createdAt: new Date().toISOString() });
        rows.push({ id, kind: "imported", ...cipher });
        seen.add(normalized); added++;
      }
      await mutate("protected.bulk", { rows });
      await mutate("batch.save", { source: preview.source.split(" · ")[0], scanned: preview.entries.length, added, skipped });
      setPreview(null); setModal(null); setSection("Imported"); notify(`导入完成：${added} 新增，${skipped} 跳过`);
    } catch (e) { notify((e as Error).message); } finally { setBusy(false); }
  };
  const moveImported = async (item: SecretItem, target: "website" | "private") => {
    try {
      if (target === "website") await mutate("website.save", { name: item.name, url: item.url, description: item.description || "", collection: item.folder?.split(" / ").at(-1) || "导入书签", tags: item.tags || [] });
      else await saveSecret({ ...item, id: crypto.randomUUID(), kind: "private" });
      await mutate("protected.delete", { id: item.id }); notify(target === "website" ? "已移至网站" : "已移至私密保险库");
    } catch (e) { notify((e as Error).message); }
  };
  const allSearch = useMemo(() => {
    const publicItems = [
      ...data.websites.map(w => ({ id: w.id, name: w.name, url: w.url, subtitle: host(w.url), type: "Website", alias: w.alias, icon: w.icon })),
      ...data.services.map(s => ({ id: s.id, name: s.name, url: serviceUrl(s), subtitle: s.host, type: "Service", alias: s.alias, icon: "" }))
    ];
    const protectedItems = keyReady ? secrets.map(s => ({ id: s.id, name: s.name, url: s.url, subtitle: s.kind === "imported" ? `${s.browser} · ${s.folder || "书签"}` : "私密", type: s.kind === "imported" ? "Imported" : "Private", alias: "", icon: "" })) : [];
    return [...publicItems, ...protectedItems];
  }, [data.websites, data.services, secrets, keyReady]);
  const searchResults = (term: string) => allSearch.filter(i => `${i.name} ${i.url} ${i.subtitle} ${i.alias}`.toLowerCase().includes(term.toLowerCase())).slice(0, 12);
  const collections = ["全部分类", ...new Set(data.websites.map(w => w.collection).filter(Boolean))];
  const allTags = ["全部标签", ...new Set(data.websites.flatMap(w => w.tags))];
  const filteredWebsites = data.websites.filter(w => (!favoritesOnly || w.favorite) && (collection === "全部分类" || w.collection === collection) && (tagFilter === "全部标签" || w.tags.includes(tagFilter)) && `${w.name} ${w.url} ${w.description} ${w.alias} ${w.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const imported = secrets.filter(s => s.kind === "imported" && `${s.name} ${s.url} ${s.folder} ${s.profile}`.toLowerCase().includes(query.toLowerCase()));
  const privateItems = secrets.filter(s => s.kind === "private" && `${s.name} ${s.url} ${s.description} ${s.notes}`.toLowerCase().includes(query.toLowerCase()));
  const topSites = data.websites.filter(w => w.favorite).slice(0, 6);

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <div className="brand"><div className="brand-mark">H<span>✦</span></div><div><strong>HNova</strong><small>个人门户</small></div></div>
      <div className="workspace-label">工作区 <ChevronDown size={13} /></div>
      <nav className="navigation">{nav.map(item => { const Icon = icons[item]; return <button key={item} className={`nav-link ${section === item ? "active" : ""}`} onClick={() => enter(item)}><Icon size={17} strokeWidth={1.8}/><span>{sectionLabels[item]}</span>{(item === "Imported" || item === "Private") && <LockKeyhole className="nav-lock" size={12}/>}</button>; })}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><div className="tiny-orbit"><Sparkles size={16}/></div><strong>你的数字入口</strong><p>常用入口，尽在一处。</p></div><div className="sidebar-footer"><span className="status-dot"/> 本地工作区 <span className="version">v0.1</span></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><button className="mobile-menu icon-btn" onClick={() => setMobileNav(v => !v)}><Menu size={19}/></button><div className="breadcrumb"><span>工作区</span><span className="crumb-slash">/</span><strong>{sectionLabels[section]}</strong></div><div className="top-actions"><button className="top-search" onClick={() => setPalette(true)}><Search size={15}/><span>搜索所有内容...</span><kbd>Ctrl K</kbd></button><button className="icon-btn top-icon" title="切换主题" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={18}/> : <Moon size={18}/>}</button><div className="avatar">H</div></div></header>
      <div className="content">
        {error && <div className="alert">{error}</div>}
        {loading ? <div className="loading">正在加载门户...</div> : <>
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> HNOVA / {sectionLabels[section]}</div><h1>{pageTitles[section]}</h1><p>{pageSub[section]}</p></div><div className="heading-action">{section === "Websites" && <Btn kind="primary" onClick={() => openForm("website")}><Plus size={16}/> 添加网站</Btn>}{section === "Services" && <Btn kind="primary" onClick={() => openForm("service")}><Plus size={16}/> 添加服务</Btn>}{section === "Private" && keyReady && <Btn kind="primary" onClick={() => openForm("private")}><Plus size={16}/> 添加私密网址</Btn>}{section === "Imported" && keyReady && <Btn kind="primary" onClick={discover}><ArrowDownToLine size={16}/> 导入书签</Btn>}</div></div>

          {section === "Home" && <>
            <div className="hero-search" onClick={() => setPalette(true)}><Search size={21}/><span>想去哪里？</span><kbd>Ctrl + K</kbd></div>
            <div className="stats-grid"><div className="stat-card"><span className="stat-icon blue"><Globe2 size={19}/></span><div><strong>{data.websites.length}</strong><span>网站</span></div><ArrowRight size={17}/></div><div className="stat-card"><span className="stat-icon purple"><ServerIcon size={19}/></span><div><strong>{data.services.length}</strong><span>服务</span></div><ArrowRight size={17}/></div><div className="stat-card"><span className="stat-icon amber"><LockKeyhole size={19}/></span><div><strong>{data.protectedRows.length}</strong><span>加密网址</span></div><ArrowRight size={17}/></div></div>
            <div className="home-grid"><section className="panel favorites-panel"><div className="panel-head"><div><div className="panel-kicker">快捷访问</div><h2>收藏</h2></div><button className="text-link" onClick={() => enter("Websites")}>查看全部 <ArrowRight size={14}/></button></div>{topSites.length ? <div className="favorite-grid">{topSites.map(w => <a key={w.id} href={w.url} target="_blank" rel="noopener noreferrer" className="favorite-item"><SiteIcon url={w.url} icon={w.icon}/><strong>{w.name}</strong><span>{host(w.url)}</span></a>)}</div> : <EmptyState icon={Heart} title="还没有收藏" text="收藏常用网站，快速访问。" action={<Btn onClick={() => enter("Websites")}>浏览网站</Btn>}/>}</section><section className="panel services-panel"><div className="panel-head"><div><div className="panel-kicker">本地网络</div><h2>我的服务</h2></div><button className="text-link" onClick={() => enter("Services")}>查看全部 <ArrowRight size={14}/></button></div>{data.services.length ? <div className="compact-list">{data.services.slice(0, 5).map(s => localDesktop(s) ? <button key={s.id} onClick={() => enter("Services")}><span className="mini-icon"><ServerIcon size={15}/></span><span className="compact-name">{s.name}<small>桌面应用 · 前往服务页启动</small></span><ArrowRight size={14}/></button> : <a key={s.id} href={serviceUrl(s)} target="_blank" rel="noopener noreferrer"><span className="mini-icon"><ServerIcon size={15}/></span><span className="compact-name">{s.name}<small>{s.host}{s.port ? `:${s.port}` : ""}</small></span><ExternalLink size={14}/></a>)}</div> : <EmptyState icon={ServerIcon} title="还没有服务" text="添加你的 Homelab 和本地工具。" action={<Btn onClick={() => enter("Services")}>添加服务</Btn>}/>}</section></div>
            <div className="home-grid lower-grid"><section className="panel protected-teaser"><div className="panel-head"><div><div className="panel-kicker">加密区域</div><h2>你的私密空间</h2></div><ShieldCheck size={18}/></div><div className="protected-links"><button onClick={() => enter("Imported")}><span className="protected-icon"><ArrowDownToLine size={17}/></span><span><strong>已导入</strong><small>{keyReady ? `${secrets.filter(s => s.kind === "imported").length} 条书签` : "加密书签"}</small></span>{keyReady ? <ArrowRight size={16}/> : <LockKeyhole size={15}/>}</button><button onClick={() => enter("Private")}><span className="protected-icon"><KeyRound size={17}/></span><span><strong>私密保险库</strong><small>{keyReady ? `${secrets.filter(s => s.kind === "private").length} 条网址` : "加密网址"}</small></span>{keyReady ? <ArrowRight size={16}/> : <LockKeyhole size={15}/>}</button></div></section><section className="panel recent-panel"><div className="panel-head"><div><div className="panel-kicker">最新动态</div><h2>最近添加</h2></div><Activity size={18}/></div>{data.websites.length ? <div className="compact-list">{[...data.websites].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,3).map(w => <a key={w.id} href={w.url} target="_blank" rel="noopener noreferrer"><SiteIcon url={w.url} icon={w.icon} className="mini-icon"/><span className="compact-name">{w.name}<small>{host(w.url)}</small></span><ExternalLink size={14}/></a>)}</div> : <div className="recent-empty">最近添加的内容会显示在这里。</div>}</section></div>
          </>}

          {section === "Websites" && <><div className="toolbar"><div className="inline-search"><Search size={17}/><input placeholder="搜索网站..." value={query} onChange={e => setQuery(e.target.value)}/></div><select value={collection} onChange={e => setCollection(e.target.value)}>{collections.map(c => <option key={c}>{c}</option>)}</select><select value={tagFilter} onChange={e => setTagFilter(e.target.value)}>{allTags.map(t => <option key={t}>{t}</option>)}</select><button className={`filter-btn ${favoritesOnly ? "selected" : ""}`} onClick={() => setFavoritesOnly(v => !v)}><Heart size={15}/> 收藏</button></div><div className="section-meta"><span>{filteredWebsites.length} 个网站</span><span><LayoutGrid size={14}/> 网格视图</span></div>{filteredWebsites.length ? <div className="cards-grid">{filteredWebsites.map(w => <div className="link-card" key={w.id}><div className="card-top"><SiteIcon url={w.url} icon={w.icon} className="site-icon large"/><div className="card-controls"><button title={w.favorite ? "取消收藏" : "收藏"} onClick={() => mutate("website.save", { ...w, favorite: !w.favorite }).catch(e => notify(e.message))}><Heart size={16} fill={w.favorite ? "currentColor" : "none"}/></button><button title="编辑" onClick={() => openForm("website", w)}><MoreHorizontal size={18}/></button></div></div><a href={w.url} target="_blank" rel="noopener noreferrer" className="card-name">{w.name}<ExternalLink size={14}/></a><p>{w.description || host(w.url)}</p><div className="card-foot"><span>{w.collection || "未分类"}</span><div>{w.tags.slice(0,2).map(t => <Tag key={t}>{t}</Tag>)}</div></div></div>)}</div> : <EmptyState icon={Globe2} title="没有找到网站" text={data.websites.length ? "试试其他关键词或筛选条件。" : "添加一个常用网站，开始整理。"} action={!data.websites.length ? <Btn kind="primary" onClick={() => openForm("website")}><Plus size={15}/> 添加网站</Btn> : null}/>}</>}

          {section === "Services" && <><div className="services-intro"><div><span className="panel-kicker">基础设施</span><h2>设备与服务入口</h2><p>集中管理每个本地地址。</p></div><Btn onClick={() => openForm("server")}><Plus size={15}/> 添加设备</Btn></div>{data.servers.length === 0 && data.services.length === 0 ? <EmptyState icon={HardDrive} title="从这里开始管理网络" text="添加设备或服务，建立你的入口。" action={<Btn kind="primary" onClick={() => openForm("server")}>添加设备</Btn>}/> : <div className="service-groups">{data.servers.map(server => <div className="device-panel" key={server.id}><div className="device-head"><span className="device-icon"><HardDrive size={20}/></span><div><h3>{server.name}</h3><p>{server.host} <span>·</span> {server.environment === "Home" ? "家庭" : server.environment}</p></div><button className="icon-btn" title="编辑设备" onClick={() => openForm("server", server)}><MoreHorizontal size={18}/></button></div><div className="device-services">{data.services.filter(s => s.serverId === server.id).map(s => <ServiceRow key={s.id} service={s} edit={() => openForm("service", s)} notify={notify}/>)}<button className="add-child" onClick={() => openForm("service", { serverId: server.id, host: server.host })}><Plus size={15}/> 添加服务</button></div></div>)}{data.services.filter(s => !s.serverId).length > 0 && <div className="device-panel"><div className="device-head"><span className="device-icon"><Compass size={20}/></span><div><h3>独立服务</h3><p>未关联设备的服务入口</p></div></div><div className="device-services">{data.services.filter(s => !s.serverId).map(s => <ServiceRow key={s.id} service={s} edit={() => openForm("service", s)} notify={notify}/>)}</div></div>}</div>}</>}

          {(section === "Imported" || section === "Private") && (!keyReady ? <div className="locked-panel"><div className="locked-glow"><LockKeyhole size={32}/></div><span className="panel-kicker">端到端加密</span><h2>加密区域已锁定</h2><p>输入主密码即可访问已导入书签和私密网址。主密码不会离开此浏览器。</p><Btn kind="primary" onClick={() => setModal("unlock")}><KeyRound size={16}/> {data.vault ? "解锁加密区域" : "设置主密码"}</Btn></div> : section === "Imported" ? <><div className="toolbar"><div className="inline-search"><Search size={17}/><input placeholder="搜索已导入书签..." value={query} onChange={e => setQuery(e.target.value)}/></div><Btn onClick={() => lock()}><LockKeyhole size={15}/> 锁定</Btn></div><div className="section-meta"><span>{imported.length} 条已导入书签</span><span>浏览器 → 配置档案 → 原文件夹</span></div>{imported.length ? <div className="imported-tree">{Object.entries(Object.groupBy(imported, s => s.browser || "其他")).map(([browser, items]) => <div className="tree-group" key={browser}><div className="tree-title"><Globe2 size={17}/><strong>{browser}</strong><span>{items?.length}</span></div>{Object.entries(Object.groupBy(items || [], s => s.profile || "Default")).map(([profile, profileItems]) => <div className="profile-group" key={profile}><div className="profile-title">{profile} <span>{profileItems?.length}</span></div>{Object.entries(Object.groupBy(profileItems || [], s => s.folder || "其他收藏夹")).map(([folder, folderItems]) => <div className="folder-group" key={folder}><div className="folder-title">{folder}</div>{folderItems?.map(item => <div className="import-row" key={item.id}><span className="mini-icon"><Globe2 size={16}/></span><a href={item.url} target="_blank" rel="noopener noreferrer"><strong>{item.name}</strong><small>{host(item.url)}</small></a><button title="移至网站" onClick={() => moveImported(item, "website")}><Globe2 size={16}/></button><button title="移至私密保险库" onClick={() => moveImported(item, "private")}><LockKeyhole size={15}/></button><button title="删除" onClick={() => doDelete("protected.delete", item.id)}><Trash2 size={15}/></button></div>)}</div>)}</div>)}</div>)}</div> : <EmptyState icon={ArrowDownToLine} title="收件箱为空" text="可从 Chrome、Edge 或 HTML 导出文件导入书签。" action={<Btn kind="primary" onClick={discover}><ArrowDownToLine size={15}/> 导入书签</Btn>}/>}</> : <><div className="toolbar"><div className="inline-search"><Search size={17}/><input placeholder="搜索私密网址..." value={query} onChange={e => setQuery(e.target.value)}/></div><Btn onClick={() => lock()}><LockKeyhole size={15}/> 锁定</Btn></div><div className="section-meta"><span>{privateItems.length} 条私密网址</span><span><ShieldCheck size={14}/> AES-256-GCM 加密</span></div>{privateItems.length ? <div className="cards-grid">{privateItems.map(item => <div className="link-card private-card" key={item.id}><div className="card-top"><span className="site-icon large private-icon"><KeyRound size={22}/></span><div className="card-controls"><button title="编辑" onClick={() => openForm("private", item)}><MoreHorizontal size={18}/></button><button title="删除" onClick={() => doDelete("protected.delete", item.id)}><Trash2 size={15}/></button></div></div><a href={item.url} target="_blank" rel="noopener noreferrer" className="card-name">{item.name}<ExternalLink size={14}/></a><p>{item.description || host(item.url)}</p><div className="card-foot"><span>{item.collection || "私密"}</span><div>{(item.tags || []).slice(0,2).map(t => <Tag key={t}>{t}</Tag>)}</div></div></div>)}</div> : <EmptyState icon={KeyRound} title="保险库为空" text="私密网址会先加密，再保存。" action={<Btn kind="primary" onClick={() => openForm("private")}><Plus size={15}/> 添加私密网址</Btn>}/>}</>)}

          {section === "Settings" && <div className="settings-grid"><div className="settings-card"><div className="settings-card-icon"><Sun size={20}/></div><div><h3>外观</h3><p>选择适合你的界面主题。</p><div className="segmented">{(["light","dark","system"] as const).map(t => <button key={t} className={theme === t ? "chosen" : ""} onClick={() => setTheme(t)}>{t === "light" ? "浅色" : t === "dark" ? "深色" : "跟随系统"}</button>)}</div></div></div><div className="settings-card"><div className="settings-card-icon"><ShieldCheck size={20}/></div><div><h3>加密区域</h3><p>已导入书签和私密网址共用一把主密钥。解密内容只保留在当前浏览器会话中。</p><div className="settings-actions"><span className={`pill ${keyReady ? "unlocked" : ""}`}>{keyReady ? "已解锁" : "已锁定"}</span><Btn onClick={() => keyReady ? lock() : setModal("unlock")}>{keyReady ? "立即锁定" : data.vault ? "解锁" : "设置保险库"}</Btn></div><Field label="无操作后自动锁定"><select value={autoLock} onChange={e => { const value = Number(e.target.value); setAutoLock(value); localStorage.setItem("hnova-autolock", String(value)); }}><option value={5}>5 分钟</option><option value={10}>10 分钟</option><option value={30}>30 分钟</option></select></Field></div></div><div className="settings-card"><div className="settings-card-icon"><ArrowDownToLine size={20}/></div><div><h3>导入历史</h3><p>导入批次仅用于记录历史，不作为书签目录。</p>{data.batches.length ? <div className="history-list">{data.batches.map(b => <div key={b.id}><span><strong>{b.source}</strong><small>{new Date(b.importedAt).toLocaleString()}</small></span><span>{b.scanned} 已扫描 · {b.added} 新增 · {b.skipped} 跳过</span></div>)}</div> : <span className="muted">暂无导入记录。</span>}</div></div><div className="settings-card"><div className="settings-card-icon"><HardDrive size={20}/></div><div><h3>本地优先</h3><p>数据保存在 SQLite 文件 <code>data/portal.db</code>。请备份数据库并妥善保管主密码；主密码无法找回。</p><span className="pill">仅限本机访问</span></div></div></div>}
        </>}
      </div>
    </main>

    {palette && <div className="overlay palette-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setPalette(false); }}><div className="palette"><div className="palette-input"><Search size={20}/><input autoFocus placeholder="搜索网站、服务和已解锁的网址..." value={paletteQuery} onChange={e => setPaletteQuery(e.target.value)}/><kbd>ESC</kbd></div><div className="palette-results">{searchResults(paletteQuery).length ? searchResults(paletteQuery).map(item => <a key={`${item.type}-${item.id}`} href={item.url} target="_blank" rel="noopener noreferrer" onClick={() => setPalette(false)}>{item.type === "Website" ? <SiteIcon url={item.url} icon={item.icon} className="mini-icon"/> : <span className="mini-icon">{item.type === "Service" ? <ServerIcon size={16}/> : item.type === "Private" ? <KeyRound size={16}/> : <Globe2 size={16}/>}</span>}<span><strong>{item.name}</strong><small>{item.subtitle}</small></span><Tag>{resultLabels[item.type] || item.type}</Tag><ArrowRight size={15}/></a>) : <div className="palette-empty">没有找到结果。</div>}</div><div className="palette-footer"><span><kbd>↵</kbd> 打开结果</span><span><kbd>ESC</kbd> 关闭</span></div></div></div>}

    {modal && <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setModal(null); }}><div className={`dialog ${modal === "import" ? "import-dialog" : ""}`}><div className="dialog-head"><div><span className="panel-kicker">HNOVA PORTAL</span><h2>{modal === "unlock" ? data.vault ? "解锁加密区域" : "创建保险库" : modal === "import" ? "导入书签" : `${editing?.id ? "编辑" : "添加"}${formLabels[modal] || "项目"}`}</h2></div><button className="icon-btn" onClick={() => setModal(null)}><X size={19}/></button></div>
      {modal === "unlock" ? <form onSubmit={unlock} className="dialog-body"><p className="dialog-hint">{data.vault ? "输入主密码，在当前浏览器中解密加密网址。" : "设置主密码并妥善保管；忘记后无法恢复。"}</p><Field label="主密码"><input name="password" type="password" minLength={8} required autoFocus autoComplete="off"/></Field>{!data.vault && <Field label="确认主密码"><input name="confirm" type="password" minLength={8} required autoComplete="off"/></Field>}<div className="dialog-actions"><Btn onClick={() => setModal(null)}>取消</Btn><Btn kind="primary" type="submit" disabled={busy}>{busy ? "处理中..." : data.vault ? "解锁" : "创建保险库"}</Btn></div></form> : modal === "import" ? <div className="dialog-body"><p className="dialog-hint">选择本机浏览器配置档案或导出的 HTML 书签文件。导入前可先预览。</p><div className="import-source-list">{profiles.map(p => <button key={`${p.browser}-${p.profile}`} onClick={() => readProfile(p)}><Globe2 size={18}/><span><strong>{p.browser}</strong><small>{p.label} · {p.profile}</small></span><ArrowRight size={16}/></button>)}<label className="html-upload"><FileUp size={18}/><span><strong>HTML 书签文件</strong><small>选择导出文件</small></span><input type="file" accept=".html,.htm,text/html" onChange={e => { const file = e.target.files?.[0]; if (file) readHtml(file).catch(err => notify(err.message)); }}/><ArrowRight size={16}/></label></div>{preview && <div className="preview-box"><div className="preview-head"><strong>{preview.source}</strong><span>预览</span></div><div className="preview-stats"><div><strong>{preview.entries.length}</strong><span>书签</span></div><div><strong>{preview.folders}</strong><span>文件夹</span></div><div><strong>{duplicateCount}</strong><span>重复项</span></div></div><div className="preview-samples">{preview.entries.slice(0,4).map((e,i) => <div key={i}><span>{e.name}</span><small>{e.folder || "书签"}</small></div>)}</div><Field label="网址已存在时"><select value={duplicateMode} onChange={e => setDuplicateMode(e.target.value as typeof duplicateMode)}><option value="skip">跳过重复项</option><option value="keep">两条都保留</option><option value="merge">合并已导入的重复项</option></select></Field></div>}<div className="dialog-actions"><Btn onClick={() => { setModal(null); setPreview(null); }}>取消</Btn><Btn kind="primary" onClick={commitImport} disabled={!preview || busy || preview.entries.length === 0}>{busy ? "正在导入..." : "导入收件箱"}</Btn></div></div> : <form onSubmit={saveForm} className="dialog-body"><div className="form-grid"><Field label="名称"><input name="name" defaultValue={String(editing?.name || "")} required autoFocus placeholder="例如 GitHub"/></Field>{modal === "service" ? <><Field label="设备"><select name="serverId" defaultValue={String(editing?.serverId || "")}><option value="">独立服务</option>{data.servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><Field label="主机地址"><input name="host" defaultValue={String(editing?.host || "")} placeholder="192.168.1.100"/></Field><Field label="端口"><input name="port" type="number" min="1" max="65535" defaultValue={String(editing?.port || "")} placeholder="8096"/></Field><Field label="协议"><select name="protocol" defaultValue={String(editing?.protocol || "http")}><option value="http">HTTP</option><option value="https">HTTPS</option></select></Field><Field label="路径"><input name="path" defaultValue={String(editing?.path || "")} placeholder="/dashboard"/></Field></> : modal === "server" ? <><Field label="主机地址"><input name="host" defaultValue={String(editing?.host || "")} required placeholder="192.168.1.100"/></Field><Field label="环境"><input name="environment" defaultValue={String(editing?.environment || "家庭")} placeholder="家庭"/></Field></> : <Field label="URL"><input name="url" type="url" defaultValue={String(editing?.url || "")} required placeholder="https://example.com"/></Field>}{modal !== "server" && <><Field label={modal === "service" ? "环境" : "分类"}><input name={modal === "service" ? "environment" : "collection"} defaultValue={String(modal === "service" ? editing?.environment || "家庭" : editing?.collection || "")} placeholder="开发"/></Field><Field label="标签（用逗号分隔）"><input name="tags" defaultValue={Array.isArray(editing?.tags) ? editing.tags.join(", ") : ""} placeholder="AI、工具"/></Field><Field label="别名"><input name="alias" defaultValue={String(editing?.alias || "")} placeholder="gh"/></Field></>}</div>{modal === "website" && <Field label="图标 URL（可选）"><input name="icon" type="url" defaultValue={String(editing?.icon || "")} placeholder="https://example.com/favicon.ico"/></Field>}<Field label="描述"><textarea name="description" defaultValue={String(editing?.description || "")} rows={3} placeholder="简要说明..."/></Field>{modal === "private" && <Field label="私密备注"><textarea name="notes" defaultValue={String(editing?.notes || "")} rows={3}/></Field>}{modal === "website" && <label className="checkbox"><input name="favorite" type="checkbox" defaultChecked={!!editing?.favorite}/><Heart size={16}/> 加入收藏</label>}<div className="dialog-actions">{Boolean(editing?.id) && <Btn kind="danger" onClick={() => { const current = modal; setModal(null); doDelete(current === "private" ? "protected.delete" : `${current}.delete`, String(editing?.id)); }}><Trash2 size={15}/> 删除</Btn>}<span className="action-spacer"/><Btn onClick={() => setModal(null)}>取消</Btn><Btn kind="primary" type="submit" disabled={busy}>{busy ? "正在保存..." : "保存"}</Btn></div></form>}
    </div></div>}
    {toast && <div className="toast"><Check size={16}/>{toast}</div>}
  </div>;
}
