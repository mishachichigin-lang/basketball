import * as THREE from 'three';
import { CHARACTER_STYLES, type AllCharacterId } from './characters';
import {
  BALL_RADIUS,
  COURT_LENGTH,
  COURT_WIDTH,
  HOOP_AWAY_Z,
  HOOP_HOME_Z,
  RIM_HEIGHT,
  RIM_RADIUS,
  THREE_POINT_RADIUS,
} from './rules';

export interface CharacterRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  zoneRing: THREE.Mesh;
  eyeTrailLeft: THREE.Mesh;
  eyeTrailRight: THREE.Mesh;
  shadowDisc: THREE.Mesh;
  jerseyMeshes: THREE.Mesh[];
  transparentMaterials: THREE.MeshStandardMaterial[];
}

function createSoftShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.24)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCourtTexture(maxAnisotropy: number): {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const w = 1024;
  const h = 1792;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Maple hardwood planks
  const plankCols = 24;
  const plankRows = 56;
  const pw = w / plankCols;
  const ph = h / plankRows;

  for (let r = 0; r < plankRows; r++) {
    for (let c = 0; c < plankCols; c++) {
      const seed = Math.sin(r * 19.31 + c * 47.17) * 43758.5453;
      const frac = seed - Math.floor(seed);
      const lightness = 56 + (frac - 0.5) * 10;
      const hue = 32 + (frac - 0.5) * 4;
      ctx.fillStyle = `hsl(${hue}, 44%, ${lightness}%)`;
      const x = c * pw;
      const y = r * ph;
      ctx.fillRect(x, y, pw + 0.5, ph + 0.5);
      ctx.strokeStyle = 'rgba(70, 42, 18, 0.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, pw, ph);
    }
  }

  // Outer apron border (deep navy/obsidian stadium trim)
  const apronPx = 36;
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = apronPx * 2;
  ctx.strokeRect(0, 0, w, h);

  // Inner playable court area in pixels
  const courtPxW = w - apronPx * 2;
  const courtPxH = h - apronPx * 2;
  const pxPerMeterX = courtPxW / COURT_WIDTH;
  const pxPerMeterZ = courtPxH / COURT_LENGTH;
  const toPxX = (mx: number) => w / 2 + mx * pxPerMeterX;
  const toPxY = (mz: number) => h / 2 + mz * pxPerMeterZ;

  // Painted keys (home + away)
  const paintW = 4.6 * pxPerMeterX;
  const paintH = 5.4 * pxPerMeterZ;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.fillRect(w / 2 - paintW / 2, apronPx, paintW, paintH);
  ctx.fillRect(w / 2 - paintW / 2, h - apronPx - paintH, paintW, paintH);

  // Center circle + Kuroko Zero court crest
  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 1.9 * pxPerMeterX, 0, Math.PI * 2);
  ctx.fill();

  // Stylized geometric basketball + "ZERO" crest at center
  ctx.strokeStyle = '#F8FAFC';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 1.9 * pxPerMeterX, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#38BDF8';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 1.25 * pxPerMeterX, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#F8FAFC';
  ctx.font = 'bold 42px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ZERO', w / 2, h / 2);

  // Crisp court lines
  ctx.strokeStyle = '#F8FAFC';
  ctx.lineWidth = 5;

  // Boundary
  ctx.strokeRect(apronPx, apronPx, courtPxW, courtPxH);

  // Half-court line
  ctx.beginPath();
  ctx.moveTo(apronPx, h / 2);
  ctx.lineTo(w - apronPx, h / 2);
  ctx.stroke();

  // Key outlines + Free throw circles
  ctx.strokeRect(w / 2 - paintW / 2, apronPx, paintW, paintH);
  ctx.strokeRect(w / 2 - paintW / 2, h - apronPx - paintH, paintW, paintH);

  ctx.beginPath();
  ctx.arc(w / 2, apronPx + paintH, 1.8 * pxPerMeterX, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w / 2, h - apronPx - paintH, 1.8 * pxPerMeterX, 0, Math.PI * 2);
  ctx.stroke();

  // 3-point arcs (Away -Z hoop at top of canvas, Home +Z hoop at bottom)
  const rPx = THREE_POINT_RADIUS * pxPerMeterX;
  const cornerX = 6.4 * pxPerMeterX;
  const awayHoopY = toPxY(HOOP_AWAY_Z);
  const homeHoopY = toPxY(HOOP_HOME_Z);

  ctx.beginPath();
  ctx.moveTo(w / 2 - cornerX, apronPx);
  ctx.lineTo(w / 2 - cornerX, awayHoopY + 1.4 * pxPerMeterZ);
  ctx.arc(w / 2, awayHoopY, rPx, Math.PI * 0.85, Math.PI * 0.15, true);
  ctx.lineTo(w / 2 + cornerX, apronPx);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(w / 2 - cornerX, h - apronPx);
  ctx.lineTo(w / 2 - cornerX, homeHoopY - 1.4 * pxPerMeterZ);
  ctx.arc(w / 2, homeHoopY, rPx, -Math.PI * 0.85, -Math.PI * 0.15, false);
  ctx.lineTo(w / 2 + cornerX, h - apronPx);
  ctx.stroke();

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;

  // Glossy hardwood roughness variation map
  const rCanvas = document.createElement('canvas');
  rCanvas.width = 256;
  rCanvas.height = 256;
  const rCtx = rCanvas.getContext('2d')!;
  rCtx.fillStyle = '#555555'; // low-mid roughness (~0.33)
  rCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 48; i++) {
    rCtx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    rCtx.fillRect((i * 11) % 256, 0, 5, 256);
  }
  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(6, 10);

  return { map, roughnessMap };
}

export function createBasketballMesh(maxAnisotropy: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#EA580C';
  ctx.fillRect(0, 0, 512, 256);

  // Subtle leather grain
  ctx.fillStyle = 'rgba(124, 45, 18, 0.22)';
  for (let i = 0; i < 650; i++) {
    const x = (i * 73) % 512;
    const y = (i * 137) % 256;
    ctx.fillRect(x, y, 2, 2);
  }

  // Basketball black seams
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, 128);
  ctx.lineTo(512, 128);
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.moveTo(384, 0);
  ctx.lineTo(384, 256);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(256, 128, 96, 120, 0, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;

  const geo = new THREE.SphereGeometry(BALL_RADIUS, 24, 20);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: tex,
    roughness: 0.48,
    metalness: 0.04,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

function createJerseyTexture(
  bgHex: string,
  trimHex: string,
  numberStr: string,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 256, 256);

  // Side/collar trim stripes
  ctx.fillStyle = trimHex;
  ctx.fillRect(0, 0, 28, 256);
  ctx.fillRect(228, 0, 28, 256);
  ctx.fillRect(0, 0, 256, 20);

  // Crisp jersey number
  ctx.fillStyle = bgHex === '#F8FAFC' ? '#991B1B' : '#F8FAFC';
  ctx.font = 'bold 118px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(numberStr, 128, 138);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Builds a composite R6-inspired Roblox anime character rig (8+ distinct parts,
 * bottom-center pivot at y = 0, varied roughness/metalness, and Zone eye trails).
 */
export function createCharacterRig(
  styleId: AllCharacterId,
  team: 'home' | 'away',
  maxAnisotropy: number
): CharacterRig {
  const style = CHARACTER_STYLES[styleId];
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const shadowMat = new THREE.MeshBasicMaterial({
    map: createSoftShadowTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.65,
  });
  const shadowDisc = new THREE.Mesh(new THREE.CircleGeometry(0.52, 20), shadowMat);
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.015;
  root.add(shadowDisc);

  const transparentMaterials: THREE.MeshStandardMaterial[] = [];
  const makeMat = (params: THREE.MeshStandardMaterialParameters) => {
    const m = new THREE.MeshStandardMaterial({ ...params, transparent: true, opacity: 1 });
    transparentMaterials.push(m);
    return m;
  };

  const skinMat = makeMat({ color: style.skinColor, roughness: 0.72, metalness: 0.02 });
  const shortsMat = makeMat({
    color: team === 'home' ? style.jerseyBg : style.jerseyTrim,
    roughness: 0.75,
    metalness: 0.05,
  });
  const shoeMat = makeMat({
    color: style.primaryColor,
    roughness: 0.35,
    metalness: 0.15,
  });
  const trimMat = makeMat({
    color: style.secondaryColor,
    roughness: 0.32,
    metalness: 0.25,
  });

  // Legs (hip pivot at y = 0.78)
  const makeLeg = (xOffset: number) => {
    const legPivot = new THREE.Group();
    legPivot.position.set(xOffset, 0.78, 0);

    const shortsLeg = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.28), shortsMat);
    shortsLeg.position.y = -0.17;
    shortsLeg.castShadow = true;
    legPivot.add(shortsLeg);

    const calf = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.34, 0.22), skinMat);
    calf.position.y = -0.5;
    calf.castShadow = true;
    legPivot.add(calf);

    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.14, 0.34), shoeMat);
    shoe.position.set(0, -0.71, 0.04);
    shoe.castShadow = true;
    legPivot.add(shoe);

    return legPivot;
  };

  const leftLeg = makeLeg(-0.16);
  const rightLeg = makeLeg(0.16);
  bodyGroup.add(leftLeg, rightLeg);

  // Torso (Jersey with number front & back)
  const jerseyTex = createJerseyTexture(
    team === 'home' ? style.jerseyBg : '#1E293B',
    team === 'home' ? style.jerseyTrim : style.primaryColor,
    style.number,
    maxAnisotropy
  );
  const jerseyMat = makeMat({
    color: 0xffffff,
    map: jerseyTex,
    roughness: 0.68,
    metalness: 0.05,
  });
  const sideMat = makeMat({
    color: team === 'home' ? style.jerseyTrim : style.primaryColor,
    roughness: 0.68,
    metalness: 0.05,
  });
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.72, 0.34),
    [sideMat, sideMat, sideMat, sideMat, jerseyMat, jerseyMat]
  );
  torso.position.y = 1.14;
  torso.castShadow = true;
  bodyGroup.add(torso);

  // Arms (shoulder pivot at y = 1.44)
  const makeArm = (xOffset: number) => {
    const armPivot = new THREE.Group();
    armPivot.position.set(xOffset, 1.44, 0);

    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.56, 0.22), skinMat);
    upper.position.y = -0.26;
    upper.castShadow = true;
    armPivot.add(upper);

    const wristband = new THREE.Mesh(new THREE.BoxGeometry(0.235, 0.11, 0.235), trimMat);
    wristband.position.y = -0.44;
    armPivot.add(wristband);

    return armPivot;
  };

  const leftArm = makeArm(-0.44);
  const rightArm = makeArm(0.44);
  bodyGroup.add(leftArm, rightArm);

  // Head + Anime Hair + Eyes (facing +Z in local space)
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.72, 0);
  bodyGroup.add(headGroup);

  const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.44), skinMat);
  headMesh.castShadow = true;
  headGroup.add(headMesh);

  // Anime eyes (Akashi has heterochromatic red + gold eyes!)
  const leftEyeColor = styleId === 'akashi' ? '#EF4444' : style.eyeColor;
  const rightEyeColor = styleId === 'akashi' ? '#F59E0B' : style.eyeColor;

  const eyeLeft = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.06, 0.02),
    new THREE.MeshStandardMaterial({
      color: leftEyeColor,
      emissive: leftEyeColor,
      emissiveIntensity: 0.4,
      roughness: 0.2,
    })
  );
  eyeLeft.position.set(-0.1, 0.02, 0.222);

  const eyeRight = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.06, 0.02),
    new THREE.MeshStandardMaterial({
      color: rightEyeColor,
      emissive: rightEyeColor,
      emissiveIntensity: 0.4,
      roughness: 0.2,
    })
  );
  eyeRight.position.set(0.1, 0.02, 0.222);
  headGroup.add(eyeLeft, eyeRight);

  // Midorima's iconic glasses frame
  if (styleId === 'midorima') {
    const glassesMat = makeMat({ color: '#0F172A', roughness: 0.25, metalness: 0.7 });
    const rimL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.03), glassesMat);
    rimL.position.set(-0.1, 0.02, 0.235);
    const rimR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.03), glassesMat);
    rimR.position.set(0.1, 0.02, 0.235);
    headGroup.add(rimL, rimR);
  }

  // Stylized multi-part Roblox anime hair
  const hairMat = makeMat({ color: style.hairColor, roughness: 0.52, metalness: 0.08 });
  const hairCrown = new THREE.Mesh(new THREE.BoxGeometry(0.49, 0.17, 0.49), hairMat);
  hairCrown.position.set(0, 0.2, -0.01);
  headGroup.add(hairCrown);

  const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.34, 0.14), hairMat);
  hairBack.position.set(0, 0.05, -0.2);
  headGroup.add(hairBack);

  const bangCount = styleId === 'aomine' ? 4 : 3;
  for (let i = 0; i < bangCount; i++) {
    const spike = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.16, 0.12), hairMat);
    const x = -0.15 + i * (0.3 / Math.max(1, bangCount - 1));
    spike.position.set(x, 0.14, 0.21);
    spike.rotation.x = 0.25;
    spike.rotation.z = (i - 1) * (styleId === 'aomine' ? 0.22 : 0.08);
    headGroup.add(spike);
  }

  // Zone ground aura ring (hidden unless in Zone)
  const zoneRingMat = new THREE.MeshBasicMaterial({
    color: style.zoneAuraColor,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const zoneRing = new THREE.Mesh(new THREE.RingGeometry(0.56, 0.72, 28), zoneRingMat);
  zoneRing.rotation.x = -Math.PI / 2;
  zoneRing.position.y = 0.025;
  zoneRing.visible = false;
  root.add(zoneRing);

  // Zone glowing eye trails (stream backward behind eyes when in Zone)
  const trailGeo = new THREE.BoxGeometry(0.04, 0.04, 0.85);
  const trailMat = new THREE.MeshBasicMaterial({
    color: style.zoneAuraColor,
    transparent: true,
    opacity: 0.85,
  });
  const eyeTrailLeft = new THREE.Mesh(trailGeo, trailMat);
  eyeTrailLeft.position.set(-0.1, 0.04, -0.26);
  eyeTrailLeft.visible = false;
  const eyeTrailRight = new THREE.Mesh(trailGeo, trailMat);
  eyeTrailRight.position.set(0.1, 0.04, -0.26);
  eyeTrailRight.visible = false;
  headGroup.add(eyeTrailLeft, eyeTrailRight);

  return {
    root,
    bodyGroup,
    headGroup,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    zoneRing,
    eyeTrailLeft,
    eyeTrailRight,
    shadowDisc,
    jerseyMeshes: [torso],
    transparentMaterials,
  };
}

export interface ArenaObjects {
  group: THREE.Group;
  rimAway: THREE.Object3D;
  rimHome: THREE.Object3D;
  netAway: THREE.Mesh;
  netHome: THREE.Mesh;
}

export function createBasketballArena(
  maxAnisotropy: number,
  isSoftwareGl: boolean
): ArenaObjects {
  const group = new THREE.Group();

  // Court surface
  const { map: courtMap, roughnessMap } = createCourtTexture(maxAnisotropy);
  const courtGeo = new THREE.PlaneGeometry(COURT_WIDTH + 2.2, COURT_LENGTH + 2.2);
  const courtMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: courtMap,
    roughnessMap,
    roughness: 0.42,
    metalness: 0.06,
  });
  const court = new THREE.Mesh(courtGeo, courtMat);
  court.rotation.x = -Math.PI / 2;
  court.position.y = 0;
  court.receiveShadow = true;
  group.add(court);

  // Surrounding stadium concrete apron (offset by -0.025 to avoid Z-fighting)
  const apronGeo = new THREE.PlaneGeometry(54, 68);
  const apronMat = new THREE.MeshStandardMaterial({
    color: '#0D1321',
    roughness: 0.88,
    metalness: 0.08,
  });
  const apron = new THREE.Mesh(apronGeo, apronMat);
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.025;
  apron.receiveShadow = true;
  group.add(apron);

  // Stadium bleachers on left & right sidelines (stepped geometry)
  const bleacherMat = new THREE.MeshStandardMaterial({
    color: '#1E293B',
    roughness: 0.72,
    metalness: 0.14,
  });
  const railMat = new THREE.MeshStandardMaterial({
    color: '#38BDF8',
    emissive: '#0284C7',
    emissiveIntensity: 0.35,
    roughness: 0.3,
    metalness: 0.6,
  });

  for (const side of [-1, 1]) {
    for (let tier = 0; tier < 4; tier++) {
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.55 + tier * 0.55, COURT_LENGTH + 4),
        bleacherMat
      );
      step.position.set(side * (COURT_WIDTH / 2 + 2.5 + tier * 1.45), (0.55 + tier * 0.55) / 2, 0);
      step.receiveShadow = true;
      group.add(step);
    }
    const accentRail = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.18, COURT_LENGTH + 4),
      railMat
    );
    accentRail.position.set(side * (COURT_WIDTH / 2 + 1.55), 0.75, 0);
    group.add(accentRail);
  }

  // Overhead stadium steel light trusses (landmark framing)
  const trussMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.45, metalness: 0.65 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: '#F8FAFC' });
  for (const zPos of [-9, 0, 9]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(24, 0.35, 0.45), trussMat);
    beam.position.set(0, 10.5, zPos);
    group.add(beam);

    for (const xPos of [-6, 0, 6]) {
      const fixture = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 0.6), bulbMat);
      fixture.position.set(xPos, 10.22, zPos);
      group.add(fixture);
    }
  }

  // Far & near gymnasium end walls + glowing stadium scoreboard fascia
  const wallMat = new THREE.MeshStandardMaterial({
    color: '#111827',
    roughness: 0.85,
    metalness: 0.1,
  });
  const fasciaMat = new THREE.MeshStandardMaterial({
    color: '#0F172A',
    emissive: '#0C4A6E',
    emissiveIntensity: 0.45,
    roughness: 0.35,
    metalness: 0.4,
  });
  const trimGlowMat = new THREE.MeshBasicMaterial({ color: '#38BDF8' });

  for (const zSign of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(34, 11, 0.6), wallMat);
    wall.position.set(0, 5.5, zSign * 19.5);
    group.add(wall);

    // Upper stadium ribbon banner & jumbotron housing behind hoop
    const ribbon = new THREE.Mesh(new THREE.BoxGeometry(18, 1.35, 0.4), fasciaMat);
    ribbon.position.set(0, 7.6, zSign * 19.05);
    group.add(ribbon);

    const ribbonLine = new THREE.Mesh(new THREE.BoxGeometry(18, 0.08, 0.44), trimGlowMat);
    ribbonLine.position.set(0, 6.9, zSign * 19.05);
    group.add(ribbonLine);

    // Vertical gym wall columns for depth cues
    for (const colX of [-11, -5.5, 5.5, 11]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.65, 11, 0.85), bleacherMat);
      col.position.set(colX, 5.5, zSign * 19.1);
      group.add(col);
    }
  }

  // Hoops (Away hoop at -Z, Home hoop at +Z; stanchion sits outside baseline)
  const buildHoop = (hoopZ: number, facingDir: 1 | -1) => {
    const hoopGroup = new THREE.Group();
    hoopGroup.position.set(0, 0, hoopZ - facingDir * 2.1);

    const padMat = new THREE.MeshStandardMaterial({ color: '#0F172A', roughness: 0.65, metalness: 0.1 });
    const poleMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.32, metalness: 0.7 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xe2e8f0,
      roughness: 0.12,
      metalness: 0.05,
      transparent: true,
      opacity: isSoftwareGl ? 0.38 : 0.42,
      clearcoat: 0.9,
    });
    const rimMat = new THREE.MeshStandardMaterial({
      color: '#F97316',
      roughness: 0.35,
      metalness: 0.45,
    });

    // Base pad & stanchion post (outside baseline at ±14.5)
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.35, 0.95), padMat);
    base.position.set(0, 0.675, 0);
    base.castShadow = true;
    hoopGroup.add(base);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 3.6, 12), poleMat);
    pole.position.set(0, 1.8, 0);
    pole.castShadow = true;
    hoopGroup.add(pole);

    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 2.05), poleMat);
    arm.position.set(0, 3.4, facingDir * 1.0);
    hoopGroup.add(arm);

    // Glass backboard + white shooter's square
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.15, 0.06), glassMat);
    board.position.set(0, 3.45, facingDir * 1.92);
    hoopGroup.add(board);

    const frameMat = new THREE.MeshBasicMaterial({ color: '#F8FAFC' });
    const sqW = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.07), frameMat);
    sqW.position.set(0, 3.55, facingDir * 1.93);
    const sqB = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.07), frameMat);
    sqB.position.set(0, 3.12, facingDir * 1.93);
    hoopGroup.add(sqW, sqB);

    // Orange Rim centered exactly at (0, RIM_HEIGHT, hoopZ)
    const rimCenterLocalZ = facingDir * 2.1; // Because hoopGroup is at hoopZ - facingDir*2.1
    const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM_RADIUS, 0.028, 10, 24), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, RIM_HEIGHT, rimCenterLocalZ);
    hoopGroup.add(rim);

    // Braided white net cone
    const netGeo = new THREE.CylinderGeometry(RIM_RADIUS * 0.95, RIM_RADIUS * 0.56, 0.48, 12, 1, true);
    const netMat = new THREE.MeshBasicMaterial({
      color: '#F8FAFC',
      wireframe: true,
      transparent: true,
      opacity: 0.72,
    });
    const net = new THREE.Mesh(netGeo, netMat);
    net.position.set(0, RIM_HEIGHT - 0.25, rimCenterLocalZ);
    hoopGroup.add(net);

    group.add(hoopGroup);
    return { rim, net };
  };

  const awayHoop = buildHoop(HOOP_AWAY_Z, 1);
  const homeHoop = buildHoop(HOOP_HOME_Z, -1);

  return {
    group,
    rimAway: awayHoop.rim,
    rimHome: homeHoop.rim,
    netAway: awayHoop.net,
    netHome: homeHoop.net,
  };
}
