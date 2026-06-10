/**
 * Vignette Parameter Schema
 *
 * Defines the 20 modulatable vignette parameters in the layer-core filter
 * param shape. Flat dot-notation keys (e.g. 'frame.blur') are used because
 * modulation engines work with flat param names; the filter reconstructs the
 * nested config the shader expects from these flat values.
 *
 * Param grouping: each entry declares `paramGroup` so a contract-aware
 * inspector renders Shape / Frame / Glass as three separately collapsible
 * sections. The first entry in each group also declares `paramGroupLabel`
 * (later entries in the same group merge from the first).
 *
 * Each modulatable param carries the cross-host audio marker (`kind: 'audio'`
 * for the harness's audio UI; `sourceTypes` + `defaultAmount` for the
 * platform; lfo/random for the platform's generators).
 */

const MOD_ALL = {
  kind: 'audio',
  sourceTypes: ['audio', 'oneshot', 'note', 'tempo', 'lfo', 'random']
};

export const vignetteSchema = {
  // --- Shape params ---
  sizeX: {
    type: 'number', label: 'Horizontal Radius',
    min: 0, max: 100, default: 50, step: 1,
    modulation: { ...MOD_ALL, defaultAmount: 20 },
    paramGroup: 'shape', paramGroupLabel: 'Shape'
  },
  sizeY: {
    type: 'number', label: 'Vertical Radius',
    min: 0, max: 100, default: 50, step: 1,
    modulation: { ...MOD_ALL, defaultAmount: 20 },
    paramGroup: 'shape'
  },
  softness: {
    type: 'number', label: 'Softness',
    min: 0, max: 100, default: 0, step: 1,
    modulation: { ...MOD_ALL, defaultAmount: 15 },
    paramGroup: 'shape'
  },

  // --- Frame (border) params ---
  'frame.color': {
    type: 'color', label: 'Frame Color',
    default: '#000000',
    modulation: {
      kind: 'audio',
      sourceTypes: ['audio', 'oneshot', 'note', 'tempo', 'lfo', 'random'],
      colorMode: 'hueShift',
      colorModes: ['hueShift', 'rgbDelta'],
      defaultAmount: 30
    },
    paramGroup: 'frame', paramGroupLabel: 'Frame'
  },
  'frame.opacity': {
    type: 'number', label: 'Frame Opacity',
    min: 0, max: 1, default: 1, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.3 },
    paramGroup: 'frame'
  },
  'frame.blur': {
    type: 'number', label: 'Frame Blur',
    min: 0, max: 30, default: 0, step: 0.5,
    modulation: { ...MOD_ALL, defaultAmount: 8 },
    paramGroup: 'frame'
  },
  'frame.brightness': {
    type: 'number', label: 'Frame Brightness',
    min: 0, max: 3, default: 1, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.5 },
    paramGroup: 'frame'
  },
  'frame.contrast': {
    type: 'number', label: 'Frame Contrast',
    min: 0, max: 3, default: 1, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.5 },
    paramGroup: 'frame'
  },
  'frame.saturate': {
    type: 'number', label: 'Frame Saturate',
    min: 0, max: 3, default: 1, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.5 },
    paramGroup: 'frame'
  },
  'frame.hueRotate': {
    type: 'number', label: 'Frame Hue Rotate',
    min: 0, max: 360, default: 0, step: 1,
    modulation: { ...MOD_ALL, defaultAmount: 60 },
    paramGroup: 'frame'
  },

  // --- Glass (center) params ---
  'glass.color': {
    type: 'color', label: 'Glass Color',
    default: '#000000',
    modulation: {
      kind: 'audio',
      sourceTypes: ['audio', 'oneshot', 'note', 'tempo', 'lfo', 'random'],
      colorMode: 'hueShift',
      colorModes: ['hueShift', 'rgbDelta'],
      defaultAmount: 30
    },
    paramGroup: 'glass', paramGroupLabel: 'Glass'
  },
  'glass.opacity': {
    type: 'number', label: 'Glass Opacity',
    min: 0, max: 1, default: 0, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.3 },
    paramGroup: 'glass'
  },
  'glass.blur': {
    type: 'number', label: 'Glass Blur',
    min: 0, max: 30, default: 0, step: 0.5,
    modulation: { ...MOD_ALL, defaultAmount: 8 },
    paramGroup: 'glass'
  },
  'glass.brightness': {
    type: 'number', label: 'Glass Brightness',
    min: 0, max: 3, default: 1, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.5 },
    paramGroup: 'glass'
  },
  'glass.contrast': {
    type: 'number', label: 'Glass Contrast',
    min: 0, max: 3, default: 1, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.5 },
    paramGroup: 'glass'
  },
  'glass.saturate': {
    type: 'number', label: 'Glass Saturate',
    min: 0, max: 3, default: 1, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.5 },
    paramGroup: 'glass'
  },
  'glass.hueRotate': {
    type: 'number', label: 'Glass Hue Rotate',
    min: 0, max: 360, default: 0, step: 1,
    modulation: { ...MOD_ALL, defaultAmount: 60 },
    paramGroup: 'glass'
  },
  'glass.lens': {
    type: 'number', label: 'Glass Lens',
    min: -20, max: 20, default: 0, step: 0.1,
    modulation: { ...MOD_ALL, defaultAmount: 3 },
    paramGroup: 'glass'
  },
  'glass.lensPower': {
    type: 'number', label: 'Glass Lens Power',
    min: 0.1, max: 20, default: 2, step: 0.1,
    modulation: { ...MOD_ALL, defaultAmount: 4 },
    paramGroup: 'glass'
  },
  'glass.zoom': {
    type: 'number', label: 'Glass Zoom',
    min: 0.05, max: 20, default: 1, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.5 },
    paramGroup: 'glass'
  }
};

/**
 * Extract flat base values from a nested vignette config for the modulation engine.
 * { sizeX: 55, frame: { blur: 3, ... } } → { sizeX: 55, 'frame.blur': 3, ... }
 */
export function flattenVignetteConfig(config) {
  if (!config) return {};
  const flat = {};
  if (config.sizeX !== undefined) flat.sizeX = config.sizeX;
  if (config.sizeY !== undefined) flat.sizeY = config.sizeY;
  if (config.softness !== undefined) flat.softness = config.softness;
  for (const region of ['frame', 'glass']) {
    const r = config[region];
    if (!r) continue;
    for (const key of ['color', 'opacity', 'blur', 'brightness', 'contrast', 'saturate', 'hueRotate', 'lens', 'lensPower', 'zoom']) {
      if (r[key] !== undefined) flat[`${region}.${key}`] = r[key];
    }
  }
  return flat;
}

/**
 * Reconstruct nested vignette config from flat modulated values.
 * Merges modulated values on top of the base config.
 * { sizeX: 65, 'frame.blur': 8.5 } + baseConfig → full nested config
 */
export function buildModulatedVignetteConfig(baseConfig, modulatedValues) {
  const config = { ...baseConfig };
  config.frame = { ...(baseConfig.frame || {}) };
  config.glass = { ...(baseConfig.glass || {}) };
  for (const [key, value] of Object.entries(modulatedValues)) {
    if (key.startsWith('frame.')) {
      config.frame[key.slice(6)] = value;
    } else if (key.startsWith('glass.')) {
      config.glass[key.slice(6)] = value;
    } else {
      config[key] = value;
    }
  }
  return config;
}
