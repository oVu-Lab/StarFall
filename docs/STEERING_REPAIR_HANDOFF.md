# Steering repair handoff

## State
`/Users/julian/antigravity/STARFALL` is on `main`, tracking `origin/main` at `https://github.com/oVu-Lab/StarFall.git`. Existing local edits and untracked files were preserved; nothing committed, pushed or deployed.

## Current repair
- The previous revision explicitly replaced the boundary-clamped HUD coordinate with raw projected T, so T escaped. Its 55% fractional chase-camera follow also made hull rotation less visually obvious. The frame loop does update `shipRoot.quaternion` from `flight.quaternion`; the playtest report that the ship appeared stationary cannot be independently diagnosed without browser gameplay.
- InputManager retains Pointer Lock, relative delta accumulation/once-per-frame consumption and >500px event filter. FlightController adds relative mouse deltas to V, then feeds back the actual ship-rotation projection into V; neither absolute mouse coordinates nor camera-only changes drive this feedback.
- FlightController stores the pre-integration ship quaternion. After CameraController completes follow and boundary correction, it projects the old and current ship orientations through that same final camera view. It subtracts only the resulting real weapon-ray screen displacement from V, then computes the next V − T steering error. This lets V approach T at the boundary without counting camera motion as ship motion. The HUD continues to project the same real weapon ray used by firing; no HUD interpolation or cannon gimbal is involved.
- CameraController follows 55% of actual hull rotation, then constrains the *actual camera projection* of the ship-forward weapon point inside the rounded boundary by rotating the camera only when needed. T is the raw matrix projection after this step, not a clamped HUD proxy or a cannon gimbal. Roll, boost FOV and settings changes can also cause camera boundary correction. This deliberately trades camera behavior for an honest bounded projection; camera comfort needs playtesting.
- Weapon bolts converge on the same 240-unit point, so actual projectile velocity passes through T there. The previous revision removed player spread and lateral inheritance for alignment mode; legacy/enemy behavior is unchanged. Other target distances have parallax.
- Claude's `MouseAlignment.ts` and tests remain an alternative world-direction model, not used at runtime. Earlier screen-fixed/unbounded tests were changed only where the latest user requirements directly contradicted them; stronger per-frame boundary and projection checks were added.

## Tuning and verification
`src/config/steering.ts`: `alignmentReferenceFraction=0.3`, response gains `1.0` and `1.6` in `tanh(n * (1.0 + 1.6n))`, angular smoothing `0.015s`, max rates `5.5/5.0 rad/s` (pitch balance `0.9`), and soft deadzone `0.5px`. Low-error gain and smoothing tune in-bound response separately from yaw/pitch ceilings. `WEAPON_CONFIGS.player_pulse_twin.convergenceDistance` is shared by projection and firing.

Latest checks: `npm test` validates target-error reduction and settling, retargeting during alignment, actual quaternion motion, bounded real projection, Pointer Lock spike filtering, response-curve monotonicity, and firing-ray agreement. `npm run lint`, `npm run build`, and `git diff --check` are also run for this repair.

## Browser status
The updated STARFALL app and first mission were opened on port 5174, avoiding the unrelated app previously served on port 3000. Browser automation left the Pointer Lock prompt visible, so manual Pointer Lock gameplay remains unverified; the input path is covered by `tests/pointer-lock.test.ts`.
