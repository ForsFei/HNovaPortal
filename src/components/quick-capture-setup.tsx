"use client";

import { useEffect, useRef } from "react";
import { captureBookmarklet } from "@/lib/quick-capture";

export default function QuickCaptureSetup({ notify }: { notify: (message: string) => void }) {
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => { link.current?.setAttribute("href", captureBookmarklet); }, []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(captureBookmarklet); notify("已复制快速收藏脚本，可在浏览器中新建收藏夹网址并粘贴"); }
    catch { notify("复制失败，请手动选择下面的脚本"); }
  };
  return <div className="settings-card capture-card"><div className="settings-card-icon"><span>＋</span></div><div><h3>快速收藏当前网页</h3><p>把下面的“收藏到 HNova”拖到浏览器收藏夹栏。以后浏览网页时点它，Portal 会新开标签并预填名称与网址，你再选文件夹保存。</p><div className="settings-actions"><a ref={link} className="btn btn-primary capture-bookmarklet" draggable onClick={event => event.preventDefault()}>收藏到 HNova</a><button className="btn btn-secondary" onClick={() => void copy()}>复制脚本</button></div><details className="capture-code"><summary>手动创建书签时使用</summary><textarea readOnly value={captureBookmarklet} onFocus={event => event.currentTarget.select()}/></details></div></div>;
}
