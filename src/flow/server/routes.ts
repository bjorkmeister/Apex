/**
 * APEX Flow — HTTP-reitit (`src/flow/server/routes.ts`).
 *
 * - `GET /` palauttaa APEX Studion (vanha `/flow` ohjataan tänne, War Room on `/classic`).
 * - `GET /api/flow/status` kertoo, onko kielimalli kytketty.
 * - `POST /api/flow/{chat,genesis,widget,advisors,market}` kielimallia käyttävät toiminnot.
 * - `GET /flow/{kernel|model|client}/<tiedosto>.ts` palauttaa saman TypeScript-lähdekoodin
 *   selaimelle JavaScriptinä (tyypit riisutaan Node.js:n `stripTypeScriptTypes`-funktiolla).
 *   Näin selain ja testit ajavat täsmälleen samaa laskentakoodia.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as nodeModule from "node:module";
import type { IncomingMessage, ServerResponse } from "node:http";
import { renderFlowPage } from "./page.ts";
import { handleChat } from "./chat.ts";
import { handleAdvisors, handleGenesis, handleMarket, handleWidget, llmStatus } from "./ai.ts";

const FLOW_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED_DIRS = new Set(["kernel", "model", "client", "i18n"]);
const FILE_RE = /^[a-z0-9-]+\.ts$/;
/** Selaimen moduulipolku: /flow/<hakemisto>/<tiedosto>.ts */
export const MODULE_PATH_RE = /^\/flow\/([a-z0-9]+)\/([^/]+)$/;

type StripFn = (code: string, opts?: { mode?: "strip" | "transform" }) => string;
const strip = (nodeModule as unknown as { stripTypeScriptTypes?: StripFn }).stripTypeScriptTypes;

const cache = new Map<string, { mtimeMs: number; js: string }>();

/** Muuntaa TypeScript-tiedoston selaimelle. Palauttaa `null`, jos polku ei ole sallittu. */
export function transpileFlowModule(dir: string, file: string): string | null {
  if (!ALLOWED_DIRS.has(dir) || !FILE_RE.test(file)) return null;
  const abs = path.join(FLOW_DIR, dir, file);
  if (!abs.startsWith(FLOW_DIR + path.sep) || !fs.existsSync(abs)) return null;
  const stat = fs.statSync(abs);
  const hit = cache.get(abs);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.js;
  if (!strip) throw new Error("Node.js ei tue stripTypeScriptTypes-funktiota (vaatii Node 23.2+).");
  const js = strip(fs.readFileSync(abs, "utf-8"), { mode: "strip" });
  cache.set(abs, { mtimeMs: stat.mtimeMs, js });
  return js;
}

/** Käsittelee APEX Flow -pyynnön. Palauttaa `true`, jos pyyntö käsiteltiin. */
export function handleFlowRequest(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  const post = POST_HANDLERS[pathname];
  if (req.method === "POST" && post) {
    void handlePost(req, res, post);
    return true;
  }
  if (req.method !== "GET") return false;
  if (pathname === "/api/flow/status") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(llmStatus()));
    return true;
  }
  if (pathname === "/flow" || pathname === "/flow/") {
    res.writeHead(302, { Location: "/" });
    res.end();
    return true;
  }
  if (pathname === "/" || pathname === "/studio") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(renderFlowPage());
    return true;
  }
  const m = MODULE_PATH_RE.exec(pathname);
  if (!m) return false;
  try {
    const js = transpileFlowModule(m[1], m[2]);
    if (js === null) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return true;
    }
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(js);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`APEX Flow: moduulin käännös epäonnistui: ${(err as Error).message}`);
  }
  return true;
}

const MAX_BODY = 256 * 1024;

const POST_HANDLERS: Record<string, (body: unknown) => Promise<unknown>> = {
  "/api/flow/chat": handleChat,
  "/api/flow/genesis": handleGenesis,
  "/api/flow/widget": handleWidget,
  "/api/flow/advisors": handleAdvisors,
  "/api/flow/market": handleMarket,
};

async function handlePost(req: IncomingMessage, res: ServerResponse, handler: (body: unknown) => Promise<unknown>): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += b.length;
      if (size > MAX_BODY) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Pyyntö on liian suuri." }));
        return;
      }
      chunks.push(b);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
    const out = await handler(body);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(out));
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: `Virheellinen pyyntö: ${(err as Error).message}` }));
  }
}
