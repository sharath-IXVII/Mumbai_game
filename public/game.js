import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
THREE.Vector3.prototype.addY = function (h) { this.y += h; return this; };

const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ============================================================ RENDERER
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.75;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 1500);
scene.add(camera);
// HDR render target with 4x MSAA (anti-aliasing survives post-processing)
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
// Ambient occlusion: contact shadows in corners & under objects (High/Ultra only)
const ssao = new SSAOPass(scene, camera, innerWidth, innerHeight);
ssao.kernelRadius = 0.6; ssao.minDistance = 0.0006; ssao.maxDistance = 0.03; ssao.enabled = false;
composer.addPass(ssao);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.5, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// GTA-IV style cinematic grade: desaturated amber/teal look, contrast curve, vignette, film grain, lens fringing
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, sat: { value: 0.78 }, tint: { value: new THREE.Vector3(1.06, 1.0, 0.86) }, shadowTint: { value: new THREE.Vector3(0.92, 0.98, 1.08) }, grainAmt: { value: 0.05 }, vig: { value: 0.42 }, ca: { value: 0.0012 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, sat, grainAmt, vig, ca; uniform vec3 tint, shadowTint; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5; float r2 = dot(d,d);
      vec3 c; c.r = texture2D(tDiffuse, vUv + d*ca*r2*8.0).r; c.g = texture2D(tDiffuse, vUv).g; c.b = texture2D(tDiffuse, vUv - d*ca*r2*8.0).b;
      float l = dot(c, vec3(0.299,0.587,0.114));
      c = mix(vec3(l), c, sat);                                  // desaturate
      c *= mix(shadowTint, tint, smoothstep(0.0, 0.6, l));       // cool shadows, warm highlights
      c = c*c*(3.0-2.0*c)*0.35 + c*0.65;                         // S-curve contrast
      c *= 1.0 - vig * smoothstep(0.1, 0.7, r2*2.0);             // vignette
      c += (rnd(vUv*vec2(1920.,1080.)) - 0.5) * grainAmt;        // film grain
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(grade);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

// ============================================================ REALISTIC CHARACTER MODELS (Mixamo-rigged, animated)
const MODELS = { soldier: null, civilian: null, clips: null };
try {
  $('menuStatus') && ($('menuStatus').textContent = 'Loading characters…');
  const loader = new GLTFLoader();
  const sol = await loader.loadAsync('assets/Soldier.glb'), civ = sol; // one well-animated rig for everyone (lighter download)
  const norm = (g) => { // measure height from the skeleton (bounding boxes of skinned meshes are unreliable)
    g.scene.updateMatrixWorld(true);
    const top = g.scene.getObjectByName('mixamorigHeadTop_End'), head = g.scene.getObjectByName('mixamorigHead');
    const v = new THREE.Vector3(); let hgt;
    const box = new THREE.Box3();
    g.scene.traverse(o => { if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
    hgt = box.isEmpty() ? (top ? top.getWorldPosition(v).y : 1.76) : box.max.y - box.min.y;
    return 1.76 / hgt;
  };
  MODELS.soldier = { scene: sol.scene, scale: norm(sol) };
  MODELS.civilian = { scene: civ.scene, scale: norm(civ) };
  const clip = n => sol.animations.find(a => a.name === n);
  MODELS.clips = { idle: clip('Idle'), walk: clip('Walk'), run: clip('Run') };
  // civilian rig shares bone names: reuse the soldier clips without root translation
  MODELS.civClips = Object.fromEntries(Object.entries(MODELS.clips).map(([k, c]) => [k, new THREE.AnimationClip(k, c.duration, c.tracks.filter(t => !t.name.endsWith('.position')))]));
  for (const m of [sol.scene, civ.scene]) m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  $('menuStatus') && ($('menuStatus').textContent = '');
} catch (err) { console.warn('Character models unavailable, using simple figures', err); }
const animated = []; // {group, mixer, actions, cur, last}
function dressModel(group, { civilian, tint, gun }) {
  const src = civilian ? MODELS.civilian : MODELS.soldier; if (!src) return;
  const model = SkeletonUtils.clone(src.scene); model.scale.multiplyScalar(src.scale);
  model.traverse(o => {
    if (o.isMesh) { o.material = o.material.clone(); o.material.userData.base = o.material.color.clone(); if (tint) o.material.color.multiply(new THREE.Color(tint)); o.raycast = () => { }; }
  });
  group.add(model);
  // hide the simple figure, but keep it as an invisible hit-box for bullets
  group.traverse(o => { if (o.isMesh && !model.getObjectById(o.id) && o.userData.part) o.material.visible = false; });
  if (gun) {
    const hand = model.getObjectByName('mixamorigRightHand');
    const metal = M(0x141414, { metalness: 0.7, roughness: 0.35 });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.62), metal); g.add(body);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.07), metal); mag.position.set(0, -0.1, 0.1); g.add(mag);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.1, 0.2), M(0x3a2a1a)); stock.position.set(0, -0.02, -0.38); g.add(stock);
    if (hand) { model.updateMatrixWorld(true); const ws = hand.getWorldScale(new THREE.Vector3()).x; hand.add(g); g.scale.setScalar(1 / ws); g.position.set(0, 0.08 / ws, 0.03 / ws); g.rotation.set(0, Math.PI / 2, Math.PI / 2); }
  }
  const mixer = new THREE.AnimationMixer(model), clips = civilian ? MODELS.civClips : MODELS.clips;
  const actions = { idle: mixer.clipAction(clips.idle), walk: mixer.clipAction(clips.walk), run: mixer.clipAction(clips.run) };
  actions.idle.play(); mixer.update(Math.random() * 3);
  const rec = { group, mixer, actions, cur: 'idle', last: new THREE.Vector3(), model };
  group.userData.model = model;
  group.userData.anim = rec; animated.push(rec);
}
function updateAnimations(dt) {
  for (const a of animated) {
    const g = a.group; if (!g.visible || !g.parent || (g.parent !== scene && !g.parent.visible)) continue;
    const wp = g.getWorldPosition(tmpA);
    if (wp.distanceToSquared(camera.position) > 110 * 110) { a.last.copy(wp); continue; }
    const sp = dt > 0 ? wp.distanceTo(a.last) / dt : 0; a.last.copy(wp);
    const want = g.userData.dead ? a.cur : sp < 0.35 ? 'idle' : sp < 3.2 ? 'walk' : 'run';
    if (want !== a.cur) { a.actions[want].reset().play(); a.actions[a.cur].crossFadeTo(a.actions[want], 0.25, false); a.cur = want; }
    a.mixer.update(dt);
  }
}
const tmpA = new THREE.Vector3();

// ---- squad outfits: undercover in the city, NSG "Black Cat" tactical gear inside the Taj
const OUTFITS = { casual: 0xb8c8e0, undercover: 0x3a3f4a, tactical: 0x2a2a2c };
function setOutfit(group, outfit) {
  const model = group.userData.model; if (!model || group.userData.outfit === outfit) return;
  group.userData.outfit = outfit;
  model.traverse(o => { if (o.isMesh && o.material.userData.base) o.material.color.copy(o.material.userData.base).multiply(new THREE.Color(OUTFITS[outfit])); });
  const head = model.getObjectByName('mixamorigHead'); if (!head) return;
  if (!group.userData.gear) {
    model.updateMatrixWorld(true); const ws = head.getWorldScale(new THREE.Vector3()).x, u = 1 / ws;
    const gear = { undercover: new THREE.Group(), tactical: new THREE.Group() };
    // undercover: dark baseball cap, sunglasses, earpiece
    const capM = M(0x1a1c22, { roughness: 0.8 });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.115 * u, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), capM); cap.position.y = 0.12 * u; gear.undercover.add(cap);
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * u, 0.09 * u, 0.012 * u, 16, 1, false, -Math.PI / 2, Math.PI), capM); visor.position.set(0, 0.125 * u, 0.07 * u); gear.undercover.add(visor);
    const shades = new THREE.Mesh(new THREE.BoxGeometry(0.15 * u, 0.035 * u, 0.02 * u), new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.05, metalness: 0.6, clearcoat: 1 })); shades.position.set(0, 0.075 * u, 0.1 * u); gear.undercover.add(shades);
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.012 * u, 8, 6), M(0x111111)); ear.position.set(0.085 * u, 0.06 * u, 0.01 * u); gear.undercover.add(ear);
    // tactical: black helmet with NVG mount, balaclava look
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.13 * u, 18, 10, 0, Math.PI * 2, 0, Math.PI / 1.8), M(0x15161a, { roughness: 0.6 })); helmet.position.y = 0.1 * u; gear.tactical.add(helmet);
    const nvg = new THREE.Mesh(new THREE.BoxGeometry(0.05 * u, 0.04 * u, 0.05 * u), M(0x0a0a0a, { metalness: 0.5 })); nvg.position.set(0, 0.17 * u, 0.12 * u); gear.tactical.add(nvg);
    head.add(gear.undercover, gear.tactical); group.userData.gear = gear;
  }
  group.userData.gear.undercover.visible = outfit === 'undercover';
  group.userData.gear.tactical.visible = outfit === 'tactical';
}

// ============================================================ SKY / LIGHT
const sky = new Sky(); sky.scale.setScalar(4000); scene.add(sky);
const su = sky.material.uniforms;
su.turbidity.value = 8; su.rayleigh.value = 2.2; su.mieCoefficient.value = 0.006; su.mieDirectionalG.value = 0.85;
const sun = new THREE.Vector3();
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
const hemi = new THREE.HemisphereLight(0xffe2c0, 0x3a3028, 0.6); scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xffb070, 2.6);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 500 });
sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.04;
scene.add(sunLight, sunLight.target);
scene.fog = new THREE.FogExp2(0xc08a64, 0.0042);

function setSky(elevDeg, azDeg) {
  sun.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevDeg), THREE.MathUtils.degToRad(azDeg));
  su.sunPosition.value.copy(sun);
  const skyScene = new THREE.Scene(); const s2 = new Sky(); s2.scale.setScalar(4000);
  s2.material.uniforms.sunPosition.value.copy(sun);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) s2.material.uniforms[k].value = su[k].value;
  skyScene.add(s2);
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(skyScene); scene.environment = envRT.texture;
}
setSky(4, 250); // golden hour over the Arabian Sea
let night = false;
const stars = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 1.4, color: 0xffffff, fog: false, transparent: true, opacity: 0 }));
{
  const arr = []; for (let i = 0; i < 1500; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(1200); v.y = Math.abs(v.y) + 60; arr.push(v.x, v.y, v.z); }
  stars.geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
}
scene.add(stars);
function setNight() {
  night = true;
  // wet night streets: glossy asphalt with puddles mirroring the lights
  roadSurfaceMat.roughnessMap = puddleTex; roadSurfaceMat.roughness = 1; roadSurfaceMat.metalness = 0.05; roadSurfaceMat.color.set(0x5a5a5a); roadSurfaceMat.needsUpdate = true; roadSurfaceMat.envMapIntensity = 0.5; ground.material.needsUpdate = true;
  grade.uniforms.sat.value = 0.72; grade.uniforms.tint.value.set(1.1, 0.98, 0.82); grade.uniforms.shadowTint.value.set(0.85, 0.95, 1.15);
  su.rayleigh.value = 0.4; su.turbidity.value = 2;
  setSky(-6, 250);
  scene.environmentIntensity = 0.25;
  sunLight.color.set(0x8aa6ff); sunLight.intensity = 0.35; // moonlight
  hemi.color.set(0x5a6a9a); hemi.groundColor.set(0x1a1410); hemi.intensity = 0.25;
  scene.fog.color.set(0x0b0d16); scene.fog.density = 0.006;
  stars.material.opacity = 0.9;
  renderer.toneMappingExposure = 0.9;
  bloom.strength = 0.7; bloom.threshold = 0.9;
  cityLights.forEach(l => l.visible = Q.lights);
  windowMats.forEach(m => m.emissiveIntensity = m.userData.nightGlow ?? 0.45);
}

// ============================================================ TEXTURES
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; if (repeat) t.repeat.set(...repeat);
  t.anisotropy = 8; return t;
}
function grain(ctx, w, h, base, v, n = 9000) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) { const g = rand(-v, v); ctx.fillStyle = `rgba(${g > 0 ? 255 : 0},${g > 0 ? 255 : 0},${g > 0 ? 255 : 0},${Math.abs(g)})`; ctx.fillRect(rand(0, w), rand(0, h), 2, 2); }
}
const asphaltTex = canvasTex(512, 512, (c, w, h) => { grain(c, w, h, '#2c2b2a', 0.08, 30000); for (let i = 0; i < 40; i++) { c.strokeStyle = `rgba(0,0,0,${rand(0.2, 0.5)})`; c.lineWidth = rand(1, 3); c.beginPath(); let x = rand(0, w), y = rand(0, h); c.moveTo(x, y); for (let k = 0; k < 6; k++) c.lineTo(x += rand(-20, 20), y += rand(-20, 20)); c.stroke(); } }, [80, 80]);
// puddle map: dark = wet & glossy (reflects street lights at night, like GTA IV rain-soaked streets)
const puddleTex = canvasTex(512, 512, (c, w, h) => { c.fillStyle = '#e8e8e8'; c.fillRect(0, 0, w, h); for (let i = 0; i < 26; i++) { const x = rand(0, w), y = rand(0, h), r = rand(20, 70); const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, '#101010'); g.addColorStop(0.7, '#303030'); g.addColorStop(1, 'rgba(232,232,232,0)'); c.fillStyle = g; c.beginPath(); c.ellipse(x, y, r, r * rand(0.4, 1), rand(0, 3), 0, 7); c.fill(); } }, [40, 40]);
puddleTex.colorSpace = THREE.NoColorSpace;
const pavTex = canvasTex(256, 256, (c, w, h) => { grain(c, w, h, '#8d867a', 0.07); c.strokeStyle = '#6d675d'; c.lineWidth = 3; for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, h); c.moveTo(0, i * 64); c.lineTo(w, i * 64); c.stroke(); } });
const marbleTex = canvasTex(512, 512, (c, w, h) => {
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { c.fillStyle = (x + y) % 2 ? '#e9e1d2' : '#2a2421'; c.fillRect(x * 64, y * 64, 64, 64); }
  c.globalAlpha = 0.15; c.strokeStyle = '#888'; for (let i = 0; i < 60; i++) { c.beginPath(); c.moveTo(rand(0, w), rand(0, h)); c.bezierCurveTo(rand(0, w), rand(0, h), rand(0, w), rand(0, h), rand(0, w), rand(0, h)); c.stroke(); }
}, [10, 8]);
const woodTex = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#5a3420'; c.fillRect(0, 0, w, h); for (let i = 0; i < 120; i++) { c.strokeStyle = `rgba(30,15,5,${rand(0.1, 0.4)})`; c.beginPath(); const y = rand(0, h); c.moveTo(0, y); c.lineTo(w, y + rand(-6, 6)); c.stroke(); } c.fillStyle = '#3a2010'; for (let x = 0; x < w; x += 64) c.fillRect(x, 0, 4, h); }, [6, 2]);
const stoneTex = canvasTex(256, 256, (c, w, h) => { grain(c, w, h, '#d9c49a', 0.08); c.strokeStyle = '#b39c72'; c.lineWidth = 2; for (let y = 0; y < h; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); for (let x = (y / 32) % 2 * 32; x < w; x += 64) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 32); c.stroke(); } } });

const windowMats = [];
function facade({ floors, cols, wall = '#b9a58a', glass = '#1d2633', lit = 0.35, arched = false, trim = '#efe4cc' }) {
  const W = 512, H = 512, cw = W / cols, fh = H / floors;
  const map = canvasTex(W, H, (c) => {
    grain(c, W, H, wall, 0.06, 6000);
    for (let f = 0; f < floors; f++) {
      c.fillStyle = trim; c.fillRect(0, f * fh + fh - 4, W, 4);
      for (let i = 0; i < cols; i++) {
        const x = i * cw + cw * 0.25, y = f * fh + fh * 0.2, ww = cw * 0.5, hh = fh * 0.58;
        c.fillStyle = trim; c.fillRect(x - 3, y - 3, ww + 6, hh + 6);
        c.fillStyle = glass;
        if (arched) { c.beginPath(); c.moveTo(x, y + hh); c.lineTo(x, y + ww / 2); c.arc(x + ww / 2, y + ww / 2, ww / 2, Math.PI, 0); c.lineTo(x + ww, y + hh); c.fill(); }
        else c.fillRect(x, y, ww, hh);
      }
    }
  });
  const em = canvasTex(W, H, (c) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    for (let f = 0; f < floors; f++) for (let i = 0; i < cols; i++) if (Math.random() < lit) {
      const x = i * cw + cw * 0.25, y = f * fh + fh * 0.2;
      c.fillStyle = ['#ffcf8a', '#ffe0b0', '#cfe3ff', '#ffb066'][i * 7 % 4 + (f % 2)] || '#ffcf8a';
      c.fillRect(x, y, cw * 0.5, fh * 0.58);
    }
  });
  const m = new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 3, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.85, metalness: 0.0 });
  windowMats.push(m); return m;
}

// ============================================================ WORLD HELPERS
const colliders = []; const solids = [];
function addBox(w, h, d, mat, x, y, z, opt = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  if (opt.ry) m.rotation.y = opt.ry;
  m.castShadow = opt.cast !== false; m.receiveShadow = true;
  scene.add(m);
  if (opt.collide !== false) {
    const hw = opt.ry ? Math.max(w, d) / 2 : w / 2, hd = opt.ry ? Math.max(w, d) / 2 : d / 2;
    colliders.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, minY: y, maxY: y + h });
    solids.push(m);
  }
  return m;
}
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o });

// ============================================================ MUMBAI (COLABA) CITY
const cityLights = [];
// open sea all around the peninsula
const sea = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000, 1, 1),
  new THREE.MeshPhysicalMaterial({ color: 0x0c2a3a, roughness: 0.06, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.4 }));
sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.25, 0); scene.add(sea);
// ============================================================ REAL MAP OF SOUTH MUMBAI (roads & coastline traced from real coordinates)
// game frame: the Taj sits at (-40, -100); the harbour (real south-east) is game -Z, real north-east is game +X; 1 unit = 1 metre
function geoToGame(lat, lon) {
  const e = (lon - 72.8330) * 105300, n = (lat - 18.9217) * 110600;
  return new THREE.Vector3(-40 + (e + n) * 0.7071, 0, -100 - (e - n) * 0.7071);
}
const MAP_ROADS = [
  // [name, width(m), [[lat,lon],...]]
  ['P. J. Ramchandani Marg', 12, [[18.92245, 72.83430], [18.92150, 72.83320], [18.92050, 72.83200], [18.91930, 72.83060], [18.91800, 72.82930], [18.91660, 72.82820]]],
  ['Chhatrapati Shivaji Maharaj Marg', 14, [[18.92245, 72.83430], [18.92360, 72.83400], [18.92500, 72.83330], [18.92620, 72.83235]]],
  ['B. K. Boman Behram Marg', 9, [[18.92370, 72.83395], [18.92260, 72.83250], [18.92150, 72.83110], [18.92040, 72.82980]]],
  ['Mahakavi Bhushan Marg', 9, [[18.92260, 72.83250], [18.92400, 72.83215], [18.92560, 72.83190]]],
  ['Colaba Causeway', 14, [[18.92620, 72.83235], [18.92470, 72.83180], [18.92280, 72.83160], [18.92080, 72.83080], [18.91860, 72.82940], [18.91640, 72.82760], [18.91420, 72.82560], [18.91200, 72.82380], [18.90950, 72.82200]]],
  ['Best Marg', 9, [[18.92560, 72.83190], [18.92420, 72.83080], [18.92240, 72.82980], [18.92040, 72.82880], [18.91840, 72.82780]]],
  ['Mereweather Road', 8, [[18.92280, 72.83160], [18.92150, 72.83110]]],
  ['Arthur Bunder Road', 9, [[18.91860, 72.82940], [18.91760, 72.83060], [18.91660, 72.83140]]],
  ['Nathalal Parekh Marg', 10, [[18.92420, 72.82850], [18.92200, 72.82760], [18.91950, 72.82650], [18.91700, 72.82540], [18.91450, 72.82420], [18.91200, 72.82300]]],
  ['Wodehouse Road', 10, [[18.92040, 72.82880], [18.91950, 72.82650], [18.91860, 72.82420]]],
  ['Captain Prakash Pethe Marg', 12, [[18.92300, 72.82300], [18.92000, 72.82250], [18.91700, 72.82200], [18.91400, 72.82130], [18.91100, 72.82050]]],
  ['Hormusji Street', 6, [[18.91640, 72.82760], [18.91700, 72.82540]]],
  ['Madame Cama Road', 14, [[18.92620, 72.83235], [18.92640, 72.83050], [18.92650, 72.82850], [18.92640, 72.82600], [18.92600, 72.82300], [18.92560, 72.82100]]],
  ['Maharshi Karve Road', 14, [[18.92620, 72.83235], [18.92800, 72.83080], [18.93000, 72.82930], [18.93250, 72.82800], [18.93500, 72.82720], [18.93800, 72.82680]]],
  ['Mahatma Gandhi Road', 13, [[18.92620, 72.83235], [18.92850, 72.83230], [18.93050, 72.83210], [18.93250, 72.83180], [18.93500, 72.83260], [18.93800, 72.83400], [18.93990, 72.83520]]],
  ['Veer Nariman Road', 12, [[18.93520, 72.82720], [18.93400, 72.82920], [18.93250, 72.83180]]],
  ['Shahid Bhagat Singh Road', 13, [[18.92620, 72.83235], [18.92900, 72.83380], [18.93200, 72.83560], [18.93550, 72.83680], [18.93900, 72.83750]]],
  ['Dadabhai Naoroji Road', 13, [[18.93250, 72.83180], [18.93500, 72.83380], [18.93750, 72.83470], [18.93990, 72.83520]]],
  ['Marine Drive (Netaji Subhash Rd)', 18, [[18.92560, 72.82100], [18.92900, 72.82160], [18.93300, 72.82220], [18.93700, 72.82270], [18.94100, 72.82260], [18.94450, 72.82200], [18.94750, 72.82060]]],
  ['Free Press Journal Marg', 10, [[18.92600, 72.82300], [18.92900, 72.82160]]],
  ['Jamshedji Tata Road', 10, [[18.92640, 72.82600], [18.93000, 72.82520], [18.93300, 72.82450], [18.93700, 72.82400]]],
  ['Walchand Hirachand Marg', 11, [[18.93550, 72.83680], [18.93800, 72.83900], [18.94000, 72.84050]]],
];
const MAP_COAST = [
  [18.92520, 72.82000], [18.92900, 72.82080], [18.93300, 72.82150], [18.93700, 72.82200], [18.94100, 72.82190], [18.94450, 72.82130], [18.94800, 72.81980], [18.95200, 72.81800],
  [18.95600, 72.82200], [18.95600, 72.84600], [18.94600, 72.84400], [18.93900, 72.84200], [18.93300, 72.83950], [18.92800, 72.83750], [18.92420, 72.83560],
  [18.92300, 72.83530], [18.92160, 72.83500], [18.92140, 72.83440], [18.92200, 72.83420], // Gateway of India promontory
  [18.92110, 72.83330], [18.92010, 72.83210], [18.91890, 72.83080], [18.91740, 72.83200], [18.91600, 72.83200], [18.91560, 72.82900], [18.91400, 72.82700], [18.91100, 72.82450], [18.90800, 72.82250], [18.90500, 72.82050],
  [18.90450, 72.81850], [18.90750, 72.81800], [18.91100, 72.81900], [18.91500, 72.82000], [18.91900, 72.82050], [18.92200, 72.82020],
];
const roads = MAP_ROADS.map(([name, w, pts]) => {
  const P = pts.map(p => geoToGame(p[0], p[1])), cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + P[i].distanceTo(P[i - 1]));
  return { name, w, P, cum, len: cum[cum.length - 1] };
});
function roadPoint(r, s) { // position + unit tangent at distance s along road r
  s = clamp(s, 0, r.len); let i = 1; while (i < r.cum.length - 1 && r.cum[i] < s) i++;
  const a = r.P[i - 1], b = r.P[i], seg = r.cum[i] - r.cum[i - 1] || 1, t = (s - r.cum[i - 1]) / seg;
  const tx = (b.x - a.x) / seg, tz = (b.z - a.z) / seg;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx, tz };
}
const coastPts = MAP_COAST.map(p => { const v = geoToGame(p[0], p[1]); return [v.x, v.z]; });
function onLand(x, z) { let inside = false; for (let i = 0, j = coastPts.length - 1; i < coastPts.length; j = i++) { const [xi, zi] = coastPts[i], [xj, zj] = coastPts[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside; } return inside; }
// spatial hash of road segments for fast "distance to nearest road edge"
const ROAD_CELL = 60, roadGrid = new Map();
roads.forEach((r, ri) => { for (let i = 1; i < r.P.length; i++) { const a = r.P[i - 1], b = r.P[i], pad = r.w; for (let x = Math.floor((Math.min(a.x, b.x) - pad) / ROAD_CELL); x <= Math.floor((Math.max(a.x, b.x) + pad) / ROAD_CELL); x++) for (let z = Math.floor((Math.min(a.z, b.z) - pad) / ROAD_CELL); z <= Math.floor((Math.max(a.z, b.z) + pad) / ROAD_CELL); z++) { const k = x + ',' + z; if (!roadGrid.has(k)) roadGrid.set(k, []); roadGrid.get(k).push([ri, i]); } } });
function roadClearance(x, z) { // metres from (x,z) to the nearest road edge (negative = on a road)
  const segs = roadGrid.get(Math.floor(x / ROAD_CELL) + ',' + Math.floor(z / ROAD_CELL)); if (!segs) return 99;
  let best = 99;
  for (const [ri, i] of segs) { const r = roads[ri], a = r.P[i - 1], b = r.P[i], dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz, t = clamp(((x - a.x) * dx + (z - a.z) * dz) / L, 0, 1); best = Math.min(best, Math.hypot(x - a.x - t * dx, z - a.z - t * dz) - r.w / 2); }
  return best;
}
const roadByName = n => roads.find(r => r.name.startsWith(n));
// ---- land, sea and road surfaces
const landShape = new THREE.Shape(coastPts.map(([x, z]) => new THREE.Vector2(x, -z)));
const landTex = pavTex.clone(); landTex.needsUpdate = true; landTex.repeat.set(0.25, 0.25);
const land = new THREE.Mesh(new THREE.ShapeGeometry(landShape), new THREE.MeshStandardMaterial({ map: landTex, roughness: 0.9 }));
land.rotation.x = -Math.PI / 2; land.receiveShadow = true; scene.add(land);
const seaWallGeo = []; // stone embankment along the coast
for (let i = 0; i < coastPts.length; i++) { const [x1, z1] = coastPts[i], [x2, z2] = coastPts[(i + 1) % coastPts.length]; const L = Math.hypot(x2 - x1, z2 - z1); const m = new THREE.Mesh(new THREE.BoxGeometry(L, 1.2, 1.2), M(0x8f887a, { roughness: 0.95 })); m.position.set((x1 + x2) / 2, -0.3, (z1 + z2) / 2); m.rotation.y = -Math.atan2(z2 - z1, x2 - x1); scene.add(m); }
const roadSurfaceMat = new THREE.MeshStandardMaterial({ map: (() => { const t = asphaltTex.clone(); t.needsUpdate = true; t.repeat.set(1, 1); return t; })(), roughness: 0.92 });
const kerbStripeMat = new THREE.MeshStandardMaterial({ map: (() => { const t = canvasTex(64, 16, (c) => { c.fillStyle = '#f2c200'; c.fillRect(0, 0, 32, 16); c.fillStyle = '#141414'; c.fillRect(32, 0, 32, 16); }); return t; })(), roughness: 0.7 });
function ribbon(r, off, width, y, uLen, mat) { // strip along a road polyline, offset sideways
  const pos = [], uv = [], idx = [];
  r.P.forEach((p, i) => {
    const a = r.P[Math.max(0, i - 1)], b = r.P[Math.min(r.P.length - 1, i + 1)]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nx = -tz, nz = tx;
    for (const side of [-1, 1]) { const o = off + side * width / 2; pos.push(p.x + nx * o, y, p.z + nz * o); uv.push(r.cum[i] / uLen, side < 0 ? 0 : 1); }
    if (i) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m); return m;
}
for (const r of roads) {
  ribbon(r, 0, r.w, 0.03 + r.w * 0.0005, 8, roadSurfaceMat);
  for (const side of [-1, 1]) ribbon(r, side * (r.w / 2 + 0.2), 0.4, 0.06 + r.w * 0.0005, 2, kerbStripeMat);
}
for (const r of roads) for (const [p] of [[r.P[0]], [r.P[r.P.length - 1]]]) { const j = new THREE.Mesh(new THREE.CircleGeometry(r.w / 2 + 0.6, 20), roadSurfaceMat); j.rotation.x = -Math.PI / 2; j.position.set(p.x, 0.035 + r.w * 0.0005, p.z); scene.add(j); }
const ground = land; // the paved land mass (night puddles go on the roads instead)

// little boats bobbing in the harbour off the Gateway
const GATEWAY_BOATS = geoToGame(18.9220, 72.8347);
const boats = [];
for (let i = 0; i < 9; i++) { const b = new THREE.Group(); const hull = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 8), M(i % 2 ? 0xe8e2d4 : 0x2f6f8f)); hull.position.y = 0.5; b.add(hull); const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 3), M(0xdddddd)); cab.position.set(0, 1.4, -1); b.add(cab); b.position.set(GATEWAY_BOATS.x + rand(-160, 160), 0, GATEWAY_BOATS.z - rand(40, 260)); b.rotation.y = rand(0, 6); b.traverse(o => o.castShadow = true); scene.add(b); boats.push(b); }

// Gateway of India
function gateway(x, z) {
  const st = new THREE.MeshStandardMaterial({ map: stoneTex, bumpMap: stoneTex, bumpScale: 3, color: 0xf0dcb0, roughness: 0.9 });
  stoneTex.repeat.set(2, 4);
  addBox(8, 20, 10, st, x - 10, 0, z); addBox(8, 20, 10, st, x + 10, 0, z);
  addBox(28, 6, 10, st, x, 20, z, { collide: false });
  const arch = new THREE.Mesh(new THREE.TorusGeometry(6, 1.3, 12, 32, Math.PI), st); arch.position.set(x, 14, z); arch.castShadow = true; scene.add(arch);
  for (const dx of [-12, -4, 4, 12]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 4, 12), st); t.position.set(x + dx, 28, z); t.castShadow = true; scene.add(t);
    const d = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), st); d.position.set(x + dx, 30, z); scene.add(d); }
  addBox(30, 1, 14, st, x, 26, z, { collide: false });
}
{ const gw = geoToGame(18.9220, 72.8347); gateway(gw.x, gw.z); }

// Taj Mahal Palace (heritage wing) — exterior
const TAJ = { x: -40, z: -100 };
const texLoader = new THREE.TextureLoader();
function photoTex(url, rx = 1, ry = 1) { const t = texLoader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8; return t; }
// brick with cream bands + arched windows (for towers & side faces), lit windows at night
const brickBand = canvasTex(512, 512, (c, w, h) => {
  grain(c, w, h, '#8e4a32', 0.1, 12000);
  c.strokeStyle = 'rgba(40,20,10,.35)'; for (let y = 0; y < h; y += 8) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  for (let y = 0; y < h; y += 64) { c.fillStyle = '#efe2c4'; c.fillRect(0, y, w, 9); }
  for (let y = 0; y < h; y += 128) for (let x = 16; x < w; x += 64) { c.fillStyle = '#efe2c4'; c.beginPath(); c.moveTo(x - 4, y + 110); c.lineTo(x - 4, y + 46); c.arc(x + 16, y + 46, 20, Math.PI, 0); c.lineTo(x + 36, y + 110); c.fill(); c.fillStyle = '#2a2a33'; c.beginPath(); c.moveTo(x, y + 108); c.lineTo(x, y + 48); c.arc(x + 16, y + 48, 16, Math.PI, 0); c.lineTo(x + 32, y + 108); c.fill(); }
});
const ribTex = canvasTex(512, 256, (c, w, h) => { const g = c.createLinearGradient(0, 0, 32, 0); g.addColorStop(0, '#7a1f1c'); g.addColorStop(0.5, '#c0433a'); g.addColorStop(1, '#7a1f1c'); c.fillStyle = g; for (let x = 0; x < w; x += 32) { c.save(); c.translate(x, 0); c.fillRect(0, 0, 32, h); c.restore(); } }, [1, 1]);
const roofTileTex = canvasTex(256, 256, (c, w, h) => { grain(c, w, h, '#9a3a26', 0.1); c.strokeStyle = 'rgba(50,15,5,.5)'; for (let y = 0; y < h; y += 16) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); for (let x = (y / 16 % 2) * 8; x < w; x += 16) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 16); c.stroke(); } } }, [12, 3]);
function tajHotel() {
  const L = 96, D = 34, H = 26.5;
  const front = photoTex('assets/taj_front.jpg'), side = photoTex('assets/taj_side.jpg', 1, 1);
  const em = new THREE.MeshStandardMaterial({ map: front, roughness: 0.8, emissiveMap: front, emissive: 0xffffff, emissiveIntensity: 0.0 });
  const sm = new THREE.MeshStandardMaterial({ map: side, roughness: 0.8, emissiveMap: side, emissive: 0xffffff, emissiveIntensity: 0.0 });
  windowMats.push(em, sm); em.userData.nightGlow = sm.userData.nightGlow = 0.08;
  const roofM = new THREE.MeshStandardMaterial({ map: roofTileTex, roughness: 0.7 });
  const main = new THREE.Mesh(new THREE.BoxGeometry(L, H, D), [sm, sm, roofM, roofM, em, em]);
  main.position.set(TAJ.x, H / 2, TAJ.z); main.castShadow = main.receiveShadow = true; scene.add(main);
  colliders.push({ minX: TAJ.x - L / 2, maxX: TAJ.x + L / 2, minZ: TAJ.z - D / 2, maxZ: TAJ.z + D / 2, minY: 0, maxY: H }); solids.push(main);
  // hipped red-tile roof
  const roofShape = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, 7)]);
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: L - 6, bevelEnabled: false }), roofM);
  roof.rotation.y = Math.PI / 2; roof.position.set(TAJ.x - (L - 6) / 2, H, TAJ.z); roof.castShadow = true; scene.add(roof);
  // gables / dormers with pointed red roofs along both long faces
  const cream = M(0xf0e4c8, { roughness: 0.6 });
  for (const sz of [1, -1]) for (let i = 0; i < 14; i++) {
    const x = TAJ.x - L / 2 + 8 + i * 6.2; if (Math.abs(x - TAJ.x) < 8) continue;
    const gab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3, 1.4), new THREE.MeshStandardMaterial({ map: brickBand, roughness: 0.8 })); gab.position.set(x, H + 1.5, TAJ.z + sz * (D / 2 - 0.5)); scene.add(gab);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.6, 4), roofM); cap.rotation.y = Math.PI / 4; cap.position.set(x, H + 4.3, TAJ.z + sz * (D / 2 - 0.5)); cap.castShadow = true; scene.add(cap);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.4, 6), cream); spike.position.set(x, H + 6.2, TAJ.z + sz * (D / 2 - 0.5)); scene.add(spike);
  }
  // red ribbed dome helper (onion-ish)
  const gold = M(0xd4a23c, { metalness: 0.85, roughness: 0.25 });
  function dome(x, y, z, r, tall = 1.25) {
    const g = new THREE.Group();
    const pts = []; for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r * (1 + 0.08 * Math.sin(a * 2)), Math.sin(a) * r * tall)); }
    const d = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), new THREE.MeshStandardMaterial({ map: ribTex, bumpMap: ribTex, bumpScale: 4, roughness: 0.45, metalness: 0.1 })); d.castShadow = true; g.add(d);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, r * 0.06, 8, 40), cream); ring.rotation.x = Math.PI / 2; g.add(ring);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(r * 0.08, r * 0.9, 10), gold); fin.position.y = r * tall + r * 0.4; g.add(fin);
    g.position.set(x, y, z); scene.add(g); return g;
  }
  // central tower + great dome with lantern and four satellite domes
  const towerM = new THREE.MeshStandardMaterial({ map: brickBand, roughness: 0.8 });
  const ct = new THREE.Mesh(new THREE.BoxGeometry(16, 12, 14), towerM); ct.position.set(TAJ.x, H + 6, TAJ.z); ct.castShadow = true; scene.add(ct);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.4, 5, 40), towerM); drum.position.set(TAJ.x, H + 14.5, TAJ.z); scene.add(drum);
  dome(TAJ.x, H + 17, TAJ.z, 7.6, 1.15);
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 3, 12), cream); lantern.position.set(TAJ.x, H + 27.5, TAJ.z); scene.add(lantern);
  dome(TAJ.x, H + 29, TAJ.z, 1.6, 1.2);
  for (const [dx, dz] of [[-7, -6], [7, -6], [-7, 6], [7, 6]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 3, 12), cream); p.position.set(TAJ.x + dx, H + 13.5, TAJ.z + dz); scene.add(p); dome(TAJ.x + dx, H + 15, TAJ.z + dz, 1.6, 1.3); }
  // round corner towers with ribbed domes
  for (const [dx, dz] of [[-L / 2, -D / 2], [L / 2, -D / 2], [-L / 2, D / 2], [L / 2, D / 2]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, H + 5, 32), new THREE.MeshStandardMaterial({ map: brickBand, roughness: 0.8 })); t.position.set(TAJ.x + dx, (H + 5) / 2, TAJ.z + dz); t.castShadow = true; scene.add(t);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 1, 32), cream); band.position.set(TAJ.x + dx, H + 5, TAJ.z + dz); scene.add(band);
    dome(TAJ.x + dx, H + 5.5, TAJ.z + dz, 4.4, 1.15);
  }
  // arcaded porch on the city side
  for (let i = -3; i <= 3; i++) { const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 5, 12), cream); col.position.set(TAJ.x + i * 3, 2.5, TAJ.z + D / 2 + 5); col.castShadow = true; scene.add(col); }
  addBox(22, 0.8, 7, cream, TAJ.x, 5, TAJ.z + D / 2 + 3, { collide: false });
  const door = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.5), new THREE.MeshStandardMaterial({ color: 0x110a05, emissive: 0xffa040, emissiveIntensity: 0.6 }));
  door.position.set(TAJ.x, 2.25, TAJ.z + D / 2 + 0.05); scene.add(door);
  // Taj Mahal Tower (1973 wing) with its crown
  const tw = photoTex('assets/taj_tower.jpg');
  const twM = new THREE.MeshStandardMaterial({ map: tw, roughness: 0.75, emissiveMap: tw, emissive: 0xffffff, emissiveIntensity: 0 }); windowMats.push(twM); twM.userData.nightGlow = 0.12;
  const twS = new THREE.MeshStandardMaterial({ map: brickBand, color: 0xb89a80, roughness: 0.85 });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(30, 78, 22), [twS, twS, M(0x8a7a6a), M(0x8a7a6a), twM, twM]);
  tower.position.set(TAJ.x + 78, 39, TAJ.z + 4); tower.castShadow = tower.receiveShadow = true; scene.add(tower);
  colliders.push({ minX: TAJ.x + 63, maxX: TAJ.x + 93, minZ: TAJ.z - 7, maxZ: TAJ.z + 15, minY: 0, maxY: 78 }); solids.push(tower);
  const crown = new THREE.Mesh(new THREE.BoxGeometry(33, 6, 25), cream); crown.position.set(TAJ.x + 78, 81, TAJ.z + 4); crown.castShadow = true; scene.add(crown);
  for (let i = 0; i < 12; i++) { const pin = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2, 6), cream); pin.position.set(TAJ.x + 63 + i * 2.7, 85, TAJ.z - 8.5); scene.add(pin); const pin2 = pin.clone(); pin2.position.z = TAJ.z + 16.5; scene.add(pin2); }
  addBox(40, 6, 8, cream, TAJ.x + 78, 0, TAJ.z + 19, { collide: false }); // tower porch arcade
  return { main };
}
const taj = tajHotel();


// Smoke/fire on the Taj (only after the alert)
const fireGroup = new THREE.Group(); fireGroup.visible = false; scene.add(fireGroup);
const smokeTex = canvasTex(128, 128, (c, w, h) => { const g = c.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); });
const smoke = [];
function emitter(group, x, y, z, n, fire) {
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: fire ? 0xff7a20 : 0x222222, transparent: true, opacity: 0, depthWrite: false, blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending }));
    s.userData = { o: new THREE.Vector3(x, y, z), t: Math.random(), fire, life: fire ? 1.2 : 6 };
    group.add(s); smoke.push(s);
  }
}
emitter(fireGroup, TAJ.x, 46, TAJ.z, 40, false); emitter(fireGroup, TAJ.x, 36, TAJ.z, 20, true);
emitter(fireGroup, TAJ.x - 30, 22, TAJ.z + 17, 25, false); emitter(fireGroup, TAJ.x - 30, 20, TAJ.z + 17.5, 12, true);
const tajFireLight = new THREE.PointLight(0xff6a20, 0, 120, 1.6); tajFireLight.position.set(TAJ.x, 40, TAJ.z + 10); scene.add(tajFireLight);

// City blocks of Colaba
const blockMats = [
  facade({ floors: 5, cols: 6, wall: '#c9b79c', lit: 0.4 }), facade({ floors: 7, cols: 8, wall: '#a99a86', lit: 0.4 }),
  facade({ floors: 4, cols: 5, wall: '#d8c8a6', lit: 0.5, arched: true }), facade({ floors: 9, cols: 7, wall: '#8e8a84', lit: 0.35 }),
  facade({ floors: 6, cols: 6, wall: '#b88f6e', lit: 0.45 }), facade({ floors: 5, cols: 7, wall: '#e4dccb', lit: 0.45, arched: true }),
];
const SPOTS = { handler: new THREE.Vector3(85, 0, 40), home: new THREE.Vector3(-110, 0, 95), red: new THREE.Vector3(TAJ.x, 0, TAJ.z + 26), spawn: new THREE.Vector3(10, 0, 150) };
// ---- vehicles built from real side profiles (extruded + bevelled), not boxes
function profileMesh(pts, width, mat, bevel = 0.06) {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 8 });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  const m = new THREE.Mesh(geo, mat); m.rotation.y = -Math.PI / 2; m.castShadow = true; return m;
}
const chrome = new THREE.MeshStandardMaterial({ color: 0xdadde0, metalness: 1, roughness: 0.18 });
const tyreM = M(0x141414, { roughness: 0.9 }), rimM = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.9, roughness: 0.3 });
const glassM = new THREE.MeshPhysicalMaterial({ color: 0x0d141c, roughness: 0.04, metalness: 0.2, clearcoat: 1, envMapIntensity: 1.4 });
const headM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 2.5 });
const tailM = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1010, emissiveIntensity: 1.6 });
function wheel(g, x, z, r = 0.33, w = 0.22) {
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 20), tyreM); t.rotation.z = Math.PI / 2; t.position.set(x, r, z); t.castShadow = true; g.add(t);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, w + 0.02, 16), rimM); rim.rotation.z = Math.PI / 2; rim.position.set(x, r, z); g.add(rim);
}
function car(x, z, ry, taxi) {
  const g = new THREE.Group();
  const col = taxi ? 0x0c0c0c : [0xa81e1e, 0xe4e4e0, 0x1f3f7a, 0x6a6e72, 0x2a5a3a][Math.floor(rand(0, 5))];
  const paint = new THREE.MeshPhysicalMaterial({ color: col, metalness: 0.5, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
  // Premier Padmini-style sedan: lower body, cabin, glasshouse
  const body = profileMesh([[-2.05, 0.38], [2.05, 0.38], [2.12, 0.62], [2.05, 0.82], [1.25, 0.93], [0.72, 0.98], [-1.35, 0.98], [-2.08, 0.9], [-2.12, 0.6]], 1.66, paint, 0.08);
  g.add(body);
  const cabinM = taxi ? new THREE.MeshPhysicalMaterial({ color: 0xf2c400, roughness: 0.35, clearcoat: 1 }) : paint;
  const roof = profileMesh([[0.7, 0.98], [0.22, 1.42], [-0.92, 1.45], [-1.32, 0.98]], 1.48, cabinM, 0.05); g.add(roof);
  const glass = profileMesh([[0.74, 1.0], [0.26, 1.38], [-0.94, 1.4], [-1.36, 1.0]], 1.54, glassM, 0.02); g.add(glass);
  for (const zz of [2.17, -2.17]) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.14, 0.12), chrome); b.position.set(0, 0.5, zz); g.add(b); }
  const grille = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), M(0x0a0a0a, { metalness: 0.6 })); grille.position.set(0, 0.72, 2.155); g.add(grille);
  for (const sx of [-0.62, 0.62]) {
    const h = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), headM); h.position.set(sx, 0.72, 2.16); g.add(h);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 16), chrome); ring.position.copy(h.position); g.add(ring);
    const tl = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.14), tailM); tl.position.set(sx, 0.76, -2.155); tl.rotation.y = Math.PI; g.add(tl);
  }
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.12), M(taxi ? 0xf2c400 : 0xf4f4f0)); plate.position.set(0, 0.5, 2.24); g.add(plate);
  for (const [wx, wz] of [[-0.78, 1.32], [0.78, 1.32], [-0.78, -1.3], [0.78, -1.3]]) wheel(g, wx, wz);
  const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.06), chrome); mirror.position.set(0.86, 1.05, 0.6); g.add(mirror);
  g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
  colliders.push({ minX: x - 2.2, maxX: x + 2.2, minZ: z - 2.2, maxZ: z + 2.2, minY: 0, maxY: 1.5 }); solids.push(body);
  return g;
}
function autoRickshaw(x, z, ry) {
  const g = new THREE.Group();
  const black = new THREE.MeshPhysicalMaterial({ color: 0x0e0e0e, roughness: 0.35, clearcoat: 0.8 });
  const yellow = new THREE.MeshPhysicalMaterial({ color: 0xf2c200, roughness: 0.45, clearcoat: 0.4, side: THREE.DoubleSide });
  // tapered nose + floor pan
  g.add(profileMesh([[-1.15, 0.32], [0.95, 0.32], [1.42, 0.55], [1.38, 1.25], [1.1, 1.3], [0.9, 0.75], [-1.15, 0.72]], 1.3, black, 0.06));
  const nose = profileMesh([[0.95, 0.32], [1.42, 0.55], [1.38, 1.25], [1.1, 1.3], [0.9, 0.75]], 0.9, black, 0.04); g.add(nose);
  // curved canvas canopy (thin shell, open sides like a real auto)
  const outer = [], inner = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16, zz = -1.22 + t * 2.55, yy = 1.05 + Math.sin(Math.min(1, t * 1.25) * Math.PI / 2) * 0.95 - Math.max(0, t - 0.8) * 2.6; outer.push([zz, yy]); inner.push([zz, yy - 0.06]); }
  g.add(profileMesh([...outer, ...inner.reverse()], 1.4, yellow, 0.02));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.62), new THREE.MeshPhysicalMaterial({ color: 0x223040, roughness: 0.05, transparent: true, opacity: 0.5 })); screen.position.set(0, 1.62, 1.08); screen.rotation.x = -0.25; g.add(screen);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 0.6), M(0x1a1a1a)); seat.position.set(0, 0.95, -0.7); g.add(seat);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), chrome); bar.rotation.z = Math.PI / 2; bar.position.set(0, 1.3, 0.85); g.add(bar);
  wheel(g, 0, 1.2, 0.25, 0.16); wheel(g, -0.62, -0.75, 0.25, 0.16); wheel(g, 0.62, -0.75, 0.25, 0.16);
  const hl = new THREE.Mesh(new THREE.CircleGeometry(0.11, 14), headM); hl.position.set(0, 1.05, 1.43); hl.rotation.x = -0.4; g.add(hl);
  g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g); return g;
}
function bestBus(x, z, ry) {
  const g = new THREE.Group();
  const red = new THREE.MeshPhysicalMaterial({ color: 0xb3121c, roughness: 0.4, clearcoat: 0.6 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(2.5, 2.9, 11, 4, 0.25), red); body.position.y = 1.85; body.castShadow = true; g.add(body);
  const win = new THREE.Mesh(new RoundedBoxGeometry(2.54, 0.95, 9.6, 2, 0.08), new THREE.MeshStandardMaterial({ color: 0x141c26, emissive: 0xffe8b0, emissiveIntensity: 0.25, roughness: 0.1 })); win.position.set(0, 2.45, -0.4); g.add(win); windowMats.push(win.material); win.material.userData.nightGlow = 0.8;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.3), glassM); front.position.set(0, 2.35, 5.51); g.add(front);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.12, 10.9), M(0xf2e8d0)); stripe.position.y = 1.7; g.add(stripe);
  const roof = new THREE.Mesh(new RoundedBoxGeometry(2.3, 0.2, 10.4, 2, 0.08), M(0xe8e4dc)); roof.position.y = 3.35; g.add(roof);
  for (const sx of [-0.8, 0.8]) { const h = new THREE.Mesh(new THREE.CircleGeometry(0.16, 14), headM); h.position.set(sx, 0.9, 5.52); g.add(h); }
  for (const [wx, wz] of [[-1.15, 3.6], [1.15, 3.6], [-1.15, -3.4], [1.15, -3.4]]) wheel(g, wx, wz, 0.5, 0.32);
  g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g); return g;
}

// ============================================================ MUMBAI STREET LIFE (dense details, cheap to render)
const ROADS_Z = [-15, 35, 85, 135, 185, 235], ROADS_X = [-225, -175, -125, -75, -25, 25, 75, 125, 175, 225];
const SHOP_NAMES = ['Shree Ganesh Vada Pav', 'Colaba Chai Point', 'Laxmi Jewellers', 'Sai Medical Stores', 'Irani Bakery & Cafe', 'Bombay Mobile Centre', 'Mahalaxmi Sweets', 'Patel Kirana Store', 'Royal Tailors', 'Apollo Electricals', 'Saraswati Saree Centre', 'Hotel Annapurna', 'New Krishna Bhavan', 'Star Xerox & Print', 'Gokul Pan House', 'Om Sai Hardware', 'Jai Hind Lunch Home', 'Bharat Book Depot', 'Mumbai Masala Dosa', 'Lucky Restaurant'];
const SIGN_COLORS = [['#c8102e', '#ffffff'], ['#f5c400', '#1a1a1a'], ['#0b6e3a', '#ffe680'], ['#1b3f8f', '#ffffff'], ['#ff7a00', '#ffffff'], ['#6a1b9a', '#ffe0ff'], ['#ffffff', '#c8102e'], ['#00897b', '#ffffff']];
const signMats = SHOP_NAMES.map((name, i) => {
  const [bg, fg] = SIGN_COLORS[i % SIGN_COLORS.length];
  const t = canvasTex(512, 96, (c, w, h) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h); c.strokeStyle = fg; c.lineWidth = 4; c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = fg; c.font = `700 ${name.length > 18 ? 34 : 42}px Oswald, Arial, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(name.toUpperCase(), w / 2, h / 2 + 2);
  });
  const m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.6 }); m.userData.nightGlow = 0.9; windowMats.push(m); return m;
});
const shutterTex = canvasTex(256, 128, (c, w, h) => { c.fillStyle = '#7a7f84'; c.fillRect(0, 0, w, h); c.strokeStyle = '#5a5f64'; c.lineWidth = 2; for (let y = 0; y < h; y += 6) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); } });
const shopInside = canvasTex(256, 128, (c, w, h) => { c.fillStyle = '#ffe9b8'; c.fillRect(0, 0, w, h); for (let i = 0; i < 40; i++) { c.fillStyle = ['#c84', '#48c', '#c44', '#4a4', '#fc4'][i % 5]; c.fillRect(rand(0, w), rand(10, h * 0.8), rand(8, 20), rand(8, 24)); } c.fillStyle = '#6a4a2a'; c.fillRect(0, h * 0.75, w, h * 0.25); });
const mShutter = new THREE.MeshStandardMaterial({ map: shutterTex, roughness: 0.6, metalness: 0.4 });
const mShop = new THREE.MeshStandardMaterial({ map: shopInside, emissiveMap: shopInside, emissive: 0xffffff, emissiveIntensity: 0.15 }); mShop.userData.nightGlow = 0.8; windowMats.push(mShop);
let signIdx = 0;
function shopFront(x, z, w, faceDir, alongX = true) { // faceDir: +1/-1 toward the road
  const n = Math.max(1, Math.floor(w / 6));
  for (let i = 0; i < n; i++) {
    const off = -w / 2 + (i + 0.5) * (w / n);
    const px = alongX ? x + off : x, pz = alongX ? z : z + off;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(w / n - 0.4, 1.1), signMats[signIdx++ % signMats.length]);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w / n - 0.6, 2.8), Math.random() < 0.65 ? mShop : mShutter);
    for (const [m, y] of [[sign, 4.3], [front, 1.65]]) { m.position.set(px + (alongX ? 0 : faceDir * 0.06), y, pz + (alongX ? faceDir * 0.06 : 0)); m.rotation.y = alongX ? (faceDir > 0 ? 0 : Math.PI) : (faceDir > 0 ? Math.PI / 2 : -Math.PI / 2); scene.add(m); }
  }
}
// pastel Mumbai buildings with balconies (pink, mint, sky, lemon, peach…)
const pastel = ['#e8a6b8', '#a8d8c0', '#9cc4e4', '#f0dc8c', '#f4b890', '#c8b4e0', '#e0e0d0', '#b0c890'];
const pastelMats = pastel.map(wall => facade({ floors: 7, cols: 6, wall, glass: '#2a3440', lit: 0.45, trim: '#f8f4ea' }));
const balconyMat = M(0xf2efe6, { roughness: 0.7 });
const balconyGeo = new THREE.BoxGeometry(2.6, 0.9, 1.1);
const balconies = new THREE.InstancedMesh(balconyGeo, balconyMat, 3000); balconies.count = 0; balconies.castShadow = true; scene.add(balconies);
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
function addInst(im, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) { if (im.count >= im.instanceMatrix.count) return; _q.setFromEuler(new THREE.Euler(0, ry, 0)); _m4.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)); im.setMatrixAt(im.count++, _m4); }
function dressBuilding(cx, cz, w, h, d) {
  const floors = Math.floor((h - 5) / 3.4);
  for (const dir of [1, -1]) for (let f = 0; f < floors; f++) for (let i = 0; i < Math.floor(w / 5); i++) if (Math.random() < 0.55) addInst(balconies, cx - w / 2 + 2.5 + i * 5, 6 + f * 3.4, cz + dir * (d / 2 + 0.5));
}
// kerbs with yellow/black stripes, like Indian city roads
const kerbTex = canvasTex(256, 32, (c, w, h) => { for (let x = 0; x < w; x += 32) { c.fillStyle = (x / 32) % 2 ? '#141414' : '#f2c200'; c.fillRect(x, 0, 32, h); } }, [1, 1]);
const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.7 });
function kerb(x, z, len, alongX) { const t = kerbTex.clone(); t.needsUpdate = true; t.repeat.set(len / 2, 1); const m = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.35, 0.35, alongX ? 0.35 : len), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 })); m.position.set(x, 0.17, z); m.receiveShadow = true; scene.add(m); }
// lane markings & zebra crossings (instanced)
const paint = new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.6 });
const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(3, 0.18), paint, 2500); dashes.count = 0; dashes.receiveShadow = true; scene.add(dashes);
const zebra = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.6, 4), paint, 2500); zebra.count = 0; scene.add(zebra);
function flatInst(im, x, z, ry) { _q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, ry)); _m4.compose(_p.set(x, 0.03, z), _q, _s.set(1, 1, 1)); if (im.count < im.instanceMatrix.count) im.setMatrixAt(im.count++, _m4); }
// trees (instanced trunks + foliage clumps)
const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 4, 7), M(0x5a4030), 400); trunks.count = 0; trunks.castShadow = true; scene.add(trunks);
const leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.6, 1), new THREE.MeshStandardMaterial({ color: 0x3f7a2e, roughness: 0.9, flatShading: true }), 1600); leaves.count = 0; leaves.castShadow = true; scene.add(leaves);
function tree(x, z) { addInst(trunks, x, 2, z); for (let i = 0; i < 4; i++) addInst(leaves, x + rand(-1.2, 1.2), rand(4, 5.6), z + rand(-1.2, 1.2), rand(0, 6), rand(0.8, 1.3), rand(0.7, 1), rand(0.8, 1.3)); }
// bollards
const bollards = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.14, 0.9, 8), new THREE.MeshStandardMaterial({ map: canvasTex(32, 64, (c) => { for (let y = 0; y < 64; y += 16) { c.fillStyle = (y / 16) % 2 ? '#111' : '#f2c200'; c.fillRect(0, y, 32, 16); } }), roughness: 0.6 }), 800); bollards.count = 0; scene.add(bollards);
// street lamps along every road (few real lights — glow comes from bloom)
const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffb45a, emissiveIntensity: 4 });
const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 8, 6), M(0x4a4a4a, { metalness: 0.6 }), 700); poles.count = 0; scene.add(poles);
const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 10, 8), bulbMat, 700); bulbs.count = 0; scene.add(bulbs);
let lampCount = 0;
function lamp(x, z) { addInst(poles, x, 4, z); addInst(bulbs, x, 8.1, z); if ((lampCount++ % 14) === 0 && cityLights.length < 10) { const l = new THREE.PointLight(0xffa850, 30, 40, 1.8); l.position.set(x, 7.8, z); l.visible = false; scene.add(l); cityLights.push(l); } }
// Mumbai auto-rickshaws (black & yellow) and red BEST buses

// ---- Colaba landmarks (approximate, from local knowledge; replaced by OpenStreetMap data when available)
const ROAD_NAMES_Z = ['P. J. Ramchandani Marg (Apollo Bunder)', 'Mereweather Road', 'Shahid Bhagat Singh Rd', 'Best Marg', 'Nathalal Parekh Marg', 'Wodehouse Road'];
const ROAD_NAMES_X = ['Arthur Bunder Rd', 'Ormiston Road', 'Colaba Causeway', 'Battery Street', 'Henry Road', 'Allana Road', 'Garden Road', 'Strand Road', 'Navy Nagar Rd', 'Cuffe Parade'];
function roadSign(text, x, z, ry) {
  const t = canvasTex(512, 128, (c, w, h) => { c.fillStyle = '#0b5d2a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#fff'; c.lineWidth = 6; c.strokeRect(8, 8, w - 16, h - 16); c.fillStyle = '#fff'; c.font = `600 ${text.length > 24 ? 30 : 40}px Oswald, Arial`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, w / 2, h / 2); });
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6), M(0x444444)); pole.position.y = 1.6; g.add(pole);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.5 })); board.position.y = 3.3; g.add(board);
  g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
}
// Colaba Causeway market: hawker stalls with tarpaulin canopies along both pavements
const tarp = [0x1f5fa8, 0xd0402a, 0x2a8a4a, 0xe0a020, 0x6a3a9a].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide }));
const goods = [0xd8506a, 0xf0c040, 0x40a0d0, 0xf4f0e0, 0x80c050, 0xc06030];
const roadMat = new THREE.MeshStandardMaterial({ map: pavTex, roughness: 0.85 });
// ============================================================ REAL SOUTH-MUMBAI LANDMARKS (positions from real lat/long, relative to the Taj)
// game frame: Taj at (TAJ.x, TAJ.z); the harbour (real south-east) is game -Z, real north-east is game +X
const LANDMARKS = [
  { name: 'Leopold Cafe', lat: 18.9227, lon: 72.8317, r: 8, kind: 'leopold' },
  { name: 'Regal Circle', lat: 18.9266, lon: 72.8320, r: 40, kind: 'regal' },
  { name: 'CSMVS Museum', lat: 18.9269, lon: 72.8326, r: 45, kind: 'museum' },
  { name: 'Nariman House', lat: 18.9165, lon: 72.8283, r: 22, kind: 'nariman' },
  { name: 'Oberoi-Trident', lat: 18.9270, lon: 72.8205, r: 40, kind: 'oberoi' },
  { name: 'Churchgate', lat: 18.9353, lon: 72.8275, r: 45, kind: 'churchgate' },
  { name: 'CST Station', lat: 18.9398, lon: 72.8355, r: 80, kind: 'cst' },
].map(l => ({ ...l, pos: geoToGame(l.lat, l.lon) }));
const nearLandmark = (x, z) => LANDMARKS.some(l => l.r && Math.hypot(x - l.pos.x, z - l.pos.z) < l.r + 26);
(function buildLandmarks() {
  const stone = new THREE.MeshStandardMaterial({ map: stoneTex, color: 0xe8d8b8, roughness: 0.85 });
  const basalt = new THREE.MeshStandardMaterial({ map: brickBand, color: 0xa09080, roughness: 0.85 });
  const white = M(0xf4efe4, { roughness: 0.6 }), green = M(0x3f7a2e, { roughness: 1 }), red = M(0xa8352c, { roughness: 0.6 });
  const label = (text, p, h) => { const s = textSprite(text, '#ffd21f'); s.material.depthTest = true; s.material.fog = true; s.scale.set(8, 2, 1); s.position.set(p.x, h, p.z); scene.add(s); };
  const ring = (p, r) => { const g = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshStandardMaterial({ map: pavTex, roughness: 0.9 })); g.rotation.x = -Math.PI / 2; g.position.set(p.x, 0.05, p.z); scene.add(g); };
  for (const l of LANDMARKS) {
    const p = l.pos;
    if (l.kind === 'leopold') { // corner cafe on Colaba Causeway, attacked on 26/11
      const t = canvasTex(512, 96, (c, w, h) => { c.fillStyle = '#1a3a6a'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffd860'; c.font = '700 54px Oswald, serif'; c.textAlign = 'center'; c.fillText('LEOPOLD CAFE', w / 2, 68); });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.4 })); sign.position.set(p.x, 4.6, p.z + 1.2); scene.add(sign);
      label('Leopold Cafe', p, 9);
    }
    if (l.kind === 'regal') { // roundabout + Wellington Fountain + Regal Cinema
      ring(p, 30);
      const lawn = new THREE.Mesh(new THREE.CircleGeometry(12, 40), green); lawn.rotation.x = -Math.PI / 2; lawn.position.set(p.x, 0.08, p.z); scene.add(lawn);
      addBox(4, 5, 4, stone, p.x, 0, p.z); const cup = new THREE.Mesh(new THREE.SphereGeometry(2.4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), stone); cup.position.set(p.x, 5, p.z); scene.add(cup);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2, c = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 5, 10), white); c.position.set(p.x + Math.cos(a) * 2.6, 2.5, p.z + Math.sin(a) * 2.6); scene.add(c); }
      const cine = facade({ floors: 4, cols: 8, wall: '#e8dcc0', lit: 0.5, trim: '#c84a2a' }); addBox(36, 18, 22, cine, p.x - 45, 0, p.z + 10);
      const rt = canvasTex(512, 96, (c, w, h) => { c.fillStyle = '#111'; c.fillRect(0, 0, w, h); c.fillStyle = '#ff3a3a'; c.font = '700 64px Oswald'; c.textAlign = 'center'; c.fillText('REGAL', w / 2, 72); });
      const rs = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.2), new THREE.MeshStandardMaterial({ map: rt, emissiveMap: rt, emissive: 0xffffff, emissiveIntensity: 1 })); rs.position.set(p.x - 45, 14, p.z - 1.05); rs.rotation.y = Math.PI; scene.add(rs);
      label('Regal Circle', p, 12);
    }
    if (l.kind === 'museum') { // Indo-Saracenic museum with its white dome in a garden
      const lawn = new THREE.Mesh(new THREE.PlaneGeometry(80, 70), green); lawn.rotation.x = -Math.PI / 2; lawn.position.set(p.x, 0.06, p.z); scene.add(lawn);
      addBox(46, 14, 22, new THREE.MeshStandardMaterial({ map: brickBand, color: 0xc8b090 }), p.x, 0, p.z);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 5, 32), white); drum.position.set(p.x, 16.5, p.z); scene.add(drum);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(6.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), white); dome.scale.y = 1.2; dome.position.set(p.x, 19, p.z); scene.add(dome);
      for (const dx of [-20, 20]) { const d = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), white); d.position.set(p.x + dx, 14, p.z); scene.add(d); }
      label('CSMVS Museum', p, 30);
    }
    if (l.kind === 'nariman') { const f = facade({ floors: 5, cols: 5, wall: '#c8b8a0', lit: 0.3 }); addBox(16, 17, 16, f, p.x, 0, p.z); label('Nariman House', p, 21); }
    if (l.kind === 'oberoi') {
      const glass = new THREE.MeshPhysicalMaterial({ color: 0x5a7a90, metalness: 0.6, roughness: 0.1, envMapIntensity: 1.5 });
      addBox(28, 95, 22, glass, p.x, 0, p.z); addBox(40, 10, 30, facade({ floors: 2, cols: 10, wall: '#d8d0c0', lit: 0.6 }), p.x, 0, p.z + 24);
      label('Oberoi-Trident', p, 100);
    }
    if (l.kind === 'churchgate') { addBox(60, 12, 18, facade({ floors: 3, cols: 12, wall: '#e0d4b8', lit: 0.5, arched: true }), p.x, 0, p.z); const clock = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 8, 12), stone); clock.position.set(p.x, 16, p.z); scene.add(clock); label('Churchgate Station', p, 24); }
    if (l.kind === 'cst') { // Victorian Gothic terminus: long stone wings, central tower and dome
      addBox(120, 18, 26, basalt, p.x, 0, p.z); addBox(26, 26, 30, basalt, p.x, 0, p.z);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 6, 24), stone); drum.position.set(p.x, 29, p.z); scene.add(drum);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(7.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M(0x8a7a5a, { roughness: 0.5, metalness: 0.2 })); dome.scale.y = 1.4; dome.position.set(p.x, 32, p.z); scene.add(dome);
      for (const dx of [-55, -30, 30, 55]) { const sp = new THREE.Mesh(new THREE.ConeGeometry(2.2, 9, 8), red); sp.position.set(p.x + dx, 22.5, p.z); scene.add(sp); }
      label('CST Station', p, 48);
    }
  }
})();

// ============================================================ STREAMING CITY (GTA-style: the city builds ahead of you, unloads behind)
const CHUNK = 100, STREAM_R = 2;
function shopFacadeMat(wall, k) {
  const W = 512, H = 512, floors = 7, cols = 6, cw = W / cols, fh = H / floors;
  const lit = [];
  const map = canvasTex(W, H, (c) => {
    grain(c, W, H, wall, 0.06, 5000);
    for (let f = 0; f < floors - 1; f++) { c.fillStyle = '#f4efe2'; c.fillRect(0, f * fh + fh - 4, W, 4); for (let i = 0; i < cols; i++) { const x = i * cw + cw * 0.22, y = f * fh + fh * 0.2; c.fillStyle = '#f4efe2'; c.fillRect(x - 3, y - 3, cw * 0.56 + 6, fh * 0.6 + 6); c.fillStyle = '#26303a'; c.fillRect(x, y, cw * 0.56, fh * 0.6); c.fillStyle = 'rgba(120,120,120,.6)'; c.fillRect(x - 4, y + fh * 0.6, cw * 0.56 + 8, 5); if (Math.random() < 0.45) lit.push([x, y]); } }
    // ground-floor shops with painted signboards
    const gy = (floors - 1) * fh;
    for (let i = 0; i < 3; i++) {
      const x = i * W / 3, [bg, fg] = SIGN_COLORS[(k * 3 + i) % SIGN_COLORS.length], name = SHOP_NAMES[(k * 5 + i * 7) % SHOP_NAMES.length];
      c.fillStyle = bg; c.fillRect(x + 4, gy + 4, W / 3 - 8, fh * 0.3); c.fillStyle = fg; c.font = '700 15px Oswald, Arial'; c.textAlign = 'center'; c.fillText(name.toUpperCase(), x + W / 6, gy + fh * 0.21);
      c.fillStyle = i % 2 ? '#ffe7b0' : '#7a7f84'; c.fillRect(x + 8, gy + fh * 0.36, W / 3 - 16, fh * 0.64);
      if (i % 2) for (let n = 0; n < 12; n++) { c.fillStyle = ['#c84', '#48c', '#c44', '#4a4'][n % 4]; c.fillRect(x + 12 + rand(0, W / 3 - 30), gy + fh * 0.45 + rand(0, fh * 0.4), 8, 10); }
      else for (let y = gy + fh * 0.36; y < H; y += 4) { c.fillStyle = '#5a5f64'; c.fillRect(x + 8, y, W / 3 - 16, 1); }
    }
  });
  const em = canvasTex(W, H, (c) => { c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.fillStyle = '#ffd59a'; for (const [x, y] of lit) c.fillRect(x, y, cw * 0.56, fh * 0.6); const gy = (floors - 1) * fh; for (let i = 0; i < 3; i++) { c.fillStyle = '#888'; c.fillRect(i * W / 3 + 4, gy + 4, W / 3 - 8, fh * 0.3); if (i % 2) { c.fillStyle = '#ffe7b0'; c.fillRect(i * W / 3 + 8, gy + fh * 0.36, W / 3 - 16, fh * 0.64); } } });
  const m = new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.85 }); m.userData.nightGlow = 0.6; windowMats.push(m); return m;
}
const streamMats = [...pastel, '#c9b79c', '#a99a86', '#d8c8a6', '#b88f6e'].map((w, i) => shopFacadeMat(w, i));
if (night) streamMats.forEach(m => m.emissiveIntensity = 0.6);
const slabGeo = new THREE.BoxGeometry(38, 0.25, 38);
const kerbPiece = new THREE.BoxGeometry(2, 0.35, 0.35);
const kerbPieceMat = new THREE.MeshStandardMaterial({ map: canvasTex(64, 16, (c) => { c.fillStyle = '#f2c200'; c.fillRect(0, 0, 32, 16); c.fillStyle = '#141414'; c.fillRect(32, 0, 32, 16); }), roughness: 0.7 });
const roofTankGeo = new THREE.CylinderGeometry(1.2, 1.2, 2, 10), roofTankMat = M(0x222222);
// ============================================================ BUILT FROM THE MAP: street furniture, buildings, landmarks frontage
const _R = seeded(2611);
const rr = (a, b) => a + _R() * (b - a);
// lamps, trees, lane dashes along every real road
const furn = { pole: [], tree: [], dash: [] };
for (const r of roads) {
  for (let s = 6; s < r.len - 6; s += 26) for (const side of [-1, 1]) { const p = roadPoint(r, s + (side > 0 ? 13 : 0)); const o = side * (r.w / 2 + 1.3); furn.pole.push([p.x - p.tz * o, p.z + p.tx * o]); if (_R() < 0.55) { const q = roadPoint(r, s + 6); const o2 = side * (r.w / 2 + 1.6); furn.tree.push([q.x - q.tz * o2, q.z + q.tx * o2]); } }
  if (r.w >= 9) for (let s = 4; s < r.len - 4; s += 7) { const p = roadPoint(r, s); furn.dash.push([p.x, p.z, Math.atan2(p.tz, p.tx)]); }
}
const mkI = (geo, mat, n, shadow = true) => { const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); im.count = 0; im.castShadow = shadow; im.receiveShadow = true; scene.add(im); return im; };
const mPole = mkI(poles.geometry, poles.material, furn.pole.length), mBulb = mkI(bulbs.geometry, bulbs.material, furn.pole.length, false);
const mTrunk = mkI(trunks.geometry, trunks.material, furn.tree.length), mLeaf = mkI(leaves.geometry, leaves.material, furn.tree.length * 4);
const mDash = mkI(dashes.geometry, dashes.material, furn.dash.length, false);
for (const [x, z] of furn.pole) { addInst(mPole, x, 4, z); addInst(mBulb, x, 8.1, z); }
for (const [x, z] of furn.tree) { addInst(mTrunk, x, 2, z); for (let i = 0; i < 4; i++) addInst(mLeaf, x + rr(-1.2, 1.2), rr(4, 5.6), z + rr(-1.2, 1.2), rr(0, 6), rr(0.8, 1.3), rr(0.7, 1), rr(0.8, 1.3)); }
for (const [x, z, a] of furn.dash) { _q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, -a)); _m4.compose(_p.set(x, 0.05, z), _q, _s.set(1, 1, 1)); mDash.setMatrixAt(mDash.count++, _m4); }
for (const im of [mPole, mBulb, mTrunk, mLeaf, mDash]) im.instanceMatrix.needsUpdate = true;
// a few real lights near the Taj / red zone (glow elsewhere comes from bloom)
furn.pole.filter(([x, z]) => Math.hypot(x - TAJ.x, z - TAJ.z) < 230).slice(0, 8).forEach(([x, z]) => { const l = new THREE.PointLight(0xffa850, 30, 40, 1.8); l.position.set(x, 7.8, z); l.visible = false; scene.add(l); cityLights.push(l); });
// green street-name boards
for (const r of roads) for (const s of [Math.min(25, r.len / 3), r.len / 2]) { const p = roadPoint(r, s), o = r.w / 2 + 1.0; roadSign(r.name, p.x - p.tz * o, p.z + p.tx * o, Math.atan2(p.tx, p.tz)); }
// Colaba Causeway market: hawker stalls along both pavements
{ const r = roadByName('Colaba Causeway'); for (const side of [-1, 1]) for (let s = 180; s < Math.min(r.len, 1400); s += 4.4) { if (_R() < 0.22) continue; const p = roadPoint(r, s), o = side * (r.w / 2 + 2.1); const g = new THREE.Group();
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 3.2), M(0x6a4a2a)); table.position.y = 0.45; g.add(table);
  for (let k = 0; k < 5; k++) { const it = new THREE.Mesh(new THREE.BoxGeometry(rr(0.2, 0.45), rr(0.1, 0.35), rr(0.2, 0.5)), M(goods[(k + Math.floor(s)) % goods.length])); it.position.set(rr(-0.6, 0.6), 1.0, rr(-1.3, 1.3)); g.add(it); }
  const canopy = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.8), tarp[Math.floor(s) % tarp.length]); canopy.rotation.x = -Math.PI / 2 + side * 0.2; canopy.position.y = 2.5; g.add(canopy);
  g.position.set(p.x - p.tz * o, 0, p.z + p.tx * o); g.rotation.y = Math.atan2(p.tx, p.tz); scene.add(g); } }
// ---- buildings lining every road (computed once, built in chunks as the player moves)
const TAJ_ZONE = { minX: TAJ.x - 75, maxX: TAJ.x + 140, minZ: TAJ.z - 45, maxZ: TAJ.z + 60 };
const GATEWAY_POS = geoToGame(18.9220, 72.8347);
const BUILDINGS = [], bGrid = new Map();
function freeSpot(cx, cz, rad) { const k0 = Math.floor(cx / 40), k1 = Math.floor(cz / 40); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const b of bGrid.get((k0 + i) + ',' + (k1 + j)) || []) if (Math.hypot(b.cx - cx, b.cz - cz) < (b.rad + rad) * 0.82) return false; return true; }
for (const r of roads) for (const side of [-1, 1]) for (const row of [0, 1]) {
  let s = rr(2, 8);
  while (s < r.len - 4) {
    const w = rr(10, 22), d = rr(12, 20), h = rr(11, 42);
    const p = roadPoint(r, s + w / 2), nx = -p.tz * side, nz = p.tx * side;
    const off = r.w / 2 + 3 + d / 2 + row * (d + 4);
    const cx = p.x + nx * off, cz = p.z + nz * off, a = Math.atan2(p.tz, p.tx), rad = Math.hypot(w, d) / 2;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [cx + p.tx * u * w / 2 - p.tz * v * d / 2, cz + p.tz * u * w / 2 + p.tx * v * d / 2]);
    const inTaj = (x, z) => x > TAJ_ZONE.minX && x < TAJ_ZONE.maxX && z > TAJ_ZONE.minZ && z < TAJ_ZONE.maxZ;
    const ok = (row === 0 || _R() < 0.75) && corners.every(([x, z]) => onLand(x, z) && roadClearance(x, z) > 2.2 && !inTaj(x, z)) && roadClearance(cx, cz) > 2.2
      && !nearLandmark(cx, cz) && Math.hypot(cx - GATEWAY_POS.x, cz - GATEWAY_POS.z) > 70 && freeSpot(cx, cz, rad);
    if (ok) { const b = { cx, cz, w, d, h, a, rad, mat: Math.floor(_R() * 12) }; BUILDINGS.push(b); const k = Math.floor(cx / 40) + ',' + Math.floor(cz / 40); if (!bGrid.has(k)) bGrid.set(k, []); bGrid.get(k).push(b); }
    s += w + rr(0.4, 2.2);
  }
}

const chunks = new Map(), bChunks = new Map();
for (const b of BUILDINGS) { const k = Math.floor(b.cx / CHUNK) + ',' + Math.floor(b.cz / CHUNK); if (!bChunks.has(k)) bChunks.set(k, []); bChunks.get(k).push(b); }
function buildChunk(ci, cj) {
  const list = bChunks.get(ci + ',' + cj) || [], group = new THREE.Group(), cols = [], sols = [];
  const balI = new THREE.InstancedMesh(balconyGeo, balconyMat, 60 * list.length + 1); balI.count = 0; balI.castShadow = true; group.add(balI);
  for (const b of list) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), streamMats[b.mat % streamMats.length]);
    mesh.position.set(b.cx, b.h / 2, b.cz); mesh.rotation.y = -b.a; mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    const c = Math.cos(b.a), sn = Math.sin(b.a), ex = Math.abs(c) * b.w / 2 + Math.abs(sn) * b.d / 2, ez = Math.abs(sn) * b.w / 2 + Math.abs(c) * b.d / 2;
    const col = { obb: true, cx: b.cx, cz: b.cz, hw: b.w / 2, hd: b.d / 2, cos: c, sin: sn, minX: b.cx - ex, maxX: b.cx + ex, minZ: b.cz - ez, maxZ: b.cz + ez, minY: 0, maxY: b.h };
    cols.push(col); sols.push(mesh);
    const floors = Math.floor((b.h - 5) / 3.4);
    for (const v of [1, -1]) for (let f = 0; f < floors; f++) for (let i = 0; i < Math.floor(b.w / 5); i++) if (((i * 7 + f * 3 + b.mat) % 5) < 3) {
      const u = -b.w / 2 + 2.5 + i * 5, vv = v * (b.d / 2 + 0.5);
      addInst(balI, b.cx + c * u - sn * vv, 6 + f * 3.4, b.cz + sn * u + c * vv, -b.a);
    }
    if (b.mat % 3) { const t = new THREE.Mesh(roofTankGeo, roofTankMat); t.position.set(b.cx, b.h + 1, b.cz); group.add(t); }
  }
  balI.instanceMatrix.needsUpdate = true;
  scene.add(group); colliders.push(...cols); solids.push(...sols);
  return { group, cols: new Set(cols), sols: new Set(sols) };
}
function unloadChunk(ch) {
  scene.remove(ch.group);
  ch.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); else if (o.isMesh && o.geometry !== roofTankGeo) o.geometry.dispose(); });
  for (let i = colliders.length - 1; i >= 0; i--) if (ch.cols.has(colliders[i])) colliders.splice(i, 1);
  for (let i = solids.length - 1; i >= 0; i--) if (ch.sols.has(solids[i])) solids.splice(i, 1);
}
function updateStreaming() {
  if (inside || phase === 'menu') return;
  const ci0 = Math.floor(me.pos.x / CHUNK), cj0 = Math.floor(me.pos.z / CHUNK);
  let best = null, bd = 1e9;
  for (let di = -STREAM_R; di <= STREAM_R; di++) for (let dj = -STREAM_R; dj <= STREAM_R; dj++) { const key = (ci0 + di) + ',' + (cj0 + dj); if (chunks.has(key)) continue; const d = di * di + dj * dj; if (d < bd) { bd = d; best = [ci0 + di, cj0 + dj, key]; } }
  if (best) chunks.set(best[2], buildChunk(best[0], best[1])); // one chunk per frame = no stutter
  for (const [key, ch] of chunks) { const [ci, cj] = key.split(',').map(Number); if (Math.abs(ci - ci0) > STREAM_R + 1 || Math.abs(cj - cj0) > STREAM_R + 1) { unloadChunk(ch); chunks.delete(key); } }
}
// ---- places in the story, on real streets
function sidewalk(roadName, s, side) { const r = roadByName(roadName), p = roadPoint(r, s), o = side * (r.w / 2 + 1.4); return new THREE.Vector3(p.x - p.tz * o, 0, p.z + p.tx * o); }
SPOTS.spawn.copy(sidewalk('Colaba Causeway', 620, 1));
SPOTS.handler.copy(sidewalk('Colaba Causeway', 900, -1));
SPOTS.home.copy(sidewalk('Nathalal Parekh Marg', 420, 1));
// ---- traffic that drives along the real roads and recycles around the player
function nearRoadSpot(maxD = 280, minD = 60, center = null) {
  const C = center || me.pos;
  for (let k = 0; k < 30; k++) { const r = roads[Math.floor(Math.random() * roads.length)], s = Math.random() * r.len, p = roadPoint(r, s), d = Math.hypot(p.x - C.x, p.z - C.z); if (d < maxD && d > minD) return { r, s }; }
  const r = roadByName('Colaba Causeway'); return { r, s: Math.random() * r.len };
}
const movingCars = [];
for (let i = 0; i < 40; i++) {
  const kind = i % 5 === 0 ? 'bus' : i % 3 === 0 ? 'auto' : 'car';
  const g = kind === 'bus' ? bestBus(0, 0, 0) : kind === 'auto' ? autoRickshaw(0, 0, 0) : car(0, 0, 0, Math.random() < 0.5);
  if (kind === 'car') { colliders.pop(); solids.pop(); }
  const { r, s } = nearRoadSpot(400, 0, SPOTS.spawn);
  movingCars.push({ g, r, s, dir: Math.random() < 0.5 ? 1 : -1, speed: kind === 'bus' ? rand(5, 7) : kind === 'auto' ? rand(6, 9) : rand(7, 12) });
}
function placeVehicle(c) { const p = roadPoint(c.r, c.s), lane = c.dir * Math.max(1.2, c.r.w / 4); c.g.position.set(p.x - p.tz * lane, 0, p.z + p.tx * lane); c.g.rotation.y = Math.atan2(p.tx * c.dir, p.tz * c.dir); }
movingCars.forEach(placeVehicle);
// parked autos & cars at the kerb
for (let i = 0; i < 30; i++) { const { r, s } = nearRoadSpot(900, 0, SPOTS.spawn); const p = roadPoint(r, s), side = i % 2 ? 1 : -1, o = side * (r.w / 2 - 1.2); const x = p.x - p.tz * o, z = p.z + p.tx * o, ry = Math.atan2(p.tx, p.tz); if (i % 3) autoRickshaw(x, z, ry); else car(x, z, ry, true); }
{ const p = sidewalk('Colaba Causeway', 905, -1); car(p.x, p.z, 0.3, false); } // the Colonel's jeep

// ============================================================ CHARACTERS
function makeHuman({ shirt = 0x3b4a3a, pants = 0x2c3325, skin = 0x8d5a3b, head = 0x1f2a1e, vest = 0x2a3324, gun = true, tag, modelTint, uniform = false, noModel = false } = {}) {
  const g = new THREE.Group();
  const mk = (geo, color, x, y, z, part) => { const m = new THREE.Mesh(geo, M(color, { roughness: 0.8 })); m.position.set(x, y, z); m.castShadow = true; m.userData.part = part; g.add(m); return m; };
  const legL = mk(new THREE.CapsuleGeometry(0.13, 0.7, 4, 8), pants, -0.14, 0.48, 0, 'body');
  const legR = mk(new THREE.CapsuleGeometry(0.13, 0.7, 4, 8), pants, 0.14, 0.48, 0, 'body');
  const torso = mk(new THREE.CapsuleGeometry(0.27, 0.5, 4, 10), shirt, 0, 1.22, 0, 'body');
  mk(new THREE.BoxGeometry(0.56, 0.5, 0.34), vest, 0, 1.25, 0, 'body');
  const armL = mk(new THREE.CapsuleGeometry(0.09, 0.5, 4, 8), shirt, -0.36, 1.2, 0.15, 'body'); armL.rotation.x = -1.1;
  const armR = mk(new THREE.CapsuleGeometry(0.09, 0.5, 4, 8), shirt, 0.36, 1.2, 0.15, 'body'); armR.rotation.x = -1.1;
  const h = mk(new THREE.SphereGeometry(0.16, 16, 12), skin, 0, 1.73, 0, 'head');
  mk(new THREE.SphereGeometry(0.175, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), head, 0, 1.76, 0, 'head');
  if (gun) { const gm = mk(new THREE.BoxGeometry(0.07, 0.12, 0.85), 0x151515, 0.15, 1.2, 0.45, 'body'); gm.material.metalness = 0.6; }
  g.userData = { legL, legR, armL, armR, torso, headMesh: h };
  if (tag) { const s = textSprite(tag); s.position.y = 2.25; g.add(s); }
  if (!noModel) dressModel(g, { civilian: false, tint: modelTint, gun });
  return g;
}
function textSprite(text, color = '#fff') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
  x.font = '600 34px Oswald, sans-serif'; x.textAlign = 'center'; x.fillStyle = '#0008'; x.fillRect(0, 8, 256, 48); x.fillStyle = color; x.fillText(text, 128, 44);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, fog: false })); s.scale.set(1.6, 0.4, 1); s.renderOrder = 10; return s;
}
// The handler (Colonel) NPC
const colonel = makeHuman({ shirt: 0x5b6b4a, vest: 0x4b5a3a, head: 0x8a1c1c, tag: 'Col. Rathore', modelTint: 0xb8c49a, gun: false, uniform: true });
colonel.position.copy(SPOTS.handler); colonel.rotation.y = Math.PI; scene.add(colonel);
// pedestrians
// Mumbai crowd: varied clothing (kurtas, sarees, shirts), skin tones, walking speeds. Count scales with graphics quality.
const peds = [];
function placePed(p) { const u = p.userData, q = roadPoint(u.road, u.s), o = u.side * (u.road.w / 2 + u.lane); p.position.set(q.x - q.tz * o, 0, q.z + q.tx * o); p.rotation.y = Math.atan2(q.tx * u.dir, q.tz * u.dir); }
const CLOTH = [0xd8d0c0, 0x9a3b3b, 0x3b5a9a, 0xe0a040, 0x7a4a8a, 0xe86a9a, 0x2a8a6a, 0xf0f0f0, 0xc87a2a, 0x5a5a5a, 0xd04020, 0x30a0c0];
const SKIN = [0x8d5a3b, 0x7a4a2e, 0xa06a48, 0x6a3e26, 0xb07a55];
const PED_MAX = 90;
for (let i = 0; i < PED_MAX; i++) {
  const saree = Math.random() < 0.3, c = CLOTH[Math.floor(rand(0, CLOTH.length))];
  const p = makeHuman({ shirt: c, pants: saree ? c : [0x2a2a3a, 0x4a3a2a, 0xd8d0c0, 0x222222][i % 4], vest: saree ? CLOTH[(i * 5) % CLOTH.length] : c, skin: SKIN[i % SKIN.length], head: 0x111111, gun: false, modelTint: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.55).getHex() });
  p.scale.setScalar(rand(0.88, 1.06));
  if (Math.random() < 0.3) { const bag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 0.15), M([0x3a2a1a, 0x7a1a1a, 0x1a1a5a][i % 3])); bag.position.set(0.3, 0.95, 0); p.add(bag); }
  const spot = nearRoadSpot(170, 0, SPOTS.spawn);
  Object.assign(p.userData, { road: spot.r, s: spot.s, side: Math.random() < 0.5 ? 1 : -1, lane: rand(1.0, 2.4), dir: Math.random() < 0.5 ? 1 : -1, speed: rand(1.1, 1.8), phase: rand(0, 6), stopT: 0 });
  placePed(p);
  scene.add(p); peds.push(p);
}
// Mumbai Police (khaki) + ambulances + onlookers at the red zone — appear after the alert
const police = [];
for (let i = 0; i < 10; i++) {
  const cop = makeHuman({ shirt: 0xb59a62, pants: 0xb59a62, vest: 0x8a7448, head: 0x3a2a1a, tag: i === 0 ? 'Mumbai Police' : undefined, modelTint: 0xe0c890 });
  cop.position.set(TAJ.x - 22 + i * 4.5 + rand(-1, 1), 0, TAJ.z + 39 + rand(-1, 1)); cop.rotation.y = Math.PI + rand(-0.4, 0.4);
  redZoneProps.add(cop); police.push(cop);
}
for (let i = 0; i < 24; i++) { // onlookers behind barricades
  const o = makeHuman({ shirt: CLOTH[i % CLOTH.length], pants: 0x2a2a3a, vest: CLOTH[(i * 3) % CLOTH.length], skin: SKIN[i % 5], head: 0x111111, gun: false, modelTint: new THREE.Color(CLOTH[i % CLOTH.length]).lerp(new THREE.Color(0xffffff), 0.5).getHex() });
  o.position.set(TAJ.x - 30 + rand(0, 60), 0, TAJ.z + 47 + rand(0, 6)); o.rotation.y = Math.PI + rand(-0.5, 0.5); o.userData.watch = true; redZoneProps.add(o); police.push(o);
}
const ambLights = [];
for (const ax of [-28, 26]) {
  const amb = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.4, 5.5), M(0xf4f4f4, { roughness: 0.4 })); body.position.y = 1.5; amb.add(body);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.3, 5.52), M(0xcc1111)); stripe.position.y = 1.4; amb.add(stripe);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 0.4), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff2020, emissiveIntensity: 4 })); bar.position.set(0, 2.85, 1.8); amb.add(bar); ambLights.push(bar);
  amb.position.set(TAJ.x + ax, 0, TAJ.z + 44); amb.rotation.y = 0.3 * Math.sign(ax); amb.traverse(o => o.castShadow = true); redZoneProps.add(amb);
}
let pedLimit = PED_MAX;

// ============================================================ TAJ INTERIOR — 3 floors around a galleried atrium
const IN = { x: 1000, z: 0 }; // interior origin, far from the city
const FLOOR_H = 5, FLOORS = 3;
const interiorLights = [];
const fires = [];
const FLOOR_NAMES = ['Ground floor', '1st floor', '2nd floor'];
function buildInterior() {
  const X = v => IN.x + v, Z = v => IN.z + v;
  // ---- materials (painted from the reference photos)
  const plaster = canvasTex(256, 512, (c, w, h) => { grain(c, w, h, '#efe3c8', 0.04); c.fillStyle = '#d9c7a2'; c.fillRect(0, h * 0.78, w, h * 0.22); c.strokeStyle = '#b8a27a'; c.lineWidth = 3; c.strokeRect(10, h * 0.8, w - 20, h * 0.18); c.fillStyle = '#fff6e0'; c.fillRect(0, 0, w, 14); }, [4, 1]);
  const roomWall = canvasTex(256, 512, (c, w, h) => { grain(c, w, h, '#8fa2ac', 0.04); c.fillStyle = '#e8dcc0'; c.fillRect(0, h * 0.8, w, h * 0.2); c.strokeStyle = '#c8b890'; c.lineWidth = 3; for (let x = 8; x < w; x += 64) c.strokeRect(x, h * 0.82, 50, h * 0.15); c.fillStyle = '#f4ead4'; c.fillRect(0, 0, w, 16); }, [3, 1]);
  const goldWall = canvasTex(256, 512, (c, w, h) => { const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#a87a22'); g.addColorStop(0.5, '#f0c860'); g.addColorStop(1, '#a87a22'); c.fillStyle = g; c.fillRect(0, 0, w, h); c.globalAlpha = 0.15; grain(c, w, h, 'rgba(0,0,0,0)', 0.2, 4000); c.globalAlpha = 1; c.fillStyle = '#fff3d4'; c.fillRect(0, h * 0.85, w, h * 0.15); }, [4, 1]);
  const carpet = canvasTex(512, 512, (c, w, h) => { c.fillStyle = '#5a7a7a'; c.fillRect(0, 0, w, h); for (let i = 0; i < 220; i++) { const x = rand(0, w), y = rand(0, h), r = rand(6, 22); c.strokeStyle = ['#d8b040', '#e8c860', '#a88a30', '#c0d0c0'][i % 4]; c.lineWidth = rand(2, 4); c.beginPath(); c.arc(x, y, r, rand(0, 3), rand(3, 6.3)); c.stroke(); } }, [10, 10]);
  const diamond = canvasTex(512, 512, (c, w, h) => { grain(c, w, h, '#e8dcc6', 0.03); c.fillStyle = '#1c1a1c'; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2) { const cx = x * 64 + 32, cy = y * 64 + 32; c.beginPath(); c.moveTo(cx, cy - 22); c.lineTo(cx + 22, cy); c.lineTo(cx, cy + 22); c.lineTo(cx - 22, cy); c.fill(); } c.strokeStyle = '#2a2830'; c.lineWidth = 6; c.strokeRect(0, 0, w, h); }, [8, 8]);
  const stairTex = photoTex('assets/stair_carpet.jpg', 1, 1);
  const quilt = photoTex('assets/quilt.jpg', 1, 1);
  const balusters = canvasTex(256, 64, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = '#f4f0e6'; c.fillRect(0, 0, w, 8); c.fillRect(0, h - 8, w, 8); for (let x = 4; x < w; x += 16) { c.fillRect(x, 8, 6, h - 16); c.beginPath(); c.arc(x + 3, h / 2, 6, 0, 7); c.fill(); } }, [6, 1]);
  const iron = canvasTex(256, 64, (c, w, h) => { c.clearRect(0, 0, w, h); c.strokeStyle = '#151515'; c.lineWidth = 3; c.strokeRect(1, 4, w - 2, h - 8); for (let x = 0; x < w; x += 32) { c.beginPath(); c.ellipse(x + 16, h / 2, 10, 22, 0, 0, 7); c.stroke(); c.beginPath(); c.arc(x + 16, h / 2, 5, 0, 7); c.stroke(); } }, [4, 1]);
  const mPlaster = new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.85 });
  const mRoom = new THREE.MeshStandardMaterial({ map: roomWall, roughness: 0.85 });
  const mGold = new THREE.MeshStandardMaterial({ map: goldWall, roughness: 0.35, metalness: 0.55 });
  const mCarpet = new THREE.MeshStandardMaterial({ map: carpet, roughness: 0.95 });
  const mCeil = M(0xf2ead8, { roughness: 0.9 });
  const mWhite = M(0xf4f0e6, { roughness: 0.5 });
  const mWood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.45, color: 0x8a5a3a });
  const mBal = new THREE.MeshStandardMaterial({ map: balusters, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5 });
  const mIron = new THREE.MeshStandardMaterial({ map: iron, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 });
  // ---- ground floor
  const g0 = new THREE.Mesh(new THREE.PlaneGeometry(70, 50), new THREE.MeshStandardMaterial({ map: diamond, roughness: 0.18, envMapIntensity: 0.6 }));
  g0.rotation.x = -Math.PI / 2; g0.position.set(X(0), 0.01, Z(0)); g0.receiveShadow = true; scene.add(g0);
  // ---- slabs (floor 1, floor 2, roof) built around the atrium + stair holes
  const slabMats = [mCeil, mCeil, mCarpet, mCeil, mCeil, mCeil];
  const slab = (x1, x2, z1, z2, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x2 - x1, 0.3, z2 - z1), slabMats); m.position.set(X((x1 + x2) / 2), y - 0.15, Z((z1 + z2) / 2)); m.receiveShadow = true; scene.add(m); colliders.push({ minX: X(x1), maxX: X(x2), minZ: Z(z1), maxZ: Z(z2), minY: y - 0.3, maxY: y }); solids.push(m); };
  const common = y => { slab(-35, 35, 12, 25, y); slab(-35, 35, -25, -12, y); slab(-35, -8, -12, 12, y); slab(8, 13, -12, 12, y); slab(17, 35, -12, 12, y); };
  common(5); slab(13, 17, -3, 12, 5);                       // floor 1 (hole over flight A: z -12..-3)
  common(10); slab(13, 17, -12, 0, 10); slab(13, 17, 9, 12, 10); // floor 2 (hole over flight B: z 0..9)
  common(15); slab(13, 17, -12, 12, 15);                    // roof
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(16, 24), new THREE.MeshStandardMaterial({ map: canvasTex(256, 384, (c, w, h) => { c.fillStyle = '#26304a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#e8e0cc'; c.lineWidth = 6; for (let x = 0; x <= w; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); } for (let y = 0; y <= h; y += 48) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); } }), emissive: 0x1a2540, emissiveIntensity: 1 }));
  sky.rotation.x = Math.PI / 2; sky.position.set(X(0), 14.9, Z(0)); scene.add(sky);
  // ---- walls
  const seg = (x1, z1, x2, z2, y, mat, h = FLOOR_H) => { const T = 0.35, w = Math.abs(x2 - x1) || T, d = Math.abs(z2 - z1) || T; addBox(w, h, d, mat, X((x1 + x2) / 2), y, Z((z1 + z2) / 2), { cast: false }); };
  const wallX = (z, a, b, y, mat, gaps = [], gw = 1.8) => { let s = a; for (const g of [...gaps].sort((p, q) => p - q)) { if (g - gw / 2 > s) seg(s, z, g - gw / 2, z, y, mat); seg(g - gw / 2, z, g + gw / 2, z, y + 2.6, mat, FLOOR_H - 2.6); s = g + gw / 2; } if (b > s) seg(s, z, b, z, y, mat); };
  const wallZ = (x, a, b, y, mat, gaps = [], gw = 1.8) => { let s = a; for (const g of [...gaps].sort((p, q) => p - q)) { if (g - gw / 2 > s) seg(x, s, x, g - gw / 2, y, mat); seg(x, g - gw / 2, x, g + gw / 2, y + 2.6, mat, FLOOR_H - 2.6); s = g + gw / 2; } if (b > s) seg(x, s, x, b, y, mat); };
  const doorM = M(0x6a3e22, { roughness: 0.5 });
  const door = (x, z, alongX, y) => { const d = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.08 : 1.6, 2.5, alongX ? 1.6 : 0.08), doorM); d.position.set(X(x + (alongX ? 0.85 : 0)), y + 1.25, Z(z + (alongX ? 0 : 0.85))); scene.add(d); };
  for (let f = 0; f < FLOORS; f++) {
    const y = f * FLOOR_H;
    // outer walls with tall arched windows
    wallX(25, -35, 35, y, mPlaster); wallX(-25, -35, 35, y, mPlaster); wallZ(-35, -25, 25, y, mPlaster); wallZ(35, -25, 25, y, mPlaster);
    for (let i = -30; i <= 30; i += 8) for (const sz of [24.8, -24.8]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.8), new THREE.MeshStandardMaterial({ color: 0x0a1428, emissive: 0x1a2a55, emissiveIntensity: 0.8 })); w.position.set(X(i), y + 2.2, Z(sz)); w.rotation.y = sz > 0 ? Math.PI : 0; scene.add(w); }
    if (f === 0) {
      wallX(-16, -35, 35, y, mPlaster, [-22, -4, 4, 26], 3);  // entrance lobby (south)
      wallX(16, -35, 35, y, mPlaster, [-22, 0, 26], 3);       // Sea Lounge restaurant (north)
      wallZ(-12, -16, 16, y, mGold, [-6, 6], 3);              // ballroom (west)
      wallZ(18, -16, 16, y, mPlaster, [-6, 6], 3);            // reception (east)
    } else {
      const rooms = [-24, -12, 0, 12, 24], doorsX = [-29.5, -18, -6, 6, 18, 29.5];
      wallX(16, -35, 35, y, mRoom, doorsX); wallX(-16, -35, 35, y, mRoom, doorsX);
      for (const rx of rooms) { seg(rx, 16, rx, 25, y, mRoom); seg(rx, -16, rx, -25, y, mRoom); }
      wallZ(-12, -16, 16, y, mRoom, [-8, 8]); seg(-35, 0, -12, 0, y, mRoom);
      wallZ(18, -16, 16, y, mRoom, [-8, 8]); seg(18, 0, 35, 0, y, mRoom);
      doorsX.forEach(dx => { door(dx - 0.9, 16, true, y); door(dx - 0.9, -16, true, y); });
      // furnish every guest room (bed with embroidered quilt, side tables, desk, TV, armchair)
      const roomCenters = [];
      for (let i = 0; i < 6; i++) { const cx = doorsX[i]; roomCenters.push([cx, 21, 1], [cx, -21, -1]); }
      roomCenters.push([-24, 8, 1], [-24, -8, -1], [27, 8, 1], [27, -8, -1]);
      for (const [cx, cz, s] of roomCenters) {
        const bz = cz + s * 2.2;
        addBox(2.2, 0.5, 2.4, mWood, X(cx), y, Z(bz));
        const mat = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.3, 2.3), [mWhite, mWhite, new THREE.MeshStandardMaterial({ map: quilt, roughness: 0.9 }), mWhite, mWhite, mWhite]); mat.position.set(X(cx), y + 0.65, Z(bz)); scene.add(mat);
        const head = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.12, 24, 1, false, 0, Math.PI), M(0xe8dcc4)); head.rotation.set(Math.PI / 2, 0, s > 0 ? 0 : Math.PI); head.position.set(X(cx), y + 0.9, Z(bz + s * 1.2)); scene.add(head);
        for (const sx of [-1.5, 1.5]) { addBox(0.5, 0.6, 0.5, mWood, X(cx + sx), y, Z(bz + s * 0.9), { collide: false }); const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.25, 10), new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffc070, emissiveIntensity: 1.5 })); lamp.position.set(X(cx + sx), y + 0.85, Z(bz + s * 0.9)); scene.add(lamp); }
        addBox(2.4, 0.8, 0.6, M(0x1a1410, { roughness: 0.3 }), X(cx + 2.8), y, Z(cz - s * 0.5));
        const tv = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.65, 0.06), M(0x050505, { roughness: 0.1, metalness: 0.5 })); tv.position.set(X(cx + 2.8), y + 1.25, Z(cz - s * 0.5)); scene.add(tv);
        addBox(0.8, 0.8, 0.8, M(0x4a5a6a), X(cx - 2.6), y, Z(cz - s * 1.6));
      }
    }
  }
  // ---- atrium: white columns, arches, balustrades on upper floors
  const colPos = [];
  for (const x of [-8, 0, 8]) for (const z of [-12, 12]) colPos.push([x, z]);
  for (const z of [-4, 4]) for (const x of [-8, 8]) colPos.push([x, z]);
  for (let f = 0; f < FLOORS; f++) {
    const y = f * FLOOR_H;
    for (const [cx, cz] of colPos) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, FLOOR_H - 0.3, 14), mWhite); c.position.set(X(cx), y + (FLOOR_H - 0.3) / 2, Z(cz)); c.castShadow = true; scene.add(c); colliders.push({ minX: X(cx) - 0.36, maxX: X(cx) + 0.36, minZ: Z(cz) - 0.36, maxZ: Z(cz) + 0.36, minY: y, maxY: y + FLOOR_H }); solids.push(c); }
    for (const [a, b] of [[[-8, -12], [0, -12]], [[0, -12], [8, -12]], [[-8, 12], [0, 12]], [[0, 12], [8, 12]], [[-8, -12], [-8, -4]], [[-8, -4], [-8, 4]], [[-8, 4], [-8, 12]], [[8, -12], [8, -4]], [[8, -4], [8, 4]], [[8, 4], [8, 12]]]) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const arch = new THREE.Mesh(new THREE.TorusGeometry(len / 2 - 0.3, 0.18, 8, 24, Math.PI), mWhite);
      arch.position.set(X((a[0] + b[0]) / 2), y + FLOOR_H - 0.3 - (len / 2 - 0.3) * 0.35, Z((a[1] + b[1]) / 2)); arch.scale.y = 0.35; arch.rotation.y = a[0] === b[0] ? Math.PI / 2 : 0; scene.add(arch);
      if (f > 0) { // balustrade
        const bal = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.1), mBal); bal.position.set(X((a[0] + b[0]) / 2), y + 0.55, Z((a[1] + b[1]) / 2)); bal.rotation.y = a[0] === b[0] ? Math.PI / 2 : 0; scene.add(bal);
        const top = new THREE.Mesh(new THREE.BoxGeometry(a[0] === b[0] ? 0.25 : len, 0.1, a[0] === b[0] ? len : 0.25), mWood); top.position.set(bal.position.x, y + 1.12, bal.position.z); scene.add(top);
        colliders.push({ minX: X(Math.min(a[0], b[0])) - 0.15, maxX: X(Math.max(a[0], b[0])) + 0.15, minZ: Z(Math.min(a[1], b[1])) - 0.15, maxZ: Z(Math.max(a[1], b[1])) + 0.15, minY: y, maxY: y + 1.15 });
      }
    }
  }
  // ---- grand staircases (red patterned carpet, wrought-iron balustrade)
  const flight = (z0, y0, dir) => {
    for (let i = 1; i <= 15; i++) {
      const top = y0 + i * FLOOR_H / 15, zc = z0 + dir * (i - 0.5) * 0.6;
      const st = new THREE.Mesh(new THREE.BoxGeometry(4, top - y0, 0.6), [mWood, mWood, new THREE.MeshStandardMaterial({ map: stairTex, roughness: 0.9 }), mWood, mWood, mWood]);
      st.position.set(X(15), y0 + (top - y0) / 2, Z(zc)); st.receiveShadow = true; scene.add(st);
      colliders.push({ minX: X(13), maxX: X(17), minZ: Z(zc - 0.3), maxZ: Z(zc + 0.3), minY: y0, maxY: top }); solids.push(st);
    }
    const zA = z0, zB = z0 + dir * 9, len = Math.hypot(9, FLOOR_H);
    for (const sx of [13, 17]) {
      const rail = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.0), mIron); rail.position.set(X(sx), y0 + FLOOR_H / 2 + 0.6, Z((zA + zB) / 2)); rail.rotation.set(0, Math.PI / 2, 0); rail.rotateX(dir * Math.atan2(FLOOR_H, 9)); scene.add(rail);
      const hand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 8), mWood); hand.position.set(X(sx), y0 + FLOOR_H / 2 + 1.1, Z((zA + zB) / 2)); hand.rotation.x = Math.PI / 2 - dir * Math.atan2(FLOOR_H, 9); scene.add(hand);
      colliders.push({ minX: X(sx) - 0.1, maxX: X(sx) + 0.1, minZ: Z(Math.min(zA, zB)), maxZ: Z(Math.max(zA, zB)), minY: y0, maxY: y0 + FLOOR_H + 1.1 });
    }
  };
  flight(-12, 0, 1);  // ground → 1st (z -12 → -3)
  flight(0, 5, 1);    // 1st → 2nd (z 0 → 9)
  colliders.push({ minX: X(13), maxX: X(17), minZ: Z(-12.15), maxZ: Z(-11.85), minY: 5, maxY: 6.15 });
  colliders.push({ minX: X(13), maxX: X(17), minZ: Z(-0.15), maxZ: Z(0.15), minY: 10, maxY: 11.15 });
  // ---- ballroom (gold, chandeliers, round tables, stage with piano)
  for (const [tx, tz] of [[-30, -10], [-24, -10], [-18, -10], [-30, 0], [-24, 0], [-18, 0], [-30, 10], [-24, 10], [-18, 10]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.8, 24), M(0xe8dcc0, { roughness: 0.9 })); t.position.set(X(tx), 0.4, Z(tz)); t.castShadow = true; scene.add(t);
    colliders.push({ minX: X(tx) - 1.1, maxX: X(tx) + 1.1, minZ: Z(tz) - 1.1, maxZ: Z(tz) + 1.1, minY: 0, maxY: 0.8 }); solids.push(t);
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), M(0xd85a7a)); fl.position.set(X(tx), 0.95, Z(tz)); scene.add(fl);
  }
  addBox(10, 0.6, 3, mWood, X(-24), 0, Z(-14.5));
  addBox(1.6, 1.0, 1.2, M(0x050505, { roughness: 0.15, metalness: 0.3 }), X(-24), 0.6, Z(-14.5), { collide: false });
  for (const [gx, gz] of [[-33, -6], [-33, 6], [-14, -6], [-14, 6]]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 5, 16), mGold); c.position.set(X(gx), 2.5, Z(gz)); scene.add(c); colliders.push({ minX: X(gx) - .5, maxX: X(gx) + .5, minZ: Z(gz) - .5, maxZ: Z(gz) + .5, minY: 0, maxY: 5 }); solids.push(c); }
  // ---- Sea Lounge tables, reception desk, atrium sofas
  for (const [tx, tz] of [[-28, 20], [-16, 20], [-8, 22], [8, 22], [16, 19], [28, 20]]) addBox(1.6, 0.8, 1.6, M(0xf0e8d8), X(tx), 0, Z(tz));
  addBox(1.4, 1.2, 9, mWood, X(22), 0, Z(0));
  for (const [sx, sz] of [[-4, -6], [4, 6]]) addBox(2.8, 0.9, 1, M(0x3a4a6a), X(sx), 0, Z(sz));
  const rt = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.8, 20), mWood); rt.position.set(X(0), 0.4, Z(0)); scene.add(rt);
  // cover: luggage trolleys & toppled furniture from the attack
  for (const [cx, cz, f] of [[-2, -20, 0], [10, -20, 0], [-20, 13.5, 1], [3, -14, 1], [-10, 14, 2], [5, -14, 2], [26, 13.5, 2], [-26, -14, 1]]) addBox(1.8, 1.05, 0.9, M(0x5a3a20), X(cx), f * FLOOR_H, Z(cz));
  // ---- machine-gun nest on the 2nd-floor north gallery (covers the stairs & atrium)
  const sand = M(0x8f7d5a, { roughness: 1 });
  addBox(5, 1.15, 1, sand, X(0), 10, Z(13)); addBox(1, 1.15, 2.4, sand, X(-3), 10, Z(14)); addBox(1, 1.15, 2.4, sand, X(3), 10, Z(14));
  // ---- chandeliers & lights (a light per area keeps it cheap on low-end PCs)
  const glow = new THREE.MeshStandardMaterial({ color: 0xffe9b8, emissive: 0xffd28a, emissiveIntensity: 3 });
  const chandelier = (x, y, z, r) => { const g = new THREE.Group(); const core = new THREE.Mesh(new THREE.SphereGeometry(r * 0.35, 12, 10), glow); g.add(core); for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; const b = new THREE.Mesh(new THREE.SphereGeometry(r * 0.12, 8, 6), glow); b.position.set(Math.cos(a) * r, -r * 0.3, Math.sin(a) * r); g.add(b); } const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 4), M(0x8a7040)); ch.position.y = 0.8; g.add(ch); g.position.set(X(x), y, Z(z)); scene.add(g); };
  for (const [x, z, f, r, I] of [[-24, -6, 0, 0.9, 16], [-24, 6, 0, 0.9, 0], [0, 0, 0, 1.2, 18], [0, -20, 0, 0.6, 10], [0, 20, 0, 0.6, 10], [26, 0, 0, 0.6, 9], [0, 14, 1, 0.4, 9], [0, -14, 1, 0.4, 9], [0, -14, 2, 0.4, 9], [-24, 0, 1, 0.4, 8], [26, 0, 2, 0.4, 8]]) {
    const y = f * FLOOR_H + FLOOR_H - 0.9; chandelier(x, y, z, r);
    if (I) { const l = new THREE.PointLight(0xffd8a0, I, 22, 1.6); l.position.set(X(x), y - 0.4, Z(z)); l.visible = false; l.userData.base = I; scene.add(l); interiorLights.push(l); }
  }
  // ---- fires (the heritage wing burned on the night of 26/11)
  for (const [fx, fz, f] of [[-28, 21, 1], [28, -21, 2], [-30, 8, 0]]) {
    const y = f * FLOOR_H, g = new THREE.Group(); scene.add(g); emitter(g, X(fx), y + 0.5, Z(fz), 18, true); emitter(g, X(fx), y + 2, Z(fz), 10, false);
    const l = new THREE.PointLight(0xff6020, 18, 16, 1.6); l.position.set(X(fx), y + 1.5, Z(fz)); l.visible = false; scene.add(l); interiorLights.push(l); fires.push(l);
  }
}
buildInterior();
// highest walkable surface under (x,z) that can be stepped onto from height y
const STEP = 0.45;
function groundAt(x, z, y) {
  let h = 0;
  for (const c of colliders) if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ && c.maxY <= y + STEP + 0.01 && c.maxY > h) h = c.maxY;
  return h;
}


// ============================================================ MARKERS
function makeMarker(color) {
  const g = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 60, 32, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  beam.position.y = 30; g.add(beam);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.12, 8, 48), new THREE.MeshBasicMaterial({ color, fog: false })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.2; g.add(ring);
  g.visible = false; scene.add(g); return g;
}
const marker = makeMarker(0xffd21f);
const redMarker = makeMarker(0xff2020); redMarker.scale.set(4, 1, 4);

// ============================================================ AUDIO (synthesised)
let AC = null;
function audio() { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); return AC; }
function noise(dur) { const a = audio(); const b = a.createBuffer(1, a.sampleRate * dur, a.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2); return b; }
function sfx(kind, pos, vol = 1) {
  try {
    const a = audio(); let v = vol;
    if (pos) v *= clamp(1 - camera.position.distanceTo(pos) / 90, 0, 1);
    if (v <= 0.01) return;
    const g = a.createGain(); g.gain.value = v; g.connect(a.destination);
    if (kind === 'shot' || kind === 'sniper' || kind === 'shotgun' || kind === 'mg') {
      const s = a.createBufferSource(); s.buffer = noise(kind === 'sniper' ? 0.6 : kind === 'shotgun' ? 0.45 : 0.22);
      const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = kind === 'mg' ? 2200 : kind === 'sniper' ? 1400 : 3000; s.connect(f); f.connect(g); g.gain.value = v * (kind === 'sniper' ? 1 : 0.6); s.start();
    } else if (kind === 'boom') {
      const s = a.createBufferSource(); s.buffer = noise(2.2); const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; s.connect(f); f.connect(g); g.gain.value = v * 1.6; s.start();
    } else if (kind === 'beep' || kind === 'phone') {
      const o = a.createOscillator(); o.frequency.value = kind === 'beep' ? 1800 : 880; o.type = 'square'; o.connect(g); g.gain.value = v * 0.12; o.start(); o.stop(a.currentTime + (kind === 'beep' ? 0.08 : 0.25));
    } else if (kind === 'reload') {
      const o = a.createOscillator(); o.frequency.value = 300; o.type = 'triangle'; o.connect(g); g.gain.value = v * 0.1; o.start(); o.stop(a.currentTime + 0.05);
    }
  } catch { }
}

// ============================================================ EFFECTS
const fx = [];
const flashLight = new THREE.PointLight(0xffb050, 0, 12, 2); scene.add(flashLight);
function tracer(from, to, color = 0xffd080) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, fog: false }));
  scene.add(l); fx.push({ o: l, life: 0.06, max: 0.06 });
}
function spark(p, color = 0xffc060, n = 6) {
  for (let i = 0; i < n; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 4), new THREE.MeshBasicMaterial({ color })); s.position.copy(p); scene.add(s); fx.push({ o: s, life: 0.3, max: 0.3, v: new THREE.Vector3(rand(-3, 3), rand(0, 4), rand(-3, 3)) }); }
}
function blood(p) { spark(p, 0x7a0000, 8); }
let shake = 0;
function explosionFx(p, r) {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, fog: false }));
  ball.position.copy(p); scene.add(ball); fx.push({ o: ball, life: 0.6, max: 0.6, grow: r });
  const l = new THREE.PointLight(0xff8030, 400, r * 5, 1.5); l.position.copy(p).y += 1; scene.add(l); fx.push({ o: l, life: 0.5, max: 0.5, light: 400 });
  for (let i = 0; i < 14; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x333333, transparent: true, opacity: 0.8, depthWrite: false })); s.position.copy(p); s.scale.setScalar(2); scene.add(s); fx.push({ o: s, life: 2.5, max: 2.5, v: new THREE.Vector3(rand(-2, 2), rand(1, 3), rand(-2, 2)), smoke: true }); }
  spark(p, 0xffa030, 20);
  const d = camera.position.distanceTo(p); shake = Math.max(shake, clamp(1.2 - d / 25, 0, 1.2));
  sfx('boom', p);
}

// ============================================================ PLAYER STATE
const WEAPONS = {
  ak: { name: 'AK-47', role: 'Assault', dmg: 34, rpm: 600, mag: 30, reserve: 180, spread: 0.022, auto: true, snd: 'shot', desc: 'Hard-hitting, heavy recoil.' },
  m4: { name: 'M4 Carbine', role: 'Rifleman', dmg: 27, rpm: 780, mag: 30, reserve: 210, spread: 0.013, auto: true, snd: 'shot', desc: 'Accurate, fast. All-rounder.' },
  sg: { name: 'Shotgun (Breacher)', role: 'Breacher', dmg: 16, pellets: 9, rpm: 75, mag: 8, reserve: 48, spread: 0.07, auto: false, snd: 'shotgun', desc: 'Devastating in rooms & corridors.' },
  sn: { name: 'Sniper (PSG-1)', role: 'Marksman', dmg: 160, rpm: 50, mag: 5, reserve: 35, spread: 0.0008, auto: false, snd: 'sniper', scope: true, desc: 'One shot, one kill. Covers long halls.' },
};
const me = {
  pos: SPOTS.spawn.clone(), vel: new THREE.Vector3(), yaw: Math.PI, pitch: 0, hp: 100, down: false, dead: false,
  weapon: 'm4', ammo: 30, reserve: 210, inv: { frag: 3, flash: 2, smoke: 2 }, lastShot: 0, reloading: 0, lastHurt: 0, onGround: true,
  name: 'Commando', inZone: false, aim: false, outfit: 'casual',
};
let phase = 'menu'; // menu → toHandler → talk → toHome → rest → toRed → brief → loadout → assault → end
let inside = false;
const keys = {};
let locked = false;

// view model gun
const viewGun = new THREE.Group(); camera.add(viewGun);
function buildViewGun(w) {
  viewGun.clear();
  const metal = M(0x1a1a1a, { metalness: 0.7, roughness: 0.35 }), wood = M(0x6b3b1e, { roughness: 0.6 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); viewGun.add(m); return m; };
  add(new THREE.BoxGeometry(0.07, 0.11, 0.55), metal, 0, 0, -0.1);
  add(new THREE.CylinderGeometry(0.017, 0.017, w === 'sn' ? 0.7 : 0.4, 8), metal, 0, 0.02, w === 'sn' ? -0.65 : -0.55).rotation.x = Math.PI / 2;
  add(new THREE.BoxGeometry(0.06, 0.1, 0.25), w === 'ak' ? wood : metal, 0, -0.03, 0.27);
  if (w !== 'sg') add(new THREE.BoxGeometry(0.045, 0.2, 0.08), metal, 0, -0.13, -0.15).rotation.x = w === 'ak' ? 0.35 : 0.15;
  if (w === 'sg') add(new THREE.BoxGeometry(0.08, 0.06, 0.25), wood, 0, -0.06, -0.35);
  if (w === 'sn') { const s = add(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 12), metal, 0, 0.1, -0.1); s.rotation.x = Math.PI / 2; }
  if (w === 'ak') add(new THREE.BoxGeometry(0.065, 0.06, 0.25), wood, 0, -0.01, -0.35);
  const hand = M(0x6b4a33); add(new THREE.BoxGeometry(0.09, 0.09, 0.15), hand, 0.0, -0.1, 0.12); add(new THREE.BoxGeometry(0.08, 0.08, 0.12), hand, 0, -0.07, -0.33);
  viewGun.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.depthTest = true; } });
  viewGun.position.set(0.22, -0.2, -0.45); viewGun.scale.setScalar(0.75);
}
const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0, blending: THREE.AdditiveBlending }));
camera.add(muzzle); muzzle.position.set(0.22, -0.17, -1.05);

// ============================================================ NETWORK
const net = { ws: null, id: 0, host: true, peers: new Map(), online: false };
function nsend(m) { if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(m)); }
function connect(room, name) {
  return new Promise((res) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws; try { ws = new WebSocket(`${proto}://${location.host}`); } catch { return res(false); }
    const to = setTimeout(() => res(false), 3000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name }));
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'welcome') { clearTimeout(to); net.ws = ws; net.online = true; net.id = m.id; net.host = m.host; me.pos.x += m.slot * 2.5; m.peers.forEach(p => addPeer(p.id, p.name)); res(true); } else if (m.t === 'full') { clearTimeout(to); alert('That squad is full (4/4).'); res(false); } else onNet(m); };
    ws.onerror = () => { clearTimeout(to); res(false); };
    ws.onclose = () => { net.online = false; };
  });
}
function addPeer(id, name) {
  if (net.peers.has(id)) return;
  const model = makeHuman({ shirt: 0x2b3523, vest: 0x1c241a, head: 0x111111, tag: name, gun: false, uniform: true }); setOutfit(model, 'casual');
  model.visible = false; scene.add(model);
  net.peers.set(id, { id, name, model, pos: new THREE.Vector3(), target: new THREE.Vector3(), yaw: 0, hp: 100, down: false, dead: false, phase: 'menu', inZone: false, t: 0 });
  toast(`${name} joined the squad`);
}
function onNet(m) {
  const p = net.peers.get(m.from);
  switch (m.t) {
    case 'peerJoin': addPeer(m.id, m.name); break;
    case 'peerLeave': { const q = net.peers.get(m.id); if (q) { scene.remove(q.model); net.peers.delete(m.id); toast(`${q.name} disconnected`); } break; }
    case 'host': net.host = true; toast('You are now the squad host'); break;
    case 's': if (p) { p.target.fromArray(m.p); p.yaw = m.ry; p.hp = m.hp; p.down = m.down; p.dead = m.dead; p.phase = m.ph; p.inZone = m.z; p.inside = m.in; p.outfit = m.o; p.t = performance.now(); } break;
    case 'e': if (!net.host) applyEnemySnapshot(m.l); break;
    case 'hit': if (net.host) damageEnemy(m.id, m.d, m.hs, m.from); break;
    case 'pdmg': hurt(m.d); break;
    case 'shot': tracer(new THREE.Vector3(...m.a), new THREE.Vector3(...m.b), m.c || 0xffd080); sfx(m.s || 'shot', new THREE.Vector3(...m.a), 0.8); if (net.host) alertNear(new THREE.Vector3(...m.a), 30); break;
    case 'boom': explosionFx(new THREE.Vector3(...m.p), m.r); applyBlast(new THREE.Vector3(...m.p), m.r, m.d, false); break;
    case 'nade': throwNade(new THREE.Vector3(...m.p), new THREE.Vector3(...m.v), false, m.k || 'frag'); break;
    case 'brief': startBrief(); break;
    case 'ping': addPing(new THREE.Vector3(...m.p), p ? p.name : 'Squad'); break;
    case 'say': say(String(m.txt).slice(0, 80), p ? p.name : 'Squad', '#ffd27a'); break;
    case 'hostage': setHostage(m.id, m.s, false); break;
    case 'revive': if (me.down && !me.dead) { me.down = false; me.hp = 35; toast(`${p ? p.name : 'Teammate'} revived you!`); } break;
    case 'end': endGame(m.win, m.r, false); break;
  }
}

// ============================================================ ENEMIES & HOSTAGES
const ENEMY_DEFS = [ // [type, x, z, floor] — the squad is never told where these are
  ['rifle', -25, 5, 0], ['rifle', 12, 21, 0], ['bomber', 27, -5, 0],
  ['rifle', -18, 21, 1], ['rifle', -25, -6, 1], ['bomber', 6, -21, 1], ['rifle', -10, 14, 1],
  ['rifle', 27, 6, 2], ['bomber', 18, 21, 2], ['boss', 0, 14.5, 2],
];
const enemies = ENEMY_DEFS.map(([type, x, z, floor], id) => {
  const model = makeHuman({ shirt: type === 'bomber' ? 0x3a3a3a : 0x2a2a2a, pants: 0x3b3b44, vest: type === 'bomber' ? 0x6a5a2a : 0x1a1a1a, head: 0x101010, modelTint: type === 'bomber' ? 0x6a5a48 : 0x3a3a3a });
  if (type === 'bomber') { // explosive vest with blinking light
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshStandardMaterial({ emissive: 0xff0000, emissiveIntensity: 5 })); led.position.set(0, 1.3, 0.2); model.add(led); model.userData.led = led;
  }
  if (type === 'boss') { // tripod machine gun
    const mg = new THREE.Group(); const metal = M(0x121212, { metalness: 0.7, roughness: 0.4 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 10), metal); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 1.25, 1.2); mg.add(barrel);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.7), metal); body.position.set(0, 1.25, 0.6); mg.add(body);
    for (const a of [0, 2.1, 4.2]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), metal); leg.position.set(Math.sin(a) * 0.4, 0.6, 0.6 + Math.cos(a) * 0.4); leg.rotation.set(Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4); mg.add(leg); }
    model.add(mg);
  }
  model.position.set(IN.x + x, floor * FLOOR_H, IN.z + z); model.rotation.y = type === 'boss' ? Math.PI : rand(0, 6.28);
  model.traverse(o => { if (o.isMesh) o.userData.enemy = id; });
  scene.add(model);
  const hp = type === 'boss' ? 750 : type === 'bomber' ? 80 : 100;
  return { id, type, model, hp, max: hp, alive: true, alert: false, seen: 0, lastSeen: null, fireT: 0, burst: 0, armed: -1, home: model.position.clone(), patrolT: rand(0, 5), lastSeenByPlayer: 0, deadAnim: 0 };
});
const HOSTAGE_DEFS = [[-30, -8, 0], [-28, 22, 1], [30, -22, 1], [-28, 6, 1], [-6, -22, 2], [30, -6, 2], [-30, -22, 2], [6, 22, 2]];
const hostages = HOSTAGE_DEFS.map(([x, z, f], id) => {
  const m = makeHuman({ shirt: [0xf0f0f0, 0xc04040, 0x4060c0, 0xe0c080][id % 4], pants: 0x222244, vest: [0xf0f0f0, 0xc04040, 0x4060c0, 0xe0c080][id % 4], head: 0x111111, gun: false });
  m.position.set(IN.x + x, f * FLOOR_H, IN.z + z); m.rotation.y = rand(0, 6);
  m.userData.armL.rotation.x = -3; m.userData.armR.rotation.x = -3;
  m.traverse(o => { if (o.isMesh) o.userData.hostage = id; }); scene.add(m);
  return { id, model: m, state: 'held' }; // held | rescued | dead
});
let hostageDeaths = 0, rescued = 0;
function setHostage(id, s, broadcast = true) {
  const h = hostages[id]; if (!h || h.state !== 'held') return;
  h.state = s; h.model.visible = s === 'held' ? true : false;
  if (s === 'dead') { hostageDeaths++; toast(`A hostage was killed! (${hostageDeaths}/3)`, '#f55'); blood(h.model.position.clone().addY(1)); if (hostageDeaths >= 3 && net.host) endGame(false, 'Three hostages died. Command has aborted the operation.'); }
  if (s === 'rescued') { rescued++; toast(`Hostage evacuated (${rescued}/${hostages.length})`, '#6f6'); }
  if (broadcast) nsend({ t: 'hostage', id, s });
}
function alertNear(p, r) { for (const e of enemies) if (e.alive && e.model.position.distanceTo(p) < r) { e.alert = true; if (!e.lastSeen) e.lastSeen = p.clone(); } }

function allPlayers() {
  const list = [];
  if (inside) list.push({ id: net.id, pos: me.pos, alive: !me.down && !me.dead, local: true });
  for (const p of net.peers.values()) if (p.inside && p.phase === 'assault') list.push({ id: p.id, pos: p.pos, alive: !p.down && !p.dead, local: false });
  return list;
}
const ray = new THREE.Raycaster();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
function lineOfSight(a, b) {
  tmpV.subVectors(b, a); const d = tmpV.length(); tmpV.normalize();
  ray.set(a, tmpV); ray.far = d - 0.4;
  return ray.intersectObjects(solids, false).length === 0 && !smokeBlocks(a, b);
}
function damageEnemy(id, dmg, headshot, by) {
  const e = enemies[id]; if (!e || !e.alive) return;
  if (!net.host) { nsend({ t: 'hit', id, d: dmg, hs: headshot }); return; }
  e.hp -= dmg * (headshot ? (e.type === 'boss' ? 1.6 : 2.5) : 1); e.alert = true;
  if (e.hp <= 0) killEnemy(e);
}
function killEnemy(e) {
  e.alive = false; e.deadAnim = 0.001;
  if (e.type === 'bomber' && e.armed < 0) e.armed = 1.4; // dead-man switch
  if (e.type === 'boss') toast('The machine-gunner is down!', '#ff0');
  const left = enemies.filter(x => x.alive).length;
  toast(left ? `Hostile neutralised — ${left} remaining` : 'ALL HOSTILES NEUTRALISED', '#ffd21f');
}
function applyBlast(p, r, dmg, hostSide = true) {
  const d = me.pos.clone().addY(1).distanceTo(p);
  if (inside && d < r && lineOfSight(p.clone().addY(1.2), me.pos.clone().addY(1.2))) hurt(dmg * (1 - d / r));
  if (hostSide && net.host) {
    for (const e of enemies) if (e.alive && e.model.position.distanceTo(p) < r) damageEnemy(e.id, dmg * (1 - e.model.position.distanceTo(p) / r), false);
    for (const h of hostages) if (h.state === 'held' && h.model.position.distanceTo(p) < r * 0.8) setHostage(h.id, 'dead');
  }
}
function applyEnemySnapshot(list) {
  for (const [id, x, z, y, ry, alive, armed, hp] of list) {
    const e = enemies[id]; e.model.position.x += (x - e.model.position.x) * 0.5; e.model.position.z += (z - e.model.position.z) * 0.5; e.model.position.y = y; e.model.rotation.y = ry;
    e.hp = hp; e.armed = armed; if (e.alive && !alive) { e.alive = false; e.deadAnim = 0.001; }
  }
}
function enemyShoot(e, target) {
  const from = e.model.position.clone().addY(1.4);
  const to = target.pos.clone().addY(1.2 + rand(-0.4, 0.4));
  const dist = from.distanceTo(to);
  const moving = target.local ? me.vel.length() > 2 : true;
  const base = e.type === 'boss' ? 0.38 : 0.55;
  const p = clamp(base - dist * 0.009 - (moving ? 0.15 : 0) + (e.type === 'boss' ? 0 : 0.0), 0.06, 0.8);
  const hit = Math.random() < p;
  if (!hit) to.add(new THREE.Vector3(rand(-1.5, 1.5), rand(-0.5, 1), rand(-1.5, 1.5)));
  const dmg = e.type === 'boss' ? 7 : 9;
  tracer(from, to, 0xff7040); sfx(e.type === 'boss' ? 'mg' : 'shot', from, 0.7);
  nsend({ t: 'shot', a: from.toArray(), b: to.toArray(), c: 0xff7040, s: e.type === 'boss' ? 'mg' : 'shot' });
  if (hit) { if (target.local) hurt(dmg); else nsend({ t: 'pdmg', to: target.id, d: dmg }); }
  // stray rounds can kill hostages
  for (const h of hostages) if (h.state === 'held' && !hit && h.model.position.distanceTo(to) < 1.0 && Math.random() < 0.3) setHostage(h.id, 'dead');
}
function moveWithCollision(pos, dx, dz, r = 0.4) { pos.x += dx; pos.z += dz; collide(pos, r); pos.y = groundAt(pos.x, pos.z, pos.y); }
function updateEnemiesHost(dt) {
  const players = allPlayers();
  for (const e of enemies) {
    const m = e.model;
    if (!e.alive) {
      if (e.armed > 0) { e.armed -= dt; if (Math.floor(e.armed * 8) % 2 === 0) sfx('beep', m.position, 0.9); if (e.armed <= 0) { e.armed = -2; const p = m.position.clone().addY(1); explosionFx(p, 9); applyBlast(p, 9, 140); nsend({ t: 'boom', p: p.toArray(), r: 9, d: 140 }); m.visible = false; } }
      continue;
    }
    if (e.stun > 0) { e.stun -= dt; m.rotation.y += dt * 2; e.seen = 0; continue; } // flashbanged
    // find visible target
    let best = null, bd = 1e9;
    const eye = m.position.clone().addY(1.6);
    for (const p of players) {
      if (!p.alive) continue; const d = p.pos.distanceTo(m.position);
      if (d > (e.type === 'boss' ? 60 : 48)) continue;
      const fwd = new THREE.Vector3(Math.sin(m.rotation.y), 0, Math.cos(m.rotation.y));
      const dir = p.pos.clone().sub(m.position).setY(0).normalize();
      if (!e.alert && fwd.dot(dir) < -0.1 && d > 6) continue;
      if (!lineOfSight(eye, p.pos.clone().addY(1.5))) continue;
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      e.alert = true; e.lastSeen = best.pos.clone(); e.seen += dt;
      const target = Math.atan2(best.pos.x - m.position.x, best.pos.z - m.position.z);
      m.rotation.y += (((target - m.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * (e.type === 'boss' ? 2.5 : 6));
      if (e.type === 'bomber') { // charge the squad and detonate
        const dir = best.pos.clone().sub(m.position).setY(0).normalize();
        moveWithCollision(m.position, dir.x * 4.2 * dt, dir.z * 4.2 * dt);
        if (bd < 3.5 && e.armed < 0) { e.armed = 1.2; toast('VEST ARMED — GET BACK!', '#f33'); }
        if (e.armed > 0) { e.armed -= dt; if (Math.floor(e.armed * 10) % 2 === 0) sfx('beep', m.position); if (e.armed <= 0) { e.alive = false; e.armed = -2; const p = m.position.clone().addY(1); explosionFx(p, 9); applyBlast(p, 9, 140); nsend({ t: 'boom', p: p.toArray(), r: 9, d: 140 }); m.visible = false; const left = enemies.filter(x => x.alive).length; toast(`Bomber detonated — ${left} remaining`, '#f80'); } }
      } else if (e.seen > (e.type === 'boss' ? 0.4 : 0.7)) {
        e.fireT -= dt;
        if (e.fireT <= 0) {
          enemyShoot(e, best);
          if (e.type === 'boss') e.fireT = 0.09;
          else { e.burst++; e.fireT = e.burst % 4 === 0 ? rand(0.8, 1.4) : 0.15; }
        }
        if (e.type === 'rifle') { // strafe a bit
          const side = new THREE.Vector3(Math.cos(m.rotation.y), 0, -Math.sin(m.rotation.y)).multiplyScalar(Math.sin(performance.now() / 700 + e.id) * 1.4 * dt);
          moveWithCollision(m.position, side.x, side.z);
        }
      }
    } else {
      e.seen = Math.max(0, e.seen - dt);
      // squad is hiding behind cover → flush them out with a grenade
      e.nadeT = (e.nadeT ?? rand(6, 12)) - dt;
      if (e.type === 'rifle' && e.alert && e.lastSeen && e.nadeT <= 0 && e.lastSeen.distanceTo(m.position) < 22 && e.lastSeen.distanceTo(m.position) > 5) {
        e.nadeT = rand(12, 20); const T = 1.1, from = m.position.clone().addY(1.6), tgt = e.lastSeen.clone().add(new THREE.Vector3(rand(-1.5, 1.5), 0, rand(-1.5, 1.5)));
        const v = tgt.sub(from).divideScalar(T); v.y += 0.5 * 14 * T; throwNade(from, v, true, 'efrag'); toast('GRENADE! — MOVE!', '#f33');
      }
      if (e.type !== 'boss') {
        if (e.alert && e.lastSeen && e.lastSeen.distanceTo(m.position) > 2) {
          const dir = e.lastSeen.clone().sub(m.position).setY(0).normalize();
          m.rotation.y = Math.atan2(dir.x, dir.z);
          moveWithCollision(m.position, dir.x * 2.6 * dt, dir.z * 2.6 * dt);
        } else { e.patrolT += dt; m.rotation.y += Math.sin(e.patrolT * 0.5) * dt * 0.6; }
      }
    }
  }
}
let snapT = 0;
function updateEnemiesVisual(dt) {
  for (const e of enemies) {
    const m = e.model, u = m.userData;
    if (u.led) u.led.material.emissiveIntensity = e.armed > 0 ? (Math.sin(performance.now() / 40) > 0 ? 10 : 0) : 2;
    if (!e.alive && e.deadAnim > 0 && e.deadAnim < 1) { e.deadAnim = Math.min(1, e.deadAnim + dt * 2.5); m.rotation.x = -e.deadAnim * Math.PI / 2; m.userData.dead = true; if (!m.userData.baseY) m.userData.baseY = m.position.y; m.position.y = m.userData.baseY + e.deadAnim * 0.25; m.traverse(o => { if (o.isMesh) o.userData.enemy = undefined; }); }
    if (e.alive) { const s = Math.sin(performance.now() / 150 + e.id) * 0.3; u.legL.rotation.x = s; u.legR.rotation.x = -s; }
  }
}

// ============================================================ COLLISION
function collide(pos, r) {
  for (const c of colliders) {
    if (pos.y > c.maxY - 0.01 || pos.y + 1.8 < c.minY || c.maxY - pos.y <= STEP) continue;
    if (c.obb) {
      if (pos.x < c.minX - r || pos.x > c.maxX + r || pos.z < c.minZ - r || pos.z > c.maxZ + r) continue;
      const dx0 = pos.x - c.cx, dz0 = pos.z - c.cz, lx = dx0 * c.cos + dz0 * c.sin, lz = -dx0 * c.sin + dz0 * c.cos;
      const px = clamp(lx, -c.hw, c.hw), pz = clamp(lz, -c.hd, c.hd), ex = lx - px, ez = lz - pz, e2 = ex * ex + ez * ez;
      if (e2 >= r * r) continue;
      let nx, nz;
      if (e2 > 1e-8) { const e = Math.sqrt(e2); nx = px + ex / e * r; nz = pz + ez / e * r; }
      else { const o = [c.hw - lx, lx + c.hw, c.hd - lz, lz + c.hd], i = o.indexOf(Math.min(...o)); nx = i === 0 ? c.hw + r : i === 1 ? -c.hw - r : lx; nz = i === 2 ? c.hd + r : i === 3 ? -c.hd - r : lz; }
      pos.x = c.cx + nx * c.cos - nz * c.sin; pos.z = c.cz + nx * c.sin + nz * c.cos; continue;
    }
    const cx = clamp(pos.x, c.minX, c.maxX), cz = clamp(pos.z, c.minZ, c.maxZ);
    const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) { const d = Math.sqrt(d2); pos.x += dx / d * (r - d); pos.z += dz / d * (r - d); }
      else { const o = [c.maxX - pos.x + r, pos.x - c.minX + r, c.maxZ - pos.z + r, pos.z - c.minZ + r]; const i = o.indexOf(Math.min(...o)); if (i === 0) pos.x = c.maxX + r; else if (i === 1) pos.x = c.minX - r; else if (i === 2) pos.z = c.maxZ + r; else pos.z = c.minZ - r; }
    }
  }
}

// ============================================================ COMBAT (player)
let mouseDown = false;
function fire() {
  const w = WEAPONS[me.weapon], now = performance.now();
  if (phase !== 'assault' || me.down || me.reloading > 0 || now - me.lastShot < 60000 / w.rpm) return;
  if (me.ammo <= 0) { reload(); return; }
  me.lastShot = now; me.ammo--;
  const n = w.pellets || 1;
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const spreadMul = (me.aim ? 0.35 : 1) * (me.vel.length() > 3 ? 1.8 : 1);
  const targets = [...solids]; enemies.forEach(e => e.alive && e.model.traverse(o => o.isMesh && targets.push(o))); hostages.forEach(h => h.state === 'held' && h.model.traverse(o => o.isMesh && targets.push(o)));
  for (let i = 0; i < n; i++) {
    const dir = new THREE.Vector3(rand(-1, 1), rand(-1, 1), 0).multiplyScalar(w.spread * spreadMul).add(new THREE.Vector3(0, 0, -1)).normalize().applyQuaternion(camera.quaternion);
    ray.set(origin, dir); ray.far = 300;
    const hit = ray.intersectObjects(targets, false)[0];
    const end = hit ? hit.point : origin.clone().addScaledVector(dir, 300);
    const gunTip = muzzle.getWorldPosition(new THREE.Vector3());
    tracer(gunTip, end);
    if (i === 0) nsend({ t: 'shot', a: gunTip.toArray(), b: end.toArray(), s: w.snd });
    if (hit) {
      const ud = hit.object.userData;
      if (ud.enemy !== undefined) { blood(hit.point); damageEnemy(ud.enemy, w.dmg, ud.part === 'head'); hitmarker(ud.part === 'head'); }
      else if (ud.hostage !== undefined) setHostage(ud.hostage, 'dead');
      else spark(hit.point);
    }
  }
  if (net.host) alertNear(me.pos, 30);
  sfx(w.snd, null, 0.7);
  muzzle.material.opacity = 1; flashLight.position.copy(origin); flashLight.intensity = 8;
  recoil += me.weapon === 'sn' ? 0.06 : me.weapon === 'sg' ? 0.05 : 0.012;
  if (me.ammo === 0) reload();
}
let recoil = 0;
function reload() {
  const w = WEAPONS[me.weapon]; if (me.reloading > 0 || me.ammo === w.mag || me.reserve <= 0) return;
  me.reloading = me.weapon === 'sn' ? 3 : me.weapon === 'sg' ? 2.6 : 2.1; sfx('reload');
}
const nades = [];
// kinds: frag (damage) · flash (blinds/stuns) · smoke (blocks line of sight) · efrag (thrown by terrorists)
const NADE_COLOR = { frag: 0x2c3a24, flash: 0x9a9a9a, smoke: 0x3a5a7a, efrag: 0x4a2a1a };
function throwNade(p, v, mine = true, kind = 'frag') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 10), M(NADE_COLOR[kind], { metalness: 0.4, roughness: 0.4 })); m.position.copy(p); scene.add(m);
  if (kind === 'efrag') { const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 })); led.position.y = 0.1; m.add(led); }
  nades.push({ m, v: v.clone(), t: kind === 'flash' ? 1.6 : kind === 'efrag' ? 2.2 : 2.4, mine, kind });
  if (mine) nsend({ t: 'nade', p: p.toArray(), v: v.toArray(), k: kind });
}
const smokes = []; // {p, r, t}
function detonate(kind, bp) {
  if (kind === 'frag' || kind === 'efrag') { explosionFx(bp, 8); applyBlast(bp, 8, kind === 'efrag' ? 110 : 220); if (net.host) alertNear(bp, 30); return; }
  if (kind === 'flash') {
    sfx('boom', bp, 0.6); spark(bp, 0xffffff, 30); shake = Math.max(shake, 0.3);
    const fl = new THREE.PointLight(0xffffff, 900, 30, 1.5); fl.position.copy(bp).y += 1; scene.add(fl); fx.push({ o: fl, life: 0.25, max: 0.25, light: 900 });
    // blind local player if close and looking at it
    const eye = camera.getWorldPosition(new THREE.Vector3()), to = bp.clone().sub(eye), d = to.length();
    const facing = to.normalize().dot(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion));
    if (inside && d < 14 && lineOfSight(bp.clone().addY(0.6), eye)) { const a = clamp((1 - d / 14) * (facing > 0.3 ? 1.3 : 0.5), 0, 1); const f = $('flashbang'); f.style.transition = 'none'; f.style.opacity = a; setTimeout(() => { f.style.transition = 'opacity 3.5s'; f.style.opacity = 0; }, 900); }
    if (net.host) for (const e of enemies) if (e.alive && e.model.position.distanceTo(bp) < 12 && lineOfSight(bp.clone().addY(0.6), e.model.position.clone().addY(1.6))) { e.stun = e.type === 'boss' ? 2.5 : 4.5; e.alert = true; }
    return;
  }
  if (kind === 'smoke') {
    sfx('reload', bp, 1); const g = new THREE.Group(); scene.add(g);
    for (let i = 0; i < 26; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xb8bcc0, transparent: true, opacity: 0, depthWrite: false })); sp.position.copy(bp).add(new THREE.Vector3(rand(-3.5, 3.5), rand(0.3, 3.2), rand(-3.5, 3.5))); sp.scale.setScalar(rand(4, 6.5)); sp.userData.o = rand(0.45, 0.75); g.add(sp); }
    smokes.push({ p: bp.clone().addY(1.5), r: 4.5, t: 16, g });
  }
}
function smokeBlocks(a, b) { // does any smoke cloud sit between a and b?
  for (const s of smokes) { if (s.t < 1) continue; const ab = tmpV2.subVectors(b, a); const tt = clamp(s.p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1); if (a.clone().addScaledVector(ab, tt).distanceTo(s.p) < s.r) return true; }
  return false;
}
function hurt(d) {
  if (me.down || me.dead || phase !== 'assault') return;
  me.hp -= d; me.lastHurt = performance.now(); $('dmg').style.opacity = 0.9; setTimeout(() => $('dmg').style.opacity = 0, 180);
  if (me.hp <= 0) { me.hp = 0; me.down = true; me.downT = 45; toast('YOU ARE DOWN — a teammate can revive you (E)', '#f44'); }
}
function hitmarker(head) { const c = $('cross'); c.style.filter = head ? 'drop-shadow(0 0 4px red) brightness(2)' : 'drop-shadow(0 0 3px #fff)'; setTimeout(() => c.style.filter = '', 120); }

// ============================================================ UI
let toastT = 0;
function toast(t, color = '#fff') { const m = $('msg'); m.textContent = t; m.style.color = color; toastT = 3; }
function objective(t) { $('obj').textContent = t; }
let dialogQ = null;
function showDialog(who, lines, done) { dialogQ = { who, lines: [...lines], done }; nextDialog(); }
function nextDialog() {
  if (!dialogQ) return;
  if (!dialogQ.lines.length) { $('dialog').style.display = 'none'; const d = dialogQ.done; dialogQ = null; d && d(); return; }
  $('dialog').style.display = 'block'; $('dialog').querySelector('.who').textContent = dialogQ.who; $('dialog').querySelector('.txt').textContent = dialogQ.lines.shift();
}
function phoneUp(text, ms = 7000) { $('palert').textContent = text; $('phone').classList.add('up'); if (ms) setTimeout(() => $('phone').classList.remove('up'), ms); }

// ============================================================ STORY FLOW
function startStory() {
  phase = 'toHandler'; $('hud').style.display = 'block';
  marker.position.copy(SPOTS.handler).add(new THREE.Vector3(0, 0, 3)); marker.visible = true;
  objective('Meet Colonel Rathore at the yellow marker');
  toast('Mumbai — 26 November 2008, 18:30', '#ffd21f');
}
function storyUpdate(dt) {
  if (phase === 'toHandler' && me.pos.distanceTo(marker.position) < 3.5) {
    phase = 'talk'; marker.visible = false; colonel.lookAt(me.pos.x, 0, me.pos.z);
    showDialog('Col. Rathore', [
      'Good to see you, soldiers. Your training at the camp is complete — you\'re the best of this batch.',
      'In a few days you move to the next camp. Until then, you\'ll stay at the safehouse in Colaba.',
      'Here are the keys. And these — secure military phones. Keep them on you at all times. Day or night.',
      'If this phone rings, you drop everything. Understood? Dismissed.',
    ], () => {
      phoneUp('Secure phone issued.\nOwner: NSG Special Action Group\nSafehouse: Colaba — marked on your map.', 5000);
      sfx('phone');
      phase = 'toHome'; marker.position.copy(SPOTS.home).add(new THREE.Vector3(0, 0, 18)); marker.visible = true;
      objective('Go to the safehouse (yellow marker)');
    });
  }
  if (phase === 'toHome' && me.pos.distanceTo(marker.position) < 3.5) {
    phase = 'rest'; marker.visible = false;
    const c = $('cine'); c.classList.add('show'); $('cinetext').textContent = 'Later that night… 21:48'; $('cinetext').classList.add('on');
    setTimeout(() => {
      setNight(); c.classList.remove('show'); $('cinetext').classList.remove('on');
      objective('Rest at the safehouse…');
      setTimeout(() => {
        let n = 0; const ring = setInterval(() => { sfx('phone'); if (++n > 5) clearInterval(ring); }, 400);
        phoneUp('⚠ FLASH — CODE RED\nMultiple terror attacks across South Mumbai. Gunmen inside the Taj Mahal Palace hotel. Guests trapped. Fire in the heritage wing.', 0);
        fireGroup.visible = true; tajFireLight.intensity = 400; redZoneProps.visible = true;
        peds.forEach(p => p.userData.panic = true);
        objective('Incoming message…');
        setTimeout(() => { // the Colonel orders the squad to gear up
          sfx('phone'); phoneUp('Col. Rathore:\n"This is it. Your tactical kit is in the safehouse locker. Suit up NOW — full gear, black.\nThen get to the red zone at the Taj. Move!"', 0);
          setTimeout(() => {
            $('phone').classList.remove('up');
            const c2 = $('cine'); c2.classList.add('show'); $('cinetext').textContent = 'Suiting up — NSG tactical kit'; $('cinetext').classList.add('on');
            setTimeout(() => {
              me.outfit = 'tactical'; if (meModel) setOutfit(meModel, 'tactical');
              c2.classList.remove('show'); $('cinetext').classList.remove('on');
              phase = 'toRed'; redMarker.position.copy(SPOTS.red); redMarker.visible = true;
              objective('EMERGENCY: Get to the red zone at the Taj Hotel');
            }, 2500);
          }, 6000);
        }, 6000);
      }, 3500);
    }, 2500);
  }
  if (phase === 'toRed') {
    me.inZone = me.pos.distanceTo(SPOTS.red) < 9;
    const squad = [...net.peers.values()];
    const ready = squad.filter(p => p.inZone).length + (me.inZone ? 1 : 0);
    if (me.inZone) {
      $('hint').textContent = squad.length ? `Squad at the red zone: ${ready}/${squad.length + 1}${net.host ? ' — press ENTER to start without them' : ''}` : '';
      if (net.host && (ready === squad.length + 1 || keys['Enter'])) { nsend({ t: 'brief' }); startBrief(); }
    } else $('hint').textContent = '';
  }
}
const NARRATION = [
  '26 November 2008.\nTen terrorists came ashore at Colaba, Mumbai, on inflatable boats.',
  'They split into teams and attacked CST railway station, Leopold Cafe, Cama Hospital, Nariman House and the Oberoi-Trident hotel.',
  'Gunmen stormed the Taj Mahal Palace hotel, firing on guests and staff. Grenades and fires tore through the historic heritage wing.',
  'Over the following days, the attacks took about 166 lives and injured more than 300 people.',
  'India\'s National Security Guard launched Operation Black Tornado to end the siege.',
  'This mission is a dramatisation in their honour.\nTen hostiles hold the hotel. Hostages are trapped inside.',
  'Your mission: neutralise every hostile. Protect the hostages.\nAt least one of you must come out alive.',
  'Make your own plan. Your squad. Your call.',
];
let briefing = false;
function startBrief() {
  if (briefing || phase === 'assault') return; briefing = true;
  phase = 'brief'; redMarker.visible = false; $('hint').textContent = ''; $('phone').classList.remove('up');
  document.exitPointerLock?.();
  const c = $('cine'); c.classList.add('show'); let i = 0, timer;
  const step = () => {
    if (i >= NARRATION.length) { c.classList.remove('show'); c.onclick = null; openLoadout(); return; }
    const p = $('cinetext'); p.classList.remove('on');
    setTimeout(() => { p.innerText = NARRATION[i++]; p.classList.add('on'); }, 500);
    timer = setTimeout(step, 6000);
  };
  c.onclick = () => { clearTimeout(timer); i = NARRATION.length; step(); };
  step();
}
function openLoadout() {
  phase = 'loadout'; const box = $('guns'); box.innerHTML = '';
  for (const [k, w] of Object.entries(WEAPONS)) {
    const d = document.createElement('div'); d.className = 'gun' + (k === me.weapon ? ' sel' : '');
    d.innerHTML = `<b>${w.role}</b><br>${w.name}<div class="small">${w.desc}<br>DMG ${w.dmg}${w.pellets ? '×' + w.pellets : ''} · ${w.rpm} RPM · MAG ${w.mag}</div>`;
    d.onclick = () => { me.weapon = k; [...box.children].forEach(c => c.classList.remove('sel')); d.classList.add('sel'); };
    box.appendChild(d);
  }
  $('loadout').classList.add('show');
}
$('deploy').onclick = () => {
  $('loadout').classList.remove('show');
  const w = WEAPONS[me.weapon]; me.ammo = w.mag; me.reserve = w.reserve; me.inv = { frag: 3, flash: 2, smoke: 2 }; me.hp = 100;
  buildViewGun(me.weapon);
  enterInterior();
  renderer.domElement.requestPointerLock();
};
function enterInterior() {
  inside = true; phase = 'assault';
  me.pos.set(IN.x - 3 + (net.id % 4) * 2, 0, IN.z - 22); me.yaw = Math.PI; me.pitch = 0;
  sunLight.visible = false; hemi.intensity = 0.35; hemi.color.set(0xffe8c8); hemi.groundColor.set(0x40302a); scene.fog.density = 0.02; scene.fog.color.set(0x140c08);
  interiorLights.forEach(l => l.visible = true); cityLights.forEach(l => l.visible = false); sky.visible = false; stars.visible = false;
  scene.background = new THREE.Color(0x050302); renderer.toneMappingExposure = 0.8; bloom.threshold = 0.95; bloom.strength = 0.5;
  objective('Clear the Taj — 3 floors. Find and neutralise all 10 hostiles. Rescue hostages (E). Your plan.');
  toast('Operation Black Tornado is GO', '#ffd21f');
}
let exfilMarker = null;
function assaultUpdate(dt) {
  const left = enemies.filter(e => e.alive).length;
  if (left === 0 && !exfilMarker) {
    exfilMarker = makeMarker(0x30ff60); exfilMarker.position.set(IN.x, 0, IN.z - 22); exfilMarker.visible = true;
    objective('All hostiles down. Get out alive — EXFIL at the lobby entrance (green)');
  }
  if (exfilMarker && !me.down && me.pos.distanceTo(exfilMarker.position) < 3) endGame(true, '', true);
  if (!exfilMarker) objective(`Hostiles remaining: ${left}/10 · Hostages rescued: ${rescued} · Lost: ${hostageDeaths}/3`);
  // down / bleed out
  if (me.down && !me.dead) { me.downT -= dt; $('hint').textContent = `DOWN — bleeding out in ${Math.ceil(me.downT)}s`; if (me.downT <= 0) { me.dead = true; toast('You have died.', '#f44'); } }
  // revive / rescue prompts
  else {
    let hint = '';
    for (const p of net.peers.values()) if (p.down && !p.dead && p.pos.distanceTo(me.pos) < 2.5) { hint = `Press E to revive ${p.name}`; if (keys.KeyE) { nsend({ t: 'revive', to: p.id }); keys.KeyE = false; } }
    for (const h of hostages) if (h.state === 'held' && h.model.position.distanceTo(me.pos) < 2.5) { hint = 'Press E to evacuate hostage'; if (keys.KeyE) { setHostage(h.id, 'rescued'); keys.KeyE = false; } }
    $('hint').textContent = hint;
  }
  // regen
  if (!me.down && performance.now() - me.lastHurt > 6000 && me.hp < 100) me.hp = Math.min(100, me.hp + 5 * dt);
  // squad wipe check (host)
  if (net.host) {
    const all = [{ down: me.down || me.dead }, ...[...net.peers.values()].filter(p => p.phase === 'assault').map(p => ({ down: p.down || p.dead }))];
    if (all.every(p => p.down)) endGame(false, 'The entire squad is down. The siege continues…');
  }
}
let ended = false;
function endGame(win, reason, broadcast = true) {
  if (ended) return; ended = true; phase = 'end';
  if (broadcast) nsend({ t: 'end', win, r: reason });
  document.exitPointerLock?.();
  $('endT').textContent = win ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED';
  $('endT').style.color = win ? '#5f5' : '#f44';
  $('endS').textContent = win ? `The Taj is secure. Hostages evacuated: ${rescued}. Hostages lost: ${hostageDeaths}. In memory of the victims and the heroes of 26/11.` : reason;
  $('end').classList.add('show');
}

// ============================================================ SQUAD COMMS (the team makes its own plan)
const floorOf = y => clamp(Math.round(y / FLOOR_H), 0, FLOORS - 1);
const pings = [];
function addPing(p, who) {
  const s = textSprite('▼ ' + who, '#ffd21f'); s.position.copy(p).addY(1.4); s.material.depthTest = false; scene.add(s);
  pings.push({ s, t: 12, p: p.clone() }); sfx('beep', null, 0.4);
}
const feedLines = [];
function say(txt, who = me.name, color = '#9fd4ff') {
  feedLines.push({ html: `<b style="color:${color}">${who}:</b> ${txt.replace(/</g, '&lt;')}`, t: 14 });
  while (feedLines.length > 7) feedLines.shift();
}
const CALLOUTS = { KeyZ: 'Room clear!', KeyX: 'Moving UPSTAIRS — cover me', KeyC: 'Moving DOWNSTAIRS', KeyV: 'NEED BACKUP at my position!' };
function squadKey(code) {
  if (CALLOUTS[code]) { const where = inside ? ` (${FLOOR_NAMES[floorOf(me.pos.y)]})` : ''; say(CALLOUTS[code] + where); nsend({ t: 'say', txt: CALLOUTS[code] + where }); return true; }
  if (code === 'KeyQ') {
    ray.setFromCamera(new THREE.Vector2(0, 0), camera); ray.far = 200;
    const targets = [...solids]; enemies.forEach(e => e.alive && e.model.traverse(o => o.isMesh && o.userData.part && targets.push(o)));
    const hit = ray.intersectObjects(targets, false)[0]; if (!hit) return true;
    const enemy = hit.object.userData.enemy !== undefined;
    addPing(hit.point, me.name); nsend({ t: 'ping', p: hit.point.toArray() });
    if (enemy) { say('HOSTILE spotted here!', me.name, '#ff8080'); nsend({ t: 'say', txt: 'HOSTILE spotted here!' }); }
    return true;
  }
  if (code === 'KeyY') { const c = $('chat'); c.style.display = 'block'; document.exitPointerLock?.(); setTimeout(() => c.focus(), 0); return true; }
  return false;
}
$('chat').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') { const v = e.target.value.trim(); if (v) { say(v); nsend({ t: 'say', txt: v }); } e.target.value = ''; }
  if (e.key === 'Enter' || e.key === 'Escape') { e.target.style.display = 'none'; e.target.blur(); renderer.domElement.requestPointerLock(); }
});

// ============================================================ INPUT
addEventListener('keydown', e => {
  if (document.activeElement === $('chat')) return;
  keys[e.code] = true;
  if (phase !== 'menu' && squadKey(e.code)) return;
  if (e.code === 'KeyE' && dialogQ) nextDialog();
  if (e.code === 'KeyR') reload();
  if (e.code === 'Digit1') $('phone').classList.toggle('up');
  const nk = { KeyG: 'frag', KeyF: 'flash', KeyT: 'smoke' }[e.code];
  if (nk && phase === 'assault' && me.inv[nk] > 0 && !me.down) {
    me.inv[nk]--; const dir = new THREE.Vector3(0, 0.25, -1).applyQuaternion(camera.quaternion).normalize();
    throwNade(camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.6), dir.multiplyScalar(nk === 'smoke' ? 12 : 16), true, nk);
  }
  if (e.code === 'Tab') e.preventDefault();
});
addEventListener('keyup', e => keys[e.code] = false);
renderer.domElement.addEventListener('mousedown', e => {
  if (dialogQ) { nextDialog(); return; }
  if (!locked && phase !== 'menu' && phase !== 'loadout' && phase !== 'brief' && phase !== 'end') { renderer.domElement.requestPointerLock(); return; }
  if (e.button === 0) { mouseDown = true; fire(); } if (e.button === 2) me.aim = true;
});
$('dialog').addEventListener('mousedown', () => nextDialog());
addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; if (e.button === 2) me.aim = false; });
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => locked = document.pointerLockElement === renderer.domElement);
addEventListener('mousemove', e => {
  if (!locked) return; const s = me.aim && me.weapon === 'sn' ? 0.0005 : 0.0021;
  me.yaw -= e.movementX * s; me.pitch = clamp(me.pitch - e.movementY * s, -1.45, 1.45);
});
// ============================================================ GRAPHICS QUALITY (runs on any PC)
const PRESETS = {
  low:    { pr: 0.7,  shadows: false, shadowMap: 512,  bloom: false, lights: false, ao: false, msaa: 0 },
  medium: { pr: 1.0,  shadows: true,  shadowMap: 1024, bloom: true,  lights: true,  ao: false, msaa: 2 },
  high:   { pr: 1.25, shadows: true,  shadowMap: 2048, bloom: true,  lights: true,  ao: true,  msaa: 4 },
  ultra:  { pr: 1.75, shadows: true,  shadowMap: 4096, bloom: true,  lights: true,  ao: true,  msaa: 4 },
};
let quality = 'high', Q = PRESETS.high;
function detectQuality() {
  const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 4;
  let gpu = '';
  try { const gl = renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''; } catch { }
  if (/RTX|RX 6|RX 7|Apple M[2-9]/i.test(gpu)) return 'ultra';
  if (mobile || /Intel|Mali|Adreno|SwiftShader|llvmpipe/i.test(gpu) || cores <= 4 || mem <= 4) return 'low';
  if (/GTX|Radeon|Apple M1/i.test(gpu)) return 'high';
  return 'medium';
}
function applyQuality(q) {
  quality = q; Q = PRESETS[q];
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pr)); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = Q.shadows;
  sunLight.shadow.mapSize.set(Q.shadowMap, Q.shadowMap); if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
  pedLimit = { low: 30, medium: 55, high: 80, ultra: 90 }[q];
  bloom.enabled = Q.bloom; ssao.enabled = Q.ao; composer.renderTarget1.samples = composer.renderTarget2.samples = Q.msaa;
  scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
}
// Auto-lower quality if the game runs slowly (like GTA's dynamic settings)
let fpsFrames = 0, fpsTime = 0, slowSecs = 0;
function watchFps(dt) {
  fpsFrames++; fpsTime += dt; if (fpsTime < 1) return;
  const fps = fpsFrames / fpsTime; fpsFrames = 0; fpsTime = 0;
  slowSecs = fps < 28 ? slowSecs + 1 : 0;
  if (slowSecs >= 4 && quality !== 'low' && phase !== 'menu') { const order = ['low', 'medium', 'high', 'ultra']; applyQuality(order[order.indexOf(quality) - 1]); toast(`Graphics lowered to ${quality.toUpperCase()} for smoother play`, '#aaf'); slowSecs = 0; }
}

async function begin(online) {
  const qs = $('quality').value; applyQuality(qs === 'auto' ? detectQuality() : qs);
  audio();
  me.name = ($('name').value || 'Commando').trim();
  $('menu').classList.remove('show');
  if (online) { const ok = await connect($('room').value || 'TAJ', me.name); if (!ok) toast('Could not reach the squad server — playing solo', '#fa0'); }
  buildViewGun('m4'); viewGun.visible = false;
  meModel = makeHuman({ shirt: 0x2b3523, vest: 0x1c241a, head: 0x111111, gun: false, uniform: true }); setOutfit(meModel, me.outfit); scene.add(meModel);
  startStory(); renderer.domElement.requestPointerLock();
  if (location.hash === '#tajday') { me.pos.set(SPOTS.red.x + 30, 0, SPOTS.red.z + 32); me.yaw = 0.35; me.pitch = 0.3; }
  if (location.hash === '#far') { me.pos.copy(sidewalk('Marine Drive', 900, 1)); me.yaw = -Math.PI / 2; me.pitch = 0.05; marker.visible = false; }
  if (location.hash === '#regal') { const r = LANDMARKS[1].pos; me.pos.set(r.x - 10, 0, r.z - 60); me.yaw = Math.PI + 0.3; me.pitch = 0.12; marker.visible = false; }
  if (location.hash === '#colonel') { me.pos.set(SPOTS.handler.x + 3, 0, SPOTS.handler.z + 7); me.yaw = 0.3; me.pitch = -0.12; }
  if (location.hash === '#taj' || location.hash === '#assault') { // dev shortcuts
    setNight(); fireGroup.visible = true; tajFireLight.intensity = 400; redZoneProps.visible = true; marker.visible = false;
    me.pos.set(SPOTS.red.x + 10, 0, SPOTS.red.z + 40); me.yaw = 0.2; me.pitch = 0.25; phase = 'toRed'; redMarker.position.copy(SPOTS.red); redMarker.visible = true;
    if (location.hash === '#assault') { phase = 'loadout'; $('deploy').onclick(); }
  }
}
$('play').onclick = () => begin(true);
$('solo').onclick = () => begin(false);

// ============================================================ MINIMAP
const mm = $('minimap').getContext('2d');
function drawMinimap() {
  const S = 170, sc = inside ? 2.2 : 0.9; mm.clearRect(0, 0, S, S);
  mm.save(); mm.beginPath(); mm.arc(S / 2, S / 2, S / 2 - 2, 0, 7); mm.clip();
  mm.translate(S / 2, S / 2); mm.rotate(me.yaw);
  const P = (x, z) => [(x - me.pos.x) * sc, (z - me.pos.z) * sc];
  if (!inside) {
    mm.fillStyle = '#e8e2d244'; mm.beginPath(); coastPts.forEach(([x, z], i) => { const [a, b] = P(x, z); i ? mm.lineTo(a, b) : mm.moveTo(a, b); }); mm.closePath(); mm.fill();
    mm.strokeStyle = '#c9ccd6'; mm.lineCap = 'round';
    for (const r of roads) { mm.lineWidth = Math.max(2, r.w * sc * 0.9); mm.beginPath(); r.P.forEach((q, i) => { const [a, b] = P(q.x, q.z); i ? mm.lineTo(a, b) : mm.moveTo(a, b); }); mm.stroke(); }
  }
  mm.fillStyle = '#ffffff22';
  for (const c of colliders) { if (!inside && c.obb) continue; if (inside && (c.maxY < me.pos.y + 0.6 || c.minY > me.pos.y + 1.5 || c.maxY - c.minY < 0.5)) continue; const [x1, z1] = P(c.minX, c.minZ); const [x2, z2] = P(c.maxX, c.maxZ); if (Math.abs(x1) < 200 && Math.abs(z1) < 200) mm.fillRect(x1, z1, x2 - x1, z2 - z1); }
  const dot = (x, z, col, r = 4) => { const [a, b] = P(x, z); mm.fillStyle = col; mm.beginPath(); mm.arc(a, b, r, 0, 7); mm.fill(); };
  if (marker.visible) dot(marker.position.x, marker.position.z, '#ffd21f', 6);
  if (redMarker.visible) dot(redMarker.position.x, redMarker.position.z, '#ff2020', 8);
  if (!inside) for (const l of LANDMARKS) { const [a, b] = P(l.pos.x, l.pos.z); if (Math.abs(a) < 85 && Math.abs(b) < 85) { dot(l.pos.x, l.pos.z, '#c07cff', 4); mm.save(); mm.translate(a, b); mm.rotate(-me.yaw); mm.fillStyle = '#e0c0ff'; mm.font = '10px Inter'; mm.fillText(l.name, 6, 3); mm.restore(); } }
  if (exfilMarker) dot(exfilMarker.position.x, exfilMarker.position.z, '#3f6', 6);
  for (const pg of pings) dot(pg.p.x, pg.p.z, '#ffd21f', 5);
  for (const p of net.peers.values()) if (p.model.visible) dot(p.pos.x, p.pos.z, p.down ? '#f80' : '#4af');
  if (inside) for (const e of enemies) if (e.alive && e.seen > 0) dot(e.model.position.x, e.model.position.z, '#f33', 3);
  mm.restore();
  mm.fillStyle = '#fff'; mm.beginPath(); mm.moveTo(S / 2, S / 2 - 7); mm.lineTo(S / 2 - 5, S / 2 + 5); mm.lineTo(S / 2 + 5, S / 2 + 5); mm.fill();
}

// ============================================================ MAIN LOOP
const clock = new THREE.Clock();
let netT = 0, bob = 0;
let meModel = null;
const lastLand = new THREE.Vector3();
// ============================================================ DEMO DIRECTOR (#demo) — scripted tour for a video
const DEMO = location.hash === '#demo';
let demoT = 0, demoStage = -1;
function demoDirector(t) {
  me.hp = 100; me.down = false; // the camera operator can't die
  const stage = t < 7 ? 0 : t < 12 ? 1 : t < 15 ? 2 : t < 22 ? 3 : t < 28 ? 4 : t < 31 ? 5 : 6;
  const enter = stage !== demoStage; demoStage = stage;
  keys.KeyW = false;
  if (stage === 0) { // evening street, third person
    if (enter) { phase = 'demo'; marker.visible = false; me.pos.set(-60, 0, 128); toast('Colaba, Mumbai — 26 November 2008, evening', '#ffd21f'); objective('Meet Colonel Rathore at the yellow marker'); }
    me.yaw = -Math.PI / 2 + Math.sin(t * 0.4) * 0.25; me.pitch = -0.05; keys.KeyW = true;
  }
  if (stage === 1) { // the Colonel briefs the squad
    if (enter) { me.pos.set(SPOTS.handler.x + 1.5, 0, SPOTS.handler.z + 4.5); colonel.lookAt(me.pos.x, 0, me.pos.z); showDialog('Col. Rathore', ['Your training is complete. You move to the next camp in a few days. Until then — the safehouse. Here are your keys and secure phones. If this phone rings, you drop everything.'], null); }
    me.yaw = 0.25; me.pitch = -0.1;
  }
  if (stage === 2) { // time skip
    if (enter) { $('dialog').style.display = 'none'; dialogQ = null; $('cine').classList.add('show'); $('cinetext').textContent = 'Later that night… 21:48'; $('cinetext').classList.add('on'); setNight(); }
  }
  if (stage === 3) { // alert, gear-up, run to the red zone
    if (enter) {
      $('cine').classList.remove('show'); fireGroup.visible = true; tajFireLight.intensity = 400; redZoneProps.visible = true; peds.forEach(p => p.userData.panic = true);
      me.pos.set(SPOTS.red.x + 6, 0, SPOTS.red.z + 60); redMarker.position.copy(SPOTS.red); redMarker.visible = true;
      phoneUp('⚠ FLASH — CODE RED\nGunmen inside the Taj Mahal Palace hotel.\n\nCol. Rathore: "Suit up — full black kit. Get to the red zone. Move!"', 0); sfx('phone');
      me.outfit = 'tactical'; if (meModel) setOutfit(meModel, 'tactical'); objective('EMERGENCY: Get to the red zone at the Taj Hotel');
    }
    if (t > 18) $('phone').classList.remove('up');
    me.yaw = 0.05; me.pitch = 0.18; keys.KeyW = true;
  }
  if (stage === 4) { // briefing narration
    if (enter) { redMarker.visible = false; $('cine').classList.add('show'); }
    $('cinetext').innerText = t < 25 ? NARRATION[2] : NARRATION[6]; $('cinetext').classList.add('on');
  }
  if (stage === 5) { if (enter) { $('cine').classList.remove('show'); openLoadout(); } }
  if (stage === 6) { // inside the Taj
    if (enter) { $('loadout').classList.remove('show'); me.weapon = 'm4'; me.ammo = 30; me.reserve = 210; me.inv = { frag: 3, flash: 2, smoke: 2 }; buildViewGun('m4'); enterInterior(); me.pos.set(IN.x - 4, 0, IN.z - 22); }
    const k = t - 31;
    if (k < 5) { me.yaw = Math.PI + Math.sin(k * 0.5) * 0.15; me.pitch = 0; keys.KeyW = true; }
    else if (k < 8.5) { me.yaw = Math.PI + (k - 5) * 0.5; me.pitch = Math.min(0.75, (k - 5) * 0.35); }
    else { me.pitch = 0.05; me.yaw = Math.PI * 1.5 + 0.3 + Math.sin(k) * 0.1; mouseDown = k > 9 && k < 11.5; if (k > 11.6 && k < 11.7 && me.inv.frag > 0) { me.inv.frag--; const d = new THREE.Vector3(0, 0.25, -1).applyQuaternion(camera.quaternion).normalize(); throwNade(camera.getWorldPosition(new THREE.Vector3()).addScaledVector(d, 0.6), d.multiplyScalar(14)); } }
  }
}
window.__demoFrame = () => { demoT += 1 / 12; loop(); return demoT; };
window.__demoStart = () => { $('quality').value = 'medium'; begin(false); };

function loop() {
  if (!DEMO) requestAnimationFrame(loop);
  const dt = DEMO ? 1 / 12 : Math.min(clock.getDelta(), 0.05), t = DEMO ? demoT : clock.elapsedTime;
  if (DEMO && phase !== 'menu') demoDirector(demoT);

  // --- player movement
  if (phase !== 'menu' && phase !== 'brief' && phase !== 'loadout' && phase !== 'end' && !dialogQ && !me.down) {
    const sprint = keys.ShiftLeft && !me.aim, speed = sprint ? 9 : me.aim ? 3 : 5.2;
    const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const dir = new THREE.Vector3(s, 0, -f); if (dir.lengthSq()) dir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), me.yaw);
    me.vel.x += (dir.x * speed - me.vel.x) * Math.min(1, dt * 12); me.vel.z += (dir.z * speed - me.vel.z) * Math.min(1, dt * 12);
    if (keys.Space && me.onGround) { me.vel.y = 5; me.onGround = false; }
  } else { me.vel.x *= 0.8; me.vel.z *= 0.8; }
  me.vel.y -= 14 * dt;
  if (me.vel.y > 0) for (const c of colliders) if (me.pos.x > c.minX && me.pos.x < c.maxX && me.pos.z > c.minZ && me.pos.z < c.maxZ && me.pos.y + 1.85 > c.minY && me.pos.y + 1.0 < c.minY) { me.vel.y = 0; break; }
  me.pos.x += me.vel.x * dt; me.pos.z += me.vel.z * dt; me.pos.y += me.vel.y * dt;
  collide(me.pos, 0.4);
  const gy = groundAt(me.pos.x, me.pos.z, me.pos.y);
  if (me.pos.y <= gy || (me.onGround && me.vel.y <= 0 && me.pos.y - gy < STEP)) { if (me.vel.y < -14 && phase === 'assault') hurt((-me.vel.y - 14) * 6); me.pos.y = gy; me.vel.y = 0; me.onGround = true; } else me.onGround = false;
  if (!inside && !onLand(me.pos.x, me.pos.z)) { me.pos.x = lastLand.x; me.pos.z = lastLand.z; } else if (!inside) lastLand.copy(me.pos);
  updateStreaming();

  // --- camera
  const moving = Math.hypot(me.vel.x, me.vel.z);
  bob += moving * dt * 1.6;
  const eyeH = me.down ? 0.4 : 1.7;
  camera.position.set(me.pos.x, me.pos.y + eyeH + Math.sin(bob * 2) * 0.04 * (moving > 1 ? 1 : 0), me.pos.z);
  recoil *= Math.pow(0.002, dt);
  if (shake > 0) { camera.position.x += rand(-1, 1) * shake * 0.15; camera.position.y += rand(-1, 1) * shake * 0.15; shake = Math.max(0, shake - dt * 1.5); }
  camera.rotation.set(me.pitch + recoil, me.yaw, 0, 'YXZ');
  // GTA-style third-person camera in the city (first person inside the Taj for tactical play)
  const tp = !inside && phase !== 'menu';
  if (meModel) { meModel.visible = tp; meModel.position.copy(me.pos); if (moving > 0.3) meModel.rotation.y = Math.atan2(me.vel.x, me.vel.z); }
  if (tp) {
    const back = new THREE.Vector3(0.7, 0, 3.6).applyEuler(new THREE.Euler(me.pitch * 0.6, me.yaw, 0, 'YXZ'));
    const head = me.pos.clone().addY(1.75), want = head.clone().add(back).addY(0.35);
    ray.set(head, want.clone().sub(head).normalize()); ray.far = head.distanceTo(want);
    const hit = ray.intersectObjects(solids, false)[0];
    camera.position.copy(hit ? head.clone().lerp(want, Math.max(0.1, hit.distance / ray.far - 0.08)) : want);
  }
  const scoped = me.aim && WEAPONS[me.weapon]?.scope && phase === 'assault';
  const fov = scoped ? 14 : me.aim && phase === 'assault' ? 55 : 72;
  if (Math.abs(camera.fov - fov) > 0.1) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 14); camera.updateProjectionMatrix(); }
  $('scope').style.display = scoped ? 'block' : 'none'; $('cross').style.display = scoped ? 'none' : 'block';
  viewGun.visible = phase === 'assault' && !scoped && !me.down;
  viewGun.position.x += ((me.aim ? 0 : 0.22) - viewGun.position.x) * Math.min(1, dt * 15);
  viewGun.position.y = (me.aim ? -0.16 : -0.2) + Math.sin(bob * 2) * 0.008 - (me.reloading > 0 ? 0.15 : 0);
  viewGun.position.z = -0.45 + recoil * 1.5;
  muzzle.material.opacity *= 0.5; flashLight.intensity *= 0.6;

  // --- weapons
  if (phase === 'assault') {
    if (mouseDown && WEAPONS[me.weapon].auto) fire();
    if (me.reloading > 0) { me.reloading -= dt; if (me.reloading <= 0) { const w = WEAPONS[me.weapon]; const need = w.mag - me.ammo, take = Math.min(need, me.reserve); me.ammo += take; me.reserve -= take; } }
  }
  for (let i = nades.length - 1; i >= 0; i--) {
    const n = nades[i]; n.v.y -= 14 * dt; const prev = n.m.position.clone(); n.m.position.addScaledVector(n.v, dt);
    const ng = groundAt(n.m.position.x, n.m.position.z, n.m.position.y) + 0.09;
    if (n.m.position.y < ng) { n.m.position.y = ng; n.v.y *= -0.35; n.v.x *= 0.6; n.v.z *= 0.6; }
    const p = n.m.position.clone(); collide(p, 0.1); if (p.x !== n.m.position.x || p.z !== n.m.position.z) { n.v.x *= -0.4; n.v.z *= -0.4; n.m.position.copy(prev); }
    if (n.kind === 'efrag' && Math.floor(n.t * 6) % 2 === 0) sfx('beep', n.m.position, 0.6);
    n.t -= dt; if (n.t <= 0) { const bp = n.m.position.clone(); scene.remove(n.m); nades.splice(i, 1); detonate(n.kind, bp); }
  }
  for (let i = smokes.length - 1; i >= 0; i--) { const s = smokes[i]; s.t -= dt; const k = s.t > 14 ? (16 - s.t) / 2 : s.t < 3 ? s.t / 3 : 1; s.g.children.forEach((sp, j) => { sp.material.opacity = sp.userData.o * k; sp.position.y += Math.sin(t + j) * 0.002; sp.material.rotation += dt * 0.05; }); if (s.t <= 0) { scene.remove(s.g); smokes.splice(i, 1); } }

  // --- world animation
  for (const c of movingCars) { // vehicles follow the real roads; far ones respawn near the player
    c.s += c.dir * c.speed * dt;
    if (c.s < 0 || c.s > c.r.len || c.g.position.distanceToSquared(me.pos) > 320 * 320) { const n = nearRoadSpot(); c.r = n.r; c.s = n.s; c.dir = Math.random() < 0.5 ? 1 : -1; }
    placeVehicle(c);
  }
  if (!inside) for (let i = 0; i < peds.length; i++) {
    const p = peds[i], u = p.userData;
    if (p.position.distanceToSquared(me.pos) > 170 * 170) { const n = nearRoadSpot(150, 30); u.road = n.r; u.s = n.s; placePed(p); } // respawn on a nearby pavement
    const far = p.position.distanceToSquared(me.pos) > 160 * 160;
    p.visible = i < pedLimit && !far; if (!p.visible) continue;
    // panic: run away from the Taj; calm: stroll, and stop/look when the player bumps into them
    let sp = u.panic ? u.speed * 3.6 : u.speed;
    const dp = p.position.distanceTo(me.pos);
    if (!u.panic && dp < 1.6) u.stopT = 1.5;
    if (u.stopT > 0) { u.stopT -= dt; sp = 0; p.lookAt(me.pos.x, 0, me.pos.z); }
    else {
      if (u.panic) { const q = roadPoint(u.road, u.s); u.dir = (q.x - TAJ.x) * q.tx + (q.z - TAJ.z) * q.tz > 0 ? 1 : -1; } // flee away from the Taj
      u.s += u.dir * sp * dt; if (u.s < 1 || u.s > u.road.len - 1) u.dir *= -1;
      placePed(p);
    }
    const sw = Math.sin(t * sp * 3.2 + u.phase) * (sp > 0 ? 0.55 : 0);
    u.legL.rotation.x = sw; u.legR.rotation.x = -sw;
    u.armL.rotation.x = u.panic ? -2.6 : -sw * 0.6; u.armR.rotation.x = u.panic ? -2.6 : sw * 0.6; // hands up while fleeing
  }
  if (redZoneProps.visible) { ambLights.forEach(b => b.material.emissiveIntensity = Math.sin(t * 12) > 0 ? 6 : 0.2); for (const o of police) if (o.userData.watch) o.position.y = Math.abs(Math.sin(t * 2 + o.id)) * 0.04; }
  boats.forEach((b, i) => { b.position.y = Math.sin(t + i) * 0.15; b.rotation.z = Math.sin(t * 0.8 + i) * 0.04; });
  marker.children[0].material.opacity = 0.18 + Math.sin(t * 3) * 0.06; marker.rotation.y += dt;
  if (redZoneProps.visible) { siren.intensity = Math.sin(t * 10) > 0 ? 60 : 0; siren2.intensity = Math.sin(t * 10) > 0 ? 0 : 60; tajFireLight.intensity = 180 + Math.random() * 80; }
  for (const s of smoke) {
    if (!s.parent.visible) continue; const u = s.userData; u.t += dt / u.life; if (u.t > 1) u.t = 0;
    s.position.set(u.o.x + Math.sin(u.t * 6 + u.o.z) * (u.fire ? 0.6 : 3) * u.t, u.o.y + u.t * (u.fire ? 3 : 25), u.o.z + Math.cos(u.t * 5) * (u.fire ? 0.6 : 2) * u.t);
    const sc = u.fire ? (1.6 - u.t) * 1.6 : 3 + u.t * 14; s.scale.setScalar(sc); s.material.opacity = u.fire ? (1 - u.t) * 0.9 : Math.sin(u.t * Math.PI) * 0.55;
  }
  for (const l of fires) l.intensity = 14 + Math.random() * 10;
  if (inside) interiorLights.forEach((l, i) => { if (!fires.includes(l) && Math.random() < 0.01) l.intensity = l.userData.base * rand(0.2, 1); else if (!fires.includes(l)) l.intensity += (l.userData.base - l.intensity) * dt * 3; });
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.life -= dt; const k = Math.max(0, f.life / f.max);
    if (f.v) { f.o.position.addScaledVector(f.v, dt); if (!f.smoke) f.v.y -= 9 * dt; }
    if (f.grow) f.o.scale.setScalar(1 + (1 - k) * f.grow);
    if (f.light) f.o.intensity = f.light * k;
    else if (f.o.material) { f.o.material.opacity = f.smoke ? k * 0.7 : k; f.o.material.transparent = true; if (f.smoke) f.o.scale.setScalar(2 + (1 - k) * 6); }
    if (f.life <= 0) { scene.remove(f.o); f.o.geometry?.dispose(); fx.splice(i, 1); }
  }

  // --- story / mission
  if (['toHandler', 'toHome', 'toRed'].includes(phase)) storyUpdate(dt);
  if (phase === 'assault') {
    if (net.host) { updateEnemiesHost(dt); snapT -= dt; if (snapT <= 0) { snapT = 0.1; nsend({ t: 'e', l: enemies.map(e => [e.id, +e.model.position.x.toFixed(2), +e.model.position.z.toFixed(2), +e.model.position.y.toFixed(2), +e.model.rotation.y.toFixed(2), e.alive, +e.armed.toFixed(2), Math.round(e.hp)]) }); } }
    updateEnemiesVisual(dt); assaultUpdate(dt);
  }
  // --- shadows follow the player in the city
  if (!inside) { sunLight.position.copy(me.pos).addScaledVector(sun, 200); sunLight.target.position.copy(me.pos); }

  // --- network
  netT -= dt;
  if (net.online && netT <= 0) { netT = 1 / 15; nsend({ t: 's', o: me.outfit, p: me.pos.toArray().map(v => +v.toFixed(2)), ry: +me.yaw.toFixed(2), hp: Math.round(me.hp), down: me.down, dead: me.dead, ph: phase, z: me.inZone, in: inside }); }
  for (const p of net.peers.values()) {
    p.pos.lerp(p.target, Math.min(1, dt * 10));
    p.model.position.copy(p.pos); p.model.rotation.y = p.yaw + Math.PI;
    p.model.visible = !!p.inside === inside && !p.dead; setOutfit(p.model, p.inside ? 'tactical' : (p.outfit || 'casual'));
    p.model.rotation.x = p.down ? -Math.PI / 2.3 : 0; p.model.position.y = p.pos.y + (p.down ? 0.3 : 0);
  }

  // --- HUD
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('msg').textContent = ''; }
  $('hp').style.width = me.hp + '%';
  $('hpbar').style.display = $('stats').style.display = phase === 'assault' ? 'block' : 'none';
  if (phase === 'assault') $('stats').innerHTML = `${WEAPONS[me.weapon].name}<br><span style="font-size:40px">${me.reloading > 0 ? 'RELOADING' : me.ammo}</span> / ${me.reserve}<br><span style="font-size:18px">G Frag ${me.inv.frag} · F Flash ${me.inv.flash} · T Smoke ${me.inv.smoke}</span>`;
  const team = [...net.peers.values()];
  $('team').style.display = team.length || keys.Tab ? 'block' : 'none';
  $('team').innerHTML = `<b>SQUAD ${net.online ? '(online)' : ''}</b><br>${me.name} (you) — ${me.down ? 'DOWN' : Math.round(me.hp) + ' HP'}` + team.map(p => `<br>${p.name} — ${p.dead ? 'KIA' : p.down ? 'DOWN' : p.hp + ' HP'}${p.inside ? ' · ' + FLOOR_NAMES[floorOf(p.pos.y)] : ''}`).join('');
  const d = new Date(2008, 10, 26, night ? 21 : 18, night ? 48 : 30); $('pclock').textContent = $('ptime').textContent = d.toTimeString().slice(0, 5);
  if (phase !== 'menu') drawMinimap();

  if (phase === 'menu') { camera.position.set(80 + Math.sin(t * 0.05) * 60, 30, 40); camera.lookAt(TAJ.x, 25, TAJ.z); }
  updateAnimations(dt);

  for (let i = pings.length - 1; i >= 0; i--) { const pg = pings[i]; pg.t -= dt; pg.s.material.opacity = Math.min(1, pg.t); if (pg.t <= 0) { scene.remove(pg.s); pings.splice(i, 1); } }
  for (let i = feedLines.length - 1; i >= 0; i--) { feedLines[i].t -= dt; if (feedLines[i].t <= 0) feedLines.splice(i, 1); }
  $('feed').innerHTML = feedLines.map(l => `<div style="opacity:${Math.min(1, l.t / 2)}">${l.html}</div>`).join('');
  $('floor').textContent = inside ? FLOOR_NAMES[floorOf(me.pos.y)] : '';
  watchFps(dt);
  grade.uniforms.time.value = t % 100;
  composer.render();
}
if (!DEMO) loop();
