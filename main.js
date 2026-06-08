import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/* ---------- renderer / scene / camera ---------- */
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x02040a, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

/* tiny environment map to give nicer lighting reflections */
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 800);
camera.position.set(0, 2, 9);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 3.5;
controls.maxDistance = 22;

/* ===== Procedural noise + material helpers ===== */
const timeUniforms = []; // we'll tick these each frame

/* ===== Planet: procedural terrain enhancer ===== */
const planetUniforms = [];

const PLANET_NOISE_GLSL = `
vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute( permute( permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a1.xy, h.y);
  vec3 p2 = vec3(a0.zw, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m*m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}`;

function enhancePlanetMaterial(mat, opts = {}) {
  const params = {
    scale: 1.6,          // noise frequency
    disp: 0.02,          // tiny vertex displacement (along normal)
    bandFreq: 2.2,       // latitude bands
    crater: 0.35,        // stronger darkening in “pits”
    colorA: 0x1a2044,    // low lat tint
    colorB: 0x2a3e85,    // high lat tint
    ...opts
  };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.pTime = { value: 0 };
    shader.uniforms.pScale = { value: params.scale };
    shader.uniforms.pDisp = { value: params.disp };
    shader.uniforms.pBandFreq = { value: params.bandFreq };
    shader.uniforms.pCrater = { value: params.crater };
    shader.uniforms.pColorA = { value: new THREE.Color(params.colorA) };
    shader.uniforms.pColorB = { value: new THREE.Color(params.colorB) };
    planetUniforms.push(shader.uniforms);

    // add world pos varyings and noise
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PLANET_NOISE_GLSL}\nvarying vec3 vWPos;`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWPos = worldPosition.xyz;')
      .replace('#include <project_vertex>', `
  float n = snoise(normalize(position) * pScale + vec3(pTime*0.03));
  vec3 displaced = position + normal * (n * pDisp);  // pDisp ~ 0.038–0.06 looks good
  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  gl_Position = projectionMatrix * mvPosition;
`)
      ;

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PLANET_NOISE_GLSL}\nvarying vec3 vWPos;\nuniform float pTime,pScale,pBandFreq,pCrater; uniform vec3 pColorA,pColorB;`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
  // latitude color bands + polar caps
  vec3 N = normalize(vWPos);
  vec3 bandCol = mix(pColorA, pColorB, 0.5 + 0.5 * sin(vWPos.y * pBandFreq));
  float lat = abs(N.y);
  float caps = smoothstep(0.58, 0.92, lat);
  bandCol = mix(bandCol, vec3(0.88, 0.93, 1.0), caps * 0.35);

  // crater mask (bright rims, darker pits)
  float nn = snoise(vWPos * (pScale*0.7) + vec3(pTime*0.02));
  float craterMask = smoothstep(0.2, 0.9, abs(nn));
  vec3 craterTint = mix(vec3(1.0), vec3(0.75,0.82,0.95), craterMask * pCrater);

  // gentle albedo AO to add body
  float ao = 0.82 + 0.18 * (snoise(vWPos * (pScale*0.35)) * 0.5 + 0.5);

  diffuse *= bandCol * craterTint * ao;
  roughnessFactor = clamp(roughnessFactor + craterMask * 0.22 * pCrater, 0.0, 1.0);

  vec4 diffuseColor = vec4(diffuse, opacity);
`)
  };
  return mat;
}

// 3D Simplex noise by IQ (tiny)
const NOISE_GLSL = `
vec4 mod289(vec4 x){return x - floor(x * (1.0 / 289.0)) * 289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2  C = vec2(1.0/6.0, 1.0/3.0);
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute( permute( permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a1.xy,h.y);
  vec3 p2 = vec3(a0.zw,h.z);
  vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m*m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
}`;

// Injects crater-ish normals + two-tone color into a Physical/Standard mat
function addNoisySurface(mat, params) {
  const opts = Object.assign({
    scale: 2.0,       // noise frequency
    amp: 0.15,        // normal perturb amount
    crater: 0.45,     // how strong the crater darkening is
    bandFreq: 2.6,    // latitudinal banding frequency
    colorA: new THREE.Color(0x1b1b3c),
    colorB: new THREE.Color(0x2b3a78)
  }, params || {});

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uScale = { value: opts.scale };
    shader.uniforms.uAmp = { value: opts.amp };
    shader.uniforms.uCrater = { value: opts.crater };
    shader.uniforms.uBandFreq = { value: opts.bandFreq };
    shader.uniforms.uColorA = { value: opts.colorA };
    shader.uniforms.uColorB = { value: opts.colorB };
    timeUniforms.push(shader.uniforms); // animate later

    // add vWorldPosition + noise
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPosition;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPosition = worldPosition.xyz;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}\nvarying vec3 vWorldPosition;\nuniform float uTime, uScale, uAmp, uCrater, uBandFreq; uniform vec3 uColorA, uColorB;`)
      // bump/perturb the normal before lighting
      .replace('#include <normal_fragment_maps>', `
        // ----- begin noisy normal -----
        vec3 nrm = normalize( normal );
        float n = snoise(vWorldPosition * uScale + vec3(uTime*0.03));
        nrm = normalize( nrm + uAmp * n * nrm );
        normal = nrm;
        // ----- end noisy normal -----
        #include <normal_fragment_maps>
      `)
      // tint + crater darkening + bands
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        vec3 baseCol = mix(uColorA, uColorB, 0.5 + 0.5*sin(vWorldPosition.y * uBandFreq));
        float n2 = snoise(vWorldPosition * (uScale*0.7) + vec3(uTime*0.02));
        float craterMask = smoothstep(0.35, 0.85, abs(n2)); // bright rims, dark pits
        vec3 craterTint = mix(vec3(1.0), vec3(0.7,0.78,0.9), craterMask * uCrater);
        diffuse = diffuse * baseCol * craterTint;
        // roughness pop in craters
        roughnessFactor = clamp(roughnessFactor + craterMask * 0.25 * uCrater, 0.0, 1.0);
        vec4 diffuseColor = vec4( diffuse, opacity );
      `);
  };
  return mat;
}

/* ---------- lights (key/fill + rim) ---------- */
scene.add(new THREE.AmbientLight(0x687088, 0.55));

const key = new THREE.PointLight(0x9ecfff, 110, 140);
key.position.set(8, 6, 10); scene.add(key);

const fill = new THREE.PointLight(0xff9ff3, 70, 100);
fill.position.set(-8, -4, -9); scene.add(fill);

/* Rim/back light (edge highlight) */
const rim = new THREE.DirectionalLight(0xa6d2ff, 1.2);
rim.position.set(-2.5, 1.5, -4.5);
scene.add(rim);

/* Subtle sun glow sprite behind the planet */
function makeRadialGlow(size = 30, inner = "rgba(124,247,255,0.35)", outer = "rgba(124,247,255,0)") {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grd.addColorStop(0, inner); grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sprite.scale.set(size, size, 1);
  return sprite;
}
const sunGlow = makeRadialGlow(22);
sunGlow.position.set(-2.2, 1.2, -6);
scene.add(sunGlow);

/* ---------- main planet (with ring) ---------- */
const planetGroup = new THREE.Group(); scene.add(planetGroup);

/* richer physical material for more “depth” */
const planet = new THREE.Mesh(
  new THREE.SphereGeometry(2, 160, 160),
  enhancePlanetMaterial(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0.02,
      clearcoat: 0.12,
      clearcoatRoughness: 0.82,
      sheen: 0.12,
      sheenColor: new THREE.Color(0x4b281a),
      emissive: 0x080302,
      emissiveIntensity: 0.12
    }),
    {
      scale: 1.2,
      disp: 0.014,
      bandFreq: 1.45,
      crater: 0.18,
      colorA: 0x68432f,
      colorB: 0xa0704c
    }
  )
);
planet.castShadow = planet.receiveShadow = true;
planetGroup.add(planet);


/* atmosphere + faint cloud shell */
const atm = new THREE.Mesh(
  new THREE.SphereGeometry(2.12, 128, 128),
  new THREE.MeshBasicMaterial({ color: 0x8e5f45, transparent: true, opacity: 0.08 })
);
planetGroup.add(atm);

const clouds = new THREE.Mesh(
  new THREE.SphereGeometry(2.06, 128, 128),
  new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.22, emissive: 0xffffff, emissiveIntensity: 0.05 })
);
planetGroup.add(clouds);

// draw after planet, don’t punch holes in the depth buffer
planet.renderOrder = 1;

atm.material.transparent = true;
atm.material.depthWrite = false;   // <-- important
atm.material.depthTest = true;
atm.renderOrder = 2;

clouds.material.transparent = true;
clouds.material.depthWrite = false; // <-- important
clouds.material.depthTest = true;
clouds.renderOrder = 3;


/* neon “city arcs” */
const arcMatA = new THREE.LineBasicMaterial({ color: 0xff9ff3, transparent: true, opacity: 0.75 });
const arcMatB = new THREE.LineBasicMaterial({ color: 0x7cf7ff, transparent: true, opacity: 0.75 });
function addArc(lat, lon0, span, mat) {
  const g = new THREE.BufferGeometry(); const pts = [];
  for (let t = 0; t <= 1; t += 0.02) {
    const lon = lon0 + t * span, r = 2.02;
    const x = r * Math.cos(lat) * Math.cos(lon);
    const y = r * Math.sin(lat);
    const z = r * Math.cos(lat) * Math.sin(lon);
    pts.push(new THREE.Vector3(x, y, z));
  }
  g.setFromPoints(pts);
  planetGroup.add(new THREE.Line(g, mat));
}
for (let i = 0; i < 26; i++) {
  addArc((Math.random() * Math.PI) - Math.PI / 2, Math.random() * Math.PI * 2, 0.9 * Math.PI, (i % 2 ? arcMatA : arcMatB));
}

/* aurora ribbon (additive billboard) */
function makeAurora() {
  const c = document.createElement("canvas"); c.width = 256; c.height = 256;
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "rgba(156,255,181,0)");
  grd.addColorStop(0.35, "rgba(156,255,181,0.35)");
  grd.addColorStop(1, "rgba(124,247,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,   // don’t affect depth buffer
    depthTest: true      // but DO get occluded by the planet/ring
  });
  const geo = new THREE.PlaneGeometry(4.8, 2.1, 40, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, Math.sin(x * 1.4) * 0.25);
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.y = Math.PI / 3;
  mesh.position.set(0, 1.6, 0.1);
  return mesh;
}
const aurora = makeAurora();
planetGroup.add(aurora);
aurora.renderOrder = 4;  // draws after planet but still respects depth

/* --------- ring with soft alpha + asteroid belt --------- */
function makeRingTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 512;
  const g = c.getContext("2d");
  const cx = 256, cy = 256, rOuter = 250, rInner = 190;
  // base color gradient
  for (let r = rInner; r <= rOuter; r++) {
    const t = (r - rInner) / (rOuter - rInner);
    g.strokeStyle = `rgba(124,247,255,${0.35 * (1 - Math.abs(t - 0.5) * 2)})`;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  }
  // soft alpha edges
  const alpha = g.createRadialGradient(cx, cy, rInner - 30, cx, cy, rOuter + 30);
  alpha.addColorStop(0, "rgba(255,255,255,1)");
  alpha.addColorStop(0.08, "rgba(255,255,255,0.7)");
  alpha.addColorStop(0.92, "rgba(255,255,255,0.7)");
  alpha.addColorStop(1, "rgba(255,255,255,0)");
  g.globalCompositeOperation = "destination-in";
  g.fillStyle = alpha; g.fillRect(0, 0, 512, 512);

  return new THREE.CanvasTexture(c);
}
const ringTex = makeRingTexture();
ringTex.wrapS = ringTex.wrapT = THREE.ClampToEdgeWrapping;

const ring = new THREE.Mesh(
  new THREE.RingGeometry(2.55, 3.25, 256, 1),
  new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false })
);
ring.rotation.x = Math.PI * 0.53;
ring.rotation.y = Math.PI * 0.18;
ring.position.y = 0.05;
planetGroup.add(ring);

/* asteroid belt (instanced pebbles along ring) */
{
  const pebbleGeo = new THREE.DodecahedronGeometry(0.025, 0);
  const pebbleMat = new THREE.MeshStandardMaterial({ color: 0xcfefff, roughness: 0.9, metalness: 0.05, emissive: 0x7cf7ff, emissiveIntensity: 0.05 });
  const count = 420;
  const inst = new THREE.InstancedMesh(pebbleGeo, pebbleMat, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = THREE.MathUtils.randFloat(2.62, 3.18);
    const y = THREE.MathUtils.randFloatSpread(0.08);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    m.makeRotationFromEuler(new THREE.Euler(Math.random(), Math.random(), Math.random()));
    m.setPosition(new THREE.Vector3(x, y, z));
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.rotation.x = ring.rotation.x;
  inst.rotation.y = ring.rotation.y;
  inst.position.copy(ring.position);
  planetGroup.add(inst);
}

/* ---------- starfield (multi-layer + big twinkle) ---------- */
function starLayer(count, size, minR = 40, maxR = 260) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = THREE.MathUtils.randFloat(minR, maxR);
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(THREE.MathUtils.randFloatSpread(2));
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph);
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9
  });
  return new THREE.Points(geo, mat);
}
const starsNear = starLayer(1400, 0.2, 35, 120);
const starsMid = starLayer(1200, 0.12, 60, 160);
const starsFar = starLayer(1600, 0.07, 140, 320);
scene.add(starsFar, starsMid, starsNear);

/* brighter billboard “big stars” */
function makeBigStar(x, y, z, s = 0.7) {
  const sp = makeRadialGlow(2.2, "rgba(255,255,255,0.95)", "rgba(255,255,255,0)");
  sp.scale.setScalar(s * 4);
  sp.position.set(x, y, z);
  scene.add(sp);
  return sp;
}
const bigStars = [];
for (let i = 0; i < 14; i++) {
  const r = THREE.MathUtils.randFloat(60, 180);
  const th = Math.random() * Math.PI * 2;
  const ph = Math.acos(THREE.MathUtils.randFloatSpread(2));
  bigStars.push(makeBigStar(
    r * Math.sin(ph) * Math.cos(th),
    r * Math.cos(ph),
    r * Math.sin(ph) * Math.sin(th),
    THREE.MathUtils.randFloat(0.8, 1.35)
  ));
}

/* ---------- constellations: subtle sky cartography ---------- */
const constellationGroup = new THREE.Group();
scene.add(constellationGroup);
const constellationSprites = [];
const constellationLabels = [];

function makeConstellationLabel(text, color = '#dff6ff') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '600 44px Georgia';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(124,247,255,0.45)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.42
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(8, 2, 1);
  return sprite;
}

function addConstellation(def) {
  const group = new THREE.Group();
  group.position.set(def.position[0], def.position[1], def.position[2]);
  group.userData.spin = def.spin || 0.00025;
  group.userData.twinkle = def.twinkle || Math.random() * Math.PI * 2;

  const stars = [];
  const starMatColor = new THREE.Color(def.color || 0xbfe7ff);
  const pts = def.points.map(([x, y]) => new THREE.Vector3(x * def.scale, y * def.scale, 0));

  const linePositions = [];
  (def.edges || []).forEach(([a, b]) => {
    const pa = pts[a], pb = pts[b];
    linePositions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
  });

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  const lineMat = new THREE.LineBasicMaterial({
    color: starMatColor.clone().lerp(new THREE.Color(0xffffff), 0.25),
    transparent: true,
    opacity: def.lineOpacity || 0.16,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  group.add(lines);

  pts.forEach((pt, i) => {
    const sprite = makeRadialGlow(2.0, 'rgba(230,245,255,0.98)', 'rgba(255,255,255,0)');
    const size = (def.sizes && def.sizes[i]) || THREE.MathUtils.randFloat(0.42, 0.72);
    sprite.scale.setScalar(size);
    sprite.position.copy(pt);
    sprite.material.opacity = THREE.MathUtils.randFloat(0.58, 0.92);
    sprite.userData.baseOpacity = sprite.material.opacity;
    sprite.userData.phase = Math.random() * Math.PI * 2;
    sprite.userData.label = def.name;
    group.add(sprite);
    stars.push(sprite);
    constellationSprites.push(sprite);
  });

  // Labels intentionally disabled: constellation layer should feel like a subtle
  // LogicWealth-style star network, not giant typography over the hero.

  group.userData.lines = lines;
  group.userData.stars = stars;
  constellationGroup.add(group);
  return group;
}

const constellationDefs = [
  { name: 'Orion', position: [-44, 28, -126], scale: 1.45, color: 0xbfe7ff, labelOffset: [0.2, 4.8], points: [[-3.6, 2.4], [-1.5, 1.7], [0.4, 1.5], [2.8, 2.6], [-0.9, 0.2], [0.1, -0.55], [1.0, -1.3], [-1.4, -2.9], [1.6, -3.2]], edges: [[0, 1], [1, 2], [2, 3], [1, 4], [2, 4], [4, 5], [5, 6], [4, 7], [6, 8], [7, 8]] },
  { name: 'Ursa Major', position: [-74, 40, -150], scale: 1.25, color: 0xd8ebff, labelOffset: [-0.2, 3.9], points: [[-4.5, 1.3], [-2.8, 1.0], [-1.2, 0.6], [0.3, -0.2], [1.8, 0.4], [3.0, 1.0], [4.4, 1.7]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]] },
  { name: 'Cassiopeia', position: [67, 42, -150], scale: 1.12, color: 0xe9d7ff, labelOffset: [0.2, 4.1], points: [[-4.0, 1.2], [-2.1, 2.3], [-0.2, 0.8], [1.8, 2.5], [3.9, 1.1]], edges: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  { name: 'Cygnus', position: [4, 38, -145], scale: 1.3, color: 0xcbe9ff, labelOffset: [0, 5.1], points: [[0, 3.8], [0, 1.3], [0, -1.4], [0, -4.1], [-2.6, 0.5], [2.8, 0.7]], edges: [[0, 1], [1, 2], [2, 3], [1, 4], [1, 5]] },
  { name: 'Lyra', position: [31, 26, -132], scale: 1.02, color: 0xcfd7ff, labelOffset: [0.1, 3.6], points: [[0, 2.2], [-1.6, 0.7], [-0.7, -1.2], [1.0, -1.0], [1.8, 0.8]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [1, 4]] },
  { name: 'Aquila', position: [58, 11, -126], scale: 1.18, color: 0xd5e7ff, labelOffset: [0, 4.1], points: [[0, 2.5], [-2.0, 0.8], [-4.0, -0.4], [0, 0.1], [3.8, 0.9], [6.0, -0.1], [0, -2.2]], edges: [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [3, 6]] },
  { name: 'Taurus', position: [-24, 16, -116], scale: 1.12, color: 0xffe8c4, labelOffset: [0.2, 4.0], points: [[0, 2.8], [-1.2, 1.0], [-3.1, 2.6], [1.4, 1.1], [3.4, 2.7], [-0.2, -0.7], [-1.9, -2.1], [1.7, -2.0]], edges: [[0, 1], [1, 2], [0, 3], [3, 4], [1, 5], [5, 6], [5, 7]] },
  { name: 'Gemini', position: [-4, 22, -120], scale: 1.1, color: 0xd3f0ff, labelOffset: [0.1, 4.3], points: [[-2.0, 3.0], [-2.1, 1.0], [-2.2, -1.6], [1.8, 3.2], [1.9, 1.1], [2.0, -1.9], [0, -0.2]], edges: [[0, 1], [1, 2], [3, 4], [4, 5], [1, 6], [4, 6]] },
  { name: 'Leo', position: [77, 10, -140], scale: 1.12, color: 0xffecc4, labelOffset: [0, 4.0], points: [[-3.8, 2.0], [-2.2, 3.1], [-0.9, 2.1], [0.7, 1.0], [2.2, -0.2], [3.8, -1.0]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]] },
  { name: 'Scorpius', position: [54, -21, -128], scale: 1.2, color: 0xffd7b8, labelOffset: [0.5, 4.3], points: [[-3.2, 2.8], [-1.6, 1.2], [0.0, 0.0], [1.6, -1.2], [3.2, -2.4], [4.6, -3.6], [4.1, -5.2], [2.8, -6.0]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]] },
  { name: 'Sagittarius', position: [8, -28, -116], scale: 1.18, color: 0xffdfb3, labelOffset: [0.2, 4.4], points: [[-2.8, 1.7], [-1.2, 0.6], [0.2, 1.8], [1.7, 0.5], [3.2, 1.7], [-0.2, -0.6], [1.2, -1.9], [2.9, -0.8]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [3, 7]] },
  { name: 'Pegasus', position: [-52, 5, -138], scale: 1.32, color: 0xdde7ff, labelOffset: [0, 4.7], points: [[-2.6, 2.6], [2.2, 2.4], [2.5, -2.1], [-2.1, -2.3], [0.2, 0.0]], edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [2, 4]] },
  { name: 'Andromeda', position: [-16, 39, -152], scale: 1.22, color: 0xf0e0ff, labelOffset: [0.2, 4.4], points: [[-4.0, 1.0], [-2.0, 0.4], [0.0, 0.0], [2.3, -0.8], [4.7, -1.7]], edges: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  { name: 'Canis Major', position: [-56, -16, -118], scale: 1.08, color: 0xe9f5ff, labelOffset: [0.2, 4.0], points: [[-2.7, 2.5], [-1.3, 0.9], [0.1, 1.5], [1.4, 0.4], [2.9, -0.8], [0.0, -1.7], [-1.6, -2.1]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [3, 5], [5, 6], [1, 6]] },
  { name: 'Delphinus', position: [27, 6, -118], scale: 0.98, color: 0xc9ddff, labelOffset: [0.2, 3.6], points: [[0, 2.1], [-1.5, 0.9], [0.1, -0.2], [1.6, 0.8], [0.2, 1.1]], edges: [[0, 1], [1, 2], [2, 3], [3, 0], [1, 4], [4, 3]] },
  { name: 'Pisces', position: [78, -7, -160], scale: 1.05, color: 0xd2deff, labelOffset: [0.3, 4.0], points: [[-3.6, 1.8], [-1.6, 0.6], [0.0, -0.2], [1.6, -1.1], [3.9, -2.0], [0.5, 1.9], [2.5, 2.9]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5], [5, 6]] },
  { name: 'Ursa Minor', position: [-12, 52, -162], scale: 0.98, color: 0xe7f0ff, labelOffset: [0.2, 4.0], points: [[-3.4, 1.9], [-1.8, 1.1], [-0.3, 0.4], [1.2, -0.1], [2.8, -0.8], [4.2, -1.4], [5.5, -0.6]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]] },
  { name: 'Draco', position: [24, 51, -170], scale: 0.98, color: 0xe1d6ff, labelOffset: [0.2, 4.2], points: [[-5.0, 1.3], [-3.4, 2.0], [-2.0, 1.5], [-0.9, 0.6], [0.6, 0.8], [2.0, 0.1], [3.2, -0.9], [4.6, -1.7]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]] }
];

const constellations = constellationDefs.map(addConstellation);

/* -------- cratered spherical moons (fixed) -------- */
const satellites = new THREE.Group(); scene.add(satellites);

// lightweight 3D noise for craters
const noise = `
float hash(vec3 p){
  p = fract(p * 0.3183099 + .1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float fbm(vec3 p){
  float v = 0.0;
  v += 0.5 * hash(p);
  v += 0.25 * hash(p * 2.1);
  v += 0.125 * hash(p * 4.3);
  v += 0.0625 * hash(p * 8.7);
  return v;
}
`;

function makeCrateredMoonMaterial(baseColor) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(baseColor) },
      uTime: { value: 0.0 }
    },
    vertexShader: `
      varying vec3 vPos;
      void main(){
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vPos;
      uniform vec3 uColor;
      uniform float uTime;
      ${noise}
      void main(){
        vec3 p = normalize(vPos) * 3.0;
        float n = fbm(p + vec3(uTime*0.1));
        float crater = smoothstep(0.2,0.8,abs(n));
        vec3 c = mix(uColor*0.7, uColor*1.2, crater);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    lights: false
  });
}

function makeMoon(color, radius, speed, label, href, size = 0.28) {
  const g = new THREE.Group();

  const mat = makeCrateredMoonMaterial(color);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(size, 64, 64), mat);
  g.add(sphere);

  // subtle halo sprite
  const haloCanvas = document.createElement("canvas");
  haloCanvas.width = haloCanvas.height = 256;
  const ctx = haloCanvas.getContext("2d");
  const grad = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
  grad.addColorStop(0, "rgba(255,255,255,0.4)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 256, 256);
  const haloTex = new THREE.CanvasTexture(haloCanvas);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
  }));
  halo.scale.set(1.2, 1.2, 1);
  g.add(halo);

  g.userData = { radius, angle: Math.random() * Math.PI * 2, speed, label, href, mat };
  satellites.add(g);
  return g;
}

// make the three moons
const satProjects = makeMoon(0x7cf7ff, 3.6, 0.62, "Projects", "#projects");
const satAbout = makeMoon(0xff9ff3, 4.6, 0.44, "About", "#about");
const satResume = makeMoon(0x9cffb5, 5.4, 0.30, "Resume", "Resume.pdf");


/* DOM labels added #labels */
const labelsRoot = document.getElementById("labels");
const labelFor = new Map();
if (labelsRoot) {
  [satProjects, satAbout, satResume].forEach(g => {
    const d = document.createElement("div"); d.className = "label";
    const { label, href } = g.userData;
    d.innerHTML = href.endsWith(".pdf") ? `<a href="${href}" target="_blank" rel="noopener">${label} ↗</a>` : `<a href="${href}">${label}</a>`;
    labelsRoot.appendChild(d); labelFor.set(g, d);
  });
}

/* ---------- distant secondary planet (parallax depth) ---------- */
const farGroup = new THREE.Group();
farGroup.position.set(-12, 6, -24); scene.add(farGroup);

const farPlanet = new THREE.Mesh(
  new THREE.SphereGeometry(1.25, 96, 96),
  new THREE.MeshPhysicalMaterial({
    color: 0x142438,
    roughness: 0.5,
    metalness: 0.1,
    clearcoat: 0.5,
    clearcoatRoughness: 0.4,
    emissive: 0x081426,
    emissiveIntensity: 0.25
  })
);
farGroup.add(farPlanet);

const farAtm = new THREE.Mesh(
  new THREE.SphereGeometry(1.31, 64, 64),
  new THREE.MeshBasicMaterial({ color: 0x9abfff, transparent: true, opacity: 0.15 })
);
farGroup.add(farAtm);

/* small tilted ring for the far planet */
const farRing = new THREE.Mesh(
  new THREE.RingGeometry(1.5, 1.85, 160, 1),
  new THREE.MeshBasicMaterial({ map: makeRingTexture(), transparent: true, depthWrite: false })
);
farRing.rotation.x = Math.PI * 0.72;
farRing.rotation.y = Math.PI * 0.18;
farGroup.add(farRing);

/* ---------- raycaster for clicks ---------- */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
window.addEventListener("pointermove", (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
});
renderer.domElement.addEventListener("click", (e) => {
  e.stopPropagation();
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(satellites.children, true);
  if (hits[0]) {
    let g = hits[0].object;
    while (g.parent && !g.userData.href) g = g.parent;
    const { href } = g.userData;
    if (href.endsWith(".pdf")) window.open(href, "_blank", "noopener");
    else window.location.hash = href;
  }
});

/* ---------- responsive ---------- */
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

(() => {
  const canvas = document.getElementById('constellationCanvas');
  const ctx = canvas.getContext('2d');

  let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  const isLight = () =>
    document.documentElement.classList.contains('light') ||
    document.documentElement.dataset.theme === 'light';

  const NODE_COUNT = 70;
  const nodes = [];

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function makeNode() {
    const depth = rand(0.4, 1.0); // pseudo-parallax
    return {
      x: rand(0, w),
      y: rand(0, h),
      vx: rand(-0.08, 0.08) * depth,
      vy: rand(-0.05, 0.05) * depth,
      r: rand(1.2, 2.8) * depth,
      depth,
      tw: rand(0, Math.PI * 2)
    };
  }

  function init() {
    nodes.length = 0;
    for (let i = 0; i < NODE_COUNT; i++) nodes.push(makeNode());
  }
  init();

  let mouse = { x: w / 2, y: h / 2, active: false };

  window.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  });

  window.addEventListener('mouseleave', () => {
    mouse.active = false;
  });

  function draw() {
    ctx.clearRect(0, 0, w, h);

    const light = isLight();

    const lineColor = light
      ? 'rgba(80, 88, 100, 0.22)'
      : 'rgba(120, 190, 255, 0.12)';

    const nodeColor = light
      ? 'rgba(110, 110, 110, 0.75)'
      : 'rgba(220, 240, 255, 0.85)';

    const glowColor = light
      ? 'rgba(255,255,255,0.18)'
      : 'rgba(120,200,255,0.12)';

    // move nodes
    for (const n of nodes) {
      n.x += n.vx;
      n.y += n.vy;
      n.tw += 0.01 * n.depth;

      // gentle mouse parallax
      if (mouse.active) {
        const dx = (mouse.x - w / 2) * 0.00015 * n.depth;
        const dy = (mouse.y - h / 2) * 0.00015 * n.depth;
        n.x += dx;
        n.y += dy;
      }

      if (n.x < -20) n.x = w + 20;
      if (n.x > w + 20) n.x = -20;
      if (n.y < -20) n.y = h + 20;
      if (n.y > h + 20) n.y = -20;
    }

    // draw lines
    const maxDist = light ? 170 : 190;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < maxDist) {
          const alpha = (1 - dist / maxDist) * (light ? 0.7 : 1);
          ctx.strokeStyle = lineColor.replace(/[\d.]+\)\s*$/, `${0.22 * alpha})`);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // draw nodes
    for (const n of nodes) {
      const twinkle = 0.75 + Math.sin(n.tw) * 0.2;

      // soft glow
      ctx.beginPath();
      ctx.fillStyle = glowColor;
      ctx.arc(n.x, n.y, n.r * 3.2, 0, Math.PI * 2);
      ctx.fill();

      // core point
      ctx.beginPath();
      ctx.fillStyle = nodeColor;
      ctx.arc(n.x, n.y, n.r * twinkle, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }

  draw();
})();

/* ---------- animate ---------- */
let t = 0;
function animate() {
  requestAnimationFrame(animate);
  t += 0.005;

  // main planet motion
  planet.rotation.y += 0.0012;
  clouds.rotation.y += 0.0018;
  planetGroup.rotation.y += 0.0009;
  atm.material.opacity = 0.09 + Math.sin(t * 2) * 0.012;
  sunGlow.material.opacity = 0.18 + Math.sin(t * 1.3) * 0.04;
  aurora.position.y = 1.55 + Math.sin(t * 1.5) * 0.05;

  // ring slow precession
  ring.rotation.z += 0.0006;

  // asteroid belt subtle shimmer
  sunGlow.material.opacity = 0.3 + Math.sin(t * 1.3) * 0.05;

  // far planet slow parallax spin
  farGroup.rotation.y -= 0.0006;
  farRing.rotation.z -= 0.0003;

  // star drift + stronger twinkle
  starsFar.rotation.y -= 0.0001;
  starsMid.rotation.y -= 0.00025;
  starsNear.rotation.y -= 0.00045;
  const tw = 0.2 * (Math.sin(t * 5) * 0.5 + 0.5);
  starsNear.material.opacity = 0.85 + tw * 0.2;
  starsMid.material.opacity = 0.75 + Math.sin(t * 3 + 1.2) * 0.18;
  starsFar.material.opacity = 0.65 + Math.sin(t * 2.1 + 2.3) * 0.15;
  bigStars.forEach((s, i) => { s.material.opacity = 0.55 + Math.sin(t * 3 + i) * 0.4; });

  // satellites
  satellites.children.forEach((g) => {
    const u = g.userData;
    u.angle += 0.01 * u.speed;
    const r = u.radius;
    g.position.set(Math.cos(u.angle) * r, Math.sin(u.angle * 1.15) * 0.45, Math.sin(u.angle) * r);
    g.rotation.y += 0.01;
  });

  // DOM labels (if enabled)
  if (labelsRoot) {
    const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight;
    satellites.children.forEach((g) => {
      const d = labelFor.get(g); if (!d) return;
      const p = g.position.clone().project(camera);
      d.style.display = p.z > 1 ? "none" : "block";
      d.style.left = `${(p.x * 0.5 + 0.5) * W}px`;
      d.style.top = `${(-p.y * 0.5 + 0.5) * H}px`;
    });
  }
  // advance procedural time for all noisy materials
  for (const u of timeUniforms) {
    if (u.uTime) u.uTime.value += 0.5 * 0.016; // ~0.5x speed, stable across frames
  }
  // animate moon shaders’ time for subtle crater shimmer
  satellites.children.forEach(m => {
    if (m.userData.mat) m.userData.mat.uniforms.uTime.value += 0.005;
  });
  // animate planet terrain subtly
  for (const u of planetUniforms) {
    if (u.pTime) u.pTime.value += 0.016 * 0.5; // gentle 0.5x speed
  }

  // constellations: very subtle twinkle and label breathing
  constellations.forEach((g, i) => {
    g.lookAt(camera.position);
    g.rotation.z += g.userData.spin;
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.7 + g.userData.twinkle + i * 0.35);
    if (g.userData.lines?.material) g.userData.lines.material.opacity = 0.12 + pulse * 0.08;
    (g.userData.stars || []).forEach((s, j) => {
      s.material.opacity = s.userData.baseOpacity * (0.82 + 0.3 * Math.sin(t * 2.8 + s.userData.phase + j * 0.11));
    });
  });
  // constellation labels are disabled for a cleaner network-style sky.

  controls.update();
  renderer.render(scene, camera);
}

(() => {
  const canvas = document.getElementById('constellation');
  if (!canvas) return;

  const ctx = canvas.getContext('2d', { alpha: true });

  let width = 0;
  let height = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  let nodes = [];
  let mouse = { x: -9999, y: -9999, active: false };

  function isLightMode() {
    const root = document.documentElement;
    return root.classList.contains('light') || root.dataset.theme === 'light';
  }

  function getPalette() {
    if (isLightMode()) {
      return {
        bgGlow1: 'rgba(120, 140, 170, 0.035)',
        bgGlow2: 'rgba(70, 90, 120, 0.020)',
        line: 'rgba(70, 85, 110, 0.18)',
        lineStrong: 'rgba(60, 72, 92, 0.28)',
        node: 'rgba(110, 120, 135, 0.82)',
        nodeGlow: 'rgba(180, 190, 205, 0.18)'
      };
    }

    return {
      bgGlow1: 'rgba(90, 170, 255, 0.06)',
      bgGlow2: 'rgba(130, 110, 255, 0.04)',
      line: 'rgba(110, 170, 255, 0.16)',
      lineStrong: 'rgba(160, 210, 255, 0.26)',
      node: 'rgba(235, 242, 255, 0.88)',
      nodeGlow: 'rgba(140, 210, 255, 0.22)'
    };
  }

  function resizeConstellation() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    createNodes();
  }

  function createNodes() {
    const count = Math.max(45, Math.min(110, Math.floor(width / 18)));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
      r: Math.random() * 1.8 + 1.2,
      tw: Math.random() * Math.PI * 2,
      mass: Math.random() * 0.6 + 0.7
    }));
  }

  function drawBackgroundGlow(palette) {
    const g = ctx.createRadialGradient(
      width * 0.72, height * 0.22, 0,
      width * 0.72, height * 0.22, Math.max(width, height) * 0.65
    );
    g.addColorStop(0, palette.bgGlow1);
    g.addColorStop(0.45, palette.bgGlow2);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  function stepNodes() {
    for (const n of nodes) {
      n.x += n.vx * n.mass;
      n.y += n.vy * n.mass;
      n.tw += 0.015;

      if (n.x < -20) n.x = width + 20;
      if (n.x > width + 20) n.x = -20;
      if (n.y < -20) n.y = height + 20;
      if (n.y > height + 20) n.y = -20;

      if (mouse.active) {
        const dx = mouse.x - n.x;
        const dy = mouse.y - n.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 160 && dist > 0.001) {
          const pull = (1 - dist / 160) * 0.0025;
          n.vx += dx * pull * 0.01;
          n.vy += dy * pull * 0.01;
        }
      }

      n.vx *= 0.995;
      n.vy *= 0.995;

      n.vx = Math.max(-0.22, Math.min(0.22, n.vx));
      n.vy = Math.max(-0.22, Math.min(0.22, n.vy));
    }
  }

  function drawConnections(palette) {
    const maxDist = isLightMode() ? 145 : 160;

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];

      // connect only to a few nearest nodes for a cleaner "constellation" look
      const nearby = [];

      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy);

        if (d < maxDist) {
          nearby.push({ b, d });
        }
      }

      nearby.sort((p, q) => p.d - q.d);

      for (const { b, d } of nearby.slice(0, 3)) {
        const alpha = Math.max(0, 1 - d / maxDist);
        const strong = d < maxDist * 0.55;

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineWidth = strong ? 1.1 : 0.8;
        ctx.strokeStyle = strong
          ? palette.lineStrong.replace(/[\d.]+\)$/, `${(alpha * 0.9).toFixed(3)})`)
          : palette.line.replace(/[\d.]+\)$/, `${(alpha * 0.8).toFixed(3)})`);
        ctx.stroke();
      }
    }
  }

  function drawNodes(palette) {
    for (const n of nodes) {
      const pulse = 0.82 + Math.sin(n.tw) * 0.18;
      const rr = n.r * pulse;

      // soft glow
      ctx.beginPath();
      ctx.arc(n.x, n.y, rr * 3.2, 0, Math.PI * 2);
      ctx.fillStyle = palette.nodeGlow;
      ctx.fill();

      // node
      ctx.beginPath();
      ctx.arc(n.x, n.y, rr, 0, Math.PI * 2);
      ctx.fillStyle = palette.node;
      ctx.fill();
    }
  }

  function tick() {
    const palette = getPalette();

    ctx.clearRect(0, 0, width, height);
    drawBackgroundGlow(palette);
    stepNodes();
    drawConnections(palette);
    drawNodes(palette);

    requestAnimationFrame(tick);
  }

  window.addEventListener('resize', resizeConstellation);

  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  });

  window.addEventListener('mouseleave', () => {
    mouse.active = false;
    mouse.x = -9999;
    mouse.y = -9999;
  });

  window.addEventListener('portfolio-theme-change', () => {
    // no full reset needed, but this ensures palette swaps cleanly
    createNodes();
  });

  resizeConstellation();
  tick();
})();

animate();

/* footer year */
const yEl = document.getElementById("year");
if (yEl) yEl.textContent = new Date().getFullYear();