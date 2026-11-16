import type { AllCharacterId } from './characters.ts';
import { CHARACTER_STYLES } from './characters.ts';

export const COURT_WIDTH = 16;   // X: -8 to +8
export const COURT_LENGTH = 28;  // Z: -14 to +14
export const HOOP_AWAY_Z = -12.4; // Home team (player) attacks this hoop (-Z)
export const HOOP_HOME_Z = 12.4;  // Away team (AI) attacks this hoop (+Z)
export const RIM_HEIGHT = 3.05;
export const RIM_RADIUS = 0.28;
export const BALL_RADIUS = 0.14;
export const THREE_POINT_RADIUS = 6.75;
export const GRAVITY = 18.5; // Crisp arcade basketball gravity

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface ShotInput {
  shooterId: AllCharacterId;
  shooterPos: Vec3Like;
  targetHoopZ: number;
  releaseAccuracy: number; // 0..1 (1 = perfect green release)
  nearestDefenderDist: number; // meters
  inZone: boolean;
  isFormlessShot?: boolean;
  isPhantomShot?: boolean;
}

/**
 * Determines whether a shot taken from (x, z) toward targetHoopZ counts as 3 points.
 */
export function isThreePointer(x: number, z: number, targetHoopZ: number): boolean {
  const dx = x;
  const dz = z - targetHoopZ;
  const distFromHoop = Math.hypot(dx, dz);
  // Corner 3pt line cuts at |x| >= 6.4 inside the baseline region
  if (Math.abs(x) >= 6.4) {
    return true;
  }
  return distFromHoop >= THREE_POINT_RADIUS;
}

/**
 * Pure shot make probability calculator in [0.08, 0.99].
 * Combines character proficiency, shot distance, release timing, defense contest, Zone, and signature shot skills.
 */
export function calculateShotProbability(input: ShotInput): number {
  const style = CHARACTER_STYLES[input.shooterId];
  const dx = input.shooterPos.x;
  const dz = input.shooterPos.z - input.targetHoopZ;
  const dist = Math.hypot(dx, dz);
  const threePt = isThreePointer(input.shooterPos.x, input.shooterPos.z, input.targetHoopZ);

  const baseSkill = threePt ? style.stats.threePoint : style.stats.twoPoint;
  // Release timing: 0..1, sweet spot >= 0.72 gives bonus, bad timing penalizes
  const timingFactor = 0.45 + 0.55 * clamp(input.releaseAccuracy, 0, 1);

  // Distance falloff beyond 3pt arc
  const distancePenalty = dist > 8.5 ? Math.min(0.38, (dist - 8.5) * 0.045) : 0;

  // Defender contest penalty (within 2.3m)
  let contestPenalty = 0;
  if (input.nearestDefenderDist < 2.4) {
    const rawContest = (2.4 - input.nearestDefenderDist) / 2.4; // 0..1
    contestPenalty = rawContest * 0.36;
  }

  // Signature overrides
  if (input.isFormlessShot) {
    contestPenalty *= 0.15; // Aomine's Formless Shot ignores 85% of defensive contest
  }
  if (input.isPhantomShot) {
    contestPenalty *= 0.25; // Kuroko's Phantom Shot disappears from defender's gaze
  }

  let prob = baseSkill * timingFactor - distancePenalty - contestPenalty;

  if (input.isFormlessShot) prob += 0.22;
  if (input.isPhantomShot) prob += 0.2;
  if (input.inZone) prob += 0.24;

  // Perfect release guarantee boost
  if (input.releaseAccuracy >= 0.92 && input.nearestDefenderDist > 1.4) {
    prob = Math.max(prob, 0.94);
  }

  return clamp(prob, 0.08, 0.99);
}

/**
 * Computes exact initial 3D velocity (vx, vy, vz) for a parabolic arc from startPos to targetPos
 * reaching at least `arcPeakY` above the higher of start/target.
 */
export function computeShotBallVelocity(
  startPos: Vec3Like,
  targetPos: Vec3Like,
  arcPeakY: number,
  gravity: number = GRAVITY
): Vec3Like {
  const safePeakY = Math.max(arcPeakY, startPos.y + 0.8, targetPos.y + 0.7);
  const riseY = safePeakY - startPos.y;
  const fallY = safePeakY - targetPos.y;

  const vy = Math.sqrt(2 * gravity * riseY);
  const tUp = vy / gravity;
  const tDown = Math.sqrt((2 * fallY) / gravity);
  const totalTime = Math.max(0.25, tUp + tDown);

  return {
    x: (targetPos.x - startPos.x) / totalTime,
    y: vy,
    z: (targetPos.z - startPos.z) / totalTime,
  };
}

/**
 * Converts a normalized charge progress (0..1) into release accuracy (0..1).
 * Sweet spot peaks at 0.80 so players can time green releases naturally.
 */
export function evaluateShotReleaseAccuracy(chargeRatio: number): number {
  const ideal = 0.8;
  const diff = Math.abs(clamp(chargeRatio, 0, 1) - ideal);
  return clamp(1 - diff * 2.2, 0.15, 1);
}

/**
 * Updates Zone meter with clamping [0, 100].
 */
export function addZoneCharge(current: number, delta: number): number {
  return clamp(current + delta, 0, 100);
}

export type MatchWinner = 'home' | 'away' | 'draw' | null;

export function checkMatchOutcome(
  homeScore: number,
  awayScore: number,
  timeRemainingSec: number,
  targetScore: number = 11
): MatchWinner {
  if (homeScore >= targetScore && homeScore > awayScore) return 'home';
  if (awayScore >= targetScore && awayScore > homeScore) return 'away';
  if (timeRemainingSec <= 0) {
    if (homeScore > awayScore) return 'home';
    if (awayScore > homeScore) return 'away';
    return 'draw';
  }
  return null;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function clampToCourt(pos: Vec3Like, margin: number = 0.45): Vec3Like {
  return {
    x: clamp(pos.x, -COURT_WIDTH / 2 + margin, COURT_WIDTH / 2 - margin),
    y: pos.y,
    z: clamp(pos.z, -COURT_LENGTH / 2 + margin, COURT_LENGTH / 2 - margin),
  };
}

/**
 * Computes character facing yaw locked toward the enemy hoop (0, targetHoopZ),
 * blending a small lateral strafe lean without ever turning the character's back to the rim.
 */
export function computeHoopLockedYaw(
  x: number,
  z: number,
  targetHoopZ: number,
  moveX: number = 0,
  moveZ: number = 0
): number {
  const hDx = -x;
  const hDz = targetHoopZ - z;
  const hLen = Math.max(0.01, Math.hypot(hDx, hDz));
  const dirX = hDx / hLen;
  const dirZ = hDz / hLen;

  const moveLen = Math.hypot(moveX, moveZ);
  if (moveLen <= 0.01) {
    return Math.atan2(dirX, dirZ);
  }

  const mX = moveX / moveLen;
  const mZ = moveZ / moveLen;
  // Hoop vector dominates (2.8 vs 0.65), guaranteeing dot(facing, dirToHoop) >= 0.96 (max ~13° strafe lean)
  return Math.atan2(dirX * 2.8 + mX * 0.65, dirZ * 2.8 + mZ * 0.65);
}

/**
 * Samples `steps` 3D points along the exact parabolic shot trajectory from `startPos`
 * to `targetPos`, reaching `arcPeakY` for rendering the aiming arc sight.
 */
export function sampleShotArcPoints(
  startPos: Vec3Like,
  targetPos: Vec3Like,
  arcPeakY: number,
  steps: number = 16,
  gravity: number = GRAVITY
): Vec3Like[] {
  const v = computeShotBallVelocity(startPos, targetPos, arcPeakY, gravity);
  const tUp = v.y / gravity;
  const peakY = startPos.y + 0.5 * gravity * tUp * tUp;
  const tDown = Math.sqrt(Math.max(0, (2 * (peakY - targetPos.y)) / gravity));
  const totalTime = Math.max(0.25, tUp + tDown);

  const count = Math.max(2, steps);
  const points: Vec3Like[] = [];
  for (let i = 0; i < count; i++) {
    const frac = (i + 1) / count;
    const t = frac * totalTime;
    points.push({
      x: startPos.x + v.x * t,
      y: startPos.y + v.y * t - 0.5 * gravity * t * t,
      z: startPos.z + v.z * t,
    });
  }
  return points;
}
