import * as THREE from 'three';
import type { ShipId } from '../types/game';
import type { MissionDefinition, MissionEnvironmentTheme } from '../types/mission';

export interface HullTextureBundle {
  hullAlbedo: THREE.CanvasTexture;
  hullRoughness: THREE.CanvasTexture;
  hullBump: THREE.CanvasTexture;
}

export interface EnvironmentTextureBundle {
  themeId: string;
  resolution: number;
  gasGiantMap: THREE.CanvasTexture;
  moonMap: THREE.CanvasTexture;
  asteroidMap: THREE.CanvasTexture;
}

export interface AssetDiagnostics {
  cachedResources: number;
  totalRefs: number;
  lastLoadDurationMs: number;
  loadedKeys: string[];
}

interface CacheEntry<T> {
  value: T;
  refs: number;
  scope: 'shared' | 'ship' | 'mission';
  dispose: () => void;
}

const DEFAULT_MENU_THEME: MissionEnvironmentTheme = {
  id: 'aurelia-rim',
  sectorName: 'Aurelia Outer Rim',
  nebulaVoid: [0.012, 0.024, 0.058],
  nebulaMid: [0.032, 0.088, 0.215],
  nebulaIon: [0.045, 0.42, 0.64],
  fogColor: '#040a18',
  keyLightColor: '#f8fafc',
  hemiSkyColor: '#38bdf8',
  rimLightColor: '#0ea5e9',
  planetBands: ['#071024', '#1e3a5f', '#6fa3c7', '#132a4f'],
  atmosphereColor: '#38bdf8',
  asteroidTint: '#94a3b8',
  beaconColor: '#22d3ee',
};

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Centralized Progressive Asset Manager (Stages A–E):
 * - Stage A (Boot): Lightweight shared glow sprite only; avoids eager planetary/ship generation.
 * - Stage B (Hangar): On-demand ship hull textures + idle background preloading.
 * - Stage C (Mission Prep): Loads mission-specific themed planet/moon/asteroid maps, hull PBR maps,
 *   and VFX textures with progress reporting, abort cancellation, and error recovery.
 * - Stage D (Runtime): Reference-counted cache avoids duplicate allocations.
 * - Stage E (Cleanup): Disposes mission-specific GPU textures on mission exit while preserving
 *   shared resources still referenced by active scenes.
 */
class AssetManagerImpl {
  private cache = new Map<string, CacheEntry<unknown>>();
  private maxAnisotropy = 4;
  private lastLoadDurationMs = 0;
  private activeMissionEnvKeys = new Set<string>();
  private preloadedShips = new Set<ShipId>();

  public configureRenderer(renderer: THREE.WebGLRenderer): void {
    this.maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  }

  public acquire<T>(
    key: string,
    scope: 'shared' | 'ship' | 'mission',
    factory: () => T,
    dispose: (val: T) => void,
  ): T {
    const existing = this.cache.get(key) as CacheEntry<T> | undefined;
    if (existing) {
      existing.refs += 1;
      return existing.value;
    }
    const value = factory();
    this.cache.set(key, {
      value,
      refs: 1,
      scope,
      dispose: () => dispose(value),
    });
    return value;
  }

  public release(key: string): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    entry.refs -= 1;
    if (entry.refs <= 0) {
      entry.dispose();
      this.cache.delete(key);
    }
  }

  public hasCached(key: string): boolean {
    return this.cache.has(key);
  }

  public getDiagnostics(): AssetDiagnostics {
    let totalRefs = 0;
    const loadedKeys: string[] = [];
    for (const [key, entry] of this.cache.entries()) {
      totalRefs += entry.refs;
      loadedKeys.push(key);
    }
    return {
      cachedResources: this.cache.size,
      totalRefs,
      lastLoadDurationMs: this.lastLoadDurationMs,
      loadedKeys,
    };
  }

  /**
   * Stage A (Boot): Shared radial glow sprite for thrusters, muzzle flashes, and shockwaves.
   */
  public acquireGlowSprite(): THREE.CanvasTexture {
    return this.acquire<THREE.CanvasTexture>(
      'shared:glowSprite',
      'shared',
      () => this.createGlowSpriteTexture(),
      (tex) => tex.dispose(),
    );
  }

  public releaseGlowSprite(): void {
    this.release('shared:glowSprite');
  }

  /**
   * Stage B / C: Acquires shared ship hull PBR textures at the requested resolution.
   */
  public acquireHullTextures(resolution: 256 | 512 | 1024 = 512): {
    key: string;
    bundle: HullTextureBundle;
  } {
    const key = `ship:hullPbr:${resolution}`;
    const bundle = this.acquire<HullTextureBundle>(
      key,
      'ship',
      () => ({
        hullAlbedo: this.createHullAlbedoTexture(resolution),
        hullRoughness: this.createHullRoughnessTexture(resolution),
        hullBump: this.createHullBumpTexture(resolution),
      }),
      (b) => {
        b.hullAlbedo.dispose();
        b.hullRoughness.dispose();
        b.hullBump.dispose();
      },
    );
    return { key, bundle };
  }

  public releaseHullTextures(key: string): void {
    this.release(key);
  }

  /**
   * Stage B (Hangar): Marks ship assets ready and schedules non-blocking idle preload.
   */
  public preloadShipInBackground(shipId: ShipId, resolution: 256 | 512 | 1024 = 512): void {
    if (this.preloadedShips.has(shipId)) return;
    this.preloadedShips.add(shipId);

    const runPreload = () => {
      const key = `ship:hullPbr:${resolution}`;
      if (!this.cache.has(key)) {
        // Warm cache once and keep ref=1 so hangar switching is instant
        this.acquireHullTextures(resolution);
      }
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(
        runPreload,
      );
    } else {
      setTimeout(runPreload, 40);
    }
  }

  /**
   * Stage C / D: Acquires mission-themed environment textures (gas giant, moon, asteroid)
   * keyed by theme ID and graphics resolution.
   */
  public acquireEnvironmentTextures(
    theme: MissionEnvironmentTheme = DEFAULT_MENU_THEME,
    resolution: 256 | 512 | 1024 = 512,
  ): { key: string; bundle: EnvironmentTextureBundle } {
    const key = `mission:${theme.id}:env:${resolution}`;
    const bundle = this.acquire<EnvironmentTextureBundle>(
      key,
      'mission',
      () => ({
        themeId: theme.id,
        resolution,
        gasGiantMap: this.createGasGiantTexture(theme, resolution),
        moonMap: this.createMoonTexture(theme, Math.max(256, resolution >> 1)),
        asteroidMap: this.createAsteroidTexture(theme, Math.min(256, resolution)),
      }),
      (b) => {
        b.gasGiantMap.dispose();
        b.moonMap.dispose();
        b.asteroidMap.dispose();
      },
    );
    return { key, bundle };
  }

  public releaseEnvironmentTextures(key: string): void {
    this.release(key);
  }

  /**
   * Stage C (Mission Preparation):
   * Progressive async loader for a specific campaign mission.
   * Loads only what the selected mission & ship need, yields between steps for responsive UI,
   * supports abort cancellation, tracks load duration, and recovers cleanly on error.
   */
  public async loadMissionAssets(
    mission: MissionDefinition,
    shipId: ShipId,
    resolution: 256 | 512 | 1024,
    onProgress: (stage: string, percent: number) => void,
    signal?: AbortSignal,
    options?: { simulateFailure?: boolean },
  ): Promise<{ envKey: string; hullKey: string; durationMs: number }> {
    const started = nowMs();
    const acquiredDuringLoad: string[] = [];

    const checkAborted = () => {
      if (signal?.aborted) {
        for (const k of acquiredDuringLoad) {
          this.release(k);
        }
        throw new Error('ABORTED');
      }
    };

    try {
      onProgress(`Initializing ${mission.code} tactical brief (${mission.environment.sectorName})`, 12);
      await yieldToMainThread();
      checkAborted();

      if (options?.simulateFailure) {
        throw new Error('Simulated sector telemetry asset failure');
      }

      onProgress(`Loading ${shipId.toUpperCase()} hull PBR maps (${resolution}px)`, 36);
      await yieldToMainThread();
      checkAborted();
      const hullRes = this.acquireHullTextures(resolution);
      acquiredDuringLoad.push(hullRes.key);

      onProgress(`Synthesizing ${mission.environment.sectorName} planetary & orbital textures`, 68);
      await yieldToMainThread();
      checkAborted();
      const envRes = this.acquireEnvironmentTextures(mission.environment, resolution);
      acquiredDuringLoad.push(envRes.key);
      this.activeMissionEnvKeys.add(envRes.key);

      onProgress('Warming weapon VFX sprites & pooled combat systems', 90);
      await yieldToMainThread();
      checkAborted();
      this.acquireGlowSprite();
      acquiredDuringLoad.push('shared:glowSprite');

      const durationMs = Math.max(1, nowMs() - started);
      this.lastLoadDurationMs = durationMs;

      onProgress(`${mission.code} flight systems ready`, 100);
      await yieldToMainThread();
      checkAborted();

      return { envKey: envRes.key, hullKey: hullRes.key, durationMs };
    } catch (err) {
      for (const k of acquiredDuringLoad) {
        this.release(k);
        this.activeMissionEnvKeys.delete(k);
      }
      throw err;
    }
  }

  /**
   * Stage E (Cleanup & Transition):
   * Releases mission-scoped references acquired during Stage C so unused mission textures
   * are disposed from GPU memory while shared assets still used by Menu/Ship remain intact.
   */
  public releaseMissionSession(envKey: string | null, hullKey: string | null): void {
    if (envKey) {
      this.release(envKey);
      this.activeMissionEnvKeys.delete(envKey);
    }
    if (hullKey) {
      this.release(hullKey);
    }
    this.releaseGlowSprite();
  }

  private configureTexture(
    tex: THREE.CanvasTexture,
    isColor: boolean,
    repeatX = 1,
    repeatY = 1,
  ): THREE.CanvasTexture {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = this.maxAnisotropy;
    tex.needsUpdate = true;
    return tex;
  }

  private createCanvas(width: number, height: number): {
    canvas: HTMLCanvasElement | null;
    ctx: CanvasRenderingContext2D | null;
  } {
    if (typeof document === 'undefined') {
      return { canvas: null, ctx: null };
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    return { canvas, ctx };
  }

  private createTextureFromCanvas(
    canvas: HTMLCanvasElement | null,
    isColor: boolean,
    repeatX = 1,
    repeatY = 1,
  ): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(canvas ?? undefined);
    return this.configureTexture(tex, isColor, repeatX, repeatY);
  }

  private createHullAlbedoTexture(size: number): THREE.CanvasTexture {
    const { canvas, ctx } = this.createCanvas(size, size);
    if (!ctx) return this.createTextureFromCanvas(canvas, true, 2, 2);

    const s = size / 512;
    ctx.fillStyle = '#c8d4e3';
    ctx.fillRect(0, 0, size, size);

    for (let y = 0; y < size; y += 2) {
      const shade = 192 + ((Math.sin(y * 0.73) * 7 + Math.cos(y * 2.1) * 5) | 0);
      ctx.fillStyle = `rgb(${shade - 6}, ${shade}, ${shade + 8})`;
      ctx.fillRect(0, y, size, 2);
    }

    const panels = [
      [16, 16, 224, 140, 'rgba(255,255,255,0.06)'],
      [256, 16, 240, 220, 'rgba(15,23,42,0.09)'],
      [16, 172, 224, 160, 'rgba(15,23,42,0.06)'],
      [256, 252, 240, 244, 'rgba(255,255,255,0.05)'],
      [16, 348, 224, 148, 'rgba(30,41,59,0.08)'],
    ] as const;

    for (const [x, y, w, h, fill] of panels) {
      ctx.fillStyle = fill;
      ctx.fillRect(x * s, y * s, w * s, h * s);
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
      ctx.lineWidth = Math.max(1, 2 * s);
      ctx.strokeRect(x * s, y * s, w * s, h * s);
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.25)';
      ctx.lineWidth = Math.max(1, s);
      ctx.strokeRect((x + 2) * s, (y + 2) * s, (w - 4) * s, (h - 4) * s);
    }

    ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
    const step = Math.max(32, Math.round(64 * s));
    for (let x = Math.round(28 * s); x < size; x += step) {
      for (let y = Math.round(28 * s); y < size; y += step) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, 1.8 * s), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    return this.createTextureFromCanvas(canvas, true, 2, 2);
  }

  private createHullRoughnessTexture(size: number): THREE.CanvasTexture {
    const { canvas, ctx } = this.createCanvas(size, size);
    if (!ctx) return this.createTextureFromCanvas(canvas, false, 2, 2);

    const s = size / 512;
    ctx.fillStyle = '#585858';
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = '#404040';
    ctx.fillRect(16 * s, 16 * s, 224 * s, 140 * s);
    ctx.fillStyle = '#6c6c6c';
    ctx.fillRect(256 * s, 16 * s, 240 * s, 220 * s);
    ctx.fillStyle = '#4d4d4d';
    ctx.fillRect(256 * s, 252 * s, 240 * s, 244 * s);

    ctx.strokeStyle = '#b8b8b8';
    ctx.lineWidth = Math.max(1, 3 * s);
    ctx.strokeRect(16 * s, 16 * s, 224 * s, 140 * s);
    ctx.strokeRect(256 * s, 16 * s, 240 * s, 220 * s);
    ctx.strokeRect(16 * s, 172 * s, 224 * s, 160 * s);
    ctx.strokeRect(256 * s, 252 * s, 240 * s, 244 * s);

    return this.createTextureFromCanvas(canvas, false, 2, 2);
  }

  private createHullBumpTexture(size: number): THREE.CanvasTexture {
    const { canvas, ctx } = this.createCanvas(size, size);
    if (!ctx) return this.createTextureFromCanvas(canvas, false, 2, 2);

    const s = size / 512;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = '#202020';
    ctx.lineWidth = Math.max(1, 3 * s);
    ctx.strokeRect(16 * s, 16 * s, 224 * s, 140 * s);
    ctx.strokeRect(256 * s, 16 * s, 240 * s, 220 * s);
    ctx.strokeRect(16 * s, 172 * s, 224 * s, 160 * s);
    ctx.strokeRect(256 * s, 252 * s, 240 * s, 244 * s);
    ctx.strokeRect(16 * s, 348 * s, 224 * s, 148 * s);

    ctx.strokeStyle = '#383838';
    ctx.lineWidth = Math.max(1, 2 * s);
    ctx.strokeRect(64 * s, 56 * s, 48 * s, 32 * s);
    ctx.strokeRect(320 * s, 310 * s, 68 * s, 42 * s);

    return this.createTextureFromCanvas(canvas, false, 2, 2);
  }

  private createGasGiantTexture(
    theme: MissionEnvironmentTheme,
    resolution: number,
  ): THREE.CanvasTexture {
    const w = resolution;
    const h = Math.max(128, resolution >> 1);
    const { canvas, ctx } = this.createCanvas(w, h);
    if (!ctx) return this.createTextureFromCanvas(canvas, true, 1, 1);

    const [c0, c1, c2, c3] = theme.planetBands;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, c0);
    grad.addColorStop(0.24, c1);
    grad.addColorStop(0.5, c2);
    grad.addColorStop(0.76, c3);
    grad.addColorStop(1.0, c0);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const bandCount = Math.max(28, Math.round(h / 8));
    for (let i = 0; i < bandCount; i++) {
      const y = (i / bandCount) * h;
      const bandH = 2 + ((i * 7) % 12) * (h / 512);
      const alpha = 0.08 + ((i * 13) % 10) * 0.014;
      ctx.fillStyle =
        i % 3 === 0 ? `rgba(186, 230, 253, ${alpha})` : `rgba(8, 18, 38, ${alpha * 1.4})`;

      ctx.beginPath();
      ctx.moveTo(0, y);
      const stepX = Math.max(16, w / 32);
      for (let x = 0; x <= w; x += stepX) {
        const wave = Math.sin(x * 0.015 + i * 1.3) * 4 + Math.cos(x * 0.03 - i * 0.7) * 2.5;
        ctx.lineTo(x, y + wave);
      }
      ctx.lineTo(w, y + bandH);
      ctx.lineTo(0, y + bandH);
      ctx.closePath();
      ctx.fill();
    }

    const stormR = w * 0.068;
    const stormGrad = ctx.createRadialGradient(w * 0.62, h * 0.44, 4, w * 0.62, h * 0.44, stormR);
    stormGrad.addColorStop(0, 'rgba(224, 242, 254, 0.55)');
    stormGrad.addColorStop(0.45, 'rgba(56, 189, 248, 0.25)');
    stormGrad.addColorStop(1, 'rgba(14, 116, 144, 0)');
    ctx.save();
    ctx.scale(1.6, 0.72);
    ctx.fillStyle = stormGrad;
    ctx.beginPath();
    ctx.arc((w * 0.62) / 1.6, (h * 0.44) / 0.72, stormR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    return this.createTextureFromCanvas(canvas, true, 1, 1);
  }

  private createMoonTexture(theme: MissionEnvironmentTheme, w: number): THREE.CanvasTexture {
    const h = Math.max(128, w >> 1);
    const { canvas, ctx } = this.createCanvas(w, h);
    if (!ctx) return this.createTextureFromCanvas(canvas, true, 1, 1);

    ctx.fillStyle = '#475569';
    ctx.fillRect(0, 0, w, h);

    // Subtle mission tint wash
    ctx.fillStyle = theme.asteroidTint;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    for (let i = 0; i < 90; i++) {
      const x = (i * 97) % w;
      const y = (i * 53) % h;
      const r = 6 + ((i * 19) % 28);
      ctx.fillStyle = i % 2 === 0 ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.22)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < 36; i++) {
      const x = (i * 131 + 29) % w;
      const y = 16 + ((i * 71) % Math.max(16, h - 32));
      const r = 4 + ((i * 11) % 16);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.36)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(203, 213, 225, 0.22)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x - 1, y - 1, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    return this.createTextureFromCanvas(canvas, true, 1, 1);
  }

  private createAsteroidTexture(theme: MissionEnvironmentTheme, size: number): THREE.CanvasTexture {
    const { canvas, ctx } = this.createCanvas(size, size);
    if (!ctx) return this.createTextureFromCanvas(canvas, true, 1, 1);

    ctx.fillStyle = '#334155';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = theme.asteroidTint;
    ctx.globalAlpha = 0.15;
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 1;

    for (let i = 0; i < 72; i++) {
      const x = (i * 67) % size;
      const y = (i * 41) % size;
      const r = 4 + ((i * 13) % 18);
      ctx.fillStyle = i % 3 === 0 ? 'rgba(100,116,139,0.22)' : 'rgba(15,23,42,0.28)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    return this.createTextureFromCanvas(canvas, true, 1, 1);
  }

  private createGlowSpriteTexture(): THREE.CanvasTexture {
    const size = 128;
    const { canvas, ctx } = this.createCanvas(size, size);
    if (!ctx) {
      const tex = new THREE.CanvasTexture(canvas ?? undefined);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }
    const c = size / 2;
    const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.25, 'rgba(165, 243, 252, 0.78)');
    grad.addColorStop(0.55, 'rgba(6, 182, 212, 0.28)');
    grad.addColorStop(1.0, 'rgba(6, 182, 212, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas!);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  public disposeAll(): void {
    for (const entry of this.cache.values()) {
      entry.dispose();
    }
    this.cache.clear();
    this.activeMissionEnvKeys.clear();
    this.preloadedShips.clear();
  }
}

export const AssetManager = new AssetManagerImpl();
