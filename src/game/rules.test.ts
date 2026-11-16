import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOOP_AWAY_Z,
  HOOP_HOME_Z,
  RIM_HEIGHT,
  GRAVITY,
  isThreePointer,
  calculateShotProbability,
  computeShotBallVelocity,
  evaluateShotReleaseAccuracy,
  addZoneCharge,
  checkMatchOutcome,
  clampToCourt,
  computeHoopLockedYaw,
  sampleShotArcPoints,
} from './rules.ts';

test('isThreePointer correctly distinguishes 2-point and 3-point zones', () => {
  // Inside the paint near away hoop
  assert.equal(isThreePointer(0, HOOP_AWAY_Z + 3.0, HOOP_AWAY_Z), false);
  // Top of the key outside 6.75m arc
  assert.equal(isThreePointer(0, HOOP_AWAY_Z + 7.2, HOOP_AWAY_Z), true);
  // Corner three
  assert.equal(isThreePointer(6.6, HOOP_AWAY_Z + 1.5, HOOP_AWAY_Z), true);
});

test('calculateShotProbability rewards release timing, Zone, and Formless Shot against contests', () => {
  const contestedNormal = calculateShotProbability({
    shooterId: 'aomine',
    shooterPos: { x: 2, y: 0, z: HOOP_AWAY_Z + 4.5 },
    targetHoopZ: HOOP_AWAY_Z,
    releaseAccuracy: 0.7,
    nearestDefenderDist: 0.6,
    inZone: false,
    isFormlessShot: false,
  });

  const contestedFormless = calculateShotProbability({
    shooterId: 'aomine',
    shooterPos: { x: 2, y: 0, z: HOOP_AWAY_Z + 4.5 },
    targetHoopZ: HOOP_AWAY_Z,
    releaseAccuracy: 0.7,
    nearestDefenderDist: 0.6,
    inZone: false,
    isFormlessShot: true,
  });

  const zoneBoosted = calculateShotProbability({
    shooterId: 'akashi',
    shooterPos: { x: 0, y: 0, z: HOOP_AWAY_Z + 5.0 },
    targetHoopZ: HOOP_AWAY_Z,
    releaseAccuracy: 0.9,
    nearestDefenderDist: 2.5,
    inZone: true,
  });

  assert.ok(contestedFormless > contestedNormal + 0.25);
  assert.ok(zoneBoosted >= 0.9);
});

test('computeShotBallVelocity launches ball cleanly onto the target rim coordinate', () => {
  const start = { x: 2.5, y: 2.1, z: -4.0 };
  const target = { x: 0, y: RIM_HEIGHT, z: HOOP_AWAY_Z };
  const v = computeShotBallVelocity(start, target, 5.2, GRAVITY);

  // Calculate total flight time from kinematics
  const tUp = v.y / GRAVITY;
  const peakY = start.y + 0.5 * GRAVITY * tUp * tUp;
  const tDown = Math.sqrt((2 * (peakY - target.y)) / GRAVITY);
  const totalT = tUp + tDown;

  const landedX = start.x + v.x * totalT;
  const landedZ = start.z + v.z * totalT;
  const landedY = start.y + v.y * totalT - 0.5 * GRAVITY * totalT * totalT;

  assert.ok(Math.abs(landedX - target.x) < 1e-4);
  assert.ok(Math.abs(landedZ - target.z) < 1e-4);
  assert.ok(Math.abs(landedY - target.y) < 1e-4);
});

test('evaluateShotReleaseAccuracy peaks at 0.80 charge', () => {
  assert.equal(evaluateShotReleaseAccuracy(0.8), 1);
  assert.ok(evaluateShotReleaseAccuracy(0.4) < evaluateShotReleaseAccuracy(0.75));
});

test('addZoneCharge and checkMatchOutcome enforce bounds and win conditions', () => {
  assert.equal(addZoneCharge(85, 30), 100);
  assert.equal(addZoneCharge(10, -25), 0);

  assert.equal(checkMatchOutcome(11, 8, 45, 11), 'home');
  assert.equal(checkMatchOutcome(7, 11, 45, 11), 'away');
  assert.equal(checkMatchOutcome(9, 9, 0, 11), 'draw');
  assert.equal(checkMatchOutcome(6, 4, 30, 11), null);

  const clamped = clampToCourt({ x: 50, y: 0, z: -50 });
  assert.ok(clamped.x <= 8 && clamped.z >= -14);
});

test('computeHoopLockedYaw always faces the enemy hoop even when backpedaling or strafing', () => {
  const inputs: Array<[number, number]> = [
    [0, 1],   // S (backpedal)
    [0, -1],  // W (forward)
    [-1, 0],  // A (left)
    [1, 0],   // D (right)
    [1, 1],   // S+D
  ];
  for (const [mx, mz] of inputs) {
    const yawHome = computeHoopLockedYaw(2, 3, HOOP_AWAY_Z, mx, mz);
    const toAwayLen = Math.hypot(-2, HOOP_AWAY_Z - 3);
    const dotHome =
      (Math.sin(yawHome) * (-2) + Math.cos(yawHome) * (HOOP_AWAY_Z - 3)) / toAwayLen;
    assert.ok(dotHome > 0.95, `Home dot ${dotHome} should face enemy hoop`);

    const yawAway = computeHoopLockedYaw(-2, -3, HOOP_HOME_Z, mx, mz);
    const toHomeLen = Math.hypot(2, HOOP_HOME_Z + 3);
    const dotAway =
      (Math.sin(yawAway) * 2 + Math.cos(yawAway) * (HOOP_HOME_Z + 3)) / toHomeLen;
    assert.ok(dotAway > 0.95, `Away dot ${dotAway} should face enemy hoop`);
  }
});

test('sampleShotArcPoints arcs above rim and lands on target hoop', () => {
  const pts = sampleShotArcPoints(
    { x: 1.5, y: 1.9, z: -2.0 },
    { x: 0, y: RIM_HEIGHT, z: HOOP_AWAY_Z },
    5.4,
    16,
    GRAVITY
  );
  assert.equal(pts.length, 16);
  const maxY = Math.max(...pts.map((p) => p.y));
  const last = pts[pts.length - 1];
  assert.ok(maxY > RIM_HEIGHT + 1.0);
  assert.ok(Math.abs(last.x) < 1e-4);
  assert.ok(Math.abs(last.z - HOOP_AWAY_Z) < 1e-4);
  assert.ok(Math.abs(last.y - RIM_HEIGHT) < 1e-4);
});
