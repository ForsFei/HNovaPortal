"use client";

import { useMemo, useState } from "react";
import { groupDuplicates, type DuplicateEntry } from "@/lib/duplicates";

const areaName = { website: "网站", imported: "已导入", private: "私密" };

export default function DuplicateCleaner({ entries, onKeep, notify }: { entries: DuplicateEntry[]; onKeep: (keep: DuplicateEntry, others: DuplicateEntry[], merge: boolean) => Promise<void>; notify: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => groupDuplicates(entries), [entries]);
  const keep = async (members: DuplicateEntry[], chosen: DuplicateEntry, merge: boolean) => {
    if (!window.confirm(`保留选中的一条，将另外 ${members.length - 1} 条移入回收站？`)) return;
    try { setBusy(true); await onKeep(chosen, members.filter(entry => entry !== chosen), merge); notify("重复网址已整理，可在回收站恢复其他条目"); }
    catch (error) { notify((error as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="settings-card duplicate-card"><div className="settings-card-icon"><span>≡</span></div><div><h3>重复网址清理</h3><p>按规范化后的网址分组。解锁后会一起显示已导入和私密网址；清理的其他条目进入回收站。合并描述时不会把私密内容复制到公开网站。</p>
    {groups.length ? <><strong className="duplicate-count">{groups.length} 组重复网址</strong><div className="duplicate-groups">{groups.map(([url, members]) => <details key={url}><summary>{members.length} 条 · {url}</summary><div>{members.map(entry => <div className="duplicate-entry" key={`${entry.area}-${entry.id}`}><span><strong>{entry.name}</strong><small>{areaName[entry.area]} · {entry.location}</small></span><button disabled={busy} onClick={() => void keep(members, entry, false)}>保留此条</button><button disabled={busy} onClick={() => void keep(members, entry, true)}>合并描述并保留</button></div>)}</div></details>)}</div></> : <span className="muted">没有发现重复网址。</span>}
  </div></div>;
}
