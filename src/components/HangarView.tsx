import { useRef } from 'react';
import { ArrowLeft, Check, Play, ShoppingCart } from 'lucide-react';
import { AudioManager } from '../audio/AudioManager';
import { SHIP_CONFIGS } from '../config/ships';
import { SHIP_CATALOG, SKIN_CATALOG } from '../config/collection';
import type { ShipId } from '../types/game';
import type { CampaignSaveData } from '../types/mission';

interface HangarViewProps {
  selectedShipId: ShipId;
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

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono text-slate-200">{value}</span>
      </div>
      <div className="mt-1 h-1.5 w-full bg-slate-800">
        <div className="h-full bg-cyan-400" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function HangarView({
  selectedShipId,
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
  const shipItem = SHIP_CATALOG.find((item) => item.id === selectedShipId)!;
  const skins = SKIN_CATALOG.filter((skin) => skin.shipId === selectedShipId);
  const selectedSkin = collection.selectedSkinByShip[selectedShipId] ?? `${selectedShipId}:default`;
  const previewSkin = skins.find((skin) => skin.id === selectedSkin) ?? skins[0];
  const drag = useRef({ active: false, x: 0, y: 0 });

  return (
    <div className="pointer-events-none fixed inset-0 z-20">
      <header className="pointer-events-auto absolute left-4 top-4 z-10 flex items-center gap-3 sm:left-6 sm:top-6">
        <button
          type="button"
          onClick={() => { AudioManager.playUiClick('secondary'); onBack(); }}
          className="flex items-center gap-2 border border-slate-700 bg-[#050c1d]/90 px-3 py-2 text-xs text-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Main Menu
        </button>
        <div className="border-l border-slate-600 pl-3">
          <h1 className="font-display text-lg font-semibold tracking-wider text-slate-100">Starfighter Hangar</h1>
          <p className="text-xs text-slate-400">Credits: {credits} · Drag open space to rotate</p>
        </div>
      </header>

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
          hangarOrbitRef.current.pitch = Math.max(-0.8, Math.min(0.8, hangarOrbitRef.current.pitch + dy * 0.006));
        }}
        onPointerUp={() => { drag.current.active = false; }}
        onPointerCancel={() => { drag.current.active = false; }}
        aria-label="Drag open space to rotate the ship"
      />

      <section className="pointer-events-auto absolute bottom-3 right-3 top-[5.5rem] z-10 flex w-[min(29rem,38vw)] flex-col gap-3 overflow-y-auto border border-slate-700/80 bg-[#050c1d]/95 p-4 shadow-2xl sm:bottom-5 sm:right-5 sm:top-20 sm:p-5 max-lg:bottom-3 max-lg:left-3 max-lg:right-3 max-lg:top-auto max-lg:max-h-[47vh] max-lg:w-auto">
        <div className="grid grid-cols-3 gap-2">
          {SHIP_CATALOG.map((item) => {
            const candidate = SHIP_CONFIGS[item.id];
            const owned = collection.ownedShipIds.includes(item.id);
            const active = item.id === selectedShipId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => { AudioManager.playUiClick('secondary'); onSelectShip(item.id); }}
                className={`min-w-0 border p-2 text-left ${active ? 'border-cyan-400 bg-cyan-950/50 text-white' : 'border-slate-800 bg-[#081226] text-slate-300'}`}
              >
                <span className="block truncate font-display text-xs font-semibold">{candidate.name}</span>
                <span className="mt-1 block truncate font-mono text-[10px] text-slate-400">{owned ? 'Owned' : `${item.price} CR`}</span>
              </button>
            );
          })}
        </div>

        <div className="min-h-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="font-display text-xl font-bold text-slate-100">{ship.name}</h2>
            <span className="font-mono text-[11px] text-cyan-300">{ship.callsign}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">{ship.description}</p>
          <p className="mt-2 text-[11px] text-slate-400">{ship.role} · {ship.flight.maxSpeed} m/s · {ship.maxHull} hull · {ship.maxShield} shield</p>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <StatRow label="Speed" value={ship.ratings.speed} />
          <StatRow label="Maneuverability" value={ship.ratings.maneuverability} />
          <StatRow label="Hull Integrity" value={ship.ratings.hull} />
          <StatRow label="Firepower" value={ship.ratings.firepower} />
        </div>

        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Paint schemes</div>
          <div className="flex flex-wrap gap-1.5">
            {skins.map((skin) => {
              const owned = collection.ownedSkinIds.includes(skin.id);
              const selected = selectedSkin === skin.id;
              return (
                <button
                  key={skin.id}
                  type="button"
                  onClick={() => { onPreviewSkin(skin.id); if (owned) onSelectSkin(selectedShipId, skin.id); }}
                  className={`border px-2 py-1.5 text-left text-[11px] ${selected ? 'border-cyan-400 text-cyan-100' : 'border-slate-700 text-slate-300'}`}
                >
                  <span className="block">{skin.name}</span>
                  <span className="text-[10px] text-slate-400">{owned ? (selected ? 'Selected' : 'Owned') : skin.achievementRequirement && !save.rewards?.unlockedAchievementIds.includes(skin.achievementRequirement) ? 'Achievement locked' : `${skin.price} CR`}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[10px] text-slate-400">{previewSkin.description}</p>
        </div>

        {notice && <p role="status" className="text-xs text-amber-200">{notice}</p>}

        {collection.ownedShipIds.includes(selectedShipId) ? (
          <button
            type="button"
            onClick={() => { AudioManager.playUiClick('primary'); onLaunchFlight(); }}
            className="flex w-full items-center justify-center gap-2 bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950"
          >
            <Play className="h-4 w-4 fill-current" /> Launch Campaign
          </button>
        ) : (
          <button
            type="button"
            disabled={credits < shipItem.price}
            onClick={() => onPurchase('ship', selectedShipId)}
            className="flex w-full items-center justify-center gap-2 border border-cyan-500/60 px-3 py-2.5 text-sm text-cyan-100 disabled:opacity-40"
          >
            <ShoppingCart className="h-4 w-4" /> Purchase Ship · {shipItem.price} CR
          </button>
        )}

        {(() => {
          const owned = collection.ownedSkinIds.includes(previewSkin.id);
          const hasShip = collection.ownedShipIds.includes(selectedShipId);
          const achievementLocked = !!previewSkin.achievementRequirement && !save.rewards?.unlockedAchievementIds.includes(previewSkin.achievementRequirement);
          return owned ? (
            <div className="flex items-center justify-center gap-1 text-[11px] text-emerald-300"><Check className="h-3 w-3" /> Owned skin selected</div>
          ) : (
            <button
              type="button"
              disabled={!hasShip || credits < previewSkin.price || achievementLocked}
              onClick={() => onPurchase('skin', previewSkin.id)}
              className="border border-slate-700 px-3 py-2 text-xs text-slate-200 disabled:opacity-40"
            >
              {achievementLocked ? `Unlock ${previewSkin.achievementRequirement?.replace('achievement:', '')}` : hasShip ? `Purchase Skin · ${previewSkin.price} CR` : 'Acquire ship to buy skin'}
            </button>
          );
        })()}
      </section>
    </div>
  );
}
