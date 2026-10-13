import { describe, expect, it } from "vitest";
import type { TopicSummary } from "../types";
import { nested, sorter } from "./Navigator";

const t = (title: string, notes: number, parent: string | null = null) =>
  ({ slug: title.toLowerCase(), title, notes, parent, flagged: 0, updated: null, recent: 0 }) as unknown as TopicSummary;

describe("topic list order", () => {
  it("sorts by name by default: case aside, numbers in order, sub-topics under their parent", () => {
    const list = [t("beta", 9), t("Alpha", 1), t("Report 10", 3), t("Report 2", 5), t("Child", 2, "alpha")];
    expect(nested(list, sorter("name")).map(({ topic, depth }) => `${"-".repeat(depth)}${topic.title}`)).toEqual([
      "Alpha",
      "-Child",
      "beta",
      "Report 2",
      "Report 10",
    ]);
    expect(nested(list, sorter("size")).map(({ topic }) => topic.title)[0]).toBe("beta");
  });
});
