import type { LinkTarget } from "../types";

const WIKILINK = /!?\[\[([^[\]\n]+?)\]\]/g;
const FENCE = /^\s*(```+|~~~+)/;
const ITEM = /^\s*([-*+]|\d+[.)]|\|)\s/;

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

/**
 * Where a note's body links to `id`: each paragraph that holds such a wikilink, or just the
 * lines of a list or table that do, so a long list shows only the item that links. Code blocks
 * are skipped, as the preview does not resolve links in them.
 */
export function linkPassages(markdown: string, links: Record<string, LinkTarget>, id: string, max = 3): string[] {
  const resolve = resolver(links);
  const out: string[] = [];
  let block: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (block.length && out.length < max) {
      if (block.some((l) => ITEM.test(l))) {
        // A list item keeps the lines that continue it; a table row stands alone.
        const items: string[][] = [];
        for (const line of block) {
          if (ITEM.test(line) || !items.length) items.push([line]);
          else items[items.length - 1].push(line);
        }
        for (const item of items) {
          if (out.length < max && item.some((l) => mentions(l, resolve, id))) out.push(item.map((l) => l.trim()).join("\n"));
        }
      } else if (block.some((l) => mentions(l, resolve, id))) {
        out.push(block.join("\n").trim());
      }
    }
    block = [];
  };
  for (const line of markdown.split("\n")) {
    const marker = FENCE.exec(line);
    if (marker) {
      flush();
      fence = fence && marker[1].startsWith(fence.slice(0, 3)) ? null : (fence ?? marker[1]);
      continue;
    }
    if (fence) continue;
    if (!line.trim() || /^#{1,6}\s/.test(line)) flush();
    else block.push(line);
  }
  flush();
  return out;
}

/** The entries of a property (a string or a list) whose wikilink resolves to `id`. */
export function propertyEntries(value: unknown, links: Record<string, LinkTarget>, id: string): string[] {
  const resolve = resolver(links);
  const items = Array.isArray(value) ? value : value == null ? [] : [value];
  return items.map(String).filter((v) => mentions(v, resolve, id));
}
