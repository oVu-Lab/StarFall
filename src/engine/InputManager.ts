import { STEERING_BOUNDS, STEERING_CONFIG } from '../config/steering';
import type { SteeringZone } from '../types/game';

export interface VirtualStickParams {
  mouseSensitivity: number;
  stickSelfCenterRate?: number;
  deadzone: number;
  maxStickDeflection?: number;
  invertY: boolean;
}

export interface InputSnapshot {
  forward: boolean;
  backward: boolean;
  rollLeft: boolean;
  rollRight: boolean;
  boost: boolean;
  firePrimary: boolean;
  keyPitchUp: boolean;
  keyPitchDown: boolean;
  keyYawLeft: boolean;
  keyYawRight: boolean;
  /** Raw relative mouse deltas consumed during this simulation step */
  mouseDeltaX: number;
  mouseDeltaY: number;
  /** Internal self-centering virtual stick deflection (+X right, +Y screen-down) */
  stickX: number;
  stickY: number;
  /** Normalized virtual stick deflection magnitude [0..1] relative to maxStickDeflection */
  stickMagnitude: number;
  /** Final bounded steering intent: -1..+1 (+1 = nose right) */
  steerYaw: number;
  /** Final bounded steering intent: -1..+1 (+1 = nose up) */
  steerPitch: number;
  /** Active virtual-stick zone for HUD presentation */
  steeringZone: SteeringZone;
  pointerLocked: boolean;
}

export interface InputCallbacks {
  onPauseRequested?: () => void;
  onPointerLockChanged?: (locked: boolean) => void;
  onToggleHudHints?: () => void;
  onTogglePerfMonitor?: () => void;
}

export interface InputDiagnostics {
  pointerLocked: boolean;
  lockOwnedByTarget: boolean;
  pointerLockElementTag: string | null;
  lastMovementX: number;
  lastMovementY: number;
  accumulatedX: number;
  accumulatedY: number;
  stickX: number;
  stickY: number;
  steerYaw: number;
  steerPitch: number;
  warpSpikesFiltered: number;
}

const DEFAULT_STICK_PARAMS: VirtualStickParams = {
  mouseSensitivity: STEERING_CONFIG.mouseSensitivity,
  stickSelfCenterRate: STEERING_CONFIG.stickSelfCenterRate,
  deadzone: STEERING_CONFIG.deadzone,
  maxStickDeflection: STEERING_CONFIG.maxStickDeflection,
  invertY: false,
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Decoupled keyboard + Pointer Lock mouse input manager with an internal
 * self-centering virtual flight stick.
 *
 * Virtual Stick Architecture:
 * - Sole owner of Pointer Lock and relative `event.movementX` / `event.movementY` capture.
 * - Never reads absolute `clientX` / `clientY` or recenters the physical cursor.
 * - Verifies `document.pointerLockElement === this.lockTarget` before accepting mouse input.
 * - Integrates relative mouse deltas onto a bounded normalized virtual stick
 *   `(stickX, stickY)` in `[-maxStickDeflection, +maxStickDeflection]` per axis.
 * - Applies symmetric frame-rate-independent exponential self-centering (`exp(-rate * dt)`)
 *   so stopping mouse motion smoothly returns the stick to center identically across 30-144+ FPS.
 * - Keeps mouse input cleanly separated from ship flight physics (`FlightController`).
 */
export class InputManager {
  private keys = new Set<string>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private stickX = 0;
  private stickY = 0;
  private pointerLocked = false;
  private mouseFireHeld = false;
  private lockTarget: HTMLElement | null = null;
  private active = false;
  private attached = false;
  private callbacks: InputCallbacks = {};

  // Diagnostics for automated verification
  private lastRawMovementX = 0;
  private lastRawMovementY = 0;
  private warpSpikesFiltered = 0;

  private readonly snapshot: InputSnapshot = {
    forward: false,
    backward: false,
    rollLeft: false,
    rollRight: false,
    boost: false,
    firePrimary: false,
    keyPitchUp: false,
    keyPitchDown: false,
    keyYawLeft: false,
    keyYawRight: false,
    mouseDeltaX: 0,
    mouseDeltaY: 0,
    stickX: 0,
    stickY: 0,
    stickMagnitude: 0,
    steerYaw: 0,
    steerPitch: 0,
    steeringZone: 'deadzone',
    pointerLocked: false,
  };

  public attach(callbacks: InputCallbacks): void {
    if (this.attached) {
      this.detach();
    }
    this.callbacks = callbacks;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('pointerlockerror', this.handlePointerLockError);
    this.attached = true;
  }

  public detach(): void {
    if (!this.attached) return;
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    document.removeEventListener('pointerlockerror', this.handlePointerLockError);
    this.attached = false;
    if (this.isLockOwned()) {
      this.exitPointerLock();
    }
    this.keys.clear();
    this.mouseFireHeld = false;
    this.resetVirtualStick();
  }

  public setLockTarget(el: HTMLElement | null): void {
    this.lockTarget = el;
    this.pointerLocked = this.isLockOwned();
  }

  public setActive(isActive: boolean): void {
    this.active = isActive;
    if (!isActive) {
      this.keys.clear();
      this.mouseFireHeld = false;
      this.resetVirtualStick();
    }
  }

  public resetVirtualStick(): void {
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.stickX = 0;
    this.stickY = 0;
    this.snapshot.mouseDeltaX = 0;
    this.snapshot.mouseDeltaY = 0;
    this.snapshot.stickX = 0;
    this.snapshot.stickY = 0;
    this.snapshot.stickMagnitude = 0;
    this.snapshot.steerYaw = 0;
    this.snapshot.steerPitch = 0;
    this.snapshot.steeringZone = 'deadzone';
  }

  private isLockOwned(): boolean {
    if (typeof document === 'undefined' || !this.lockTarget) return false;
    return document.pointerLockElement === this.lockTarget;
  }

  /**
   * Synchronously requests Pointer Lock on the dedicated game canvas within a user gesture.
   */
  public requestPointerLock(): void {
    const target = this.lockTarget;
    if (!target || typeof target.requestPointerLock !== 'function') return;
    if (document.pointerLockElement === target) {
      this.pointerLocked = true;
      return;
    }

    try {
      const maybePromise = target.requestPointerLock() as unknown as Promise<void> | undefined;
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {
          // Gracefully ignore rejected lock requests (e.g., sandboxed frame or rapid unlock)
        });
      }
    } catch {
      // Ignore sandboxed pointer lock exceptions
    }
  }

  public exitPointerLock(): void {
    if (
      typeof document !== 'undefined' &&
      document.pointerLockElement &&
      typeof document.exitPointerLock === 'function'
    ) {
      try {
        document.exitPointerLock();
      } catch {
        // Ignore
      }
    }
  }

  public isPointerLocked(): boolean {
    return this.isLockOwned();
  }

  public getDiagnostics(): InputDiagnostics {
    return {
      pointerLocked: this.pointerLocked,
      lockOwnedByTarget: this.isLockOwned(),
      pointerLockElementTag:
        typeof document !== 'undefined' && document.pointerLockElement
          ? document.pointerLockElement.tagName
          : null,
      lastMovementX: this.lastRawMovementX,
      lastMovementY: this.lastRawMovementY,
      accumulatedX: this.mouseDeltaX,
      accumulatedY: this.mouseDeltaY,
      stickX: this.stickX,
      stickY: this.stickY,
      steerYaw: this.snapshot.steerYaw,
      steerPitch: this.snapshot.steerPitch,
      warpSpikesFiltered: this.warpSpikesFiltered,
    };
  }

  /**
   * Advances the self-centering virtual stick by `dt` seconds, consumes pending
   * relative mouse deltas, blends optional keyboard steering, and returns the
   * current frame's normalized `InputSnapshot`.
   */
  public consumeSnapshot(
    dt = 1 / 60,
    params: VirtualStickParams = DEFAULT_STICK_PARAMS,
  ): InputSnapshot {
    const lockOwned = this.isLockOwned();
    this.pointerLocked = lockOwned;

    const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 1 / 60;
    const rawDeltaX = lockOwned ? this.mouseDeltaX : 0;
    const rawDeltaY = lockOwned ? this.mouseDeltaY : 0;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;

    const mouseSens = clamp(
      params.mouseSensitivity,
      STEERING_BOUNDS.mouseSensitivity.min,
      STEERING_BOUNDS.mouseSensitivity.max,
    );
    const recentreRate = clamp(
      params.stickSelfCenterRate ?? STEERING_CONFIG.stickSelfCenterRate,
      STEERING_BOUNDS.stickSelfCenterRate.min,
      STEERING_BOUNDS.stickSelfCenterRate.max,
    );
    const maxDeflection = clamp(
      params.maxStickDeflection ?? STEERING_CONFIG.maxStickDeflection,
      STEERING_BOUNDS.maxStickDeflection.min,
      STEERING_BOUNDS.maxStickDeflection.max,
    );
    const deadzone = clamp(
      params.deadzone,
      STEERING_BOUNDS.deadzone.min,
      STEERING_BOUNDS.deadzone.max,
    );

    const halfDecay = Math.exp(-recentreRate * safeDt * 0.5);
    const effectiveSensitivity = STEERING_CONFIG.baseMouseSensitivity * mouseSens;

    if (lockOwned) {
      this.stickX = clamp(
        this.stickX + rawDeltaX * effectiveSensitivity,
        -maxDeflection,
        maxDeflection,
      );
      this.stickY = clamp(
        this.stickY + rawDeltaY * effectiveSensitivity,
        -maxDeflection,
        maxDeflection,
      );
    } else {
      // Decay cleanly back to center if Pointer Lock is not held
      const fullDecay = halfDecay * halfDecay;
      this.stickX *= fullDecay;
      this.stickY *= fullDecay;
    }

    // Eliminate sub-epsilon floating-point residual when centered
    if (Math.abs(this.stickX) < 1e-5) this.stickX = 0;
    if (Math.abs(this.stickY) < 1e-5) this.stickY = 0;

    // Linear radial deadzone (identity mapping when deadzone === 0; zero stacked nonlinear curves)
    let outStickX = this.stickX;
    let outStickY = this.stickY;
    const radialDist = Math.hypot(this.stickX, this.stickY);
    const normMag = maxDeflection > 1e-5 ? clamp(radialDist / maxDeflection, 0, 1) : 0;
    const deadzoneThreshold = deadzone * maxDeflection;

    let zone: SteeringZone = 'active';
    if (radialDist <= 1e-5 || (deadzoneThreshold > 0 && radialDist <= deadzoneThreshold)) {
      outStickX = 0;
      outStickY = 0;
      zone = 'deadzone';
    } else {
      if (deadzoneThreshold > 0) {
        const rescaledMag =
          ((radialDist - deadzoneThreshold) / Math.max(1e-5, maxDeflection - deadzoneThreshold)) *
          maxDeflection;
        const scale = Math.min(maxDeflection, rescaledMag) / radialDist;
        outStickX = this.stickX * scale;
        outStickY = this.stickY * scale;
      }
      const axisMax = Math.max(Math.abs(this.stickX), Math.abs(this.stickY));
      zone = axisMax >= maxDeflection * 0.98 ? 'max' : 'active';
    }

    const keyPitchUp = this.keys.has('ArrowDown');
    const keyPitchDown = this.keys.has('ArrowUp');
    const keyYawLeft = this.keys.has('ArrowLeft');
    const keyYawRight = this.keys.has('ArrowRight');

    const keyPitch = (keyPitchUp ? 1 : 0) - (keyPitchDown ? 1 : 0);
    const keyYaw = (keyYawRight ? 1 : 0) - (keyYawLeft ? 1 : 0);

    // Compute snapshot.steerYaw and snapshot.steerPitch directly from rawDeltaX / rawDeltaY
    // (never derived solely from clamped stickX / stickY so boundary clamping cannot stall steering)
    const normSpeedRange = Math.max(100, STEERING_CONFIG.inputNormalizationRange);
    const velDt = Math.max(safeDt, 1 / 240);
    const instYawDemand = ((rawDeltaX / velDt) * mouseSens) / normSpeedRange;
    const instPitchDemand = (((params.invertY ? rawDeltaY : -rawDeltaY) / velDt) * mouseSens) / normSpeedRange;

    this.snapshot.forward = this.keys.has('KeyW');
    this.snapshot.backward = this.keys.has('KeyS');
    this.snapshot.rollLeft = this.keys.has('KeyA');
    this.snapshot.rollRight = this.keys.has('KeyD');
    this.snapshot.boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.snapshot.firePrimary = this.mouseFireHeld || this.keys.has('Space');
    this.snapshot.keyPitchUp = keyPitchUp;
    this.snapshot.keyPitchDown = keyPitchDown;
    this.snapshot.keyYawLeft = keyYawLeft;
    this.snapshot.keyYawRight = keyYawRight;
    this.snapshot.mouseDeltaX = rawDeltaX;
    this.snapshot.mouseDeltaY = rawDeltaY;
    this.snapshot.stickX = this.stickX;
    this.snapshot.stickY = this.stickY;
    this.snapshot.stickMagnitude = normMag;
    this.snapshot.steerYaw = clamp(
      (rawDeltaX !== 0 ? instYawDemand : outStickX) + keyYaw,
      -maxDeflection,
      maxDeflection,
    );
    this.snapshot.steerPitch = clamp(
      (rawDeltaY !== 0 ? instPitchDemand : params.invertY ? outStickY : -outStickY) + keyPitch,
      -maxDeflection,
      maxDeflection,
    );
    this.snapshot.steeringZone = zone;
    this.snapshot.pointerLocked = lockOwned;

    return this.snapshot;
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') {
      if (this.active) {
        e.preventDefault();
        this.exitPointerLock();
        if (this.active) {
          this.callbacks.onPauseRequested?.();
        }
      }
      return;
    }

    if (e.code === 'KeyH' && this.active && !e.repeat) {
      this.callbacks.onToggleHudHints?.();
      return;
    }

    if (import.meta.env.DEV && e.code === 'F3' && !e.repeat) {
      e.preventDefault();
      this.callbacks.onTogglePerfMonitor?.();
      return;
    }

    if (!this.active) return;

    if (
      e.code === 'KeyW' ||
      e.code === 'KeyS' ||
      e.code === 'KeyA' ||
      e.code === 'KeyD' ||
      e.code === 'ShiftLeft' ||
      e.code === 'ShiftRight' ||
      e.code === 'Space' ||
      e.code === 'ArrowUp' ||
      e.code === 'ArrowDown' ||
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight'
    ) {
      if (e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.active || !this.isLockOwned()) return;

    const rawX = Number.isFinite(e.movementX) ? e.movementX : 0;
    const rawY = Number.isFinite(e.movementY) ? e.movementY : 0;
    this.lastRawMovementX = rawX;
    this.lastRawMovementY = rawY;

    // Guard solely against extreme synthetic OS pointer-warp glitches (> 500px in one event)
    if (Math.abs(rawX) > 500 || Math.abs(rawY) > 500) {
      this.warpSpikesFiltered += 1;
      return;
    }

    this.mouseDeltaX += rawX;
    this.mouseDeltaY += rawY;
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (!this.active || e.button !== 0) return;

    if (this.isLockOwned()) {
      this.mouseFireHeld = true;
      return;
    }

    // Single owner of canvas clicks: engage Pointer Lock synchronously without firing a stray burst
    if (e.target === this.lockTarget) {
      this.requestPointerLock();
    }
  };

  private handleMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.mouseFireHeld = false;
    }
  };

  private handleBlur = (): void => {
    this.keys.clear();
    this.mouseFireHeld = false;
    this.resetVirtualStick();
  };

  private handlePointerLockChange = (): void => {
    const wasLocked = this.pointerLocked;
    const lockOwned = this.isLockOwned();
    this.pointerLocked = lockOwned;
    this.mouseFireHeld = false;
    this.resetVirtualStick();
    this.callbacks.onPointerLockChanged?.(lockOwned);

    if (wasLocked && !lockOwned && this.active) {
      this.callbacks.onPauseRequested?.();
    }
  };

  private handlePointerLockError = (): void => {
    const lockOwned = this.isLockOwned();
    this.pointerLocked = lockOwned;
    this.callbacks.onPointerLockChanged?.(lockOwned);
  };
}
