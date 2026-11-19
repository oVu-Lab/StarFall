import { useRef } from 'react';
import { ArrowLeft, Lock, Play } from 'lucide-react';
import { AudioManager } from '../audio/AudioManager';
import { SHIP_CONFIGS, SHIP_ORDER } from '../config/ships';
import type { ShipId } from '../types/game';

interface HangarViewProps {
  selectedShipId: ShipId;
  onSelectShip: (id: ShipId) => void;
  onLaunchFlight: () => void;
  onBack: () => void;
  hangarOrbitRef: React.MutableRefObject<{ yaw: number; pitch: number }>;
}

interface StatRowProps {
  label: string;
  value: number;
}

function StatRow({ label, value }: StatRowProps) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono tabular-nums text-slate-200">{value}</span>
      </div>
      <div className="mt-1 h-1.5 w-full bg-slate-800">
        <div
          className="h-full bg-cyan-400 transition-transform duration-300"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Interactive 3D Hangar previewing all three planned STARFALL chassis.
 * Keeps the central 3D fighter unobstructed and supports drag-to-orbit inspection.
 */
export function HangarView({
  selectedShipId,
  onSelectShip,
  onLaunchFlight,
  onBack,
  hangarOrbitRef,
}: HangarViewProps) {
  const ship = SHIP_CONFIGS[selectedShipId];
  const dragState = useRef<{ active: boolean; x: number; y: number }>({
    active: false,
    x: 0,
    y: 0,
  });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragState.current = { active: true, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.active) return;
    const dx = e.clientX - dragState.current.x;
    const dy = e.clientY - dragState.current.y;
    dragState.current.x = e.clientX;
    dragState.current.y = e.clientY;
    hangarOrbitRef.current.yaw -= dx * 0.008;
    hangarOrbitRef.current.pitch = Math.max(
      -0.8,
      Math.min(0.8, hangarOrbitRef.current.pitch + dy * 0.006),
    );
  };

  const handlePointerUp = () => {
    dragState.current.active = false;
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-6 sm:p-8">
      {/* Top Row: Back Navigation & Hangar Title */}
      <div className="flex items-center justify-between">
        <div className="pointer-events-auto flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              AudioManager.playUiClick('secondary');
              onBack();
            }}
            className="flex items-center gap-2 border border-slate-700/80 bg-[#050c1d]/85 px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-cyan-400/60 hover:text-cyan-200 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Main Menu</span>
          </button>
          <div>
            <h1 className="font-display text-xl font-semibold tracking-wider text-slate-100">
              Starfighter Hangar
            </h1>
            <p className="text-xs text-slate-400">
              Drag viewport to inspect 3D chassis · Future combat unlocks preview
            </p>
          </div>
        </div>
      </div>

      {/* Interactive Transparent Drag Zone Over Center 3D Ship */}
      <div
        className="pointer-events-auto my-2 flex-1 cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        aria-label="Drag to rotate 3D spaceship"
      />

      {/* Unified Bottom Hangar Dock (Zero Viewport Occlusion) */}
      <div className="pointer-events-auto mx-auto w-full max-w-5xl border border-slate-700/80 bg-[#050c1d]/92 p-5">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-center">
          {/* Ship Class Selector Tabs */}
          <div className="flex flex-col gap-2 lg:col-span-3">
            {SHIP_ORDER.map((id) => {
              const candidate = SHIP_CONFIGS[id];
              const isSelected = id === selectedShipId;
              return (
                <button
                  key={id}
                  type="button"
                  onMouseEnter={() => AudioManager.playUiHover()}
                  onClick={() => {
                    AudioManager.playUiClick('secondary');
                    onSelectShip(id);
                  }}
                  className={`flex items-center justify-between border px-3.5 py-2.5 text-left transition-colors ${
                    isSelected
                      ? 'border-cyan-400 bg-cyan-950/50 text-slate-100'
                      : 'border-slate-800 bg-[#081226] text-slate-300 hover:border-slate-600 hover:text-slate-100'
                  }`}
                >
                  <div>
                    <div className="font-display text-sm font-semibold tracking-wide">
                      {candidate.name}
                    </div>
                    <div className="font-mono text-[11px] text-slate-400">
                      {candidate.callsign}
                    </div>
                  </div>
                  {!candidate.playableInPhase1 && (
                    <Lock className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-label="Coming Soon" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Selected Ship Profile & Specs */}
          <div className="lg:col-span-5">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h2 className="font-display text-2xl font-bold tracking-wide text-slate-100">
                {ship.name}
              </h2>
              <span className="font-mono text-xs text-cyan-300">{ship.callsign}</span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="text-xs text-slate-400">{ship.role}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">{ship.description}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-slate-400">
              <span>Max Speed {ship.flight.maxSpeed} m/s</span>
              <span aria-hidden="true">·</span>
              <span>Hull {ship.maxHull}</span>
              <span aria-hidden="true">·</span>
              <span>{ship.weapons.primaryName}</span>
            </div>
          </div>

          {/* Comparative Spec Bars + Action */}
          <div className="flex flex-col justify-between gap-4 lg:col-span-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              <StatRow label="Speed" value={ship.ratings.speed} />
              <StatRow label="Maneuverability" value={ship.ratings.maneuverability} />
              <StatRow label="Hull Integrity" value={ship.ratings.hull} />
              <StatRow label="Firepower" value={ship.ratings.firepower} />
            </div>

            {ship.playableInPhase1 ? (
              <button
                type="button"
                onMouseEnter={() => AudioManager.playUiHover()}
                onClick={() => {
                  AudioManager.playUiClick('primary');
                  onLaunchFlight();
                }}
                className="flex w-full items-center justify-center gap-2 bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-300 whitespace-nowrap"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>Launch Flight Test</span>
              </button>
            ) : (
              <div className="border border-slate-700/80 bg-[#081226] px-4 py-2.5 text-center text-xs text-slate-400">
                {ship.unlockNote}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
