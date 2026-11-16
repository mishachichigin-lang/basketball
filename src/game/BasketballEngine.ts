import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { sfx } from './audio';
import { CHARACTER_STYLES, type AllCharacterId, type StyleId } from './characters';
import {
  createBasketballArena,
  createBasketballMesh,
  createCharacterRig,
  type ArenaObjects,
  type CharacterRig,
} from './courtAndModels';
import {
  BALL_RADIUS,
  COURT_LENGTH,
  COURT_WIDTH,
  GRAVITY,
  HOOP_AWAY_Z,
  HOOP_HOME_Z,
  RIM_HEIGHT,
  RIM_RADIUS,
  addZoneCharge,
  calculateShotProbability,
  checkMatchOutcome,
  clamp,
  clampToCourt,
  computeHoopLockedYaw,
  computeShotBallVelocity,
  evaluateShotReleaseAccuracy,
  isThreePointer,
  sampleShotArcPoints,
  type MatchWinner,
} from './rules';
import type { PlayerInputPayload, RoomTickPayload } from '../shared/protocol';

export type GameStateMode = 'title' | 'playing' | 'paused' | 'gameover';
export type MatchFormat = '1v1' | '2v2';

export interface HudSnapshot {
  mode: GameStateMode;
  styleId: StyleId;
  matchFormat: MatchFormat;
  homeScore: number;
  awayScore: number;
  timeRemaining: number;
  shotClock: number;
  stamina: number;
  zoneCharge: number;
  inZone: boolean;
  zoneRemaining: number;
  cooldownQ: number;
  cooldownE: number;
  isChargingShot: boolean;
  shotCharge: number;
  hasBall: boolean;
  possessionTeam: 'home' | 'away';
  bannerEvent: string | null;
  bannerTone: 'accent' | 'score' | 'zone' | 'alert';
  winner: MatchWinner;
  shotsMade: number;
  shotsAttempted: number;
  stealsCount: number;
  ankleBreaksCount: number;
  muted: boolean;
  isOnline: boolean;
  localTeam: 'home' | 'away';
}

interface PlayerActor {
  id: string;
  styleId: AllCharacterId;
  team: 'home' | 'away';
  isUser: boolean;
  role: 'handler' | 'wing';
  rig: CharacterRig;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  facingYaw: number;
  stunTimer: number;
  dashTimer: number;
  dashVec: THREE.Vector3;
  cloakTimer: number;
  jumpY: number;
  jumpVel: number;
  walkPhase: number;
  inZone: boolean;
  zoneTimer: number;
  aiCooldown: number;
  aiShotWait: number;
}

interface BallState {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  ownerId: string | null;
  inFlight: boolean;
  flightType: 'shot' | 'pass' | 'loose';
  targetTeam: 'home' | 'away' | null;
  passTargetId: string | null;
  shotWillMake: boolean;
  shotPoints: 2 | 3;
  shotTeam: 'home' | 'away';
  shotShooterId: string | null;
  scoredThisFlight: boolean;
  dribblePhase: number;
  pickupCooldown: number;
}

interface Particle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
}

const MAX_PARTICLES = 96;
const TARGET_SCORE = 11;
const MATCH_DURATION = 120; // 2 minutes fast arcade match
const SHOT_CLOCK_MAX = 24;

// Pre-allocated scratch objects (zero GC inside animation loop)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _camDesired = new THREE.Vector3();
const _lookDesired = new THREE.Vector3();
const _lookCurrent = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _tmpColor = new THREE.Color();

export class BasketballEngine {
  private container: HTMLElement;
  private onSnapshot: (snap: HudSnapshot) => void;
  private onDomChargeUpdate?: (charge: number, visible: boolean) => void;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private arena!: ArenaObjects;
  private isSoftwareGl = false;

  private actors: PlayerActor[] = [];
  private ball!: BallState;
  private particleMesh!: THREE.InstancedMesh;
  private aimArcMesh!: THREE.InstancedMesh;
  private aimReticle!: THREE.Mesh;
  private particles: Particle[] = [];
  private particleCursor = 0;

  private keys = new Set<string>();
  private justPressed = new Set<string>();

  private mode: GameStateMode = 'title';
  private styleId: StyleId = 'akashi';
  private matchFormat: MatchFormat = '2v2';

  private homeScore = 0;
  private awayScore = 0;
  private timeRemaining = MATCH_DURATION;
  private shotClock = SHOT_CLOCK_MAX;
  private possessionTeam: 'home' | 'away' = 'home';

  private stamina = 100;
  private zoneCharge = 45; // Start near half so Zone is reachable in a few plays
  private cooldownQ = 0;
  private cooldownE = 0;
  private isChargingShot = false;
  private shotCharge = 0;
  private stealCooldown = 0;

  private hitstopTimer = 0;
  private trauma = 0;
  private tourAngle = 0.65;
  private bannerEvent: string | null = null;
  private bannerTone: 'accent' | 'score' | 'zone' | 'alert' = 'accent';
  private bannerTimer = 0;

  private shotsMade = 0;
  private shotsAttempted = 0;
  private stealsCount = 0;
  private ankleBreaksCount = 0;
  private winner: MatchWinner = null;

  private frameId = 0;
  private lastTime = performance.now();
  private hudEmitAccum = 0;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;

  // Online multiplayer mode state
  private isOnline = false;
  private localPlayerId: string | null = null;
  private onlineInputSink: ((input: PlayerInputPayload) => void) | null = null;
  private onlineActionSink:
    | ((action: 'shoot' | 'skillQ' | 'skillE' | 'skillZ' | 'pass' | 'steal' | 'jump', shotCharge?: number) => void)
    | null = null;
  private onlineTargetActors = new Map<string, { x: number; z: number; jumpY: number; yaw: number }>();
  private onlineTargetBall = new THREE.Vector3(0, BALL_RADIUS, 0);
  private onlineInputAccum = 0;

  constructor(
    container: HTMLElement,
    onSnapshot: (snap: HudSnapshot) => void,
    onDomChargeUpdate?: (charge: number, visible: boolean) => void
  ) {
    this.container = container;
    this.onSnapshot = onSnapshot;
    this.onDomChargeUpdate = onDomChargeUpdate;
    this.initScene();
    this.bindEvents();
    this.rebuildActors();
    this.emitSnapshot(true);
    this.scheduleNextTick();
  }

  private detectSoftwareGl(): boolean {
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    } catch {
      return true;
    }
  }

  private initScene() {
    this.isSoftwareGl = this.detectSoftwareGl();
    const width = Math.max(320, this.container.clientWidth || window.innerWidth);
    const height = Math.max(240, this.container.clientHeight || window.innerHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.tabIndex = 0;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e14);
    this.scene.fog = new THREE.FogExp2(0x0b0e14, 0.017);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(58, width / height, 0.1, 140);
    this.camera.position.set(11, 6.2, 11);
    _lookCurrent.set(0, 1.4, 0);
    this.camera.lookAt(_lookCurrent);

    // Warm Key + Cool Hemisphere Fill + Rim
    const hemi = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.9);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff1dc, 1.85);
    keyLight.position.set(10, 18, 9);
    keyLight.castShadow = !this.isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -16;
    keyLight.shadow.camera.right = 16;
    keyLight.shadow.camera.top = 18;
    keyLight.shadow.camera.bottom = -18;
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 45;
    keyLight.shadow.bias = -0.0005;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.65);
    rimLight.position.set(-12, 10, -14);
    this.scene.add(rimLight);

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.arena = createBasketballArena(maxAniso, this.isSoftwareGl);
    this.scene.add(this.arena.group);

    // Basketball
    const ballMesh = createBasketballMesh(maxAniso);
    this.scene.add(ballMesh);
    this.ball = {
      mesh: ballMesh,
      pos: new THREE.Vector3(0, BALL_RADIUS, 0),
      vel: new THREE.Vector3(),
      ownerId: null,
      inFlight: false,
      flightType: 'loose',
      targetTeam: null,
      passTargetId: null,
      shotWillMake: false,
      shotPoints: 2,
      shotTeam: 'home',
      shotShooterId: null,
      scoredThisFlight: false,
      dribblePhase: 0,
      pickupCooldown: 0,
    };

    // Pooled InstancedMesh Particle Ring Buffer
    const pGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleMesh = new THREE.InstancedMesh(pGeo, pMat, MAX_PARTICLES);
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.frustumCulled = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      _dummy.position.set(0, -50, 0);
      _dummy.scale.setScalar(0.001);
      _dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, _dummy.matrix);
      this.particleMesh.setColorAt(i, _tmpColor.setHex(0xffffff));
      this.particles.push({
        active: false,
        pos: new THREE.Vector3(0, -50, 0),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 0.15,
        color: new THREE.Color(0xffffff),
      });
    }
    this.scene.add(this.particleMesh);

    // 3D Shot Aiming Trajectory Arc (16 pre-allocated glowing spheres) + Rim Target Reticle
    const aimDotGeo = new THREE.SphereGeometry(0.085, 10, 8);
    const aimDotMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });
    this.aimArcMesh = new THREE.InstancedMesh(aimDotGeo, aimDotMat, 16);
    this.aimArcMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.aimArcMesh.frustumCulled = false;
    this.aimArcMesh.visible = false;
    this.scene.add(this.aimArcMesh);

    const reticleGeo = new THREE.RingGeometry(RIM_RADIUS * 1.15, RIM_RADIUS * 1.58, 28);
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    this.aimReticle = new THREE.Mesh(reticleGeo, reticleMat);
    this.aimReticle.rotation.x = -Math.PI / 2;
    this.aimReticle.visible = false;
    this.scene.add(this.aimReticle);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }
  }

  private bindEvents() {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('contextmenu', this.handleContextMenu);

    this.resizeObserver = new ResizeObserver(() => {
      if (this.destroyed) return;
      const w = Math.max(320, this.container.clientWidth || window.innerWidth);
      const h = Math.max(240, this.container.clientHeight || window.innerHeight);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
    this.resizeObserver.observe(this.container);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    const code = e.code;
    if (
      ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code) &&
      this.mode === 'playing'
    ) {
      e.preventDefault();
    }
    if (!this.keys.has(code)) {
      this.justPressed.add(code);
    }
    this.keys.add(code);

    if (code === 'KeyM' && this.mode !== 'title') {
      this.toggleMute();
    }
    if ((code === 'Escape' || code === 'KeyP') && (this.mode === 'playing' || this.mode === 'paused')) {
      if (this.mode === 'playing') this.pauseMatch();
      else this.resumeMatch();
    }
    if (code === 'KeyR' && this.mode === 'playing' && !this.isOnline) {
      this.startMatch();
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private handleBlur = () => {
    this.keys.clear();
    this.justPressed.clear();
  };

  private handleVisibility = () => {
    if (document.hidden) {
      this.keys.clear();
      this.justPressed.clear();
    }
  };

  private handlePointerDown = (e: PointerEvent) => {
    if (this.mode !== 'playing') return;
    if (e.button === 0) {
      this.justPressed.add('MouseLeft');
    } else if (e.button === 2) {
      e.preventDefault();
      this.justPressed.add('MouseRight');
    }
  };

  private handleContextMenu = (e: MouseEvent) => {
    if (this.mode === 'playing') {
      e.preventDefault();
    }
  };

  private clearActors() {
    for (const actor of this.actors) {
      this.scene.remove(actor.rig.root);
    }
    this.actors = [];
  }

  private rebuildActors() {
    this.clearActors();
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    // Pick complementary AI styles
    const teammateStyle: AllCharacterId =
      this.styleId === 'kuroko' ? 'kagami' : this.styleId === 'aomine' ? 'kuroko' : 'midorima';
    const rival1Style: AllCharacterId =
      this.styleId === 'aomine' ? 'akashi' : 'aomine';
    const rival2Style: AllCharacterId =
      this.styleId === 'kuroko' ? 'midorima' : 'kuroko';

    const addActor = (
      id: string,
      styleId: AllCharacterId,
      team: 'home' | 'away',
      isUser: boolean,
      role: 'handler' | 'wing',
      x: number,
      z: number,
      yaw: number
    ) => {
      const rig = createCharacterRig(styleId, team, maxAniso);
      rig.root.position.set(x, 0, z);
      rig.bodyGroup.rotation.y = yaw;
      this.scene.add(rig.root);
      this.actors.push({
        id,
        styleId,
        team,
        isUser,
        role,
        rig,
        pos: new THREE.Vector3(x, 0, z),
        vel: new THREE.Vector3(),
        facingYaw: yaw,
        stunTimer: 0,
        dashTimer: 0,
        dashVec: new THREE.Vector3(),
        cloakTimer: 0,
        jumpY: 0,
        jumpVel: 0,
        walkPhase: 0,
        inZone: false,
        zoneTimer: 0,
        aiCooldown: 0.6,
        aiShotWait: 0,
      });
    };

    // User spawns near center facing -Z (away hoop)
    addActor('user', this.styleId, 'home', true, 'handler', 0, 2.2, Math.PI);
    addActor('rival-1', rival1Style, 'away', false, 'handler', 0, -4.5, 0);

    if (this.matchFormat === '2v2') {
      addActor('mate-1', teammateStyle, 'home', false, 'wing', 4.4, 0.8, Math.PI);
      addActor('rival-2', rival2Style, 'away', false, 'wing', -4.2, -5.2, 0);
    }

    this.resetPositionsForPossession('home');
  }

  private resetPositionsForPossession(team: 'home' | 'away') {
    this.possessionTeam = team;
    this.shotClock = SHOT_CLOCK_MAX;
    this.isChargingShot = false;
    this.shotCharge = 0;
    this.onDomChargeUpdate?.(0, false);

    const user = this.actors.find((a) => a.isUser);
    const mate = this.actors.find((a) => a.id === 'mate-1');
    const r1 = this.actors.find((a) => a.id === 'rival-1');
    const r2 = this.actors.find((a) => a.id === 'rival-2');

    if (team === 'home') {
      if (user) {
        user.pos.set(0, 0, 3.2);
        user.facingYaw = Math.PI;
      }
      if (mate) {
        mate.pos.set(4.5, 0, -2.5);
        mate.facingYaw = Math.PI;
      }
      if (r1) {
        r1.pos.set(0, 0, -3.5);
        r1.facingYaw = 0;
      }
      if (r2) {
        r2.pos.set(-4.0, 0, -4.5);
        r2.facingYaw = 0;
      }
      this.giveBallTo(user ? user.id : null);
    } else {
      if (user) {
        user.pos.set(0, 0, 4.2);
        user.facingYaw = computeHoopLockedYaw(0, 4.2, HOOP_AWAY_Z);
      }
      if (mate) {
        mate.pos.set(-4.0, 0, 5.2);
        mate.facingYaw = 0;
      }
      if (r1) {
        r1.pos.set(0, 0, -3.2);
        r1.facingYaw = 0;
      }
      if (r2) {
        r2.pos.set(4.2, 0, 2.2);
        r2.facingYaw = 0;
      }
      this.giveBallTo(r1 ? r1.id : null);
    }

    for (const a of this.actors) {
      a.vel.set(0, 0, 0);
      a.stunTimer = 0;
      a.dashTimer = 0;
      a.cloakTimer = 0;
      a.jumpY = 0;
      a.jumpVel = 0;
      a.rig.root.position.copy(a.pos);
      a.rig.bodyGroup.rotation.y = a.facingYaw;
    }
  }

  private giveBallTo(actorId: string | null) {
    this.ball.ownerId = actorId;
    this.ball.inFlight = false;
    this.ball.flightType = 'loose';
    this.ball.passTargetId = null;
    this.ball.scoredThisFlight = false;
    this.ball.pickupCooldown = 0.25;
  }

  // Public API for React UI
  public setStyle(styleId: StyleId) {
    if (this.styleId === styleId) return;
    this.styleId = styleId;
    this.rebuildActors();
    this.emitSnapshot(true);
  }

  public setMatchFormat(format: MatchFormat) {
    if (this.matchFormat === format) return;
    this.matchFormat = format;
    this.rebuildActors();
    this.emitSnapshot(true);
  }

  public startMatch() {
    this.isOnline = false;
    this.localPlayerId = null;
    this.mode = 'playing';
    document.body.dataset.state = 'playing';
    this.homeScore = 0;
    this.awayScore = 0;
    this.timeRemaining = MATCH_DURATION;
    this.shotClock = SHOT_CLOCK_MAX;
    this.stamina = 100;
    this.zoneCharge = 45;
    this.cooldownQ = 0;
    this.cooldownE = 0;
    this.stealCooldown = 0;
    this.shotsMade = 0;
    this.shotsAttempted = 0;
    this.stealsCount = 0;
    this.ankleBreaksCount = 0;
    this.winner = null;
    this.bannerEvent = null;
    this.keys.clear();
    this.justPressed.clear();
    this.rebuildActors();
    sfx.playWhistle();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    this.renderer.domElement.focus();
    this.emitSnapshot(true);
  }

  public enterOnlineMatch(
    localPlayerId: string,
    inputSink: (input: PlayerInputPayload) => void,
    actionSink: (
      action: 'shoot' | 'skillQ' | 'skillE' | 'skillZ' | 'pass' | 'steal' | 'jump',
      shotCharge?: number
    ) => void
  ) {
    this.isOnline = true;
    this.localPlayerId = localPlayerId;
    this.onlineInputSink = inputSink;
    this.onlineActionSink = actionSink;
    this.onlineTargetActors.clear();
    this.mode = 'playing';
    document.body.dataset.state = 'playing';
    this.winner = null;
    this.bannerEvent = null;
    this.isChargingShot = false;
    this.shotCharge = 0;
    this.onDomChargeUpdate?.(0, false);
    this.keys.clear();
    this.justPressed.clear();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    this.renderer.domElement.focus();
    this.emitSnapshot(true);
  }

  public exitOnlineMatch() {
    this.isOnline = false;
    this.localPlayerId = null;
    this.onlineInputSink = null;
    this.onlineActionSink = null;
    this.onlineTargetActors.clear();
    this.returnToTitle();
  }

  public applyServerTick(tick: RoomTickPayload) {
    if (!this.isOnline) return;

    // Sync actor rigs idempotently if roster changed
    const sameRoster =
      this.actors.length === tick.actors.length &&
      tick.actors.every((na, i) => this.actors[i]?.id === na.id && this.actors[i]?.styleId === na.styleId && this.actors[i]?.team === na.team);

    if (!sameRoster) {
      this.clearActors();
      const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
      for (const na of tick.actors) {
        const rig = createCharacterRig(na.styleId, na.team, maxAniso);
        rig.root.position.set(na.x, 0, na.z);
        rig.bodyGroup.rotation.y = na.yaw;
        this.scene.add(rig.root);
        this.actors.push({
          id: na.id,
          styleId: na.styleId,
          team: na.team,
          isUser: na.id === this.localPlayerId,
          role: 'handler',
          rig,
          pos: new THREE.Vector3(na.x, 0, na.z),
          vel: new THREE.Vector3(na.vx, 0, na.vz),
          facingYaw: na.yaw,
          stunTimer: na.stunTimer,
          dashTimer: 0,
          dashVec: new THREE.Vector3(),
          cloakTimer: na.cloakTimer,
          jumpY: na.jumpY,
          jumpVel: 0,
          walkPhase: 0,
          inZone: na.inZone,
          zoneTimer: na.zoneTimer,
          aiCooldown: 0,
          aiShotWait: 0,
        });
      }
    }

    for (const na of tick.actors) {
      this.onlineTargetActors.set(na.id, { x: na.x, z: na.z, jumpY: na.jumpY, yaw: na.yaw });
      const local = this.actors.find((a) => a.id === na.id);
      if (local) {
        local.vel.set(na.vx, 0, na.vz);
        local.stunTimer = na.stunTimer;
        local.cloakTimer = na.cloakTimer;
        local.inZone = na.inZone;
        local.zoneTimer = na.zoneTimer;
      }
      if (na.id === this.localPlayerId) {
        if (na.styleId === 'akashi' || na.styleId === 'aomine' || na.styleId === 'kuroko') {
          this.styleId = na.styleId;
        }
        this.stamina = na.stamina;
        this.zoneCharge = na.zoneCharge;
        this.cooldownQ = na.cooldownQ;
        this.cooldownE = na.cooldownE;
      }
    }

    this.homeScore = tick.homeScore;
    this.awayScore = tick.awayScore;
    this.timeRemaining = tick.timeRemaining;
    this.shotClock = tick.shotClock;
    this.possessionTeam = tick.possessionTeam;
    this.ball.ownerId = tick.ball.ownerId;
    this.ball.inFlight = tick.ball.inFlight;
    this.onlineTargetBall.set(tick.ball.x, tick.ball.y, tick.ball.z);

    // Process server-triggered events (SFX, particles, camera trauma, banners)
    for (const evt of tick.events) {
      if (evt.kind === 'sfx') {
        if (evt.sfx === 'swish') sfx.playSwish();
        else if (evt.sfx === 'clank') sfx.playRimClank();
        else if (evt.sfx === 'ankle') sfx.playAnkleBreak();
        else if (evt.sfx === 'zone') sfx.playZoneAwaken();
        else if (evt.sfx === 'whoosh') sfx.playWhoosh();
        else if (evt.sfx === 'whistle') sfx.playWhistle();
        else if (evt.sfx === 'dribble') sfx.playDribble();
      } else if (evt.kind === 'particles' && evt.x !== undefined && evt.z !== undefined) {
        this.spawnParticles(
          new THREE.Vector3(evt.x, evt.y ?? 0.3, evt.z),
          evt.count ?? 14,
          evt.color ?? '#38BDF8',
          4.8,
          0.16,
          0.55
        );
      } else if (evt.kind === 'trauma' && evt.trauma) {
        this.trauma = Math.min(1, this.trauma + evt.trauma);
      } else if (evt.kind === 'banner' && evt.bannerText) {
        this.showBanner(evt.bannerText, evt.bannerTone ?? 'accent', 1.6);
      }
    }

    if (tick.status === 'gameover' && tick.winner) {
      this.winner = tick.winner;
      this.mode = 'gameover';
      document.body.dataset.state = 'gameover';
      this.isChargingShot = false;
      this.onDomChargeUpdate?.(0, false);
    }

    this.emitSnapshot(true);
  }

  public pauseMatch() {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    document.body.dataset.state = 'paused';
    this.keys.clear();
    this.justPressed.clear();
    this.isChargingShot = false;
    this.onDomChargeUpdate?.(0, false);
    this.emitSnapshot(true);
  }

  public resumeMatch() {
    if (this.mode !== 'paused') return;
    this.mode = 'playing';
    document.body.dataset.state = 'playing';
    this.lastTime = performance.now();
    this.renderer.domElement.focus();
    this.emitSnapshot(true);
  }

  public returnToTitle() {
    this.isOnline = false;
    this.localPlayerId = null;
    this.mode = 'title';
    document.body.dataset.state = 'title';
    this.keys.clear();
    this.justPressed.clear();
    this.isChargingShot = false;
    this.onDomChargeUpdate?.(0, false);
    this.rebuildActors();
    this.emitSnapshot(true);
  }

  public toggleMute() {
    sfx.setMuted(!sfx.isMuted());
    this.emitSnapshot(true);
  }

  public triggerSkillFromHud(slot: 'Q' | 'E' | 'Z') {
    if (this.mode !== 'playing') return;
    if (this.isOnline) {
      this.onlineActionSink?.(`skill${slot}` as 'skillQ' | 'skillE' | 'skillZ');
      return;
    }
    this.justPressed.add(`Key${slot}`);
  }

  private showBanner(text: string, tone: 'accent' | 'score' | 'zone' | 'alert' = 'accent', duration = 1.6) {
    this.bannerEvent = text;
    this.bannerTone = tone;
    this.bannerTimer = duration;
    this.emitSnapshot(true);
  }

  private spawnParticles(
    origin: THREE.Vector3,
    count: number,
    colorHex: string,
    speed: number,
    size = 0.16,
    life = 0.55
  ) {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;
      p.active = true;
      p.pos.copy(origin);
      p.pos.y += 0.2 + Math.random() * 0.6;
      const angle = Math.random() * Math.PI * 2;
      const up = 0.35 + Math.random() * 0.9;
      p.vel.set(Math.cos(angle) * speed, up * speed * 0.7, Math.sin(angle) * speed);
      p.maxLife = life * (0.7 + Math.random() * 0.6);
      p.life = p.maxLife;
      p.size = size * (0.75 + Math.random() * 0.5);
      p.color.set(colorHex);
    }
  }

  private scheduleNextTick() {
    if (this.destroyed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(() => {
        if (!this.destroyed) this.tick();
      });
    } else {
      this.frameId = requestAnimationFrame(() => this.tick());
    }
  }

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
    if (!sync) {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    gl.flush();
    const poll = () => {
      if (this.destroyed) return;
      const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick() {
    if (this.destroyed) return;
    const now = performance.now();
    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

    if (this.mode === 'title') {
      this.updateTitleTour(dt);
    } else if (this.mode === 'playing') {
      if (this.isOnline) {
        this.updateOnlinePlaying(dt);
      } else {
        this.updatePlaying(dt);
      }
    }

    this.updateAimIndicator();
    this.updateParticles(dt);
    this.renderer.render(this.scene, this.camera);
    this.justPressed.clear();
    this.scheduleNextTick();
  }

  private updateAimIndicator() {
    const user = this.actors.find((a) => a.isUser);
    const show =
      this.mode === 'playing' &&
      this.isChargingShot &&
      Boolean(user) &&
      this.ball.ownerId === user?.id;

    if (!show || !user) {
      this.aimArcMesh.visible = false;
      this.aimReticle.visible = false;
      return;
    }

    const targetHoopZ = user.team === 'home' ? HOOP_AWAY_Z : HOOP_HOME_Z;
    const startPos = { x: user.pos.x, y: 1.9 + user.jumpY, z: user.pos.z };
    const targetPos = { x: 0, y: RIM_HEIGHT + 0.08, z: targetHoopZ };
    const dist = Math.hypot(user.pos.x, user.pos.z - targetHoopZ);
    const peakY = RIM_HEIGHT + 1.45 + Math.min(2.6, dist * 0.16);
    const pts = sampleShotArcPoints(startPos, targetPos, peakY, 16, GRAVITY);

    const inSweetSpot = this.shotCharge >= 0.72 && this.shotCharge <= 0.88;
    const colorHex = inSweetSpot ? 0x10b981 : 0xf59e0b;
    (this.aimArcMesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
    (this.aimReticle.material as THREE.MeshBasicMaterial).color.setHex(colorHex);

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const scale = 0.7 + 0.45 * Math.sin(((i + 1) / pts.length) * Math.PI);
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.scale.setScalar(scale);
      _dummy.rotation.set(0, 0, 0);
      _dummy.updateMatrix();
      this.aimArcMesh.setMatrixAt(i, _dummy.matrix);
    }
    this.aimArcMesh.instanceMatrix.needsUpdate = true;
    this.aimArcMesh.visible = true;

    const pulse = 1 + 0.09 * Math.sin(performance.now() * 0.014);
    this.aimReticle.position.set(0, RIM_HEIGHT + 0.04, targetHoopZ);
    this.aimReticle.scale.setScalar(pulse);
    this.aimReticle.visible = true;
  }

  private updateOnlinePlaying(dt: number) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.bannerEvent = null;
        this.emitSnapshot(true);
      }
    }

    const user = this.actors.find((a) => a.isUser);
    const isAway = user?.team === 'away';

    // Map WASD relative to camera view (Home faces -Z, Away faces +Z)
    let rawX = 0;
    let rawZ = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) rawZ -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) rawZ += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) rawX -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) rawX += 1;

    const moveX = isAway ? -rawX : rawX;
    const moveZ = isAway ? -rawZ : rawZ;
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    // Local shot bar charging synced with server release action
    if (user && this.ball.ownerId === user.id) {
      if (this.keys.has('Space')) {
        if (!this.isChargingShot) {
          this.isChargingShot = true;
          this.shotCharge = 0;
        }
        this.shotCharge = Math.min(1, this.shotCharge + dt * 1.25);
        this.onDomChargeUpdate?.(this.shotCharge, true);
        if (this.shotCharge >= 1) {
          this.isChargingShot = false;
          this.onDomChargeUpdate?.(0, false);
          this.onlineActionSink?.('shoot', 1);
          this.shotCharge = 0;
        }
      } else if (this.isChargingShot) {
        this.isChargingShot = false;
        const charge = this.shotCharge;
        this.shotCharge = 0;
        this.onDomChargeUpdate?.(0, false);
        this.onlineActionSink?.('shoot', charge);
      }
    } else {
      if (this.isChargingShot) {
        this.isChargingShot = false;
        this.shotCharge = 0;
        this.onDomChargeUpdate?.(0, false);
      }
      if (this.justPressed.has('Space')) {
        this.onlineActionSink?.('jump');
      }
    }

    if (this.justPressed.has('KeyQ')) this.onlineActionSink?.('skillQ');
    if (this.justPressed.has('KeyE')) this.onlineActionSink?.('skillE');
    if (this.justPressed.has('KeyZ')) this.onlineActionSink?.('skillZ');
    if (this.justPressed.has('KeyF') || this.justPressed.has('MouseRight')) {
      this.onlineActionSink?.('pass');
    }
    if (this.justPressed.has('KeyV') || this.justPressed.has('MouseLeft')) {
      this.onlineActionSink?.('steal');
    }

    this.onlineInputAccum += dt;
    if (this.onlineInputAccum >= 0.033) {
      this.onlineInputAccum = 0;
      this.onlineInputSink?.({
        moveX,
        moveZ,
        sprint,
        chargingShot: this.isChargingShot,
      });
    }

    // Smoothly interpolate actors & ball toward authoritative server positions
    const alpha = 1 - Math.exp(-18 * dt);
    for (const actor of this.actors) {
      const tgt = this.onlineTargetActors.get(actor.id);
      if (tgt) {
        actor.pos.x += (tgt.x - actor.pos.x) * alpha;
        actor.pos.z += (tgt.z - actor.pos.z) * alpha;
        actor.jumpY += (tgt.jumpY - actor.jumpY) * alpha;
        actor.facingYaw = tgt.yaw;
      }
      if (actor.inZone && Math.random() < 0.35) {
        this.spawnParticles(actor.pos, 1, CHARACTER_STYLES[actor.styleId].zoneAuraColor, 2.2, 0.11, 0.35);
      }
      this.updateActorVisuals(actor, dt);
    }

    if (this.ball.ownerId) {
      const owner = this.actors.find((a) => a.id === this.ball.ownerId);
      if (owner) {
        this.ball.dribblePhase += dt * (Math.hypot(owner.vel.x, owner.vel.z) > 0.5 ? 11 : 6.5);
        const bounceSin = Math.abs(Math.sin(this.ball.dribblePhase));
        const handX = Math.cos(owner.facingYaw) * 0.36 + Math.sin(owner.facingYaw) * 0.42;
        const handZ = -Math.sin(owner.facingYaw) * 0.36 + Math.cos(owner.facingYaw) * 0.42;
        const ballY =
          owner.isUser && this.isChargingShot ? 1.9 + owner.jumpY : BALL_RADIUS + bounceSin * 0.85;
        this.ball.pos.set(owner.pos.x + handX, ballY, owner.pos.z + handZ);
      }
    } else {
      this.ball.pos.lerp(this.onlineTargetBall, alpha);
    }
    this.ball.mesh.position.copy(this.ball.pos);
    this.ball.mesh.rotation.x += dt * 7;

    this.updateCamera(dt);
  }

  private updateTitleTour(dt: number) {
    this.tourAngle += dt * 0.24;
    const radius = 12.2;
    _camDesired.set(Math.sin(this.tourAngle) * radius, 5.2, Math.cos(this.tourAngle) * radius);
    const k = 1 - Math.exp(-3.5 * dt);
    this.camera.position.lerp(_camDesired, k);
    _lookDesired.set(0, 1.55, 0);
    _lookCurrent.lerp(_lookDesired, k);
    this.camera.lookAt(_lookCurrent);

    // Subtle idle breathing and ball spin on user hero
    const t = performance.now() * 0.002;
    for (const a of this.actors) {
      a.rig.bodyGroup.position.y = Math.sin(t + a.pos.x) * 0.03;
      if (this.ball.ownerId === a.id) {
        const bounce = Math.abs(Math.sin(t * 2.2)) * 0.65;
        this.ball.pos.set(a.pos.x + 0.52, BALL_RADIUS + bounce, a.pos.z - 0.3);
        this.ball.mesh.position.copy(this.ball.pos);
        this.ball.mesh.rotation.y += dt * 2.5;
      }
    }
  }

  private updatePlaying(dt: number) {
    // Hitstop ticks in real dt while simulation pauses
    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      this.updateCamera(dt);
      return;
    }

    // Banner decay
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.bannerEvent = null;
        this.emitSnapshot(true);
      }
    }

    // Match & shot clock
    this.timeRemaining = Math.max(0, this.timeRemaining - dt);
    this.shotClock = Math.max(0, this.shotClock - dt);
    if (this.shotClock <= 0 && !this.ball.inFlight) {
      this.showBanner('24с — Смена владения', 'alert', 1.4);
      sfx.playWhistle();
      this.resetPositionsForPossession(this.possessionTeam === 'home' ? 'away' : 'home');
      return;
    }

    const matchOutcome = checkMatchOutcome(
      this.homeScore,
      this.awayScore,
      this.timeRemaining,
      TARGET_SCORE
    );
    if (matchOutcome) {
      this.winner = matchOutcome;
      this.mode = 'gameover';
      document.body.dataset.state = 'gameover';
      sfx.playWhistle();
      this.emitSnapshot(true);
      return;
    }

    // Cooldowns
    const user = this.actors.find((a) => a.isUser)!;
    const cdRate = user.inZone ? 1.55 : 1;
    this.cooldownQ = Math.max(0, this.cooldownQ - dt * cdRate);
    this.cooldownE = Math.max(0, this.cooldownE - dt * cdRate);
    this.stealCooldown = Math.max(0, this.stealCooldown - dt);
    if (this.ball.pickupCooldown > 0) {
      this.ball.pickupCooldown = Math.max(0, this.ball.pickupCooldown - dt);
    }

    // Update all actors
    for (const actor of this.actors) {
      if (actor.stunTimer > 0) actor.stunTimer = Math.max(0, actor.stunTimer - dt);
      if (actor.cloakTimer > 0) actor.cloakTimer = Math.max(0, actor.cloakTimer - dt);
      if (actor.inZone) {
        actor.zoneTimer -= dt;
        if (Math.random() < 0.35) {
          this.spawnParticles(actor.pos, 1, CHARACTER_STYLES[actor.styleId].zoneAuraColor, 2.2, 0.11, 0.35);
        }
        if (actor.zoneTimer <= 0) {
          actor.inZone = false;
        }
      }

      if (actor.isUser) {
        this.updateUserActor(actor, dt);
      } else {
        this.updateAiActor(actor, dt);
      }

      this.updateActorVisuals(actor, dt);
    }

    this.updateBall(dt);
    this.updateCamera(dt);

    // Throttled HUD updates <= 10Hz
    this.hudEmitAccum += dt;
    if (this.hudEmitAccum >= 0.1) {
      this.hudEmitAccum = 0;
      this.emitSnapshot(false);
    }
  }

  private updateUserActor(user: PlayerActor, dt: number) {
    const style = CHARACTER_STYLES[user.styleId];

    // Zone activation [Z]
    if (this.justPressed.has('KeyZ') && this.zoneCharge >= 100 && !user.inZone) {
      this.zoneCharge = 0;
      user.inZone = true;
      user.zoneTimer = 15;
      this.trauma = Math.min(1, this.trauma + 0.55);
      this.hitstopTimer = 0.05;
      sfx.playZoneAwaken();
      this.spawnParticles(user.pos, 24, style.zoneAuraColor, 6.2, 0.22, 0.7);
      this.showBanner(`Зона: ${style.nameRu}`, 'zone', 2.0);
    }

    if (user.stunTimer > 0) return;

    // Skill Q
    if (this.justPressed.has('KeyQ') && this.cooldownQ <= 0) {
      this.cooldownQ = style.skills[0].cooldown;
      this.executeSkillQ(user);
    }

    // Skill E
    if (this.justPressed.has('KeyE') && this.cooldownE <= 0) {
      this.cooldownE = style.skills[1].cooldown;
      this.executeSkillE(user);
    }

    // Pass [F or Right Click]
    if ((this.justPressed.has('KeyF') || this.justPressed.has('MouseRight')) && this.ball.ownerId === user.id) {
      const mate = this.actors.find((a) => a.team === user.team && !a.isUser);
      if (mate) {
        this.launchPass(user, mate, user.styleId === 'kuroko');
      }
    }

    // Steal / Crossover [V or Left Click]
    if ((this.justPressed.has('KeyV') || this.justPressed.has('MouseLeft')) && this.stealCooldown <= 0) {
      this.stealCooldown = 0.75;
      if (this.ball.ownerId && this.ball.ownerId !== user.id) {
        this.attemptSteal(user, style.stats.stealReach);
      } else if (this.ball.ownerId === user.id) {
        // Quick crossover burst forward toward rim
        user.dashTimer = 0.16;
        user.dashVec.set(Math.sin(user.facingYaw) * 14, 0, Math.cos(user.facingYaw) * 14);
        sfx.playAnkleBreak();
      }
    }

    // Movement input
    let moveX = 0;
    let moveZ = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveZ -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveZ += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveX -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveX += 1;

    const sprinting = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && this.stamina > 4;
    if (sprinting && (moveX !== 0 || moveZ !== 0)) {
      this.stamina = Math.max(0, this.stamina - dt * 26);
    } else {
      this.stamina = Math.min(100, this.stamina + dt * 18);
    }

    let speed = style.stats.speed;
    if (sprinting) speed *= 1.28;
    if (user.inZone) speed *= user.styleId === 'aomine' ? 1.42 : 1.32;
    if (user.cloakTimer > 0) speed *= 1.35;
    if (this.isChargingShot) speed *= 0.35;

    if (user.dashTimer > 0) {
      user.dashTimer = Math.max(0, user.dashTimer - dt);
      user.pos.addScaledVector(user.dashVec, dt);
    } else if (moveX !== 0 || moveZ !== 0) {
      const len = Math.hypot(moveX, moveZ);
      const nx = moveX / len;
      const nz = moveZ / len;
      user.vel.set(nx * speed, 0, nz * speed);
      user.pos.addScaledVector(user.vel, dt);
    } else {
      user.vel.set(0, 0, 0);
    }

    // Always face toward enemy hoop (never turn back to rim even when backpedaling/strafing)
    user.facingYaw = computeHoopLockedYaw(user.pos.x, user.pos.z, HOOP_AWAY_Z, moveX, moveZ);

    const clamped = clampToCourt(user.pos);
    user.pos.set(clamped.x, 0, clamped.z);

    // Shooting (hold Space when owning ball, release to shoot) or Jump contest when defending
    if (this.ball.ownerId === user.id) {
      if (this.keys.has('Space')) {
        if (!this.isChargingShot) {
          this.isChargingShot = true;
          this.shotCharge = 0;
        }
        this.shotCharge = Math.min(1, this.shotCharge + dt * 1.25);
        this.onDomChargeUpdate?.(this.shotCharge, true);

        // Face target hoop while aiming
        const dx = 0 - user.pos.x;
        const dz = HOOP_AWAY_Z - user.pos.z;
        user.facingYaw = Math.atan2(dx, dz);

        if (this.shotCharge >= 1) {
          this.releaseUserShot(user);
        }
      } else if (this.isChargingShot) {
        this.releaseUserShot(user);
      }
    } else {
      if (this.isChargingShot) {
        this.isChargingShot = false;
        this.onDomChargeUpdate?.(0, false);
      }
      if (this.justPressed.has('Space') && user.jumpY <= 0.01) {
        user.jumpVel = 6.8;
        sfx.playWhoosh();
      }
    }
  }

  private releaseUserShot(user: PlayerActor, isFormless = false, isPhantom = false) {
    this.isChargingShot = false;
    const accuracy = isFormless || isPhantom ? 0.94 : evaluateShotReleaseAccuracy(this.shotCharge);
    this.shotCharge = 0;
    this.onDomChargeUpdate?.(0, false);
    this.launchShot(user, accuracy, isFormless, isPhantom);
  }

  private executeSkillQ(user: PlayerActor) {
    const style = CHARACTER_STYLES[user.styleId];
    let inX = 0;
    let inZ = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) inZ -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) inZ += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) inX -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) inX += 1;
    const inLen = Math.hypot(inX, inZ);
    const dirX = inLen > 0 ? inX / inLen : Math.sin(user.facingYaw);
    const dirZ = inLen > 0 ? inZ / inLen : Math.cos(user.facingYaw);

    if (user.styleId === 'akashi') {
      // Ankle Break: knock down nearby opponents
      user.dashTimer = 0.24;
      user.dashVec.set(dirX * 15, 0, dirZ * 15);
      let brokeAny = false;
      for (const other of this.actors) {
        if (other.team !== user.team && other.pos.distanceTo(user.pos) <= 4.2) {
          other.stunTimer = 2.2;
          brokeAny = true;
          this.spawnParticles(other.pos, 14, style.primaryColor, 4.5, 0.16, 0.5);
        }
      }
      if (brokeAny) {
        this.ankleBreaksCount++;
        this.hitstopTimer = 0.05;
        this.trauma = Math.min(1, this.trauma + 0.42);
        this.zoneCharge = addZoneCharge(this.zoneCharge, 18);
        sfx.playAnkleBreak();
        this.showBanner('ANKLE BREAK · Акаши', 'accent', 1.5);
      } else {
        sfx.playWhoosh();
      }
    } else if (user.styleId === 'aomine') {
      // Mirage Dash
      user.dashTimer = 0.28;
      user.dashVec.set(dirX * 22, 0, dirZ * 22);
      this.zoneCharge = addZoneCharge(this.zoneCharge, 10);
      this.spawnParticles(user.pos, 16, style.secondaryColor, 5.2, 0.14, 0.45);
      sfx.playWhoosh();
      this.showBanner('Рывок Миража · Аомине', 'accent', 1.2);
    } else if (user.styleId === 'kuroko') {
      // Vanishing Drive: phantom cloak + stun nearest blocker
      user.cloakTimer = 1.8;
      user.dashTimer = 0.22;
      user.dashVec.set(dirX * 16, 0, dirZ * 16);
      for (const other of this.actors) {
        if (other.team !== user.team && other.pos.distanceTo(user.pos) <= 3.5) {
          other.stunTimer = 1.4;
        }
      }
      this.zoneCharge = addZoneCharge(this.zoneCharge, 14);
      this.spawnParticles(user.pos, 18, style.primaryColor, 4.2, 0.13, 0.55);
      sfx.playWhoosh();
      this.showBanner('Vanishing Drive · Куроко', 'accent', 1.4);
    }
  }

  private executeSkillE(user: PlayerActor) {
    const style = CHARACTER_STYLES[user.styleId];

    if (user.styleId === 'akashi') {
      // Emperor Eye Steal (if defending) or Precision Stepback (if offense)
      const owner = this.actors.find((a) => a.id === this.ball.ownerId);
      if (owner && owner.team !== user.team && owner.pos.distanceTo(user.pos) <= 4.4) {
        this.giveBallTo(user.id);
        owner.stunTimer = 1.3;
        this.stealsCount++;
        this.hitstopTimer = 0.055;
        this.trauma = Math.min(1, this.trauma + 0.4);
        this.zoneCharge = addZoneCharge(this.zoneCharge, 24);
        this.spawnParticles(owner.pos, 18, '#F59E0B', 5.0, 0.16, 0.5);
        sfx.playAnkleBreak();
        this.showBanner('Глаз Императора · Перехват!', 'accent', 1.5);
      } else {
        user.dashTimer = 0.2;
        user.dashVec.set(0, 0, 14);
        sfx.playWhoosh();
        this.showBanner('Шаг Императора', 'accent', 1.1);
      }
    } else if (user.styleId === 'aomine') {
      // Formless Shot if owning ball, else aggressive lunge steal
      if (this.ball.ownerId === user.id) {
        this.releaseUserShot(user, true, false);
        this.showBanner('Formless Shot · Аомине!', 'accent', 1.5);
      } else {
        this.attemptSteal(user, 3.6);
      }
    } else if (user.styleId === 'kuroko') {
      if (this.ball.ownerId === user.id) {
        const mate = this.actors.find((a) => a.team === user.team && !a.isUser);
        if (mate) {
          this.launchPass(user, mate, true);
          this.zoneCharge = addZoneCharge(this.zoneCharge, 15);
          this.showBanner('Ignite Pass · Куроко!', 'accent', 1.4);
        } else {
          this.releaseUserShot(user, false, true);
          this.showBanner('Phantom Shot · Куроко!', 'accent', 1.4);
        }
      } else {
        this.attemptSteal(user, 3.4);
      }
    }
  }

  private attemptSteal(actor: PlayerActor, reach: number) {
    const owner = this.actors.find((a) => a.id === this.ball.ownerId);
    if (!owner || owner.team === actor.team) return;

    const dist = actor.pos.distanceTo(owner.pos);
    if (dist <= reach) {
      const successChance = actor.inZone ? 0.85 : owner.cloakTimer > 0 ? 0.15 : 0.62;
      if (Math.random() <= successChance) {
        this.giveBallTo(actor.id);
        owner.stunTimer = 0.85;
        if (actor.isUser) {
          this.stealsCount++;
          this.zoneCharge = addZoneCharge(this.zoneCharge, 20);
          this.showBanner('Перехват!', 'accent', 1.2);
        }
        this.hitstopTimer = 0.04;
        sfx.playAnkleBreak();
        this.spawnParticles(actor.pos, 12, '#38BDF8', 4.2, 0.14, 0.4);
        return;
      }
    }
    sfx.playWhoosh();
  }

  private launchPass(passer: PlayerActor, target: PlayerActor, isIgnite: boolean) {
    this.ball.ownerId = null;
    this.ball.inFlight = true;
    this.ball.flightType = 'pass';
    this.ball.passTargetId = target.id;
    this.ball.targetTeam = passer.team;
    this.ball.pos.set(passer.pos.x, 1.55, passer.pos.z);

    const speed = isIgnite ? 28 : CHARACTER_STYLES[passer.styleId].stats.passSpeed;
    _v1.set(target.pos.x - passer.pos.x, 0.1, target.pos.z - passer.pos.z).normalize();
    this.ball.vel.copy(_v1).multiplyScalar(speed);
    this.ball.vel.y = isIgnite ? 1.4 : 3.2;

    if (isIgnite) {
      this.spawnParticles(passer.pos, 16, '#22D3EE', 5.5, 0.14, 0.45);
    }
    sfx.playWhoosh();
  }

  private launchShot(
    shooter: PlayerActor,
    releaseAccuracy: number,
    isFormless: boolean,
    isPhantom: boolean
  ) {
    const targetHoopZ = shooter.team === 'home' ? HOOP_AWAY_Z : HOOP_HOME_Z;
    let nearestDef = 99;
    for (const other of this.actors) {
      if (other.team !== shooter.team && other.stunTimer <= 0) {
        const d = other.pos.distanceTo(shooter.pos);
        if (d < nearestDef) nearestDef = d;
      }
    }

    const prob = calculateShotProbability({
      shooterId: shooter.styleId,
      shooterPos: shooter.pos,
      targetHoopZ,
      releaseAccuracy,
      nearestDefenderDist: nearestDef,
      inZone: shooter.inZone,
      isFormlessShot: isFormless,
      isPhantomShot: isPhantom,
    });

    const isMake = Math.random() <= prob;
    const isThree = isThreePointer(shooter.pos.x, shooter.pos.z, targetHoopZ);

    if (shooter.isUser) {
      this.shotsAttempted++;
    }

    shooter.jumpVel = 5.4;
    this.ball.ownerId = null;
    this.ball.inFlight = true;
    this.ball.flightType = 'shot';
    this.ball.shotWillMake = isMake;
    this.ball.shotPoints = isThree ? 3 : 2;
    this.ball.shotTeam = shooter.team;
    this.ball.shotShooterId = shooter.id;
    this.ball.scoredThisFlight = false;
    this.ball.pos.set(shooter.pos.x, 2.25, shooter.pos.z);

    // Target rim center on make, slightly off-rim on miss
    const missOffsetX = isMake ? 0 : (Math.random() > 0.5 ? 1 : -1) * (0.34 + Math.random() * 0.25);
    const missOffsetZ = isMake ? 0 : (Math.random() - 0.5) * 0.45;
    const targetRim = { x: missOffsetX, y: RIM_HEIGHT + (isMake ? 0.08 : 0.15), z: targetHoopZ + missOffsetZ };
    const dist = Math.hypot(shooter.pos.x, shooter.pos.z - targetHoopZ);
    const peakY = RIM_HEIGHT + 1.45 + Math.min(2.6, dist * 0.16) + (isPhantom ? 1.5 : 0);

    const vel = computeShotBallVelocity(this.ball.pos, targetRim, peakY, GRAVITY);
    this.ball.vel.set(vel.x, vel.y, vel.z);

    if (isFormless) {
      this.spawnParticles(shooter.pos, 16, '#38BDF8', 4.6, 0.15, 0.5);
    } else if (isPhantom) {
      this.spawnParticles(shooter.pos, 16, '#22D3EE', 4.6, 0.15, 0.5);
    }
    sfx.playWhoosh();
  }

  private updateAiActor(ai: PlayerActor, dt: number) {
    if (ai.stunTimer > 0) return;

    const style = CHARACTER_STYLES[ai.styleId];
    ai.aiCooldown = Math.max(0, ai.aiCooldown - dt);
    const hasBall = this.ball.ownerId === ai.id;
    const attackingHoopZ = ai.team === 'home' ? HOOP_AWAY_Z : HOOP_HOME_Z;
    const defendingHoopZ = ai.team === 'home' ? HOOP_HOME_Z : HOOP_AWAY_Z;

    let speed = style.stats.speed * 0.88;
    if (ai.inZone) speed *= 1.25;

    if (hasBall) {
      // Ball-handler AI: drive toward attacking hoop and shoot when in range
      const distToHoop = Math.hypot(ai.pos.x, ai.pos.z - attackingHoopZ);
      ai.aiShotWait += dt;

      if (ai.team === 'home') {
        // Teammate AI passes back to user if user calls or is closer, else takes open shot!
        const user = this.actors.find((a) => a.isUser);
        if (user && ai.aiShotWait > 0.75 && distToHoop > 5.8) {
          this.launchPass(ai, user, false);
          ai.aiShotWait = 0;
          return;
        }
      }

      if (distToHoop <= 6.8 && ai.aiShotWait >= 0.85) {
        ai.aiShotWait = 0;
        const dx = 0 - ai.pos.x;
        const dz = attackingHoopZ - ai.pos.z;
        ai.facingYaw = Math.atan2(dx, dz);
        this.launchShot(ai, 0.68 + Math.random() * 0.22, ai.styleId === 'aomine', false);
        return;
      }

      // Drive toward sweet spot (x offset weave)
      const weaveX = Math.sin(performance.now() * 0.002 + ai.pos.z) * 2.4;
      const goalZ = attackingHoopZ + (ai.team === 'away' ? -4.8 : 4.8);
      _v1.set(weaveX - ai.pos.x, 0, goalZ - ai.pos.z);
      if (_v1.lengthSq() > 0.1) {
        _v1.normalize();
        ai.pos.addScaledVector(_v1, speed * dt);
        ai.vel.copy(_v1).multiplyScalar(speed);
        ai.facingYaw = Math.atan2(_v1.x, _v1.z);
      }
    } else if (this.possessionTeam === ai.team) {
      // Off-ball Wing AI: space out to opposite corner/wing
      const wingX = ai.role === 'wing' ? (ai.team === 'home' ? 4.8 : -4.8) : 0;
      const wingZ = attackingHoopZ + (ai.team === 'home' ? 4.2 : -4.2);
      _v1.set(wingX - ai.pos.x, 0, wingZ - ai.pos.z);
      if (_v1.lengthSq() > 0.25) {
        _v1.normalize();
        ai.pos.addScaledVector(_v1, speed * 0.85 * dt);
        ai.vel.copy(_v1).multiplyScalar(speed * 0.85);
        ai.facingYaw = Math.atan2(_v1.x, _v1.z);
      } else {
        ai.vel.set(0, 0, 0);
      }
    } else {
      // Defender AI: shadow ball-handler or loose ball
      const handler = this.actors.find((a) => a.id === this.ball.ownerId);
      const targetPos = handler
        ? _v2.set(
            handler.pos.x * 0.82,
            0,
            handler.pos.z + (defendingHoopZ - handler.pos.z) * 0.16
          )
        : this.ball.pos;

      _v1.set(targetPos.x - ai.pos.x, 0, targetPos.z - ai.pos.z);
      const dist = _v1.length();
      if (dist > 0.9) {
        _v1.normalize();
        ai.pos.addScaledVector(_v1, speed * 0.86 * dt);
        ai.vel.copy(_v1).multiplyScalar(speed * 0.86);
        ai.facingYaw = Math.atan2(_v1.x, _v1.z);
      } else {
        ai.vel.set(0, 0, 0);
      }

      // Attempt fair AI steal if hugging ball-handler
      if (handler && handler.cloakTimer <= 0 && ai.aiCooldown <= 0 && ai.pos.distanceTo(handler.pos) < 1.35) {
        ai.aiCooldown = 2.4;
        if (Math.random() < 0.25) {
          this.giveBallTo(ai.id);
          this.showBanner('Соперник перехватил мяч', 'alert', 1.2);
          sfx.playAnkleBreak();
        }
      }
    }

    const clamped = clampToCourt(ai.pos);
    ai.pos.set(clamped.x, 0, clamped.z);
  }

  private updateActorVisuals(actor: PlayerActor, dt: number) {
    const rig = actor.rig;
    // Jump gravity
    if (actor.jumpY > 0 || actor.jumpVel !== 0) {
      actor.jumpY += actor.jumpVel * dt;
      actor.jumpVel -= GRAVITY * dt;
      if (actor.jumpY <= 0) {
        actor.jumpY = 0;
        actor.jumpVel = 0;
      }
    }

    rig.root.position.set(actor.pos.x, 0, actor.pos.z);
    rig.bodyGroup.position.y = actor.jumpY;

    // Smooth yaw turn
    let diff = actor.facingYaw - rig.bodyGroup.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    rig.bodyGroup.rotation.y += diff * Math.min(1, dt * 14);

    // Ankle break tumble vs running gait
    if (actor.stunTimer > 0) {
      rig.bodyGroup.rotation.x = -Math.PI * 0.36;
      rig.bodyGroup.position.y = 0.22;
      rig.leftArm.rotation.x = -0.9;
      rig.rightArm.rotation.x = -0.9;
    } else {
      rig.bodyGroup.rotation.x = 0;
      const moveSpeed = Math.hypot(actor.vel.x, actor.vel.z);
      if (moveSpeed > 0.4) {
        actor.walkPhase += moveSpeed * dt * 2.1;
        const swing = Math.sin(actor.walkPhase) * 0.65;
        rig.leftLeg.rotation.x = swing;
        rig.rightLeg.rotation.x = -swing;
        rig.leftArm.rotation.x = -swing * 0.7;
        rig.rightArm.rotation.x = this.ball.ownerId === actor.id ? -0.55 : swing * 0.7;
      } else {
        rig.leftLeg.rotation.x *= 0.8;
        rig.rightLeg.rotation.x *= 0.8;
        rig.leftArm.rotation.x *= 0.8;
        rig.rightArm.rotation.x = this.ball.ownerId === actor.id ? -0.55 : rig.rightArm.rotation.x * 0.8;
      }
    }

    // Kuroko Vanishing Drive ghost opacity
    const targetOpacity = actor.cloakTimer > 0 ? 0.26 : 1;
    for (const mat of rig.transparentMaterials) {
      mat.opacity = targetOpacity;
    }

    // Zone aura ring & eye trails
    rig.zoneRing.visible = actor.inZone;
    rig.eyeTrailLeft.visible = actor.inZone;
    rig.eyeTrailRight.visible = actor.inZone;
    if (actor.inZone) {
      rig.zoneRing.rotation.z += dt * 3.5;
    }
  }

  private updateBall(dt: number) {
    const ball = this.ball;
    if (ball.ownerId) {
      const owner = this.actors.find((a) => a.id === ball.ownerId);
      if (!owner) {
        ball.ownerId = null;
        return;
      }
      const prevPhase = ball.dribblePhase;
      ball.dribblePhase += dt * (Math.hypot(owner.vel.x, owner.vel.z) > 0.5 ? 11 : 6.5);
      const bounceSin = Math.abs(Math.sin(ball.dribblePhase));
      if (Math.floor(prevPhase / Math.PI) !== Math.floor(ball.dribblePhase / Math.PI)) {
        sfx.playDribble();
      }
      const handOffsetX = Math.cos(owner.facingYaw) * 0.36 + Math.sin(owner.facingYaw) * 0.42;
      const handOffsetZ = -Math.sin(owner.facingYaw) * 0.36 + Math.cos(owner.facingYaw) * 0.42;
      const ballY = this.isChargingShot && owner.isUser
        ? 1.9 + owner.jumpY
        : BALL_RADIUS + bounceSin * 0.85;

      ball.pos.set(owner.pos.x + handOffsetX, ballY, owner.pos.z + handOffsetZ);
      ball.mesh.position.copy(ball.pos);
      ball.mesh.rotation.x += dt * 4;
      return;
    }

    // Ball in flight or bouncing loose
    ball.vel.y -= GRAVITY * dt;
    const prevY = ball.pos.y;
    ball.pos.addScaledVector(ball.vel, dt);
    ball.mesh.rotation.x += dt * 9;
    ball.mesh.rotation.z += dt * 4;

    // Pass interception / arrival
    if (ball.flightType === 'pass' && ball.passTargetId) {
      const receiver = this.actors.find((a) => a.id === ball.passTargetId);
      if (receiver && receiver.pos.distanceTo(ball.pos) < 1.3 && Math.abs(ball.pos.y - 1.3) < 1.2) {
        this.giveBallTo(receiver.id);
        return;
      }
    }

    // Check scoring when descending through rim plane
    if (ball.flightType === 'shot' && !ball.scoredThisFlight && ball.vel.y < 0) {
      const targetHoopZ = ball.shotTeam === 'home' ? HOOP_AWAY_Z : HOOP_HOME_Z;
      if (prevY >= RIM_HEIGHT && ball.pos.y <= RIM_HEIGHT) {
        const distToRimCenter = Math.hypot(ball.pos.x, ball.pos.z - targetHoopZ);
        if (ball.shotWillMake || distToRimCenter < 0.27) {
          ball.scoredThisFlight = true;
          this.handleScore(ball.shotTeam, ball.shotPoints, ball.shotShooterId);
          ball.vel.x *= 0.2;
          ball.vel.z *= 0.2;
          ball.vel.y = -3.2;
        } else {
          sfx.playRimClank();
          ball.flightType = 'loose';
          ball.vel.y = 3.2;
          ball.vel.x += (Math.random() - 0.5) * 3.5;
          ball.vel.z += (ball.shotTeam === 'home' ? 1 : -1) * 2.8;
        }
      }
    }

    // Floor bounce
    if (ball.pos.y <= BALL_RADIUS) {
      ball.pos.y = BALL_RADIUS;
      ball.vel.y = Math.abs(ball.vel.y) * 0.62;
      ball.vel.x *= 0.78;
      ball.vel.z *= 0.78;
      if (Math.abs(ball.vel.y) > 0.8) sfx.playDribble();
      if (ball.flightType === 'shot' || ball.flightType === 'pass') {
        ball.flightType = 'loose';
      }
    }

    // Court boundary rebound
    if (Math.abs(ball.pos.x) > COURT_WIDTH / 2 - BALL_RADIUS) {
      ball.pos.x = clamp(ball.pos.x, -COURT_WIDTH / 2 + BALL_RADIUS, COURT_WIDTH / 2 - BALL_RADIUS);
      ball.vel.x *= -0.7;
    }
    if (Math.abs(ball.pos.z) > COURT_LENGTH / 2 - BALL_RADIUS) {
      ball.pos.z = clamp(ball.pos.z, -COURT_LENGTH / 2 + BALL_RADIUS, COURT_LENGTH / 2 - BALL_RADIUS);
      ball.vel.z *= -0.7;
    }

    // Rebound / loose ball pickup
    if (ball.pickupCooldown <= 0 && ball.flightType === 'loose' && ball.pos.y < 1.8) {
      for (const actor of this.actors) {
        if (actor.stunTimer <= 0 && actor.pos.distanceTo(ball.pos) < 1.15) {
          this.possessionTeam = actor.team;
          this.shotClock = SHOT_CLOCK_MAX;
          this.giveBallTo(actor.id);
          break;
        }
      }
    }

    ball.mesh.position.copy(ball.pos);
  }

  private handleScore(team: 'home' | 'away', points: 2 | 3, shooterId: string | null) {
    if (team === 'home') this.homeScore += points;
    else this.awayScore += points;

    const shooter = this.actors.find((a) => a.id === shooterId);
    if (shooter?.isUser) {
      this.shotsMade++;
      this.zoneCharge = addZoneCharge(this.zoneCharge, points === 3 ? 28 : 22);
    }

    const hoopZ = team === 'home' ? HOOP_AWAY_Z : HOOP_HOME_Z;
    this.spawnParticles(new THREE.Vector3(0, RIM_HEIGHT, hoopZ), 22, '#FBBF24', 5.2, 0.16, 0.65);
    this.trauma = Math.min(1, this.trauma + 0.32);
    this.hitstopTimer = 0.045;
    sfx.playSwish();

    const scorerName = shooter ? CHARACTER_STYLES[shooter.styleId].nameRu : 'Команда';
    this.showBanner(`+${points} · ${scorerName}`, 'score', 1.7);

    // Check immediate match win
    const outcome = checkMatchOutcome(this.homeScore, this.awayScore, this.timeRemaining, TARGET_SCORE);
    if (outcome) {
      this.winner = outcome;
      this.mode = 'gameover';
      document.body.dataset.state = 'gameover';
      sfx.playWhistle();
      this.emitSnapshot(true);
      return;
    }

    // Reset possession to conceding team after brief moment via immediate inbound placement
    const nextTeam = team === 'home' ? 'away' : 'home';
    this.resetPositionsForPossession(nextTeam);
    this.emitSnapshot(true);
  }

  private updateCamera(dt: number) {
    const user = this.actors.find((a) => a.isUser);
    if (!user) return;

    const isAway = user.team === 'away';
    const dirZ = isAway ? -1 : 1; // Home camera stays at +Z looking -Z; Away camera stays at -Z looking +Z
    const offsetZ = (user.inZone ? 8.8 : 8.2) * dirZ;
    const offsetY = user.inZone ? 5.6 : 5.3;

    _camDesired.set(
      clamp(user.pos.x * 0.78, -6.8, 6.8),
      offsetY,
      clamp(user.pos.z + offsetZ, -COURT_LENGTH / 2 - 5.8, COURT_LENGTH / 2 + 5.8)
    );
    const lookAheadZ = isAway
      ? Math.max(user.pos.z + 6.5, 3.0)
      : Math.min(user.pos.z - 6.5, -3.0);
    _lookDesired.set(user.pos.x * 0.55, 1.3, lookAheadZ);

    const k = 1 - Math.exp(-7.5 * dt);
    this.camera.position.lerp(_camDesired, k);
    _lookCurrent.lerp(_lookDesired, k);

    // Subtle FOV boost in Zone
    const targetFov = user.inZone ? 66 : 58;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov += (targetFov - this.camera.fov) * k;
      this.camera.updateProjectionMatrix();
    }

    this.camera.lookAt(_lookCurrent);

    // Decaying trauma^2 camera shake
    if (this.trauma > 0) {
      const shake = this.trauma * this.trauma * 0.25;
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
      this.trauma = Math.max(0, this.trauma - dt * 1.9);
    }
  }

  private updateParticles(dt: number) {
    let anyChanged = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyChanged = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        _dummy.position.set(0, -50, 0);
        _dummy.scale.setScalar(0.001);
        _dummy.updateMatrix();
        this.particleMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      p.vel.y -= 9.8 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const scale = p.size * (p.life / p.maxLife);
      _dummy.position.copy(p.pos);
      _dummy.scale.setScalar(Math.max(0.01, scale));
      _dummy.rotation.set(p.life * 6, p.life * 4, 0);
      _dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, _dummy.matrix);
      this.particleMesh.setColorAt(i, p.color);
    }
    if (anyChanged) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor) {
        this.particleMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private emitSnapshot(force: boolean) {
    if (!force && this.destroyed) return;
    const user = this.actors.find((a) => a.isUser);
    this.onSnapshot({
      mode: this.mode,
      styleId: this.styleId,
      matchFormat: this.matchFormat,
      homeScore: this.homeScore,
      awayScore: this.awayScore,
      timeRemaining: this.timeRemaining,
      shotClock: this.shotClock,
      stamina: this.stamina,
      zoneCharge: this.zoneCharge,
      inZone: Boolean(user?.inZone),
      zoneRemaining: user?.zoneTimer ?? 0,
      cooldownQ: this.cooldownQ,
      cooldownE: this.cooldownE,
      isChargingShot: this.isChargingShot,
      shotCharge: this.shotCharge,
      hasBall: this.ball.ownerId === user?.id,
      possessionTeam: this.possessionTeam,
      bannerEvent: this.bannerEvent,
      bannerTone: this.bannerTone,
      winner: this.winner,
      shotsMade: this.shotsMade,
      shotsAttempted: this.shotsAttempted,
      stealsCount: this.stealsCount,
      ankleBreaksCount: this.ankleBreaksCount,
      muted: sfx.isMuted(),
      isOnline: this.isOnline,
      localTeam: user?.team ?? 'home',
    });
  }

  public dispose() {
    this.destroyed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('contextmenu', this.handleContextMenu);
    this.resizeObserver?.disconnect();

    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
