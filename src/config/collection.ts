import { SHIP_CONFIGS, SHIP_ORDER } from './ships';
import type { ShipId } from '../types/game';
import type { CampaignCollectionState, CampaignSaveData } from '../types/mission';

export interface ShipCatalogItem {
  id: ShipId; name: string; description: string; price: number; unlockRequirement: string; achievementRequirement?: string;
}
export interface SkinCatalogItem {
  id: string; name: string; description: string; price: number; shipId: ShipId;
  colors: Partial<typeof SHIP_CONFIGS.interceptor.colors>;
  achievementRequirement?: string;
}

export const SHIP_CATALOG: ShipCatalogItem[] = [
  { id: 'interceptor', name: 'VX-9 Vanguard', description: SHIP_CONFIGS.interceptor.description, price: 0, unlockRequirement: 'Starter ship' },
  { id: 'striker', name: 'SR-4 Valkyrie', description: SHIP_CONFIGS.striker.description, price: 850, unlockRequirement: 'Available for purchase' },
  { id: 'destroyer', name: 'HX-12 Aegis', description: SHIP_CONFIGS.destroyer.description, price: 1250, unlockRequirement: 'Available for purchase' },
];
export const SKIN_CATALOG: SkinCatalogItem[] = [
  { id: 'interceptor:default', name: 'Vanguard Standard', description: 'Factory graphite armor with ion cyan trim.', price: 0, shipId: 'interceptor', colors: {} },
  { id: 'interceptor:ember', name: 'Solar Flare', description: 'Warm copper armor and amber engine glow.', price: 240, shipId: 'interceptor', colors: { hullPrimary: '#713f12', hullSecondary: '#292018', hullTrim: '#fb923c', engineGlow: '#f97316', engineCore: '#ffedd5' } },
  { id: 'striker:default', name: 'Valkyrie Standard', description: 'Blue steel assault livery.', price: 150, shipId: 'striker', colors: {} },
  { id: 'striker:arctic', name: 'Arctic Patrol', description: 'Pale alloy with ice blue details.', price: 280, shipId: 'striker', colors: { hullPrimary: '#bfdbfe', hullSecondary: '#334155', hullTrim: '#67e8f9', engineGlow: '#22d3ee', engineCore: '#ecfeff' } },
  { id: 'destroyer:default', name: 'Aegis Standard', description: 'Dark fleet armor with blue reactor light.', price: 180, shipId: 'destroyer', colors: {} },
  { id: 'destroyer:crimson', name: 'Crimson Guard', description: 'Deep red armor with scarlet reactor light.', price: 320, shipId: 'destroyer', colors: { hullPrimary: '#7f1d1d', hullSecondary: '#1c1018', hullTrim: '#f87171', engineGlow: '#ef4444', engineCore: '#ffe4e6' } },
  { id: 'interceptor:stellar', name: 'Stellar Crown', description: 'Ceremonial livery for campaign aces.', price: 0, shipId: 'interceptor', achievementRequirement: 'achievement:campaign-ace', colors: { hullPrimary: '#1e3a8a', hullSecondary: '#0f172a', hullTrim: '#facc15', engineGlow: '#38bdf8', engineCore: '#fff7cc' } },
];
export const STARTER_COLLECTION: CampaignCollectionState = {
  ownedShipIds: ['interceptor'], ownedSkinIds: ['interceptor:default'], selectedShipId: 'interceptor', selectedSkinByShip: { interceptor: 'interceptor:default' },
};
export const getShipCatalogItem = (id: string) => SHIP_CATALOG.find((item) => item.id === id);
export const getSkinCatalogItem = (id: string) => SKIN_CATALOG.find((item) => item.id === id);
export function getShipConfigWithSkin(shipId: ShipId, skinId: string) {
  const base = SHIP_CONFIGS[shipId];
  const skin = getSkinCatalogItem(skinId);
  return skin?.shipId === shipId ? { ...base, colors: { ...base.colors, ...skin.colors } } : base;
}
export function normalizeCollection(value: unknown): CampaignCollectionState {
  const c = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const ownedShipIds = [...new Set([ ...STARTER_COLLECTION.ownedShipIds, ...(Array.isArray(c.ownedShipIds) ? c.ownedShipIds.filter((id): id is string => typeof id === 'string' && SHIP_CATALOG.some((item) => item.id === id)) : [])])];
  const ownedSkinIds = [...new Set([ ...STARTER_COLLECTION.ownedSkinIds, ...(Array.isArray(c.ownedSkinIds) ? c.ownedSkinIds.filter((id): id is string => typeof id === 'string' && SKIN_CATALOG.some((item) => item.id === id)) : [])])];
  const selectedShipId = typeof c.selectedShipId === 'string' && SHIP_ORDER.includes(c.selectedShipId as ShipId) && ownedShipIds.includes(c.selectedShipId) ? c.selectedShipId : 'interceptor';
  const savedSelections = c.selectedSkinByShip && typeof c.selectedSkinByShip === 'object' && !Array.isArray(c.selectedSkinByShip) ? c.selectedSkinByShip as Record<string, unknown> : {};
  const selectedSkinByShip: Record<string, string> = { ...STARTER_COLLECTION.selectedSkinByShip };
  for (const id of ownedShipIds) {
    const validOwned = (candidate: unknown) => typeof candidate === 'string' && getSkinCatalogItem(candidate)?.shipId === id && ownedSkinIds.includes(candidate);
    const saved = savedSelections[id];
    selectedSkinByShip[id] = validOwned(saved) ? saved as string : (SKIN_CATALOG.find((skin) => skin.shipId === id && ownedSkinIds.includes(skin.id))?.id ?? `${id}:default`);
  }
  return { ownedShipIds, ownedSkinIds, selectedShipId, selectedSkinByShip };
}

export function purchaseCollectionItem(save: CampaignSaveData, kind: 'ship' | 'skin', id: string): { ok: boolean; save: CampaignSaveData; message: string } {
  const collection = normalizeCollection(save.collection);
  const item = kind === 'ship' ? getShipCatalogItem(id) : getSkinCatalogItem(id);
  if (!item || (kind === 'skin' && !collection.ownedShipIds.includes((item as SkinCatalogItem).shipId))) return { ok: false, save, message: 'That item is unavailable.' };
  const achievementRequirement = item.achievementRequirement;
  if (achievementRequirement && !save.rewards?.unlockedAchievementIds.includes(achievementRequirement)) return { ok: false, save, message: `Unlock ${achievementRequirement.replace('achievement:', '')} first.` };
  const owned = kind === 'ship' ? collection.ownedShipIds : collection.ownedSkinIds;
  if (owned.includes(id)) return { ok: false, save, message: 'You already own this item.' };
  const credits = save.rewards?.credits ?? 0;
  if (credits < item.price) return { ok: false, save, message: `You need ${item.price - credits} more Credits.` };
  const nextCollection = kind === 'ship'
    ? { ...collection, ownedShipIds: [...collection.ownedShipIds, id] }
    : { ...collection, ownedSkinIds: [...collection.ownedSkinIds, id] };
  return { ok: true, save: { ...save, collection: nextCollection, rewards: { ...(save.rewards!), credits: credits - item.price } }, message: `${item.name} acquired.` };
}
