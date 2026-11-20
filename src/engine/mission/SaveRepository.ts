import { CAMPAIGN_MISSIONS } from '../../config/missions';
import type { MissionRank } from '../../types/game';
import type { CampaignSaveData, CampaignRewardState, MissionProgressRecord } from '../../types/mission';
import { normalizeCollection } from '../../config/collection';

export const CAMPAIGN_SAVE_VERSION = 2;
export const CAMPAIGN_SAVE_KEY = 'starfall.campaign.v2';
export const LEGACY_CAMPAIGN_SAVE_KEY = 'starfall.campaign.v1';
const ranks = new Set<MissionRank>(['S', 'A', 'B', 'C']);
const ids = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string'))] : [];
const emptyRewards = (): CampaignRewardState => ({ credits: 0, paidFirstClearMissionIds: [], paidRankRewards: {}, completedOptionalRewardIds: [], unlockedAchievementIds: [], ledgerIds: [] });

export function createEmptyCampaignSave(): CampaignSaveData {
  const missions: Record<string, MissionProgressRecord> = {};
  for (const mission of CAMPAIGN_MISSIONS) missions[mission.id] = { completed: false, bestRank: null, bestScore: 0, bestTimeSec: null, attempts: 0 };
  return { version: CAMPAIGN_SAVE_VERSION, missions, rewards: emptyRewards(), collection: normalizeCollection(null) };
}

export type SaveErrorKind = 'invalid-json' | 'unknown-version' | 'read-failed' | 'write-failed';
export interface SaveError { kind: SaveErrorKind; message: string; recoverable: true }
export type LoadSaveResult = { data: CampaignSaveData; error: SaveError | null; migrated: boolean };
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

function validRecord(value: unknown): MissionProgressRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.completed !== 'boolean') return null;
  return {
    completed: r.completed,
    bestRank: typeof r.bestRank === 'string' && ranks.has(r.bestRank as MissionRank) ? r.bestRank as MissionRank : null,
    bestScore: typeof r.bestScore === 'number' && Number.isFinite(r.bestScore) && r.bestScore >= 0 ? Math.round(r.bestScore) : 0,
    bestTimeSec: typeof r.bestTimeSec === 'number' && Number.isFinite(r.bestTimeSec) && r.bestTimeSec > 0 ? r.bestTimeSec : null,
    attempts: typeof r.attempts === 'number' && Number.isFinite(r.attempts) && r.attempts >= 0 ? Math.floor(r.attempts) : 0,
  };
}
function normalize(value: unknown): CampaignSaveData {
  const base = createEmptyCampaignSave();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  const obj = value as Record<string, unknown>;
  if (obj.missions && typeof obj.missions === 'object' && !Array.isArray(obj.missions)) {
    for (const [id, record] of Object.entries(obj.missions as Record<string, unknown>)) {
      const valid = validRecord(record);
      if (valid) base.missions[id] = valid;
    }
  }
  const r = obj.rewards && typeof obj.rewards === 'object' ? obj.rewards as Record<string, unknown> : {};
  base.rewards = {
    credits: typeof r.credits === 'number' && Number.isFinite(r.credits) && r.credits >= 0 ? Math.floor(r.credits) : 0,
    paidFirstClearMissionIds: ids(r.paidFirstClearMissionIds),
    paidRankRewards: r.paidRankRewards && typeof r.paidRankRewards === 'object' && !Array.isArray(r.paidRankRewards)
      ? Object.fromEntries(Object.entries(r.paidRankRewards).filter(([, rank]) => typeof rank === 'string' && ranks.has(rank as MissionRank))) as Record<string, MissionRank> : {},
    completedOptionalRewardIds: ids(r.completedOptionalRewardIds), unlockedAchievementIds: ids(r.unlockedAchievementIds), ledgerIds: ids(r.ledgerIds),
  };
  base.collection = normalizeCollection(obj.collection);
  return base;
}

export class SaveRepository {
  private lastError: SaveError | null = null;
  constructor(private readonly storage: StorageLike | null) {}
  get error(): SaveError | null { return this.lastError; }
  load(): LoadSaveResult {
    this.lastError = null;
    if (!this.storage) return { data: createEmptyCampaignSave(), error: { kind: 'read-failed', message: 'Campaign storage is unavailable. Progress will remain in memory until storage returns.', recoverable: true }, migrated: false };
    try {
      const current = this.storage.getItem(CAMPAIGN_SAVE_KEY);
      const raw = current ?? this.storage.getItem(LEGACY_CAMPAIGN_SAVE_KEY);
      if (raw === null) return { data: createEmptyCampaignSave(), error: null, migrated: false };
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch {
        this.lastError = { kind: 'invalid-json', message: 'The campaign save could not be read. The stored data has been retained for recovery.', recoverable: true };
        return { data: createEmptyCampaignSave(), error: this.lastError, migrated: false };
      }
      const version = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).version : undefined;
      if (typeof version === 'number' && version > CAMPAIGN_SAVE_VERSION) {
        this.lastError = { kind: 'unknown-version', message: 'This campaign save was created by a newer game version. It has been left untouched.', recoverable: true };
        return { data: createEmptyCampaignSave(), error: this.lastError, migrated: false };
      }
      if (current && version !== CAMPAIGN_SAVE_VERSION) {
        this.lastError = { kind: 'unknown-version', message: 'The campaign save version is not recognized. Stored data has been retained.', recoverable: true };
        return { data: createEmptyCampaignSave(), error: this.lastError, migrated: false };
      }
      const data = normalize(parsed);
      data.version = CAMPAIGN_SAVE_VERSION;
      const migrated = !current || version !== CAMPAIGN_SAVE_VERSION;
      if (migrated && !this.write(data)) return { data, error: this.lastError, migrated: false };
      return { data, error: null, migrated };
    } catch {
      this.lastError = { kind: 'read-failed', message: 'Campaign storage could not be read. Existing data has been left untouched.', recoverable: true };
      return { data: createEmptyCampaignSave(), error: this.lastError, migrated: false };
    }
  }
  write(input: CampaignSaveData): boolean {
    if (!this.storage) { this.lastError = { kind: 'write-failed', message: 'Campaign storage is unavailable. Progress could not be saved.', recoverable: true }; return false; }
    try {
      const data = normalize(input); data.version = CAMPAIGN_SAVE_VERSION;
      const raw = JSON.stringify(data);
      this.storage.setItem(CAMPAIGN_SAVE_KEY, raw);
      if (this.storage.getItem(CAMPAIGN_SAVE_KEY) !== raw) throw new Error('Save verification failed');
      this.lastError = null; return true;
    } catch {
      this.lastError = { kind: 'write-failed', message: 'Campaign progress could not be saved. Free storage space and retry; existing saves are retained.', recoverable: true };
      return false;
    }
  }
}

function browserStorage(): StorageLike | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}
export const campaignSaveRepository = new SaveRepository(browserStorage());
