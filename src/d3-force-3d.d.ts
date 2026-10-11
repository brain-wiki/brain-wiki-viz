// Minimal types for the parts of d3-force-3d the layout uses.
declare module "d3-force-3d" {
  export interface SimNode {
    id: string;
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }
  export interface SimLink {
    source: string | SimNode;
    target: string | SimNode;
  }
  export interface Force {
    (alpha: number): void;
  }
  export interface Simulation<N extends SimNode> {
    force(name: string, force: Force | null): this;
    tick(iterations?: number): this;
    stop(): this;
    nodes(): N[];
    alpha(a: number): this;
    alphaDecay(d: number): this;
    velocityDecay(d: number): this;
  }
  export function forceSimulation<N extends SimNode>(nodes: N[], numDimensions?: number): Simulation<N>;
  export interface ManyBody extends Force {
    strength(s: number): ManyBody;
    distanceMax(d: number): ManyBody;
    theta(t: number): ManyBody;
  }
  export function forceManyBody(): ManyBody;
  export interface LinkForce extends Force {
    id(fn: (n: SimNode) => string): LinkForce;
    distance(d: number | ((l: SimLink) => number)): LinkForce;
    strength(s: number | ((l: SimLink) => number)): LinkForce;
  }
  export function forceLink(links: SimLink[]): LinkForce;
  export interface RadialForce extends Force {
    strength(s: number): RadialForce;
  }
  export function forceRadial(radius: number, x?: number, y?: number, z?: number): RadialForce;
  export interface CollideForce extends Force {
    strength(s: number): CollideForce;
  }
  export function forceCollide(radius: number | ((n: SimNode) => number)): CollideForce;
}
