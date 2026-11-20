import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioManager } from './audio/AudioManager';
import { FlightHUD } from './components/FlightHUD';
import { LoadingScreen } from './components/LoadingScreen';
import { MainMenu } from './components/MainMenu';
import { MissionResultsOverlay } from './components/MissionResultsOverlay';
import { PauseOverlay } from './components/PauseOverlay';
import { resolveEffectiveGraphics } from './config/graphics';
import { CAMPAIGN_MISSIONS, getMissionById, getNextMission } from './config/missions';
import { loadSavedSettings, saveSettings, SHIP_CONFIGS } from './config/ships';
import { getSkinCatalogItem, normalizeCollection, purchaseCollectionItem } from './config/collection';
import { AssetManager } from './engine/AssetManager';
import { CombatManager } from './engine/combat/CombatManager';
import { createInitialTelemetry, FlightController } from './engine/FlightController';
import { InputManager } from './engine/InputManager';
import {
  isMissionUnlocked,
  getCampaignSaveError,
  loadCampaignProgress,
  recordMissionOutcome,
  saveCampaignProgress,
} from './engine/mission/CampaignProgressStore';
import { MissionManager } from './engine/mission/MissionManager';
import { applyMissionRewards } from './engine/mission/CampaignRewards';
import { FlightCanvas } from './scene/FlightCanvas';
import type {
  GamePhase,
  GameSettings,
  LoadingProgress,
  MenuSection,
  ShipId,
} from './types/game';
import type {
  CampaignSaveData,
  MissionDefinition,
  MissionHudSnapshot,
  MissionResult,
} from './types/mission';

function getInitialSelectedMission(save: CampaignSaveData): string {
  // Default highlight to the latest unlocked incomplete mission, or Mission 01
  let latestUnlocked = CAMPAIGN_MISSIONS[0].id;
  for (const m of CAMPAIGN_MISSIONS) {
    if (isMissionUnlocked(m, save)) {
      latestUnlocked = m.id;
      if (!save.missions[m.id]?.completed) return m.id;
    }
  }
  return latestUnlocked;
}

export default function App() {
  const [phase, setPhase] = useState<GamePhase>('menu');
  const [menuSection, setMenuSection] = useState<MenuSection>('main');
  const [settings, setSettings] = useState<GameSettings>(() => loadSavedSettings());
  const [campaignSave, setCampaignSave] = useState<CampaignSaveData>(() => loadCampaignProgress());
  const collection = normalizeCollection(campaignSave.collection);
  const activeShipId = collection.selectedShipId as ShipId;
  const activeSkinId = collection.selectedSkinByShip[activeShipId] ?? `${activeShipId}:default`;
  const [hangarShipId, setHangarShipId] = useState<ShipId>(activeShipId);
  const [hangarSkinId, setHangarSkinId] = useState<string>(collection.selectedSkinByShip[activeShipId]);
  const [collectionNotice, setCollectionNotice] = useState('');
  const [campaignSaveError, setCampaignSaveError] = useState(() => getCampaignSaveError());
  const [selectedMissionId, setSelectedMissionId] = useState<string>(() =>
    getInitialSelectedMission(loadCampaignProgress()),
  );
  const [activeMissionId, setActiveMissionId] = useState<string>(CAMPAIGN_MISSIONS[0].id);
  const [missionHud, setMissionHud] = useState<MissionHudSnapshot | null>(null);
  const [missionResult, setMissionResult] = useState<MissionResult | null>(null);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [playerDestroyed, setPlayerDestroyed] = useState(false);
  const [hintsVisible, setHintsVisible] = useState(true);
  const [snapCameraSignal, setSnapCameraSignal] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress>({
    stage: 'Initializing flight systems',
    percent: 0,
    shipId: 'interceptor',
    error: null,
  });

  // Stable engine singletons (never recreated across UI renders)
  const settingsRef = useRef<GameSettings>(settings);
  const flightRef = useRef<FlightController>(new FlightController(SHIP_CONFIGS[activeShipId]));
  const combatRef = useRef<CombatManager>(new CombatManager(SHIP_CONFIGS[activeShipId].maxHull));
  const missionManagerRef = useRef<MissionManager>(new MissionManager());
  const inputRef = useRef<InputManager>(new InputManager());
  const telemetryRef = useRef(createInitialTelemetry(SHIP_CONFIGS[activeShipId]));
  const hangarOrbitRef = useRef({ yaw: 0, pitch: 0 });
  const phaseRef = useRef<GamePhase>(phase);
  const campaignSaveRef = useRef<CampaignSaveData>(campaignSave);
  const activeAssetSessionRef = useRef<{ envKey: string | null; hullKey: string | null }>({
    envKey: null,
    hullKey: null,
  });
  const loadAbortRef = useRef<AbortController | null>(null);
  const pendingMissionRef = useRef<MissionDefinition | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    campaignSaveRef.current = campaignSave;
  }, [campaignSave]);

  useEffect(() => {
    settingsRef.current = settings;
    saveSettings(settings);
    AudioManager.setMasterVolume(settings.masterVolume);
  }, [settings]);

  // DEV-only diagnostic handle for automated browser verification (stripped in production)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const win = window as unknown as Record<string, unknown>;
    win.__STARFALL_DIAG__ = {
      getFlight: () => flightRef.current,
      getInput: () => inputRef.current,
      getTelemetry: () => telemetryRef.current,
      getSettings: () => settingsRef.current,
      getPhase: () => phaseRef.current,
    };
    return () => {
      delete win.__STARFALL_DIAG__;
    };
  }, []);

  const graphics = useMemo(() => resolveEffectiveGraphics(settings), [settings]);

  // Stage B: Background idle ship preload when opening Hangar
  const handleChangeMenuSection = useCallback(
    (next: MenuSection) => {
      setMenuSection(next);
      if (next === 'hangar') {
        AssetManager.preloadShipInBackground('striker', graphics.textureResolution);
        AssetManager.preloadShipInBackground('destroyer', graphics.textureResolution);
      }
    },
    [graphics.textureResolution],
  );

  // Stage E: Cleanly release mission-scoped GPU assets when leaving active gameplay
  const releaseActiveMissionAssets = useCallback(() => {
    const sess = activeAssetSessionRef.current;
    if (sess.envKey || sess.hullKey) {
      AssetManager.releaseMissionSession(sess.envKey, sess.hullKey);
      activeAssetSessionRef.current = { envKey: null, hullKey: null };
    }
  }, []);

  // Wire MissionManager callbacks once (discrete event updates only — zero per-frame React state)
  useEffect(() => {
    missionManagerRef.current.setCallbacks({
      onHudUpdate: (snapshot) => {
        setMissionHud(snapshot);
      },
      onMissionEnd: (rawResult) => {
        inputRef.current.exitPointerLock();
        inputRef.current.setActive(false);
        AudioManager.setFlightAudioActive(false);

        const outcome = recordMissionOutcome(
          campaignSaveRef.current,
          rawResult.missionId,
          rawResult.status === 'completed',
          rawResult.rank,
          rawResult.scoreBreakdown.totalScore,
          rawResult.timeTakenSec,
        );
        const rewarded = applyMissionRewards(rawResult, outcome.nextSave);
        const saved = saveCampaignProgress(rewarded.nextSave);
        setCampaignSaveError(saved ? null : getCampaignSaveError());
        setCampaignSave(rewarded.nextSave);

        const unlockedNew =
          rawResult.status === 'completed' && !outcome.wasPreviouslyCompleted
            ? rawResult.unlockedNextMissionName
            : null;

        setMissionResult({
          ...rawResult,
          unlockedNextMissionName: unlockedNew,
          isNewBestRank: outcome.isNewBestRank,
          isNewBestScore: outcome.isNewBestScore,
          rewardSummary: rewarded.summary,
        });
        setPhase('results');
      },
    });
  }, []);

  // Attach global keyboard + Pointer Lock listeners once
  useEffect(() => {
    const input = inputRef.current;
    input.attach({
      onPauseRequested: () => {
        if (phaseRef.current === 'playing' && !combatRef.current.playerHealth.isDestroyed) {
          AudioManager.playUiClick('pause');
          AudioManager.setFlightAudioActive(false);
          input.setActive(false);
          setPhase('paused');
        }
      },
      onPointerLockChanged: (locked) => {
        setPointerLocked(locked);
      },
      onToggleHudHints: () => {
        setHintsVisible((prev) => !prev);
      },
      onTogglePerfMonitor: () => {
        if (import.meta.env.DEV) {
          setSettings((prev) => ({ ...prev, showPerfOverlay: !prev.showPerfOverlay }));
        }
      },
    });

    return () => {
      loadAbortRef.current?.abort();
      input.detach();
      AudioManager.dispose();
      AssetManager.disposeAll();
    };
  }, []);

  // Sync InputManager & flight audio with active gameplay phase
  useEffect(() => {
    const isPlaying = phase === 'playing' && !playerDestroyed;
    inputRef.current.setActive(isPlaying);
    AudioManager.setFlightAudioActive(isPlaying);
  }, [phase, playerDestroyed]);

  const handleUpdateSettings = useCallback((patch: Partial<GameSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateCollection = useCallback((next: CampaignSaveData) => {
    const normalized = { ...next, collection: normalizeCollection(next.collection) };
    campaignSaveRef.current = normalized;
    const saved = saveCampaignProgress(normalized);
    if (saved) { setCampaignSave(normalized); setCampaignSaveError(null); }
    else setCampaignSaveError(getCampaignSaveError());
    return saved;
  }, []);
  const handlePurchase = useCallback((kind: 'ship' | 'skin', id: string) => {
    let result = purchaseCollectionItem(campaignSaveRef.current, kind, id);
    if (!result.ok) { setCollectionNotice(result.message); return; }
    if (kind === 'skin') {
      const skin = getSkinCatalogItem(id)!;
      result = { ...result, save: { ...result.save, collection: { ...normalizeCollection(result.save.collection), selectedSkinByShip: { ...normalizeCollection(result.save.collection).selectedSkinByShip, [skin.shipId]: id } } } };
      setHangarSkinId(id);
    }
    setCollectionNotice(updateCollection(result.save) ? result.message : 'Purchase could not be saved. Please retry.');
  }, [updateCollection]);
  const handleSelectShip = useCallback((id: ShipId) => {
    setHangarShipId(id);
    setHangarSkinId(normalizeCollection(campaignSaveRef.current.collection).selectedSkinByShip[id] ?? `${id}:default`);
    if (normalizeCollection(campaignSaveRef.current.collection).ownedShipIds.includes(id)) {
      const next = { ...campaignSaveRef.current, collection: { ...normalizeCollection(campaignSaveRef.current.collection), selectedShipId: id } };
      updateCollection(next);
    }
  }, [updateCollection]);
  const handleSelectSkin = useCallback((shipId: ShipId, skinId: string) => {
    const normalized = normalizeCollection(campaignSaveRef.current.collection);
    const skin = getSkinCatalogItem(skinId);
    if (!skin || skin.shipId !== shipId || !normalized.ownedSkinIds.includes(skinId)) return;
    updateCollection({ ...campaignSaveRef.current, collection: { ...normalized, selectedSkinByShip: { ...normalized.selectedSkinByShip, [shipId]: skinId } } });
  }, [updateCollection]);

  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement) => {
    inputRef.current.setLockTarget(canvas);
  }, []);

  const handleRequestLock = useCallback(() => {
    AudioManager.unlock();
    if (!inputRef.current.isPointerLocked()) {
      inputRef.current.requestPointerLock();
    }
  }, []);

  const handlePlayerDestroyed = useCallback(() => {
    inputRef.current.exitPointerLock();
    inputRef.current.setActive(false);
    AudioManager.setFlightAudioActive(false);
    setPlayerDestroyed(true);
  }, []);

  const launchLoadedMission = useCallback(
    (mission: MissionDefinition) => {
      const ship = SHIP_CONFIGS[activeShipId];
      flightRef.current.setShipConfig(ship);
      flightRef.current.reset();
      inputRef.current.resetVirtualStick();
      telemetryRef.current = createInitialTelemetry(ship);
      setActiveMissionId(mission.id);
      setSelectedMissionId(mission.id);
      setPlayerDestroyed(false);
      setMissionResult(null);

      const initialHud = missionManagerRef.current.startMission(
        mission,
        combatRef.current,
        ship.maxHull,
        flightRef.current.position,
      );
      setMissionHud(initialHud);
      setSnapCameraSignal((s) => s + 1);
      setPhase('playing');
      inputRef.current.setActive(true);
      AudioManager.setFlightAudioActive(true);
    },
    [activeShipId],
  );

  /**
   * Stage C Progressive Mission Loader with abort cancellation & error recovery.
   */
  const handleStartMission = useCallback(
    async (mission: MissionDefinition) => {
      AudioManager.unlock();
      loadAbortRef.current?.abort();
      const abortCtrl = new AbortController();
      loadAbortRef.current = abortCtrl;
      pendingMissionRef.current = mission;

      // Release prior mission-scoped assets before loading next sector
      releaseActiveMissionAssets();

      // Attempt synchronous Pointer Lock right on the Launch button gesture
      inputRef.current.requestPointerLock();

      setPhase('loading');
      setMissionResult(null);
      setLoadingProgress({
        stage: `Preparing ${mission.code} — ${mission.name}`,
        percent: 8,
        shipId: activeShipId,
        missionCode: mission.code,
        missionName: mission.name,
        sectorName: mission.environment.sectorName,
        error: null,
      });

      try {
        const loaded = await AssetManager.loadMissionAssets(
          mission,
          activeShipId,
          graphics.textureResolution,
          (stage, percent) => {
            setLoadingProgress({
              stage,
              percent,
              shipId: activeShipId,
              missionCode: mission.code,
              missionName: mission.name,
              sectorName: mission.environment.sectorName,
              error: null,
            });
          },
          abortCtrl.signal,
        );

        if (abortCtrl.signal.aborted) return;
        activeAssetSessionRef.current = { envKey: loaded.envKey, hullKey: loaded.hullKey };
        launchLoadedMission(mission);
      } catch (err) {
        if (err instanceof Error && err.message === 'ABORTED') return;
        inputRef.current.exitPointerLock();
        setLoadingProgress((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : 'Unable to load mission sector assets.',
        }));
      }
    },
    [activeShipId, graphics.textureResolution, launchLoadedMission, releaseActiveMissionAssets],
  );

  const handleCancelLoad = useCallback(() => {
    loadAbortRef.current?.abort();
    inputRef.current.exitPointerLock();
    releaseActiveMissionAssets();
    setMenuSection('missions');
    setPhase('menu');
  }, [releaseActiveMissionAssets]);

  const handleRetryLoad = useCallback(() => {
    const target = pendingMissionRef.current ?? getMissionById(selectedMissionId);
    void handleStartMission(target);
  }, [handleStartMission, selectedMissionId]);

  const handlePause = useCallback(() => {
    if (playerDestroyed || phaseRef.current !== 'playing') return;
    AudioManager.playUiClick('pause');
    inputRef.current.exitPointerLock();
    inputRef.current.setActive(false);
    AudioManager.setFlightAudioActive(false);
    setPhase('paused');
  }, [playerDestroyed]);

  const handleResume = useCallback(() => {
    AudioManager.unlock();
    inputRef.current.resetVirtualStick();
    setPhase('playing');
    inputRef.current.setActive(true);
    AudioManager.setFlightAudioActive(true);
    // Synchronous inside Resume button click gesture
    inputRef.current.requestPointerLock();
  }, []);

  const handleRestartMission = useCallback(() => {
    const mission = getMissionById(activeMissionId);
    inputRef.current.requestPointerLock();
    launchLoadedMission(mission);
  }, [activeMissionId, launchLoadedMission]);

  const handleGoToMissionSelect = useCallback(() => {
    inputRef.current.exitPointerLock();
    inputRef.current.setActive(false);
    AudioManager.setFlightAudioActive(false);
    missionManagerRef.current.abortMission();
    releaseActiveMissionAssets();
    setPlayerDestroyed(false);
    setMissionHud(null);
    setMissionResult(null);
    setMenuSection('missions');
    setPhase('menu');
  }, [releaseActiveMissionAssets]);

  const handleReturnToMenu = useCallback(() => {
    inputRef.current.exitPointerLock();
    inputRef.current.setActive(false);
    AudioManager.setFlightAudioActive(false);
    missionManagerRef.current.abortMission();
    releaseActiveMissionAssets();
    setPlayerDestroyed(false);
    setMissionHud(null);
    setMissionResult(null);
    setMenuSection('main');
    setPhase('menu');
  }, [releaseActiveMissionAssets]);

  const activeMission = useMemo(() => getMissionById(activeMissionId), [activeMissionId]);
  const previewMission = useMemo(() => getMissionById(selectedMissionId), [selectedMissionId]);
  const currentEnvironmentTheme =
    phase === 'menu' && menuSection === 'missions'
      ? previewMission.environment
      : phase === 'menu'
        ? CAMPAIGN_MISSIONS[0].environment
        : activeMission.environment;

  const nextMissionAfterResult = useMemo(() => {
    if (!missionResult || missionResult.status !== 'completed') return null;
    return getNextMission(missionResult.missionId);
  }, [missionResult]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#030712]">
      {/* Isolated Full-Viewport 3D WebGL Scene */}
      <FlightCanvas
        phase={phase}
        menuSection={menuSection}
        activeShipId={activeShipId}
        hangarShipId={hangarShipId}
        activeSkinId={activeSkinId}
        hangarSkinId={hangarSkinId}
        flight={flightRef.current}
        combat={combatRef.current}
        missionManager={missionManagerRef.current}
        missionTheme={currentEnvironmentTheme}
        input={inputRef.current}
        settingsRef={settingsRef}
        telemetryRef={telemetryRef}
        graphics={graphics}
        hangarOrbitRef={hangarOrbitRef}
        snapCameraSignal={snapCameraSignal}
        onCanvasReady={handleCanvasReady}
        onPlayerDestroyed={handlePlayerDestroyed}
      />

      {/* Semantic UI Overlays */}
      {campaignSaveError && (
        <div role="status" className="absolute left-1/2 top-4 z-50 w-[min(92vw,42rem)] -translate-x-1/2 rounded border border-amber-400/50 bg-slate-950/95 px-4 py-3 text-sm text-amber-100 shadow-xl">
          {campaignSaveError.message}
        </div>
      )}
      {phase === 'menu' && (
        <MainMenu
          section={menuSection}
          onChangeSection={handleChangeMenuSection}
          campaignSave={campaignSave}
          selectedMissionId={selectedMissionId}
          onSelectMission={setSelectedMissionId}
          onLaunchMission={handleStartMission}
          hangarShipId={hangarShipId}
          hangarSkinId={hangarSkinId}
          collectionNotice={collectionNotice}
          onSelectHangarShip={handleSelectShip}
          onSelectSkin={handleSelectSkin}
          onPreviewSkin={setHangarSkinId}
          onPurchase={handlePurchase}
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          hangarOrbitRef={hangarOrbitRef}
        />
      )}

      {phase === 'loading' && (
        <LoadingScreen
          progress={loadingProgress}
          onCancel={handleCancelLoad}
          onRetry={handleRetryLoad}
        />
      )}

      {phase === 'playing' && (
        <FlightHUD
          shipId={activeShipId}
          telemetryRef={telemetryRef}
          missionHud={missionHud}
          settings={settings}
          pointerLocked={pointerLocked}
          playerDestroyed={playerDestroyed}
          hintsVisible={hintsVisible}
          onToggleHints={() => setHintsVisible((v) => !v)}
          onRequestLock={handleRequestLock}
          onPause={handlePause}
        />
      )}

      {phase === 'paused' && (
        <PauseOverlay
          missionLabel={`${activeMission.code} · ${activeMission.name}`}
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          onResume={handleResume}
          onRestartMission={handleRestartMission}
          onMissionSelect={handleGoToMissionSelect}
          onReturnToMenu={handleReturnToMenu}
        />
      )}

      {phase === 'results' && missionResult && (
        <MissionResultsOverlay
          result={missionResult}
          onNextMission={
            nextMissionAfterResult
              ? () => {
                  void handleStartMission(nextMissionAfterResult);
                }
              : null
          }
          onRetryMission={handleRestartMission}
          onMissionSelect={handleGoToMissionSelect}
          onMainMenu={handleReturnToMenu}
        />
      )}
    </main>
  );
}
