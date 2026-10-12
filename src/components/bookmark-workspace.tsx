"use client";

import { useEffect, useState } from "react";
import { ChevronRight, ExternalLink, Folder, FolderPlus, Globe2, Heart, KeyRound, MoreHorizontal, Search, Trash2 } from "lucide-react";
import SiteIcon from "@/components/site-icon";

export type FolderEntry = { id: string; name: string; parentId: string | null };
export type LinkEntry = { id: string; name: string; url: string; description?: string; icon?: string; folderId?: string | null; favorite?: boolean };
type Area = "website" | "imported" | "private";
type Transfer = { folders: Record<"website" | "private", FolderEntry[]>; move: (ids: string[], target: "website" | "private", folderId: string | null) => Promise<void> };
type Props = {
  area: Area; folders: FolderEntry[]; items: LinkEntry[];
  onCreateFolder: (name: string, parentId: string | null) => Promise<void>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onMoveFolder: (id: string, parentId: string | null) => Promise<void>;
  onDeleteFolder: (id: string) => Promise<void>;
  onMoveItems: (ids: string[], folderId: string | null) => Promise<void>;
  onDeleteItems: (ids: string[]) => Promise<void>;
  onAddItem?: (folderId: string | null) => void;
  onEditItem?: (item: LinkEntry) => void;
  onToggleFavorite?: (item: LinkEntry) => void;
  transfer?: Transfer;
  notify: (message: string) => void;
};

type DragPayload = { area: Area; type: "items" | "folder"; ids: string[] };
const labels: Record<Area, string> = { website: "网站", imported: "已导入", private: "私密" };
const dragType = "application/x-hnova-bookmarks";

export default function BookmarkWorkspace(props: Props) {
  const { area, folders, items, notify } = props;
  const [current, setCurrent] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [targetArea, setTargetArea] = useState<"website" | "private">("website");
  const [moveFolderId, setMoveFolderId] = useState("");
  const [transferFolderId, setTransferFolderId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setSelected(previous => previous.filter(id => items.some(item => item.id === id))), [items]);
  useEffect(() => { if (current && !folders.some(folder => folder.id === current)) setCurrent(null); }, [current, folders]);
  useEffect(() => setTransferFolderId(""), [targetArea]);

  const currentName = folders.find(folder => folder.id === current)?.name || labels[area];
  const matching = (item: LinkEntry) => `${item.name} ${item.url} ${item.description || ""}`.toLowerCase().includes(search.toLowerCase());
  const visibleItems = items.filter(item => search ? matching(item) : (item.folderId || null) === current);
  const visibleFolders = search ? folders.filter(folder => folder.name.toLowerCase().includes(search.toLowerCase())) : folders.filter(folder => folder.parentId === current);
  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every(item => selected.includes(item.id));
  const toggleVisible = () => setSelected(previous => allVisibleSelected ? previous.filter(id => !visibleItems.some(item => item.id === id)) : [...new Set([...previous, ...visibleItems.map(item => item.id)])]);
  const toggle = (id: string) => setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  const run = async (work: () => Promise<void>, success: string) => {
    try { setBusy(true); await work(); notify(success); }
    catch (error) { notify((error as Error).message); }
    finally { setBusy(false); }
  };
  const createFolder = () => {
    const name = window.prompt("文件夹名称")?.trim();
    if (name) void run(() => props.onCreateFolder(name, current), "文件夹已添加");
  };
  const renameFolder = (folder: FolderEntry) => {
    const name = window.prompt("重命名文件夹", folder.name)?.trim();
    if (name && name !== folder.name) void run(() => props.onRenameFolder(folder.id, name), "文件夹已重命名");
  };
  const deleteFolder = (folder: FolderEntry) => {
    if (!window.confirm(`删除「${folder.name}」及其中的所有内容？`)) return;
    void run(() => props.onDeleteFolder(folder.id), "文件夹已删除");
  };
  const deleteItems = (ids: string[]) => {
    if (!ids.length || !window.confirm(`删除选中的 ${ids.length} 个项目？`)) return;
    void run(async () => { await props.onDeleteItems(ids); setSelected([]); }, "已删除");
  };
  const moveItems = (ids: string[], folderId: string | null) => {
    if (!ids.length) return;
    void run(async () => { await props.onMoveItems(ids, folderId); setSelected([]); }, "已移动");
  };
  const startDrag = (event: React.DragEvent, payload: DragPayload) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(dragType, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", payload.ids.join(","));
  };
  const dragged = (event: React.DragEvent): DragPayload | null => {
    try { return JSON.parse(event.dataTransfer.getData(dragType)) as DragPayload; } catch { return null; }
  };
  const dropOn = (event: React.DragEvent, folderId: string | null) => {
    event.preventDefault(); setDragOver(null);
    const payload = dragged(event);
    if (!payload || payload.area !== area) return;
    if (payload.type === "items") moveItems(payload.ids, folderId);
    else if (payload.ids[0] !== folderId) void run(() => props.onMoveFolder(payload.ids[0], folderId), "文件夹已移动");
  };
  const dropDelete = (event: React.DragEvent) => {
    event.preventDefault(); setDragOver(null);
    const payload = dragged(event);
    if (!payload || payload.area !== area) return;
    if (payload.type === "items") deleteItems(payload.ids);
    else { const folder = folders.find(value => value.id === payload.ids[0]); if (folder) deleteFolder(folder); }
  };
  const dropHandlers = (id: string | null) => ({
    onDragOver: (event: React.DragEvent) => { event.preventDefault(); setDragOver(id || "root"); },
    onDragLeave: () => setDragOver(null),
    onDrop: (event: React.DragEvent) => dropOn(event, id)
  });
  const folderOptions = (source: FolderEntry[], parentId: string | null = null, depth = 0, seen = new Set<string>()): React.ReactNode[] => source.filter(folder => folder.parentId === parentId && !seen.has(folder.id)).flatMap(folder => {
    const next = new Set(seen); next.add(folder.id);
    return [<option key={folder.id} value={folder.id}>{"　".repeat(depth)}{folder.name}</option>, ...folderOptions(source, folder.id, depth + 1, next)];
  });
  const tree = (parentId: string | null = null, depth = 0, seen = new Set<string>()): React.ReactNode[] => folders.filter(folder => folder.parentId === parentId && !seen.has(folder.id)).flatMap(folder => {
    const next = new Set(seen); next.add(folder.id);
    return [<div key={folder.id}>
      <div className={`folder-tree-node ${current === folder.id ? "active" : ""} ${dragOver === folder.id ? "drop-active" : ""}`} style={{ paddingLeft: 12 + depth * 15 }}
        draggable onDragStart={event => startDrag(event, { area, type: "folder", ids: [folder.id] })} {...dropHandlers(folder.id)}>
        <button onClick={() => { setCurrent(folder.id); setSearch(""); }} title={folder.name}><Folder size={15}/><span>{folder.name}</span></button>
        <button className="folder-more" title="重命名" onClick={() => renameFolder(folder)}><MoreHorizontal size={14}/></button>
        <button className="folder-more" title="删除文件夹" onClick={() => deleteFolder(folder)}><Trash2 size={13}/></button>
      </div>
      {tree(folder.id, depth + 1, next)}
    </div>];
  });
  const crumbs: FolderEntry[] = [];
  let cursor = current;
  for (let count = 0; cursor && count < folders.length; count++) {
    const folder = folders.find(value => value.id === cursor);
    if (!folder) break;
    crumbs.unshift(folder); cursor = folder.parentId;
  }

  return <div className="bookmark-workspace">
    <aside className="folder-sidebar">
      <div className="folder-sidebar-head"><strong>文件夹</strong><button title="添加文件夹" onClick={createFolder}><FolderPlus size={17}/></button></div>
      <div className={`folder-root ${current === null ? "active" : ""} ${dragOver === "root" ? "drop-active" : ""}`} {...dropHandlers(null)}>
        <button onClick={() => { setCurrent(null); setSearch(""); }}><Folder size={15}/>{labels[area]}</button>
      </div>
      <div className="folder-tree">{tree()}</div>
    </aside>
    <section className="folder-content">
      <div className="folder-toolbar"><div className="folder-breadcrumb"><button {...dropHandlers(null)} onClick={() => setCurrent(null)}>{labels[area]}</button>{crumbs.map(folder => <span key={folder.id}><ChevronRight size={13}/><button {...dropHandlers(folder.id)} onClick={() => setCurrent(folder.id)}>{folder.name}</button></span>)}</div><div className="folder-actions"><button onClick={createFolder}><FolderPlus size={15}/> 添加文件夹</button>{props.onAddItem && <button onClick={() => props.onAddItem!(current)}><Globe2 size={15}/> 添加{area === "website" ? "网站" : "网址"}</button>}</div></div>
      <div className="folder-search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder={`搜索${labels[area]}...`}/></div>
      {selected.length > 0 && <div className="folder-selection"><strong>已选 {selected.length} 项</strong><button onClick={() => setSelected([])}>取消选择</button>
        <select value={moveFolderId} onChange={event => setMoveFolderId(event.target.value)}><option value="">移动到根目录</option>{folderOptions(folders)}</select><button disabled={busy} onClick={() => moveItems(selected, moveFolderId || null)}>移动</button>
        {props.transfer && <><select value={targetArea} onChange={event => setTargetArea(event.target.value as "website" | "private")}><option value="website">移至网站</option><option value="private">移至私密</option></select><select value={transferFolderId} onChange={event => setTransferFolderId(event.target.value)}><option value="">目标根目录</option>{folderOptions(props.transfer.folders[targetArea])}</select><button disabled={busy} onClick={() => void run(async () => { await props.transfer!.move(selected, targetArea, transferFolderId || null); setSelected([]); }, "已移动")}>批量移至</button></>}
        <button className="folder-delete-button" disabled={busy} onClick={() => deleteItems(selected)}><Trash2 size={14}/> 删除</button>
      </div>}
      <div className="folder-list-heading"><span>{currentName}</span><small>{visibleFolders.length} 个文件夹 · {visibleItems.length} 个网址</small>{visibleItems.length > 0 && <label className="folder-select-all"><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible}/> 全选当前网址</label>}</div>
      <div className="folder-list">
        {visibleFolders.map(folder => <div key={folder.id} className={`folder-list-row ${dragOver === folder.id ? "drop-active" : ""}`} draggable onDragStart={event => startDrag(event, { area, type: "folder", ids: [folder.id] })} {...dropHandlers(folder.id)}>
          <button className="folder-list-open" onClick={() => { setCurrent(folder.id); setSearch(""); }}><span className="folder-list-icon"><Folder size={19}/></span><strong>{folder.name}</strong><ChevronRight size={16}/></button>
          <button title="重命名" onClick={() => renameFolder(folder)}><MoreHorizontal size={16}/></button><button title="删除文件夹" onClick={() => deleteFolder(folder)}><Trash2 size={15}/></button>
        </div>)}
        {visibleItems.map(item => <div key={item.id} className={`folder-list-row link-row ${selected.includes(item.id) ? "selected" : ""}`} draggable onDragStart={event => { const ids = selected.includes(item.id) ? selected : [item.id]; setSelected(ids); startDrag(event, { area, type: "items", ids }); }}>
          <input type="checkbox" aria-label={`选择 ${item.name}`} checked={selected.includes(item.id)} onChange={() => toggle(item.id)}/>
          {area === "website" ? <SiteIcon url={item.url} icon={item.icon} className="mini-icon"/> : <span className="mini-icon">{area === "private" ? <KeyRound size={16}/> : <Globe2 size={16}/>}</span>}
          <a href={item.url} target="_blank" rel="noopener noreferrer"><strong>{item.name}</strong><small>{item.description || item.url}</small></a>
          {props.onToggleFavorite && <button title={item.favorite ? "取消收藏" : "收藏"} onClick={() => props.onToggleFavorite!(item)}><Heart size={16} fill={item.favorite ? "currentColor" : "none"}/></button>}
          {props.onEditItem && <button title="编辑" onClick={() => props.onEditItem!(item)}><MoreHorizontal size={16}/></button>}
          <ExternalLink size={14}/>
        </div>)}
        {!visibleFolders.length && !visibleItems.length && <div className="folder-empty">{search ? "没有找到匹配的内容" : "这个文件夹还没有内容，可添加文件夹或网址。"}</div>}
      </div>
      <div className={`folder-trash ${dragOver === "trash" ? "drop-active" : ""}`} onDragOver={event => { event.preventDefault(); setDragOver("trash"); }} onDragLeave={() => setDragOver(null)} onDrop={dropDelete}><Trash2 size={16}/> 拖到这里删除选中项目或文件夹</div>
    </section>
  </div>;
}
