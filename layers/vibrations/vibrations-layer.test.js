/**
 * vibrations layer — runtime contract tests.
 *
 * The big invariant covered here: render() must draw to the canvas
 * + 2d-context supplied in the per-frame ctx parameter, not anything
 * cached at init() time. A host runtime is allowed to swap canvases
 * between frames (midi-daddy's compositor does this when applying
 * opacity or chroma-key via an offscreen canvas). A layer that caches
 * from init() and ignores the per-frame ctx will paint the wrong
 * surface and the host's compositing layer falls apart silently.
 *
 * Second invariant (added with the rendering/reactivity enhancement):
 * with every param at its declared default, the layer must produce
 * the exact draw-call sequence of the original solid-ring layer —
 * no transforms, no dash state, no alpha, no shadow. Presets saved
 * against the original layer must render pixel-identical.
 */

import { describe, test, expect, jest } from '@jest/globals';
import VibrationsLayer, { params as layerParams } from './vibrations-layer.js';

function makeMockCtx2d() {
  const calls = [];
  const canvas = { width: 800, height: 600 };
  const ctx2d = {
    canvas,
    _calls: calls,
    fillStyle: '',
    lineWidth: 1,
    lineJoin: '',
    lineCap: '',
    lineDashOffset: 0,
    shadowBlur: 0,
    shadowColor: '',
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    beginPath: () => calls.push(['beginPath']),
    arc: (...args) => calls.push(['arc', ...args]),
    rect: (...args) => calls.push(['rect', ...args]),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    closePath: () => calls.push(['closePath']),
    stroke: () => calls.push(['stroke']),
    setLineDash: (...args) => calls.push(['setLineDash', ...args]),
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    translate: (...args) => calls.push(['translate', ...args]),
    rotate: (...args) => calls.push(['rotate', ...args])
  };
  // Record strokeStyle / globalAlpha assignments so tests can observe
  // per-ring colors and burst alpha without a real rasterizer.
  let strokeStyle = '';
  Object.defineProperty(ctx2d, 'strokeStyle', {
    get: () => strokeStyle,
    set: v => { strokeStyle = v; calls.push(['strokeStyle', v]); }
  });
  let globalAlpha = 1;
  Object.defineProperty(ctx2d, 'globalAlpha', {
    get: () => globalAlpha,
    set: v => { globalAlpha = v; calls.push(['globalAlpha', v]); }
  });
  return { canvas, ctx2d, calls };
}

function makeHarnessCtx({ canvas, ctx2d }) {
  return { canvas, width: canvas.width, height: canvas.height, ctx2d };
}

// Deliberately omits every post-enhancement param — proves the layer
// tolerates hosts (and saved presets) that predate the new surface.
function defaultParams(overrides = {}) {
  return {
    shape: 'circle',
    vibrationMode: 'pulse',
    ringCount: 3,
    spacing: 20,
    centerGap: 0,
    lineThickness: 1,
    vibrationDepth: 0,
    lineColor: '#ffffff',
    backgroundColor: '#000000',
    audio: { peak: 0, bands: {} },
    ...overrides
  };
}

// Every param at its declared default, straight from the params export.
function declaredDefaults(overrides = {}) {
  const p = {};
  for (const [name, spec] of Object.entries(layerParams)) {
    if ('default' in spec) p[name] = spec.default;
  }
  p.audio = { peak: 0, bands: {} };
  return { ...p, ...overrides };
}

// Drive performance.now() so reaction timelines are deterministic.
function withMockedNow(fn) {
  const spy = jest.spyOn(globalThis.performance, 'now');
  try {
    fn(t => spy.mockReturnValue(t));
  } finally {
    spy.mockRestore();
  }
}

// Radii of every ring drawn via arc() in a recorded call list.
function arcRadii(calls) {
  return calls.filter(c => c[0] === 'arc').map(c => c[3]);
}

describe('VibrationsLayer — per-frame ctx contract', () => {
  test('render draws to the ctx passed in render(), not the ctx passed to init()', () => {
    const initSurface = makeMockCtx2d();
    const renderSurface = makeMockCtx2d();

    const layer = new VibrationsLayer();
    layer.init(makeHarnessCtx(initSurface));
    layer.render(makeHarnessCtx(renderSurface), defaultParams(), 16);

    // The render-time surface should have been drawn to.
    expect(renderSurface.calls.length).toBeGreaterThan(0);
    // The init-time surface must NOT have been touched — a layer that
    // caches `ctx.ctx2d` at init() would draw here.
    expect(initSurface.calls).toEqual([]);
  });

  test('two consecutive renders with different ctxs each draw to their own ctx', () => {
    const offscreenA = makeMockCtx2d();
    const offscreenB = makeMockCtx2d();

    const layer = new VibrationsLayer();
    layer.init(makeHarnessCtx(offscreenA));
    layer.render(makeHarnessCtx(offscreenA), defaultParams(), 16);
    const afterFirst = offscreenA.calls.length;

    layer.render(makeHarnessCtx(offscreenB), defaultParams(), 16);

    // Surface A drew once; surface B drew on the second frame.
    expect(offscreenA.calls.length).toBe(afterFirst);
    expect(offscreenB.calls.length).toBeGreaterThan(0);
  });

  test('render reads canvas dimensions from the per-frame ctx', () => {
    const small = makeMockCtx2d();
    small.canvas.width = 100;
    small.canvas.height = 100;
    const large = makeMockCtx2d();
    large.canvas.width = 1920;
    large.canvas.height = 1080;

    const layer = new VibrationsLayer();
    layer.init(makeHarnessCtx(small));
    layer.render(makeHarnessCtx(large), defaultParams(), 16);

    // The first fillRect() is the background wash spanning the whole
    // canvas — its dimensions reveal which surface the layer thinks
    // it's drawing to.
    const fillRectCall = large.calls.find(c => c[0] === 'fillRect');
    expect(fillRectCall).toEqual(['fillRect', 0, 0, 1920, 1080]);
  });

  test('per-frame ctx contract holds across the new render paths', () => {
    const surfaceA = makeMockCtx2d();
    const surfaceB = makeMockCtx2d();
    const fancy = declaredDefaults({
      shape: 'hexagon',
      colorMode: 'rainbow',
      strokeStyle: 'dashed',
      rotationSpeed: 0.5,
      twist: 5,
      glow: 0.5,
      counterRotate: true
    });

    const layer = new VibrationsLayer();
    layer.init(makeHarnessCtx(surfaceA));
    layer.react('burst', { count: 2, durationMs: 1000 }, { velocity: 100 });
    layer.render(makeHarnessCtx(surfaceA), fancy, 16);
    const afterFirst = surfaceA.calls.length;

    layer.render(makeHarnessCtx(surfaceB), fancy, 16);

    expect(surfaceA.calls.length).toBe(afterFirst);
    expect(surfaceB.calls.length).toBeGreaterThan(0);
  });
});

describe('VibrationsLayer — default-path regression', () => {
  test('declared defaults produce the original layer\'s draw-call sequence', () => {
    const surface = makeMockCtx2d();
    const layer = new VibrationsLayer();
    layer.init();
    layer.render(makeHarnessCtx(surface), declaredDefaults(), 16);

    // Method calls only (property assignments filtered out): exactly
    // one background fill, then beginPath/arc/stroke per ring.
    const methods = surface.calls
      .filter(c => c[0] !== 'strokeStyle' && c[0] !== 'globalAlpha')
      .map(c => c[0]);
    const ringCount = layerParams.ringCount.default;
    expect(methods).toEqual([
      'fillRect',
      ...Array.from({ length: ringCount }, () => ['beginPath', 'arc', 'stroke']).flat()
    ]);

    // None of the new-feature canvas state may leak into the default
    // path: no transforms, no dash state, no alpha changes.
    const forbidden = ['save', 'restore', 'translate', 'rotate', 'setLineDash', 'globalAlpha'];
    expect(surface.calls.filter(c => forbidden.includes(c[0]))).toEqual([]);

    // Solid color mode sets the stroke color exactly once per frame.
    expect(surface.calls.filter(c => c[0] === 'strokeStyle')).toEqual([
      ['strokeStyle', layerParams.lineColor.default]
    ]);
  });
});

describe('VibrationsLayer — velocity-sensitive reactions', () => {
  test('pulse slam scales with eventContext.velocity', () => {
    const radiiAt = velocity => {
      const surface = makeMockCtx2d();
      const layer = new VibrationsLayer();
      layer.init();
      layer.react('pulse', { intensity: 1, holdMs: 1000, velocitySense: 1 }, { velocity });
      layer.render(makeHarnessCtx(surface), defaultParams(), 16);
      return arcRadii(surface.calls);
    };

    // vibrationDepth 0 + silent audio → radius = base + slam·spacing.
    const hard = radiiAt(127);
    const soft = radiiAt(32);
    expect(hard[0]).toBeCloseTo(20 + 20 * 1, 5);
    expect(soft[0]).toBeCloseTo(20 + 20 * (32 / 127), 5);
    expect(hard[0]).toBeGreaterThan(soft[0]);
  });

  test('velocitySense 0 ignores velocity entirely', () => {
    const surface = makeMockCtx2d();
    const layer = new VibrationsLayer();
    layer.init();
    layer.react('pulse', { intensity: 1, holdMs: 1000, velocitySense: 0 }, { velocity: 1 });
    layer.render(makeHarnessCtx(surface), defaultParams(), 16);
    expect(arcRadii(surface.calls)[0]).toBeCloseTo(40, 5);
  });

  test('missing eventContext means full strength', () => {
    const surface = makeMockCtx2d();
    const layer = new VibrationsLayer();
    layer.init();
    layer.react('pulse', { intensity: 1, holdMs: 1000 });
    layer.render(makeHarnessCtx(surface), defaultParams(), 16);
    expect(arcRadii(surface.calls)[0]).toBeCloseTo(40, 5);
  });
});

describe('VibrationsLayer — new reactions', () => {
  test('burst draws extra transient rings on top of the field', () => {
    withMockedNow(setNow => {
      const surface = makeMockCtx2d();
      const layer = new VibrationsLayer();
      layer.init();

      setNow(1000);
      layer.react('burst', { count: 3, durationMs: 1000 }, { velocity: 127 });
      setNow(1100); // 10% in: first ring airborne, later rings staggered
      layer.render(makeHarnessCtx(surface), defaultParams(), 16);

      const strokes = surface.calls.filter(c => c[0] === 'stroke').length;
      expect(strokes).toBeGreaterThan(3); // 3 field rings + ≥1 burst ring
      // Burst rings draw faded, then alpha resets for the next frame.
      const alphas = surface.calls.filter(c => c[0] === 'globalAlpha').map(c => c[1]);
      expect(alphas.length).toBeGreaterThan(0);
      expect(alphas[0]).toBeLessThan(1);
      expect(alphas[alphas.length - 1]).toBe(1);
    });
  });

  test('spinKick rotates the field, decaying back toward baseline', () => {
    const square = () => defaultParams({ shape: 'square' });

    const still = makeMockCtx2d();
    const calm = new VibrationsLayer();
    calm.init();
    calm.render(makeHarnessCtx(still), square(), 16);
    // No rotation source → the direct, untransformed draw path.
    expect(still.calls.some(c => c[0] === 'rotate')).toBe(false);

    const spun = makeMockCtx2d();
    const kicked = new VibrationsLayer();
    kicked.init();
    kicked.react('spinKick', { intensity: 1 }, { velocity: 127 });
    kicked.render(makeHarnessCtx(spun), square(), 16);
    const rotations = spun.calls.filter(c => c[0] === 'rotate');
    expect(rotations.length).toBeGreaterThan(0);
    expect(Math.abs(rotations[0][1])).toBeGreaterThan(0);
  });

  test('colorSweep shifts per-ring stroke colors near the front', () => {
    withMockedNow(setNow => {
      const surface = makeMockCtx2d();
      const layer = new VibrationsLayer();
      layer.init();

      setNow(1000);
      layer.react('colorSweep', { degrees: 120, durationMs: 1000 }, { velocity: 127 });
      setNow(1100);
      // A saturated base color — hue rotation is invisible on white.
      layer.render(makeHarnessCtx(surface), defaultParams({ lineColor: '#ff0000' }), 16);

      const colors = surface.calls.filter(c => c[0] === 'strokeStyle').map(c => c[1]);
      // Sweep active → per-ring color resolution, with at least one
      // ring hue-shifted away from the base line color.
      expect(colors.some(col => col !== '#ff0000')).toBe(true);
    });
  });
});

describe('VibrationsLayer — rendering modes', () => {
  test('segments stroke style drops polygon edges evenly', () => {
    const surface = makeMockCtx2d();
    const layer = new VibrationsLayer();
    layer.init();
    layer.render(
      makeHarnessCtx(surface),
      declaredDefaults({ shape: 'hexagon', strokeStyle: 'segments', segmentCount: 3, ringCount: 3 }),
      16
    );

    // 3 of 6 hexagon edges kept per ring → one moveTo+lineTo pair each.
    expect(surface.calls.filter(c => c[0] === 'moveTo').length).toBe(9);
    expect(surface.calls.filter(c => c[0] === 'lineTo').length).toBe(9);
    expect(surface.calls.filter(c => c[0] === 'stroke').length).toBe(3);
  });

  test('gradient color mode assigns a distinct stroke color per ring', () => {
    const surface = makeMockCtx2d();
    const layer = new VibrationsLayer();
    layer.init();
    layer.render(
      makeHarnessCtx(surface),
      declaredDefaults({ colorMode: 'gradient', ringCount: 3, lineColor: '#000000', lineColorB: '#ffffff' }),
      16
    );

    const ringColors = surface.calls
      .filter(c => c[0] === 'strokeStyle')
      .map(c => c[1])
      .slice(1); // first assignment is the pre-loop base color
    expect(ringColors).toEqual(['#000000', '#808080', '#ffffff']);
  });

  test('dashed stroke style sets a dash pattern; switching back to solid clears it', () => {
    const surface = makeMockCtx2d();
    const layer = new VibrationsLayer();
    layer.init();

    layer.render(makeHarnessCtx(surface), declaredDefaults({ strokeStyle: 'dashed' }), 16);
    const dashCalls = surface.calls.filter(c => c[0] === 'setLineDash');
    expect(dashCalls.length).toBe(1);
    expect(dashCalls[0][1].length).toBe(2);

    surface.calls.length = 0;
    layer.render(makeHarnessCtx(surface), declaredDefaults({ strokeStyle: 'solid' }), 16);
    // One clearing call on the transition frame, then never again.
    expect(surface.calls.filter(c => c[0] === 'setLineDash')).toEqual([['setLineDash', []]]);

    surface.calls.length = 0;
    layer.render(makeHarnessCtx(surface), declaredDefaults({ strokeStyle: 'solid' }), 16);
    expect(surface.calls.filter(c => c[0] === 'setLineDash')).toEqual([]);
  });
});
