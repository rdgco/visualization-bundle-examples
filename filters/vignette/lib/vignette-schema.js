/**
 * Vignette Parameter Schema
 *
 * Defines the 20 modulatable vignette parameters with the same shape
 * as program param schemas. Used by the ModulationEngine in
 * central-display.html and by ProgramEditor.js for the modulation UI.
 *
 * Flat dot-notation keys (e.g. 'frame.blur') are used because the
 * modulation engine works with flat param names. A reconstruction
 * function converts the flat modulated values back to the nested
 * structure that applyVignette() / setVignetteConfig() expects.
 *
 * Defaults here MUST match VIGNETTE_DEFAULTS in ProgramEditor.js.
 */

const MOD_ALL = {
  sourceTypes: ['oneshot', 'note', 'audio', 'tempo']
};

export const vignetteSchema = {
  // --- Shape params ---
  sizeX: {
    type: 'number', label: 'Horizontal Radius',
    min: 0, max: 100, default: 50, step: 1,
    modulation: { ...MOD_ALL, defaultAmount: 20 }
  },
  sizeY: {
    type: 'number', label: 'Vertical Radius',
    min: 0, max: 100, default: 50, step: 1,
    modulation: { ...MOD_ALL, defaultAmount: 20 }
  },
  softness: {
    type: 'number', label: 'Softness',
    min: 0, max: 100, default: 0, step: 1,
    modulation: { ...MOD_ALL, defaultAmount: 15 }
  },

  // --- Frame (border) params ---
  'frame.color': {
    type: 'color', label: 'Frame Color',
    default: '#000000',
    modulation: {
      sourceTypes: ['oneshot', 'note', 'audio', 'tempo'],
      colorMode: 'hueShift',
      colorModes: ['hueShift', 'rgbDelta'],
      defaultAmount: 30
    }
  },
  'frame.opacity': {
    type: 'number', label: 'Frame Opacity',
    min: 0, max: 1, default: 1, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.3 }
  },
  'frame.blur': {
    type: 'number', label: 'Frame Blur',
    min: 0, max: 30, default: 0, step: 0.5,
    modulation: { ...MOD_ALL, defaultAmount: 8 }
  },
  'frame.brightness': {
    type: 'number', label: 'Frame Brightness',
    min: 0, max: 3, default: 1, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.5 }
  },
  'frame.contrast': {
    type: 'number', label: 'Frame Contrast',
    min: 0, max: 3, default: 1, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.5 }
  },
  'frame.saturate': {
    type: 'number', label: 'Frame Saturate',
    min: 0, max: 3, default: 1, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.5 }
  },
  'frame.hueRotate': {
    type: 'number', label: 'Frame Hue Rotate',
    min: 0, max: 360, default: 0, step: 1,
    modulation: { ...MOD_ALL, defaultAmount: 60 }
  },

  // --- Glass (center) params ---
  'glass.color': {
    type: 'color', label: 'Glass Color',
    default: '#000000',
    modulation: {
      sourceTypes: ['oneshot', 'note', 'audio', 'tempo'],
      colorMode: 'hueShift',
      colorModes: ['hueShift', 'rgbDelta'],
      defaultAmount: 30
    }
  },
  'glass.opacity': {
    type: 'number', label: 'Glass Opacity',
    min: 0, max: 1, default: 0, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.3 }
  },
  'glass.blur': {
    type: 'number', label: 'Glass Blur',
    min: 0, max: 30, default: 0, step: 0.5,
    modulation: { ...MOD_ALL, defaultAmount: 8 }
  },
  'glass.brightness': {
    type: 'number', label: 'Glass Brightness',
    min: 0, max: 3, default: 1, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.5 }
  },
  'glass.contrast': {
    type: 'number', label: 'Glass Contrast',
    min: 0, max: 3, default: 1, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.5 }
  },
  'glass.saturate': {
    type: 'number', label: 'Glass Saturate',
    min: 0, max: 3, default: 1, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.5 }
  },
  'glass.hueRotate': {
    type: 'number', label: 'Glass Hue Rotate',
    min: 0, max: 360, default: 0, step: 1,
    modulation: { ...MOD_ALL, defaultAmount: 60 }
  },
  'glass.lens': {
    type: 'number', label: 'Glass Lens',
    min: -20, max: 20, default: 0, step: 0.1,
    modulation: { ...MOD_ALL, defaultAmount: 3 }
  },
  'glass.lensPower': {
    type: 'number', label: 'Glass Lens Power',
    min: 0.1, max: 20, default: 2, step: 0.1,
    modulation: { ...MOD_ALL, defaultAmount: 4 }
  },
  'glass.zoom': {
    type: 'number', label: 'Glass Zoom',
    min: 0.05, max: 20, default: 1, step: 0.05,
    modulation: { ...MOD_ALL, defaultAmount: 0.5 }
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
