import { motion } from 'motion/react';
import { Compass, Play, SlidersHorizontal } from 'lucide-react';
import { AudioManager } from '../audio/AudioManager';
import { CAMPAIGN_MISSIONS } from '../config/missions';
import type { GameSettings, MenuSection, ShipId } from '../types/game';
import type { CampaignSaveData, MissionDefinition } from '../types/mission';
import { HangarView } from './HangarView';
import { MissionSelectView } from './MissionSelectView';
import { SettingsPanel } from './SettingsPanel';
import { ObsidianCorners, ObsidianEnergySpine, TECH_EASE } from './ui/ObsidianUI';

interface MainMenuProps {
  section: MenuSection;
  onChangeSection: (section: MenuSection) => void;
  campaignSave: CampaignSaveData;
  selectedMissionId: string;
  onSelectMission: (missionId: string) => void;
  onLaunchMission: (mission: MissionDefinition) => void;
  hangarShipId: ShipId;
  hangarSkinId: string;
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
  hangarSkinId,
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
        previewSkinId={hangarSkinId}
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
      <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#02040a]/75 p-5 sm:p-6">
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
  const credits = campaignSave.rewards?.credits ?? 0;

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-6 sm:p-10 lg:p-14">
      {/* Subtle left atmospheric falloff — keeps right-side 3D fighter completely open */}
      <div
        className="pointer-events-none fixed inset-y-0 left-0 -z-10 w-[min(36rem,75vw)] bg-gradient-to-r from-[#02040a]/82 via-[#02040a]/35 to-transparent"
        aria-hidden="true"
      />

      {/* Top Brand Monolith Plaque */}
      <motion.div
        initial={{ opacity: 0, x: -18 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.34, ease: TECH_EASE }}
        className="max-w-md"
      >
        <div className="flex items-center gap-3">
          <svg
            width="24"
            height="24"
            viewBox="0 0 28 28"
            className="shrink-0 text-[#38bdf8]"
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
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#38bdf8]">
            Orbital Combat
          </span>
        </div>

        <h1 className="mt-2 font-display text-5xl font-bold tracking-[0.18em] text-slate-50 sm:text-6xl">
          STARFALL
        </h1>

        <div className="mt-3 h-px w-44 bg-gradient-to-r from-[#38bdf8]/80 via-[#38bdf8]/25 to-transparent" />
      </motion.div>

      {/* Left-Anchored Obsidian Command Navigation */}
      <motion.nav
        aria-label="Main navigation"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.32, delay: 0.08, ease: TECH_EASE }}
        className="obsidian-monolith pointer-events-auto relative flex w-full max-w-[19.5rem] flex-col overflow-hidden"
      >
        <ObsidianEnergySpine orientation="vertical" side="left" />
        <ObsidianCorners subtle />

        <button
          type="button"
          onMouseEnter={() => AudioManager.playUiHover()}
          onClick={() => {
            AudioManager.unlock();
            AudioManager.playUiClick('primary');
            onChangeSection('missions');
          }}
          className="obsidian-cta-primary obsidian-scan group flex items-center justify-between border-0 border-b border-b-[#38bdf8]/40 px-5 py-4 text-left text-sm font-semibold uppercase tracking-[0.16em] text-[#e0f2fe] focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
        >
          <span className="flex items-center gap-3 font-display">
            <Play className="h-4 w-4 fill-[#38bdf8] text-[#38bdf8] transition-transform duration-150 group-hover:translate-x-0.5" />
            <span>Campaign</span>
          </span>
          <span className="font-mono text-[11px] tabular-nums text-[#38bdf8]">
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
          className="group flex items-center justify-between border-b border-white/8 px-5 py-3.5 text-left text-sm font-medium tracking-wider text-slate-200 transition-colors hover:bg-[#38bdf8]/[0.06] hover:text-[#e0f2fe] focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
        >
          <span className="flex items-center gap-3 font-display uppercase tracking-[0.14em]">
            <Compass className="h-4 w-4 text-[#38bdf8]" />
            <span>Hangar</span>
          </span>
          <span className="font-mono text-[11px] tabular-nums text-slate-400 group-hover:text-[#38bdf8]">
            {credits.toLocaleString()} CR
          </span>
        </button>

        <button
          type="button"
          onMouseEnter={() => AudioManager.playUiHover()}
          onClick={() => {
            AudioManager.unlock();
            AudioManager.playUiClick('secondary');
            onChangeSection('settings');
          }}
          className="group flex items-center justify-between px-5 py-3.5 text-left text-sm font-medium tracking-wider text-slate-300 transition-colors hover:bg-[#38bdf8]/[0.06] hover:text-[#e0f2fe] focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
        >
          <span className="flex items-center gap-3 font-display uppercase tracking-[0.14em]">
            <SlidersHorizontal className="h-4 w-4 text-[#38bdf8]" />
            <span>Settings</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500 group-hover:text-slate-300">
            SYS
          </span>
        </button>
      </motion.nav>

      {/* Minimal Technical Keybind Strip */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.14, ease: TECH_EASE }}
        className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] tracking-wider text-slate-400"
      >
        <span>
          <strong className="text-[#38bdf8]">MOUSE</strong> STEER
        </span>
        <span className="text-slate-700" aria-hidden="true">/</span>
        <span>
          <strong className="text-[#38bdf8]">LMB</strong> FIRE
        </span>
        <span className="text-slate-700" aria-hidden="true">/</span>
        <span>
          <strong className="text-[#38bdf8]">W·S</strong> THRUST
        </span>
        <span className="text-slate-700" aria-hidden="true">/</span>
        <span>
          <strong className="text-[#38bdf8]">A·D</strong> ROLL
        </span>
        <span className="text-slate-700" aria-hidden="true">/</span>
        <span>
          <strong className="text-[#38bdf8]">SHIFT</strong> BOOST
        </span>
      </motion.div>
    </div>
  );
}
