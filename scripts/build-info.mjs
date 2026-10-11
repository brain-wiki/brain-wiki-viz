// Stamp the bundle with the commit it was built from, so brain-wiki can tell which source
// produced it and CI can rebuild that exact commit (npm run verify). Runs after `vite build`.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { appDir } from "./app-dir.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const info = {
  source: "brain-wiki-viz",
  commit: git("rev-parse", "HEAD"),
  dirty: git("status", "--porcelain", "--", ".").length > 0,
};
writeFileSync(join(appDir(), "BUILD_INFO.json"), JSON.stringify(info, null, 2) + "\n");
console.log(`build info: ${info.commit.slice(0, 12)}${info.dirty ? " (dirty)" : ""}`);
