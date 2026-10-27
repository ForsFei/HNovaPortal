import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(process.cwd(), "..");

type WebApp = { kind: "web"; project: string; port: number; entry: string; args: string[]; prerequisite: string };
type DesktopApp = { kind: "desktop"; project: string; port: number; exe: string };
type App = WebApp | DesktopApp;

const apps: Record<number, App> = {
  43170: { kind: "web", project: "10HGame", port: 43170, entry: "server.mjs", args: ["--port", "43170"], prerequisite: "server.mjs" },
  43110: { kind: "web", project: "01HNovaAtlas", port: 43110, entry: "node_modules/serve/build/main.js", args: ["out", "--listen", "tcp://127.0.0.1:43110"], prerequisite: "out/index.html" },
  43120: { kind: "web", project: "02HNovaMuse", port: 43120, entry: "node_modules/next/dist/bin/next", args: ["start", "--hostname", "127.0.0.1", "--port", "43120"], prerequisite: ".next/BUILD_ID" },
  43130: { kind: "desktop", project: "03HNovaPlay", port: 43130, exe: "src/HNovaPlay/bin/Debug/net8.0-windows/HNovaPlay.exe" },
  43140: { kind: "desktop", project: "04HNovaReader", port: 43140, exe: "HNovaReader/bin/Release/net8.0-windows/win-x64/HNovaReader.exe" },
  43150: { kind: "desktop", project: "05HNovaArchive", port: 43150, exe: "src/HDecompressHelper/bin/Release/net8.0-windows/HDecompressHelper.exe" },
  43160: { kind: "web", project: "06HNovaTrainEcho", port: 43160, entry: "node_modules/next/dist/bin/next", args: ["start", "--hostname", "127.0.0.1", "--port", "43160"], prerequisite: ".next/BUILD_ID" },
};

export const launchablePorts = Object.keys(apps).map(Number);

function directory(app: App) { return path.join(root, app.project); }

function listening(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (value: boolean) => { socket.destroy(); resolve(value); };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

async function desktopRunning(exe: string): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    const { stdout } = await execFileAsync("tasklist.exe", ["/FI", `IMAGENAME eq ${path.basename(exe)}`, "/FO", "CSV", "/NH"], { windowsHide: true, timeout: 3000 });
    return stdout.toLowerCase().includes(`"${path.basename(exe).toLowerCase()}"`);
  } catch { return false; }
}

export async function appStatus(port: number) {
  const app = apps[port];
  if (!app) return null;
  const available = existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ directory(app), app.kind === "web" ? app.prerequisite : app.exe));
  const running = app.kind === "web" ? await listening(port) : await desktopRunning(app.exe);
  return { kind: app.kind, available, running };
}

export async function startApp(port: number) {
  const app = apps[port];
  if (!app) throw new Error("不支持启动此项目");
  if (process.platform !== "win32") throw new Error("只能在 Windows 本机启动这些项目");
  const status = await appStatus(port);
  if (status?.running) return { ...status, message: "已经在运行" };
  if (!status?.available) throw new Error("未找到已构建的程序，请先在项目目录完成构建");
  const cwd = directory(app);
  const command = app.kind === "web" ? process.execPath : path.join(/* turbopackIgnore: true */ cwd, app.exe);
  const args = app.kind === "web" ? [path.join(/* turbopackIgnore: true */ cwd, app.entry), ...app.args] : [];
  const child = spawn(command, args, { cwd, detached: true, stdio: "ignore", windowsHide: app.kind === "web" });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  return { kind: app.kind, available: true, running: true, message: app.kind === "web" ? "正在启动服务" : "已启动应用" };
}
