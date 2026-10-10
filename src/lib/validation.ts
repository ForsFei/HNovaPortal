export function string(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
export function required(value: unknown, max = 500): string {
  const result = string(value, max);
  if (!result) throw new Error("必填字段不能为空");
  return result;
}
export function tags(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(v => string(v, 40)).filter(Boolean))].slice(0, 20) : [];
}
export function safeUrl(value: unknown): string {
  const raw = required(value, 2048);
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("请输入完整的 http 或 https 网址"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("只支持 http 和 https 网址");
  return parsed.toString();
}
export function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) url.port = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (url.pathname === "/") url.pathname = "";
    return url.toString().replace(/\/$/, "");
  } catch { return value.trim(); }
}
export function localRequest(request: Request) {
  const host = request.headers.get("host") || "";
  const origin = request.headers.get("origin");
  if (!/^127\.0\.0\.1:43100$/.test(host) && !/^localhost:43100$/.test(host)) throw new Error("只允许本机访问");
  if (origin && new URL(origin).host !== host) throw new Error("请求来源不匹配");
}
