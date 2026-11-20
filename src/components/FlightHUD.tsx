import { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CheckCircle2, ChevronDown, ChevronUp, Circle, Pause } from 'lucide-react';
import { TECH_EASE } from './ui/ObsidianUI';
import { SHIP_CONFIGS } from '../config/ships';
import { STEERING_CONFIG } from '../config/steering';
import { computeRoundedRectBoundary, createRoundedRectBoundary } from '../engine/AimBoundary';
import { MAX_ENEMIES } from '../engine/combat/CombatManager';
import type { FlightTelemetry, GameSettings, ShipId } from '../types/game';
import type { MissionHudSnapshot } from '../types/mission';

interface FlightHUDProps {
  shipId: ShipId;
  telemetryRef: React.MutableRefObject<FlightTelemetry>;
  missionHud: MissionHudSnapshot | null;
  settings: GameSettings;
  pointerLocked: boolean;
  playerDestroyed: boolean;
  hintsVisible: boolean;
  onToggleHints: () => void;
  onRequestLock: () => void;
  onPause: () => void;
}

const MARKER_INDICES = Array.from({ length: MAX_ENEMIES }, (_, i) => i);

/**
 * Minimal, razor-sharp futuristic flight & combat HUD.
 * High-frequency telemetry (60 FPS velocity, boost, reticle, 3D enemy brackets, lead pip)
 * updates purely through DOM refs inside requestAnimationFrame with ZERO React re-renders.
 * Discrete mission objective & announcement updates flow via `missionHud`.
 */
export function FlightHUD({
  shipId,
  telemetryRef,
  missionHud,
  settings,
  pointerLocked,
  playerDestroyed,
  hintsVisible,
  onToggleHints,
  onRequestLock,
  onPause,
}: FlightHUDProps) {
  const ship = SHIP_CONFIGS[shipId];
  const reducedMotion = useReducedMotion();

  // Core flight refs
  const speedNumRef = useRef<HTMLSpanElement>(null);
  const speedBarRef = useRef<HTMLDivElement>(null);
  const statusTextRef = useRef<HTMLSpanElement>(null);
  const headingRef = useRef<HTMLSpanElement>(null);
  const pitchRef = useRef<HTMLSpanElement>(null);
  const rollRef = useRef<HTMLSpanElement>(null);
  const hullNumRef = useRef<HTMLSpanElement>(null);
  const hullBarRef = useRef<HTMLDivElement>(null);
  const shieldNumRef = useRef<HTMLSpanElement>(null);
  const shieldBarRef = useRef<HTMLDivElement>(null);
  const shieldStatusRef = useRef<HTMLSpanElement>(null);
  const boostNumRef = useRef<HTMLSpanElement>(null);
  const boostBarRef = useRef<HTMLDivElement>(null);
  const boostLabelRef = useRef<HTMLSpanElement>(null);
  const perfLine1Ref = useRef<HTMLDivElement>(null);
  const perfLine2Ref = useRef<HTMLDivElement>(null);

  const hudRootRef = useRef<HTMLDivElement>(null);
  const viewportSizeRef = useRef({ width: 1280, height: 720 });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Combat & aiming refs
  const aimReticleRef = useRef<HTMLDivElement>(null);
  const aimBoundarySvgRef = useRef<SVGSVGElement>(null);
  const cornerPathRefs = useRef<Array<SVGPathElement | null>>([null, null, null, null]);
  const deadzoneRectRef = useRef<SVGRectElement>(null);
  const lastBoundaryKeyRef = useRef('');
  const boundaryScratchRef = useRef(createRoundedRectBoundary());
  const steerLineRef = useRef<SVGLineElement>(null);
  const virtualMouseRef = useRef<HTMLDivElement>(null);
  const virtualMouseArrowRef = useRef<SVGPathElement>(null);
  const hitMarkerRef = useRef<HTMLDivElement>(null);
  const killMarkerRef = useRef<HTMLDivElement>(null);
  const damageVignetteRef = useRef<HTMLDivElement>(null);
  const weaponStatusRef = useRef<HTMLSpanElement>(null);
  const combatHostilesRef = useRef<HTMLSpanElement>(null);
  const combatKillsRef = useRef<HTMLSpanElement>(null);
  const combatAccRef = useRef<HTMLSpanElement>(null);
  const lockPanelRef = useRef<HTMLDivElement>(null);
  const lockNameRef = useRef<HTMLSpanElement>(null);
  const lockStateRef = useRef<HTMLDivElement>(null);
  const lockBarRef = useRef<HTMLDivElement>(null);
  const missileAmmoRef = useRef<HTMLSpanElement>(null);
  const missileWarningRef = useRef<HTMLDivElement>(null);
  const missileDirectionRef = useRef<HTMLDivElement>(null);

  // Primary target summary card refs
  const targetCardRef = useRef<HTMLDivElement>(null);
  const targetNameRef = useRef<HTMLSpanElement>(null);
  const targetRoleRef = useRef<HTMLDivElement>(null);
  const targetDistRef = useRef<HTMLSpanElement>(null);
  const targetHealthBarRef = useRef<HTMLDivElement>(null);
  const leadPipRef = useRef<HTMLDivElement>(null);

  // Pooled 3D enemy bracket refs
  const enemyMarkerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const enemyMarkerLabelRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const enemyMarkerDistRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const enemyMarkerBarRefs = useRef<Array<HTMLDivElement | null>>([]);
  const enemyMarkerBoxRefs = useRef<Array<HTMLDivElement | null>>([]);

  // Track exact game viewport dimensions (reacts immediately to browser/container resize)
  useEffect(() => {
    const root = hudRootRef.current;
    const syncViewportSize = () => {
      if (root) {
        const rect = root.getBoundingClientRect();
        viewportSizeRef.current.width = Math.max(1, rect.width);
        viewportSizeRef.current.height = Math.max(1, rect.height);
      } else {
        viewportSizeRef.current.width = Math.max(1, window.innerWidth);
        viewportSizeRef.current.height = Math.max(1, window.innerHeight);
      }
    };

    syncViewportSize();
    const ro = typeof ResizeObserver !== 'undefined' && root ? new ResizeObserver(syncViewportSize) : null;
    if (ro && root) ro.observe(root);
    window.addEventListener('resize', syncViewportSize);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', syncViewportSize);
    };
  }, []);

  useEffect(() => {
    let rafId = 0;

    const syncHud = () => {
      const t = telemetryRef.current;
      const vw = viewportSizeRef.current.width;
      const vh = viewportSizeRef.current.height;
      const s = settingsRef.current;

      // 1. Speed, Attitude & Boost
      if (speedNumRef.current) {
        const displaySpeed = Math.round(t.signedSpeed);
        speedNumRef.current.textContent = String(displaySpeed);
        speedNumRef.current.style.color = t.isBoosting
          ? '#67e8f9'
          : t.signedSpeed < -2
            ? '#fbbf24'
            : '#f8fafc';
      }

      if (speedBarRef.current) {
        const maxBoosted = t.maxSpeed * ship.flight.boostMultiplier;
        const pct = Math.min(100, (t.speed / Math.max(maxBoosted, 1)) * 100);
        speedBarRef.current.style.transform = `scaleX(${pct / 100})`;
        speedBarRef.current.style.backgroundColor = t.isBoosting ? '#67e8f9' : '#06b6d4';
      }

      if (statusTextRef.current) {
        statusTextRef.current.textContent = t.status;
        statusTextRef.current.style.color =
          t.status === 'BOOSTING'
            ? '#67e8f9'
            : t.status === 'BOOST DEPLETED'
              ? '#f59e0b'
              : t.status === 'REVERSING'
                ? '#fbbf24'
                : '#94a3b8';
      }

      if (headingRef.current) {
        headingRef.current.textContent = `${String(Math.round(t.headingDeg)).padStart(3, '0')}°`;
      }
      if (pitchRef.current) {
        const p = Math.round(t.pitchDeg);
        pitchRef.current.textContent = `${p >= 0 ? '+' : ''}${p}°`;
      }
      if (rollRef.current) {
        const r = Math.round(t.rollDeg);
        rollRef.current.textContent = `${r >= 0 ? '+' : ''}${r}°`;
      }

      // 2. Player Hull Integrity & Weapon State
      const hullRatio = Math.max(0, Math.min(1, t.hull / Math.max(t.maxHull, 1)));
      if (hullNumRef.current) {
        hullNumRef.current.textContent = `${Math.ceil(t.hull)} / ${Math.ceil(t.maxHull)}`;
        hullNumRef.current.style.color =
          hullRatio <= 0.3 ? '#f87171' : hullRatio <= 0.55 ? '#fbbf24' : '#f1f5f9';
      }
      if (hullBarRef.current) {
        hullBarRef.current.style.transform = `scaleX(${hullRatio})`;
        hullBarRef.current.style.backgroundColor =
          hullRatio <= 0.3 ? '#ef4444' : hullRatio <= 0.55 ? '#f59e0b' : '#38bdf8';
      }
      const shieldRatio = Math.max(0, Math.min(1, t.shield / Math.max(t.maxShield, 1)));
      if (shieldNumRef.current) {
        shieldNumRef.current.textContent = `${Math.ceil(t.shield)} / ${Math.ceil(t.maxShield)}`;
        shieldNumRef.current.style.color = t.shieldBroken ? '#fb7185' : shieldRatio <= 0.3 ? '#fbbf24' : '#a5f3fc';
      }
      if (shieldBarRef.current) {
        shieldBarRef.current.style.transform = `scaleX(${shieldRatio})`;
        shieldBarRef.current.style.backgroundColor = t.shieldBroken ? '#fb7185' : shieldRatio <= 0.3 ? '#f59e0b' : '#22d3ee';
      }
      if (shieldStatusRef.current) {
        shieldStatusRef.current.textContent = t.shieldBroken ? 'BREAK' : t.shieldRecharging ? 'CHG' : '';
        shieldStatusRef.current.style.color = t.shieldBroken ? '#fb7185' : '#67e8f9';
      }

      if (weaponStatusRef.current) {
        weaponStatusRef.current.textContent = t.isFiring ? 'FIRING' : 'READY';
        weaponStatusRef.current.style.color = t.isFiring ? '#67e8f9' : '#94a3b8';
      }
      const mh = t.missileHud;
      if (lockPanelRef.current) lockPanelRef.current.style.opacity = mh.lockTargetName ? '1' : mh.lockEscaped ? '1' : '0.55';
      if (lockNameRef.current) lockNameRef.current.textContent = mh.lockTargetName || (mh.lockEscaped ? 'TARGET ESCAPED' : 'NO TARGET');
      if (lockStateRef.current) {
        lockStateRef.current.textContent = mh.lockReady ? 'LOCK READY · PRESS M' : mh.lockEscaped ? 'LOCK LOST' : mh.lockTargetName ? 'ACQUIRING' : 'SEEKING TARGET';
        lockStateRef.current.style.color = mh.lockReady ? '#86efac' : mh.lockEscaped ? '#fb7185' : '#67e8f9';
      }
      if (lockBarRef.current) {
        lockBarRef.current.style.transform = `scaleX(${mh.lockProgress.toFixed(3)})`;
        lockBarRef.current.style.backgroundColor = mh.lockReady ? '#4ade80' : '#22d3ee';
      }
      if (missileAmmoRef.current) missileAmmoRef.current.textContent = `${mh.missilesRemaining} · M`;
      if (missileWarningRef.current) missileWarningRef.current.style.opacity = mh.incomingMissile ? '1' : '0';
      if (missileDirectionRef.current) {
        missileDirectionRef.current.style.opacity = mh.incomingMissile ? '1' : '0';
        missileDirectionRef.current.style.transform = `translate3d(${(mh.incomingX * vw).toFixed(1)}px, ${(mh.incomingY * vh).toFixed(1)}px, 0) translate(-50%, -50%)`;
      }

      // 3. Boost Energy
      if (boostNumRef.current) {
        boostNumRef.current.textContent = `${Math.round(t.boostEnergy)}%`;
      }
      if (boostBarRef.current) {
        const bRatio = Math.max(0, Math.min(1, t.boostEnergy / Math.max(t.maxBoostEnergy, 1)));
        boostBarRef.current.style.transform = `scaleX(${bRatio})`;
        boostBarRef.current.style.backgroundColor = t.boostDepleted
          ? '#f59e0b'
          : t.isBoosting
            ? '#a5f3fc'
            : '#22d3ee';
      }
      if (boostLabelRef.current) {
        boostLabelRef.current.textContent = t.boostDepleted
          ? 'Recharging'
          : t.isBoosting
            ? 'Afterburner Active'
            : 'Boost Energy';
      }

      // 4. Actual cannon aim point projected through the camera, independent of V and the boundary.
      const aimPxX = t.aimScreenX * vw;
      const aimPxY = t.aimScreenY * vh;
      const cx = vw * 0.5;
      const cy = vh * 0.5;

      if (aimReticleRef.current) {
        const reticleScale =
          t.steeringZone === 'max'
            ? 1.08
            : t.steeringZone === 'deadzone'
              ? 0.94
              : 1.0;
        aimReticleRef.current.style.transform = `translate3d(${aimPxX.toFixed(1)}px, ${aimPxY.toFixed(1)}px, 0) translate(-50%, -50%) scale(${reticleScale.toFixed(3)})`;
        aimReticleRef.current.dataset.steeringZone = t.steeringZone;
        aimReticleRef.current.dataset.radial = t.joystickRadialMagnitude.toFixed(4);
        aimReticleRef.current.dataset.steerX = t.steeringOutputX.toFixed(4);
        aimReticleRef.current.dataset.steerY = t.steeringOutputY.toFixed(4);
        aimReticleRef.current.dataset.screenX = t.aimScreenX.toFixed(4);
        aimReticleRef.current.dataset.screenY = t.aimScreenY.toFixed(4);
        aimReticleRef.current.style.color =
          t.steeringZone === 'max'
            ? '#e0f2fe'
            : t.steeringZone === 'deadzone'
              ? 'rgba(148, 163, 184, 0.85)'
              : 'rgba(165, 243, 252, 0.95)';
      }

      // Subtle sci-fi rounded-rectangle corner markings (30% x 35% base viewport geometry scaled by joystickRadius)
      if (aimBoundarySvgRef.current) {
        const b = computeRoundedRectBoundary(
          vw,
          vh,
          s.joystickRadius,
          STEERING_CONFIG.aimBoundaryWidth,
          STEERING_CONFIG.aimBoundaryHeight,
          STEERING_CONFIG.aimBoundaryCornerRadius,
          boundaryScratchRef.current,
        );
        const key = `${vw.toFixed(1)}:${vh.toFixed(1)}:${b.widthPx.toFixed(1)}:${b.heightPx.toFixed(1)}:${b.cornerRadiusPx.toFixed(1)}:${s.deadzone.toFixed(3)}`;
        if (key !== lastBoundaryKeyRef.current) {
          lastBoundaryKeyRef.current = key;
          const x0 = cx - b.halfW;
          const x1 = cx + b.halfW;
          const y0 = cy - b.halfH;
          const y1 = cy + b.halfH;
          const r = b.cornerRadiusPx;
          const arm = Math.max(8, Math.min(18, Math.min(b.innerHalfW, b.innerHalfH) * 0.24));

          const paths = [
            // Top-left rounded corner bracket
            `M ${x0.toFixed(1)} ${(y0 + r + arm).toFixed(1)} L ${x0.toFixed(1)} ${(y0 + r).toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${(x0 + r).toFixed(1)} ${y0.toFixed(1)} L ${(x0 + r + arm).toFixed(1)} ${y0.toFixed(1)}`,
            // Top-right rounded corner bracket
            `M ${(x1 - r - arm).toFixed(1)} ${y0.toFixed(1)} L ${(x1 - r).toFixed(1)} ${y0.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x1.toFixed(1)} ${(y0 + r).toFixed(1)} L ${x1.toFixed(1)} ${(y0 + r + arm).toFixed(1)}`,
            // Bottom-right rounded corner bracket
            `M ${x1.toFixed(1)} ${(y1 - r - arm).toFixed(1)} L ${x1.toFixed(1)} ${(y1 - r).toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${(x1 - r).toFixed(1)} ${y1.toFixed(1)} L ${(x1 - r - arm).toFixed(1)} ${y1.toFixed(1)}`,
            // Bottom-left rounded corner bracket
            `M ${(x0 + r + arm).toFixed(1)} ${y1.toFixed(1)} L ${(x0 + r).toFixed(1)} ${y1.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x0.toFixed(1)} ${(y1 - r).toFixed(1)} L ${x0.toFixed(1)} ${(y1 - r - arm).toFixed(1)}`,
          ];

          for (let i = 0; i < 4; i++) {
            cornerPathRefs.current[i]?.setAttribute('d', paths[i]);
          }

          if (deadzoneRectRef.current) {
            if (STEERING_CONFIG.steeringMode === 'virtual-joystick-baseline' && s.deadzone > 0.005) {
              const dzW = b.widthPx * s.deadzone;
              const dzH = b.heightPx * s.deadzone;
              const dzR = b.cornerRadiusPx * s.deadzone;
              deadzoneRectRef.current.setAttribute('x', (cx - dzW * 0.5).toFixed(1));
              deadzoneRectRef.current.setAttribute('y', (cy - dzH * 0.5).toFixed(1));
              deadzoneRectRef.current.setAttribute('width', dzW.toFixed(1));
              deadzoneRectRef.current.setAttribute('height', dzH.toFixed(1));
              deadzoneRectRef.current.setAttribute('rx', dzR.toFixed(1));
              deadzoneRectRef.current.setAttribute('ry', dzR.toFixed(1));
              deadzoneRectRef.current.style.visibility = 'visible';
            } else {
              deadzoneRectRef.current.style.visibility = 'hidden';
            }
          }

          aimBoundarySvgRef.current.dataset.shape = 'rounded-rect';
          aimBoundarySvgRef.current.dataset.viewportWidth = vw.toFixed(1);
          aimBoundarySvgRef.current.dataset.viewportHeight = vh.toFixed(1);
          aimBoundarySvgRef.current.dataset.widthPx = b.widthPx.toFixed(2);
          aimBoundarySvgRef.current.dataset.heightPx = b.heightPx.toFixed(2);
          aimBoundarySvgRef.current.dataset.cornerRadiusPx = b.cornerRadiusPx.toFixed(2);
          aimBoundarySvgRef.current.dataset.widthFraction = b.widthFraction.toFixed(4);
          aimBoundarySvgRef.current.dataset.heightFraction = b.heightFraction.toFixed(4);
          aimBoundarySvgRef.current.dataset.joystickRadius = s.joystickRadius.toFixed(3);
          aimBoundarySvgRef.current.dataset.deadzone = s.deadzone.toFixed(3);
        }

        const rMag = t.joystickRadialMagnitude;
        const edgeOp =
          t.steeringZone === 'max'
            ? 0.42
            : t.steeringZone === 'active'
              ? 0.12 + rMag * 0.24
              : 0.1;
        aimBoundarySvgRef.current.style.opacity = edgeOp.toFixed(2);
        aimBoundarySvgRef.current.style.color =
          t.steeringZone === 'max'
            ? 'rgba(186, 230, 253, 0.95)'
            : 'rgba(103, 232, 249, 0.78)';
      }

      // Virtual Mouse Indicator: unconstrained V. Display-only edge clamp keeps it visible when
      // V lies beyond the viewport; the tether then points at the clamped marker.
      const vmRawX = t.virtualMouseScreenX * vw;
      const vmRawY = t.virtualMouseScreenY * vh;
      const edge = 14;
      const vx = vmRawX - cx, vy = vmRawY - cy;
      const edgeScale = Math.min(1, (cx - edge) / Math.max(Math.abs(vx), 1e-9), (cy - edge) / Math.max(Math.abs(vy), 1e-9));
      const vmPxX = cx + vx * edgeScale;
      const vmPxY = cy + vy * edgeScale;
      const vmOffscreen = edgeScale < 1;
      if (virtualMouseRef.current) {
        virtualMouseRef.current.style.transform = `translate3d(${vmPxX.toFixed(1)}px, ${vmPxY.toFixed(1)}px, 0) translate(-50%, -50%)`;
        virtualMouseRef.current.dataset.screenX = t.virtualMouseScreenX.toFixed(4);
        virtualMouseRef.current.dataset.screenY = t.virtualMouseScreenY.toFixed(4);
        virtualMouseRef.current.dataset.offscreen = vmOffscreen ? '1' : '0';
        virtualMouseRef.current.style.opacity = vmOffscreen ? '0.6' : '0.95';
      }
      if (virtualMouseArrowRef.current) {
        const arrowAngle = Math.atan2(vmRawY - cy, vmRawX - cx) * (180 / Math.PI) + 90;
        virtualMouseArrowRef.current.style.display = vmOffscreen ? 'block' : 'none';
        virtualMouseArrowRef.current.setAttribute('transform', `rotate(${arrowAngle.toFixed(1)} 9 9)`);
      }

      // Alignment tether (aim reticle -> virtual mouse indicator), faded when they are close
      if (steerLineRef.current) {
        const dx = vmPxX - aimPxX;
        const dy = vmPxY - aimPxY;
        const distPx = Math.hypot(dx, dy);
        const fade = Math.min(1, Math.max(0, (distPx - 14) / 30));
        if (fade > 0.001) {
          const ux = dx / distPx;
          const uy = dy / distPx;
          steerLineRef.current.setAttribute('x1', (aimPxX + ux * 16).toFixed(1));
          steerLineRef.current.setAttribute('y1', (aimPxY + uy * 16).toFixed(1));
          steerLineRef.current.setAttribute('x2', (vmPxX - ux * 9).toFixed(1));
          steerLineRef.current.setAttribute('y2', (vmPxY - uy * 9).toFixed(1));
          steerLineRef.current.style.opacity = (fade * 0.5).toFixed(2);
          steerLineRef.current.dataset.alignmentErrorPx = t.alignmentErrorPx.toFixed(1);
          steerLineRef.current.dataset.clipped = vmOffscreen ? '1' : '0';
        } else {
          steerLineRef.current.style.opacity = '0';
          steerLineRef.current.dataset.alignmentErrorPx = t.alignmentErrorPx.toFixed(1);
          steerLineRef.current.dataset.clipped = '0';
        }
      }

      // 5. Hit Confirmation & Kill Confirmation Crosshairs + Damage Vignette
      if (hitMarkerRef.current) {
        const hitOp = Math.min(1, t.hitMarkerTimer / 0.14);
        hitMarkerRef.current.style.opacity = hitOp.toFixed(2);
      }
      if (killMarkerRef.current) {
        const killOp = Math.min(1, t.killMarkerTimer / 0.28);
        killMarkerRef.current.style.opacity = killOp.toFixed(2);
      }
      if (damageVignetteRef.current) {
        const dmgOp = Math.min(0.72, (t.damageFlashTimer / 0.32) * 0.72);
        damageVignetteRef.current.style.opacity = dmgOp.toFixed(2);
      }

      // 6. Combat Statistics Readout
      const stats = t.combatStats;
      if (combatHostilesRef.current) combatHostilesRef.current.textContent = String(stats.activeEnemies);
      if (combatKillsRef.current) combatKillsRef.current.textContent = String(stats.kills);
      if (combatAccRef.current) {
        const acc =
          stats.shotsFired > 0 ? Math.round((stats.shotsHit / stats.shotsFired) * 100) : 0;
        combatAccRef.current.textContent = `${acc}%`;
      }

      // 7. Projected 3D Enemy Brackets, Priority Boss Highlight, Off-Screen Edge Indicators & Lead Pip
      let primaryMarker = null;
      const markers = t.enemyMarkers;

      for (let i = 0; i < MARKER_INDICES.length; i++) {
        const el = enemyMarkerRefs.current[i];
        const m = markers[i];
        if (!el) continue;

        if (!m || !m.active) {
          el.style.opacity = '0';
          el.style.visibility = 'hidden';
          continue;
        }

        if (m.isPrimaryTarget) {
          primaryMarker = m;
        }

        const mx = m.screenX * vw;
        const my = m.screenY * vh;
        el.style.visibility = 'visible';
        el.style.opacity = m.onScreen ? '1' : '0.8';
        el.style.transform = `translate3d(${mx.toFixed(1)}px, ${my.toFixed(1)}px, 0) translate(-50%, -50%)`;

        const box = enemyMarkerBoxRefs.current[i];
        if (box) {
          if (m.onScreen) {
            box.style.borderColor = m.isPriorityTarget
              ? 'rgba(251, 191, 36, 0.98)'
              : m.isPrimaryTarget
                ? 'rgba(249, 115, 22, 0.95)'
                : 'rgba(251, 146, 60, 0.65)';
            box.style.width = m.isPriorityTarget ? '44px' : m.isPrimaryTarget ? '38px' : '28px';
            box.style.height = m.isPriorityTarget ? '44px' : m.isPrimaryTarget ? '38px' : '28px';
            box.style.transform =
              m.isPrimaryTarget || m.isPriorityTarget ? 'rotate(45deg)' : 'rotate(0deg)';
          } else {
            box.style.borderColor = m.isPriorityTarget
              ? 'rgba(251, 191, 36, 0.95)'
              : 'rgba(248, 113, 113, 0.85)';
            box.style.width = '14px';
            box.style.height = '14px';
            box.style.transform = 'rotate(45deg)';
          }
        }

        const lbl = enemyMarkerLabelRefs.current[i];
        if (lbl) {
          lbl.textContent = m.onScreen
            ? m.isPriorityTarget
              ? `★ ${m.callsign}`
              : m.callsign
            : '';
          lbl.style.color = m.isPriorityTarget ? '#fcd34d' : '#fdba74';
        }
        const dst = enemyMarkerDistRefs.current[i];
        if (dst) {
          dst.textContent = `${Math.round(m.distance)}m`;
        }
        const bar = enemyMarkerBarRefs.current[i];
        if (bar) {
          bar.style.transform = `scaleX(${Math.max(0, Math.min(1, m.healthRatio)).toFixed(3)})`;
          bar.style.backgroundColor = m.isPriorityTarget ? '#fbbf24' : '#fb923c';
        }
      }

      // Primary Target Info Panel + Predictive Lead Pip
      if (targetCardRef.current) {
        if (primaryMarker) {
          targetCardRef.current.style.opacity = '1';
          if (targetNameRef.current) {
            targetNameRef.current.textContent = primaryMarker.isPriorityTarget
              ? `★ ${primaryMarker.callsign}`
              : primaryMarker.callsign;
          }
          if (targetRoleRef.current) {
            targetRoleRef.current.textContent = `${primaryMarker.personalityLabel} · ${primaryMarker.aiState.toUpperCase()}`;
          }
          if (targetDistRef.current) {
            targetDistRef.current.textContent = `${Math.round(primaryMarker.distance)} m`;
          }
          if (targetHealthBarRef.current) {
            targetHealthBarRef.current.style.transform = `scaleX(${primaryMarker.healthRatio.toFixed(3)})`;
          }
        } else {
          targetCardRef.current.style.opacity = '0';
        }
      }

      if (leadPipRef.current) {
        if (primaryMarker && primaryMarker.leadVisible && primaryMarker.onScreen) {
          const lx = primaryMarker.leadX * vw;
          const ly = primaryMarker.leadY * vh;
          leadPipRef.current.style.visibility = 'visible';
          leadPipRef.current.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0) translate(-50%, -50%)`;
        } else {
          leadPipRef.current.style.visibility = 'hidden';
        }
      }

      // 8. Development-only Performance Monitor (zero execution in production)
      if (import.meta.env.DEV && perfLine1Ref.current && perfLine2Ref.current) {
        perfLine1Ref.current.textContent = `${t.fps} FPS · ${t.frameTimeMs.toFixed(1)} ms · ${t.drawCalls} draws · ${(t.triangles / 1000).toFixed(1)}k tris`;
        perfLine2Ref.current.textContent = `E:${t.activeEnemies} · P:${t.activeProjectiles} · VFX:${t.activeParticles} · Assets:${t.cachedAssetCount} (${t.lastAssetLoadMs.toFixed(0)}ms)`;
      }

      rafId = window.requestAnimationFrame(syncHud);
    };

    rafId = window.requestAnimationFrame(syncHud);
    return () => window.cancelAnimationFrame(rafId);
  }, [ship.flight.boostMultiplier, telemetryRef]);

  return (
    <div
      ref={hudRootRef}
      className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-5 sm:p-6"
    >
      {/* Peripheral Damage Vignette Flash */}
      <div
        ref={damageVignetteRef}
        className="pointer-events-none fixed inset-0 z-10 opacity-0"
        style={{
          boxShadow: 'inset 0 0 110px 24px rgba(239, 68, 68, 0.72)',
          willChange: 'opacity',
        }}
        aria-hidden="true"
      />

      {/* Incoming Missile Alert & Directional Indicator */}
      <div
        ref={missileWarningRef}
        className="obsidian-hud pointer-events-none fixed left-1/2 top-16 z-30 -translate-x-1/2 border border-rose-500/80 px-4 py-1.5 font-mono text-[11px] font-bold tracking-[0.24em] text-rose-200 shadow-[0_0_24px_rgba(244,63,94,0.42)]"
        style={{ opacity: 0, transition: 'opacity 120ms ease' }}
      >
        MISSILE INBOUND
      </div>
      <div
        ref={missileDirectionRef}
        className="pointer-events-none fixed left-0 top-0 text-rose-400"
        style={{ opacity: 0, willChange: 'transform,opacity' }}
        aria-label="Incoming missile direction"
      >
        <svg width="30" height="30" viewBox="0 0 30 30">
          <path d="M15 2 L27 26 L15 21 L3 26 Z" fill="rgba(244,63,94,.2)" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      </div>

      {/* Pooled 3D Enemy Target Brackets & Health Bars */}
      {MARKER_INDICES.map((idx) => (
        <div
          key={idx}
          ref={(el) => {
            enemyMarkerRefs.current[idx] = el;
          }}
          className="pointer-events-none fixed left-0 top-0 flex flex-col items-center"
          style={{ visibility: 'hidden', willChange: 'transform, opacity' }}
        >
          <span
            ref={(el) => {
              enemyMarkerLabelRefs.current[idx] = el;
            }}
            className="mb-1 font-mono text-[10px] font-semibold tracking-wider text-orange-300"
          />
          <div
            ref={(el) => {
              enemyMarkerBoxRefs.current[idx] = el;
            }}
            className="border border-orange-400/80 transition-[width,height] duration-100"
            style={{ width: 28, height: 28 }}
          />
          <div className="mt-1.5 h-1 w-9 overflow-hidden bg-slate-900/90">
            <div
              ref={(el) => {
                enemyMarkerBarRefs.current[idx] = el;
              }}
              className="h-full w-full origin-left bg-orange-400"
              style={{ transform: 'scaleX(1)', willChange: 'transform' }}
            />
          </div>
          <span
            ref={(el) => {
              enemyMarkerDistRefs.current[idx] = el;
            }}
            className="mt-0.5 font-mono text-[10px] tabular-nums text-slate-300"
          />
        </div>
      ))}

      {/* Predictive Weapon Lead Pip for Primary Locked Target */}
      <div
        ref={leadPipRef}
        className="pointer-events-none fixed left-0 top-0"
        style={{ visibility: 'hidden', willChange: 'transform' }}
        aria-hidden="true"
      >
        <div className="h-4 w-4 rounded-full border border-dashed border-cyan-300/90" />
      </div>

      {/* Subtle Sci-Fi Rounded-Rectangle Virtual Joystick Boundary (30% x 35% Base Viewport) */}
      <svg
        ref={aimBoundarySvgRef}
        data-testid="aim-boundary-frame"
        className="pointer-events-none fixed inset-0 h-full w-full text-cyan-300/75"
        style={{ opacity: 0.1, willChange: 'opacity, color' }}
        aria-hidden="true"
      >
        {[0, 1, 2, 3].map((idx) => (
          <path
            key={idx}
            ref={(el) => {
              cornerPathRefs.current[idx] = el;
            }}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        ))}
        <rect
          ref={deadzoneRectRef}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.4"
          strokeWidth="1"
          strokeDasharray="2 3"
          style={{ visibility: 'hidden' }}
        />
      </svg>

      {/* Alignment Tether (Aim Reticle -> Virtual Mouse Indicator); fades when they are close */}
      <svg
        className="pointer-events-none fixed inset-0 h-full w-full"
        aria-hidden="true"
      >
        <line
          ref={steerLineRef}
          x1="0"
          y1="0"
          x2="0"
          y2="0"
          stroke="#fcd34d"
          strokeWidth="1.1"
          strokeDasharray="3 4"
          style={{ opacity: 0 }}
        />
      </svg>

      {/* Virtual Mouse Indicator: accumulated Pointer Lock position; may leave the aim boundary */}
      <div
        ref={virtualMouseRef}
        data-testid="virtual-mouse-indicator"
        className="pointer-events-none fixed left-0 top-0 flex items-center justify-center text-amber-200"
        style={{ transform: 'translate3d(50vw, 50vh, 0) translate(-50%, -50%)', willChange: 'transform' }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18">
          <path d="M9 1.5 L16.5 9 L9 16.5 L1.5 9 Z" fill="rgba(251,191,36,0.18)" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="9" cy="9" r="1.2" fill="currentColor" />
          <path
            ref={virtualMouseArrowRef}
            d="M9 0.8 L12.2 5.7 L9 4.5 L5.8 5.7 Z"
            fill="currentColor"
            style={{ display: 'none' }}
          />
        </svg>
      </div>

      {/* Aim Reticle: bounded camera projection of the real weapon convergence point */}
      <div
        ref={aimReticleRef}
        data-testid="aim-reticle"
        className="pointer-events-none fixed left-0 top-0 flex items-center justify-center text-cyan-200/95"
        style={{ transform: 'translate3d(50vw, 50vh, 0) translate(-50%, -50%)', willChange: 'transform' }}
      >
        <svg width="46" height="46" viewBox="0 0 46 46">
          <circle cx="23" cy="23" r="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="7 5" />
          <line x1="23" y1="4" x2="23" y2="11" stroke="currentColor" strokeWidth="1.6" />
          <line x1="23" y1="35" x2="23" y2="42" stroke="currentColor" strokeWidth="1.6" />
          <line x1="4" y1="23" x2="11" y2="23" stroke="currentColor" strokeWidth="1.6" />
          <line x1="35" y1="23" x2="42" y2="23" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="23" cy="23" r="2.4" fill="#e0f2fe" />
        </svg>
        <div ref={hitMarkerRef} className="absolute opacity-0" style={{ willChange: 'opacity' }}>
          <svg width="34" height="34" viewBox="0 0 34 34" className="text-cyan-100">
            <line x1="7" y1="7" x2="13" y2="13" stroke="currentColor" strokeWidth="2.2" />
            <line x1="27" y1="7" x2="21" y2="13" stroke="currentColor" strokeWidth="2.2" />
            <line x1="7" y1="27" x2="13" y2="21" stroke="currentColor" strokeWidth="2.2" />
            <line x1="27" y1="27" x2="21" y2="21" stroke="currentColor" strokeWidth="2.2" />
          </svg>
        </div>
        <div ref={killMarkerRef} className="absolute opacity-0" style={{ willChange: 'opacity' }}>
          <svg width="52" height="52" viewBox="0 0 52 52" className="text-orange-400">
            <line x1="10" y1="10" x2="19" y2="19" stroke="currentColor" strokeWidth="2.5" />
            <line x1="42" y1="10" x2="33" y2="19" stroke="currentColor" strokeWidth="2.5" />
            <line x1="10" y1="42" x2="19" y2="33" stroke="currentColor" strokeWidth="2.5" />
            <line x1="42" y1="42" x2="33" y2="33" stroke="currentColor" strokeWidth="2.5" />
          </svg>
        </div>
      </div>

      {/* Top Edge: Minimal Combat Counter · Primary Target Bar · Compact Objectives & Pause */}
      <div className="flex items-start justify-between gap-4">
        {/* Top-Left: Ultra-compact Hostile / Kill Counter */}
        <div className="flex flex-col gap-1.5">
          <div className="obsidian-hud flex items-center gap-3 border-l-2 border-l-[#38bdf8] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider tabular-nums text-slate-400">
            <span>
              HST <strong ref={combatHostilesRef} className="text-orange-300">0</strong>
            </span>
            <span className="text-slate-700" aria-hidden="true">/</span>
            <span>
              KIL <strong ref={combatKillsRef} className="text-[#38bdf8]">0</strong>
            </span>
          </div>
          {import.meta.env.DEV && settings.showPerfOverlay && (
            <div className="obsidian-hud px-2.5 py-1 font-mono text-[9px] tabular-nums text-[#38bdf8]/90">
              <div ref={perfLine1Ref}>60 FPS · 16.6 ms · 0 draws · 0.0k tris</div>
              <div ref={perfLine2Ref} className="text-slate-400">
                E:0 · P:0 · VFX:0 · Assets:0 (0ms)
              </div>
            </div>
          )}
        </div>

        {/* Top-Center: Compact Locked Target Strip + Animated Objective Announcements */}
        <div className="flex flex-col items-center gap-1.5">
          <div
            ref={targetCardRef}
            className="obsidian-hud hidden border-orange-400/45 px-3 py-1.5 transition-opacity duration-150 md:block"
            style={{ opacity: 0, minWidth: 184 }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span ref={targetNameRef} className="font-display text-xs font-bold tracking-wider text-orange-300">
                VEX-01
              </span>
              <span ref={targetDistRef} className="font-mono text-[10px] tabular-nums text-slate-300">
                0 m
              </span>
            </div>
            <div className="mt-1 h-[2px] w-full overflow-hidden bg-slate-800/90">
              <div
                ref={targetHealthBarRef}
                className="h-full w-full origin-left bg-orange-400"
                style={{ transform: 'scaleX(1)', willChange: 'transform' }}
              />
            </div>
          </div>

          <AnimatePresence mode="wait">
            {missionHud?.announcement && (
              <motion.div
                key={missionHud.announcement}
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: TECH_EASE }}
                className={`obsidian-hud obsidian-scan border-l-2 px-3.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${
                  missionHud.announcementKind === 'warning'
                    ? 'border-l-amber-400 text-amber-200'
                    : missionHud.announcementKind === 'complete'
                      ? 'border-l-emerald-400 text-emerald-200'
                      : 'border-l-[#38bdf8] text-[#e0f2fe]'
                }`}
              >
                {missionHud.announcement}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Top-Right: Minimal Pause + Compact Active Objective Strip */}
        <div className="flex flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={onPause}
            className="obsidian-hud obsidian-surface-interactive pointer-events-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-300 hover:text-[#38bdf8] focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
            aria-label="Pause Flight"
          >
            <Pause className="h-3 w-3 text-[#38bdf8]" />
            <span>ESC</span>
          </button>

          {missionHud && (
            <div className="obsidian-hud hidden w-60 border-r-2 border-r-[#38bdf8]/75 px-3 py-2 sm:block">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
                <span className="truncate font-semibold text-[#38bdf8]">{missionHud.missionCode}</span>
                {missionHud.totalWaves > 1 && (
                  <span className="text-slate-400">
                    W{missionHud.waveIndex}/{missionHud.totalWaves}
                  </span>
                )}
              </div>
              <ul className="mt-1.5 space-y-1">
                {missionHud.objectives.map((obj) => {
                  const done = obj.status === 'completed';
                  const progressLabel =
                    obj.status === 'locked'
                      ? 'LOCKED'
                      : obj.status === 'skipped'
                        ? 'SKIP'
                      : obj.status === 'failed'
                        ? 'FAIL'
                      : obj.type === 'recon'
                        ? `${Math.floor(obj.progress * 100)}%`
                      : obj.type === 'defend'
                        ? `${obj.currentCount}/${obj.targetCount}W`
                      : obj.type === 'survive_duration'
                        ? `${Math.floor(obj.elapsedSec)}/${obj.targetDurationSec}s`
                      : obj.type === 'escort' || obj.type === 'escort_transport'
                        ? (missionHud.transport?.progress ?? obj.progress) >= 1 ? 'DONE' : `${Math.round((missionHud.transport?.progress ?? obj.progress) * 100)}%`
                      : obj.type === 'defeat_target' || obj.type === 'intercept' || obj.type === 'boss'
                        ? done ? 'DONE' : 'LIVE'
                      : obj.type === 'extract'
                        ? done ? 'DONE' : 'WAIT'
                        : `${obj.currentCount}/${obj.targetCount}`;

                  return (
                    <li
                      key={obj.id}
                      className={`flex items-start justify-between gap-2 text-[10px] leading-tight ${
                        done || obj.status === 'skipped' || obj.status === 'failed' || obj.status === 'locked'
                          ? 'text-slate-500'
                          : 'text-slate-200'
                      }`}
                    >
                      <span className="flex min-w-0 items-start gap-1.5">
                        {done ? (
                          <CheckCircle2 className="mt-0.5 h-2.5 w-2.5 shrink-0 text-[#38bdf8]" />
                        ) : (
                          <Circle className={`mt-0.5 h-2.5 w-2.5 shrink-0 ${obj.status === 'locked' ? 'text-slate-600' : 'text-[#38bdf8]/80'}`} />
                        )}
                        <span className="truncate">{obj.label}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[9px] tabular-nums text-[#38bdf8]">
                        {progressLabel}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {missionHud.interaction && (
                <div className="mt-1.5 border-t border-white/8 pt-1.5">
                  <div className={`flex items-center justify-between font-mono text-[9px] tracking-wider ${missionHud.interaction.available ? 'text-amber-200' : 'text-slate-400'}`}>
                    <span className="truncate">{missionHud.interaction.prompt}</span>
                    {missionHud.interaction.distance != null && (
                      <span className="ml-2 shrink-0 text-slate-500">{Math.round(missionHud.interaction.distance)}M</span>
                    )}
                  </div>
                  {missionHud.interaction.kind === 'scan' && (
                    <div className="mt-1 h-[2px] bg-slate-800/90">
                      <div className="h-full bg-[#38bdf8] transition-[width]" style={{ width: `${Math.round(missionHud.interaction.progress * 100)}%` }} />
                    </div>
                  )}
                </div>
              )}
              {missionHud.relay && (
                <div className="mt-1.5 border-t border-white/8 pt-1.5">
                  <div className="flex justify-between font-mono text-[9px] text-[#bae6fd]">
                    <span>{missionHud.relay.callsign}</span>
                    <span>{Math.ceil(missionHud.relay.currentIntegrity)}/{missionHud.relay.maxIntegrity}</span>
                  </div>
                  <div className="mt-1 h-[2px] bg-slate-800/90">
                    <div className="h-full bg-[#38bdf8] transition-[width]" style={{ width: `${Math.max(0, missionHud.relay.currentIntegrity / missionHud.relay.maxIntegrity * 100)}%` }} />
                  </div>
                </div>
              )}
              {missionHud.transport && (
                <div className="mt-1.5 border-t border-white/8 pt-1.5">
                  <div className="flex justify-between font-mono text-[9px] text-amber-200">
                    <span>{missionHud.transport.callsign}</span>
                    <span>{Math.ceil(missionHud.transport.currentHull)}/{missionHud.transport.maxHull}</span>
                  </div>
                  <div className="mt-1 h-[2px] bg-slate-800/90">
                    <div className="h-full bg-amber-400 transition-[width]" style={{ width: `${Math.max(0, missionHud.transport.currentHull / missionHud.transport.maxHull * 100)}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Click-to-Lock Mouse Flight Notice */}
      {!pointerLocked && !playerDestroyed && (
        <div className="pointer-events-auto fixed left-1/2 top-[64%] -translate-x-1/2">
          <button
            type="button"
            onClick={onRequestLock}
            className="obsidian-cta-primary obsidian-scan px-5 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#e0f2fe] focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
          >
            Engage Flight Controls
          </button>
        </div>
      )}

      {/* Bottom Edges: Compact Corner Instruments leaving center completely clear */}
      <div className="flex items-end justify-between gap-4">
        {/* Bottom-Left: Compact Survivability, Boost & Speed */}
        <div className="obsidian-hud w-48 border-l-2 border-l-[#38bdf8] px-3 py-2 sm:w-52">
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span className="flex items-center gap-1.5 text-[#38bdf8]">
              <span>SHD</span>
              <span ref={shieldStatusRef} className="text-[9px] font-semibold" />
            </span>
            <span ref={shieldNumRef} className="tabular-nums text-slate-100">
              {ship.maxShield} / {ship.maxShield}
            </span>
          </div>
          <div className="mt-1 h-[3px] w-full overflow-hidden bg-slate-800/90">
            <div ref={shieldBarRef} className="h-full w-full origin-left bg-[#38bdf8]" style={{ transform: 'scaleX(1)', willChange: 'transform' }} />
          </div>

          <div className="mt-1.5 flex items-center justify-between font-mono text-[10px]">
            <span className="text-slate-400">HUL</span>
            <span ref={hullNumRef} className="tabular-nums text-slate-100">
              {ship.maxHull} / {ship.maxHull}
            </span>
          </div>
          <div className="mt-1 h-[3px] w-full overflow-hidden bg-slate-800/90">
            <div ref={hullBarRef} className="h-full w-full origin-left bg-sky-400" style={{ transform: 'scaleX(1)', willChange: 'transform' }} />
          </div>

          <div className="mt-2 flex items-center gap-2.5 border-t border-white/8 pt-1.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between font-mono text-[9px]">
                <span className="text-slate-500">BST</span>
                <span ref={boostNumRef} className="tabular-nums text-[#38bdf8]">100%</span>
              </div>
              <div className="mt-1 h-[2px] w-full overflow-hidden bg-slate-800/90">
                <div ref={boostBarRef} className="h-full w-full origin-left bg-[#38bdf8]" style={{ transform: 'scaleX(1)', willChange: 'transform' }} />
              </div>
            </div>
            <div className="flex shrink-0 items-baseline gap-0.5 border-l border-white/10 pl-2.5">
              <span ref={speedNumRef} className="font-display text-sm font-bold leading-none tabular-nums text-slate-100">
                0
              </span>
              <span className="font-mono text-[8px] text-slate-500">M/S</span>
            </div>
          </div>
        </div>

        {/* Bottom-Center: Whisper-Quiet Collapsible Hints */}
        <div className="pointer-events-auto hidden flex-col items-center md:flex">
          {hintsVisible && (
            <div className="obsidian-hud mb-1 flex items-center gap-2.5 px-3 py-1 font-mono text-[9px] uppercase tracking-wider text-slate-400">
              <span><strong className="text-[#38bdf8]">LMB</strong> FIRE</span>
              <span className="text-slate-700">/</span>
              <span><strong className="text-[#38bdf8]">M</strong> MSL</span>
              <span className="text-slate-700">/</span>
              <span><strong className="text-[#38bdf8]">W·S</strong> THR</span>
              <span className="text-slate-700">/</span>
              <span><strong className="text-[#38bdf8]">A·D</strong> ROL</span>
              <span className="text-slate-700">/</span>
              <span><strong className="text-[#38bdf8]">SHFT</strong> BST</span>
              {missionHud?.interaction && (
                <>
                  <span className="text-slate-700">/</span>
                  <span><strong className="text-amber-300">E</strong> ACT</span>
                </>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={onToggleHints}
            className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-slate-500/80 transition-colors hover:text-[#38bdf8]"
          >
            {hintsVisible ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronUp className="h-2.5 w-2.5" />}
            <span>H</span>
          </button>
        </div>

        {/* Bottom-Right: Compact Ordnance & Integrated Missile Lock-On */}
        <div
          ref={lockPanelRef}
          className="obsidian-hud w-48 border-r-2 border-r-[#38bdf8] px-3 py-2 font-mono sm:w-52"
          style={{ opacity: 0.72 }}
        >
          <div className="flex items-center justify-between text-[10px]">
            <span ref={weaponStatusRef} className="text-slate-300">READY</span>
            <span ref={missileAmmoRef} className="font-semibold text-amber-300">4 · M</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-white/8 pt-1.5 text-[9px]">
            <span ref={lockNameRef} className="truncate text-slate-200">NO TARGET</span>
            <span ref={lockStateRef} className="shrink-0 text-[#38bdf8]">SEEK</span>
          </div>
          <div className="mt-1 h-[3px] w-full overflow-hidden bg-slate-800/90">
            <div ref={lockBarRef} className="h-full w-full origin-left bg-[#38bdf8]" style={{ transform: 'scaleX(0)' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
