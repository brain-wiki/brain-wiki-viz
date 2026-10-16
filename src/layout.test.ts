import { describe, expect, it } from "vitest";
import { VIEW, folderTree, galaxyLayout, topicLayout, topicRadius } from "./layout";

/** Where a point lands on screen (the plane facing the camera), and how far it is from the camera. */
const screen = (q: ArrayLike<number>) => [q[0], q[1] * VIEW[2] - q[2] * VIEW[1]];
const toward = (q: ArrayLike<number>) => q[0] * VIEW[0] + q[1] * VIEW[1] + q[2] * VIEW[2];
import { chooseRevealed, focusToHash, hashToFocus, healthSeverity, levelOf, parentFocus, projectedRadius, viewFocus } from "./lod";
import type { Constellation, TopicData, TopicSummary } from "./types";

function topic(slug: string, notes: number, constellation: string): TopicSummary {
  return { slug, title: slug, color: "#888888", constellation, notes, hub: `${slug}-hub`, updated: null, recent: 0, flags: {}, flagged: 0 };
}

const topics = Array.from({ length: 30 }, (_, i) => topic(`t${i}`, 5 + ((i * 7) % 40), `c${(i % 3) + 1}`));
const constellations: Constellation[] = [1, 2, 3].map((k) => ({
  id: `c${k}`,
  title: `c${k}`,
  color: "#888888",
  topics: topics.filter((t) => t.constellation === `c${k}`).map((t) => t.slug),
}));

describe("galaxy layout", () => {
  it("is deterministic", () => {
    const a = galaxyLayout(constellations, topics, 20);
    const b = galaxyLayout(constellations, topics, 20);
    expect([...a.topics.entries()]).toEqual([...b.topics.entries()]);
  });

  it("keeps topics of one constellation apart and inside it", () => {
    const g = galaxyLayout(constellations, topics, 20);
    for (const c of constellations) {
      const cp = g.constellations.get(c.id)!;
      const ps = c.topics.map((s) => g.topics.get(s)!);
      for (let i = 0; i < ps.length; i++) {
        expect(Math.hypot(ps[i].x - cp.x, ps[i].z - cp.z)).toBeLessThan(cp.r + 1);
        for (let j = i + 1; j < ps.length; j++) {
          const d = Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z);
          expect(d).toBeGreaterThan((ps[i].r + ps[j].r) * 0.8);
        }
      }
    }
  });

  it("puts a topic at the centre of the constellation its sub-topics form", () => {
    const parent = { ...topic("people", 3, "c1"), parent: null };
    const kids = Array.from({ length: 6 }, (_, i) => ({ ...topic(`p${i}`, 10 + i, "c1"), parent: "people" }));
    const con: Constellation = { id: "c1", title: "People", color: "#888888", topics: ["people", ...kids.map((k) => k.slug)] };
    const g = galaxyLayout([con], [parent, ...kids], 0);
    const c = g.constellations.get("c1")!;
    const p = g.topics.get("people")!;
    const nearest = Math.min(...kids.map((k) => Math.hypot(g.topics.get(k.slug)!.x - c.x, g.topics.get(k.slug)!.z - c.z)));
    expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeLessThan(nearest);
  });

  it("keeps constellations off the inbox core", () => {
    const g = galaxyLayout(constellations, topics, 20);
    for (const c of g.constellations.values()) {
      expect(Math.hypot(c.x, c.z)).toBeGreaterThanOrEqual(g.inbox.r + c.r - 1);
    }
  });
});

describe("topic layout", () => {
  const data: TopicData = {
    slug: "t0",
    title: "t0",
    color: "#888888",
    hub: "h",
    nodes: ["h", "a", "b", "c", "d"].map((id) => ({
      id, title: id, path: `${id}.md`, kind: id === "h" ? "hub" : "note", topic: "t0", type: null,
      status: "active", updated: null, aliases: [], degree: 1, lines: 20, flags: [],
    })),
    links: [{ source: "a", target: "b", rel: "links_to" }],
    external: [],
  };

  it("fits every note in the nebula, puts the index first, and packs the same way every time", () => {
    const r = topicRadius(5);
    const p = topicLayout(data, r);
    expect(p.ids[0]).toBe("h");
    for (let i = 0; i < p.ids.length; i++) {
      const d = Math.hypot(p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]);
      expect(d).toBeLessThanOrEqual(r * 0.9);
    }
    expect(Array.from(topicLayout(data, r).positions)).toEqual(Array.from(p.positions));
  });
});

describe("folder tree", () => {
  const paths = ["index", "a", "rfcs/rfcs", "rfcs/r1", "rfcs/r2", "rfcs/old/o1", "docs/d1"];
  const data: TopicData = {
    slug: "x",
    title: "X",
    color: "#888888",
    hub: "index",
    path: "topics/x",
    nodes: paths.map((rel) => ({
      id: rel.split("/").pop()!, title: `T ${rel}`, path: `topics/x/${rel}.md`, kind: rel === "index" ? "hub" : "note",
      topic: "x", type: null, status: "active", updated: null, aliases: [], degree: 1, lines: 20,
      flags: [],
    })),
    links: [],
    external: [],
  };

  it("follows the folders: folder notes are branch stars, plain folders are branches too", () => {
    const { branches, folderOf } = folderTree(data);
    expect([...branches.keys()].sort()).toEqual(["", "docs", "rfcs", "rfcs/old"]);
    expect(branches.get("rfcs")).toMatchObject({ note: "rfcs", title: "T rfcs/rfcs", depth: 1, count: 4 });
    expect(branches.get("rfcs/old")).toMatchObject({ parent: "rfcs", note: null, title: "old", depth: 2, count: 1 });
    expect(branches.get("")!.count).toBe(7);
    expect(folderOf.get("r1")).toBe("rfcs");
    expect(folderOf.get("a")).toBe("");
  });

  it("keeps each folder's notes and sub-folders within its reach, and draws one link per folder and no outlines", () => {
    const r = topicRadius(7);
    const p = topicLayout(data, r);
    const at = (id: string) => {
      const i = p.ids.indexOf(id);
      return screen([p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]]);
    };
    const folder = (key: string) => p.branches.find((b) => b.key === key)!;
    const inside = (q: number[], key: string) => {
      const c = folder(key);
      const [cx, cy] = screen(c.center);
      return Math.hypot(q[0] - cx, q[1] - cy) <= c.radius * 1.001;
    };
    expect(p.ids[0]).toBe("index");
    for (const id of ["rfcs", "r1", "r2", "o1"]) expect(inside(at(id), "rfcs")).toBe(true);
    expect(inside(at("o1"), "rfcs/old")).toBe(true);
    expect(inside(at("d1"), "docs")).toBe(true);
    expect(inside(at("d1"), "rfcs")).toBe(false);
    expect(p.skeleton.length).toBe(3 * 6); // docs, rfcs, rfcs/old; notes draw no lines
    expect(p.branches.map((b) => b.key)).toEqual(["docs", "rfcs", "rfcs/old"]);
    expect(Array.from(topicLayout(data, r).positions)).toEqual(Array.from(p.positions));
  });

  it("links each folder's core to its parent's: the index, a folder note, or a plain folder's middle", () => {
    const p = topicLayout(data, topicRadius(7));
    const star = (id: string) => Array.from(p.positions.slice(p.ids.indexOf(id) * 3, p.ids.indexOf(id) * 3 + 3));
    const links: number[][] = [];
    for (let s = 0; s < p.skeleton.length; s += 6) links.push(Array.from(p.skeleton.slice(s, s + 6)));
    const linked = (a: number[], b: number[]) => links.some((l) => l.every((v, i) => Math.abs(v - [...a, ...b][i]) < 1e-3));
    expect(linked(star("index"), star("rfcs"))).toBe(true);
    expect(linked(star("index"), star("d1"))).toBe(true); // docs has no folder note: its one note is its core
    const old = p.branches.find((b) => b.key === "rfcs/old")!;
    expect(linked(star("rfcs"), star("o1"))).toBe(true);
    expect(toward(star("o1"))).toBeCloseTo(toward(old.center), 3);
  });

  it("never runs a link through the reach of a folder it does not join", () => {
    const rels = ["index", "root-note"];
    for (let a = 0; a < 5; a++) {
      rels.push(`a${a}/a${a}`);
      for (let n = 0; n < 2 + a * 3; n++) rels.push(`a${a}/n${n}`);
      for (let b = 0; b < (a % 3) + 2; b++) {
        for (let n = 0; n < 1 + ((a + b) % 4) * 4; n++) rels.push(`a${a}/b${b}/n${n}`);
        if (b === 0) rels.push(`a${a}/b${b}/c/n0`, `a${a}/b${b}/c/n1`);
      }
    }
    const deep: TopicData = {
      ...data,
      slug: "deep",
      nodes: rels.map((rel, i) => ({
        ...data.nodes[1],
        id: rel,
        title: rel,
        path: `topics/x/${rel}.md`,
        kind: rel === "index" ? "hub" : "note",
        lines: 10 + ((i * 37) % 400),
      })),
    };
    const p = topicLayout(deep, topicRadius(rels.length));
    const { branches } = folderTree(deep);
    const line = (b: number) => [screen(p.skeleton.slice(b, b + 3)), screen(p.skeleton.slice(b + 3, b + 6))];
    const first = 0;
    p.branches.forEach((b, i) => {
      const [a, c] = line(first + i * 6);
      const joins = new Set([b.key]);
      for (let k = b.parent; k !== null; k = branches.get(k)!.parent) joins.add(k);
      for (const o of p.branches) {
        if (joins.has(o.key)) continue;
        const [ox, oy] = screen(o.center);
        const [dx, dy] = [c[0] - a[0], c[1] - a[1]];
        const t = Math.max(0, Math.min(1, ((ox - a[0]) * dx + (oy - a[1]) * dy) / (dx * dx + dy * dy)));
        expect(Math.hypot(a[0] + t * dx - ox, a[1] + t * dy - oy), `${b.key} through ${o.key}`).toBeGreaterThan(o.radius);
      }
    });
  });

  it("gathers a folder dense at its core and sparse at its rim, not evenly", () => {
    const rels = ["index", ...Array.from({ length: 80 }, (_, i) => `n${i}`)];
    const flat: TopicData = {
      ...data,
      slug: "flat",
      nodes: rels.map((rel) => ({ ...data.nodes[1], id: rel, title: rel, path: `topics/x/${rel}.md`, kind: rel === "index" ? "hub" : "note", lines: 30 })),
    };
    const p = topicLayout(flat, topicRadius(rels.length));
    const ds = p.ids.map((_, i) => Math.hypot(...screen(p.positions.slice(i * 3, i * 3 + 3))));
    const reach = Math.max(...ds);
    const inner = ds.filter((d) => d <= reach / 2).length / (reach / 2) ** 2;
    const outer = ds.filter((d) => d > reach / 2).length / (reach ** 2 - (reach / 2) ** 2);
    expect(inner).toBeGreaterThan(outer * 3);
  });

  it("gathers a folder's long notes at its core, around the folder note", () => {
    const rels = ["index", "f/f"];
    for (let i = 0; i < 6; i++) rels.push(`f/long${i}`);
    for (let i = 0; i < 30; i++) rels.push(`f/short${i}`);
    const mass: TopicData = {
      ...data,
      slug: "mass",
      nodes: rels.map((rel) => ({
        ...data.nodes[1],
        id: rel,
        title: rel,
        path: `topics/x/${rel}.md`,
        kind: rel === "index" ? "hub" : "note",
        lines: rel.includes("long") ? 1500 : 15,
      })),
    };
    const p = topicLayout(mass, topicRadius(rels.length));
    const at = (id: string) => screen(p.positions.slice(p.ids.indexOf(id) * 3, p.ids.indexOf(id) * 3 + 3));
    const core = at("f/f");
    const mean = (pre: string) => {
      const ds = rels.filter((r) => r.startsWith(pre)).map((r) => Math.hypot(at(r)[0] - core[0], at(r)[1] - core[1]));
      return ds.reduce((s, d) => s + d, 0) / ds.length;
    };
    expect(mean("f/long")).toBeLessThan(mean("f/short") * 0.6);
  });

  it("puts deeper folders farther from the camera", () => {
    const p = topicLayout(data, topicRadius(7));
    const at = (key: string) => p.branches.find((b) => b.key === key)!.center;
    expect(toward(at("rfcs/old"))).toBeLessThan(toward(at("rfcs")));
    expect(toward(at("rfcs"))).toBeLessThan(0);
  });

  it("gives longer notes more room, and keeps sibling folders apart", () => {
    const rels = ["index"];
    for (let i = 0; i < 4; i++) rels.push(`long/l${i}`, `short/s${i}`);
    for (let i = 0; i < 40; i++) rels.push(`big/n${i}`);
    const sized: TopicData = {
      ...data,
      slug: "sized",
      nodes: rels.map((rel) => ({
        ...data.nodes[1],
        id: rel,
        title: rel,
        path: `topics/x/${rel}.md`,
        kind: rel === "index" ? "hub" : "note",
        lines: rel.startsWith("long/") ? 2000 : 20,
      })),
    };
    const p = topicLayout(sized, topicRadius(rels.length));
    const folder = (key: string) => p.branches.find((b) => b.key === key)!;
    expect(folder("long").radius).toBeGreaterThan(folder("short").radius * 1.8);
    const keys = ["long", "short", "big"];
    for (const a of keys) {
      for (const b of keys) {
        if (a >= b) continue;
        const [ax, ay] = screen(folder(a).center);
        const [bx, by] = screen(folder(b).center);
        expect(Math.hypot(ax - bx, ay - by)).toBeGreaterThanOrEqual(folder(a).radius + folder(b).radius);
      }
    }
  });
});

describe("branch labels", () => {
  it("drop what the parent folders' titles already say", () => {
    const rels = ["index", "s/s", "s/a/a", "s/a/t/t"];
    const titles: Record<string, string> = {
      "s/s": "Lumen guide",
      "s/a/a": "Lumen guide · Sync",
      "s/a/t/t": "Lumen guide · Sync · Conflicts",
    };
    const tree: TopicData = {
      slug: "l",
      title: "L",
      color: "#888888",
      hub: "index",
      path: "topics/l",
      nodes: rels.map((rel) => ({
        id: rel, title: titles[rel] ?? rel, path: `topics/l/${rel}.md`, kind: rel === "index" ? "hub" : "note",
        topic: "l", type: null, status: "active", updated: null, aliases: [], degree: 1, lines: 20,
        flags: [],
      })),
      links: [],
      external: [],
    };
    const { branches } = folderTree(tree);
    expect(branches.get("s/a")!.label).toBe("Sync");
    expect(branches.get("s/a/t")!.label).toBe("Conflicts");
    expect(branches.get("s/a/t")!.title).toBe("Lumen guide · Sync · Conflicts");
  });
});

describe("level of detail", () => {
  it("reveals the biggest topics with hysteresis", () => {
    const cands = [
      { slug: "a", px: 300, visible: true },
      { slug: "b", px: 95, visible: true },
      { slug: "c", px: 500, visible: false },
    ];
    expect([...chooseRevealed(cands, new Set())]).toEqual(["a"]);
    expect([...chooseRevealed(cands, new Set(["b"]))].sort()).toEqual(["a", "b"]);
    expect(chooseRevealed(cands, new Set(), 0).size).toBe(0);
  });

  it("projects sizes and walks focus levels", () => {
    expect(projectedRadius(10, 100, 1000, 60)).toBeCloseTo(86.6, 0);
    const f = { constellation: "c1", topic: "t1", note: "n1" };
    expect(levelOf(f)).toBe("note");
    expect(levelOf(parentFocus(parentFocus(f)))).toBe("constellation");
    expect(hashToFocus(focusToHash(f), () => "c1")).toEqual(f);
    expect(hashToFocus("#/t/%E0%A4", () => "c1")).toEqual({}); // a mangled link opens the overview
    expect(hashToFocus("#/", () => undefined)).toEqual({});
  });

  it("ranks health so the worst topic stands out even when all are flagged", () => {
    const s = healthSeverity([
      { notes: 50, flagged: 9 },
      { notes: 50, flagged: 0 },
      { notes: 40, flagged: 30 },
      { notes: 50, flagged: 10 },
    ]);
    expect(s[1]).toBe(0);
    expect(s[2]).toBe(1);
    expect(s[0]).toBeCloseTo(0.15);
    expect(s[3]).toBeGreaterThan(s[0]);
    expect(s[3]).toBeLessThan(s[2]);
  });
});

describe("viewFocus", () => {
  const base = { nearTopic: null, nearConstellation: null, focusTopicSize: 0, focusConstellationSize: 0, multi: true };
  it("enters a constellation, then a topic, as you zoom in", () => {
    expect(viewFocus({}, { ...base, nearConstellation: { id: "c1", size: 0.3 } }).focus).toEqual({ constellation: "c1" });
    const t = viewFocus({ constellation: "c1" }, { ...base, nearTopic: { slug: "a", constellation: "c1", size: 0.25 }, focusConstellationSize: 0.6 });
    expect(t.focus).toEqual({ constellation: "c1", topic: "a" });
    expect(t.progress).toBe(2);
  });
  it("keeps a level inside the hysteresis band and leaves below it", () => {
    const cur = { constellation: "c1", topic: "a", note: "n1" };
    const near = { slug: "a", constellation: "c1", size: 0.16 };
    expect(viewFocus(cur, { ...base, nearTopic: near, focusTopicSize: 0.16, focusConstellationSize: 0.5 }).focus).toEqual(cur);
    const out = viewFocus(cur, { ...base, nearTopic: { ...near, size: 0.1 }, focusTopicSize: 0.1, focusConstellationSize: 0.5 });
    expect(out.focus).toEqual({ constellation: "c1" });
    expect(viewFocus({ constellation: "c1" }, { ...base, focusConstellationSize: 0.1 }).focus).toEqual({});
  });
  it("switches to a neighbor you pan to and creeps the indicator toward the next level", () => {
    const pan = viewFocus({ constellation: "c1", topic: "a" }, { ...base, nearTopic: { slug: "b", constellation: "c1", size: 0.3 }, focusTopicSize: 0.2, focusConstellationSize: 0.5 });
    expect(pan.focus.topic).toBe("b");
    const g = viewFocus({}, { ...base, nearConstellation: { id: "c2", size: 0.13 } });
    expect(g.focus).toEqual({});
    expect(g.progress).toBeCloseTo(0.45);
  });
});
