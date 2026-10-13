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
      status: "active", updated: null, aliases: [], degree: 1, claims: 0,
      superseded_claims: 0, unverified_claims: 0, flags: [],
    })),
    links: [{ source: "a", target: "b", rel: "depends_on" }],
    external: [],
  };

  it("pins the hub at the centre and fits notes in the nebula", () => {
    const r = topicRadius(5);
    const p = topicLayout(data, r);
    expect(p.ids[0]).toBe("h");
    expect([p.positions[0], p.positions[1], p.positions[2]]).toEqual([0, 0, 0]);
    for (let i = 1; i < p.ids.length; i++) {
      const d = Math.hypot(p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]);
      expect(d).toBeLessThanOrEqual(r * 0.86);
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
      topic: "x", type: null, status: "active", updated: null, aliases: [], degree: 1,
      claims: 0, superseded_claims: 0, unverified_claims: 0, flags: [],
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

  it("clusters each branch around its star and draws the tree only below the topic", () => {
    const r = topicRadius(7);
    const p = topicLayout(data, r);
    const at = (id: string) => {
      const i = p.ids.indexOf(id);
      return [p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]];
    };
    const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(p.ids[0]).toBe("index");
    expect(dist(at("r1"), at("rfcs"))).toBeLessThan(dist(at("r1"), at("index")));
    expect(dist(at("r2"), at("rfcs"))).toBeLessThan(dist(at("r2"), at("d1")));
    // 3 branches to their parents, plus r1, r2, o1, d1 to their branch; nothing for root notes.
    // A line may take several segments; each starts at its parent end, where the shade is 1.
    const starts = Array.from(p.skeletonShade).filter((s, i) => i % 2 === 0 && s === 1);
    expect(starts.length).toBe(7);
    expect(p.branches.map((b) => b.key)).toEqual(["docs", "rfcs", "rfcs/old"]);
    expect(Array.from(topicLayout(data, r).positions)).toEqual(Array.from(p.positions));
  });

  it("puts deeper folders farther out and farther from the camera", () => {
    const p = topicLayout(data, topicRadius(7));
    const at = (key: string) => p.branches.find((b) => b.key === key)!.position;
    const out = (q: number[]) => Math.hypot(...screen(q));
    expect(out(at("rfcs/old"))).toBeGreaterThan(out(at("rfcs")));
    expect(toward(at("rfcs/old"))).toBeLessThan(toward(at("rfcs")));
    expect(toward(at("rfcs"))).toBeLessThan(0);
  });

  it("draws a deep, lopsided tree without crossing lines", () => {
    const rels = ["index"];
    for (let i = 0; i < 30; i++) rels.push(`big/n${i}`);
    for (const sub of ["a", "b", "c"]) {
      rels.push(`big/${sub}/${sub}`);
      for (let i = 0; i < 12; i++) rels.push(`big/${sub}/m${sub}${i}`);
      for (let i = 0; i < 4; i++) rels.push(`big/${sub}/deep/d${sub}${i}`);
    }
    rels.push("small/s1", "small/s2", "tiny/t1");
    const deep: TopicData = {
      ...data,
      slug: "deep",
      nodes: rels.map((rel) => ({ ...data.nodes[1], id: rel, title: rel, path: `topics/x/${rel}.md`, kind: rel === "index" ? "hub" : "note" })),
    };
    const p = topicLayout(deep, topicRadius(rels.length));
    const s = p.skeleton;
    const segs: number[][][] = [];
    for (let k = 0; k < s.length / 6; k++) segs.push([screen(s.slice(k * 6, k * 6 + 3)), screen(s.slice(k * 6 + 3, k * 6 + 6))]);
    const ccw = (a: number[], b: number[], c: number[]) => (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]);
    const same = (u: number[], w: number[]) => Math.abs(u[0] - w[0]) < 1e-6 && Math.abs(u[1] - w[1]) < 1e-6;
    let crossings = 0;
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const [a, b] = segs[i];
        const [c, d] = segs[j];
        if ([a, b].some((u) => [c, d].some((w) => same(u, w)))) continue;
        if (ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d)) crossings++;
      }
    }
    expect(crossings).toBe(0);
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
        topic: "l", type: null, status: "active", updated: null, aliases: [], degree: 1,
        claims: 0, superseded_claims: 0, unverified_claims: 0, flags: [],
      })),
      links: [],
      external: [],
    };
    const { branches } = folderTree(tree);
    expect(branches.get("s/a")!.label).toBe("Authoring");
    expect(branches.get("s/a/t")!.label).toBe("Tools");
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
