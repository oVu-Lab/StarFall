import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Coins,
  Crosshair,
  Gauge,
  Lock,
  Move,
  Play,
  RotateCcw,
  Shield,
  ShoppingCart,
  Trophy,
} from 'lucide-react';
import { AudioManager } from '../audio/AudioManager';
import { getShipConfigWithSkin, SHIP_CATALOG, SKIN_CATALOG } from '../config/collection';
import { SHIP_CONFIGS } from '../config/ships';
import { ACHIEVEMENTS } from '../engine/mission/CampaignRewards';
import type { ShipId } from '../types/game';
import type { CampaignSaveData } from '../types/mission';

interface HangarViewProps {
  selectedShipId: ShipId;
  previewSkinId?: string;
  onSelectShip: (id: ShipId) => void;
  onLaunchFlight: () => void;
  onBack: () => void;
  hangarOrbitRef: React.MutableRefObject<{ yaw: number; pitch: number }>;
  save: CampaignSaveData;
  notice: string;
  onSelectSkin: (shipId: ShipId, skinId: string) => void;
  onPreviewSkin: (skinId: string) => void;
  onPurchase: (kind: 'ship' | 'skin', id: string) => void;
}

function getAchievementName(achievementId?: string): string {
  if (!achievementId) return '';
  const found = ACHIEVEMENTS.find((item) => item.id === achievementId);
  return found ? found.name : achievementId.replace('achievement:', '').replace(/-/g, ' ');
}

function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="tracking-wide text-slate-400">{label}</span>
        <span className="font-mono text-xs font-medium tabular-nums text-slate-100">{value}</span>
      </div>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden bg-slate-800/90">
        <motion.div
          className="h-full bg-gradient-to-r from-[#0284c7] via-[#38bdf8] to-[#7dd3fc]"
          initial={false}
          animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
          transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
        />
        {/* Subtle calibration tick marks */}
        <div
          className="pointer-events-none absolute inset-0 flex justify-between opacity-35"
          aria-hidden="true"
        >
          <span className="h-full w-px bg-[#131722]" />
          <span className="h-full w-px bg-[#131722]" />
          <span className="h-full w-px bg-[#131722]" />
          <span className="h-full w-px bg-[#131722]" />
          <span className="h-full w-px bg-[#131722]" />
        </div>
      </div>
    </div>
  );
}

export function HangarView({
  selectedShipId,
  previewSkinId,
  onSelectShip,
  onLaunchFlight,
  onBack,
  hangarOrbitRef,
  save,
  notice,
  onSelectSkin,
  onPreviewSkin,
  onPurchase,
}: HangarViewProps) {
  const ship = SHIP_CONFIGS[selectedShipId];
  const collection = save.collection!;
  const credits = save.rewards?.credits ?? 0;
  const unlockedAchievements = save.rewards?.unlockedAchievementIds ?? [];
  const shipItem = SHIP_CATALOG.find((item) => item.id === selectedShipId)!;
  const skins = SKIN_CATALOG.filter((skin) => skin.shipId === selectedShipId);
  const equippedSkinId = collection.selectedSkinByShip[selectedShipId] ?? `${selectedShipId}:default`;
  const activePreviewSkinId =
    previewSkinId && skins.some((skin) => skin.id === previewSkinId)
      ? previewSkinId
      : equippedSkinId;
  const previewSkin = skins.find((skin) => skin.id === activePreviewSkinId) ?? skins[0];

  const isShipOwned = collection.ownedShipIds.includes(selectedShipId);
  const isShipAffordable = credits >= shipItem.price;
  const shipShortfall = Math.max(0, shipItem.price - credits);

  const isPreviewSkinOwned = collection.ownedSkinIds.includes(previewSkin.id);
  const isPreviewSkinEquipped = equippedSkinId === previewSkin.id && isPreviewSkinOwned;
  const isPreviewSkinAchievementLocked =
    Boolean(previewSkin.achievementRequirement) &&
    !unlockedAchievements.includes(previewSkin.achievementRequirement!);
  const isPreviewSkinAffordable = credits >= previewSkin.price;
  const skinShortfall = Math.max(0, previewSkin.price - credits);

  const drag = useRef({ active: false, x: 0, y: 0 });
  const prevCreditsRef = useRef(credits);
  const [creditDelta, setCreditDelta] = useState<number | null>(null);
  const [purchasePulse, setPurchasePulse] = useState(false);

  // Visual feedback when credits change after a purchase
  useEffect(() => {
    const diff = credits - prevCreditsRef.current;
    if (diff !== 0) {
      prevCreditsRef.current = credits;
      setCreditDelta(diff);
      if (diff < 0) {
        setPurchasePulse(true);
      }
      const timer = window.setTimeout(() => {
        setCreditDelta(null);
        setPurchasePulse(false);
      }, 1500);
      return () => window.clearTimeout(timer);
    }
  }, [credits]);

  const isSuccessNotice =
    Boolean(notice) &&
    (notice.toLowerCase().includes('acquired') || notice.toLowerCase().includes('equipped'));

  const handleResetView = () => {
    AudioManager.playUiClick('secondary');
    hangarOrbitRef.current.yaw = 0;
    hangarOrbitRef.current.pitch = 0;
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-20 overflow-hidden">
      {/* Subtle cinematic edge scrims for UI legibility while keeping the 3D ship unobstructed */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-28 bg-gradient-to-b from-[#060912]/80 via-[#060912]/35 to-transparent"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none fixed inset-y-0 right-0 hidden w-[46vw] bg-gradient-to-l from-[#060912]/72 via-[#060912]/25 to-transparent lg:block"
        aria-hidden="true"
      />

      {/* Interactive 3D Orbit Drag Surface */}
      <div
        className="pointer-events-auto absolute inset-0 cursor-grab active:cursor-grabbing"
        onPointerDown={(event) => {
          drag.current = { active: true, x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current.active) return;
          const dx = event.clientX - drag.current.x;
          const dy = event.clientY - drag.current.y;
          drag.current = { active: true, x: event.clientX, y: event.clientY };
          hangarOrbitRef.current.yaw -= dx * 0.008;
          hangarOrbitRef.current.pitch = Math.max(
            -0.75,
            Math.min(0.75, hangarOrbitRef.current.pitch + dy * 0.006),
          );
        }}
        onPointerUp={() => {
          drag.current.active = false;
        }}
        onPointerCancel={() => {
          drag.current.active = false;
        }}
        aria-label="Drag open space to rotate the ship"
      />

      {/* Top Navigation & Credits Bar */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="pointer-events-none absolute inset-x-4 top-4 z-10 flex items-start justify-between gap-3 sm:inset-x-6 sm:top-5"
      >
        <div className="pointer-events-auto flex items-center gap-3.5">
          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={() => {
              AudioManager.playUiClick('secondary');
              onBack();
            }}
            className="group flex items-center gap-2 border border-slate-700/80 bg-[#131722]/90 px-3.5 py-2 text-xs font-medium text-slate-200 backdrop-blur-md transition-colors hover:border-[#38bdf8]/70 hover:text-[#38bdf8] focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-150 group-hover:-translate-x-0.5" />
            <span>Main Menu</span>
          </button>

          <div className="border-l border-slate-700/80 pl-3.5">
            <div className="font-mono text-[10px] tracking-[0.24em] text-[#38bdf8]/90">
              BAY 04 · SPACECRAFT SHOWROOM
            </div>
            <h1 className="font-display text-lg font-bold tracking-wider text-slate-50 sm:text-xl">
              Starfighter Hangar
            </h1>
          </div>
        </div>

        {/* Dedicated Credits Balance Readout */}
        <motion.div
          animate={
            purchasePulse
              ? {
                  borderColor: ['rgba(56,189,248,0.45)', 'rgba(52,211,153,0.9)', 'rgba(56,189,248,0.45)'],
                  scale: [1, 1.03, 1],
                }
              : {}
          }
          transition={{ duration: 0.45 }}
          className="pointer-events-auto relative flex items-center gap-3 border border-[#38bdf8]/35 bg-[#131722]/92 px-3.5 py-2 shadow-lg backdrop-blur-md sm:px-4"
        >
          <div className="flex h-7 w-7 items-center justify-center border border-[#38bdf8]/30 bg-[#38bdf8]/10 text-[#38bdf8]">
            <Coins className="h-3.5 w-3.5" />
          </div>
          <div className="leading-none">
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-slate-400">
              Available Credits
            </div>
            <div className="mt-1 flex items-baseline gap-1.5 font-mono text-sm font-semibold tabular-nums text-slate-50 sm:text-base">
              <span>{credits.toLocaleString()}</span>
              <span className="text-[11px] font-medium text-[#38bdf8]">CR</span>
            </div>
          </div>

          <AnimatePresence>
            {creditDelta !== null && (
              <motion.span
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className={`absolute -bottom-5 right-1 font-mono text-[11px] font-semibold tabular-nums ${
                  creditDelta < 0 ? 'text-emerald-300' : 'text-[#38bdf8]'
                }`}
              >
                {creditDelta > 0 ? `+${creditDelta.toLocaleString()}` : creditDelta.toLocaleString()} CR
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.header>

      {/* Bottom-Left 3D Showcase HUD Anchor & Orbit Controls (Desktop) */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
        className="pointer-events-none absolute bottom-5 left-6 z-10 hidden items-end gap-3 lg:flex"
      >
        <div className="border-l-2 border-[#38bdf8] bg-[#131722]/75 px-3.5 py-2 backdrop-blur-sm">
          <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-slate-400">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isShipOwned ? 'bg-[#38bdf8]' : 'bg-amber-400'
              }`}
            />
            <span>{isShipOwned ? 'ACTIVE BAY FRAME' : 'LOCKED PROTOTYPE'}</span>
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="font-display text-sm font-bold tracking-wider text-slate-100">
              {ship.callsign}
            </span>
            <span className="font-mono text-[11px] text-[#38bdf8]/90">{previewSkin.name}</span>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2 border border-slate-700/70 bg-[#131722]/80 px-3 py-1.5 text-[11px] text-slate-400 backdrop-blur-sm">
          <Move className="h-3 w-3 text-[#38bdf8]" />
          <span>Drag space to orbit</span>
          <span className="text-slate-700" aria-hidden="true">|</span>
          <button
            type="button"
            onMouseEnter={() => AudioManager.playUiHover()}
            onClick={handleResetView}
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-slate-300 transition-colors hover:text-[#38bdf8] focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset</span>
          </button>
        </div>
      </motion.div>

      {/* Right-Side Spacecraft Management Inspector */}
      <motion.section
        initial={{ opacity: 0, x: 18 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        aria-label="Spacecraft configuration and acquisition"
        className="hangar-scroll pointer-events-auto absolute bottom-4 right-4 top-[5.25rem] z-10 flex w-[min(27.5rem,37vw)] flex-col gap-4 overflow-y-auto border border-slate-700/70 bg-[#131722]/90 p-4 shadow-[0_24px_64px_rgba(3,7,18,0.82)] backdrop-blur-md sm:bottom-5 sm:right-6 sm:top-[5.5rem] sm:p-5 max-lg:bottom-3 max-lg:left-3 max-lg:right-3 max-lg:top-auto max-lg:max-h-[48vh] max-lg:w-auto"
      >
        {/* Top Electric Cyber Blue Hairline Accent */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#38bdf8]/80 to-transparent"
          aria-hidden="true"
        />

        {/* 1. Fleet Ship Selector */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
              Fleet Hangar
            </span>
            <span className="font-mono text-[10px] text-slate-500">
              {collection.ownedShipIds.length}/{SHIP_CATALOG.length} ACQUIRED
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {SHIP_CATALOG.map((item) => {
              const candidate = SHIP_CONFIGS[item.id];
              const owned = collection.ownedShipIds.includes(item.id);
              const isSelected = item.id === selectedShipId;
              const isEquipped = collection.selectedShipId === item.id && owned;
              const affordable = credits >= item.price;

              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => AudioManager.playUiHover()}
                  onClick={() => {
                    AudioManager.playUiClick('secondary');
                    onSelectShip(item.id);
                  }}
                  aria-pressed={isSelected}
                  className={`group relative min-w-0 overflow-hidden border px-2.5 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[#38bdf8] ${
                    isSelected
                      ? 'border-[#38bdf8] bg-[#17243b]/95 text-slate-50'
                      : owned
                        ? 'border-slate-700/80 bg-[#0d121d]/90 text-slate-200 hover:border-slate-500 hover:bg-[#151d2e]'
                        : 'border-slate-800/90 bg-[#0a0e17]/85 text-slate-400 hover:border-slate-600/80 hover:text-slate-200'
                  }`}
                >
                  {isSelected && (
                    <motion.div
                      layoutId="hangar-ship-indicator"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-[#38bdf8]"
                    />
                  )}

                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate font-display text-xs font-bold tracking-wide">
                      {item.name}
                    </span>
                    {!owned && (
                      <Lock
                        className={`h-3 w-3 shrink-0 ${
                          isSelected
                            ? 'text-[#38bdf8]'
                            : affordable
                              ? 'text-slate-400'
                              : 'text-slate-600'
                        }`}
                      />
                    )}
                  </div>

                  <span className="mt-0.5 block truncate text-[10px] text-slate-400">
                    {candidate.name}
                  </span>

                  <div className="mt-2 flex items-center gap-1.5 font-mono text-[10px]">
                    {owned ? (
                      <>
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            isEquipped ? 'bg-[#38bdf8]' : 'bg-emerald-400'
                          }`}
                        />
                        <span
                          className={`truncate uppercase tracking-wider ${
                            isEquipped ? 'text-[#38bdf8]' : 'text-emerald-300/90'
                          }`}
                        >
                          {isEquipped ? 'Active' : 'Owned'}
                        </span>
                      </>
                    ) : (
                      <span
                        className={`truncate font-semibold tabular-nums ${
                          affordable ? 'text-[#38bdf8]' : 'text-amber-300/80'
                        }`}
                      >
                        {item.price.toLocaleString()} CR
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Selected Ship Dossier & Performance Specs */}
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedShipId}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-3.5"
          >
            <div className="border-t border-slate-800/90 pt-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-xl font-bold tracking-wide text-slate-50">
                      {shipItem.name}
                    </h2>
                    <span className="border border-slate-700/80 bg-[#0c111c] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-300">
                      {ship.name}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-[#38bdf8]/90">{ship.role}</p>
                </div>

                <span
                  className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider ${
                    isShipOwned
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : isShipAffordable
                        ? 'border-[#38bdf8]/45 bg-[#38bdf8]/10 text-[#38bdf8]'
                        : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  }`}
                >
                  {isShipOwned ? (
                    <>
                      <Check className="h-3 w-3" />
                      <span>Flight Ready</span>
                    </>
                  ) : (
                    <>
                      <Lock className="h-2.5 w-2.5" />
                      <span>{shipItem.price.toLocaleString()} CR</span>
                    </>
                  )}
                </span>
              </div>

              <p className="mt-2 text-xs leading-relaxed text-slate-300">{ship.description}</p>

              {/* Compact Technical Telemetry Strip */}
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                <div className="border border-slate-800/90 bg-[#0b101b]/90 px-2.5 py-1.5">
                  <div className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-slate-500">
                    <Gauge className="h-2.5 w-2.5 text-[#38bdf8]" />
                    <span>Top Speed</span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-slate-100">
                    {ship.flight.maxSpeed} <span className="text-[10px] font-normal text-slate-400">m/s</span>
                  </div>
                </div>

                <div className="border border-slate-800/90 bg-[#0b101b]/90 px-2.5 py-1.5">
                  <div className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-slate-500">
                    <Shield className="h-2.5 w-2.5 text-[#38bdf8]" />
                    <span>Hull / Shield</span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-slate-100">
                    {ship.maxHull} <span className="text-slate-500">/</span> {ship.maxShield}
                  </div>
                </div>

                <div className="border border-slate-800/90 bg-[#0b101b]/90 px-2.5 py-1.5">
                  <div className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-slate-500">
                    <Crosshair className="h-2.5 w-2.5 text-[#38bdf8]" />
                    <span>Armament</span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] font-medium text-slate-200" title={ship.weapons.primaryName}>
                    {ship.weapons.primaryName}
                  </div>
                </div>
              </div>
            </div>

            {/* Performance Ratings */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-y border-slate-800/80 py-3">
              <StatBar label="Speed" value={ship.ratings.speed} />
              <StatBar label="Maneuverability" value={ship.ratings.maneuverability} />
              <StatBar label="Hull Integrity" value={ship.ratings.hull} />
              <StatBar label="Firepower" value={ship.ratings.firepower} />
            </div>

            {/* 3. Hull Livery / Paint Schemes */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Hull Livery
                </span>
                <span className="font-mono text-[10px] text-slate-400">
                  {isPreviewSkinEquipped ? (
                    <span className="text-[#38bdf8]">EQUIPPED</span>
                  ) : isPreviewSkinOwned ? (
                    <span className="text-emerald-300">OWNED</span>
                  ) : (
                    <span className="text-amber-300">PREVIEWING</span>
                  )}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {skins.map((skin) => {
                  const owned = collection.ownedSkinIds.includes(skin.id);
                  const equipped = equippedSkinId === skin.id && owned;
                  const inspecting = previewSkin.id === skin.id;
                  const achLocked =
                    Boolean(skin.achievementRequirement) &&
                    !unlockedAchievements.includes(skin.achievementRequirement!);
                  const resolvedColors = getShipConfigWithSkin(selectedShipId, skin.id).colors;

                  return (
                    <button
                      key={skin.id}
                      type="button"
                      onMouseEnter={() => AudioManager.playUiHover()}
                      onClick={() => {
                        AudioManager.playUiClick('secondary');
                        onPreviewSkin(skin.id);
                        if (owned) onSelectSkin(selectedShipId, skin.id);
                      }}
                      aria-pressed={inspecting}
                      className={`group relative flex flex-col gap-1.5 overflow-hidden border p-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[#38bdf8] ${
                        inspecting
                          ? owned
                            ? 'border-[#38bdf8] bg-[#162339]/95 text-slate-50'
                            : 'border-amber-400/75 bg-[#1b1f2c]/95 text-slate-50'
                          : owned
                            ? 'border-slate-700/80 bg-[#0d121d]/90 text-slate-200 hover:border-slate-500'
                            : 'border-slate-800/90 bg-[#0a0e17]/85 text-slate-400 hover:border-slate-600/80 hover:text-slate-200'
                      }`}
                    >
                      {/* Multi-tone livery color swatch */}
                      <div className="flex items-center justify-between gap-2">
                        <div
                          className="flex h-3.5 w-14 overflow-hidden border border-white/15"
                          aria-hidden="true"
                        >
                          <span
                            className="h-full flex-1"
                            style={{ backgroundColor: resolvedColors.hullPrimary }}
                          />
                          <span
                            className="h-full w-3.5"
                            style={{ backgroundColor: resolvedColors.hullSecondary }}
                          />
                          <span
                            className="h-full w-2.5"
                            style={{ backgroundColor: resolvedColors.hullTrim }}
                          />
                          <span
                            className="h-full w-2"
                            style={{ backgroundColor: resolvedColors.engineGlow }}
                          />
                        </div>

                        {equipped ? (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#38bdf8]/20 text-[#38bdf8]">
                            <Check className="h-2.5 w-2.5" />
                          </span>
                        ) : achLocked ? (
                          <Trophy className="h-3 w-3 text-amber-400/90" />
                        ) : !owned ? (
                          <Lock className="h-3 w-3 text-slate-500" />
                        ) : null}
                      </div>

                      <div className="min-w-0">
                        <span className="block truncate text-xs font-medium text-slate-100">
                          {skin.name}
                        </span>
                        <span
                          className={`mt-0.5 block truncate font-mono text-[10px] ${
                            equipped
                              ? 'text-[#38bdf8]'
                              : owned
                                ? 'text-emerald-300/90'
                                : achLocked
                                  ? 'text-amber-300/90'
                                  : credits >= skin.price && isShipOwned
                                    ? 'text-[#38bdf8]/90'
                                    : 'text-slate-400'
                          }`}
                        >
                          {equipped
                            ? 'Equipped'
                            : owned
                              ? 'Owned'
                              : achLocked
                                ? getAchievementName(skin.achievementRequirement)
                                : `${skin.price.toLocaleString()} CR`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <p className="mt-2 text-[11px] leading-snug text-slate-400">
                <span className="font-medium text-slate-200">{previewSkin.name}:</span>{' '}
                {previewSkin.description}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Purchase / Status Notice Banner */}
        <AnimatePresence mode="wait">
          {notice && (
            <motion.div
              key={notice}
              role="status"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className={`flex items-center gap-2 border px-3 py-2 text-xs ${
                isSuccessNotice
                  ? 'border-emerald-400/45 bg-emerald-500/12 text-emerald-200'
                  : 'border-amber-400/45 bg-amber-500/12 text-amber-200'
              }`}
            >
              {isSuccessNotice ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              )}
              <span>{notice}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 4. Action Footer: Launch / Ship Purchase + Skin Purchase */}
        <div className="mt-auto flex flex-col gap-2 border-t border-slate-800/90 pt-3.5">
          {isShipOwned ? (
            <button
              type="button"
              onMouseEnter={() => AudioManager.playUiHover()}
              onClick={() => {
                AudioManager.playUiClick('primary');
                onLaunchFlight();
              }}
              className="group flex w-full items-center justify-center gap-2 bg-[#38bdf8] px-4 py-2.5 text-sm font-semibold tracking-wide text-[#08101c] transition-colors hover:bg-[#7dd3fc] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#38bdf8]"
            >
              <Play className="h-4 w-4 fill-current transition-transform duration-150 group-hover:translate-x-0.5" />
              <span>Launch Campaign</span>
            </button>
          ) : (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                disabled={!isShipAffordable}
                onMouseEnter={() => {
                  if (isShipAffordable) AudioManager.playUiHover();
                }}
                onClick={() => {
                  AudioManager.playUiClick('primary');
                  onPurchase('ship', selectedShipId);
                }}
                className={`flex w-full items-center justify-center gap-2 border px-4 py-2.5 text-sm font-semibold tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-[#38bdf8] ${
                  isShipAffordable
                    ? 'border-[#38bdf8] bg-[#38bdf8]/15 text-[#e0f2fe] hover:bg-[#38bdf8] hover:text-[#08101c]'
                    : 'cursor-not-allowed border-slate-700/80 bg-[#0c111c]/80 text-slate-500'
                }`}
              >
                <ShoppingCart className="h-4 w-4" />
                <span>
                  Purchase {shipItem.name} · {shipItem.price.toLocaleString()} CR
                </span>
              </button>
              {!isShipAffordable && (
                <div className="flex items-center justify-center gap-1.5 font-mono text-[10px] text-amber-300/85">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span>Need {shipShortfall.toLocaleString()} more CR to acquire</span>
                </div>
              )}
            </div>
          )}

          {/* Secondary Skin Status / Acquisition Action */}
          {isPreviewSkinOwned ? (
            <div className="flex items-center justify-center gap-1.5 border border-emerald-500/25 bg-emerald-500/8 px-3 py-2 text-[11px] text-emerald-300">
              <Check className="h-3.5 w-3.5" />
              <span>
                {isPreviewSkinEquipped
                  ? `Equipped livery: ${previewSkin.name}`
                  : `Owned livery: ${previewSkin.name}`}
              </span>
            </div>
          ) : isPreviewSkinAchievementLocked ? (
            <div className="flex items-center justify-center gap-2 border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs text-amber-200/90">
              <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span>
                Requires achievement: <strong>{getAchievementName(previewSkin.achievementRequirement)}</strong>
              </span>
            </div>
          ) : !isShipOwned ? (
            <div className="flex items-center justify-center gap-1.5 border border-slate-800 bg-[#0b101b]/70 px-3 py-2 text-[11px] text-slate-400">
              <Lock className="h-3 w-3 shrink-0 text-slate-500" />
              <span>Acquire {shipItem.name} to purchase this livery</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                disabled={!isPreviewSkinAffordable}
                onMouseEnter={() => {
                  if (isPreviewSkinAffordable) AudioManager.playUiHover();
                }}
                onClick={() => {
                  AudioManager.playUiClick('secondary');
                  onPurchase('skin', previewSkin.id);
                }}
                className={`flex w-full items-center justify-center gap-2 border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[#38bdf8] ${
                  isPreviewSkinAffordable
                    ? 'border-[#38bdf8]/60 bg-[#38bdf8]/10 text-[#bae6fd] hover:border-[#38bdf8] hover:bg-[#38bdf8]/20'
                    : 'cursor-not-allowed border-slate-800 bg-[#0b101b]/80 text-slate-500'
                }`}
              >
                <ShoppingCart className="h-3.5 w-3.5" />
                <span>
                  Purchase {previewSkin.name} · {previewSkin.price.toLocaleString()} CR
                </span>
              </button>
              {!isPreviewSkinAffordable && (
                <div className="text-center font-mono text-[10px] text-amber-300/80">
                  Need {skinShortfall.toLocaleString()} more CR for this livery
                </div>
              )}
            </div>
          )}
        </div>
      </motion.section>
    </div>
  );
}
