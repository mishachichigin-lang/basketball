import { CHARACTER_STYLES, type AllCharacterId, type StyleId } from '../src/game/characters.ts';
import {
  BALL_RADIUS,
  COURT_LENGTH,
  COURT_WIDTH,
  GRAVITY,
  HOOP_AWAY_Z,
  HOOP_HOME_Z,
  RIM_HEIGHT,
  addZoneCharge,
  calculateShotProbability,
  checkMatchOutcome,
  clamp,
  clampToCourt,
  computeHoopLockedYaw,
  computeShotBallVelocity,
  evaluateShotReleaseAccuracy,
  isThreePointer,
  type MatchWinner,
} from '../src/game/rules.ts';
import type {
  NetActorState,
  NetBallState,
  NetEventEffect,
  OnlineModeType,
  PlayerInputPayload,
  RoomMemberInfo,
  RoomTickPayload,
} from '../src/shared/protocol.ts';

const MATCH_DURATION = 120;
const SHOT_CLOCK_MAX = 24;
const TARGET_SCORE = 11;

interface ServerActor {
  id: string;
  name: string;
  styleId: AllCharacterId;
  team: 'home' | 'away';
  isHuman: boolean;
  role: 'handler' | 'wing';
  x: number;
  z: number;
  vx: number;
  vz: number;
  jumpY: number;
  jumpVel: number;
  yaw: number;
  stunTimer: number;
  dashTimer: number;
  dashVx: number;
  dashVz: number;
  cloakTimer: number;
  inZone: boolean;
  zoneTimer: number;
  stamina: number;
  zoneCharge: number;
  cooldownQ: number;
  cooldownE: number;
  stealCooldown: number;
  input: PlayerInputPayload;
  aiCooldown: number;
  aiShotWait: number;
}

interface ServerBall {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ownerId: string | null;
  inFlight: boolean;
  flightType: 'shot' | 'pass' | 'loose';
  passTargetId: string | null;
  shotWillMake: boolean;
  shotPoints: 2 | 3;
  shotTeam: 'home' | 'away';
  shotShooterId: string | null;
  scoredThisFlight: boolean;
  pickupCooldown: number;
}

export class GameRoom {
  public readonly code: string;
  public status: 'lobby' | 'playing' | 'gameover' = 'lobby';
  public modeType: OnlineModeType = 'pvp1v1';
  public members: RoomMemberInfo[] = [];

  private actors: ServerActor[] = [];
  private ball: ServerBall = {
    x: 0,
    y: BALL_RADIUS,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    ownerId: null,
    inFlight: false,
    flightType: 'loose',
    passTargetId: null,
    shotWillMake: false,
    shotPoints: 2,
    shotTeam: 'home',
    shotShooterId: null,
    scoredThisFlight: false,
    pickupCooldown: 0,
  };

  public homeScore = 0;
  public awayScore = 0;
  public timeRemaining = MATCH_DURATION;
  public shotClock = SHOT_CLOCK_MAX;
  public possessionTeam: 'home' | 'away' = 'home';
  public winner: MatchWinner = null;

  private pendingEvents: NetEventEffect[] = [];

  constructor(code: string, modeType: OnlineModeType = 'pvp1v1') {
    this.code = code;
    this.modeType = modeType;
  }

  public addMember(id: string, name: string, styleId: StyleId): RoomMemberInfo {
    const cleanName = name.trim().slice(0, 18);
    const existing = this.members.find((m) => m.id === id);
    if (existing) {
      existing.connected = true;
      if (cleanName) existing.name = cleanName;
      if (styleId) existing.styleId = styleId;
      return existing;
    }

    const isHost = this.members.length === 0;
    const team = this.assignTeam(this.members.length);
    const member: RoomMemberInfo = {
      id,
      name: cleanName || `Игрок ${this.members.length + 1}`,
      styleId,
      team,
      isHost,
      connected: true,
    };
    this.members.push(member);
    return member;
  }

  public markDisconnected(id: string): boolean {
    const member = this.members.find((m) => m.id === id);
    if (!member) return false;
    member.connected = false;
    return true;
  }

  private assignTeam(index: number): 'home' | 'away' {
    if (this.modeType === 'coop2v2') {
      return index < 2 ? 'home' : 'away';
    }
    return index % 2 === 0 ? 'home' : 'away';
  }

  public removeMember(id: string) {
    const idx = this.members.findIndex((m) => m.id === id);
    if (idx === -1) return;
    const wasHost = this.members[idx].isHost;
    this.members.splice(idx, 1);

    if (wasHost && this.members.length > 0) {
      this.members[0].isHost = true;
    }

    // Rebalance teams in lobby
    if (this.status === 'lobby') {
      this.members.forEach((m, i) => {
        m.team = this.assignTeam(i);
      });
    } else {
      this.actors = this.actors.filter((a) => a.id !== id);
      if (this.ball.ownerId === id) {
        this.ball.ownerId = null;
        this.ball.inFlight = true;
        this.ball.flightType = 'loose';
      }
    }
  }

  public updateMemberProfile(
    id: string,
    updates: { styleId?: StyleId; name?: string; modeType?: OnlineModeType }
  ) {
    const member = this.members.find((m) => m.id === id);
    if (!member) return;
    if (updates.styleId) member.styleId = updates.styleId;
    if (updates.name !== undefined) {
      member.name = updates.name.trim().slice(0, 18) || member.name;
    }
    if (updates.modeType && member.isHost && this.status === 'lobby') {
      this.modeType = updates.modeType;
      this.members.forEach((m, i) => {
        m.team = this.assignTeam(i);
      });
    }
  }

  public startMatch(requesterId: string): boolean {
    const requester = this.members.find((m) => m.id === requesterId);
    if (!requester || !requester.isHost) return false;
    if (this.members.length === 0) return false;

    this.status = 'playing';
    this.homeScore = 0;
    this.awayScore = 0;
    this.timeRemaining = MATCH_DURATION;
    this.shotClock = SHOT_CLOCK_MAX;
    this.winner = null;
    this.pendingEvents = [];

    this.actors = [];
    this.members.forEach((m, i) => {
      this.actors.push(
        this.makeActor(
          m.id,
          m.name,
          m.styleId,
          m.team,
          true,
          i === 0 ? 'handler' : 'wing'
        )
      );
    });

    // Ensure opponent(s) exist even if testing or playing Co-op 2v2 vs bots
    const homeCount = this.actors.filter((a) => a.team === 'home').length;
    const awayCount = this.actors.filter((a) => a.team === 'away').length;

    if (this.modeType === 'coop2v2') {
      if (homeCount < 2) {
        this.actors.push(this.makeActor('bot-home-1', 'Куроко (Бот)', 'kuroko', 'home', false, 'wing'));
      }
      if (awayCount < 1) {
        this.actors.push(this.makeActor('bot-away-1', 'Аомине (Бот)', 'aomine', 'away', false, 'handler'));
      }
      if (this.actors.filter((a) => a.team === 'away').length < 2) {
        this.actors.push(this.makeActor('bot-away-2', 'Мидорима (Бот)', 'midorima', 'away', false, 'wing'));
      }
    } else if (awayCount === 0) {
      this.actors.push(this.makeActor('bot-away-1', 'Аомине (Бот)', 'aomine', 'away', false, 'handler'));
    }

    this.resetPositionsForPossession('home');
    this.pendingEvents.push({ kind: 'sfx', sfx: 'whistle' });
    return true;
  }

  private makeActor(
    id: string,
    name: string,
    styleId: AllCharacterId,
    team: 'home' | 'away',
    isHuman: boolean,
    role: 'handler' | 'wing'
  ): ServerActor {
    return {
      id,
      name,
      styleId,
      team,
      isHuman,
      role,
      x: 0,
      z: team === 'home' ? 3.2 : -3.5,
      vx: 0,
      vz: 0,
      jumpY: 0,
      jumpVel: 0,
      yaw: team === 'home' ? Math.PI : 0,
      stunTimer: 0,
      dashTimer: 0,
      dashVx: 0,
      dashVz: 0,
      cloakTimer: 0,
      inZone: false,
      zoneTimer: 0,
      stamina: 100,
      zoneCharge: 45,
      cooldownQ: 0,
      cooldownE: 0,
      stealCooldown: 0,
      input: { moveX: 0, moveZ: 0, sprint: false, chargingShot: false },
      aiCooldown: 0.6,
      aiShotWait: 0,
    };
  }

  private resetPositionsForPossession(team: 'home' | 'away') {
    this.possessionTeam = team;
    this.shotClock = SHOT_CLOCK_MAX;

    const homeActors = this.actors.filter((a) => a.team === 'home');
    const awayActors = this.actors.filter((a) => a.team === 'away');

    homeActors.forEach((a, idx) => {
      a.x = idx === 0 ? 0 : 4.2;
      a.z = team === 'home' ? (idx === 0 ? 3.2 : -2.2) : (idx === 0 ? 4.2 : 5.2);
      a.yaw = a.isHuman ? computeHoopLockedYaw(a.x, a.z, HOOP_AWAY_Z) : team === 'home' ? Math.PI : 0;
      a.vx = 0;
      a.vz = 0;
      a.stunTimer = 0;
      a.dashTimer = 0;
      a.cloakTimer = 0;
      a.jumpY = 0;
      a.jumpVel = 0;
    });

    awayActors.forEach((a, idx) => {
      a.x = idx === 0 ? 0 : -4.2;
      a.z = team === 'home' ? (idx === 0 ? -3.5 : -4.5) : (idx === 0 ? -3.2 : 2.2);
      a.yaw = a.isHuman ? computeHoopLockedYaw(a.x, a.z, HOOP_HOME_Z) : 0;
      a.vx = 0;
      a.vz = 0;
      a.stunTimer = 0;
      a.dashTimer = 0;
      a.cloakTimer = 0;
      a.jumpY = 0;
      a.jumpVel = 0;
    });

    const starter = team === 'home' ? homeActors[0] : awayActors[0];
    this.giveBallTo(starter ? starter.id : null);
  }

  private giveBallTo(actorId: string | null) {
    this.ball.ownerId = actorId;
    this.ball.inFlight = false;
    this.ball.flightType = 'loose';
    this.ball.passTargetId = null;
    this.ball.scoredThisFlight = false;
    this.ball.pickupCooldown = 0.25;
  }

  public setPlayerInput(playerId: string, input: PlayerInputPayload) {
    const actor = this.actors.find((a) => a.id === playerId);
    if (!actor) return;
    actor.input = {
      moveX: clamp(Number(input.moveX) || 0, -1, 1),
      moveZ: clamp(Number(input.moveZ) || 0, -1, 1),
      sprint: Boolean(input.sprint),
      chargingShot: Boolean(input.chargingShot),
    };
  }

  public handlePlayerAction(
    playerId: string,
    action: 'shoot' | 'skillQ' | 'skillE' | 'skillZ' | 'pass' | 'steal' | 'jump',
    shotCharge = 0.8
  ) {
    if (this.status !== 'playing') return;
    const actor = this.actors.find((a) => a.id === playerId);
    if (!actor || actor.stunTimer > 0) return;

    const style = CHARACTER_STYLES[actor.styleId];

    if (action === 'shoot' && this.ball.ownerId === actor.id) {
      const accuracy = evaluateShotReleaseAccuracy(shotCharge);
      this.launchShot(actor, accuracy, false, false);
      return;
    }

    if (action === 'jump' && this.ball.ownerId !== actor.id && actor.jumpY <= 0.01) {
      actor.jumpVel = 6.8;
      this.pendingEvents.push({ kind: 'sfx', sfx: 'whoosh' });
      return;
    }

    if (action === 'pass' && this.ball.ownerId === actor.id) {
      const mate = this.actors.find((a) => a.team === actor.team && a.id !== actor.id);
      if (mate) {
        this.launchPass(actor, mate, actor.styleId === 'kuroko');
      }
      return;
    }

    if (action === 'steal' && actor.stealCooldown <= 0) {
      actor.stealCooldown = 0.75;
      if (this.ball.ownerId && this.ball.ownerId !== actor.id) {
        this.attemptSteal(actor, style.stats.stealReach);
      } else if (this.ball.ownerId === actor.id) {
        actor.dashTimer = 0.16;
        actor.dashVx = -Math.sin(actor.yaw) * 14;
        actor.dashVz = -Math.cos(actor.yaw) * 14;
        this.pendingEvents.push({ kind: 'sfx', sfx: 'ankle' });
      }
      return;
    }

    if (action === 'skillZ' && actor.zoneCharge >= 100 && !actor.inZone) {
      actor.zoneCharge = 0;
      actor.inZone = true;
      actor.zoneTimer = 15;
      this.pendingEvents.push(
        { kind: 'sfx', sfx: 'zone' },
        { kind: 'trauma', trauma: 0.5 },
        { kind: 'particles', x: actor.x, y: 0.4, z: actor.z, color: style.zoneAuraColor, count: 22 },
        { kind: 'banner', bannerText: `Зона: ${actor.name}`, bannerTone: 'zone' }
      );
      return;
    }

    if (action === 'skillQ' && actor.cooldownQ <= 0) {
      actor.cooldownQ = style.skills[0].cooldown;
      this.executeSkillQ(actor);
      return;
    }

    if (action === 'skillE' && actor.cooldownE <= 0) {
      actor.cooldownE = style.skills[1].cooldown;
      this.executeSkillE(actor);
    }
  }

  private executeSkillQ(actor: ServerActor) {
    const style = CHARACTER_STYLES[actor.styleId];
    const inLen = Math.hypot(actor.input.moveX, actor.input.moveZ);
    const dirX = inLen > 0.05 ? actor.input.moveX / inLen : Math.sin(actor.yaw);
    const dirZ = inLen > 0.05 ? actor.input.moveZ / inLen : Math.cos(actor.yaw);

    if (actor.styleId === 'akashi') {
      actor.dashTimer = 0.24;
      actor.dashVx = dirX * 15;
      actor.dashVz = dirZ * 15;
      let brokeAny = false;
      for (const other of this.actors) {
        if (other.team !== actor.team && Math.hypot(other.x - actor.x, other.z - actor.z) <= 4.2) {
          other.stunTimer = 2.2;
          brokeAny = true;
          this.pendingEvents.push({
            kind: 'particles',
            x: other.x,
            y: 0.3,
            z: other.z,
            color: style.primaryColor,
            count: 14,
          });
        }
      }
      if (brokeAny) {
        actor.zoneCharge = addZoneCharge(actor.zoneCharge, 18);
        this.pendingEvents.push(
          { kind: 'sfx', sfx: 'ankle' },
          { kind: 'trauma', trauma: 0.4 },
          { kind: 'banner', bannerText: `ANKLE BREAK · ${actor.name}`, bannerTone: 'accent' }
        );
      } else {
        this.pendingEvents.push({ kind: 'sfx', sfx: 'whoosh' });
      }
    } else if (actor.styleId === 'aomine') {
      actor.dashTimer = 0.28;
      actor.dashVx = dirX * 22;
      actor.dashVz = dirZ * 22;
      actor.zoneCharge = addZoneCharge(actor.zoneCharge, 10);
      this.pendingEvents.push(
        { kind: 'sfx', sfx: 'whoosh' },
        { kind: 'particles', x: actor.x, y: 0.4, z: actor.z, color: style.secondaryColor, count: 16 },
        { kind: 'banner', bannerText: `Рывок Миража · ${actor.name}`, bannerTone: 'accent' }
      );
    } else if (actor.styleId === 'kuroko') {
      actor.cloakTimer = 1.8;
      actor.dashTimer = 0.22;
      actor.dashVx = dirX * 16;
      actor.dashVz = dirZ * 16;
      for (const other of this.actors) {
        if (other.team !== actor.team && Math.hypot(other.x - actor.x, other.z - actor.z) <= 3.5) {
          other.stunTimer = 1.4;
        }
      }
      actor.zoneCharge = addZoneCharge(actor.zoneCharge, 14);
      this.pendingEvents.push(
        { kind: 'sfx', sfx: 'whoosh' },
        { kind: 'particles', x: actor.x, y: 0.4, z: actor.z, color: style.primaryColor, count: 16 },
        { kind: 'banner', bannerText: `Vanishing Drive · ${actor.name}`, bannerTone: 'accent' }
      );
    }
  }

  private executeSkillE(actor: ServerActor) {
    if (actor.styleId === 'akashi') {
      const owner = this.actors.find((a) => a.id === this.ball.ownerId);
      if (owner && owner.team !== actor.team && Math.hypot(owner.x - actor.x, owner.z - actor.z) <= 4.4) {
        this.giveBallTo(actor.id);
        owner.stunTimer = 1.3;
        actor.zoneCharge = addZoneCharge(actor.zoneCharge, 24);
        this.pendingEvents.push(
          { kind: 'sfx', sfx: 'ankle' },
          { kind: 'trauma', trauma: 0.35 },
          { kind: 'particles', x: owner.x, y: 0.5, z: owner.z, color: '#F59E0B', count: 16 },
          { kind: 'banner', bannerText: `Глаз Императора · ${actor.name}`, bannerTone: 'accent' }
        );
      } else {
        actor.dashTimer = 0.2;
        actor.dashVx = Math.sin(actor.yaw) * 14;
        actor.dashVz = Math.cos(actor.yaw) * 14;
        this.pendingEvents.push({ kind: 'sfx', sfx: 'whoosh' });
      }
    } else if (actor.styleId === 'aomine') {
      if (this.ball.ownerId === actor.id) {
        this.launchShot(actor, 0.94, true, false);
        this.pendingEvents.push({ kind: 'banner', bannerText: `Formless Shot · ${actor.name}`, bannerTone: 'accent' });
      } else {
        this.attemptSteal(actor, 3.6);
      }
    } else if (actor.styleId === 'kuroko') {
      if (this.ball.ownerId === actor.id) {
        const mate = this.actors.find((a) => a.team === actor.team && a.id !== actor.id);
        if (mate) {
          this.launchPass(actor, mate, true);
          actor.zoneCharge = addZoneCharge(actor.zoneCharge, 15);
          this.pendingEvents.push({ kind: 'banner', bannerText: `Ignite Pass · ${actor.name}`, bannerTone: 'accent' });
        } else {
          this.launchShot(actor, 0.94, false, true);
          this.pendingEvents.push({ kind: 'banner', bannerText: `Phantom Shot · ${actor.name}`, bannerTone: 'accent' });
        }
      } else {
        this.attemptSteal(actor, 3.4);
      }
    }
  }

  private attemptSteal(actor: ServerActor, reach: number) {
    const owner = this.actors.find((a) => a.id === this.ball.ownerId);
    if (!owner || owner.team === actor.team) return;
    if (Math.hypot(actor.x - owner.x, actor.z - owner.z) <= reach) {
      const chance = actor.inZone ? 0.85 : owner.cloakTimer > 0 ? 0.15 : 0.62;
      if (Math.random() <= chance) {
        this.giveBallTo(actor.id);
        owner.stunTimer = 0.85;
        actor.zoneCharge = addZoneCharge(actor.zoneCharge, 20);
        this.pendingEvents.push(
          { kind: 'sfx', sfx: 'ankle' },
          { kind: 'particles', x: actor.x, y: 0.5, z: actor.z, color: '#38BDF8', count: 12 },
          { kind: 'banner', bannerText: `Перехват · ${actor.name}`, bannerTone: 'accent' }
        );
        return;
      }
    }
    this.pendingEvents.push({ kind: 'sfx', sfx: 'whoosh' });
  }

  private launchPass(passer: ServerActor, target: ServerActor, isIgnite: boolean) {
    this.ball.ownerId = null;
    this.ball.inFlight = true;
    this.ball.flightType = 'pass';
    this.ball.passTargetId = target.id;
    this.ball.x = passer.x;
    this.ball.y = 1.55;
    this.ball.z = passer.z;

    const dx = target.x - passer.x;
    const dz = target.z - passer.z;
    const len = Math.max(0.01, Math.hypot(dx, dz));
    const speed = isIgnite ? 28 : CHARACTER_STYLES[passer.styleId].stats.passSpeed;
    this.ball.vx = (dx / len) * speed;
    this.ball.vz = (dz / len) * speed;
    this.ball.vy = isIgnite ? 1.4 : 3.2;

    this.pendingEvents.push({ kind: 'sfx', sfx: 'whoosh' });
    if (isIgnite) {
      this.pendingEvents.push({ kind: 'particles', x: passer.x, y: 0.8, z: passer.z, color: '#22D3EE', count: 14 });
    }
  }

  private launchShot(
    shooter: ServerActor,
    releaseAccuracy: number,
    isFormless: boolean,
    isPhantom: boolean
  ) {
    const targetHoopZ = shooter.team === 'home' ? HOOP_AWAY_Z : HOOP_HOME_Z;
    let nearestDef = 99;
    for (const other of this.actors) {
      if (other.team !== shooter.team && other.stunTimer <= 0) {
        const d = Math.hypot(other.x - shooter.x, other.z - shooter.z);
        if (d < nearestDef) nearestDef = d;
      }
    }

    const prob = calculateShotProbability({
      shooterId: shooter.styleId,
      shooterPos: { x: shooter.x, y: 0, z: shooter.z },
      targetHoopZ,
      releaseAccuracy,
      nearestDefenderDist: nearestDef,
      inZone: shooter.inZone,
      isFormlessShot: isFormless,
      isPhantomShot: isPhantom,
    });

    const isMake = Math.random() <= prob;
    const isThree = isThreePointer(shooter.x, shooter.z, targetHoopZ);

    shooter.jumpVel = 5.4;
    this.ball.ownerId = null;
    this.ball.inFlight = true;
    this.ball.flightType = 'shot';
    this.ball.shotWillMake = isMake;
    this.ball.shotPoints = isThree ? 3 : 2;
    this.ball.shotTeam = shooter.team;
    this.ball.shotShooterId = shooter.id;
    this.ball.scoredThisFlight = false;
    this.ball.x = shooter.x;
    this.ball.y = 2.25;
    this.ball.z = shooter.z;

    const missX = isMake ? 0 : (Math.random() > 0.5 ? 1 : -1) * (0.35 + Math.random() * 0.25);
    const missZ = isMake ? 0 : (Math.random() - 0.5) * 0.45;
    const dist = Math.hypot(shooter.x, shooter.z - targetHoopZ);
    const peakY = RIM_HEIGHT + 1.45 + Math.min(2.6, dist * 0.16) + (isPhantom ? 1.5 : 0);

    const v = computeShotBallVelocity(
      { x: this.ball.x, y: this.ball.y, z: this.ball.z },
      { x: missX, y: RIM_HEIGHT + (isMake ? 0.08 : 0.15), z: targetHoopZ + missZ },
      peakY,
      GRAVITY
    );
    this.ball.vx = v.x;
    this.ball.vy = v.y;
    this.ball.vz = v.z;
    this.pendingEvents.push({ kind: 'sfx', sfx: 'whoosh' });
  }

  public step(dt: number): RoomTickPayload {
    const events: NetEventEffect[] = [...this.pendingEvents];
    this.pendingEvents = [];

    if (this.status === 'playing') {
      this.timeRemaining = Math.max(0, this.timeRemaining - dt);
      this.shotClock = Math.max(0, this.shotClock - dt);

      if (this.shotClock <= 0 && !this.ball.inFlight) {
        events.push(
          { kind: 'sfx', sfx: 'whistle' },
          { kind: 'banner', bannerText: '24с — Смена владения', bannerTone: 'alert' }
        );
        this.resetPositionsForPossession(this.possessionTeam === 'home' ? 'away' : 'home');
      }

      const outcome = checkMatchOutcome(this.homeScore, this.awayScore, this.timeRemaining, TARGET_SCORE);
      if (outcome) {
        this.winner = outcome;
        this.status = 'gameover';
        events.push({ kind: 'sfx', sfx: 'whistle' });
      } else {
        this.updateActors(dt, events);
        this.updateBall(dt, events);
      }
    }

    return {
      roomCode: this.code,
      status: this.status,
      modeType: this.modeType,
      homeScore: this.homeScore,
      awayScore: this.awayScore,
      timeRemaining: this.timeRemaining,
      shotClock: this.shotClock,
      possessionTeam: this.possessionTeam,
      winner: this.winner,
      actors: this.actors.map<NetActorState>((a) => ({
        id: a.id,
        name: a.name,
        styleId: a.styleId,
        team: a.team,
        x: a.x,
        z: a.z,
        vx: a.vx,
        vz: a.vz,
        jumpY: a.jumpY,
        yaw: a.yaw,
        stunTimer: a.stunTimer,
        cloakTimer: a.cloakTimer,
        inZone: a.inZone,
        zoneTimer: a.zoneTimer,
        stamina: a.stamina,
        zoneCharge: a.zoneCharge,
        cooldownQ: a.cooldownQ,
        cooldownE: a.cooldownE,
      })),
      ball: {
        x: this.ball.x,
        y: this.ball.y,
        z: this.ball.z,
        vx: this.ball.vx,
        vy: this.ball.vy,
        vz: this.ball.vz,
        ownerId: this.ball.ownerId,
        inFlight: this.ball.inFlight,
      },
      events,
    };
  }

  private updateActors(dt: number, events: NetEventEffect[]) {
    if (this.ball.pickupCooldown > 0) {
      this.ball.pickupCooldown = Math.max(0, this.ball.pickupCooldown - dt);
    }

    for (const actor of this.actors) {
      const style = CHARACTER_STYLES[actor.styleId];
      const cdRate = actor.inZone ? 1.55 : 1;
      actor.cooldownQ = Math.max(0, actor.cooldownQ - dt * cdRate);
      actor.cooldownE = Math.max(0, actor.cooldownE - dt * cdRate);
      actor.stealCooldown = Math.max(0, actor.stealCooldown - dt);
      if (actor.stunTimer > 0) actor.stunTimer = Math.max(0, actor.stunTimer - dt);
      if (actor.cloakTimer > 0) actor.cloakTimer = Math.max(0, actor.cloakTimer - dt);
      if (actor.inZone) {
        actor.zoneTimer -= dt;
        if (actor.zoneTimer <= 0) actor.inZone = false;
      }

      // Jump physics
      if (actor.jumpY > 0 || actor.jumpVel !== 0) {
        actor.jumpY += actor.jumpVel * dt;
        actor.jumpVel -= GRAVITY * dt;
        if (actor.jumpY <= 0) {
          actor.jumpY = 0;
          actor.jumpVel = 0;
        }
      }

      if (actor.stunTimer > 0) {
        actor.vx = 0;
        actor.vz = 0;
        continue;
      }

      if (actor.isHuman) {
        const inp = actor.input;
        const moving = Math.abs(inp.moveX) > 0.01 || Math.abs(inp.moveZ) > 0.01;
        const sprinting = inp.sprint && actor.stamina > 4 && moving;
        if (sprinting) actor.stamina = Math.max(0, actor.stamina - dt * 26);
        else actor.stamina = Math.min(100, actor.stamina + dt * 18);

        let speed = style.stats.speed;
        if (sprinting) speed *= 1.28;
        if (actor.inZone) speed *= actor.styleId === 'aomine' ? 1.42 : 1.32;
        if (actor.cloakTimer > 0) speed *= 1.35;
        if (inp.chargingShot && this.ball.ownerId === actor.id) speed *= 0.35;

        if (actor.dashTimer > 0) {
          actor.dashTimer = Math.max(0, actor.dashTimer - dt);
          actor.x += actor.dashVx * dt;
          actor.z += actor.dashVz * dt;
          actor.vx = actor.dashVx;
          actor.vz = actor.dashVz;
        } else if (moving) {
          const len = Math.hypot(inp.moveX, inp.moveZ);
          const nx = inp.moveX / len;
          const nz = inp.moveZ / len;
          actor.vx = nx * speed;
          actor.vz = nz * speed;
          actor.x += actor.vx * dt;
          actor.z += actor.vz * dt;
        } else {
          actor.vx = 0;
          actor.vz = 0;
        }

        const targetHoopZ = actor.team === 'home' ? HOOP_AWAY_Z : HOOP_HOME_Z;
        actor.yaw = computeHoopLockedYaw(
          actor.x,
          actor.z,
          targetHoopZ,
          inp.chargingShot ? 0 : inp.moveX,
          inp.chargingShot ? 0 : inp.moveZ
        );
      } else {
        this.updateBotActor(actor, dt, events);
      }

      const clamped = clampToCourt({ x: actor.x, y: 0, z: actor.z });
      actor.x = clamped.x;
      actor.z = clamped.z;
    }
  }

  private updateBotActor(ai: ServerActor, dt: number, events: NetEventEffect[]) {
    const style = CHARACTER_STYLES[ai.styleId];
    ai.aiCooldown = Math.max(0, ai.aiCooldown - dt);
    const hasBall = this.ball.ownerId === ai.id;
    const attackingHoopZ = ai.team === 'home' ? HOOP_AWAY_Z : HOOP_HOME_Z;
    const defendingHoopZ = ai.team === 'home' ? HOOP_HOME_Z : HOOP_AWAY_Z;
    const speed = style.stats.speed * 0.88;

    if (hasBall) {
      const dist = Math.hypot(ai.x, ai.z - attackingHoopZ);
      ai.aiShotWait += dt;
      if (dist <= 6.8 && ai.aiShotWait >= 0.9) {
        ai.aiShotWait = 0;
        ai.yaw = Math.atan2(-ai.x, attackingHoopZ - ai.z);
        this.launchShot(ai, 0.72 + Math.random() * 0.18, ai.styleId === 'aomine', false);
        return;
      }
      const goalZ = attackingHoopZ + (ai.team === 'away' ? -4.8 : 4.8);
      const dx = 0 - ai.x;
      const dz = goalZ - ai.z;
      const len = Math.max(0.01, Math.hypot(dx, dz));
      ai.vx = (dx / len) * speed;
      ai.vz = (dz / len) * speed;
      ai.x += ai.vx * dt;
      ai.z += ai.vz * dt;
      ai.yaw = Math.atan2(dx, dz);
    } else if (this.possessionTeam === ai.team) {
      const wingX = ai.team === 'home' ? 4.8 : -4.8;
      const wingZ = attackingHoopZ + (ai.team === 'home' ? 4.2 : -4.2);
      const dx = wingX - ai.x;
      const dz = wingZ - ai.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.5) {
        ai.vx = (dx / len) * speed * 0.85;
        ai.vz = (dz / len) * speed * 0.85;
        ai.x += ai.vx * dt;
        ai.z += ai.vz * dt;
        ai.yaw = Math.atan2(dx, dz);
      } else {
        ai.vx = 0;
        ai.vz = 0;
      }
    } else {
      const handler = this.actors.find((a) => a.id === this.ball.ownerId);
      const tx = handler ? handler.x * 0.82 : this.ball.x;
      const tz = handler ? handler.z + (defendingHoopZ - handler.z) * 0.16 : this.ball.z;
      const dx = tx - ai.x;
      const dz = tz - ai.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.9) {
        ai.vx = (dx / len) * speed * 0.86;
        ai.vz = (dz / len) * speed * 0.86;
        ai.x += ai.vx * dt;
        ai.z += ai.vz * dt;
        ai.yaw = Math.atan2(dx, dz);
      } else {
        ai.vx = 0;
        ai.vz = 0;
      }
      if (handler && handler.cloakTimer <= 0 && ai.aiCooldown <= 0 && len < 1.35) {
        ai.aiCooldown = 2.4;
        if (Math.random() < 0.22) {
          this.giveBallTo(ai.id);
          events.push({ kind: 'sfx', sfx: 'ankle' }, { kind: 'banner', bannerText: `${ai.name} перехватил мяч`, bannerTone: 'alert' });
        }
      }
    }
  }

  private updateBall(dt: number, events: NetEventEffect[]) {
    const b = this.ball;
    if (b.ownerId) {
      const owner = this.actors.find((a) => a.id === b.ownerId);
      if (!owner) {
        b.ownerId = null;
        return;
      }
      const handX = Math.cos(owner.yaw) * 0.36 + Math.sin(owner.yaw) * 0.42;
      const handZ = -Math.sin(owner.yaw) * 0.36 + Math.cos(owner.yaw) * 0.42;
      b.x = owner.x + handX;
      b.z = owner.z + handZ;
      b.y = owner.input.chargingShot ? 1.9 + owner.jumpY : 0.45;
      return;
    }

    b.vy -= GRAVITY * dt;
    const prevY = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;

    if (b.flightType === 'pass' && b.passTargetId) {
      const receiver = this.actors.find((a) => a.id === b.passTargetId);
      if (receiver && Math.hypot(receiver.x - b.x, receiver.z - b.z) < 1.35 && Math.abs(b.y - 1.3) < 1.3) {
        this.giveBallTo(receiver.id);
        return;
      }
    }

    if (b.flightType === 'shot' && !b.scoredThisFlight && b.vy < 0) {
      const targetHoopZ = b.shotTeam === 'home' ? HOOP_AWAY_Z : HOOP_HOME_Z;
      if (prevY >= RIM_HEIGHT && b.y <= RIM_HEIGHT) {
        const dist = Math.hypot(b.x, b.z - targetHoopZ);
        if (b.shotWillMake || dist < 0.27) {
          b.scoredThisFlight = true;
          if (b.shotTeam === 'home') this.homeScore += b.shotPoints;
          else this.awayScore += b.shotPoints;

          const shooter = this.actors.find((a) => a.id === b.shotShooterId);
          if (shooter) {
            shooter.zoneCharge = addZoneCharge(shooter.zoneCharge, b.shotPoints === 3 ? 28 : 22);
          }
          events.push(
            { kind: 'sfx', sfx: 'swish' },
            { kind: 'trauma', trauma: 0.32 },
            { kind: 'particles', x: 0, y: RIM_HEIGHT, z: targetHoopZ, color: '#FBBF24', count: 20 },
            { kind: 'banner', bannerText: `+${b.shotPoints} · ${shooter?.name ?? 'Команда'}`, bannerTone: 'score' }
          );

          const outcome = checkMatchOutcome(this.homeScore, this.awayScore, this.timeRemaining, TARGET_SCORE);
          if (outcome) {
            this.winner = outcome;
            this.status = 'gameover';
            events.push({ kind: 'sfx', sfx: 'whistle' });
          } else {
            this.resetPositionsForPossession(b.shotTeam === 'home' ? 'away' : 'home');
          }
          return;
        } else {
          events.push({ kind: 'sfx', sfx: 'clank' });
          b.flightType = 'loose';
          b.vy = 3.2;
          b.vx += (Math.random() - 0.5) * 3.5;
          b.vz += (b.shotTeam === 'home' ? 1 : -1) * 2.8;
        }
      }
    }

    if (b.y <= BALL_RADIUS) {
      b.y = BALL_RADIUS;
      b.vy = Math.abs(b.vy) * 0.62;
      b.vx *= 0.78;
      b.vz *= 0.78;
      if (b.flightType === 'shot' || b.flightType === 'pass') b.flightType = 'loose';
    }

    if (Math.abs(b.x) > COURT_WIDTH / 2 - BALL_RADIUS) {
      b.x = clamp(b.x, -COURT_WIDTH / 2 + BALL_RADIUS, COURT_WIDTH / 2 - BALL_RADIUS);
      b.vx *= -0.7;
    }
    if (Math.abs(b.z) > COURT_LENGTH / 2 - BALL_RADIUS) {
      b.z = clamp(b.z, -COURT_LENGTH / 2 + BALL_RADIUS, COURT_LENGTH / 2 - BALL_RADIUS);
      b.vz *= -0.7;
    }

    if (b.pickupCooldown <= 0 && b.flightType === 'loose' && b.y < 1.8) {
      for (const actor of this.actors) {
        if (actor.stunTimer <= 0 && Math.hypot(actor.x - b.x, actor.z - b.z) < 1.2) {
          this.possessionTeam = actor.team;
          this.shotClock = SHOT_CLOCK_MAX;
          this.giveBallTo(actor.id);
          break;
        }
      }
    }
  }
}
