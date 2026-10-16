"use client";

import { useEffect, useMemo, useRef } from "react";

type Props = {
  paths: string[][];
  selected: string[];
  rootSelected: boolean;
  rootCount: number;
  counts: Map<string, number>;
  onToggle: (path: string[]) => void;
  onRootToggle: () => void;
  onAll: (selected: boolean) => void;
};

function FolderCheck({ checked, mixed, onChange }: { checked: boolean; mixed: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} />;
}

export default function ImportFolderSelection({ paths, selected, rootSelected, rootCount, counts, onToggle, onRootToggle, onAll }: Props) {
  const totals = useMemo(() => {
    const result = new Map<string, { folders: number; selected: number; bookmarks: number }>();
    const selectedSet = new Set(selected);
    for (const path of paths) {
      const ownKey = JSON.stringify(path);
      for (let depth = 1; depth <= path.length; depth++) {
        const key = JSON.stringify(path.slice(0, depth));
        const value = result.get(key) || { folders: 0, selected: 0, bookmarks: 0 };
        value.folders++;
        if (selectedSet.has(ownKey)) value.selected++;
        value.bookmarks += counts.get(ownKey) || 0;
        result.set(key, value);
      }
    }
    return result;
  }, [paths, selected, counts]);
  return <div className="import-folder-selection">
    <div className="import-folder-title"><strong>选择要导入的文件夹</strong><span><button type="button" onClick={() => onAll(true)}>全选</button><button type="button" onClick={() => onAll(false)}>清空</button></span></div>
    <div className="import-folder-list">
      {rootCount > 0 && <label className="import-folder-row"><FolderCheck checked={rootSelected} mixed={false} onChange={onRootToggle}/><span>未分类书签</span><small>{rootCount}</small></label>}
      {paths.map(path => {
        const total = totals.get(JSON.stringify(path))!;
        return <label key={JSON.stringify(path)} className="import-folder-row" style={{ paddingLeft: 10 + (path.length - 1) * 20 }}>
          <FolderCheck checked={total.selected === total.folders} mixed={total.selected > 0 && total.selected < total.folders} onChange={() => onToggle(path)}/>
          <span title={path.join(" / ")}>{path[path.length - 1]}</span><small>{total.bookmarks}</small>
        </label>;
      })}
      {!paths.length && !rootCount && <div className="muted">没有可导入的书签或文件夹。</div>}
    </div>
  </div>;
}
