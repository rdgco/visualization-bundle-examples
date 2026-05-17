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
 */

import { describe, test, expect } from '@jest/globals';
import VibrationsLayer from './vibrations-layer.js';

function makeMockCtx2d() {
  const calls = [];
  const canvas = { width: 800, height: 600 };
  const ctx2d = {
    canvas,
    _calls: calls,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: '',
    lineCap: '',
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    beginPath: () => calls.push(['beginPath']),
    arc: (...args) => calls.push(['arc', ...args]),
    rect: (...args) => calls.push(['rect', ...args]),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    closePath: () => calls.push(['closePath']),
    stroke: () => calls.push(['stroke'])
  };
  return { canvas, ctx2d, calls };
}

function makeHarnessCtx({ canvas, ctx2d }) {
  return { canvas, width: canvas.width, height: canvas.height, ctx2d };
}

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
});
