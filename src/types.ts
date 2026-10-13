// Payload shapes from the viz server (design doc 12 §6).

export type Flag = "conflict" | "stale" | "orphan" | "unverified" | "over_budget" | "lint_error";

export const FLAGS: Flag[] = ["conflict", "stale", "unverified", "orphan", "over_budget", "lint_error"];

export type Rel =
  | "part_of"
  | "has_part"
  | "depends_on"
  | "enables"
  | "conflicts_with"
  | "supersedes"
  | "superseded_by"
  | "related_to"
  | "links_to";

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
  hub: string | null;
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
  privacy: string[];
  totals: { topics: number; notes: number; hubs: number; episodes: number; links: number; flagged: number };
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
  kind: "note" | "hub" | "episode";
  topic: string | null;
  type: string | null;
  status: string;
  privacy: string;
  updated: string | null;
  aliases: string[];
  degree: number;
  claims: number;
  superseded_claims: number;
  unverified_claims: number;
  flags: Flag[];
}

export interface Link {
  source: string;
  target: string;
  rel: Rel;
  typed?: boolean;
  guard?: boolean;
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
  hub: string | null;
  path?: string; // the topic's folder in the brain
  nodes: NodeData[];
  links: Link[];
  external: ExternalLink[];
}

export interface Claim {
  id: string | null;
  text: string;
  status: string;
  taint?: string | null;
}

export interface Backlink {
  title: string;
  path: string;
  relation: string;
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
  privacy: string;
  banners?: string[];
  summary?: string | null;
  claims?: Claim[];
  backlinks?: Backlink[];
  /** Exported files carry no claim text. */
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
