// The lockfile must resolve every package from the public npm registry, so anyone can rebuild.
import { readFileSync } from "node:fs";

const PUBLIC = "https://registry.npmjs.org/";
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const bad = [...new Set(Object.values(lock.packages).filter((m) => m.resolved && !m.resolved.startsWith(PUBLIC)).map((m) => new URL(m.resolved).host))];
if (bad.length) {
  console.error(`package-lock.json resolves from non-public registries: ${bad.join(", ")}`);
  process.exit(1);
}
console.log("package-lock.json: public registry only");
