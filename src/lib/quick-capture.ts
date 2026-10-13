export const captureBookmarklet = 'javascript:(()=>{const p="http://127.0.0.1:43100/?capture="+encodeURIComponent(location.href)+"&title="+encodeURIComponent(document.title.slice(0,160));window.open(p,"_blank","noopener")})()';

export function captureFromSearch(search: string) {
  const params = new URLSearchParams(search);
  const raw = params.get("capture");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.href.length > 2048) return null;
    return { name: (params.get("title") || url.hostname).trim().slice(0, 160) || url.hostname, url: url.href };
  } catch { return null; }
}
