/**
 * APEX Flow — HTTP-reitit (`src/flow/server/routes.ts`).
 *
 * - `GET /flow` palauttaa sivun.
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

const FLOW_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED_DIRS = new Set(["kernel", "model", "client"]);
const FILE_RE = /^[a-z0-9-]+\.ts$/;

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
  if (req.method !== "GET") return false;
  if (pathname === "/flow" || pathname === "/flow/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(renderFlowPage());
    return true;
  }
  const m = /^\/flow\/([a-z]+)\/([^/]+)$/.exec(pathname);
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
