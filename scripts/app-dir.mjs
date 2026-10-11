// Where the build goes: brain-wiki commits the bundle in src/brainwiki/viz/app/.
// Defaults to a sibling brain-wiki checkout; set BRAIN_WIKI_APP_DIR to build elsewhere.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function appDir() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  return resolve(root, process.env.BRAIN_WIKI_APP_DIR ?? "../brain-wiki/src/brainwiki/viz/app");
}
