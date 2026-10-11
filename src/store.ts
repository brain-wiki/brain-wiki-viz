import { useEffect, useState } from "preact/hooks";

/** A tiny observable store: `set` merges, subscribers re-render through `useStore`. */
export class Store<S extends object> {
  private listeners = new Set<() => void>();
  constructor(private s: S) {}

  get state(): S {
    return this.s;
  }

  set(patch: Partial<S>): void {
    this.s = { ...this.s, ...patch };
    for (const l of this.listeners) l();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export function useStore<S extends object, T>(store: Store<S>, select: (s: S) => T): T {
  const [value, setValue] = useState(() => select(store.state));
  useEffect(() => {
    const update = () => setValue(() => select(store.state));
    update();
    return store.subscribe(update);
  }, [store]);
  return value;
}
