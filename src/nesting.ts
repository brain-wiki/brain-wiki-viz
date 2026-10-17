// Moving one nesting level at a time (Ctrl/⌘+↑ and +↓, visualizer.md §5): the breadcrumb's chain
// Overview › group › parent topics › topic › folders › note, one step at a time.
import { type Branch, folderTree } from "./layout";
import type { Focus } from "./lod";
import type { TopicData, World } from "./types";

type Places = Pick<World, "constellations" | "topics">;

/** The folder note that stands for `key`, else for its nearest ancestor; null at the topic. */
function folderNote(branches: Map<string, Branch>, key: string | null): string | null {
  for (let b = key === null ? undefined : branches.get(key); b && b.key !== ""; b = b.parent === null ? undefined : branches.get(b.parent)) {
    if (b.note) return b.note;
  }
  return null;
}

/** One level up, or null at the overview. `data` is the focused topic's data, when loaded. */
export function nestUp(f: Focus, places: Places, data: TopicData | null): Focus | null {
  const constellation = f.constellation;
  if (f.note && f.topic) {
    if (data && data.slug === f.topic && f.note !== data.hub) {
      const { branches, folderOf } = folderTree(data);
      const key = folderOf.get(f.note) ?? "";
      const own = branches.get(key);
      // A folder note's parent is the folder above; any other note's is its own folder.
      const from = own?.note === f.note ? (own.parent ?? null) : key;
      const note = folderNote(branches, from);
      if (note) return { constellation, topic: f.topic, note };
    }
    return { constellation, topic: f.topic };
  }
  if (f.topic) {
    const parent = places.topics.find((t) => t.slug === f.topic)?.parent;
    if (parent && places.topics.some((t) => t.slug === parent)) return { topic: parent };
    return { constellation };
  }
  if (f.constellation) return {};
  return null;
}

/** One level down, biggest first: the places directly inside the focus. Empty for a plain note. */
export function nestChildren(f: Focus, places: Places, data: TopicData | null): Focus[] {
  if (!f.constellation && !f.topic) {
    const notes = (id: string) =>
      places.topics.filter((t) => places.constellations.find((c) => c.id === id)?.topics.includes(t.slug)).reduce((s, t) => s + t.notes, 0);
    return [...places.constellations].sort((a, b) => notes(b.id) - notes(a.id) || a.title.localeCompare(b.title)).map((c) => ({ constellation: c.id }));
  }
  if (!f.topic) {
    const inside = new Set(places.constellations.find((c) => c.id === f.constellation)?.topics ?? []);
    return places.topics
      .filter((t) => inside.has(t.slug) && !(t.parent && inside.has(t.parent)))
      .sort((a, b) => b.notes - a.notes || a.title.localeCompare(b.title))
      .map((t) => ({ topic: t.slug }));
  }
  if (!data || data.slug !== f.topic) return [];
  const { branches, folderOf } = folderTree(data);
  let key: string;
  if (!f.note || f.note === data.hub) key = "";
  else {
    const k = folderOf.get(f.note);
    if (k === undefined || branches.get(k)?.note !== f.note) return []; // a plain note
    key = k;
  }
  const items: { focus: Focus; size: number; title: string }[] = [];
  for (const b of branches.values()) {
    if (b.parent !== key) continue;
    const note = b.note ?? entry(b.key);
    if (note) items.push({ focus: { topic: f.topic, note }, size: b.count, title: b.title });
  }
  for (const [id, k] of folderOf) {
    if (k === key && id !== branches.get(k)!.note && id !== data.hub) {
      items.push({ focus: { topic: f.topic, note: id }, size: 1, title: data.nodes.find((n) => n.id === id)?.title ?? id });
    }
  }
  if (key === "") {
    for (const t of places.topics) if (t.parent === f.topic) items.push({ focus: { topic: t.slug }, size: t.notes, title: t.title });
  }
  return items.sort((a, b) => b.size - a.size || a.title.localeCompare(b.title)).map((i) => i.focus);

  /** A folder without a folder note is entered through its biggest sub-folder, else its first note. */
  function entry(k: string): string | null {
    const subs = [...branches.values()].filter((b) => b.parent === k).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    for (const s of subs) {
      const note = s.note ?? entry(s.key);
      if (note) return note;
    }
    for (const [id, kk] of folderOf) if (kk === k) return id;
    return null;
  }
}
