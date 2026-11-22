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
  const [sol, civ] = await Promise.all([loader.loadAsync('assets/Soldier.glb'), loader.loadAsync('assets/Michelle.glb')]);
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
    if (o.isMesh) { o.material = o.material.clone(); if (tint) o.material.color.multiply(new THREE.Color(tint)); o.raycast = () => { }; }
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
  ground.material.roughnessMap = puddleTex; ground.material.roughness = 1; ground.material.metalness = 0.05; ground.material.color.set(0x5a5a5a); ground.material.envMapIntensity = 0.5; ground.material.needsUpdate = true;
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
const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ map: asphaltTex, bumpMap: asphaltTex, bumpScale: 1.5, roughness: 0.92 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// Arabian Sea / harbour to the north (negative Z)
const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 1400, 1, 1),
  new THREE.MeshPhysicalMaterial({ color: 0x0c2a3a, roughness: 0.06, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.4 }));
sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.15, -860); scene.add(sea);
const seaWall = addBox(800, 1.2, 3, M(0x9b927f), 0, 0, -161);
// Promenade (Apollo Bunder)
const promenade = new THREE.Mesh(new THREE.PlaneGeometry(400, 40), new THREE.MeshStandardMaterial({ map: pavTex, roughness: 0.8 }));
pavTex.repeat.set(100, 10); promenade.rotation.x = -Math.PI / 2; promenade.position.set(40, 0.02, -140); promenade.receiveShadow = true; scene.add(promenade);
// little boats bobbing
const boats = [];
for (let i = 0; i < 9; i++) { const b = new THREE.Group(); const hull = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 8), M(i % 2 ? 0xe8e2d4 : 0x2f6f8f)); hull.position.y = 0.5; b.add(hull); const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 3), M(0xdddddd)); cab.position.set(0, 1.4, -1); b.add(cab); b.position.set(rand(-150, 220), 0, rand(-200, 300 - 520)); b.rotation.y = rand(0, 6); b.traverse(o => o.castShadow = true); scene.add(b); boats.push(b); }

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
gateway(70, -150);

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
for (const z of ROADS_Z) for (let x = -230; x < 240; x += 7) if (!ROADS_X.some(rx => Math.abs(rx - x) < 8)) flatInst(dashes, x, z, 0);
for (const x of ROADS_X) for (let z = -40; z < 260; z += 7) if (!ROADS_Z.some(rz => Math.abs(rz - z) < 8)) flatInst(dashes, x, z, Math.PI / 2);
for (const z of ROADS_Z) for (const x of ROADS_X) for (let k = -5; k <= 5; k += 1.1) { flatInst(zebra, x + k, z - 8.5, 0); flatInst(zebra, x + k, z + 8.5, 0); flatInst(zebra, x - 8.5, z + k, Math.PI / 2); flatInst(zebra, x + 8.5, z + k, Math.PI / 2); }
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
for (const z of ROADS_Z) for (let x = -215; x < 230; x += 24) { lamp(x, z + 6.6); if (Math.random() < 0.6) tree(x + 12, z + (Math.random() < 0.5 ? 7 : -7)); }
for (const x of ROADS_X) for (let z = -30; z < 255; z += 26) { lamp(x - 6.6, z); if (Math.random() < 0.5) tree(x + 7, z + 13); }
// promenade lamps & trees along the sea face
for (let x = -150; x < 220; x += 18) { lamp(x, -132); if (x % 36 === 0) tree(x + 9, -128); }
// traffic signals at junctions
const signalHeads = [];
const sigBox = M(0x111111);
for (const z of ROADS_Z.slice(0, 4)) for (const x of ROADS_X.slice(2, 8)) {
  const sx = x + 6.8, sz = z + 6.8;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 5, 6), M(0x2a2a2a)); pole.position.set(sx, 2.5, sz); scene.add(pole);
  const head = new THREE.Group(); const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.3, 0.35), sigBox); head.add(box);
  const lamps = [0xff2020, 0xffb000, 0x20ff40].map((c, i) => { const m = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: 0 })); m.position.set(0, 0.4 - i * 0.4, 0.18); head.add(m); return m; });
  head.position.set(sx, 5.2, sz); scene.add(head); signalHeads.push({ lamps, off: Math.random() * 12 });
  for (let k = 0; k < 5; k++) { addInst(bollards, x + 6.8 - k * 1.2, 0.45, z + 7.2); addInst(bollards, x - 6.8 + k * 1.2, 0.45, z - 7.2); }
}
// overhead Metro viaduct with pillars on the central median (like Mumbai's elevated lines)
const METRO_Z = 85;
const concrete = new THREE.MeshStandardMaterial({ map: canvasTex(256, 256, (c, w, h) => { grain(c, w, h, '#9a968c', 0.08); for (let i = 0; i < 30; i++) { c.fillStyle = `rgba(60,50,40,${rand(0.05, 0.15)})`; c.fillRect(rand(0, w), rand(0, h), rand(4, 30), rand(30, 120)); } }), roughness: 0.9 });
const deck = new THREE.Mesh(new THREE.BoxGeometry(470, 1.6, 9), concrete); deck.position.set(0, 10, METRO_Z); deck.castShadow = deck.receiveShadow = true; scene.add(deck);
for (const sz of [-4.2, 4.2]) { const parapet = new THREE.Mesh(new THREE.BoxGeometry(470, 1, 0.3), concrete); parapet.position.set(0, 11.3, METRO_Z + sz); scene.add(parapet); }
const medianMat = new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (c, w, h) => grain(c, w, h, '#a8642e', 0.12)), roughness: 1 });
for (let x = -212; x <= 212; x += 25) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 9.2, 16), concrete); p.position.set(x, 4.6, METRO_Z); p.castShadow = true; scene.add(p);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 8), concrete); cap.position.set(x, 8.8, METRO_Z); scene.add(cap);
  colliders.push({ minX: x - 1.1, maxX: x + 1.1, minZ: METRO_Z - 1.1, maxZ: METRO_Z + 1.1, minY: 0, maxY: 9 }); solids.push(p);
}
for (let x = -220; x < 225; x += 50) { const md = new THREE.Mesh(new THREE.BoxGeometry(32, 0.3, 2.6), medianMat); md.position.set(x, 0.15, METRO_Z); scene.add(md); kerb(x, METRO_Z + 1.3, 32, true); kerb(x, METRO_Z - 1.3, 32, true); }
const train = new THREE.Group();
for (let k = 0; k < 4; k++) { const car = new THREE.Mesh(new THREE.BoxGeometry(19, 3.2, 3.2), new THREE.MeshStandardMaterial({ color: 0xe8e8ec, metalness: 0.4, roughness: 0.35 })); car.position.x = k * 19.6; train.add(car); const stripe = new THREE.Mesh(new THREE.BoxGeometry(19.05, 0.4, 3.25), M(0x1565c0)); stripe.position.set(k * 19.6, -0.6, 0); train.add(stripe); const win = new THREE.Mesh(new THREE.BoxGeometry(18, 0.9, 3.26), new THREE.MeshStandardMaterial({ color: 0x1a2230, emissive: 0xfff0c0, emissiveIntensity: 0.3 })); win.position.set(k * 19.6, 0.5, 0); train.add(win); windowMats.push(win.material); win.material.userData.nightGlow = 1; }
train.position.set(-240, 12.6, METRO_Z - 1.8); scene.add(train);
// Mumbai auto-rickshaws (black & yellow) and red BEST buses
function autoRickshaw(x, z, ry) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 2.4), new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.4, clearcoat: 0.6 })); body.position.y = 0.75; g.add(body);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.9, 1.9), new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5 })); hood.position.set(0, 1.7, -0.15); g.add(hood);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.5), new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.4 })); nose.position.set(0, 0.9, 1.35); g.add(nose);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), new THREE.MeshPhysicalMaterial({ color: 0x223040, roughness: 0.05, transparent: true, opacity: 0.6 })); glass.position.set(0, 1.65, 0.81); g.add(glass);
  for (const [wx, wz] of [[0, 1.3], [-0.6, -0.8], [0.6, -0.8]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.18, 12), M(0x111111)); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.26, wz); g.add(w); }
  const hl = new THREE.Mesh(new THREE.CircleGeometry(0.12, 10), new THREE.MeshStandardMaterial({ emissive: 0xfff2d0, emissiveIntensity: 3 })); hl.position.set(0, 1.15, 1.61); g.add(hl);
  g.traverse(o => o.castShadow = true); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g); return g;
}
function bestBus(x, z, ry) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.9, 11), new THREE.MeshPhysicalMaterial({ color: 0xb3121c, roughness: 0.4, clearcoat: 0.5 })); body.position.y = 1.85; g.add(body);
  const win = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.9, 10), new THREE.MeshStandardMaterial({ color: 0x1a2230, emissive: 0xffe8b0, emissiveIntensity: 0.25 })); win.position.y = 2.5; g.add(win); windowMats.push(win.material); win.material.userData.nightGlow = 0.8;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 10.8), M(0xe8e4dc)); roof.position.y = 3.35; g.add(roof);
  for (const [wx, wz] of [[-1.2, 3.6], [1.2, 3.6], [-1.2, -3.6], [1.2, -3.6]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 14), M(0x111111)); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.5, wz); g.add(w); }
  g.traverse(o => o.castShadow = true); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g); return g;
}

const roadMat = new THREE.MeshStandardMaterial({ map: pavTex, roughness: 0.85 });
for (let bx = -200; bx <= 200; bx += 50) {
  for (let bz = -40; bz <= 260; bz += 50) {
    if (bz < -10 && Math.abs(bx - TAJ.x) < 130) continue;
    const near = (p) => Math.abs(p.x - bx) < 30 && Math.abs(p.z - bz) < 30;
    if (near(SPOTS.handler) || near(SPOTS.spawn) || near(SPOTS.red)) continue;
    // sidewalk slab
    const sw = new THREE.Mesh(new THREE.BoxGeometry(38, 0.25, 38), roadMat); sw.position.set(bx, 0.125, bz); sw.receiveShadow = true; scene.add(sw);
    kerb(bx, bz + 19, 38, true); kerb(bx, bz - 19, 38, true); kerb(bx + 19, bz, 38, false); kerb(bx - 19, bz, 38, false);
    const isHome = near(SPOTS.home);
    const parts = isHome ? 1 : (Math.random() < 0.5 ? 1 : 2);
    for (let p = 0; p < parts; p++) {
      const w = parts === 1 ? 32 : 15, h = isHome ? 14 : rand(12, 46), d = 32;
      const ox = parts === 1 ? 0 : (p ? 8.5 : -8.5);
      const mat = Math.random() < 0.6 ? pastelMats[(Math.abs(bx * 7 + bz * 3 + p)) % pastelMats.length] : blockMats[(Math.abs(bx * 7 + bz * 3 + p)) % blockMats.length];
      addBox(w, h, d, mat, bx + ox, 0, bz);
      dressBuilding(bx + ox, bz, w, h, d);
      shopFront(bx + ox, bz + d / 2, w, 1); shopFront(bx + ox, bz - d / 2, w, -1);
      if (parts === 1 || p === 1) shopFront(bx + ox + w / 2, bz, d, 1, false);
      if (parts === 1 || p === 0) shopFront(bx + ox - w / 2, bz, d, -1, false);
      // rooftop water tanks — very Mumbai
      if (Math.random() < 0.7) { const t = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2, 12), M(0x222222)); t.position.set(bx + ox + rand(-5, 5), h + 1, bz + rand(-5, 5)); scene.add(t); }
      // shop awnings
      const aw = new THREE.Mesh(new THREE.BoxGeometry(w - 2, 0.2, 2.4), M([0x2a6f4a, 0x9a2a2a, 0x2a4a8a, 0xb08a2a][(bx + bz + p) & 3 >>> 0] || 0x9a2a2a)); aw.position.set(bx + ox, 3.6, bz + d / 2 + 1.2); aw.rotation.x = 0.25; aw.castShadow = true; scene.add(aw);
    }
  }
}
// Kaali-peeli taxis & cars
function car(x, z, ry, taxi) {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: taxi ? 0x111111 : [0xaa2222, 0xdddddd, 0x224488][Math.floor(rand(0, 3))], metalness: 0.6, roughness: 0.35, clearcoat: 1 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 4.2), paint); body.position.y = 0.7; g.add(body);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2.2), taxi ? M(0xf2c400, { roughness: 0.4 }) : paint); top.position.set(0, 1.4, -0.2); g.add(top);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.4, 2.0), new THREE.MeshPhysicalMaterial({ color: 0x111820, roughness: 0.05, metalness: 0.3 })); glass.position.set(0, 1.4, -0.2); g.add(glass);
  for (const [wx, wz] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 14), M(0x111111)); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.34, wz); g.add(w); }
  const hl = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.15, 0.05), new THREE.MeshStandardMaterial({ emissive: 0xfff2d0, emissiveIntensity: 3 })); hl.position.set(0, 0.8, 2.11); g.add(hl);
  const tl = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.15, 0.05), new THREE.MeshStandardMaterial({ emissive: 0xff1010, emissiveIntensity: 2 })); tl.position.set(0, 0.8, -2.11); g.add(tl);
  g.traverse(o => { o.castShadow = true; }); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
  colliders.push({ minX: x - 2.2, maxX: x + 2.2, minZ: z - 2.2, maxZ: z + 2.2, minY: 0, maxY: 1.8 }); solids.push(body);
  return g;
}
const movingCars = [];
for (let i = 0; i < 40; i++) {
  const road = ROADS_Z[i % 4], dir = i % 2 ? 1 : -1, lane = road + dir * (road === METRO_Z ? 3.6 : 2.6);
  const kind = i % 5 === 0 ? 'bus' : i % 3 === 0 ? 'auto' : 'car';
  const ry = dir > 0 ? Math.PI / 2 : -Math.PI / 2, x = rand(-220, 220);
  const g = kind === 'bus' ? bestBus(x, lane, ry) : kind === 'auto' ? autoRickshaw(x, lane, ry) : car(x, lane, ry, Math.random() < 0.5);
  if (kind === 'car') { colliders.pop(); solids.pop(); }
  movingCars.push({ g, dir, speed: kind === 'bus' ? rand(5, 7) : kind === 'auto' ? rand(6, 9) : rand(7, 12) });
}
// parked autos & cars at the kerb
for (let i = 0; i < 24; i++) { const road = ROADS_Z[i % ROADS_Z.length], side = i % 2 ? 1 : -1, x = rand(-210, 210); if (ROADS_X.some(rx => Math.abs(rx - x) < 10)) continue; if (i % 3) autoRickshaw(x, road + side * 5.2, Math.PI / 2); else car(x, road + side * 5, Math.PI / 2, true); }
car(SPOTS.handler.x + 5, SPOTS.handler.z, 0.3, false); // Colonel's jeep
// Police barricade + vehicles at the red zone (shown after alert)
const redZoneProps = new THREE.Group(); redZoneProps.visible = false; scene.add(redZoneProps);
for (let i = 0; i < 6; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 0.3), M(i % 2 ? 0xdddddd : 0xcc2222)); bar.position.set(TAJ.x - 15 + i * 6, 0.5, TAJ.z + 36); redZoneProps.add(bar); }
const siren = new THREE.PointLight(0x2050ff, 0, 40); siren.position.set(TAJ.x + 12, 3, TAJ.z + 38); scene.add(siren);
const siren2 = new THREE.PointLight(0xff2030, 0, 40); siren2.position.set(TAJ.x - 12, 3, TAJ.z + 38); scene.add(siren2);

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
  if (!noModel) dressModel(g, { civilian: !gun && !uniform, tint: modelTint, gun });
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
const CLOTH = [0xd8d0c0, 0x9a3b3b, 0x3b5a9a, 0xe0a040, 0x7a4a8a, 0xe86a9a, 0x2a8a6a, 0xf0f0f0, 0xc87a2a, 0x5a5a5a, 0xd04020, 0x30a0c0];
const SKIN = [0x8d5a3b, 0x7a4a2e, 0xa06a48, 0x6a3e26, 0xb07a55];
const PED_MAX = 90;
for (let i = 0; i < PED_MAX; i++) {
  const saree = Math.random() < 0.3, c = CLOTH[Math.floor(rand(0, CLOTH.length))];
  const p = makeHuman({ shirt: c, pants: saree ? c : [0x2a2a3a, 0x4a3a2a, 0xd8d0c0, 0x222222][i % 4], vest: saree ? CLOTH[(i * 5) % CLOTH.length] : c, skin: SKIN[i % SKIN.length], head: 0x111111, gun: false, modelTint: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.55).getHex() });
  p.scale.setScalar(rand(0.88, 1.06));
  if (Math.random() < 0.3) { const bag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 0.15), M([0x3a2a1a, 0x7a1a1a, 0x1a1a5a][i % 3])); bag.position.set(0.3, 0.95, 0); p.add(bag); }
  const alongX = Math.random() < 0.7;
  if (alongX) p.position.set(rand(-190, 190), 0.25, i % 9 === 0 ? -130 + rand(-3, 3) : ROADS_Z[i % ROADS_Z.length] + (i % 2 ? 7 : -7) + rand(-0.6, 0.6));
  else p.position.set(ROADS_X[1 + (i % 8)] + (i % 2 ? 7 : -7) + rand(-0.6, 0.6), 0.25, rand(-30, 250));
  Object.assign(p.userData, { alongX, dir: Math.random() < 0.5 ? 1 : -1, speed: rand(1.1, 1.8), phase: rand(0, 6), stopT: 0 });
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
  name: 'Commando', inZone: false, aim: false,
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
  const model = makeHuman({ shirt: 0x2b3523, vest: 0x1c241a, head: 0x111111, tag: name, modelTint: 0x9aa890 });
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
    case 's': if (p) { p.target.fromArray(m.p); p.yaw = m.ry; p.hp = m.hp; p.down = m.down; p.dead = m.dead; p.phase = m.ph; p.inZone = m.z; p.inside = m.in; p.t = performance.now(); } break;
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
        phoneUp('⚠ FLASH — CODE RED\nMultiple terror attacks across South Mumbai. Gunmen inside the Taj Mahal Palace hotel. Guests trapped. Fire in the heritage wing.\n\nReport to the RED ZONE outside the Taj immediately.', 9000);
        fireGroup.visible = true; tajFireLight.intensity = 400; redZoneProps.visible = true;
        phase = 'toRed'; redMarker.position.copy(SPOTS.red); redMarker.visible = true;
        objective('EMERGENCY: Get to the red zone at the Taj Hotel');
        peds.forEach(p => p.userData.panic = true);
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
  meModel = makeHuman({ shirt: 0x2b3523, vest: 0x1c241a, head: 0x111111, gun: false, uniform: true, modelTint: 0x9aa890 }); scene.add(meModel);
  startStory(); renderer.domElement.requestPointerLock();
  if (location.hash === '#tajday') { me.pos.set(SPOTS.red.x + 30, 0, SPOTS.red.z + 32); me.yaw = 0.35; me.pitch = 0.3; }
  if (location.hash === '#colonel') { me.pos.set(SPOTS.handler.x, 0, SPOTS.handler.z + 7); me.yaw = 0; me.pitch = -0.05; }
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
  mm.fillStyle = '#ffffff22';
  for (const c of colliders) { if (inside && (c.maxY < me.pos.y + 0.6 || c.minY > me.pos.y + 1.5 || c.maxY - c.minY < 0.5)) continue; const [x1, z1] = P(c.minX, c.minZ); const [x2, z2] = P(c.maxX, c.maxZ); if (Math.abs(x1) < 200 && Math.abs(z1) < 200) mm.fillRect(x1, z1, x2 - x1, z2 - z1); }
  const dot = (x, z, col, r = 4) => { const [a, b] = P(x, z); mm.fillStyle = col; mm.beginPath(); mm.arc(a, b, r, 0, 7); mm.fill(); };
  if (marker.visible) dot(marker.position.x, marker.position.z, '#ffd21f', 6);
  if (redMarker.visible) dot(redMarker.position.x, redMarker.position.z, '#ff2020', 8);
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
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

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
  if (!inside) { me.pos.x = clamp(me.pos.x, -230, 240); me.pos.z = clamp(me.pos.z, -158, 280); }

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
  for (const c of movingCars) { c.g.position.x += c.dir * c.speed * dt; if (c.g.position.x > 230) c.g.position.x = -230; if (c.g.position.x < -230) c.g.position.x = 230; }
  if (!inside) for (let i = 0; i < peds.length; i++) {
    const p = peds[i], u = p.userData;
    const far = p.position.distanceToSquared(me.pos) > 160 * 160;
    p.visible = i < pedLimit && !far; if (!p.visible) continue;
    // panic: run away from the Taj; calm: stroll, and stop/look when the player bumps into them
    let sp = u.panic ? u.speed * 3.6 : u.speed;
    const dp = p.position.distanceTo(me.pos);
    if (!u.panic && dp < 1.6) u.stopT = 1.5;
    if (u.stopT > 0) { u.stopT -= dt; sp = 0; p.lookAt(me.pos.x, 0, me.pos.z); }
    else {
      if (u.panic && u.alongX) u.dir = p.position.x > TAJ.x ? 1 : -1;
      if (u.panic && !u.alongX) u.dir = 1;
      if (u.alongX) { p.position.x += u.dir * sp * dt; p.rotation.y = u.dir > 0 ? Math.PI / 2 : -Math.PI / 2; if (Math.abs(p.position.x) > 200) { u.dir *= -1; if (u.panic) p.position.x = clamp(p.position.x, -200, 200); } }
      else { p.position.z += u.dir * sp * dt; p.rotation.y = u.dir > 0 ? 0 : Math.PI; if (p.position.z > 255 || p.position.z < -35) u.dir *= -1; }
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
  if (net.online && netT <= 0) { netT = 1 / 15; nsend({ t: 's', p: me.pos.toArray().map(v => +v.toFixed(2)), ry: +me.yaw.toFixed(2), hp: Math.round(me.hp), down: me.down, dead: me.dead, ph: phase, z: me.inZone, in: inside }); }
  for (const p of net.peers.values()) {
    p.pos.lerp(p.target, Math.min(1, dt * 10));
    p.model.position.copy(p.pos); p.model.rotation.y = p.yaw + Math.PI;
    p.model.visible = !!p.inside === inside && !p.dead;
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
  train.position.x += 16 * dt; if (train.position.x > 260) train.position.x = -320;
  for (const sg of signalHeads) { const ph = (t + sg.off) % 12, on = ph < 5 ? 2 : ph < 6.5 ? 1 : 0; sg.lamps.forEach((l, i) => l.material.emissiveIntensity = i === on ? 4 : 0); }
  for (let i = pings.length - 1; i >= 0; i--) { const pg = pings[i]; pg.t -= dt; pg.s.material.opacity = Math.min(1, pg.t); if (pg.t <= 0) { scene.remove(pg.s); pings.splice(i, 1); } }
  for (let i = feedLines.length - 1; i >= 0; i--) { feedLines[i].t -= dt; if (feedLines[i].t <= 0) feedLines.splice(i, 1); }
  $('feed').innerHTML = feedLines.map(l => `<div style="opacity:${Math.min(1, l.t / 2)}">${l.html}</div>`).join('');
  $('floor').textContent = inside ? FLOOR_NAMES[floorOf(me.pos.y)] : '';
  watchFps(dt);
  grade.uniforms.time.value = t % 100;
  composer.render();
}
loop();
