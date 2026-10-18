// Payload shapes from the viz server (visualizer.md §6).

export type Flag = "conflict" | "stale" | "superseded" | "orphan" | "lint_error";

/** Display order, most actionable first; the star shader indexes its colours by it. */
export const FLAGS: Flag[] = ["conflict", "stale", "superseded", "orphan", "lint_error"];

/**
 * How one note links to another, always from the note that holds the link: a body wikilink, a
 * relation field (`bw-superseded_by` old -> new, `bw-conflicts_with`, `bw-depends_on` dependent ->
 * the note it rests on, `bw-part_of` part -> whole), or `bw-sources` (citing -> cited).
 */
export type Rel = "links_to" | "superseded_by" | "conflicts_with" | "depends_on" | "part_of" | "source";

export interface Constellation {
  id: string;
  title: string;
  color: string;
  topics: string[];
}

export interface TopicSummary {
  slug: string;
  title: string;
  description?: string | null;
  color: string;
  constellation: string;
  parent?: string | null; // the enclosing topic, when this is a sub-topic
  notes: number;
  page: string | null;
  updated: string | null;
  recent: number;
  flags: Partial<Record<Flag, number>>;
  flagged: number;
}

export interface Flow {
  a: string;
  b: string;
  total: number;
  rels: Partial<Record<Rel, number>>;
}

export interface RunSummary {
  id: string;
  kind: string;
  at: string | null;
  episodes: number;
  topics: Record<string, number>;
  touched: string[];
}

export interface World {
  brain: string;
  generated: string;
  profile: string;
  totals: { topics: number; notes: number; pages: number; episodes: number; links: number; flagged: number };
  constellations: Constellation[];
  topics: TopicSummary[];
  flows: Flow[];
  episodes: { count: number };
  runs: RunSummary[];
}

export interface NodeData {
  id: string;
  title: string;
  path: string;
  kind: "note" | "topic" | "episode";
  topic: string | null;
  type: string | null;
  status: string;
  updated: string | null;
  aliases: string[];
  degree: number;
  /** How long the note is, in lines: what its size on the map shows. */
  lines: number;
  flags: Flag[];
}

export interface Link {
  source: string;
  target: string;
  rel: Rel;
}

export interface ExternalLink extends Link {
  topic: string | null;
  title: string;
  dir: "out" | "in";
}

export interface TopicData {
  slug: string;
  title: string;
  color: string;
  page: string | null;
  path?: string; // the topic's folder in the brain
  nodes: NodeData[];
  links: Link[];
  external: ExternalLink[];
}

/** A link the note holds, as read from that note; unresolved links have no id, title or path. */
export interface Outlink {
  relation: "superseded_by" | "conflicts_with" | "depends_on" | "part_of" | "links_to" | "cites";
  /** The link text as written. */
  target: string;
  id: string | null;
  title: string | null;
  path: string | null;
  resolved: boolean;
}

/** A note that links here, as read from this note: it `supersedes` that note, they conflict, or that note depends on, links to, or cites this one. */
export interface Backlink {
  id: string;
  title: string;
  path: string;
  relation: "supersedes" | "conflicts_with" | "depended_on_by" | "linked_from" | "cited_by";
}

/** A note that names this one in `bw-part_of`. */
export interface Part {
  id: string;
  title: string;
  path: string;
}

export interface NoteDetail {
  id: string;
  title: string;
  path: string;
  abs_path?: string;
  kind: string;
  type: string | null;
  status: string;
  topic: string | null;
  updated: string | null;
  banners?: string[];
  summary?: string | null;
  outlinks?: Outlink[];
  backlinks?: Backlink[];
  /** The notes that are part of this one, by title, and how many there are in all. */
  parts?: Part[];
  parts_total?: number;
  /** An exported file has only the map's data: no summary, links, or body. */
  partial?: boolean;
  /** Frontmatter, the body as Markdown, and wikilink text -> visible target, for the preview. */
  properties?: Record<string, unknown>;
  markdown?: string;
  links?: Record<string, LinkTarget>;
}

export interface LinkTarget {
  id: string;
  title: string;
  topic: string | null;
}

export interface SearchHit {
  id: string;
  title: string;
  topic: string | null;
  kind: string;
  snippet?: string | null;
}

export interface Health {
  counts: Partial<Record<Flag, number>>;
  items: Partial<Record<Flag, { id: string; title: string; topic: string | null }[]>>;
}
