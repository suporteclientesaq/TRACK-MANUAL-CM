// Iniciador do Track Manual.
// Confere o Node, instala o que falta, compila quando o código mudou,
// sobe o painel e abre o navegador. Feche esta janela para parar.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const MIN_NODE = [22, 13, 0];
const PORT_START = Number(process.env.PORT) || 3000;

function log(msg) {
  console.log(`\n[Track Manual] ${msg}`);
}

function fail(msg) {
  console.error(`\n[Track Manual] ${msg}\n`);
  if (process.platform === "win32") spawnSync("cmd", ["/c", "pause"], { stdio: "inherit" });
  process.exit(1);
}

// ---- 1. versão do Node ------------------------------------------------------
const ver = process.versions.node.split(".").map(Number);
const okNode =
  ver[0] > MIN_NODE[0] ||
  (ver[0] === MIN_NODE[0] && (ver[1] > MIN_NODE[1] || (ver[1] === MIN_NODE[1] && ver[2] >= MIN_NODE[2])));
if (!okNode) {
  fail(
    `Seu Node.js é a versão ${process.versions.node}. O painel precisa da 22.13 ou mais nova.\n` +
      `Baixe a versão LTS em https://nodejs.org e instale por cima. Depois rode este iniciador de novo.`
  );
}

// ---- 2. dependências ----------------------------------------------------------
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(cmd, args, label) {
  log(label);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) fail(`Falhou: ${label}. Veja a mensagem acima.`);
}

if (!fs.existsSync(path.join(ROOT, "node_modules", "next"))) {
  run(npm, ["install", "--no-audit", "--no-fund"], "Instalando o que o painel precisa (só na primeira vez, 1 a 3 minutos)…");
}

// ---- 3. compilação quando o código mudou -------------------------------------------
function sourceHash() {
  const h = createHash("sha1");
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else {
        const st = fs.statSync(p);
        h.update(`${path.relative(ROOT, p)}:${st.size}:${Math.floor(st.mtimeMs)}\n`);
      }
    }
  };
  for (const d of ["app", "lib"]) if (fs.existsSync(d)) walk(path.join(ROOT, d));
  for (const f of ["package.json", "next.config.mjs", "tsconfig.json"]) {
    if (fs.existsSync(f)) h.update(fs.readFileSync(f));
  }
  return h.digest("hex");
}

const stampFile = path.join(ROOT, ".next", "track-manual-fonte.txt");
const currentHash = sourceHash();
const built = fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"));
const stamp = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, "utf8").trim() : "";
if (!built || stamp !== currentHash) {
  run(
    process.execPath,
    [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "build"],
    built ? "O código mudou; preparando a nova versão (cerca de 1 minuto)…" : "Preparando o painel pela primeira vez (cerca de 1 minuto)…"
  );
  fs.writeFileSync(stampFile, currentHash);
}

// ---- 4. porta livre ------------------------------------------------------------
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "0.0.0.0");
  });
}
let port = PORT_START;
for (let i = 0; i < 10 && !(await portFree(port)); i++) port++;

// ---- 5. sobe o painel ----------------------------------------------------------
log(`Abrindo o painel na porta ${port}…`);
const server = spawn(
  process.execPath,
  [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)],
  { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, NODE_ENV: "production", NODE_NO_WARNINGS: "1" } }
);
server.on("exit", (code) => {
  if (code !== 0) fail(`O painel parou com erro (código ${code}).`);
  process.exit(0);
});
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    server.kill();
    process.exit(0);
  });
}

// ---- 6. espera responder e abre o navegador ------------------------------------------
const url = `http://localhost:${port}`;
const deadline = Date.now() + 60_000;
let up = false;
while (Date.now() < deadline) {
  try {
    const r = await fetch(`${url}/login`, { redirect: "manual" });
    if (r.status > 0) {
      up = true;
      break;
    }
  } catch {
    // ainda subindo
  }
  await new Promise((r) => setTimeout(r, 500));
}
if (!up) fail("O painel não respondeu em 60 segundos. Feche esta janela e tente de novo.");

const lan = Object.values(os.networkInterfaces())
  .flat()
  .find((i) => i && i.family === "IPv4" && !i.internal)?.address;

console.log(`
==========================================================
  Track Manual está no ar.

  Neste computador:  ${url}
${lan ? `  No celular (mesmo Wi-Fi):  http://${lan}:${port}\n` : ""}
  Para parar, feche esta janela (ou aperte Ctrl+C).
==========================================================
`);

try {
  if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  else if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
} catch {
  // sem navegador padrão: o endereço está impresso acima
}
