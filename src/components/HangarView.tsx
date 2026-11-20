import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Coins,
  Lock,
  Play,
  RotateCcw,
  ShoppingCart,
  Trophy,
} from 'lucide-react';
import { AudioManager } from '../audio/AudioManager';
import { getShipConfigWithSkin, SHIP_CATALOG, SKIN_CATALOG } from '../config/collection';
import { SHIP_CONFIGS } from '../config/ships';
import { ACHIEVEMENTS } from '../engine/mission/CampaignRewards';
import type { ShipId } from '../types/game';
import type { CampaignSaveData } from '../types/mission';
import { ObsidianCorners, ObsidianEnergySpine, TECH_EASE } from './ui/ObsidianUI';

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

function getShortCode(name: string): string {
  return name.split(' ')[0] ?? name;
}

function MicroGauge({ code, label, value }: { code: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="w-8 shrink-0 font-mono text-[10px] tracking-[0.16em] text-slate-500"
        title={label}
      >
        {code}
      </span>
      <div className="relative h-[3px] flex-1 overflow-hidden bg-slate-800/80">
        <motion.div
          className="h-full bg-gradient-to-r from-[#0284c7] via-[#38bdf8] to-[#bae6fd] shadow-[0_0_8px_rgba(56,189,248,0.5)]"
          initial={false}
          animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
          transition={{ duration: 0.32, ease: TECH_EASE }}
        />
      </div>
      <span className="w-6 shrink-0 text-right font-mono text-[11px] font-medium tabular-nums text-slate-200">
        {value}
      </span>
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

  useEffect(() => {
    const diff = credits - prevCreditsRef.current;
    if (diff !== 0) {
      prevCreditsRef.current = credits;
      setCreditDelta(diff);
      if (diff < 0) setPurchasePulse(true);
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
      {/* Unobstructed Full-Viewport 3D Orbit Drag Surface */}
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

      {/* Singular Right-Only Polished Obsidian Monolith (ship dominates the left ~68% of screen) */}
      <motion.aside
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, ease: TECH_EASE }}
        aria-label="Hangar spacecraft controls"
        className="obsidian-monolith hangar-scroll pointer-events-auto fixed bottom-5 right-5 top-5 z-10 flex w-[min(23.5rem,31.5vw)] min-w-[19.5rem] flex-col overflow-y-auto sm:bottom-6 sm:right-6 sm:top-6 max-lg:bottom-3 max-lg:left-3 max-lg:right-3 max-lg:top-auto max-lg:max-h-[46vh] max-lg:w-auto max-lg:min-w-0"
      >
        <ObsidianEnergySpine orientation="vertical" side="left" />
        <ObsidianCorners />

        {/* 1. Minimal Top Utility Bar: Menu · Reset · Credits */}
        <header className="flex items-center justify-between border-b border-white/8 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onMouseEnter={() => AudioManager.playUiHover()}
              onClick={() => {
                AudioManager.playUiClick('secondary');
                onBack();
              }}
              className="group flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-slate-300 transition-colors hover:text-[#38bdf8] focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-[#38bdf8] transition-transform duration-150 group-hover:-translate-x-0.5" />
              <span>Menu</span>
            </button>

            <span className="h-3 w-px bg-white/10" aria-hidden="true" />

            <button
              type="button"
              onMouseEnter={() => AudioManager.playUiHover()}
              onClick={handleResetView}
              title="Reset camera angle"
              className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500 transition-colors hover:text-[#38bdf8] focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
            >
              <RotateCcw className="h-3 w-3" />
              <span className="sr-only sm:not-sr-only">Reset</span>
            </button>
          </div>

          <motion.div
            animate={purchasePulse ? { scale: [1, 1.06, 1] } : {}}
            transition={{ duration: 0.35, ease: TECH_EASE }}
            className="relative flex items-center gap-1.5 font-mono"
          >
            <Coins className="h-3.5 w-3.5 text-[#38bdf8]" />
            <span className="text-sm font-semibold tabular-nums text-slate-50">
              {credits.toLocaleString()}
            </span>
            <span className="text-[10px] tracking-wider text-[#38bdf8]">CR</span>

            <AnimatePresence>
              {creditDelta !== null && (
                <motion.span
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2, ease: TECH_EASE }}
                  className={`absolute -bottom-5 right-0 font-mono text-[10px] font-semibold tabular-nums ${
                    creditDelta < 0 ? 'text-emerald-300' : 'text-[#38bdf8]'
                  }`}
                >
                  {creditDelta > 0 ? `+${creditDelta.toLocaleString()}` : creditDelta.toLocaleString()} CR
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
        </header>

        {/* 2. Sleek Horizontal Ship Index Strip */}
        <nav aria-label="Select spacecraft" className="grid grid-cols-3 border-b border-white/8">
          {SHIP_CATALOG.map((item, idx) => {
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
                className={`relative flex flex-col items-start px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[#38bdf8] ${
                  idx > 0 ? 'border-l border-white/6' : ''
                } ${
                  isSelected
                    ? 'bg-[#38bdf8]/[0.07] text-slate-50'
                    : 'text-slate-400 hover:bg-white/[0.02] hover:text-slate-200'
                }`}
              >
                {isSelected && (
                  <motion.div
                    layoutId="hangar-ship-beam"
                    transition={{ duration: 0.22, ease: TECH_EASE }}
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-[#38bdf8] shadow-[0_0_12px_#38bdf8]"
                  />
                )}

                <div className="flex w-full items-center justify-between">
                  <span className="font-mono text-[9px] tracking-[0.2em] text-slate-500">
                    0{idx + 1}
                  </span>
                  {owned ? (
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        isEquipped ? 'bg-[#38bdf8] shadow-[0_0_6px_#38bdf8]' : 'bg-emerald-400'
                      }`}
                    />
                  ) : (
                    <Lock className="h-2.5 w-2.5 text-slate-500" />
                  )}
                </div>

                <span className="mt-1 font-display text-sm font-bold tracking-wider">
                  {getShortCode(item.name)}
                </span>

                <span
                  className={`mt-0.5 font-mono text-[10px] tabular-nums ${
                    owned
                      ? isEquipped
                        ? 'text-[#38bdf8]'
                        : 'text-emerald-300/80'
                      : affordable
                        ? 'text-[#38bdf8]/90'
                        : 'text-slate-500'
                  }`}
                >
                  {owned ? (isEquipped ? 'ACTIVE' : 'OWNED') : `${item.price.toLocaleString()} CR`}
                </span>
              </button>
            );
          })}
        </nav>

        {/* 3. Hero Spacecraft Readout & Compact Specs */}
        <div className="flex flex-1 flex-col justify-between gap-5 px-5 py-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedShipId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.2, ease: TECH_EASE }}
              className="flex flex-col gap-5"
            >
              {/* Hero Name + Essential Status */}
              <div className="obsidian-scan relative overflow-hidden">
                <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.22em]">
                  <span className="text-[#38bdf8]">{ship.name}</span>
                  <span
                    className={
                      isShipOwned
                        ? 'text-emerald-300'
                        : isShipAffordable
                          ? 'text-[#38bdf8]'
                          : 'text-amber-300'
                    }
                  >
                    {isShipOwned ? 'OWNED' : `${shipItem.price.toLocaleString()} CR`}
                  </span>
                </div>

                <h1 className="mt-1 font-display text-3xl font-bold tracking-[0.06em] text-slate-50">
                  {shipItem.name}
                </h1>

                {/* Compact Technical Telemetry Line */}
                <div className="mt-3 flex items-center gap-3 border-y border-white/8 py-2 font-mono text-[11px] tabular-nums text-slate-300">
                  <span>
                    <strong className="font-semibold text-slate-100">{ship.flight.maxSpeed}</strong>{' '}
                    <span className="text-[9px] text-slate-500">M/S</span>
                  </span>
                  <span className="text-slate-700">/</span>
                  <span>
                    <strong className="font-semibold text-slate-100">{ship.maxHull}</strong>{' '}
                    <span className="text-[9px] text-slate-500">HULL</span>
                  </span>
                  <span className="text-slate-700">/</span>
                  <span>
                    <strong className="font-semibold text-slate-100">{ship.maxShield}</strong>{' '}
                    <span className="text-[9px] text-slate-500">SHD</span>
                  </span>
                </div>
              </div>

              {/* Minimal Precision Gauges (No Card Wrappers) */}
              <div className="flex flex-col gap-2.5">
                <MicroGauge code="SPD" label="Speed" value={ship.ratings.speed} />
                <MicroGauge code="MNV" label="Maneuverability" value={ship.ratings.maneuverability} />
                <MicroGauge code="HUL" label="Hull Integrity" value={ship.ratings.hull} />
                <MicroGauge code="FPR" label="Firepower" value={ship.ratings.firepower} />
              </div>

              {/* 4. Compact Livery / Skin Swatch Selector */}
              <div className="border-t border-white/8 pt-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
                    Livery
                  </span>
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={previewSkin.id}
                      initial={{ opacity: 0, x: 4 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -4 }}
                      transition={{ duration: 0.14, ease: TECH_EASE }}
                      className="truncate font-mono text-[11px] text-slate-200"
                    >
                      {previewSkin.name}
                    </motion.span>
                  </AnimatePresence>
                </div>

                <div className="mt-2.5 grid grid-cols-2 gap-2">
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
                        className={`obsidian-surface obsidian-surface-interactive flex items-center justify-between gap-2 px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-[#38bdf8] ${
                          inspecting
                            ? owned
                              ? 'obsidian-surface-active'
                              : 'obsidian-surface-preview'
                            : ''
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <div
                            className="flex h-3 w-8 shrink-0 overflow-hidden border border-white/15"
                            aria-hidden="true"
                          >
                            <span className="h-full flex-1" style={{ backgroundColor: resolvedColors.hullPrimary }} />
                            <span className="h-full w-2" style={{ backgroundColor: resolvedColors.hullTrim }} />
                            <span className="h-full w-1.5" style={{ backgroundColor: resolvedColors.engineGlow }} />
                          </div>
                          <span
                            className={`truncate font-mono text-[10px] tabular-nums ${
                              equipped
                                ? 'text-[#38bdf8]'
                                : owned
                                  ? 'text-emerald-300'
                                  : achLocked
                                    ? 'text-amber-300'
                                    : 'text-slate-300'
                            }`}
                          >
                            {equipped
                              ? 'EQUIPPED'
                              : owned
                                ? 'OWNED'
                                : achLocked
                                  ? 'LOCKED'
                                  : `${skin.price} CR`}
                          </span>
                        </div>

                        {equipped ? (
                          <Check className="h-3 w-3 shrink-0 text-[#38bdf8]" />
                        ) : achLocked ? (
                          <Trophy className="h-3 w-3 shrink-0 text-amber-400" />
                        ) : !owned ? (
                          <Lock className="h-3 w-3 shrink-0 text-slate-500" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* 5. Status Notice & Essential Action Controls */}
          <div className="flex flex-col gap-2.5 pt-2">
            <AnimatePresence mode="wait">
              {notice && (
                <motion.div
                  key={notice}
                  role="status"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: TECH_EASE }}
                  className={`flex items-center gap-2 border-l-2 bg-white/[0.03] px-3 py-1.5 font-mono text-[11px] ${
                    isSuccessNotice
                      ? 'border-emerald-400 text-emerald-200'
                      : 'border-amber-400 text-amber-200'
                  }`}
                >
                  {isSuccessNotice ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  )}
                  <span className="truncate">{notice}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Secondary Livery Purchase / Requirement (shown only when inspecting an unowned livery) */}
            {!isPreviewSkinOwned && (
              isPreviewSkinAchievementLocked ? (
                <div className="flex items-center justify-center gap-2 border border-amber-400/35 bg-[#070a12] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-amber-200">
                  <Trophy className="h-3 w-3 shrink-0 text-amber-400" />
                  <span>Unlock: {getAchievementName(previewSkin.achievementRequirement)}</span>
                </div>
              ) : !isShipOwned ? (
                <div className="flex items-center justify-center gap-1.5 border border-white/10 bg-[#070a12] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  <Lock className="h-3 w-3 shrink-0" />
                  <span>Acquire ship for livery</span>
                </div>
              ) : (
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
                  className={`obsidian-surface obsidian-surface-interactive flex w-full items-center justify-center gap-2 px-3 py-2 font-mono text-[11px] uppercase tracking-wider focus-visible:outline-2 focus-visible:outline-[#38bdf8] ${
                    isPreviewSkinAffordable
                      ? 'obsidian-scan border-[#38bdf8]/60 text-[#bae6fd]'
                      : 'cursor-not-allowed text-slate-500'
                  }`}
                >
                  <ShoppingCart className="h-3.5 w-3.5 text-[#38bdf8]" />
                  <span>
                    {isPreviewSkinAffordable
                      ? `Buy Livery · ${previewSkin.price.toLocaleString()} CR`
                      : `Need ${skinShortfall.toLocaleString()} CR`}
                  </span>
                </button>
              )
            )}

            {/* Primary Ship CTA: Launch or Acquire */}
            {isShipOwned ? (
              <button
                type="button"
                onMouseEnter={() => AudioManager.playUiHover()}
                onClick={() => {
                  AudioManager.playUiClick('primary');
                  onLaunchFlight();
                }}
                className="obsidian-cta-primary obsidian-scan group flex w-full items-center justify-center gap-2.5 px-4 py-3 font-display text-sm font-bold uppercase tracking-[0.2em] text-[#e0f2fe] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#38bdf8]"
              >
                <Play className="h-4 w-4 fill-[#38bdf8] text-[#38bdf8] transition-transform duration-150 group-hover:translate-x-0.5" />
                <span>Launch</span>
              </button>
            ) : (
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
                className={`flex w-full items-center justify-center gap-2 px-4 py-3 font-display text-sm font-bold uppercase tracking-[0.16em] focus-visible:outline-2 focus-visible:outline-[#38bdf8] ${
                  isShipAffordable
                    ? 'obsidian-cta-primary obsidian-scan text-[#e0f2fe]'
                    : 'obsidian-surface cursor-not-allowed border-amber-400/30 text-amber-200/70'
                }`}
              >
                {isShipAffordable ? (
                  <>
                    <ShoppingCart className="h-4 w-4 text-[#38bdf8]" />
                    <span>Acquire · {shipItem.price.toLocaleString()} CR</span>
                  </>
                ) : (
                  <>
                    <Lock className="h-3.5 w-3.5 text-amber-400/80" />
                    <span>Need {shipShortfall.toLocaleString()} CR</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </motion.aside>
    </div>
  );
}
