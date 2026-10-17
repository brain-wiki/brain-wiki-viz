import { describe, expect, it } from "vitest";
import { nestChildren, nestUp } from "./nesting";
import type { TopicData, TopicSummary, World } from "./types";

const summary = (slug: string, notes: number, parent: string | null = null): TopicSummary =>
  ({ slug, title: slug, notes, parent }) as TopicSummary;

const places: Pick<World, "constellations" | "topics"> = {
  constellations: [
    { id: "c1", title: "Work", color: "#888", topics: ["work", "sub", "other"] },
    { id: "c2", title: "Home", color: "#888", topics: ["home"] },
  ],
  topics: [summary("work", 6), summary("sub", 9, "work"), summary("other", 2), summary("home", 1)],
};

// work/: index, a; rfcs/ (folder note rfcs) with r1 and old/o1 (no folder note); docs/d1.
const paths = ["index", "a", "rfcs/rfcs", "rfcs/r1", "rfcs/old/o1", "docs/d1"];
const work: TopicData = {
  slug: "work",
  title: "Work",
  color: "#888",
  page: "index",
  path: "topics/work",
  nodes: paths.map((rel) => ({
    id: rel.split("/").pop()!, title: rel, path: `topics/work/${rel}.md`, kind: rel === "index" ? "topic" : "note",
    topic: "work", type: null, status: "active", updated: null, aliases: [], degree: 1, lines: 20,
    flags: [],
  })),
  links: [],
  external: [],
};

describe("nesting", () => {
  it("climbs from a note through its folders to the topic, its parent topic, the group, the overview", () => {
    const at = (note: string) => ({ constellation: "c1", topic: "work", note });
    expect(nestUp(at("o1"), places, work)).toEqual(at("rfcs")); // old/ has no folder note
    expect(nestUp(at("rfcs"), places, work)).toEqual({ constellation: "c1", topic: "work" });
    expect(nestUp(at("a"), places, work)).toEqual({ constellation: "c1", topic: "work" });
    expect(nestUp({ constellation: "c1", topic: "sub" }, places, null)).toEqual({ topic: "work" });
    expect(nestUp({ constellation: "c1", topic: "work" }, places, work)).toEqual({ constellation: "c1" });
    expect(nestUp({ constellation: "c1" }, places, null)).toEqual({});
    expect(nestUp({}, places, null)).toBeNull();
  });

  it("goes down into the biggest place inside", () => {
    expect(nestChildren({}, places, null)[0]).toEqual({ constellation: "c1" });
    expect(nestChildren({ constellation: "c1" }, places, null).map((f) => f.topic)).toEqual(["work", "other"]);
    const topic = nestChildren({ constellation: "c1", topic: "work" }, places, work);
    expect(topic[0]).toEqual({ topic: "sub" }); // a sub-topic with 9 notes beats the rfcs folder
    expect(topic.map((f) => f.note ?? f.topic)).toEqual(["sub", "rfcs", "a", "d1"]);
    // docs/ has no folder note, so it is entered through its first note.
    const rfcs = nestChildren({ topic: "work", note: "rfcs" }, places, work);
    expect(rfcs.map((f) => f.note)).toEqual(["o1", "r1"]);
    expect(nestChildren({ topic: "work", note: "r1" }, places, work)).toEqual([]);
  });
});
