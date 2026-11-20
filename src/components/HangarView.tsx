import { useRef } from 'react';
import { ArrowLeft, Lock, Play, ShoppingCart, Check } from 'lucide-react';
import { AudioManager } from '../audio/AudioManager';
import { SHIP_CONFIGS } from '../config/ships';
import { SHIP_CATALOG, SKIN_CATALOG } from '../config/collection';
import type { ShipId } from '../types/game';
import type { CampaignSaveData } from '../types/mission';

interface HangarViewProps {
  selectedShipId: ShipId; onSelectShip: (id: ShipId) => void; onLaunchFlight: () => void; onBack: () => void;
  hangarOrbitRef: React.MutableRefObject<{ yaw: number; pitch: number }>;
  save: CampaignSaveData; notice: string; onSelectSkin: (shipId: ShipId, skinId: string) => void;
  onPreviewSkin: (skinId: string) => void; onPurchase: (kind: 'ship' | 'skin', id: string) => void;
}
function StatRow({ label, value }: { label: string; value: number }) {
  return <div><div className="flex items-center justify-between text-xs"><span className="text-slate-400">{label}</span><span className="font-mono text-slate-200">{value}</span></div><div className="mt-1 h-1.5 w-full bg-slate-800"><div className="h-full bg-cyan-400" style={{ width: `${value}%` }} /></div></div>;
}
export function HangarView({ selectedShipId, onSelectShip, onLaunchFlight, onBack, hangarOrbitRef, save, notice, onSelectSkin, onPreviewSkin, onPurchase }: HangarViewProps) {
  const ship = SHIP_CONFIGS[selectedShipId];
  const collection = save.collection!;
  const credits = save.rewards?.credits ?? 0;
  const skins = SKIN_CATALOG.filter((skin) => skin.shipId === selectedShipId);
  const selectedSkin = collection.selectedSkinByShip[selectedShipId] ?? `${selectedShipId}:default`;
  const drag = useRef({ active: false, x: 0, y: 0 });
  return <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-6 sm:p-8">
    <header className="flex items-center justify-between"><div className="pointer-events-auto flex items-center gap-4"><button type="button" onClick={() => { AudioManager.playUiClick('secondary'); onBack(); }} className="flex items-center gap-2 border border-slate-700 bg-[#050c1d]/85 px-4 py-2 text-xs text-slate-200"><ArrowLeft className="h-3.5 w-3.5"/>Main Menu</button><div><h1 className="font-display text-xl font-semibold tracking-wider text-slate-100">Starfighter Hangar</h1><p className="text-xs text-slate-400">Drag viewport to inspect · Credits: {credits}</p></div></div></header>
    <div className="pointer-events-auto my-2 flex-1 cursor-grab active:cursor-grabbing" onPointerDown={(e) => { drag.current = { active: true, x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={(e) => { if (!drag.current.active) return; const dx=e.clientX-drag.current.x, dy=e.clientY-drag.current.y; drag.current={active:true,x:e.clientX,y:e.clientY}; hangarOrbitRef.current.yaw-=dx*.008; hangarOrbitRef.current.pitch=Math.max(-.8,Math.min(.8,hangarOrbitRef.current.pitch+dy*.006)); }} onPointerUp={() => { drag.current.active=false; }} onPointerCancel={() => { drag.current.active=false; }} aria-label="Drag to rotate 3D spaceship" />
    <section className="pointer-events-auto mx-auto w-full max-w-5xl border border-slate-700/80 bg-[#050c1d]/95 p-5"><div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-center">
      <div className="flex flex-col gap-2 lg:col-span-3">{SHIP_CATALOG.map((item) => { const id=item.id; const candidate=SHIP_CONFIGS[id]; const owned=collection.ownedShipIds.includes(id); const active=id===selectedShipId; return <button key={id} type="button" onClick={() => { AudioManager.playUiClick('secondary'); onSelectShip(id); }} className={`flex items-center justify-between border px-3.5 py-2.5 text-left ${active?'border-cyan-400 bg-cyan-950/50 text-white':'border-slate-800 bg-[#081226] text-slate-300'}`}><div><div className="font-display text-sm font-semibold">{candidate.name}</div><div className="font-mono text-[11px] text-slate-400">{candidate.callsign}</div></div><span className="ml-2 text-[11px] text-cyan-300">{owned?'Owned':`${item.price} CR`}</span></button>; })}</div>
      <div className="lg:col-span-5"><div className="flex flex-wrap items-baseline gap-2"><h2 className="font-display text-2xl font-bold text-slate-100">{ship.name}</h2><span className="font-mono text-xs text-cyan-300">{ship.callsign}</span><span className="text-xs text-slate-400">{ship.role}</span></div><p className="mt-2 text-sm leading-relaxed text-slate-300">{ship.description}</p><div className="mt-3 flex flex-wrap gap-3 font-mono text-xs text-slate-400"><span>Max Speed {ship.flight.maxSpeed} m/s</span><span>Hull {ship.maxHull}</span><span>{ship.weapons.primaryName}</span><span>{ship.maxShield} Shield</span></div>
        <div className="mt-4 flex flex-wrap gap-2">{skins.map((skin) => { const owned=collection.ownedSkinIds.includes(skin.id); const selected=selectedSkin===skin.id; return <button key={skin.id} type="button" onClick={() => { onPreviewSkin(skin.id); if(owned) onSelectSkin(selectedShipId,skin.id); }} className={`border px-2.5 py-2 text-left text-xs ${selected?'border-cyan-400 text-cyan-100':'border-slate-700 text-slate-300'}`}><span className="block">{skin.name}</span><span className="text-slate-400">{owned?(selected?'Selected':'Owned'):`${skin.price} CR`}</span></button>; })}</div><p className="mt-2 text-xs text-slate-400">{skins.find((s)=>s.id===selectedSkin)?.description}</p>{notice&&<p role="status" className="mt-2 text-xs text-amber-200">{notice}</p>}</div>
      <div className="flex flex-col justify-between gap-4 lg:col-span-4"><div className="grid grid-cols-2 gap-3"><StatRow label="Speed" value={ship.ratings.speed}/><StatRow label="Maneuverability" value={ship.ratings.maneuverability}/><StatRow label="Hull Integrity" value={ship.ratings.hull}/><StatRow label="Firepower" value={ship.ratings.firepower}/></div>
        {collection.ownedShipIds.includes(selectedShipId)?<button type="button" onClick={() => { AudioManager.playUiClick('primary'); onLaunchFlight(); }} className="flex w-full items-center justify-center gap-2 bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950"><Play className="h-4 w-4 fill-current"/>Launch Campaign</button>:<button type="button" disabled={credits<SHIP_CATALOG.find((x)=>x.id===selectedShipId)!.price} onClick={()=>onPurchase('ship',selectedShipId)} className="flex w-full items-center justify-center gap-2 border border-cyan-500/60 px-4 py-2.5 text-sm text-cyan-100 disabled:opacity-40"><ShoppingCart className="h-4 w-4"/>Purchase Ship · {SHIP_CATALOG.find((x)=>x.id===selectedShipId)!.price} CR</button>}
        {(()=>{const skin=skins.find((x)=>x.id===selectedSkin)!;const owned=collection.ownedSkinIds.includes(skin.id);const hasShip=collection.ownedShipIds.includes(selectedShipId);return owned?<div className="flex items-center justify-center gap-1 text-xs text-emerald-300"><Check className="h-3 w-3"/>Owned skin selected</div>:<button type="button" disabled={!hasShip||credits<skin.price} onClick={()=>onPurchase('skin',skin.id)} className="border border-slate-700 px-3 py-2 text-xs text-slate-200 disabled:opacity-40">{hasShip?`Purchase Skin · ${skin.price} CR`:'Acquire ship to buy skin'}</button>;})()}
      </div>
    </div><div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500"><Lock className="h-3 w-3"/>Ship specs are configured for campaign flight.</div></section>
  </div>;
}
