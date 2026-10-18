import type { LinkTarget } from "../types";

const WIKILINK = /!?\[\[([^[\]\n]+?)\]\]/g;

/** The note a wikilink's text resolves to, the way the preview resolves it (exact, then any case). */
function resolver(links: Record<string, LinkTarget>): (raw: string) => string | undefined {
  const lower = new Map(Object.entries(links).map(([k, v]) => [k.toLowerCase(), v.id]));
  return (raw) => {
    const target = raw.split("|")[0].split("#")[0].trim();
    return links[target]?.id ?? lower.get(target.toLowerCase());
  };
}

function mentions(line: string, resolve: (raw: string) => string | undefined, id: string): boolean {
  for (const m of line.matchAll(WIKILINK)) if (resolve(m[1]) === id) return true;
  return false;
}

/** The entries of a property (a string or a list) whose wikilink resolves to `id`. */
export function propertyEntries(value: unknown, links: Record<string, LinkTarget>, id: string): string[] {
  const resolve = resolver(links);
  const items = Array.isArray(value) ? value : value == null ? [] : [value];
  return items.map(String).filter((v) => mentions(v, resolve, id));
}
