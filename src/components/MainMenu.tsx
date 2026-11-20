import { Compass, Play, SlidersHorizontal } from 'lucide-react';
import { AudioManager } from '../audio/AudioManager';
import { CAMPAIGN_MISSIONS } from '../config/missions';
import type { GameSettings, MenuSection, ShipId } from '../types/game';
import type { CampaignSaveData, MissionDefinition } from '../types/mission';
import { HangarView } from './HangarView';
import { MissionSelectView } from './MissionSelectView';
import { SettingsPanel } from './SettingsPanel';

interface MainMenuProps {
  section: MenuSection;
  onChangeSection: (section: MenuSection) => void;
  campaignSave: CampaignSaveData;
  selectedMissionId: string;
  onSelectMission: (missionId: string) => void;
  onLaunchMission: (mission: MissionDefinition) => void;
  hangarShipId: ShipId;
  onSelectHangarShip: (id: ShipId) => void;
  onSelectSkin: (shipId: ShipId, skinId: string) => void;
  onPreviewSkin: (skinId: string) => void;
  onPurchase: (kind: 'ship' | 'skin', id: string) => void;
  collectionNotice: string;
  settings: GameSettings;
  onUpdateSettings: (patch: Partial<GameSettings>) => void;
  hangarOrbitRef: React.MutableRefObject<{ yaw: number; pitch: number }>;
}

export function MainMenu({
  section,
  onChangeSection,
  campaignSave,
  selectedMissionId,
  onSelectMission,
  onLaunchMission,
  hangarShipId,
  onSelectHangarShip,
  onSelectSkin,
  onPreviewSkin,
  onPurchase,
  collectionNotice,
  settings,
  onUpdateSettings,
  hangarOrbitRef,
}: MainMenuProps) {
  if (section === 'missions') {
    return (
      <MissionSelectView
        campaignSave={campaignSave}
        selectedMissionId={selectedMissionId}
        onSelectMission={onSelectMission}
        onLaunchMission={onLaunchMission}
        onBack={() => onChangeSection('main')}
      />
    );
  }

  if (section === 'hangar') {
    return (
      <HangarView
        selectedShipId={hangarShipId}
        onSelectShip={onSelectHangarShip}
        save={campaignSave}
        notice={collectionNotice}
        onSelectSkin={onSelectSkin}
        onPreviewSkin={onPreviewSkin}
        onPurchase={onPurchase}
        onLaunchFlight={() => onChangeSection('missions')}
        onBack={() => onChangeSection('main')}
        hangarOrbitRef={hangarOrbitRef}
      />
    );
  }

  if (section === 'settings') {
    return (
      <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#030712]/65 p-6">
        <SettingsPanel
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          onClose={() => onChangeSection('main')}
          closeLabel="Return to Menu"
        />
      </div>
    );
  }

  const completedCount = CAMPAIGN_MISSIONS.filter((m) => campaignSave.missions[m.id]?.completed).length;

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-8 sm:p-12 lg:p-16">
      {/* Subtle left-side scrim ensuring high contrast over bright nebulae while leaving 3D fighter unobstructed */}
      <div
        className="pointer-events-none fixed inset-y-0 left-0 -z-10 w-full max-w-xl bg-gradient-to-r from-[#030712]/88 via-[#030712]/55 to-transparent"
        aria-hidden="true"
      />

      {/* Top Brand Wordmark */}
      <div className="max-w-lg">
        <div className="flex items-center gap-3">
          <svg
            width="28"
            height="28"
            viewBox="0 0 28 28"
            className="shrink-0 text-cyan-400"
            aria-hidden="true"
          >
            <polygon
              points="14,2 25,22 14,17 3,22"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <polygon points="14,7 19,17 14,14.5 9,17" fill="currentColor" />
          </svg>
          <span className="font-mono text-xs tracking-[0.26em] text-cyan-300">
            ORBITAL COMBAT CAMPAIGN
          </span>
        </div>

        <h1 className="mt-3 font-display text-5xl font-bold tracking-[0.14em] text-slate-50 sm:text-6xl">
          STARFALL
        </h1>

        <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-300">
          Six-degree-of-freedom arcade space combat. Command the VX-9 Vanguard through six
          escalating operations, from first contact to the Aurelia evacuation.
        </p>
      </div>

      {/* Primary Action Stack */}
      <div className="pointer-events-auto flex w-full max-w-xs flex-col gap-3">
        <button
          type="button"
          onMouseEnter={() => AudioManager.playUiHover()}
          onClick={() => {
            AudioManager.unlock();
            AudioManager.playUiClick('primary');
            onChangeSection('missions');
          }}
          className="group flex items-center justify-between bg-cyan-500 px-6 py-3.5 text-sm font-semibold tracking-wide text-slate-950 transition-colors hover:bg-cyan-400 focus-visible:outline-2 focus-visible:outline-cyan-300"
        >
          <span className="flex items-center gap-3">
            <Play className="h-4 w-4 fill-current" />
            <span>Campaign Missions</span>
          </span>
          <span className="font-mono text-xs text-slate-900/80">
            {completedCount}/{CAMPAIGN_MISSIONS.length}
          </span>
        </button>

        <button
          type="button"
          onMouseEnter={() => AudioManager.playUiHover()}
          onClick={() => {
            AudioManager.unlock();
            AudioManager.playUiClick('secondary');
            onChangeSection('hangar');
          }}
          className="flex items-center justify-between border border-slate-700/90 bg-[#050c1d]/85 px-6 py-3 text-sm font-medium text-slate-100 transition-colors hover:border-cyan-400/70 hover:text-cyan-200 focus-visible:outline-2 focus-visible:outline-cyan-400"
        >
          <span className="flex items-center gap-3">
            <Compass className="h-4 w-4 text-cyan-400" />
            <span>Hangar</span>
          </span>
          <span className="font-mono text-xs text-slate-400">3 Ships</span>
        </button>

        <button
          type="button"
          onMouseEnter={() => AudioManager.playUiHover()}
          onClick={() => {
            AudioManager.unlock();
            AudioManager.playUiClick('secondary');
            onChangeSection('settings');
          }}
          className="flex items-center justify-between border border-slate-700/90 bg-[#050c1d]/85 px-6 py-3 text-sm font-medium text-slate-100 transition-colors hover:border-cyan-400/70 hover:text-cyan-200 focus-visible:outline-2 focus-visible:outline-cyan-400"
        >
          <span className="flex items-center gap-3">
            <SlidersHorizontal className="h-4 w-4 text-cyan-400" />
            <span>Settings</span>
          </span>
          <span className="font-mono text-xs text-slate-400">Graphics & Audio</span>
        </button>
      </div>

      {/* Quiet Flight Controls Summary Footer */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
        <span>Mouse Continuous Steer</span>
        <span aria-hidden="true">·</span>
        <span>LMB Fire</span>
        <span aria-hidden="true">·</span>
        <span>W / S Thrust</span>
        <span aria-hidden="true">·</span>
        <span>A / D Roll</span>
        <span aria-hidden="true">·</span>
        <span>Shift Boost</span>
        <span aria-hidden="true">·</span>
        <span>{CAMPAIGN_MISSIONS.length} Campaign Missions</span>
      </div>
    </div>
  );
}
