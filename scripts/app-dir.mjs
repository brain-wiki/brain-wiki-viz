// Where the build goes: brain-wiki commits the bundle in src/brainwiki/viz/app/.
// Defaults to a sibling brain-wiki checkout; set BRAIN_WIKI_APP_DIR to build elsewhere.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function appDir() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  return resolve(root, process.env.BRAIN_WIKI_APP_DIR ?? "../brain-wiki/src/brainwiki/viz/app");
}

/** appDir(), refusing anything but brain-wiki's bundle folder, since a build empties its target. */
export function buildDir() {
  const dir = appDir();
  const inCheckout = existsSync(resolve(dir, "../../../../pyproject.toml"));
  if (!dir.replaceAll("\\", "/").endsWith("src/brainwiki/viz/app") || !inCheckout) {
    throw new Error(
      `${dir} is not src/brainwiki/viz/app in a brain-wiki checkout, and a build empties its target. ` +
        "Clone brain-wiki next to this repository, or set BRAIN_WIKI_APP_DIR.",
    );
  }
  return dir;
}
