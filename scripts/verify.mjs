// Rebuild this checkout into a temporary directory and compare it with the committed bundle in
// brain-wiki (BRAIN_WIKI_APP_DIR or the sibling checkout). Exit 1 if they differ.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { appDir } from "./app-dir.mjs";

const IGNORED = new Set(["THIRD_PARTY_NOTICES.txt", "BUILD_INFO.json"]);

function files(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, base);
    return IGNORED.has(name) ? [] : [relative(base, path)];
  });
}

const target = appDir();
const out = mkdtempSync(join(tmpdir(), "brain-viz-"));
try {
  execFileSync("npx", ["vite", "build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], { stdio: "inherit" });
  const built = files(out).sort();
  const committed = files(target).sort();
  const differ = [...new Set([...built, ...committed])].filter((f) => {
    if (!built.includes(f) || !committed.includes(f)) return true;
    return !readFileSync(join(out, f)).equals(readFileSync(join(target, f)));
  });
  if (differ.length) {
    console.error(`bundle in ${target} differs from this source: ${differ.join(", ")}`);
    process.exit(1);
  }
  console.log(`bundle in ${target} matches this source`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
