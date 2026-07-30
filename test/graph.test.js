import { describe, it, expect } from 'vitest';
import { buildGraph, circleLayout } from '../src/lib/graph.js';

describe('buildGraph', () => {
  it('returns an empty graph for no files', () => {
    const g = buildGraph([]);
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.orphans).toBe(0);
  });

  it('returns an empty graph for non-array input', () => {
    expect(buildGraph(null)).toEqual({ nodes: [], edges: [], orphans: 0 });
    expect(buildGraph(undefined)).toEqual({ nodes: [], edges: [], orphans: 0 });
  });

  it('creates a node per file with a basename label', () => {
    const g = buildGraph([
      { path: 'notes/Foo.md', content: '' },
      { path: 'notes/sub/Bar.md', content: '' },
    ]);
    expect(g.nodes).toHaveLength(2);
    const labels = g.nodes.map((n) => n.label).sort();
    expect(labels).toEqual(['Bar', 'Foo']);
  });

  it('builds edges from wiki links', () => {
    const g = buildGraph([
      { path: 'a/Foo.md', content: 'See [[Bar]] for more.' },
      { path: 'a/Bar.md', content: 'Hello' },
    ]);
    expect(g.edges).toEqual([{ from: 'Foo', to: 'Bar' }]);
    // Foo has out-edge + Bar has in-edge → both degree 1.
    const foo = g.nodes.find((n) => n.id === 'Foo');
    const bar = g.nodes.find((n) => n.id === 'Bar');
    expect(foo.degree).toBe(1);
    expect(bar.degree).toBe(1);
  });

  it('builds edges from standard markdown links', () => {
    const g = buildGraph([
      { path: 'a/Foo.md', content: 'See [the bar](Bar.md).' },
      { path: 'a/Bar.md', content: '' },
    ]);
    expect(g.edges).toEqual([{ from: 'Foo', to: 'Bar' }]);
  });

  it('does not create an edge for a broken link (target not a known note)', () => {
    const g = buildGraph([
      { path: 'a/Foo.md', content: 'See [[Nonexistent]].' },
    ]);
    expect(g.edges).toEqual([]);
    expect(g.nodes.find((n) => n.id === 'Foo').degree).toBe(0);
  });

  it('drops self-loops', () => {
    const g = buildGraph([
      { path: 'a/Foo.md', content: 'I link to [[Foo]] (myself).' },
    ]);
    expect(g.edges).toEqual([]);
    expect(g.nodes[0].degree).toBe(0);
  });

  it('de-duplicates edges between the same pair', () => {
    const g = buildGraph([
      { path: 'a/Foo.md', content: '[[Bar]] and again [[Bar]].' },
      { path: 'a/Bar.md', content: '' },
    ]);
    expect(g.edges).toEqual([{ from: 'Foo', to: 'Bar' }]);
  });

  it('counts both directions in degree (bidirectional links)', () => {
    const g = buildGraph([
      { path: 'a/Foo.md', content: '[[Bar]]' },
      { path: 'a/Bar.md', content: '[[Foo]]' },
    ]);
    const foo = g.nodes.find((n) => n.id === 'Foo');
    const bar = g.nodes.find((n) => n.id === 'Bar');
    // Foo: 1 out + 1 in = 2. Bar: same.
    expect(foo.degree).toBe(2);
    expect(bar.degree).toBe(2);
  });

  it('counts orphans (degree-0 nodes)', () => {
    const g = buildGraph([
      { path: 'a/Foo.md', content: '[[Bar]]' },
      { path: 'a/Bar.md', content: '' },
      { path: 'a/Loner.md', content: 'nothing here' },
    ]);
    expect(g.orphans).toBe(1); // Loner
  });

  it('skips files with unreadable content (null content) without throwing', () => {
    const g = buildGraph([
      { path: 'a/Foo.md', content: '[[Bar]]' },
      { path: 'a/Bar.md', content: null },
    ]);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['Bar', 'Foo']);
    expect(g.edges).toEqual([{ from: 'Foo', to: 'Bar' }]);
  });

  it('skips a note whose content throws during link extraction', () => {
    // Pass content whose toString/link-extraction is malformed — extractDocLinks
    // is robust, but guard anyway by simulating via a non-string that slips past
    // the typeof check is impossible, so verify buildGraph never throws on a
    // weird-but-string payload.
    expect(() => buildGraph([{ path: 'a/Foo.md', content: '}}{}{' }])).not.toThrow();
  });

  it('sorts nodes by degree desc then label asc', () => {
    const g = buildGraph([
      { path: 'a/Zed.md', content: '[[Alpha]] [[Beta]]' },
      { path: 'a/Alpha.md', content: '[[Beta]]' },
      { path: 'a/Beta.md', content: '' },
    ]);
    // Degrees: Alpha=2 (1 out + 1 in), Beta=2 (2 in), Zed=1 (1 out)
    // Tie Alpha/Beta at degree 2 → alphabetical: Alpha before Beta. Then Zed.
    expect(g.nodes.map((n) => n.id)).toEqual(['Alpha', 'Beta', 'Zed']);
  });
});

describe('circleLayout', () => {
  it('returns an empty map for no nodes', () => {
    expect(circleLayout([], 800, 600).size).toBe(0);
  });

  it('returns an empty map for zero dimensions', () => {
    expect(circleLayout([{ id: 'A', degree: 0 }], 0, 0).size).toBe(0);
  });

  it('places a single node at the center', () => {
    const pos = circleLayout([{ id: 'A', degree: 0 }], 800, 600);
    expect(pos.get('A')).toEqual({ x: 400, y: 300 });
  });

  it('places the highest-degree node at the center', () => {
    const pos = circleLayout(
      [
        { id: 'Hub', degree: 5 },
        { id: 'Leaf', degree: 1 },
      ],
      800,
      600,
    );
    expect(pos.get('Hub')).toEqual({ x: 400, y: 300 });
    // Leaf is off-center (on ring 1) — at least one axis differs from center.
    const leaf = pos.get('Leaf');
    expect(leaf.x === 400 && leaf.y === 300).toBe(false);
    expect(Math.hypot(leaf.x - 400, leaf.y - 300)).toBeGreaterThan(0);
  });

  it('keeps all positions within the canvas bounds', () => {
    const nodes = Array.from({ length: 25 }, (_, i) => ({ id: 'N' + i, degree: 25 - i }));
    const pos = circleLayout(nodes, 800, 600);
    for (const { x, y } of pos.values()) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(800);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(600);
    }
  });

  it('is deterministic — same input yields same output', () => {
    const nodes = [
      { id: 'Hub', degree: 4 },
      { id: 'A', degree: 2 },
      { id: 'B', degree: 1 },
      { id: 'C', degree: 0 },
    ];
    const a = circleLayout(nodes, 1000, 800);
    const b = circleLayout(nodes, 1000, 800);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('assigns a position to every node', () => {
    const nodes = [
      { id: 'Hub', degree: 3 },
      { id: 'A', degree: 1 },
      { id: 'B', degree: 1 },
      { id: 'C', degree: 1 },
    ];
    const pos = circleLayout(nodes, 800, 600);
    expect(pos.size).toBe(4);
    for (const n of nodes) expect(pos.has(n.id)).toBe(true);
  });
});
