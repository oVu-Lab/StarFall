import type {
  EffectQuality,
  GameSettings,
  GraphicsQuality,
  ShadowQuality,
} from '../types/game';

export interface GraphicsPreset {
  quality: GraphicsQuality;
  dprCap: number;
  resolutionScale: number;
  antialias: boolean;
  shadows: boolean;
  shadowQuality: ShadowQuality;
  shadowMapSize: number;
  particleQuality: EffectQuality;
  maxSparkParticles: number;
  maxShockwaves: number;
  sparkScaleFactor: number;
  environmentDetail: EffectQuality;
  starCount: number;
  asteroidCount: number;
  speedLineCount: number;
  planetSegments: number;
  nebulaOctaves: number;
  textureResolution: 256 | 512 | 1024;
  drawDistance: number;
  postGlowEnabled: boolean;
  enemyLightLodDistance: number;
}

export const GRAPHICS_PRESETS: Record<GraphicsQuality, GraphicsPreset> = {
  low: {
    quality: 'low',
    dprCap: 1.0,
    resolutionScale: 0.75,
    antialias: false,
    shadows: false,
    shadowQuality: 'off',
    shadowMapSize: 512,
    particleQuality: 'low',
    maxSparkParticles: 90,
    maxShockwaves: 6,
    sparkScaleFactor: 0.45,
    environmentDetail: 'low',
    starCount: 1500,
    asteroidCount: 70,
    speedLineCount: 110,
    planetSegments: 28,
    nebulaOctaves: 2,
    textureResolution: 256,
    drawDistance: 2400,
    postGlowEnabled: false,
    enemyLightLodDistance: 120,
  },
  medium: {
    quality: 'medium',
    dprCap: 1.35,
    resolutionScale: 0.9,
    antialias: true,
    shadows: true,
    shadowQuality: 'low',
    shadowMapSize: 512,
    particleQuality: 'medium',
    maxSparkParticles: 160,
    maxShockwaves: 10,
    sparkScaleFactor: 0.75,
    environmentDetail: 'medium',
    starCount: 2600,
    asteroidCount: 135,
    speedLineCount: 190,
    planetSegments: 42,
    nebulaOctaves: 3,
    textureResolution: 512,
    drawDistance: 3200,
    postGlowEnabled: true,
    enemyLightLodDistance: 220,
  },
  high: {
    quality: 'high',
    dprCap: 1.75,
    resolutionScale: 1.0,
    antialias: true,
    shadows: true,
    shadowQuality: 'medium',
    shadowMapSize: 1024,
    particleQuality: 'high',
    maxSparkParticles: 240,
    maxShockwaves: 14,
    sparkScaleFactor: 1.0,
    environmentDetail: 'high',
    starCount: 4000,
    asteroidCount: 200,
    speedLineCount: 260,
    planetSegments: 56,
    nebulaOctaves: 4,
    textureResolution: 512,
    drawDistance: 4200,
    postGlowEnabled: true,
    enemyLightLodDistance: 300,
  },
  ultra: {
    quality: 'ultra',
    dprCap: 2.0,
    resolutionScale: 1.0,
    antialias: true,
    shadows: true,
    shadowQuality: 'high',
    shadowMapSize: 2048,
    particleQuality: 'high',
    maxSparkParticles: 320,
    maxShockwaves: 16,
    sparkScaleFactor: 1.25,
    environmentDetail: 'high',
    starCount: 5400,
    asteroidCount: 270,
    speedLineCount: 340,
    planetSegments: 72,
    nebulaOctaves: 5,
    textureResolution: 1024,
    drawDistance: 5200,
    postGlowEnabled: true,
    enemyLightLodDistance: 380,
  },
};

export function getGraphicsPresetPatch(quality: GraphicsQuality): Partial<GameSettings> {
  const p = GRAPHICS_PRESETS[quality] ?? GRAPHICS_PRESETS.high;
  return {
    graphicsQuality: quality,
    resolutionScale: p.resolutionScale,
    shadowQuality: p.shadowQuality,
    particleQuality: p.particleQuality,
    environmentDetail: p.environmentDetail,
    drawDistance: p.drawDistance,
    antialias: p.antialias,
    postGlowEnabled: p.postGlowEnabled,
  };
}

let cachedSoftwareGl: boolean | null = null;

/**
 * Detects software WebGL renderers (SwiftShader, llvmpipe, WARP) from the GPU renderer string.
 * Scales pixel cost conservatively without altering scene identity or gameplay.
 */
export function isSoftwareWebGL(): boolean {
  if (cachedSoftwareGl !== null) return cachedSoftwareGl;
  if (typeof document === 'undefined') {
    cachedSoftwareGl = false;
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) {
      cachedSoftwareGl = true;
      return true;
    }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    cachedSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    return cachedSoftwareGl;
  } catch {
    cachedSoftwareGl = false;
    return false;
  }
}

const SHADOW_MAP_BY_QUALITY: Record<ShadowQuality, number> = {
  off: 512,
  low: 512,
  medium: 1024,
  high: 2048,
};

/**
 * Combines the selected preset with granular user settings into an authoritative
 * runtime rendering configuration actually consumed by Canvas, SpaceEnvironment,
 * CombatVFX, EnemyShipRenderer, and AssetManager.
 */
export function resolveEffectiveGraphics(
  input: GraphicsQuality | GameSettings,
): GraphicsPreset {
  const isPresetOnly = typeof input === 'string';
  const quality: GraphicsQuality = isPresetOnly ? input : input.graphicsQuality;
  const base = GRAPHICS_PRESETS[quality] ?? GRAPHICS_PRESETS.high;

  if (isPresetOnly) {
    if (!isSoftwareWebGL()) return base;
    return {
      ...base,
      dprCap: 1.0,
      antialias: false,
      shadows: false,
      shadowQuality: 'off',
    };
  }

  const resScale = Math.max(0.65, Math.min(1.0, input.resolutionScale ?? base.resolutionScale));
  const shadowQuality = input.shadowQuality ?? base.shadowQuality;
  const particleQuality = input.particleQuality ?? base.particleQuality;
  const envDetail = input.environmentDetail ?? base.environmentDetail;
  const drawDistance = Math.max(2000, Math.min(5200, input.drawDistance ?? base.drawDistance));

  const envStarCount =
    envDetail === 'low' ? 1500 : envDetail === 'medium' ? 2800 : quality === 'ultra' ? 5400 : 4000;
  const envAsteroidCount =
    envDetail === 'low' ? 70 : envDetail === 'medium' ? 140 : quality === 'ultra' ? 270 : 200;
  const envPlanetSegments =
    envDetail === 'low' ? 28 : envDetail === 'medium' ? 44 : quality === 'ultra' ? 72 : 56;
  const envNebulaOctaves =
    envDetail === 'low' ? 2 : envDetail === 'medium' ? 3 : quality === 'ultra' ? 5 : 4;
  const envTexRes: 256 | 512 | 1024 =
    envDetail === 'low' ? 256 : quality === 'ultra' ? 1024 : 512;

  const maxSparkParticles =
    particleQuality === 'low' ? 90 : particleQuality === 'medium' ? 160 : quality === 'ultra' ? 320 : 240;
  const maxShockwaves =
    particleQuality === 'low' ? 6 : particleQuality === 'medium' ? 10 : 16;
  const sparkScaleFactor =
    particleQuality === 'low' ? 0.45 : particleQuality === 'medium' ? 0.75 : quality === 'ultra' ? 1.25 : 1.0;
  const speedLineCount =
    particleQuality === 'low' ? 110 : particleQuality === 'medium' ? 190 : quality === 'ultra' ? 340 : 260;

  const deviceRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const computedDpr = Math.max(0.65, Math.min(base.dprCap, deviceRatio) * resScale);
  const software = isSoftwareWebGL();

  return {
    ...base,
    dprCap: software ? Math.min(1.0, computedDpr) : computedDpr,
    resolutionScale: resScale,
    antialias: software ? false : Boolean(input.antialias),
    shadows: software ? false : shadowQuality !== 'off',
    shadowQuality: software ? 'off' : shadowQuality,
    shadowMapSize: SHADOW_MAP_BY_QUALITY[shadowQuality],
    particleQuality,
    maxSparkParticles,
    maxShockwaves,
    sparkScaleFactor,
    environmentDetail: envDetail,
    starCount: envStarCount,
    asteroidCount: envAsteroidCount,
    speedLineCount,
    planetSegments: envPlanetSegments,
    nebulaOctaves: envNebulaOctaves,
    textureResolution: envTexRes,
    drawDistance,
    postGlowEnabled: Boolean(input.postGlowEnabled),
    enemyLightLodDistance:
      envDetail === 'low' ? 120 : envDetail === 'medium' ? 220 : quality === 'ultra' ? 380 : 300,
  };
}
