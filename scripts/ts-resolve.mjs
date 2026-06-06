// Minimal ESM resolver hook so Node can run the project's TypeScript sources
// directly (which use Vite-style extensionless imports like `./geo`). Combined
// with Node's built-in type-stripping this lets the BRouter test harness import
// the real optimiser code instead of a copy. Used via `node --import`.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/.test(specifier)) {
    const base = dirname(fileURLToPath(context.parentURL));
    for (const ext of [".ts", ".tsx", ".js", ".mjs"]) {
      const candidate = resolvePath(base, specifier + ext);
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
