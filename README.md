<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.
https://ai.studio/apps/49f9382e-a5a8-4ac9-ad38-8127f285cebb

## Escort mission slice

The campaign includes Mission 06, **Last Shuttle Out**, unlocked after Mission 05. Protect friendly transport CIVILIAN-07 while it follows its extraction route. Aggressor and defender enemies select the transport as their target; flankers continue engaging the player. The transport uses the shared health and projectile collision systems, is shown with a friendly world marker and a hull/progress HUD, and contributes its remaining hull to mission survival scoring.

Escort objectives use `escort_transport` in `src/types/mission.ts` and an optional `escort` route on mission definitions. The transport lifecycle is owned by `CombatManager` and evaluated by `MissionManager`. Focused coverage lives in `tests/escort-mission.test.ts`.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Mouse steering model

STARFALL uses Pointer Lock `movementX` / `movementY` as CSS-pixel relative input. Mouse deltas
move the amber virtual target. After camera follow and boundary correction, the controller projects
the old and current ship orientations through the same completed camera view. It subtracts only
the resulting real weapon-ray screen displacement from the target. This closes the loop after
mouse motion stops without counting camera movement as ship movement.

The cyan reticle is always the ship-forward weapon convergence point projected through the active
`PerspectiveCamera`, so the HUD, target selection, and projectile convergence agree. The camera
keeps that real projection within the boundary; no separate reticle animation or weapon gimbal is
used. Reticle and projectiles share a 240-unit convergence point.

Tuning is in `src/config/steering.ts`: progressive demand uses `tanh(n * (1.0 + 1.6n))` with
`n = |V - T| / (0.3 * viewportHeight)`. Low-error gain and rate smoothing tune in-bound response;
maximum yaw/pitch rates independently cap ship rotation.
