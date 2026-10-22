import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !path.extname(specifier)) {
    const parentPath = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
    const candidateFile = path.resolve(parentPath, `${specifier}.ts`);
    if (fs.existsSync(candidateFile)) {
      return nextResolve(pathToFileURL(candidateFile).href, context);
    }
    const candidateIndex = path.resolve(parentPath, specifier, "index.ts");
    if (fs.existsSync(candidateIndex)) {
      return nextResolve(pathToFileURL(candidateIndex).href, context);
    }
  }
  return nextResolve(specifier, context);
}
