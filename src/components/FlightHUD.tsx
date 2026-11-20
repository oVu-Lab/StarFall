import { useEffect, useRef } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Circle, Pause } from 'lucide-react';
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

  // Core flight refs
  const speedNumRef = useRef<HTMLSpanElement>(null);
  const speedBarRef = useRef<HTMLDivElement>(null);
  const statusTextRef = useRef<HTMLSpanElement>(null);
  const headingRef = useRef<HTMLSpanElement>(null);
  const pitchRef = useRef<HTMLSpanElement>(null);
  const rollRef = useRef<HTMLSpanElement>(null);
  const hullNumRef = useRef<HTMLSpanElement>(null);
  const hullBarRef = useRef<HTMLDivElement>(null);
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
        const hullPct = Math.round(hullRatio * 100);
        hullNumRef.current.textContent = `${hullPct}%`;
        hullNumRef.current.style.color =
          hullRatio <= 0.3 ? '#f87171' : hullRatio <= 0.55 ? '#fbbf24' : '#f1f5f9';
      }
      if (hullBarRef.current) {
        hullBarRef.current.style.transform = `scaleX(${hullRatio})`;
        hullBarRef.current.style.backgroundColor =
          hullRatio <= 0.3 ? '#ef4444' : hullRatio <= 0.55 ? '#f59e0b' : '#38bdf8';
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

      <div ref={missileWarningRef} className="pointer-events-none fixed right-72 top-20 border border-rose-400/70 bg-[#260811]/90 px-3 py-2 font-mono text-xs font-bold tracking-[0.18em] text-rose-200 shadow-[0_0_18px_rgba(244,63,94,0.35)]" style={{ opacity: 0, transition: 'opacity 100ms' }}>MISSILE WARNING</div>
      <div ref={missileDirectionRef} className="pointer-events-none fixed left-0 top-0 text-rose-400" style={{ opacity: 0, willChange: 'transform,opacity' }} aria-label="Incoming missile direction"><svg width="30" height="30" viewBox="0 0 30 30"><path d="M15 2 L27 26 L15 21 L3 26 Z" fill="rgba(244,63,94,.18)" stroke="currentColor" strokeWidth="1.7"/></svg></div>
      <div ref={lockPanelRef} className="pointer-events-none fixed bottom-6 left-1/2 w-60 -translate-x-1/2 border border-cyan-400/35 bg-[#040a18]/88 px-3 py-2 font-mono text-[10px] tracking-wider" style={{ opacity: 0.55 }}>
        <div className="flex justify-between"><span ref={lockNameRef} className="text-slate-200">NO TARGET</span><span ref={missileAmmoRef} className="text-orange-200">4 · M</span></div>
        <div className="mt-1.5 h-1 overflow-hidden bg-slate-800"><div ref={lockBarRef} className="h-full w-full origin-left bg-cyan-400" style={{ transform: 'scaleX(0)' }} /></div>
        <div ref={lockStateRef} className="mt-1 text-center text-cyan-300">SEEKING TARGET</div>
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

      {/* Top Row: Attitude & Combat Strip + Center Target Card + Right Pause & Mission Objectives */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="border border-cyan-400/20 bg-[#040a18]/82 px-4 py-2">
            <div className="flex items-center gap-3.5 font-mono text-xs tabular-nums text-slate-300">
              <span>
                HDG <strong ref={headingRef} className="font-semibold text-cyan-300">000°</strong>
              </span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span>
                PITCH <strong ref={pitchRef} className="font-semibold text-slate-100">+0°</strong>
              </span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span>
                ROLL <strong ref={rollRef} className="font-semibold text-slate-100">+0°</strong>
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 border-t border-slate-800/80 pt-1.5 font-mono text-[11px] tabular-nums text-slate-400">
              <span>
                Hostiles <strong ref={combatHostilesRef} className="text-orange-300">0</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Kills <strong ref={combatKillsRef} className="text-cyan-300">0</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Acc <strong ref={combatAccRef} className="text-slate-200">0%</strong>
              </span>
            </div>
            {/* Development-only Performance Monitor (compiled out in production) */}
            {import.meta.env.DEV && settings.showPerfOverlay && (
              <div className="mt-1.5 border-t border-cyan-500/25 pt-1.5 font-mono text-[10px] tabular-nums text-cyan-300/90">
                <div ref={perfLine1Ref}>60 FPS · 16.6 ms · 0 draws · 0.0k tris</div>
                <div ref={perfLine2Ref} className="text-slate-400">
                  E:0 · P:0 · VFX:0 · Assets:0 (0ms)
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center Column: Active Target Readout + Non-Blocking Tactical Announcement Banner */}
        <div className="flex flex-col items-center gap-2">
          <div
            ref={targetCardRef}
            className="hidden border border-orange-400/35 bg-[#040a18]/85 px-4 py-2 transition-opacity duration-150 md:block"
            style={{ opacity: 0, minWidth: 210 }}
          >
            <div className="flex items-baseline justify-between gap-4">
              <span ref={targetNameRef} className="font-display text-sm font-semibold text-orange-300">
                VEX-01
              </span>
              <span ref={targetDistRef} className="font-mono text-xs tabular-nums text-slate-300">
                0 m
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden bg-slate-800">
              <div
                ref={targetHealthBarRef}
                className="h-full w-full origin-left bg-orange-400"
                style={{ transform: 'scaleX(1)', willChange: 'transform' }}
              />
            </div>
            <div ref={targetRoleRef} className="mt-1 font-mono text-[10px] text-slate-400">
              AGGRESSOR · ENGAGE
            </div>
          </div>

          {missionHud?.announcement && (
            <div
              className={`border px-4 py-1.5 font-mono text-xs tracking-wider ${
                missionHud.announcementKind === 'warning'
                  ? 'border-amber-400/60 bg-[#1a1105]/90 text-amber-200'
                  : missionHud.announcementKind === 'complete'
                    ? 'border-cyan-400/60 bg-[#051b26]/90 text-cyan-200'
                    : 'border-cyan-500/35 bg-[#040a18]/88 text-slate-100'
              }`}
            >
              {missionHud.announcement}
            </div>
          )}
        </div>

        {/* Right Column: Pause Button + Mission Objectives Panel */}
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={onPause}
            className="pointer-events-auto flex items-center gap-2 border border-slate-700/80 bg-[#040a18]/82 px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-cyan-400/60 hover:text-cyan-200 focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
            aria-label="Pause Flight"
          >
            <Pause className="h-3.5 w-3.5 text-cyan-400" />
            <span>Pause</span>
            <span className="font-mono text-[11px] text-slate-400">ESC</span>
          </button>

          {missionHud && (
            <div className="hidden w-64 border border-slate-700/75 bg-[#040a18]/84 px-3.5 py-2.5 sm:block">
              <div className="flex items-center justify-between border-b border-slate-800/90 pb-1.5 font-mono text-[11px]">
                <span className="font-semibold text-cyan-300">
                  {missionHud.missionCode} · {missionHud.missionName}
                </span>
                {missionHud.totalWaves > 1 && (
                  <span className="text-slate-400">
                    W{missionHud.waveIndex}/{missionHud.totalWaves}
                  </span>
                )}
              </div>
              <ul className="mt-2 space-y-1.5">
                {missionHud.objectives.map((obj) => {
                  const done = obj.status === 'completed';
                  const progressLabel =
                    obj.type === 'survive_duration'
                      ? `${Math.floor(obj.elapsedSec)}s / ${obj.targetDurationSec}s`
                      : obj.type === 'escort_transport'
                        ? (missionHud.transport?.progress ?? 0) >= 1 ? 'EXTRACTED' : `${Math.round((missionHud.transport?.progress ?? 0) * 100)}%`
                      : obj.type === 'defeat_target'
                        ? done
                          ? 'DONE'
                          : 'ACTIVE'
                        : `${obj.currentCount}/${obj.targetCount}`;

                  return (
                    <li
                      key={obj.id}
                      className={`flex items-start justify-between gap-2 text-[11px] ${
                        done ? 'text-slate-500 line-through' : 'text-slate-200'
                      }`}
                    >
                      <span className="flex items-start gap-1.5">
                        {done ? (
                          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-cyan-400" />
                        ) : (
                          <Circle className="mt-0.5 h-3 w-3 shrink-0 text-cyan-300/80" />
                        )}
                        <span>{obj.label}</span>
                      </span>
                      <span className="font-mono text-[10px] tabular-nums text-cyan-300 shrink-0">
                        {progressLabel}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {missionHud.transport && (
                <div className="mt-2 border-t border-slate-800/90 pt-2">
                  <div className="flex justify-between font-mono text-[10px] text-amber-200">
                    <span>ESCORT · {missionHud.transport.callsign}</span>
                    <span>{Math.ceil(missionHud.transport.currentHull)} / {missionHud.transport.maxHull} HULL</span>
                  </div>
                  <div className="mt-1 h-1 bg-slate-800">
                    <div className="h-full bg-amber-400 transition-[width]" style={{ width: `${Math.max(0, missionHud.transport.currentHull / missionHud.transport.maxHull * 100)}%` }} />
                  </div>
                  <div className="mt-1 text-right font-mono text-[9px] tracking-wider text-amber-300/80">
                    {(missionHud.transport.progress * 100).toFixed(0)}% TO EXTRACTION
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Click-to-Lock Mouse Flight Notice (engages synchronous Pointer Lock for continuous turning) */}
      {!pointerLocked && !playerDestroyed && (
        <div className="pointer-events-auto fixed left-1/2 top-[64%] -translate-x-1/2">
          <button
            type="button"
            onClick={onRequestLock}
            className="border border-cyan-400/55 bg-[#040a18]/92 px-5 py-2.5 text-xs font-medium tracking-wide text-cyan-200 transition-colors hover:border-cyan-300 hover:bg-[#081631] focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            Click to Engage Continuous Mouse Flight & Weapons (Pointer Lock)
          </button>
        </div>
      )}

      {/* Bottom Tactical Instrument Strip + Collapsible Control Hints */}
      <div className="flex flex-col items-center gap-2.5">
        <div className="grid w-full max-w-4xl grid-cols-1 gap-3 sm:grid-cols-3">
          {/* Left: Hull Integrity & Primary Weapon Status */}
          <div className="border border-slate-700/70 bg-[#040a18]/84 px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-slate-400">Hull Integrity</span>
              <span
                ref={hullNumRef}
                className="font-mono text-sm font-semibold tabular-nums text-slate-100"
              >
                100%
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden bg-slate-800">
              <div
                ref={hullBarRef}
                className="h-full w-full origin-left bg-sky-400"
                style={{ transform: 'scaleX(1)', willChange: 'transform' }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px]">
              <span className="text-slate-400">{ship.weapons.primaryName}</span>
              <span ref={weaponStatusRef} className="font-mono font-medium text-slate-300">
                READY
              </span>
            </div>
          </div>

          {/* Center: Boost Energy & Flight Status */}
          <div className="border border-cyan-500/30 bg-[#040a18]/84 px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span ref={boostLabelRef} className="text-xs font-medium text-cyan-200">
                Boost Energy
              </span>
              <span
                ref={boostNumRef}
                className="font-mono text-sm font-semibold tabular-nums text-cyan-300"
              >
                100%
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden bg-slate-800">
              <div
                ref={boostBarRef}
                className="h-full w-full origin-left bg-cyan-400"
                style={{ transform: 'scaleX(1)', willChange: 'transform' }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Flight Status</span>
              <span
                ref={statusTextRef}
                className="font-mono font-medium tracking-wider text-slate-300"
              >
                STANDBY
              </span>
            </div>
          </div>

          {/* Right: Velocity Readout */}
          <div className="border border-slate-700/70 bg-[#040a18]/84 px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-slate-400">Velocity</span>
              <div className="flex items-baseline gap-1">
                <span
                  ref={speedNumRef}
                  className="font-display text-xl font-bold leading-none tabular-nums text-slate-100"
                >
                  0
                </span>
                <span className="font-mono text-[11px] text-slate-400">m/s</span>
              </div>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden bg-slate-800">
              <div
                ref={speedBarRef}
                className="h-full w-full origin-left bg-cyan-500"
                style={{ transform: 'scaleX(0)', willChange: 'transform' }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] tabular-nums text-slate-400">
              <span>Cruise {ship.flight.maxSpeed}</span>
              <span>Boost {Math.round(ship.flight.maxSpeed * ship.flight.boostMultiplier)}</span>
            </div>
          </div>
        </div>

        {/* Collapsible Control Hints Strip */}
        <div className="pointer-events-auto flex flex-col items-center">
          <button
            type="button"
            onClick={onToggleHints}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-slate-400 transition-colors hover:text-cyan-300"
          >
            {hintsVisible ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            <span>{hintsVisible ? 'Hide Controls (H)' : 'Show Controls (H)'}</span>
          </button>

          {hintsVisible && (
            <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border border-slate-800/90 bg-[#040a18]/85 px-4 py-1.5 text-xs text-slate-300">
              <span>
                <strong className="font-mono text-cyan-300">Mouse</strong> Continuous Steer
              </span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span>
                <strong className="font-mono text-cyan-300">LMB / Space</strong> Fire
              </span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span>
                <strong className="font-mono text-cyan-300">W / S</strong> Thrust / Reverse
              </span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span>
                <strong className="font-mono text-cyan-300">A / D</strong> Roll
              </span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span>
                <strong className="font-mono text-cyan-300">Shift</strong> Boost
              </span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span>
                <strong className="font-mono text-cyan-300">Esc</strong> Pause
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
