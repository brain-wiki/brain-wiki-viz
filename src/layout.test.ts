import { describe, expect, it } from "vitest";
import { galaxyLayout, topicLayout, topicRadius } from "./layout";
import { chooseRevealed, focusToHash, hashToFocus, healthSeverity, levelOf, parentFocus, projectedRadius } from "./lod";
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
      status: "active", privacy: "default", updated: null, aliases: [], degree: 1, claims: 0,
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
