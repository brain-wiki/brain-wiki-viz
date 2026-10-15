// The lockfile must resolve every package from the public npm registry, at the tarball URL the
// registry serves (<registry>/<name>/-/<name without scope>-<version>.tgz), so anyone can rebuild.
import { readFileSync } from "node:fs";

const PUBLIC = "https://registry.npmjs.org/";
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const problems = [];
for (const [key, meta] of Object.entries(lock.packages)) {
  if (!meta.resolved) continue;
  if (!meta.resolved.startsWith(PUBLIC)) {
    problems.push(`${key}: resolved from ${new URL(meta.resolved).host}, not the public registry`);
    continue;
  }
  const name = meta.name ?? key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
  const expected = `${PUBLIC}${name}/-/${name.split("/").pop()}-${meta.version}.tgz`;
  if (meta.resolved !== expected) problems.push(`${key}: ${meta.resolved} (expected ${expected})`);
}
if (problems.length) {
  console.error(`package-lock.json has tarball URLs the public registry does not serve:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("package-lock.json: public registry only");
