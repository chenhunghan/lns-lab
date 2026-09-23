// The diorama: a Mac (host slab) carrying one glass microVM, the vsock and virtio pipes between them,
// the NAT hop out, and a little internet of destinations. Everything the chapters animate is built here.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {HorizontalTiltShiftShader} from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import {VerticalTiltShiftShader} from 'three/addons/shaders/VerticalTiltShiftShader.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {CSS2DRenderer, CSS2DObject} from 'three/addons/renderers/CSS2DRenderer.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {makeClawd} from './clawd.js?v=3';

export {THREE, CSS2DObject};
export const C = {
  // three families: cyan = lns itself, orange = the workload, ice = your files and data;
  // green / red / yellow only ever mean allow / deny / ask-or-secret.
  cyan:'#7fe3ff', orange:'#e8875f', ice:'#b9c8e8', green:'#5ee89a', red:'#ff6b76', amber:'#ffc857', gold:'#ffc857',
  violet:'#8d9cc4', pink:'#b9c8e8', teal:'#b9c8e8', blue:'#b9c8e8', lime:'#b9c8e8', white:'#eef2fa', grey:'#8b94ad',
};
export const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ─────────────────────────────────────────────────────────────── renderer, camera, post
const host = document.getElementById('world');
export const scene = new THREE.Scene();
scene.background = new THREE.Color('#080b14');
scene.fog = new THREE.FogExp2('#0a0e19', 0.0082);

export const camera = new THREE.PerspectiveCamera(30, 1, 0.3, 400);
export const renderer = new THREE.WebGLRenderer({antialias: false, powerPreference: 'high-performance', stencil: false});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
host.appendChild(renderer.domElement);

export const labelRenderer = new CSS2DRenderer({element: document.getElementById('labels')});

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.32;

export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 5;
controls.maxDistance = 80;
controls.maxPolarAngle = Math.PI * 0.47;
controls.screenSpacePanning = true;

const rt = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, samples: 4});
export const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
export const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.55, 0.8);
composer.addPass(bloom);
export const tiltH = new ShaderPass(HorizontalTiltShiftShader);
export const tiltV = new ShaderPass(VerticalTiltShiftShader);
tiltH.enabled = tiltV.enabled = false;
tiltH.uniforms.r.value = tiltV.uniforms.r.value = 0.52;
composer.addPass(tiltH);
composer.addPass(tiltV);
composer.addPass(new OutputPass());

export function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  camera.aspect = w / h;
  if (w < 900) camera.setViewOffset(w, h, 0, -h * 0.2, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.setSize(w, h);
  labelRenderer.setSize(w, h);
  tiltH.uniforms.h.value = 2.4 / w;
  tiltV.uniforms.v.value = 2.4 / h;
}

// ─────────────────────────────────────────────────────────────── lights
scene.add(new THREE.HemisphereLight('#a9c2ff', '#0b0d14', 1.05));
const hostLamp = new THREE.PointLight('#cfe0ff', 60, 26, 1.4);
hostLamp.position.set(-11.5, 7.5, 1.5);
scene.add(hostLamp);
const netLamp = new THREE.PointLight('#ffd8b0', 40, 22, 1.4);
netLamp.position.set(14, 7, 1);
scene.add(netLamp);
const sun = new THREE.DirectionalLight('#dce7ff', 1.55);
sun.position.set(-12, 26, 16);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {left: -30, right: 30, top: 22, bottom: -22, near: 1, far: 80});
sun.shadow.bias = -0.0004;
sun.shadow.radius = 5;
scene.add(sun);
const rim = new THREE.DirectionalLight('#ffb98a', 0.45);
rim.position.set(20, 8, -14);
scene.add(rim);
export const vmLight = new THREE.PointLight(C.cyan, 9, 13, 1.6);
vmLight.position.set(0, 4.2, 0.5);
scene.add(vmLight);
export const coreLight = new THREE.PointLight(C.orange, 10, 7, 1.8);
scene.add(coreLight);

// ─────────────────────────────────────────────────────────────── material helpers
export const time = {value: 0};
const std = (color, o = {}) => new THREE.MeshStandardMaterial({color, roughness: 0.55, metalness: 0.15, ...o});
export const glow = (hex, k = 2.2) => new THREE.MeshBasicMaterial({color: new THREE.Color(hex).multiplyScalar(k), toneMapped: false});
export const emi = (hex, i = 1.2, base = '#141a28') => std(base, {emissive: new THREE.Color(hex), emissiveIntensity: i});

export function fresnelMat(hex, opacity = 1) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {uC: {value: new THREE.Color(hex)}, uO: {value: opacity}, uK: {value: 1}, uT: time},
    vertexShader: `varying vec3 vN; varying vec3 vW;
      void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uC; uniform float uO; uniform float uK; uniform float uT; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 v = normalize(cameraPosition - vW);
        float f = pow(1. - abs(dot(normalize(vN), v)), 3.);
        float scan = smoothstep(.985, 1., sin(vW.y*7. - uT*1.3)*.5+.5);
        float a = (.03 + f*.42 + scan*.06) * uO * uK;
        gl_FragColor = vec4(uC*(.35 + f*1.5 + scan*1.2), a);
      }`,
  });
}

export function flowMat(hex, len, base = 0.14) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {uC: {value: new THREE.Color(hex)}, uT: time, uA: {value: 0}, uB: {value: base}, uD: {value: Math.max(2, len * 0.9)}, uDir: {value: 1}, uS: {value: 1}},
    vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 uC; uniform float uT; uniform float uA; uniform float uB; uniform float uD; uniform float uDir; uniform float uS; varying vec2 vU;
      void main(){
        float d = fract(vU.x*uD - uT*1.6*uDir*uS);
        float dash = smoothstep(0.,.12,d)*smoothstep(.5,.26,d);
        float edge = pow(abs(vU.y-.5)*2., 2.);
        float a = (uB*(.55+edge*.8) + uA*dash) * uS;
        gl_FragColor = vec4(uC*(.7 + uA*1.4), a);
      }`,
  });
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ─────────────────────────────────────────────────────────────── parts registry (hover, focus, labels)
export const parts = {};
export const pickables = [];
export function part(key, obj, info) {
  parts[key] = {key, obj, ...info, labels: []};
  obj.traverse(o => { if (o.isMesh) { o.userData.part = key; pickables.push(o); } });
  return parts[key];
}

export function label(title, {kicker = '', color = C.cyan, cls = '', at = V(0, 0, 0), parent = scene, part: pk, chapter} = {}) {
  const el = document.createElement('div');
  el.className = 'lb ' + cls;
  el.style.setProperty('--c', color);
  el.innerHTML = (kicker ? `<i>${kicker}</i>` : '') + `<b>${title}</b>`;
  const o = new CSS2DObject(el);
  o.position.copy(at);
  o.center.set(0.5, 1);
  parent.add(o);
  const L = {el, o, part: pk, chapter, set(t, k) { el.innerHTML = (k ?? kicker ? `<i>${k ?? kicker}</i>` : '') + `<b>${t}</b>`; }};
  if (pk && parts[pk]) parts[pk].labels.push(L);
  allLabels.push(L);
  return L;
}
export const allLabels = [];

// ─────────────────────────────────────────────────────────────── ground
{
  const g = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), std('#0d111c', {roughness: 0.9, metalness: 0}));
  g.rotation.x = -Math.PI / 2;
  g.position.y = -0.52;
  g.receiveShadow = true;
  scene.add(g);
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {uT: time},
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float uT; varying vec3 vW;
      float line(float x, float w){ float d = abs(fract(x-.5)-.5); return 1.-smoothstep(0., w, d); }
      void main(){
        vec2 p = vW.xz;
        float g = max(line(p.x/2., .012), line(p.y/2., .012))*.5 + max(line(p.x/10., .004), line(p.y/10., .004))*.6;
        float fall = exp(-length(p - vec2(1.,0.))*.045);
        gl_FragColor = vec4(vec3(.35,.55,.95)*g, g*.16*fall);
      }`,
  }));
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = -0.5;
  scene.add(grid);
}

// ─────────────────────────────────────────────────────────────── the host slab (your Mac)
export const HOST_TOP = 0.5;
{
  const slab = new THREE.Mesh(new RoundedBoxGeometry(29, 1, 17, 4, 0.45), std('#212a3c', {roughness: 0.42, metalness: 0.3}));
  slab.position.set(-4.5, 0, 0);
  slab.castShadow = slab.receiveShadow = true;
  scene.add(slab);
  const inset = new THREE.Mesh(new RoundedBoxGeometry(28.2, 0.04, 16.2, 2, 0.02), std('#1c2536', {roughness: 0.62, metalness: 0.1}));
  inset.position.set(-4.5, 0.51, 0);
  inset.receiveShadow = true;
  scene.add(inset);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(29.02, 0.05, 17.02), glow('#39507a', 0.9));
  strip.position.set(-4.5, 0.26, 0);
  scene.add(strip);
  part('host', slab, {title: 'Your Mac — the host', kicker: 'host', color: C.white, chapter: 'overview',
    text: 'Everything here runs locally. The host keeps the CLI, the lns-service background service, your project, named volumes, caches and connector secrets. The workload lives only inside the glass microVM.'});
  label('your Mac · host', {kicker: 'macOS · Apple Silicon', color: C.white, at: V(-17.4, 0.6, 7.6), part: 'host'});
}

// ─────────────────────────────────────────────────────────────── the microVM
export const VM = {x: 0, z: 0, w: 9.6, h: 5.4, d: 6.8, floor: 0.8};
VM.top = VM.floor + VM.h; VM.cy = VM.floor + VM.h / 2;
export const vm = new THREE.Group();
scene.add(vm);
export const vmInner = new THREE.Group();   // everything that boots
vm.add(vmInner);
{
  const ped = new THREE.Mesh(new RoundedBoxGeometry(VM.w + 0.9, 0.32, VM.d + 0.9, 3, 0.14), std('#161d2c', {roughness: 0.35, metalness: 0.5}));
  ped.position.y = 0.66;
  ped.castShadow = ped.receiveShadow = true;
  vm.add(ped);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(VM.w + 0.92, 0.03, VM.d + 0.92), glow(C.cyan, 1.4));
  lip.position.y = 0.8;
  vm.add(lip);
  part('pedestal', ped, {title: 'Hypervisor', kicker: 'Virtualization.framework', color: C.cyan, chapter: 'supervisor',
    text: 'On macOS the microVM is booted by Apple’s Virtualization.framework (on Linux, KVM with Cloud Hypervisor). It hands the guest a small set of virtio devices: one NIC, one vsock, virtio-fs shares and block disks.'});
}
export const shellMat = fresnelMat(C.cyan, 1);
export const shell = new THREE.Mesh(new RoundedBoxGeometry(VM.w, VM.h, VM.d, 4, 0.28), shellMat);
shell.position.y = VM.cy;
shell.renderOrder = 10;
vm.add(shell);
export const shellEdges = new THREE.Group();
{
  const lm = new THREE.LineBasicMaterial({color: new THREE.Color(C.cyan).multiplyScalar(1.1), transparent: true, opacity: 0.22, toneMapped: false});
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(VM.w - 0.1, VM.h - 0.1, VM.d - 0.1)), lm);
  shellEdges.add(e);
  const bm = new THREE.LineBasicMaterial({color: new THREE.Color(C.cyan).multiplyScalar(2.6), toneMapped: false, transparent: true, opacity: 1});
  const pts = [], hw = VM.w / 2 - 0.05, hh = VM.h / 2 - 0.05, hd = VM.d / 2 - 0.05, k = 0.7;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const c = V(sx * hw, sy * hh, sz * hd);
    pts.push(c, V(c.x - sx * k, c.y, c.z), c, V(c.x, c.y - sy * k, c.z), c, V(c.x, c.y, c.z - sz * k));
  }
  shellEdges.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), bm));
  shellEdges.position.y = VM.cy;
  shellEdges.userData.mats = [lm, bm];
  vm.add(shellEdges);
  part('shell', shell, {title: 'The microVM', kicker: 'isolation boundary', color: C.cyan, chapter: 'overview',
    text: 'A real virtual machine with its own Linux kernel, not a container sharing yours. The workload can only see what was mounted in, and can only talk out through the supervisor’s proxy.'});
}
export const vmLabel = label('microVM · run “agent”', {kicker: 'guest · 2 vCPU · 2 GiB · 10Gi disk', color: C.cyan, at: V(-VM.w / 2 + 0.2, VM.top + 0.35, VM.d / 2), part: 'shell'});

// Layer stack: kernel, image layers (composefs lower), /.lens runtime layer, writable upper.
export const layers = {};
{
  const W = VM.w - 0.9, D = VM.d - 0.9;
  const kern = new THREE.Mesh(new RoundedBoxGeometry(W + 0.3, 0.22, D + 0.3, 2, 0.06), emi('#46609a', 0.45, '#10151f'));
  kern.position.y = 0.97; kern.castShadow = kern.receiveShadow = true;
  vmInner.add(kern);
  layers.kernel = kern;
  part('kernel', kern, {title: 'Guest Linux kernel', kicker: 'kernel 6.18 · its own', color: C.blue, chapter: 'supervisor',
    text: 'The VM boots its own kernel (a pinned Kata build). A workload that exploits a kernel bug is exploiting the guest’s kernel, not your Mac’s.'});
  label('guest kernel', {kicker: 'linux 6.18', color: C.blue, cls: 'sm', at: V(W / 2 - 0.6, 1.02, D / 2 + 0.2), parent: vmInner, part: 'kernel'});

  const cols = ['#34425f', '#3f4f70', '#4b5d82'];
  layers.image = [];
  cols.forEach((c, i) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(W, 0.12, D, 2, 0.04), emi(c, 0.35, '#151a26'));
    m.position.y = 1.18 + i * 0.16;
    m.castShadow = m.receiveShadow = true;
    vmInner.add(m);
    layers.image.push(m);
    part('image' + i, m, {title: `Image layer ${i + 1} of 3`, kicker: 'composefs · read-only', color: C.violet, chapter: 'mounts',
      text: 'The OCI image’s layers, unpacked once into the host content store and shared into the guest read-only (virtio-fs “lns-content”). A composefs descriptor (EROFS, checked by SHA-256) says which file is which.'});
  });
  label('image layers', {kicker: 'composefs · read-only', color: C.violet, cls: 'sm', at: V(-W / 2 + 0.2, 1.52, D / 2 + 0.05), parent: vmInner, part: 'image2'});

  const rtl = new THREE.Mesh(new RoundedBoxGeometry(W, 0.08, D, 2, 0.03), emi(C.cyan, 0.5, '#0d2230'));
  rtl.position.y = 1.66; rtl.receiveShadow = true;
  vmInner.add(rtl);
  layers.runtime = rtl;
  part('runtime', rtl, {title: 'The /.lens runtime layer', kicker: 'added by lns · read-only', color: C.cyan, chapter: 'filesets',
    text: 'One extra composefs layer lns adds on top of the image: the static lns-supervisor, the nft binary, provisioned tools, the proxy CA and every fileset. It is read-only to the workload.'});
  label('/.lens runtime layer', {kicker: 'supervisor · tools · filesets', color: C.cyan, cls: 'sm', at: V(0.4, 1.7, D / 2 + 0.05), parent: vmInner, part: 'runtime'});

  const upMat = new THREE.MeshStandardMaterial({color: '#2e2418', emissive: new THREE.Color(C.orange), emissiveIntensity: 0.22, transparent: true, opacity: 0.78, roughness: 0.4});
  const up = new THREE.Mesh(new RoundedBoxGeometry(W, 0.1, D, 2, 0.04), upMat);
  up.position.y = 1.8; up.receiveShadow = true;
  vmInner.add(up);
  layers.upper = up;
  part('upper', up, {title: 'The writable layer', kicker: 'overlay upper · upper.img', color: C.orange, chapter: 'volumes',
    text: 'Every write that isn’t to a mount lands here: an ext4 image (~/.lns/runs/<id>/upper.img, 10Gi by default) as the overlay’s upper directory. It survives lns stop/start and is deleted by lns rm.'});
  label('writable layer', {kicker: 'overlay upper · /dev/vda', color: C.orange, cls: 'sm', at: V(W / 2 - 1.1, 1.85, -D / 2 + 0.1), parent: vmInner, part: 'upper'});
}
export const SURF = 1.86;   // top of the writable layer, where the workload's filesystem "stands"

// The workload — a little Claude Code — and the supervisor ring around it.
export const core = new THREE.Group();
core.position.set(-0.7, SURF + 0.72, 0.3);
vmInner.add(core);
export const clawd = makeClawd(core);
part('workload', core, {title: 'Claude Code — the workload', kicker: 'sh -c claude · uid 65534', color: C.orange, chapter: 'supervisor',
  text: 'The demo agent: Claude Code, running as the unprivileged “sandbox” user. Watch its face. Every file it touches and every request it makes goes through the mounts and the proxy gate you see here. CAP_NET_ADMIN and CAP_NET_RAW are dropped even for root, so it cannot rewrite the firewall.'});
label('Claude Code', {kicker: 'the workload · uid sandbox', color: C.orange, at: V(-1.05, 0.95, 0), parent: core, part: 'workload'});
export const ring = new THREE.Group();
ring.position.copy(core.position);
vmInner.add(ring);
{
  const tm = glow(C.cyan, 2.0);
  const t1 = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.035, 10, 120), tm);
  t1.rotation.x = Math.PI / 2;
  const t2 = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.018, 8, 120), glow(C.cyan, 1.2));
  t2.rotation.x = Math.PI / 2 + 0.25;
  ring.add(t1, t2);
  for (let i = 0; i < 6; i++) {
    const n = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), glow(C.cyan, 2.6));
    const a = i / 6 * Math.PI * 2;
    n.position.set(Math.cos(a) * 1.25, 0, Math.sin(a) * 1.25);
    t1.add(n); n.rotation.set(0, 0, 0);
    n.position.set(Math.cos(a) * 1.25, Math.sin(a) * 1.25, 0);
  }
  ring.userData.t1 = t1; ring.userData.t2 = t2;
  const hit = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.16, 6, 40), new THREE.MeshBasicMaterial({visible: false}));
  hit.rotation.x = Math.PI / 2;
  ring.add(hit);
  part('supervisor', ring, {title: 'lns-supervisor', kicker: 'root · in the guest', color: C.cyan, chapter: 'supervisor',
    text: 'A static binary lns puts in /.lens/bin. As root it installs the nftables cage, starts the proxy and DNS stub, runs pre-start scripts, then drops privileges and starts your workload, and it keeps a WebSocket to the host over vsock 1024.'});
  label('lns-supervisor', {kicker: 'lifecycle · privilege drop', color: C.cyan, cls: 'sm', at: V(-1.45, 0.1, 0.9), parent: ring, part: 'supervisor'});
}

// PID 1 → broker → supervisor chain at the back of the VM.
export const procs = {};
{
  const defs = [
    ['init', 'lns-init', 'PID 1', V(-3.6, 2.35, -2.5), 'Static-musl PID 1. Verifies the composefs descriptor, mounts the overlay root, volumes, binds (with excludes masked) and tmpfs, hides the boot token from /proc/cmdline, then chroots and execs the broker.'],
    ['broker', 'session-broker', 'vsock 1029 · 1030', V(-2.2, 2.35, -2.5), 'Brings up eth0 with DHCP, owns PTYs, and serves sessions on vsock 1029 (the first is the run itself, later ones are lns exec). Port forwards arrive on vsock 1030. When the run ends it syncs, releases volumes and powers the VM off.'],
  ];
  const lm = new THREE.LineBasicMaterial({color: new THREE.Color(C.cyan).multiplyScalar(1.4), transparent: true, opacity: 0.55, toneMapped: false});
  let prev = null;
  for (const [k, t, kick, p, text] of defs) {
    const g = new THREE.Group();
    g.position.copy(p);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.34, 4, 12), emi(C.cyan, 1.1, '#0d1c28'));
    m.castShadow = true;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.08, 20), std('#1b2436', {metalness: 0.6, roughness: 0.3}));
    cap.position.y = -0.46;
    g.add(m, cap);
    vmInner.add(g);
    procs[k] = g;
    g.userData.mat = m.material;
    part(k, g, {title: t, kicker: kick, color: C.cyan, chapter: 'supervisor', text});
    label(t, {kicker: kick, color: C.cyan, cls: 'sm', at: V(0, 0.55, 0), parent: g, part: k});
    if (prev) vmInner.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([prev, p]), lm));
    prev = p;
  }
  vmInner.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([prev, V(-1.6, 3.0, -0.7), V(core.position.x - 0.8, core.position.y, core.position.z - 0.9)]), lm));
}

// The proxy gate: nftables redirects every workload socket here. Lives inside the VM, owned by the supervisor.
export const GATE = V(3.05, 3.3, 0);
export const gate = new THREE.Group();
gate.position.set(GATE.x, 0, 0);
vmInner.add(gate);
export const gateScanMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  uniforms: {uT: time, uC: {value: new THREE.Color(C.cyan)}, uF: {value: 0}},
  vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform float uT; uniform vec3 uC; uniform float uF; varying vec2 vU;
    void main(){
      float s = smoothstep(.0,.04, abs(fract(vU.y*1. - uT*.35)-.5)*2.) ;
      float lines = .5+.5*sin(vU.y*120.);
      float hex = step(.92, fract(vU.x*14.)) + step(.92, fract(vU.y*18.));
      float edge = smoothstep(.35,.5,abs(vU.x-.5)) + smoothstep(.4,.5,abs(vU.y-.5));
      float band = 1.-smoothstep(0.,.06,abs(fract(vU.y - uT*.3)-.5));
      float a = .05 + hex*.05 + band*.22 + edge*.12 + uF*.35;
      gl_FragColor = vec4(uC*(1.+uF*2.), a*(.6+lines*.4));
    }`,
});
{
  const pm = std('#1a2233', {metalness: 0.7, roughness: 0.28});
  const H = 3.0, Z = 1.35, y0 = SURF;
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new RoundedBoxGeometry(0.34, H, 0.34, 2, 0.08), pm);
    p.position.set(0, y0 + H / 2, s * Z);
    p.castShadow = true;
    gate.add(p);
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, H - 0.4, 0.05), glow(C.cyan, 2.2));
    st.position.set(-0.18, y0 + H / 2, s * Z);
    gate.add(st);
  }
  const beam = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.34, Z * 2 + 0.34, 2, 0.08), pm);
  beam.position.set(0, y0 + H + 0.1, 0);
  beam.castShadow = true;
  gate.add(beam);
  const scan = new THREE.Mesh(new THREE.PlaneGeometry(Z * 2 - 0.3, H - 0.2), gateScanMat);
  scan.rotation.y = Math.PI / 2;
  scan.position.set(0, y0 + H / 2, 0);
  gate.add(scan);
  gate.userData.scan = scan;
  part('gate', gate, {title: 'The proxy: where policy is enforced', kicker: 'lns-supervisor · :3128 :3129 · DNS :5355', color: C.cyan, chapter: 'network',
    text: 'nftables sends every TCP connection the workload opens to the supervisor’s proxy (transparent :3129, or :3128 via HTTPS_PROXY) and every DNS query to its stub on :5355. The proxy reads the host name (SNI or CONNECT), matches it against the rule table the host pushed, and allows, denies or holds it for an approval card.'});
  label('proxy gate', {kicker: 'nftables → :3128/:3129 · dns :5355', color: C.cyan, at: V(0, y0 + H + 0.35, 0), parent: gate, part: 'gate'});
}

// Ports in the VM walls: NIC (right), vsock (back), mount sockets (left).
function port(size, color) {
  const g = new THREE.Group();
  const f = new THREE.Mesh(new RoundedBoxGeometry(size.x, size.y, size.z, 2, 0.05), std('#1d2638', {metalness: 0.7, roughness: 0.3}));
  const l = new THREE.Mesh(new THREE.BoxGeometry(size.x * 0.4 + 0.02, size.y * 0.55, size.z * 0.55), glow(color, 2));
  g.add(f, l);
  g.userData.light = l;
  return g;
}
export const NIC = V(VM.w / 2, 3.3, 0);
export const nic = port(V(0.36, 0.7, 1.0), C.cyan);
nic.position.copy(NIC);
vmInner.add(nic);
part('nic', nic, {title: 'eth0 · virtio-net', kicker: 'NAT’d by the Mac', color: C.cyan, chapter: 'network',
  text: 'The guest’s one network card. On macOS it is attached to Virtualization.framework’s NAT, and the guest gets its address by DHCP. The only traffic that reaches it is traffic the proxy has already let through.'});
label('eth0', {kicker: 'virtio-net', color: C.cyan, cls: 'sm', at: V(0.3, 0.55, 0), parent: nic, part: 'nic'});

export const VSOCK = V(-2.6, 3.05, -VM.d / 2);
export const vsock = port(V(1.5, 0.62, 0.3), C.cyan);
vsock.position.copy(VSOCK);
vmInner.add(vsock);
part('vsock', vsock, {title: 'vsock', kicker: '1024 · 1029 · 1030', color: C.cyan, chapter: 'supervisor',
  text: 'A socket between host and guest that is not a network at all. Port 1024: the supervisor’s WebSocket to lns-service (policy frames, approval requests, audit). 1029: sessions (lns run, lns exec). 1030: published ports.'});
label('vsock', {kicker: '1024 · 1029 · 1030', color: C.cyan, cls: 'sm', at: V(0, 0.5, -0.1), parent: vsock, part: 'vsock'});

export const SOCK = {ws: V(-VM.w / 2, 2.85, -1.5), data: V(-VM.w / 2, 2.85, 1.6)};
export const socks = {};
for (const [k, c] of [['ws', C.teal], ['data', C.blue]]) {
  const p = port(V(0.3, 0.7, 0.9), c);
  p.position.copy(SOCK[k]);
  vmInner.add(p);
  socks[k] = p;
}

// Mount plates on the surface of the writable layer: where each mount "stands" in the guest tree.
export const plates = {};
function plate(key, pos, w, d, color, title, kicker, info) {
  const g = new THREE.Group();
  g.position.copy(pos);
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, 0.08, d, 2, 0.03), new THREE.MeshStandardMaterial({color: '#0f1822', emissive: new THREE.Color(color), emissiveIntensity: 0.55, roughness: 0.4}));
  m.receiveShadow = true;
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.09, d)), new THREE.LineBasicMaterial({color: new THREE.Color(color).multiplyScalar(1.8), toneMapped: false}));
  g.add(m, e);
  vmInner.add(g);
  plates[key] = g;
  g.userData.mat = m.material;
  part(key, g, info);
  label(title, {kicker, color, cls: 'sm mono', at: V(-w / 2 + 0.1, 0.12, d / 2), parent: g, part: key});
  return g;
}
plate('p-ws', V(-3.05, SURF + 0.04, -1.55), 2.3, 1.9, C.teal, '/workspace', 'bind · virtio-fs', {title: '/workspace ← bind “.”', kicker: 'bind · live · shared', color: C.teal, chapter: 'mounts',
  text: 'Your project directory, shared live over virtio-fs (one share per bind, tag lns-bind-N). A write in the guest is a write to your folder, and an edit on your Mac is instantly visible inside.'});
plate('p-data', V(-3.05, SURF + 0.04, 1.6), 2.3, 1.8, C.blue, '/opt/data', 'volume · /dev/vdc', {title: '/opt/data ← volume “data”', kicker: 'named volume · ext4 disk', color: C.blue, chapter: 'volumes',
  text: 'A named volume is an ext4 image (~/.lns/volumes/data.img) attached as a virtio block disk. It outlives every run, but only one sandbox may hold it at a time.'});
plate('p-fs', V(0.9, SURF + 0.04, 2.35), 2.6, 1.3, C.lime, '/opt/app', 'fileset · inline', {title: '/opt/app ← fileset', kicker: 'fileset · seeded at boot', color: C.lime, chapter: 'filesets',
  text: 'Files the author shipped inside the artifact (inline text, or a directory packed into a layer at lns push), materialized into the runtime layer at launch. A snapshot, not a share.'});
plate('p-git', V(0.9, SURF + 0.04, -2.45), 2.0, 1.0, C.lime, '/etc/gitconfig', 'fileset · hostPath', {title: '/etc/gitconfig ← hostPath ~/.gitconfig', kicker: 'fileset · one host file, copied once', color: C.lime, chapter: 'filesets',
  text: 'A hostPath fileset reads one file off the machine that runs the sandbox, once, at launch. Edit it in the guest and only the guest copy changes; edit it on the host and the guest never sees it until the next boot.'});
plate('p-tmp', V(-0.7, SURF + 0.04, 2.55), 0.9, 0.8, C.grey, '/tmp', 'tmpfs', {title: '/tmp and /run', kicker: 'tmpfs · RAM', color: C.grey, chapter: 'volumes',
  text: 'Memory-backed. Gone whenever the VM powers off, even on lns stop / lns start.'});

// Tool shelf (mixin chapter) — chips appear as tools are merged in.
export const shelf = new THREE.Group();
shelf.position.set(1.3, SURF + 0.05, -1.2);
vmInner.add(shelf);

// ─────────────────────────────────────────────────────────────── host machinery
function screenTex(lines) {
  return canvasTex(512, 320, (g, w, h) => {
    g.fillStyle = '#050810'; g.fillRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0b1426'); gr.addColorStop(1, '#050810');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.font = '500 26px "DM Mono", monospace';
    lines.forEach(([t, c], i) => { g.fillStyle = c; g.fillText(t, 24, 52 + i * 38); });
  });
}
export const cli = new THREE.Group();
cli.position.set(-13.4, HOST_TOP, -4.3);
scene.add(cli);
export let cliScreen;
{
  const base = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.12, 0.8, 2, 0.04), std('#1c2434', {metalness: 0.7, roughness: 0.3}));
  base.position.y = 0.06;
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 0.12), std('#1c2434', {metalness: 0.7}));
  neck.position.set(0, 0.55, -0.15);
  const fr = new THREE.Mesh(new RoundedBoxGeometry(3.0, 1.95, 0.14, 2, 0.06), std('#161d2b', {metalness: 0.6, roughness: 0.3}));
  fr.position.set(0, 1.9, 0);
  fr.castShadow = true;
  cliScreen = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.75), new THREE.MeshBasicMaterial({map: screenTex([['$ lns run', '#5ee89a'], ['  Image:   node:22-slim', '#9ea8c2'], ['  Volume:  data → /opt/data', '#9ea8c2'], ['  Ports:   127.0.0.1:8642', '#9ea8c2'], ['  ✓ running', '#7fe3ff']]), toneMapped: false}));
  cliScreen.position.set(0, 1.9, 0.075);
  cli.add(base, neck, fr, cliScreen);
  cli.rotation.y = 0.35;
  part('cli', cli, {title: 'lns — the CLI', kicker: 'a thin client', color: C.cyan, chapter: 'supervisor',
    text: 'lns parses your command and your lns.yaml, then asks lns-service to do the work over a local Unix socket. It shows the run banner, and it never boots anything itself.'});
  label('lns', {kicker: 'CLI', color: C.cyan, at: V(-1.3, 3.05, 0), parent: cli, part: 'cli'});
}
export function setCliScreen(lines) { cliScreen.material.map.dispose(); cliScreen.material.map = screenTex(lines); }

export const svc = new THREE.Group();
svc.position.set(-9.4, HOST_TOP, -4.8);
scene.add(svc);
{
  const b = new THREE.Mesh(new RoundedBoxGeometry(1.8, 3.2, 1.8, 3, 0.18), std('#151c2b', {metalness: 0.55, roughness: 0.32}));
  b.position.y = 1.6; b.castShadow = true;
  svc.add(b);
  svc.userData.rings = [];
  for (let i = 0; i < 4; i++) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.05, 1.84), glow(C.cyan, 1.5));
    r.position.y = 0.6 + i * 0.7;
    svc.add(r);
    svc.userData.rings.push(r);
  }
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 12), glow(C.cyan, 3));
  top.position.y = 3.45;
  svc.add(top);
  part('service', svc, {title: 'lns-service', kicker: 'the background service', color: C.cyan, chapter: 'supervisor',
    text: 'Owns the microVM lifecycle, the image and layer caches, approvals and the audit writer. It pulls layers, provisions tools, builds the runtime layer, boots the VM, pushes policy frames to the supervisor and shows approval cards in the macOS app or Linux tray.'});
  label('lns-service', {kicker: 'VM lifecycle · approvals · audit', color: C.cyan, at: V(0, 3.9, 0), parent: svc, part: 'service'});
}

export const vault = new THREE.Group();
vault.position.set(-6.4, HOST_TOP, -6.7);
scene.add(vault);
export const keyObj = new THREE.Group();
{
  const b = new THREE.Mesh(new RoundedBoxGeometry(1.7, 1.7, 1.7, 3, 0.16), std('#1b1a17', {metalness: 0.85, roughness: 0.25, color: '#2a2618'}));
  b.position.y = 0.85; b.castShadow = true;
  const door = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 32), std('#3a331f', {metalness: 0.9, roughness: 0.2}));
  door.rotation.z = Math.PI / 2; door.rotation.y = Math.PI / 2;
  door.position.set(0, 0.85, 0.87);
  const ringG = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 8, 40), glow(C.gold, 1.8));
  ringG.position.set(0, 0.85, 0.9);
  vault.add(b, door, ringG);
  const km = glow(C.gold, 2.6);
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.045, 8, 24), km);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.07), km);
  shaft.position.x = 0.32;
  const bit = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.07), km);
  bit.position.set(0.46, -0.08, 0);
  keyObj.add(bow, shaft, bit);
  keyObj.position.set(0, 2.1, 0);
  vault.add(keyObj);
  vault.userData.ring = ringG;
  part('vault', vault, {title: 'Connectors & their secrets', kicker: 'kept on the host', color: C.gold, chapter: 'connector',
    text: 'Installed connectors and the connections you made with lns connector connect. The real token is stored here, on the machine. The workload only ever holds a placeholder.'});
  label('connector vault', {kicker: 'real tokens live here', color: C.gold, at: V(0, 2.6, 0), parent: vault, part: 'vault'});
}

export const cache = new THREE.Group();
cache.position.set(-13.2, HOST_TOP, 1.6);
scene.add(cache);
{
  const cols = ['#34425f', '#3f4f70', '#4b5d82', '#56698f'];
  cols.forEach((c, i) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(1.9 - i * 0.12, 0.34, 1.5 - i * 0.08, 2, 0.06), emi(c, 0.35, '#151a26'));
    m.position.y = 0.2 + i * 0.38;
    m.rotation.y = (i % 2 ? 0.08 : -0.06);
    m.castShadow = true;
    cache.add(m);
  });
  part('cache', cache, {title: 'Artifact & layer cache', kicker: '~/.lns · content · layers', color: C.violet, chapter: 'mounts',
    text: 'Pulled images and lns artifacts, unpacked once into a content store. The guest reads it read-only over virtio-fs (tag lns-content), so ten sandboxes on the same image share one copy.'});
  label('artifact cache', {kicker: '~/.lns/content', color: C.violet, at: V(0, 1.85, 0), parent: cache, part: 'cache'});
}

export const folder = new THREE.Group();
folder.position.set(-8.6, HOST_TOP, -1.1);
scene.add(folder);
{
  const fm = std('#262f40', {emissive: new THREE.Color(C.ice), emissiveIntensity: 0.1, metalness: 0.2, roughness: 0.5});
  const back = new THREE.Mesh(new RoundedBoxGeometry(2.4, 1.7, 0.12, 2, 0.05), fm);
  back.position.set(0, 0.95, -0.5);
  const tab = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.3, 0.12, 2, 0.05), fm);
  tab.position.set(-0.7, 1.85, -0.5);
  const tray = new THREE.Mesh(new RoundedBoxGeometry(2.5, 0.16, 1.4, 2, 0.05), fm);
  tray.position.set(0, 0.1, 0.1);
  back.castShadow = tray.castShadow = true;
  folder.add(back, tab, tray);
  part('folder', folder, {title: 'Your project directory', kicker: '~/dev/app · bound at /workspace', color: C.teal, chapter: 'mounts',
    text: 'The directory the lns.yaml sits in. The document binds “.” at /workspace, so this folder, and only this folder, is what the workload sees of your disk. .env is excluded, so the guest sees a mask there.'});
  label('~/dev/app', {kicker: 'your project · bind source', color: C.teal, at: V(-1.1, 2.3, -0.5), parent: folder, part: 'folder'});
}

export const disk = new THREE.Group();
disk.position.set(-8.6, HOST_TOP, 3.0);
scene.add(disk);
export let diskFill;
{
  const dm = std('#16223a', {metalness: 0.75, roughness: 0.28});
  const c = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.1, 48), dm);
  c.position.y = 0.55; c.castShadow = true;
  const rim1 = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.03, 8, 64), glow(C.blue, 1.8));
  rim1.rotation.x = Math.PI / 2; rim1.position.y = 1.1;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 24), glow(C.blue, 1.4));
  hub.position.y = 1.12;
  diskFill = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.92, 64, 1, 0, 0.001), new THREE.MeshBasicMaterial({color: new THREE.Color(C.blue).multiplyScalar(1.6), toneMapped: false, side: THREE.DoubleSide, transparent: true, opacity: 0.85}));
  diskFill.rotation.x = -Math.PI / 2; diskFill.position.y = 1.115;
  disk.add(c, rim1, hub, diskFill);
  part('disk', disk, {title: 'Named volume “data”', kicker: '~/.lns/volumes/data.img', color: C.blue, chapter: 'volumes',
    text: 'An ext4 disk image the service keeps between runs (10Gi by default, sparse, grown but never shrunk). Attached as a virtio block device; a running or stopped sandbox holds an exclusive lease on it.'});
  label('volume “data”', {kicker: 'ext4 image · exclusive', color: C.blue, at: V(0, 1.6, 0), parent: disk, part: 'disk'});
}

export const gitfile = new THREE.Group();
gitfile.position.set(-11.4, HOST_TOP, 5.0);
scene.add(gitfile);
{
  const m = new THREE.Mesh(new RoundedBoxGeometry(0.9, 1.15, 0.08, 2, 0.04), std('#262f40', {emissive: new THREE.Color(C.ice), emissiveIntensity: 0.2}));
  m.position.y = 0.6; m.rotation.x = -0.25; m.castShadow = true;
  gitfile.add(m);
  gitfile.userData.mat = m.material;
  part('gitfile', gitfile, {title: '~/.gitconfig on your Mac', kicker: 'hostPath source', color: C.lime, chapter: 'filesets',
    text: 'A single host file a hostPath fileset copies into the guest when the run launches. It is read once, and never written back.'});
  label('~/.gitconfig', {kicker: 'host file', color: C.lime, cls: 'sm', at: V(0, 1.35, 0), parent: gitfile, part: 'gitfile'});
}

export const browser = new THREE.Group();
browser.position.set(-5.2, HOST_TOP, 6.5);
scene.add(browser);
{
  const fr = new THREE.Mesh(new RoundedBoxGeometry(2.2, 1.4, 0.1, 2, 0.05), std('#161d2b', {metalness: 0.5}));
  fr.position.y = 1.05; fr.rotation.y = -0.4; fr.castShadow = true;
  const sc = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 1.2), new THREE.MeshBasicMaterial({map: canvasTex(400, 240, (g, w, h) => {
    g.fillStyle = '#0c1220'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1b2438'; g.fillRect(0, 0, w, 40);
    ['#56658a', '#56658a', '#56658a'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(20 + i * 20, 20, 6, 0, 7); g.fill(); });
    g.fillStyle = '#0c1220'; g.fillRect(90, 10, 290, 20);
    g.fillStyle = '#9ea8c2'; g.font = '14px monospace'; g.fillText('localhost:8642', 100, 25);
    g.fillStyle = '#9fb0d0'; g.fillRect(30, 80, 180, 14); g.fillStyle = '#3a4560'; g.fillRect(30, 110, 300, 10); g.fillRect(30, 130, 260, 10); g.fillRect(30, 150, 280, 10);
  }), toneMapped: false}));
  sc.position.set(0, 1.05, 0.06); sc.rotation.y = -0.4;
  sc.position.x += Math.sin(-0.4) * 0.06; sc.position.z = Math.cos(-0.4) * 0.06;
  const st = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.35, 0.1), std('#161d2b'));
  st.position.y = 0.2;
  browser.add(fr, sc, st);
  part('browser', browser, {title: 'A published port', kicker: '127.0.0.1:8642 → guest :8642', color: C.cyan, chapter: 'network',
    text: 'spec.ports publishes a guest port on the host’s loopback. Each connection travels over vsock 1030 to the broker, which dials 127.0.0.1:<port> inside the guest, so a server bound to the guest’s loopback is reachable.'});
  label('localhost:8642', {kicker: 'published port', color: C.cyan, cls: 'sm', at: V(0, 1.95, 0), parent: browser, part: 'browser'});
}

export const nat = new THREE.Group();
nat.position.set(7.6, HOST_TOP, 0);
scene.add(nat);
{
  const b = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.7, 1.5, 3, 0.14), std('#151c2b', {metalness: 0.6, roughness: 0.3}));
  b.position.y = 0.35; b.castShadow = true;
  nat.add(b);
  for (let i = 0; i < 4; i++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), glow(C.cyan, 1.8));
    l.position.set(-0.45 + i * 0.3, 0.45, 0.76);
    nat.add(l);
  }
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9), std('#2a3448'));
  ant.position.set(0.5, 1.1, -0.4);
  nat.add(ant);
  part('nat', nat, {title: 'The Mac’s NAT', kicker: 'VZNATNetworkDeviceAttachment', color: C.cyan, chapter: 'network',
    text: 'The guest NIC is attached to macOS’s built-in NAT (the vmnet DHCP pool). By the time a packet gets here, the supervisor’s proxy has already decided it may leave.'});
  label('NAT', {kicker: 'macOS vmnet', color: C.cyan, cls: 'sm', at: V(0, 1.3, 0), parent: nat, part: 'nat'});
}

// ─────────────────────────────────────────────────────────────── the internet
export const DEST = {
  npm:    {host: 'registry.npmjs.org', pos: V(12.9, 0, -6.6), h: 3.4, color: '#e0443e', note: 'npm registry'},
  github: {host: 'api.github.com', pos: V(15.4, 0, -3.3), h: 4.6, color: '#b9c4d8', note: 'served by the github connector'},
  claude: {host: 'api.anthropic.com', pos: V(16.4, 0, 0.5), h: 5.4, color: '#e8a37a', note: 'model provider'},
  linear: {host: 'api.linear.app', pos: V(15.2, 0, 4.2), h: 3.9, color: '#8a8cf7', note: 'no rule yet'},
  evil:   {host: 'telemetry.evil.example', pos: V(12.6, 0, 7.4), h: 2.8, color: '#ff5d6c', note: 'the sandbox denies it'},
  db:     {host: 'db.internal:5432', pos: V(10.2, 0, 10.2), h: 1.6, color: '#5eead4', note: 'raw TCP (Postgres)', raw: true},
};
{
  const ground = new THREE.Mesh(new THREE.CircleGeometry(10, 64), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: {uT: time},
    vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uT; varying vec2 vU; void main(){ float r = length(vU-.5)*2.; float ring = smoothstep(.02,0.,abs(fract(r*4.-uT*.12)-.5)-.47); float a = (1.-r)*.12 + ring*(1.-r)*.25; gl_FragColor = vec4(vec3(.4,.6,1.)*1.2, a); }`,
  }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(14, -0.49, 1);
  scene.add(ground);
  label('the internet', {kicker: 'and your network', color: C.white, at: V(17.5, 0, 9.5)});
}
function winTex(color) {
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let y = 10; y < h - 8; y += 14) for (let x = 10; x < w - 8; x += 18) {
      if (Math.random() < 0.62) { g.fillStyle = color; g.globalAlpha = 0.25 + Math.random() * 0.75; g.fillRect(x, y, 10, 6); }
    }
  });
}
for (const [k, d] of Object.entries(DEST)) {
  const g = new THREE.Group();
  g.position.copy(d.pos);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.5, 0.16, 40), std('#121827', {metalness: 0.5, roughness: 0.35}));
  pad.position.y = -0.44; pad.receiveShadow = true;
  const padRing = new THREE.Mesh(new THREE.TorusGeometry(1.36, 0.025, 6, 60), glow('#56658a', 1.2));
  padRing.rotation.x = Math.PI / 2; padRing.position.y = -0.36;
  g.add(pad, padRing);
  let body;
  if (d.raw) {
    body = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, d.h, 36), std('#131a28', {emissive: new THREE.Color(C.ice), emissiveIntensity: 0.06, metalness: 0.5}));
    for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.81, 0.02, 6, 48), glow('#56658a', 1.2)); r.rotation.x = Math.PI / 2; r.position.y = -0.36 + 0.35 + i * 0.5; g.add(r); }
  } else {
    body = new THREE.Mesh(new RoundedBoxGeometry(1.5, d.h, 1.5, 3, 0.14), new THREE.MeshStandardMaterial({color: '#131a28', emissive: '#ffffff', emissiveMap: winTex('#ffe6c4'), emissiveIntensity: 0.55, metalness: 0.4, roughness: 0.35}));
  }
  body.position.y = -0.36 + d.h / 2;
  body.castShadow = true;
  g.add(body);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), glow(C.grey, 1.2));
  beacon.position.y = -0.36 + d.h + 0.35;
  g.add(beacon);
  scene.add(g);
  d.group = g; d.beacon = beacon;
  d.port = V(d.pos.x - 0.9, 1.8, d.pos.z);
  part('dest-' + k, g, {title: d.host, kicker: d.note, color: C.ice, chapter: 'network',
    text: d.raw ? 'Postgres doesn’t speak HTTP, so the proxy cannot read a host name or inject anything. It can only splice the stream through (an egress.tcp rule) or ask with a RAW card.' : 'An outside destination. Whether the workload may reach it is decided by the rule table in the supervisor’s proxy, before the packet ever leaves the VM.'});
  d.label = label(d.host, {kicker: d.note, color: C.ice, cls: 'mono sm', at: V(0, d.h + 0.9, 0), parent: g, part: 'dest-' + k});
}

// ─────────────────────────────────────────────────────────────── pipes
export const pipes = {};
export function pipe(key, pts, color, {r = 0.07, base = 0.14, tension = 0.3} = {}) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', tension);
  const len = curve.getLength();
  const mat = flowMat(color, len, base);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(24, Math.round(len * 10)), r, 10, false), mat);
  m.renderOrder = 5;
  const sheath = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(24, Math.round(len * 10)), r * 1.9, 10, false),
    new THREE.MeshStandardMaterial({color: '#0e1422', transparent: true, opacity: 0.35, roughness: 0.2, metalness: 0.3, depthWrite: false}));
  const g = new THREE.Group();
  g.add(sheath, m);
  scene.add(g);
  pipes[key] = {curve, mat, g, len, pulse: 0, active: 0};
  return pipes[key];
}
const at = (o, x, y, z) => o.position.clone().add(V(x, y, z));
const svcPort = at(svc, 0.9, 2.3, 0);
pipe('cli', [at(cli, 1.1, 1.7, 0.4), at(cli, 2.4, 2.5, 0.1), at(svc, -0.9, 2.2, 0.1)], C.cyan, {r: 0.05});
pipe('vs1024', [svcPort.clone().add(V(0, 0.35, 0)), V(-6.2, 3.5, -5.0), V(-3.4, 3.25, -4.2), VSOCK.clone().add(V(-0.45, 0.18, -0.05))], C.cyan, {r: 0.055});
pipe('vs1029', [svcPort.clone(), V(-6.2, 3.05, -4.85), V(-3.0, 3.0, -4.15), VSOCK.clone().add(V(0, 0, -0.05))], C.cyan, {r: 0.055});
pipe('vs1030', [svcPort.clone().add(V(0, -0.35, 0)), V(-6.2, 2.6, -4.7), V(-2.6, 2.75, -4.1), VSOCK.clone().add(V(0.45, -0.18, -0.05))], C.cyan, {r: 0.055});
pipe('vault', [at(vault, -0.9, 1.0, 0), at(vault, -1.9, 1.6, 0.3), at(svc, 0.5, 1.2, -0.95)], C.gold, {r: 0.05});
pipe('ws', [at(folder, 1.15, 1.0, -0.2), V(-6.1, 2.6, -1.4), SOCK.ws.clone().add(V(-0.2, 0, 0))], C.teal, {r: 0.1});
pipe('data', [at(disk, 0.95, 0.6, 0), V(-6.3, 2.4, 2.2), SOCK.data.clone().add(V(-0.2, 0, 0))], C.blue, {r: 0.1});
pipe('content', [at(cache, 0.95, 0.9, 0.3), V(-10.4, 1.1, 5.0), V(-6.0, 1.1, 4.0), V(-4.8, 1.25, 2.9)], C.violet, {r: 0.06, base: 0.1});
pipe('port', [at(browser, -0.3, 1.3, -0.4), V(-7.2, 3.4, 1.4), at(svc, 0, 1.9, 0.95)], C.cyan, {r: 0.05, base: 0.08});
pipe('net', [NIC.clone().add(V(0.2, 0, 0)), V(6.0, 2.6, 0), V(7.0, HOST_TOP + 0.7, 0)], C.cyan, {r: 0.09});
for (const [k, d] of Object.entries(DEST)) {
  const a = V(8.3, HOST_TOP + 0.5, 0);
  const b = d.port;
  const mid = a.clone().lerp(b, 0.5); mid.y = 2.8;
  pipe('to-' + k, [a, mid, b], '#6f82a8', {r: 0.035, base: 0.06, tension: 0.5});
}
part('pipe-ws', pipes.ws.g, {title: 'virtio-fs share', kicker: 'bind · lns-bind-0', color: C.teal, chapter: 'mounts', text: 'The bind is served by the host over virtio-fs: live, and shareable by any number of guests at once.'});
part('pipe-data', pipes.data.g, {title: 'virtio block disk', kicker: '/dev/vdc · volume', color: C.blue, chapter: 'volumes', text: 'A named volume is a whole disk image attached to one guest. That’s why a second concurrent run gets “volume in use”.'});
part('pipe-content', pipes.content.g, {title: 'lns-content', kicker: 'virtio-fs · read-only', color: C.violet, chapter: 'mounts', text: 'Image layer file contents, shared read-only from the host content store. The composefs descriptor on /dev/vdb maps them into the root filesystem.'});
part('pipe-vsock', pipes.vs1024.g, {title: 'vsock 1024 · supervisor relay', kicker: 'policy · approvals · audit', color: C.cyan, chapter: 'policy', text: 'The supervisor’s WebSocket to lns-service. Down it come policy frames: the merged rule table and, once granted, connector values. Up it go approval requests and audit events.'});
part('pipe-vs1029', pipes.vs1029.g, {title: 'vsock 1029 · sessions', kicker: 'lns run · lns exec', color: C.cyan, chapter: 'supervisor', text: 'Terminal sessions: the first connection is the run itself; each lns exec opens another.'});
part('pipe-vs1030', pipes.vs1030.g, {title: 'vsock 1030 · port forwards', kicker: 'published ports', color: C.pink, chapter: 'network', text: 'Each inbound connection to a published host port is carried here and dialed to 127.0.0.1:<port> in the guest.'});
part('pipe-net', pipes.net.g, {title: 'virtio-net → NAT', kicker: 'the only way out', color: C.green, chapter: 'network', text: 'Only connections the proxy has approved, dialed by the proxy itself, leave through here.'});
