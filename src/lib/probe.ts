export async function probeHttp(url: string, timeoutMs = 5000) {
  try {
    let response = await fetch(url, { method: "HEAD", redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if ([404, 405, 410, 501].includes(response.status)) {
      response = await fetch(url, { method: "GET", redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
      await response.body?.cancel();
    }
    return { reachable: true, code: response.status, state: response.status === 404 || response.status === 410 ? "broken" as const : response.status >= 200 && response.status < 400 ? "ok" as const : "unknown" as const };
  } catch {
    return { reachable: false, code: null, state: "unknown" as const };
  }
}
