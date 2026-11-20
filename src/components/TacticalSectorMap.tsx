import { useMemo } from 'react';
import type { MissionDefinition } from '../types/mission';

interface TacticalSectorMapProps {
  mission: MissionDefinition;
}

/**
 * Data-driven 2D tactical projection of the mission's actual 3D spatial layout:
 * wave enemy spawn formations, priority targets, escort routes, defense relays,
 * and extraction zones. Zero fabricated numbers or decorative fake telemetry.
 */
export function TacticalSectorMap({ mission }: TacticalSectorMapProps) {
  const layout = useMemo(() => {
    const rawPoints: Array<{
      x: number;
      z: number;
      kind: 'enemy' | 'priority' | 'relay' | 'extract';
      wave: number;
    }> = [];

    for (const wave of mission.waves) {
      for (const enemy of wave.enemies) {
        rawPoints.push({
          x: enemy.offset[0],
          z: enemy.offset[2],
          kind: enemy.isPriorityTarget ? 'priority' : 'enemy',
          wave: wave.waveNumber,
        });
      }
    }

    if (mission.relay) {
      rawPoints.push({
        x: mission.relay.offset[0],
        z: mission.relay.offset[2],
        kind: 'relay',
        wave: 0,
      });
    }

    if (mission.extractionPoint) {
      rawPoints.push({
        x: mission.extractionPoint.offset[0],
        z: mission.extractionPoint.offset[2],
        kind: 'extract',
        wave: 0,
      });
    }

    const routePts = mission.escort?.route.map(([x, , z]) => ({ x, z })) ?? [];

    let maxExtent = 220;
    for (const p of rawPoints) {
      maxExtent = Math.max(maxExtent, Math.abs(p.x), Math.abs(p.z));
    }
    for (const p of routePts) {
      maxExtent = Math.max(maxExtent, Math.abs(p.x), Math.abs(p.z));
    }

    const scale = 74 / maxExtent;
    const toSvg = (x: number, z: number) => ({
      sx: 100 + x * scale,
      sy: 100 + z * scale,
    });

    const mappedPoints = rawPoints.map((p) => ({
      ...p,
      ...toSvg(p.x, p.z),
    }));

    const mappedRoute = routePts.map((p) => toSvg(p.x, p.z));
    const routePath =
      mappedRoute.length > 1
        ? mappedRoute
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.sx.toFixed(1)},${p.sy.toFixed(1)}`)
            .join(' ')
        : null;

    return { mappedPoints, routePath, hasPriority: mappedPoints.some((p) => p.kind === 'priority') };
  }, [mission]);

  return (
    <div className="obsidian-well relative flex flex-col items-center justify-center overflow-hidden p-3">
      <div className="flex w-full items-center justify-between font-mono text-[9px] uppercase tracking-[0.2em] text-slate-500">
        <span className="truncate text-[#38bdf8]/80">{mission.environment.sectorName}</span>
        <span>SECTOR PLOT</span>
      </div>

      <svg
        viewBox="0 0 200 200"
        className="my-1.5 h-44 w-44 sm:h-48 sm:w-48"
        role="img"
        aria-label={`Tactical sector map for ${mission.name}`}
      >
        <defs>
          <radialGradient id={`radar-glow-${mission.id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`sweep-grad-${mission.id}`} x1="50%" y1="50%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.28" />
          </linearGradient>
        </defs>

        {/* Subtle core illumination */}
        <circle cx="100" cy="100" r="84" fill={`url(#radar-glow-${mission.id})`} />

        {/* Precision range rings */}
        <circle cx="100" cy="100" r="82" fill="none" stroke="rgba(56,189,248,0.22)" strokeWidth="0.9" />
        <circle cx="100" cy="100" r="54" fill="none" stroke="rgba(56,189,248,0.13)" strokeWidth="0.75" strokeDasharray="3 4" />
        <circle cx="100" cy="100" r="26" fill="none" stroke="rgba(56,189,248,0.16)" strokeWidth="0.75" />

        {/* Cardinal crosshair axes */}
        <line x1="100" y1="12" x2="100" y2="188" stroke="rgba(56,189,248,0.1)" strokeWidth="0.75" />
        <line x1="12" y1="100" x2="188" y2="100" stroke="rgba(56,189,248,0.1)" strokeWidth="0.75" />

        {/* Calm rotating radar sweep wedge */}
        <g className="terminal-radar-sweep">
          <path
            d="M100,100 L100,18 A82,82 0 0,1 158,42 Z"
            fill={`url(#sweep-grad-${mission.id})`}
          />
          <line x1="100" y1="100" x2="100" y2="18" stroke="rgba(125,211,252,0.5)" strokeWidth="0.9" />
        </g>

        {/* Escort route trajectory (real waypoints) */}
        {layout.routePath && (
          <path
            d={layout.routePath}
            fill="none"
            stroke="#fbbf24"
            strokeOpacity="0.72"
            strokeWidth="1.3"
            strokeDasharray="4 3"
          />
        )}

        {/* Real enemy, priority, relay, and extraction markers */}
        {layout.mappedPoints.map((pt, idx) => {
          if (pt.kind === 'relay') {
            return (
              <g key={`relay-${idx}`} transform={`translate(${pt.sx.toFixed(1)}, ${pt.sy.toFixed(1)})`}>
                <polygon points="0,-6 6,0 0,6 -6,0" fill="rgba(56,189,248,0.25)" stroke="#38bdf8" strokeWidth="1.2" />
              </g>
            );
          }
          if (pt.kind === 'extract') {
            return (
              <g key={`ext-${idx}`} transform={`translate(${pt.sx.toFixed(1)}, ${pt.sy.toFixed(1)})`}>
                <circle r="6" fill="none" stroke="#34d399" strokeWidth="1.1" strokeDasharray="2.5 2" />
                <circle r="2" fill="#34d399" />
              </g>
            );
          }
          if (pt.kind === 'priority') {
            return (
              <g key={`pri-${idx}`} transform={`translate(${pt.sx.toFixed(1)}, ${pt.sy.toFixed(1)})`}>
                <polygon points="0,-5.5 5.5,0 0,5.5 -5.5,0" fill="#fbbf24" stroke="#fef3c7" strokeWidth="0.9" />
              </g>
            );
          }
          return (
            <circle
              key={`en-${idx}`}
              cx={pt.sx.toFixed(1)}
              cy={pt.sy.toFixed(1)}
              r={pt.wave === 1 ? 2.4 : 1.9}
              fill={pt.wave === 1 ? '#fb923c' : '#f97316'}
              fillOpacity={pt.wave === 1 ? 0.92 : 0.52}
            />
          );
        })}

        {/* Player launch origin chevron */}
        <polygon points="100,94 104,104 100,101.5 96,104" fill="#38bdf8" stroke="#e0f2fe" strokeWidth="0.6" />
      </svg>

      {/* Minimal Legend — only icons present in this operation */}
      <div className="flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-white/6 pt-2 font-mono text-[9px] uppercase tracking-wider text-slate-400">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
          Hostiles
        </span>
        {layout.hasPriority && (
          <span className="flex items-center gap-1 text-amber-300">
            <span className="h-1.5 w-1.5 rotate-45 bg-amber-400" />
            Priority
          </span>
        )}
        {mission.relay && (
          <span className="flex items-center gap-1 text-[#38bdf8]">
            <span className="h-1.5 w-1.5 rotate-45 border border-[#38bdf8]" />
            Relay
          </span>
        )}
        {mission.escort && (
          <span className="flex items-center gap-1 text-amber-300">
            <span className="h-px w-2.5 bg-amber-400" />
            Escort
          </span>
        )}
        {mission.extractionPoint && (
          <span className="flex items-center gap-1 text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Extract
          </span>
        )}
      </div>
    </div>
  );
}
