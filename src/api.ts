import type { Health, NoteDetail, SearchHit, TopicData, World } from "./types";

export interface Source {
  readonly embedded: boolean;
  world(): Promise<World>;
  topic(slug: string): Promise<TopicData | null>;
  note(id: string): Promise<NoteDetail | null>;
  search(q: string): Promise<SearchHit[]>;
  health(): Promise<Health>;
}

class HttpSource implements Source {
  readonly embedded = false;
  private topics = new Map<string, Promise<TopicData | null>>();

  constructor(private token: string | null) {}

  private async get<T>(path: string): Promise<T | null> {
    const sep = path.includes("?") ? "&" : "?";
    const url = this.token ? `${path}${sep}t=${encodeURIComponent(this.token)}` : path;
    const res = await fetch(url, { credentials: "same-origin" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async world(): Promise<World> {
    const w = await this.get<World>("/api/world");
    if (!w) throw new Error("no world");
    return w;
  }

  topic(slug: string): Promise<TopicData | null> {
    let p = this.topics.get(slug);
    if (!p) {
      p = this.get<TopicData>(`/api/topic/${encodeURIComponent(slug)}`);
      this.topics.set(slug, p);
      p.catch(() => this.topics.delete(slug));
    }
    return p;
  }

  note(id: string): Promise<NoteDetail | null> {
    return this.get<NoteDetail>(`/api/note/${encodeURIComponent(id)}`);
  }

  async search(q: string): Promise<SearchHit[]> {
    if (!q.trim()) return [];
    const r = await this.get<{ results: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`);
    return r?.results ?? [];
  }

  async health(): Promise<Health> {
    return (await this.get<Health>("/api/health")) ?? { counts: {}, items: {} };
  }
}

interface Embedded {
  world: World;
  topics: Record<string, TopicData>;
  health: Health;
}

/** A `brain viz --export brain.html` file: everything is inlined, nothing is fetched. */
class EmbeddedSource implements Source {
  readonly embedded = true;
  constructor(private data: Embedded) {}

  async world(): Promise<World> {
    return this.data.world;
  }

  async topic(slug: string): Promise<TopicData | null> {
    return this.data.topics[slug] ?? null;
  }

  async note(id: string): Promise<NoteDetail | null> {
    for (const t of Object.values(this.data.topics)) {
      const n = t.nodes.find((x) => x.id === id);
      if (n) {
        return {
          id: n.id,
          title: n.title,
          path: n.path,
          kind: n.kind,
          type: n.type,
          status: n.status,
          topic: n.topic,
          updated: n.updated,
          privacy: n.privacy,
          partial: true,
        };
      }
    }
    return null;
  }

  async search(q: string): Promise<SearchHit[]> {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const hits: SearchHit[] = [];
    for (const t of Object.values(this.data.topics)) {
      for (const n of t.nodes) {
        const names = [n.title, ...n.aliases].map((s) => s.toLowerCase());
        if (names.some((s) => s.includes(needle))) {
          hits.push({ id: n.id, title: n.title, topic: n.topic, kind: n.kind });
          if (hits.length >= 20) return hits;
        }
      }
    }
    return hits;
  }

  async health(): Promise<Health> {
    return this.data.health;
  }
}

export function openSource(): Source {
  const el = document.getElementById("brain-data");
  if (el?.textContent) return new EmbeddedSource(JSON.parse(el.textContent) as Embedded);
  const url = new URL(window.location.href);
  let token = url.searchParams.get("t");
  if (token) {
    sessionStorage.setItem("brain-viz-token", token);
    // The server has set its session cookie; keep the token out of the address bar.
    url.searchParams.delete("t");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  } else {
    token = sessionStorage.getItem("brain-viz-token");
  }
  return new HttpSource(token);
}
