import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';

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
  ground.material.roughnessMap = puddleTex; ground.material.roughness = 1; ground.material.metalness = 0.15; ground.material.color.set(0x8a8a8a); ground.material.needsUpdate = true;
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
  windowMats.forEach(m => m.emissiveIntensity = 0.45);
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
function tajHotel() {
  const fac = facade({ floors: 6, cols: 22, wall: '#d6b98d', glass: '#202838', lit: 0.55, arched: true, trim: '#f4ead6' });
  const side = facade({ floors: 6, cols: 9, wall: '#d6b98d', glass: '#202838', lit: 0.5, arched: true, trim: '#f4ead6' });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xa9442b, roughness: 0.55, metalness: 0.15 });
  const mats = [side, side, M(0x7a5a40), M(0x7a5a40), fac, fac];
  const main = new THREE.Mesh(new THREE.BoxGeometry(96, 32, 34), mats);
  main.position.set(TAJ.x, 16, TAJ.z); main.castShadow = main.receiveShadow = true; scene.add(main);
  colliders.push({ minX: TAJ.x - 48, maxX: TAJ.x + 48, minZ: TAJ.z - 17, maxZ: TAJ.z + 17, minY: 0, maxY: 32 }); solids.push(main);
  // central great dome (iconic red dome)
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 6, 32), M(0xe0c79c)); drum.position.set(TAJ.x, 35, TAJ.z); drum.castShadow = true; scene.add(drum);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(9.5, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), roofMat); dome.scale.y = 1.25; dome.position.set(TAJ.x, 38, TAJ.z); dome.castShadow = true; scene.add(dome);
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.7, 5, 12), M(0xd4a23c, { metalness: 0.8, roughness: 0.3 })); fin.position.set(TAJ.x, 52, TAJ.z); scene.add(fin);
  // corner towers with domes + mid-face towers
  for (const [dx, dz] of [[-46, -15], [46, -15], [-46, 15], [46, 15], [-24, 15], [24, 15]]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(9, 38, 9), mats); t.position.set(TAJ.x + dx, 19, TAJ.z + dz); t.castShadow = true; scene.add(t);
    const d = new THREE.Mesh(new THREE.SphereGeometry(5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), roofMat); d.scale.y = 1.3; d.position.set(TAJ.x + dx, 38, TAJ.z + dz); d.castShadow = true; scene.add(d);
    const f = fin.clone(); f.scale.setScalar(0.6); f.position.set(TAJ.x + dx, 46, TAJ.z + dz); scene.add(f);
  }
  // cornice + balcony lines
  for (let f = 1; f < 6; f++) { const c = new THREE.Mesh(new THREE.BoxGeometry(97, 0.5, 35.5), M(0xf2e6cc)); c.position.set(TAJ.x, f * 5.33, TAJ.z); scene.add(c); }
  // porch / main entrance on the city side (+Z)
  addBox(16, 6, 6, M(0xf2e6cc), TAJ.x, 0, TAJ.z + 20, { collide: false });
  const door = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), new THREE.MeshStandardMaterial({ color: 0x110a05, emissive: 0xffa040, emissiveIntensity: 0.6 }));
  door.position.set(TAJ.x, 2.5, TAJ.z + 17.05); scene.add(door);
  // Taj Tower (modern wing)
  const tw = facade({ floors: 22, cols: 12, wall: '#9aa3a8', glass: '#2a3a48', lit: 0.45, trim: '#c8d0d4' });
  addBox(36, 80, 22, tw, TAJ.x + 75, 0, TAJ.z + 6);
  return { main, dome };
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
const roadMat = new THREE.MeshStandardMaterial({ map: pavTex, roughness: 0.85 });
for (let bx = -200; bx <= 200; bx += 50) {
  for (let bz = -40; bz <= 260; bz += 50) {
    if (bz < -10 && Math.abs(bx - TAJ.x) < 130) continue;
    const near = (p) => Math.abs(p.x - bx) < 30 && Math.abs(p.z - bz) < 30;
    if (near(SPOTS.handler) || near(SPOTS.spawn) || near(SPOTS.red)) continue;
    // sidewalk slab
    const sw = new THREE.Mesh(new THREE.BoxGeometry(38, 0.25, 38), roadMat); sw.position.set(bx, 0.125, bz); sw.receiveShadow = true; scene.add(sw);
    const isHome = near(SPOTS.home);
    const parts = isHome ? 1 : (Math.random() < 0.5 ? 1 : 2);
    for (let p = 0; p < parts; p++) {
      const w = parts === 1 ? 32 : 15, h = isHome ? 14 : rand(12, 46), d = 32;
      const ox = parts === 1 ? 0 : (p ? 8.5 : -8.5);
      const mat = blockMats[(Math.abs(bx * 7 + bz * 3 + p)) % blockMats.length];
      addBox(w, h, d, mat, bx + ox, 0, bz);
      // rooftop water tanks — very Mumbai
      if (Math.random() < 0.7) { const t = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2, 12), M(0x222222)); t.position.set(bx + ox + rand(-5, 5), h + 1, bz + rand(-5, 5)); scene.add(t); }
      // shop awnings
      const aw = new THREE.Mesh(new THREE.BoxGeometry(w - 2, 0.2, 2.4), M([0x2a6f4a, 0x9a2a2a, 0x2a4a8a, 0xb08a2a][(bx + bz + p) & 3 >>> 0] || 0x9a2a2a)); aw.position.set(bx + ox, 3.6, bz + d / 2 + 1.2); aw.rotation.x = 0.25; aw.castShadow = true; scene.add(aw);
    }
  }
}
// Street lamps (bloom glow) + a few real lights
const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffb45a, emissiveIntensity: 4 });
let lampCount = 0;
for (let x = -200; x <= 220; x += 25) for (const z of [-125, 15, 65, 115]) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 8), M(0x333333, { metalness: 0.6 })); pole.position.set(x, 3.5, z); scene.add(pole);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), bulbMat); bulb.position.set(x, 7.1, z); scene.add(bulb);
  if ((lampCount++ % 9) === 0) { const l = new THREE.PointLight(0xffa850, 30, 40, 1.8); l.position.set(x, 6.8, z); l.visible = false; scene.add(l); cityLights.push(l); }
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
for (let i = 0; i < 26; i++) { const lane = [15, 65, 115][i % 3]; const c = car(rand(-200, 200), lane + (i % 2 ? 4 : -4), i % 2 ? Math.PI / 2 : -Math.PI / 2, Math.random() < 0.6); if (i < 12) { colliders.pop(); solids.pop(); movingCars.push({ g: c, dir: i % 2 ? 1 : -1, speed: rand(6, 11) }); } }
car(SPOTS.handler.x + 5, SPOTS.handler.z, 0.3, false); // Colonel's jeep
// Police barricade + vehicles at the red zone (shown after alert)
const redZoneProps = new THREE.Group(); redZoneProps.visible = false; scene.add(redZoneProps);
for (let i = 0; i < 6; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 0.3), M(i % 2 ? 0xdddddd : 0xcc2222)); bar.position.set(TAJ.x - 15 + i * 6, 0.5, TAJ.z + 36); redZoneProps.add(bar); }
const siren = new THREE.PointLight(0x2050ff, 0, 40); siren.position.set(TAJ.x + 12, 3, TAJ.z + 38); scene.add(siren);
const siren2 = new THREE.PointLight(0xff2030, 0, 40); siren2.position.set(TAJ.x - 12, 3, TAJ.z + 38); scene.add(siren2);

// ============================================================ CHARACTERS
function makeHuman({ shirt = 0x3b4a3a, pants = 0x2c3325, skin = 0x8d5a3b, head = 0x1f2a1e, vest = 0x2a3324, gun = true, tag } = {}) {
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
  return g;
}
function textSprite(text, color = '#fff') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
  x.font = '600 34px Oswald, sans-serif'; x.textAlign = 'center'; x.fillStyle = '#0008'; x.fillRect(0, 8, 256, 48); x.fillStyle = color; x.fillText(text, 128, 44);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, fog: false })); s.scale.set(1.6, 0.4, 1); s.renderOrder = 10; return s;
}
// The handler (Colonel) NPC
const colonel = makeHuman({ shirt: 0x5b6b4a, vest: 0x4b5a3a, head: 0x8a1c1c, tag: 'Col. Rathore' });
colonel.position.copy(SPOTS.handler); colonel.rotation.y = Math.PI; scene.add(colonel);
// pedestrians
const peds = [];
for (let i = 0; i < 22; i++) { const p = makeHuman({ shirt: [0xd8d0c0, 0x9a3b3b, 0x3b5a9a, 0xe0a040, 0x7a4a8a][i % 5], pants: 0x2a2a3a, vest: [0xd8d0c0, 0x9a3b3b, 0x3b5a9a][i % 3], head: 0x111111, gun: false });
  p.position.set(rand(-180, 180), 0, [20, 60, 70, 110, 120, -130][i % 6] + rand(-3, 3)); p.userData.dir = Math.random() < 0.5 ? 1 : -1; scene.add(p); peds.push(p); }

// ============================================================ TAJ INTERIOR (assault map)
const IN = { x: 1000, z: 0 }; // interior origin, far from the city
const interiorLights = [];
const fires = [];
function buildInterior() {
  const wallMat = new THREE.MeshStandardMaterial({ map: woodTex, bumpMap: woodTex, bumpScale: 2, roughness: 0.6, color: 0xd8b48a });
  const ceilMat = M(0xe9dcc0, { roughness: 0.9 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(82, 66), new THREE.MeshStandardMaterial({ map: marbleTex, roughness: 0.15, metalness: 0.05, envMapIntensity: 0.6 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(IN.x, 0.01, IN.z); floor.receiveShadow = true; scene.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(82, 66), ceilMat); ceil.rotation.x = Math.PI / 2; ceil.position.set(IN.x, 7, IN.z); scene.add(ceil);
  const H = 7, T = 0.6;
  const seg = (x1, z1, x2, z2) => { const w = Math.abs(x2 - x1) || T, d = Math.abs(z2 - z1) || T; addBox(w, H, d, wallMat, IN.x + (x1 + x2) / 2, 0, IN.z + (z1 + z2) / 2, { cast: false }); };
  // wall along X at fixed z, from a to b, with door gaps (centers)
  const wallX = (z, a, b, gaps = [], gw = 4) => { let s = a; for (const g of [...gaps].sort((p, q) => p - q)) { if (g - gw / 2 > s) seg(s, z, g - gw / 2, z); s = g + gw / 2; } if (b > s) seg(s, z, b, z); };
  const wallZ = (x, a, b, gaps = [], gw = 4) => { let s = a; for (const g of [...gaps].sort((p, q) => p - q)) { if (g - gw / 2 > s) seg(x, s, x, g - gw / 2); s = g + gw / 2; } if (b > s) seg(x, s, x, b); };
  wallX(33, -41, 41); wallX(-33, -41, 41); wallZ(-41, -33, 33); wallZ(41, -33, 33);
  wallX(12, -41, 41, [-28, 0, 28]);
  wallZ(-6, -10, 12, [6, -5]); wallZ(6, -10, 12, [7, -4]);
  wallX(1, -41, -6, [-23]); wallX(1, 6, 41, [23]);
  wallX(-10, -41, 41, [-30, 0, 30]);
  // lobby: pillars, desk, grand staircase, sofas
  const pill = M(0xf3ead8, { roughness: 0.35 });
  for (const px of [-14, 14]) for (const pz of [17, 26]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 7, 20), pill); p.position.set(IN.x + px, 3.5, IN.z + pz); p.castShadow = true; scene.add(p); colliders.push({ minX: IN.x + px - .8, maxX: IN.x + px + .8, minZ: IN.z + pz - .8, maxZ: IN.z + pz + .8, minY: 0, maxY: 7 }); solids.push(p); }
  addBox(10, 1.2, 2, M(0x3a2214, { roughness: 0.4 }), IN.x + 24, 0, IN.z + 22);
  for (let i = 0; i < 8; i++) addBox(8, 0.5 * (i + 1), 1.2, M(0x8a1c2a), IN.x - 33, 0, IN.z + 28 - i * 1.2); // grand staircase (red carpet)
  const sofa = M(0x6a1f24, { roughness: 0.9 });
  for (const [sx, sz] of [[-6, 20], [6, 20], [-24, 16], [30, 15]]) addBox(3.5, 1, 1.2, sofa, IN.x + sx, 0, IN.z + sz);
  // corridor & room cover
  const crate = M(0x4a3a2a);
  for (const [cx, cz] of [[-2, 4], [2, -6], [-20, 8], [-30, -3], [20, 4], [33, -4], [-12, -6], [14, -7]]) addBox(2.2, 1.1, 1.2, crate, IN.x + cx, 0, IN.z + cz);
  // rooms: beds
  for (const [bx, bz] of [[-34, 8], [34, 9], [-34, -6], [34, -6]]) { addBox(3, 0.7, 4, M(0xf0ece4), IN.x + bx, 0, IN.z + bz); }
  // ballroom: pillars, round tables, boss sandbag nest
  for (const px of [-18, 18]) for (const pz of [-16, -26]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 7, 20), pill); p.position.set(IN.x + px, 3.5, IN.z + pz); p.castShadow = true; scene.add(p); colliders.push({ minX: IN.x + px - .8, maxX: IN.x + px + .8, minZ: IN.z + pz - .8, maxZ: IN.z + pz + .8, minY: 0, maxY: 7 }); solids.push(p); }
  for (const [tx, tz] of [[-9, -15], [9, -15], [-28, -22], [27, -16], [-9, -22], [10, -21]]) addBox(2.4, 0.9, 2.4, M(0xf4f0e8), IN.x + tx, 0, IN.z + tz);
  const sand = M(0x8f7d5a, { roughness: 1 });
  addBox(7, 1.15, 1.3, sand, IN.x, 0, IN.z - 25); addBox(1.3, 1.15, 3, sand, IN.x - 4, 0, IN.z - 26.5); addBox(1.3, 1.15, 3, sand, IN.x + 4, 0, IN.z - 26.5);
  // chandeliers
  const chand = new THREE.MeshStandardMaterial({ color: 0xffe9b8, emissive: 0xffd28a, emissiveIntensity: 3 });
  for (const [lx, lz, col, intensity] of [[0, 22, 0xffd8a0, 30], [-22, 6, 0xffd8a0, 12], [22, -5, 0xffd8a0, 12], [0, -20, 0xffd8a0, 22], [0, 0, 0xffd8a0, 10]]) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 10), chand); c.position.set(IN.x + lx, 6.2, IN.z + lz); scene.add(c);
    const l = new THREE.PointLight(col, intensity, 30, 1.5); l.position.set(IN.x + lx, 5.8, IN.z + lz); l.visible = false; scene.add(l); interiorLights.push(l);
    l.userData.base = intensity;
  }
  // fires (heritage wing burning)
  for (const [fx, fz] of [[-30, 8], [28, -28], [-14, 24]]) {
    const g = new THREE.Group(); scene.add(g); emitter(g, IN.x + fx, 0.5, IN.z + fz, 18, true); emitter(g, IN.x + fx, 2, IN.z + fz, 10, false);
    const l = new THREE.PointLight(0xff6020, 35, 18, 1.6); l.position.set(IN.x + fx, 1.5, IN.z + fz); l.intensity = 18; l.visible = false; scene.add(l); interiorLights.push(l); fires.push(l);
  }
}
buildInterior();

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
  weapon: 'm4', ammo: 30, reserve: 210, nades: 3, lastShot: 0, reloading: 0, lastHurt: 0, onGround: true,
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
  const model = makeHuman({ shirt: 0x2b3523, vest: 0x1c241a, head: 0x111111, tag: name });
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
    case 'nade': throwNade(new THREE.Vector3(...m.p), new THREE.Vector3(...m.v), false); break;
    case 'brief': startBrief(); break;
    case 'hostage': setHostage(m.id, m.s, false); break;
    case 'revive': if (me.down && !me.dead) { me.down = false; me.hp = 35; toast(`${p ? p.name : 'Teammate'} revived you!`); } break;
    case 'end': endGame(m.win, m.r, false); break;
  }
}

// ============================================================ ENEMIES & HOSTAGES
const ENEMY_DEFS = [
  ['rifle', 26, 16], ['rifle', -24, 15], ['bomber', 0, 0], ['rifle', -25, 6], ['rifle', -20, -5],
  ['bomber', 25, 7], ['rifle', 25, -6], ['rifle', -28, -20], ['bomber', 28, -22], ['boss', 0, -28],
];
const enemies = ENEMY_DEFS.map(([type, x, z], id) => {
  const model = makeHuman({ shirt: type === 'bomber' ? 0x3a3a3a : 0x2a2a2a, pants: 0x3b3b44, vest: type === 'bomber' ? 0x6a5a2a : 0x1a1a1a, head: 0x101010 });
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
  model.position.set(IN.x + x, 0, IN.z + z); model.rotation.y = type === 'boss' ? 0 : rand(0, 6.28);
  model.traverse(o => { if (o.isMesh) o.userData.enemy = id; });
  scene.add(model);
  const hp = type === 'boss' ? 750 : type === 'bomber' ? 80 : 100;
  return { id, type, model, hp, max: hp, alive: true, alert: false, seen: 0, lastSeen: null, fireT: 0, burst: 0, armed: -1, home: model.position.clone(), patrolT: rand(0, 5), lastSeenByPlayer: 0, deadAnim: 0 };
});
const HOSTAGE_DEFS = [[-35, 6], [-32, -6], [35, 9], [36, -7], [-35, -28], [34, -30], [14, 27], [-5, -18]];
const hostages = HOSTAGE_DEFS.map(([x, z], id) => {
  const m = makeHuman({ shirt: [0xf0f0f0, 0xc04040, 0x4060c0, 0xe0c080][id % 4], pants: 0x222244, vest: [0xf0f0f0, 0xc04040, 0x4060c0, 0xe0c080][id % 4], head: 0x111111, gun: false });
  m.scale.y = 0.62; m.position.set(IN.x + x, 0, IN.z + z); m.rotation.y = rand(0, 6);
  m.userData.armL.rotation.x = -3; m.userData.armR.rotation.x = -3;
  m.traverse(o => { if (o.isMesh) o.userData.hostage = id; }); scene.add(m);
  return { id, model: m, state: 'held' }; // held | rescued | dead
});
let hostageDeaths = 0, rescued = 0;
function setHostage(id, s, broadcast = true) {
  const h = hostages[id]; if (!h || h.state !== 'held') return;
  h.state = s; h.model.visible = s === 'held' ? true : false;
  if (s === 'dead') { hostageDeaths++; toast(`A hostage was killed! (${hostageDeaths}/3)`, '#f55'); blood(h.model.position.clone().setY(1)); if (hostageDeaths >= 3 && net.host) endGame(false, 'Three hostages died. Command has aborted the operation.'); }
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
  return ray.intersectObjects(solids, false).length === 0;
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
  const d = me.pos.clone().setY(1).distanceTo(p);
  if (inside && d < r && lineOfSight(p.clone().setY(1.2), me.pos.clone().setY(1.2))) hurt(dmg * (1 - d / r));
  if (hostSide && net.host) {
    for (const e of enemies) if (e.alive && e.model.position.distanceTo(p) < r) damageEnemy(e.id, dmg * (1 - e.model.position.distanceTo(p) / r), false);
    for (const h of hostages) if (h.state === 'held' && h.model.position.distanceTo(p) < r * 0.8) setHostage(h.id, 'dead');
  }
}
function applyEnemySnapshot(list) {
  for (const [id, x, z, ry, alive, armed, hp] of list) {
    const e = enemies[id]; e.model.position.x += (x - e.model.position.x) * 0.5; e.model.position.z += (z - e.model.position.z) * 0.5; e.model.rotation.y = ry;
    e.hp = hp; e.armed = armed; if (e.alive && !alive) { e.alive = false; e.deadAnim = 0.001; }
  }
}
function enemyShoot(e, target) {
  const from = e.model.position.clone().setY(1.4);
  const to = target.pos.clone().setY(1.2 + rand(-0.4, 0.4));
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
function moveWithCollision(pos, dx, dz, r = 0.4) { pos.x += dx; pos.z += dz; collide(pos, r); }
function updateEnemiesHost(dt) {
  const players = allPlayers();
  for (const e of enemies) {
    const m = e.model;
    if (!e.alive) {
      if (e.armed > 0) { e.armed -= dt; if (Math.floor(e.armed * 8) % 2 === 0) sfx('beep', m.position, 0.9); if (e.armed <= 0) { e.armed = -2; const p = m.position.clone().setY(1); explosionFx(p, 9); applyBlast(p, 9, 140); nsend({ t: 'boom', p: p.toArray(), r: 9, d: 140 }); m.visible = false; } }
      continue;
    }
    // find visible target
    let best = null, bd = 1e9;
    const eye = m.position.clone().setY(1.6);
    for (const p of players) {
      if (!p.alive) continue; const d = p.pos.distanceTo(m.position);
      if (d > (e.type === 'boss' ? 60 : 48)) continue;
      const fwd = new THREE.Vector3(Math.sin(m.rotation.y), 0, Math.cos(m.rotation.y));
      const dir = p.pos.clone().sub(m.position).setY(0).normalize();
      if (!e.alert && fwd.dot(dir) < -0.1 && d > 6) continue;
      if (!lineOfSight(eye, p.pos.clone().setY(1.5))) continue;
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
        if (e.armed > 0) { e.armed -= dt; if (Math.floor(e.armed * 10) % 2 === 0) sfx('beep', m.position); if (e.armed <= 0) { e.alive = false; e.armed = -2; const p = m.position.clone().setY(1); explosionFx(p, 9); applyBlast(p, 9, 140); nsend({ t: 'boom', p: p.toArray(), r: 9, d: 140 }); m.visible = false; const left = enemies.filter(x => x.alive).length; toast(`Bomber detonated — ${left} remaining`, '#f80'); } }
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
    if (!e.alive && e.deadAnim > 0 && e.deadAnim < 1) { e.deadAnim = Math.min(1, e.deadAnim + dt * 2.5); m.rotation.x = -e.deadAnim * Math.PI / 2; m.position.y = e.deadAnim * 0.25; m.traverse(o => { if (o.isMesh) o.userData.enemy = undefined; }); }
    if (e.alive) { const s = Math.sin(performance.now() / 150 + e.id) * 0.3; u.legL.rotation.x = s; u.legR.rotation.x = -s; }
  }
}

// ============================================================ COLLISION
function collide(pos, r) {
  for (const c of colliders) {
    if (pos.y > c.maxY - 0.01 || pos.y + 1.8 < c.minY) continue;
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
function throwNade(p, v, mine = true) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), M(0x2c3a24, { metalness: 0.3 })); m.position.copy(p); scene.add(m);
  nades.push({ m, v: v.clone(), t: 2.4, mine });
  if (mine) nsend({ t: 'nade', p: p.toArray(), v: v.toArray() });
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
  const w = WEAPONS[me.weapon]; me.ammo = w.mag; me.reserve = w.reserve; me.nades = 3; me.hp = 100;
  buildViewGun(me.weapon);
  enterInterior();
  renderer.domElement.requestPointerLock();
};
function enterInterior() {
  inside = true; phase = 'assault';
  me.pos.set(IN.x - 3 + (net.id % 4) * 2, 0, IN.z + 29); me.yaw = 0; me.pitch = 0;
  sunLight.visible = false; hemi.intensity = 0.12; scene.fog.density = 0.02; scene.fog.color.set(0x140c08);
  interiorLights.forEach(l => l.visible = true); cityLights.forEach(l => l.visible = false); sky.visible = false; stars.visible = false;
  scene.background = new THREE.Color(0x050302); renderer.toneMappingExposure = 0.55; bloom.threshold = 0.95; bloom.strength = 0.5;
  objective('Clear the Taj: neutralise all 10 hostiles · rescue hostages (E)');
  toast('Operation Black Tornado is GO', '#ffd21f');
}
let exfilMarker = null;
function assaultUpdate(dt) {
  const left = enemies.filter(e => e.alive).length;
  if (left === 0 && !exfilMarker) {
    exfilMarker = makeMarker(0x30ff60); exfilMarker.position.set(IN.x, 0, IN.z + 29); exfilMarker.visible = true;
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

// ============================================================ INPUT
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyE' && dialogQ) nextDialog();
  if (e.code === 'KeyR') reload();
  if (e.code === 'Digit1') $('phone').classList.toggle('up');
  if (e.code === 'KeyG' && phase === 'assault' && me.nades > 0 && !me.down) {
    me.nades--; const dir = new THREE.Vector3(0, 0.25, -1).applyQuaternion(camera.quaternion).normalize();
    throwNade(camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.6), dir.multiplyScalar(16));
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
  startStory(); renderer.domElement.requestPointerLock();
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
  for (const c of colliders) { const [x1, z1] = P(c.minX, c.minZ); const [x2, z2] = P(c.maxX, c.maxZ); if (Math.abs(x1) < 200 && Math.abs(z1) < 200) mm.fillRect(x1, z1, x2 - x1, z2 - z1); }
  const dot = (x, z, col, r = 4) => { const [a, b] = P(x, z); mm.fillStyle = col; mm.beginPath(); mm.arc(a, b, r, 0, 7); mm.fill(); };
  if (marker.visible) dot(marker.position.x, marker.position.z, '#ffd21f', 6);
  if (redMarker.visible) dot(redMarker.position.x, redMarker.position.z, '#ff2020', 8);
  if (exfilMarker) dot(exfilMarker.position.x, exfilMarker.position.z, '#3f6', 6);
  for (const p of net.peers.values()) if (p.model.visible) dot(p.pos.x, p.pos.z, p.down ? '#f80' : '#4af');
  if (inside) for (const e of enemies) if (e.alive && e.seen > 0) dot(e.model.position.x, e.model.position.z, '#f33', 3);
  mm.restore();
  mm.fillStyle = '#fff'; mm.beginPath(); mm.moveTo(S / 2, S / 2 - 7); mm.lineTo(S / 2 - 5, S / 2 + 5); mm.lineTo(S / 2 + 5, S / 2 + 5); mm.fill();
}

// ============================================================ MAIN LOOP
const clock = new THREE.Clock();
let netT = 0, bob = 0;
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
  me.pos.x += me.vel.x * dt; me.pos.z += me.vel.z * dt; me.pos.y += me.vel.y * dt;
  if (me.pos.y <= 0) { me.pos.y = 0; me.vel.y = 0; me.onGround = true; }
  collide(me.pos, 0.4);
  if (!inside) { me.pos.x = clamp(me.pos.x, -230, 240); me.pos.z = clamp(me.pos.z, -158, 280); }

  // --- camera
  const moving = Math.hypot(me.vel.x, me.vel.z);
  bob += moving * dt * 1.6;
  const eyeH = me.down ? 0.4 : 1.7;
  camera.position.set(me.pos.x, me.pos.y + eyeH + Math.sin(bob * 2) * 0.04 * (moving > 1 ? 1 : 0), me.pos.z);
  recoil *= Math.pow(0.002, dt);
  if (shake > 0) { camera.position.x += rand(-1, 1) * shake * 0.15; camera.position.y += rand(-1, 1) * shake * 0.15; shake = Math.max(0, shake - dt * 1.5); }
  camera.rotation.set(me.pitch + recoil, me.yaw, 0, 'YXZ');
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
    if (n.m.position.y < 0.09) { n.m.position.y = 0.09; n.v.y *= -0.35; n.v.x *= 0.6; n.v.z *= 0.6; }
    const p = n.m.position.clone(); collide(p, 0.1); if (p.x !== n.m.position.x || p.z !== n.m.position.z) { n.v.x *= -0.4; n.v.z *= -0.4; n.m.position.copy(prev); }
    n.t -= dt; if (n.t <= 0) { const bp = n.m.position.clone(); scene.remove(n.m); nades.splice(i, 1); explosionFx(bp, 8); applyBlast(bp, 8, 220); if (net.host) alertNear(bp, 30); }
  }

  // --- world animation
  for (const c of movingCars) { c.g.position.x += c.dir * c.speed * dt; if (c.g.position.x > 230) c.g.position.x = -230; if (c.g.position.x < -230) c.g.position.x = 230; }
  for (const p of peds) { const sp = p.userData.panic ? 5 : 1.4; p.position.x += p.userData.dir * sp * dt; p.rotation.y = p.userData.dir > 0 ? Math.PI / 2 : -Math.PI / 2; if (Math.abs(p.position.x) > 200) p.userData.dir *= -1; const s = Math.sin(t * sp * 3 + p.id) * 0.5; p.userData.legL.rotation.x = s; p.userData.legR.rotation.x = -s; }
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
    if (net.host) { updateEnemiesHost(dt); snapT -= dt; if (snapT <= 0) { snapT = 0.1; nsend({ t: 'e', l: enemies.map(e => [e.id, +e.model.position.x.toFixed(2), +e.model.position.z.toFixed(2), +e.model.rotation.y.toFixed(2), e.alive, +e.armed.toFixed(2), Math.round(e.hp)]) }); } }
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
    p.model.rotation.x = p.down ? -Math.PI / 2.3 : 0; p.model.position.y = p.down ? 0.3 : p.pos.y;
  }

  // --- HUD
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('msg').textContent = ''; }
  $('hp').style.width = me.hp + '%';
  $('hpbar').style.display = $('stats').style.display = phase === 'assault' ? 'block' : 'none';
  if (phase === 'assault') $('stats').innerHTML = `${WEAPONS[me.weapon].name}<br><span style="font-size:40px">${me.reloading > 0 ? 'RELOADING' : me.ammo}</span> / ${me.reserve}<br><span style="font-size:18px">Grenades: ${me.nades}</span>`;
  const team = [...net.peers.values()];
  $('team').style.display = team.length || keys.Tab ? 'block' : 'none';
  $('team').innerHTML = `<b>SQUAD ${net.online ? '(online)' : ''}</b><br>${me.name} (you) — ${me.down ? 'DOWN' : Math.round(me.hp) + ' HP'}` + team.map(p => `<br>${p.name} — ${p.dead ? 'KIA' : p.down ? 'DOWN' : p.hp + ' HP'}`).join('');
  const d = new Date(2008, 10, 26, night ? 21 : 18, night ? 48 : 30); $('pclock').textContent = $('ptime').textContent = d.toTimeString().slice(0, 5);
  if (phase !== 'menu') drawMinimap();

  if (phase === 'menu') { camera.position.set(80 + Math.sin(t * 0.05) * 60, 30, 40); camera.lookAt(TAJ.x, 25, TAJ.z); }
  watchFps(dt);
  grade.uniforms.time.value = t % 100;
  composer.render();
}
loop();
