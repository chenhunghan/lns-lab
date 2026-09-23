import {
  THREE, CSS2DObject, C, V, scene, camera, renderer, labelRenderer, controls, composer, tiltH, tiltV, resize, time,
  parts, pickables, allLabels, label, vm, vmInner, shell, shellMat, shellEdges, layers, core, clawd, ring, procs, gate,
  gateScanMat, GATE, NIC, nic, VSOCK, vsock, SOCK, socks, plates, shelf, cli, setCliScreen, svc, vault, keyObj, cache,
  folder, disk, diskFill, gitfile, browser, nat, DEST, pipes, glow, vmLight, coreLight, SURF, VM, vmLabel, HOST_TOP,
} from './world.js?v=3';

// ─────────────────────────────────────────────────────────────── small helpers
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const easeIO = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const easeOut = t => 1 - (1 - t) ** 3;
const backOut = t => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const col = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const esc = s => String(s).replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
const clock = () => new Date().toTimeString().slice(0, 8);

let paused = false, speed = 1;
const tweens = [];
function tween(dur, fn, ease = t => t) {
  return new Promise(res => tweens.push({t: 0, dur: Math.max(dur, 1e-4), fn, ease, res}));
}
const sleep = s => tween(s, () => {});
function stepTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const w = tweens[i];
    w.t += dt;
    const k = Math.min(1, w.t / w.dur);
    w.fn(w.ease(k));
    if (k >= 1) { tweens.splice(i, 1); w.res(); }
  }
}

// ─────────────────────────────────────────────────────────────── effects: packets, bursts, floating text
const SPH = new THREE.SphereGeometry(0.13, 18, 12);
const packets = new Set();
class Packet {
  constructor(color, text = '', size = 1) {
    this.g = new THREE.Group();
    this.mat = new THREE.MeshBasicMaterial({color: col(color, 3), toneMapped: false, transparent: true});
    this.m = new THREE.Mesh(SPH, this.mat);
    this.m.scale.setScalar(size);
    this.g.add(this.m);
    const halo = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({color: col(color, 1), toneMapped: false, transparent: true, opacity: 0.25, depthWrite: false}));
    halo.scale.setScalar(size * 2.1);
    this.halo = halo;
    this.g.add(halo);
    this.ghosts = [];
    for (let i = 0; i < 7; i++) {
      const gm = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({color: col(color, 2), toneMapped: false, transparent: true, opacity: 0.5 * (1 - i / 7), depthWrite: false}));
      gm.scale.setScalar(size * (0.8 - i * 0.09));
      scene.add(gm);
      this.ghosts.push(gm);
    }
    this.hist = [];
    this.el = document.createElement('div');
    this.el.className = 'pk' + (text ? '' : ' off');
    this.el.textContent = text;
    this.el.style.setProperty('--c', color);
    this.lab = new CSS2DObject(this.el);
    this.lab.center.set(0.5, 1);
    this.g.add(this.lab);
    scene.add(this.g);
    packets.add(this);
    this.hold = 0;
  }
  color(hex) {
    this.mat.color.copy(col(hex, 3));
    this.halo.material.color.copy(col(hex, 1));
    this.ghosts.forEach(g => g.material.color.copy(col(hex, 2)));
    this.el.style.setProperty('--c', hex);
    return this;
  }
  text(t) { this.el.textContent = t; this.el.classList.toggle('off', !t); return this; }
  get pos() { return this.g.position; }
  at(p) { this.g.position.copy(p); this.hist = []; return this; }
  along(curve, dur, a = 0, b = 1, pk) {
    return tween(dur, k => {
      curve.getPointAt(clamp(lerp(a, b, k), 0, 1), this.g.position);
      if (pk) pipes[pk].pulse = 1;
    }, easeIO);
  }
  to(p, dur, arc = 0) {
    const s = this.g.position.clone();
    return tween(dur, k => {
      this.g.position.lerpVectors(s, p, k);
      this.g.position.y += Math.sin(k * Math.PI) * arc;
    }, easeIO);
  }
  path(pts, dur) { return this.along(new THREE.CatmullRomCurve3([this.g.position.clone(), ...pts], false, 'catmullrom', 0.4), dur); }
  update(t) {
    this.hist.unshift(this.g.position.clone());
    if (this.hist.length > 30) this.hist.pop();
    this.ghosts.forEach((g, i) => { const h = this.hist[Math.min(this.hist.length - 1, (i + 1) * 2)]; if (h) g.position.copy(h); });
    const s = this.hold ? 1 + Math.sin(t * 9) * 0.25 : 1;
    this.halo.scale.setScalar(2.1 * s * this.m.scale.x);
  }
  async die(dur = 0.35) {
    const s0 = this.m.scale.x;
    await tween(dur, k => { this.m.scale.setScalar(s0 * (1 - k) + 1e-3); this.halo.material.opacity = 0.25 * (1 - k); this.ghosts.forEach(g => g.material.opacity *= 0.85); });
    this.remove();
  }
  remove() {
    scene.remove(this.g);
    this.ghosts.forEach(g => scene.remove(g));
    this.lab.element.remove();
    packets.delete(this);
  }
}

const RING = new THREE.RingGeometry(0.4, 0.5, 48);
function burst(pos, color, size = 1.4) {
  const m = new THREE.Mesh(RING, new THREE.MeshBasicMaterial({color: col(color, 2.5), toneMapped: false, transparent: true, side: THREE.DoubleSide, depthWrite: false}));
  m.position.copy(pos);
  m.lookAt(camera.position);
  scene.add(m);
  tween(0.75, k => { m.scale.setScalar(0.3 + k * size * 2); m.material.opacity = 1 - k; }, easeOut).then(() => scene.remove(m));
}
function fx(pos, text, color = C.white) {
  const el = document.createElement('div');
  el.className = 'fx';
  el.style.setProperty('--c', color);
  el.textContent = text;
  const o = new CSS2DObject(el);
  o.position.copy(pos);
  scene.add(o);
  setTimeout(() => { scene.remove(o); el.remove(); }, 1900);
}

// ─────────────────────────────────────────────────────────────── scene extras built here: doc cards, tool chips, file tokens, second VM
const FILE = new THREE.BoxGeometry(0.26, 0.34, 0.035);
function fileMesh(color, dim = false) {
  const m = new THREE.Mesh(FILE, new THREE.MeshStandardMaterial({color: '#141a26', emissive: new THREE.Color(color), emissiveIntensity: dim ? 0.25 : 1.1, roughness: 0.4}));
  m.castShadow = true;
  return m;
}

const tok = {host: [], ws: [], data: [], upper: [], tmp: [], fs: [], git: []};
const slot = {
  host: i => folder.position.clone().add(V(-0.95 + (i % 7) * 0.32, 0.42, 0.2 + Math.floor(i / 7) * 0.34)),
  ws: i => plates['p-ws'].position.clone().add(V(-0.85 + (i % 6) * 0.34, 0.24, -0.45 + Math.floor(i / 6) * 0.42)),
  data: i => plates['p-data'].position.clone().add(V(-0.85 + (i % 6) * 0.34, 0.24, -0.35 + Math.floor(i / 6) * 0.42)),
  upper: i => V(1.25 + (i % 4) * 0.33, SURF + 0.2, 0.55 + Math.floor(i / 4) * 0.4),
  tmp: i => plates['p-tmp'].position.clone().add(V(-0.2 + (i % 3) * 0.2, 0.24 + Math.floor(i / 3) * 0.05, 0)),
  fs: i => plates['p-fs'].position.clone().add(V(-0.9 + i * 0.4, 0.24, 0)),
  git: i => plates['p-git'].position.clone().add(V(-0.3 + i * 0.4, 0.24, 0)),
};
const tokColor = {host: C.ice, ws: C.ice, data: C.ice, upper: C.orange, tmp: C.grey, fs: C.ice, git: C.ice};
function addTok(where, {from, dur = 0.6, color, masked = false} = {}) {
  const i = tok[where].length;
  const m = fileMesh(masked ? C.red : (color || tokColor[where]), masked);
  const p = slot[where](i);
  m.position.copy(from || p);
  if (where === 'host') m.rotation.x = -0.12;
  m.userData.masked = masked;
  scene.add(m);
  tok[where].push(m);
  if (from) tween(dur, k => { m.position.lerpVectors(from, p, k); m.position.y += Math.sin(k * Math.PI) * 0.8; }, easeIO);
  else { m.scale.setScalar(0.001); tween(0.4, k => m.scale.setScalar(Math.max(1e-3, k)), backOut); }
  return m;
}
function clearTok(where, keep = 0) {
  const gone = tok[where].splice(keep);
  gone.forEach(m => tween(0.5, k => { m.scale.setScalar(Math.max(1e-3, 1 - k)); m.position.y += 0.01; }).then(() => scene.remove(m)));
}

// Tool chips on the shelf inside the VM.
const chips = {};
function chip(key, text, color) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 0.3), new THREE.MeshStandardMaterial({color: '#1a1422', emissive: new THREE.Color(color), emissiveIntensity: 1.0}));
  m.castShadow = true;
  g.add(m);
  g.position.set(Object.keys(chips).length * 0.75, 0.16, 0);
  g.scale.setScalar(0.001);
  shelf.add(g);
  const L = label(text, {kicker: 'tool', color, cls: 'sm mono', at: V(0, 0.28, 0), parent: g});
  chips[key] = {g, L, on: false};
  L.el.classList.add('off');
  return chips[key];
}
function setChip(key, on) {
  const c = chips[key];
  if (!c || c.on === on) return;
  c.on = on;
  const s0 = c.g.scale.x;
  tween(0.45, k => c.g.scale.setScalar(Math.max(1e-3, lerp(s0, on ? 1 : 0, k))), on ? backOut : easeIO);
}
chip('node', 'node@22', C.pink);

// The document cards for the mixin chapter, floating in a row above the VM.
const LAYERS = [
  {k: 'sandbox', name: 'lns.yaml', sub: 'the sandbox', color: C.cyan, fixed: true},
  {k: 'node', name: './mixins/node', sub: 'spec.mixins', color: C.pink},
  {k: 'anthropic', name: './mixins/anthropic', sub: '--mixin', color: C.pink},
  {k: 'team', name: './team-egress.yaml', sub: '--mixin', color: C.pink},
  {k: 'prod', name: './mixins/prod-settings', sub: '--mixin', color: C.pink},
  {k: 'connector', name: 'github · token', sub: 'granted connector', color: C.gold, fixed: true},
  {k: 'decisions', name: 'decisions.yaml', sub: 'this run’s answers', color: C.amber, fixed: true},
];
const cards = new THREE.Group();
scene.add(cards);
LAYERS.forEach((L, i) => {
  const g = new THREE.Group();
  const x = -7.2 + i * 2.4;
  g.position.set(x, 8.6 + Math.abs(i - 3) * -0.25, -0.6);
  const mat = new THREE.MeshStandardMaterial({color: '#131a28', emissive: new THREE.Color(L.color), emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.3, transparent: true, opacity: 0.95});
  const m = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.5, 0.07), mat);
  const lines = new THREE.Group();
  for (let j = 0; j < 7; j++) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.4 + ((j * 37 + i * 13) % 10) / 10 * 1.0, 0.07), new THREE.MeshBasicMaterial({color: col(L.color, 1.4), toneMapped: false, transparent: true, opacity: 0.5}));
    b.position.set(-0.75 + b.geometry.parameters.width / 2, 0.85 - j * 0.24, 0.04);
    lines.add(b);
  }
  g.add(m, lines);
  g.rotation.x = -0.18;
  cards.add(g);
  L.g = g; L.mat = m.material; L.lines = lines; L.home = g.position.clone();
  L.label = label(L.name, {kicker: L.sub, color: L.color, cls: 'sm mono', at: V(-0.95, 1.45, 0), parent: g});
  L.label.el.addEventListener('click', e => { e.stopPropagation(); if (!L.fixed) toggleMixin(L.k); });
  L.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 8), new THREE.MeshBasicMaterial({color: col(L.color, 2), toneMapped: false, transparent: true, opacity: 0, depthWrite: false}));
  L.beam.visible = false;
  scene.add(L.beam);
  m.userData.card = L.k;
  pickables.push(m);
});
const precLabel = label('weakest  →  strongest', {kicker: 'merge precedence', color: C.pink, cls: 'sm', at: V(-7.9, 10.6, -0.6)});
cards.visible = false;

// Key held by the proxy once a connector is granted.
const gateKey = keyObj.clone();
gateKey.scale.setScalar(1.1);
gateKey.visible = false;
scene.add(gateKey);
const GATE_KEY_POS = V(GATE.x, SURF + 3.55, 0);

// A second sandbox for the "volume in use" demo.
const ghost = new THREE.Group();
{
  const s = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.2, 2.4), (() => { const m = shellMat.clone(); m.uniforms.uT = time; m.uniforms.uC.value = new THREE.Color(C.cyan); return m; })());
  s.position.y = 1.1 + 0.3;
  const ped = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 2.8), new THREE.MeshStandardMaterial({color: '#161d2c', metalness: 0.5, roughness: 0.35}));
  ped.position.y = 0.1;
  const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({color: '#2a1606', emissive: new THREE.Color(C.orange), emissiveIntensity: 1.2}));
  c2.position.y = 1.4;
  ghost.add(ped, s, c2);
  ghost.position.set(0.5, HOST_TOP, 6.4);
  ghost.visible = false;
  ghost.userData.mat = s.material;
  scene.add(ghost);
  ghost.userData.label = label('run “agent-2”', {kicker: 'a second sandbox', color: C.cyan, cls: 'sm', at: V(-1.7, 2.8, 0), parent: ghost});
}

// ─────────────────────────────────────────────────────────────── the audit log
const logEl = $('#log');
function log(html, color) {
  const d = document.createElement('div');
  d.innerHTML = `<u>${clock()}</u> ` + html;
  if (color) d.style.setProperty('--c', color);
  logEl.appendChild(d);
  while (logEl.children.length > 3) logEl.firstChild.remove();
}

// ─────────────────────────────────────────────────────────────── state
const S = {
  vm: 'running',            // off | booting | running | stopped | gone
  run: 1,
  decisions: {http: [], tcp: []},
  closed: false,
  conn: {installed: false, connected: false, granted: false, declined: false},
  mix: {node: true, anthropic: true, team: false, prod: false},
  fsRoot: false, gitHost: 1, gitGuest: 1, settings: '{"theme":"dark"}',
  term: {},
  boot: -1,
  hop: -1,
  seen: new Set(),
};
const SERVES = ['api.github.com', 'github.com'];
const MIXRULES = {
  node: [{match: '*.npmjs.org', verdict: 'allow'}],
  anthropic: [{match: 'api.anthropic.com', verdict: 'allow'}],
  team: [{match: 'api.linear.app', verdict: 'allow', description: 'approved during a run'}],
  prod: [],
};
const SANDBOX_RULES = [{match: 'registry.npmjs.org', verdict: 'allow'}, {match: 'telemetry.evil.example', verdict: 'deny'}];
const SRC = {
  decisions: {name: 'decisions.yaml', color: C.amber},
  connector: {name: 'connector github', color: C.gold},
  prod: {name: '--mixin prod-settings', color: C.pink},
  team: {name: '--mixin team-egress', color: C.pink},
  anthropic: {name: '--mixin anthropic', color: C.pink},
  node: {name: 'mixins/node', color: C.pink},
  sandbox: {name: 'lns.yaml', color: C.cyan},
};
function matches(pat, host) {
  if (pat === '*') return true;
  if (pat.startsWith('*.')) return host.endsWith(pat.slice(1));
  return pat === host;
}
// Egress rules union; a stronger source's rules are placed first, and the first match wins.
function mergedRules() {
  const out = [];
  S.decisions.http.forEach(r => out.push({...r, src: 'decisions'}));
  if (S.conn.granted) out.push({match: 'api.github.com', verdict: 'allow', src: 'connector'});
  else if (S.conn.installed && !S.conn.declined) SERVES.forEach(h => out.push({match: h, verdict: 'ask', src: 'connector', offer: true}));
  else if (S.conn.declined) SERVES.forEach(h => out.push({match: h, verdict: 'deny', src: 'connector', declined: true}));
  for (const k of ['prod', 'team', 'anthropic']) if (S.mix[k]) MIXRULES[k].forEach(r => out.push({...r, src: k}));
  if (S.mix.node) MIXRULES.node.forEach(r => out.push({...r, src: 'node'}));
  SANDBOX_RULES.forEach(r => out.push({...r, src: 'sandbox'}));
  if (S.closed) out.push({match: '*', verdict: 'deny', src: 'sandbox', closing: true});
  return out;
}
function evaluate(d) {
  if (d.raw) {
    const r = S.decisions.tcp.find(r => r.match === d.host);
    if (r) return {verdict: r.verdict, rule: r, src: 'decisions'};
    if (S.closed) return {verdict: 'deny', rule: {match: '*'}, src: 'sandbox'};
    return {verdict: 'ask'};
  }
  for (const r of mergedRules()) if (matches(r.match, d.host)) return {verdict: r.verdict, rule: r, src: r.src};
  return {verdict: 'ask'};
}
const VCOL = {allow: C.green, deny: C.red, ask: C.amber};

// ─────────────────────────────────────────────────────────────── approval card
const appr = $('#appr');
let cardQueue = Promise.resolve();
function askCard({title, text, raw = false, kind = 'Approval · agent', buttons, timeout = 60}) {
  const run = () => new Promise(res => {
    $('#appr-kind').textContent = kind;
    $('#appr-raw').hidden = !raw;
    $('#appr-h').textContent = title;
    $('#appr-p').innerHTML = text;
    const box = $('#appr-b');
    box.innerHTML = (buttons || [
      ['allow-once', 'Allow once', 'al'], ['allow-always', 'Allow always', 'al st'],
      ['deny-once', 'Deny once', 'dn'], ['deny-always', 'Deny always', 'dn st'],
    ]).map(([a, t, c]) => `<button class="${c}" data-a="${a}">${t}</button>`).join('');
    appr.classList.add('on');
    const bar = $('#appr-t'), sec = $('#appr-s');
    let left = timeout, done = false;
    const finish = a => { if (done) return; done = true; clearInterval(iv); appr.classList.remove('on'); res(a); };
    box.querySelectorAll('button').forEach(b => b.onclick = () => finish(b.dataset.a));
    bar.style.transition = 'none'; bar.style.transform = 'scaleX(1)';
    requestAnimationFrame(() => { bar.style.transition = `transform ${timeout}s linear`; bar.style.transform = 'scaleX(0)'; });
    sec.textContent = left + 's';
    const iv = setInterval(() => { if (paused) return; left--; sec.textContent = left + 's'; if (left <= 0) finish('timeout'); }, 1000);
    if (touring) setTimeout(() => finish((buttons && buttons[0][0]) || 'allow-always'), 2600);
  });
  const p = cardQueue.then(run);
  cardQueue = p.catch(() => {});
  return p;
}

// ─────────────────────────────────────────────────────────────── VM lifecycle
const coreP = core.position.clone().add(V(0.8, -0.05, 0.25));
function setVmPresence(k) {
  shellMat.uniforms.uO.value = k;
  shellEdges.userData.mats[0].opacity = 0.22 * k;
  shellEdges.userData.mats[1].opacity = k;
  vmLight.intensity = 9 * k;
}
function popIn(o, on = true, dur = 0.5) {
  const s0 = o.scale.x;
  return tween(dur, k => o.scale.setScalar(Math.max(1e-3, lerp(s0, on ? 1 : 0, k))), on ? backOut : easeIO);
}
const vmPieces = () => [layers.kernel, ...layers.image, layers.runtime, layers.upper, procs.init, procs.broker, ring, gate, core, nic, vsock, socks.ws, socks.data, ...Object.values(plates), shelf];
function setState(s) {
  S.vm = s;
  const st = $('#vmstate');
  st.className = 'state ' + ({running: '', booting: 'boot', stopped: 'stopped', gone: 'gone', off: 'gone'}[s]);
  st.querySelector('span').textContent = s === 'gone' ? 'no sandbox' : `agent${S.run > 1 ? '' : ''} · ${s}`;
  refresh();
}
function setCore(k) { clawd.power(k); coreLight.intensity = 6 * k; }

const BOOT = [
  ['lns run', 'CLI → lns-service over a Unix socket', 'cli'],
  ['Prepare', 'pull layers · kernel · upper.img · lease volumes · CA · tools (mise) · runtime layer', 'service'],
  ['Hypervisor', 'Virtualization.framework boots the VM with virtio-net, vsock, virtio-fs and block disks', 'pedestal'],
  ['Guest kernel', 'its own Linux 6.18 — not your Mac’s', 'kernel'],
  ['lns-init · PID 1', 'verify descriptor, mount composefs + overlay, volumes, binds, filesets, tmpfs', 'init'],
  ['session-broker', 'eth0 via DHCP, PTYs, sessions on vsock 1029, port forwards on 1030', 'broker'],
  ['lns-supervisor', 'nftables cage · proxy :3128/:3129 · DNS :5355 · relay on vsock 1024', 'supervisor'],
  ['pre-start scripts', 'sh -e, in order, through the same proxy: [scripts 1/1] npm install -g @anthropic-ai/claude-code', 'supervisor'],
  ['privilege drop', 'exec sh -c "claude" as uid 65534 (sandbox)', 'workload'],
];
let booting = false;
async function boot({fast = false, reason = 'lns run'} = {}) {
  if (booting) return;
  booting = true;
  const T = fast ? 0.45 : 1;
  const step = i => { S.boot = i; refreshPanel(); };
  setState('booting');
  vmPieces().forEach(o => o.scale.setScalar(0.001));
  setVmPresence(0); setCore(0);
  clearTok('upper'); clearTok('tmp'); clearTok('ws'); clearTok('data'); clearTok('fs'); clearTok('git');
  vmInner.visible = true;

  stage([cli, svc, ...VMBOX]);
  step(0);
  setCliScreen([['$ ' + reason, '#5ee89a'], ['  Image:     node:22-slim', '#9ea8c2'], ['  Volume:    data → /opt/data', '#9ea8c2'], ['  Resources: 2 vCPU · 2 GiB', '#9ea8c2'], ['  Ports:     127.0.0.1:8642 -> 8642', '#9ea8c2']]);
  log(`<b>${esc(reason)}</b> → lns-service`, C.green);
  const p0 = new Packet(C.green).at(pipes.cli.curve.getPointAt(0));
  await p0.along(pipes.cli.curve, 0.7 * T, 0, 1, 'cli'); p0.die();

  step(1);
  pipes.content.pulse = 1;
  await Promise.all([tween(1.0 * T, k => svc.userData.rings.forEach((r, i) => r.material.color.copy(col(C.cyan, 1.5 + 2 * Math.max(0, Math.sin(k * 12 - i))))))]);

  step(2);
  log('hypervisor: <b>Virtualization.framework</b> boots the microVM', C.cyan);
  await tween(0.9 * T, k => setVmPresence(k), easeOut);

  step(3);
  await popIn(layers.kernel, true, 0.45 * T);

  step(4);
  await popIn(procs.init, true, 0.35 * T);
  log('lns-init: composefs lower + overlay upper', C.violet);
  for (const m of [...layers.image, layers.runtime]) {
    pipes.content.pulse = 1;
    const y = m.position.y;
    m.scale.setScalar(1); m.position.y = y + 3;
    tween(0.5 * T, k => { m.position.y = lerp(y + 3, y, k); }, easeOut);
    await sleep(0.18 * T);
  }
  await sleep(0.35 * T);
  await popIn(layers.upper, true, 0.4 * T);
  await Promise.all([socks.ws, socks.data, ...Object.values(plates)].map(o => popIn(o, true, 0.4 * T)));
  pipes.ws.pulse = pipes.data.pulse = 1;
  seedGuestTokens(T);

  step(5);
  await popIn(procs.broker, true, 0.35 * T);
  await Promise.all([popIn(vsock, true, 0.35 * T), popIn(nic, true, 0.35 * T)]);
  pipes.vs1029.pulse = 1;

  step(6);
  await Promise.all([popIn(ring, true, 0.6 * T), popIn(gate, true, 0.6 * T)]);
  log('lns-supervisor: nftables <b>inet lens_sandbox</b> · proxy up', C.cyan);
  const pf = new Packet(C.cyan).at(pipes.vs1024.curve.getPointAt(0));
  await pf.along(pipes.vs1024.curve, 0.8 * T, 0, 1, 'vs1024');
  await pf.to(GATE.clone().add(V(0, 1.2, 0)), 0.5 * T); pf.die();
  fx(GATE.clone().add(V(0, 1.6, 0)), 'policy frame', C.cyan);

  step(7);
  popIn(shelf, true, 0.4 * T);
  if (S.mix.node) {
    fx(core.position.clone().add(V(0, 1.4, 0)), '[scripts 1/1] npm i -g @anthropic-ai/claude-code', C.pink);
    setChip('node', true);
    const pr = new Packet(C.cyan, 'npm install').at(coreP.clone());
    await pr.to(GATE.clone(), 0.6 * T); pr.color(C.green);
    await pr.to(NIC.clone(), 0.3 * T);
    await pr.along(pipes.net.curve, 0.4 * T, 0, 1, 'net');
    await pr.along(pipes['to-npm'].curve, 0.5 * T, 0, 1, 'to-npm'); pr.die();
  } else await sleep(0.4 * T);

  step(8);
  await popIn(core, true, 0.6 * T);
  clawd.mood('surprised', 1.2);
  await tween(0.6 * T, k => setCore(k));
  clawd.mood('happy', 2.6).say('hi! I’m Claude Code, in a microVM', {dur: 3.2});
  log('workload: <b>sh -c "claude"</b> as uid 65534', C.orange);
  setCliScreen([['$ ' + reason, '#5ee89a'], ['  Image:     node:22-slim', '#9ea8c2'], ['  Volume:    data → /opt/data', '#9ea8c2'], ['  Ports:     127.0.0.1:8642 -> 8642', '#9ea8c2'], ['  ✓ running · agent', '#7fe3ff']]);
  step(9);
  booting = false;
  setState('running');
}
function seedGuestTokens(T = 1) {
  clearTok('ws'); clearTok('data'); clearTok('fs'); clearTok('git');
  tok.host.forEach((m, i) => setTimeout(() => addTok('ws', {masked: m.userData.masked}), i * 60));
  for (let i = 0; i < S.dataN; i++) setTimeout(() => addTok('data'), i * 60);
  setTimeout(() => {
    addTok('fs', {from: cache.position.clone().add(V(0, 1.6, 0)), dur: 0.9 * T, color: S.mix.prod ? C.pink : C.lime});
    addTok('git', {from: gitfile.position.clone().add(V(0, 0.8, 0)), dur: 0.9 * T});
  }, 250);
}
async function stopVm() {
  if (S.vm !== 'running') return;
  stage(VMBOX);
  log('<b>lns stop agent</b> — sync, release volumes, power off', C.amber);
  term('volumes', '<span class="pr">$</span> lns stop agent\n<span class="am">stopped run agent</span> · upper.img kept');
  setState('stopped');
  clawd.mood('sleep', 0).say('zzz…', {dur: 2});
  clearTok('tmp');
  await Promise.all([tween(0.7, k => setCore(1 - k)), popIn(ring, false, 0.5), popIn(gate, false, 0.5), popIn(procs.init, false, 0.4), popIn(procs.broker, false, 0.4)]);
  await tween(0.5, k => setVmPresence(1 - k * 0.7));
  setChip('node', false);
}
async function startVm() {
  if (S.vm !== 'stopped') return;
  stage(VMBOX);
  log('<b>lns start agent</b> — same writable layer, policy re-read', C.green);
  term('volumes', '<span class="pr">$</span> lns start agent\n<span class="ok">running</span> · /tmp is empty, files elsewhere are back');
  setState('booting');
  await tween(0.5, k => setVmPresence(0.3 + k * 0.7));
  await Promise.all([popIn(procs.init, true, 0.3), popIn(procs.broker, true, 0.3)]);
  await Promise.all([popIn(ring, true, 0.4), popIn(gate, true, 0.4)]);
  if (S.mix.node) setChip('node', true);
  await tween(0.5, k => setCore(k));
  clawd.mood('happy', 2.4).say('back! /tmp is empty though', {dur: 3});
  setState('running');
}
async function rmVm() {
  if (S.vm === 'running') await stopVm();
  if (S.vm !== 'stopped') return;
  stage([...VMBOX, folder, disk]);
  log('<b>lns rm agent</b> — writable layer, decisions and grants deleted', C.red);
  term('volumes', '<span class="pr">$</span> lns rm agent\nremoved agent · upper.img, decisions.yaml, grants <span class="er">deleted</span>\n<span class="cm"># ~/dev/app and volume "data" are untouched</span>');
  clearTok('upper'); clearTok('ws'); clearTok('data'); clearTok('fs'); clearTok('git');
  await sleep(0.3);
  await Promise.all(vmPieces().map(o => popIn(o, false, 0.45)));
  await tween(0.5, k => setVmPresence(0.3 * (1 - k)));
  resetRunScoped();
  setState('gone');
}
async function newRun(reason = 'lns run') {
  if (S.vm === 'running' || S.vm === 'booting') return;
  if (S.vm === 'stopped') { await rmVm(); }
  S.run++;
  resetRunScoped();
  await boot({fast: true, reason});
}
function resetRunScoped() {
  S.decisions = {http: [], tcp: []};
  S.conn.granted = false; S.conn.declined = false;
  if (gateKey.visible) gateKey.visible = false;
  S.settings = S.mix.prod ? '{"theme":"light","telemetry":false}' : '{"theme":"dark"}';
  S.gitGuest = S.gitHost;
}
async function relaunch(why) {
  if (booting) return;
  if (S.vm === 'gone' || S.vm === 'off') { await newRun(why); return; }
  log(`<b>${esc(why)}</b> — mixins resolve when a run launches`, C.pink);
  if (S.vm === 'running') await stopVm();
  await rmVm();
  S.run++;
  await boot({fast: true, reason: why});
}

// ─────────────────────────────────────────────────────────────── the network path
const W2G = () => new THREE.CatmullRomCurve3([coreP.clone(), V(0.9, 3.75, 0.1), V(2.3, 3.4, 0), GATE.clone().add(V(-0.3, 0, 0))], false, 'catmullrom', 0.4);
const G2N = () => new THREE.CatmullRomCurve3([GATE.clone(), V(3.9, 3.3, 0), NIC.clone()], false, 'catmullrom', 0.4);
let hopTimer;
function hop(i) { S.hop = i; if (current.id === 'network') refreshPanel(); clearTimeout(hopTimer); if (i >= 0) hopTimer = setTimeout(() => { S.hop = -1; if (current.id === 'network') refreshPanel(); }, 6000); }
function flashGate(color) {
  gateScanMat.uniforms.uC.value.set(color);
  gateScanMat.uniforms.uF.value = 1;
}
let inflight = 0;
async function request(k, {cmd, quiet = false} = {}) {
  const d = DEST[k];
  cmd = cmd || `curl https://${d.host}`;
  if (S.vm !== 'running') { log(`<b>${esc(cmd)}</b>: <span style="color:${C.red}">no active run</span>`); fx(V(0, VM.top, 0), 'no running sandbox — boot it first', C.red); return 'none'; }
  inflight++;
  stage(VMFOCUS(), 4.6);
  try {
    log(`<b>${esc(cmd)}</b>`, C.orange);
    const p = new Packet(C.cyan, d.raw ? `TCP ${d.host}` : k === 'claude' ? 'POST /v1/messages' : `CONNECT ${d.host}:443`).at(coreP.clone());
    clawd.turn(0.45).mood('think', 0).say(esc(cmd), {spin: true, dur: 90}).watch(p.g);
    hop(0);
    await p.along(W2G(), 0.9);
    hop(1);
    await sleep(0.15);
    hop(2);
    let v = evaluate(d);
    hop(3);
    if (v.verdict === 'ask') {
      p.color(C.amber).text(d.raw ? `RAW ${d.host}` : `held · ${d.host}`);
      p.hold = 1;
      clawd.mood('wait', 0).say('waiting for your answer…', {spin: true, dur: 90});
      flashGate(C.amber);
      const q = new Packet(C.amber, '', 0.6).at(GATE.clone().add(V(0, 1.2, 0)));
      q.path([VSOCK.clone().add(V(-0.45, 0.2, 0.1))], 0.6).then(async () => { await q.along(pipes.vs1024.curve, 0.8, 1, 0, 'vs1024'); q.die(); });
      let ans;
      if (v.rule?.offer) {
        log(`connector card: <b>github</b> serves ${d.host}`, C.gold);
        clawd.say('the github connector is asking you…', {spin: true, dur: 90});
        ans = await askCard({
          kind: 'Connector · github', title: `CONNECT ${d.host}:443`,
          text: `The <b>github</b> connector can serve this destination. Grant its <b>Personal access token</b> method to run <b>agent</b>? The token is injected at the proxy; the workload keeps a placeholder.`,
          buttons: S.conn.connected ? [['grant', 'Grant to this run', 'al st'], ['decline', 'Decline', 'dn']] : [['connect', 'Connect first…', 'al'], ['decline', 'Decline', 'dn']],
        });
        if (ans === 'grant') { await grantConnector(false); v = {verdict: 'allow', src: 'connector'}; }
        else if (ans === 'connect') { log('run <b>lns connector connect github</b> in a terminal first', C.gold); v = {verdict: 'deny', src: 'connector'}; term('connector', '<span class="cm"># the card cannot take a secret — connect from a terminal:</span>\n<span class="pr">$</span> lns connector connect github'); }
        else { S.conn.declined = true; v = {verdict: 'deny', src: 'connector'}; log('connector <b>declined</b> for run agent', C.red); }
      } else {
        log(`${d.raw ? 'RAW card' : 'approval card'}: <b>${d.raw ? 'TCP ' + d.host : 'CONNECT ' + d.host + ':443'}</b>`, C.amber);
        ans = await askCard({
          raw: d.raw,
          title: d.raw ? `TCP ${d.host}` : `CONNECT ${d.host}:443`,
          text: d.raw
            ? `<b>RAW TCP 5432</b>: lns cannot read this traffic, so it cannot inspect it or inject credentials. Allowing always writes a port-scoped <code>egress.tcp</code> rule.`
            : `No rule decides this destination, so the request is <b>held at the proxy</b> until you answer. “Always” writes the rule into this run’s <b>decisions.yaml</b>.`,
        });
        const allow = ans.startsWith('allow');
        if (ans.endsWith('always')) {
          const rule = {match: d.host, verdict: allow ? 'allow' : 'deny', description: 'approved during a run', fresh: true};
          (d.raw ? S.decisions.tcp : S.decisions.http).push(rule);
          log(`decisions.yaml += <b>${rule.verdict} ${d.host}</b>`, C.amber);
        }
        if (ans === 'timeout') log(`no answer in 60s → <b>denied</b> (the question stays listed)`, C.red);
        v = {verdict: allow ? 'allow' : 'deny', src: 'decisions', once: ans.endsWith('once')};
      }
      const a = new Packet(v.verdict === 'allow' ? C.green : C.red, '', 0.6).at(pipes.vs1024.curve.getPointAt(0));
      a.along(pipes.vs1024.curve, 0.7, 0, 1, 'vs1024').then(() => a.die());
      await sleep(0.7);
      p.hold = 0;
      refresh();
    }
    flashGate(VCOL[v.verdict] || C.cyan);
    if (v.verdict === 'deny') {
      p.color(C.red).text(d.raw ? 'refused' : '403 Forbidden');
      burst(p.pos.clone(), C.red);
      clawd.mood('ouch', 3).say(d.raw ? 'refused… no rule lets me in' : '403 — the policy said no', {dur: 3.2});
      fx(p.pos.clone().add(V(0, 0.6, 0)), `denied · ${SRC[v.src]?.name || 'policy'}`, C.red);
      log(`egress <b style="color:${C.red}">deny</b> ${d.host} <u>by ${SRC[v.src]?.name || 'policy'}</u>`);
      await p.along(W2G(), 0.8, 1, 0);
      burst(coreP.clone(), C.red, 0.8);
      p.die();
      term('network', `<span class="pr">$</span> ${esc(cmd)}\n<span class="er">${d.raw ? 'connection refused' : 'curl: (56) CONNECT tunnel failed, response 403'}</span>`);
      hop(-1);
      return 'deny';
    }
    const inject = !d.raw && S.conn.granted && d.host === 'api.github.com';
    p.color(C.green).text(d.raw ? `splice · ${d.host}` : d.host);
    if (inject) {
      const kp = new Packet(C.gold, '', 0.7).at(GATE_KEY_POS.clone());
      await kp.to(p.pos.clone(), 0.45); kp.die();
      p.color(C.gold).text('Authorization: Bearer ••••••');
      burst(p.pos.clone(), C.gold, 0.9);
      fx(p.pos.clone().add(V(0, 0.7, 0)), 'placeholder → real token', C.gold);
      log('proxy injected <b>bearer_header</b> for api.github.com', C.gold);
    }
    log(`egress <b style="color:${C.green}">allow</b> ${d.host} <u>by ${SRC[v.src]?.name || 'your answer'}${v.once ? ' (once)' : ''}</u>`);
    clawd.mood('think', 0).say(`allowed → ${d.host}`, {spin: true, dur: 90});
    stage([GATE, nat, d.pos.clone().add(V(0, d.h + 0.6, 0))], 4.4);
    hop(4);
    await p.along(G2N(), 0.45);
    hop(5);
    await p.along(pipes.net.curve, 0.55, 0, 1, 'net');
    hop(6);
    await p.along(pipes['to-' + k].curve, 0.9, 0, 1, 'to-' + k);
    burst(d.beacon.getWorldPosition(V(0, 0, 0)), C.green, 0.8);
    d.flash = 1;
    const code = d.raw ? 'connected' : (k === 'github' ? (inject ? '200 · {"login":"you"}' : '401 Unauthorized') : '200 OK');
    p.color(inject || k !== 'github' ? C.green : C.amber).text(code);
    stage(VMFOCUS(), 4.6);
    await p.along(pipes['to-' + k].curve, 0.7, 1, 0, 'to-' + k);
    await p.along(pipes.net.curve, 0.45, 1, 0, 'net');
    await p.along(G2N(), 0.3, 1, 0);
    await p.along(W2G(), 0.6, 1, 0);
    burst(coreP.clone(), C.green, 0.8);
    p.die();
    if (k === 'github' && !inject) clawd.mood('sad', 3).say('401… I have no token in here', {dur: 3.2});
    else clawd.mood('happy', 2.6).say(inject ? 'authenticated! I never saw the token' : k === 'claude' ? 'the model answered ✓' : `${esc(code)} ✓`, {dur: 3});
    term('network', `<span class="pr">$</span> ${esc(cmd)}\n<span class="ok">${esc(code)}</span>`);
    if (k === 'github') term('connector', `<span class="pr">$</span> gh api user\n${inject ? '<span class="ok">{ "login": "you", … }</span>' : '<span class="er">HTTP 401: Bad credentials</span>'}`);
    return 'allow';
  } finally { inflight--; clawd.watch(null).turn(0); }
}

async function dnsLookup(host) {
  if (S.vm !== 'running') return request('evil');
  stage(VMFOCUS(), 4.6);
  log(`<b>nslookup ${host}</b> → UDP 53 → DNS stub :5355`, C.orange);
  const p = new Packet(C.cyan, `DNS ${host}`, 0.75).at(coreP.clone());
  clawd.turn(0.45).mood('think', 0).say(`nslookup ${host}`, {spin: true, dur: 30}).watch(p.g);
  await p.along(W2G(), 0.8);
  const v = evaluate({host});
  if (v.verdict === 'deny') {
    p.color(C.red).text('NXDOMAIN'); burst(p.pos.clone(), C.red);
    fx(p.pos.clone().add(V(0, 0.6, 0)), 'denied names never resolve', C.red);
    await p.along(W2G(), 0.7, 1, 0); p.die();
    clawd.watch(null).turn(0).mood('surprised', 2.6).say('NXDOMAIN? it doesn’t exist for me', {dur: 3});
    term('network', `<span class="pr">$</span> nslookup ${host}\n<span class="er">** server can't find ${host}: NXDOMAIN</span>`);
  } else {
    p.color(C.green);
    await p.along(G2N(), 0.4); await p.along(pipes.net.curve, 0.5, 0, 1, 'net'); p.text('A 104.16.x.x');
    await p.along(pipes.net.curve, 0.5, 1, 0, 'net'); await p.along(G2N(), 0.3, 1, 0); await p.along(W2G(), 0.6, 1, 0); p.die();
    clawd.watch(null).turn(0).mood('happy').say('resolved ✓');
    term('network', `<span class="pr">$</span> nslookup ${host}\n<span class="ok">Address: 104.16.x.x</span>`);
  }
}
async function bypass() {
  if (S.vm !== 'running') return request('evil');
  stage(VMFOCUS(), 4.6);
  log(`<b>curl --noproxy '*' https://1.1.1.1</b> — try to skip the proxy`, C.orange);
  const p = new Packet(C.cyan, 'direct → 1.1.1.1:443').at(coreP.clone());
  clawd.turn(0.45).mood('think', 0).say('sneaking past the proxy…', {spin: true, dur: 30}).watch(p.g);
  await p.to(V(2.2, 3.6, 0.9), 0.6);
  p.text('nftables: redirect → :3129');
  burst(p.pos.clone(), C.cyan, 0.7);
  await p.to(GATE.clone().add(V(-0.3, 0, 0.2)), 0.5);
  p.color(C.red).text('no SNI → denied');
  burst(p.pos.clone(), C.red);
  fx(p.pos.clone().add(V(0, 0.6, 0)), 'there is no route around the proxy', C.red);
  log(`transparent listener: <b style="color:${C.red}">tls-no-sni</b> 1.1.1.1:443`);
  await p.along(W2G(), 0.7, 1, 0); p.die();
  clawd.watch(null).turn(0).mood('ouch', 3).say('nope — nftables caught me', {dur: 3.2});
  term('network', `<span class="pr">$</span> curl --noproxy '*' https://1.1.1.1\n<span class="er">curl: (35) TLS connect error</span>\n<span class="cm"># nftables redirected it anyway; with no host name the proxy refuses it</span>`);
}
async function inbound() {
  if (S.vm !== 'running') { fx(browser.position.clone().add(V(0, 2.4, 0)), 'connection refused: no running sandbox', C.red); return; }
  stage([browser, svc, VSOCK, coreP]);
  log('<b>GET localhost:8642</b> → vsock 1030 → guest 127.0.0.1:8642', C.pink);
  const p = new Packet(C.pink, 'GET / :8642').at(pipes.port.curve.getPointAt(0));
  await p.along(pipes.port.curve, 0.9, 0, 1, 'port');
  await p.along(pipes.vs1030.curve, 0.9, 0, 1, 'vs1030');
  await p.path([procs.broker.position.clone().add(V(0, 0.3, 0))], 0.45);
  p.text('dial 127.0.0.1:8642');
  clawd.watch(p.g).mood('surprised', 2);
  await p.path([coreP.clone()], 0.5);
  clawd.mood('happy', 2.4).say('someone visited my dev server!', {dur: 3});
  burst(coreP.clone(), C.pink, 0.8);
  p.text('200 · <html>');
  await p.path([procs.broker.position.clone().add(V(0, 0.3, 0)), VSOCK.clone().add(V(0.45, -0.18, 0))], 0.7);
  await p.along(pipes.vs1030.curve, 0.7, 1, 0, 'vs1030');
  await p.along(pipes.port.curve, 0.7, 1, 0, 'port');
  burst(p.pos.clone(), C.pink, 0.8);
  p.die(); clawd.watch(null);
  term('network', `<span class="pr">$</span> curl localhost:8642\n<span class="ok">200 OK</span> <span class="cm"># inbound needs no egress rule — spec.ports published it</span>`);
}

// ─────────────────────────────────────────────────────────────── connector steps
async function installConnector() {
  if (S.conn.installed) return;
  stage([vault, svc], 3.2);
  S.conn.installed = true;
  log('<b>lns connector install ./connectors/github</b> — installing grants nothing', C.gold);
  term('connector', '<span class="pr">$</span> lns connector install ./connectors/github\n<span class="ok">installed</span> github · serves api.github.com, github.com\n<span class="cm"># its destinations now ASK instead of guessing</span>');
  burst(vault.position.clone().add(V(0, 1.2, 0)), C.gold);
  refresh();
}
async function connectConnector() {
  if (!S.conn.installed) await installConnector();
  if (S.conn.connected) return;
  stage([vault, svc], 3.2);
  S.conn.connected = true;
  log('<b>lns connector connect github</b> — token stored on this Mac', C.gold);
  term('connector', '<span class="pr">$</span> lns connector connect github\nPersonal access token: <span class="cm">(input hidden)</span>\n<span class="ok">connected</span> github as “github”');
  vault.userData.ring.material.color.copy(col(C.gold, 3.5));
  keyObj.scale.setScalar(1.35);
  burst(keyObj.getWorldPosition(V(0, 0, 0)), C.gold, 1);
  refresh();
}
async function grantConnector(fromTerminal = true) {
  if (!S.conn.connected) await connectConnector();
  if (S.conn.granted) return;
  stage([vault, svc, VSOCK, GATE_KEY_POS]);
  if (fromTerminal) term('connector', '<span class="pr">$</span> lns connector grant github --run agent\n  opens    api.github.com\n  injects  GH_TOKEN as bearer_header on api.github.com\nGrant? <span class="ok">yes</span>');
  S.conn.granted = true; S.conn.declined = false;
  log('<b>granted</b> github to run agent — value sent to the proxy over vsock 1024', C.gold);
  const k = new Packet(C.gold, 'token → proxy', 0.8).at(keyObj.getWorldPosition(V(0, 0, 0)));
  await k.along(pipes.vault.curve, 0.6, 0, 1, 'vault');
  await k.along(pipes.vs1024.curve, 0.9, 0, 1, 'vs1024');
  await k.to(GATE_KEY_POS.clone(), 0.5);
  k.die();
  gateKey.position.copy(GATE_KEY_POS);
  gateKey.visible = true;
  clawd.watch(gateKey).mood('surprised', 2.4).say('the proxy holds the key, not me', {dur: 3.2});
  setTimeout(() => clawd.watch(null), 2500);
  burst(GATE_KEY_POS.clone(), C.gold);
  refresh();
}
function forgetConnector() {
  if (!S.conn.granted && !S.conn.declined) return;
  S.conn.granted = false; S.conn.declined = false;
  gateKey.visible = false;
  log('<b>lns connector forget github --run agent</b> — injection disarmed', C.gold);
  term('connector', '<span class="pr">$</span> lns connector forget github --run agent\n<span class="ok">forgot</span> · the next request asks again');
  burst(GATE_KEY_POS.clone(), C.red, 0.8);
  refresh();
}

// ─────────────────────────────────────────────────────────────── filesystem actions
async function writeFile(where) {
  if (S.vm !== 'running') { fx(V(0, VM.top, 0), 'no running sandbox', C.red); return; }
  stage(where === 'ws' ? [coreP, folder, plates['p-ws']] : where === 'data' ? [coreP, disk, plates['p-data']] : [coreP, slot.upper(0), plates['p-tmp']], 3);
  const target = {ws: '/workspace/notes.md', data: '/opt/data/app.db', upper: '/var/cache/app/x', tmp: '/tmp/scratch'}[where];
  log(`workload writes <b>${target}</b>`, tokColor[where]);
  clawd.mood('think', 1.2).say(`writing ${target}`, {spin: true, dur: 1.4}).turn(-0.4);
  setTimeout(() => clawd.turn(0).mood('happy', 2).say({ws: 'saved — it’s on your Mac too', data: 'saved to the volume', upper: 'saved in my own layer', tmp: 'saved in RAM'}[where], {dur: 2.6}), 900);
  const from = coreP.clone();
  if (where === 'ws') {
    const m = addTok('ws', {from, dur: 0.7});
    await sleep(0.7);
    const p = new Packet(C.teal, 'virtio-fs', 0.7).at(SOCK.ws.clone());
    await p.along(pipes.ws.curve, 0.8, 1, 0, 'ws'); p.die();
    addTok('host');
    fx(folder.position.clone().add(V(0, 2.4, 0)), 'already on your Mac', C.teal);
    term('volumes', `<span class="pr">$</span> echo hi > ${target}\n<span class="ok">✓</span> <span class="cm"># same file, both sides, instantly</span>`);
  } else if (where === 'data') {
    addTok('data', {from, dur: 0.7});
    await sleep(0.7);
    const p = new Packet(C.blue, '/dev/vdc', 0.7).at(SOCK.data.clone());
    await p.along(pipes.data.curve, 0.8, 1, 0, 'data'); p.die();
    S.dataN++; setDiskFill();
    term('volumes', `<span class="pr">$</span> sqlite3 ${target} 'insert …'\n<span class="ok">✓</span> <span class="cm"># blocks written to ~/.lns/volumes/data.img</span>`);
  } else {
    addTok(where, {from, dur: 0.7});
    term('volumes', `<span class="pr">$</span> echo hi > ${target}\n<span class="ok">✓</span> <span class="cm"># ${where === 'tmp' ? 'RAM only' : 'lands in upper.img'}</span>`);
  }
}
S.dataN = 1;
function setDiskFill() {
  const a = Math.min(Math.PI * 2 - 0.01, 0.35 + S.dataN * 0.55);
  diskFill.geometry.dispose();
  diskFill.geometry = new THREE.RingGeometry(0.34, 0.92, 64, 1, 0, a);
  burst(disk.position.clone().add(V(0, 1.2, 0)), C.blue, 0.8);
}
async function editOnHost() {
  stage([folder, plates['p-ws']], 3);
  log('you edit <b>~/dev/app/README.md</b> in your editor', C.teal);
  const m = tok.host[2];
  if (m) tween(0.6, k => m.material.emissiveIntensity = 1.1 + Math.sin(k * Math.PI) * 2.5);
  const p = new Packet(C.teal, 'README.md', 0.7).at(pipes.ws.curve.getPointAt(0));
  await p.along(pipes.ws.curve, 0.8, 0, 1, 'ws');
  if (S.vm === 'running') {
    await p.to(plates['p-ws'].position.clone().add(V(0, 0.4, 0)), 0.4);
    const g = tok.ws[2];
    if (g) tween(0.6, k => g.material.emissiveIntensity = 1.1 + Math.sin(k * Math.PI) * 2.5);
    fx(plates['p-ws'].position.clone().add(V(0, 0.9, 0)), 'the guest sees it live', C.teal);
    clawd.watch(plates['p-ws']).mood('surprised', 2.4).say('README just changed under me!', {dur: 3});
    setTimeout(() => clawd.watch(null), 2600);
    term('mounts', '<span class="pr">guest$</span> cat /workspace/README.md\n# app <span class="ok">(edited on the host a second ago)</span>');
  } else term('mounts', '<span class="cm"># the edit is on your disk; the next run sees it</span>');
  p.die();
}
async function catEnv() {
  if (S.vm !== 'running') return fx(V(0, VM.top, 0), 'no running sandbox', C.red);
  stage([coreP, plates['p-ws']], 3);
  log('workload reads <b>/workspace/.env</b>', C.orange);
  const p = new Packet(C.orange, 'open(".env")', 0.7).at(coreP.clone());
  clawd.turn(-0.5).mood('think', 0).say('cat /workspace/.env', {spin: true, dur: 10}).watch(p.g);
  const masked = tok.ws.find(m => m.userData.masked);
  await p.path([masked ? masked.position.clone().add(V(0, 0.3, 0)) : plates['p-ws'].position.clone()], 0.8);
  p.color(C.red).text('EACCES'); burst(p.pos.clone(), C.red);
  fx(p.pos.clone().add(V(0, 0.6, 0)), 'excluded: masked, not absent', C.red);
  await p.path([coreP.clone()], 0.6); p.die();
  clawd.watch(null).turn(0).mood('sad', 3).say('permission denied — .env is masked', {dur: 3.2});
  term('mounts', '<span class="pr">guest$</span> ls -a /workspace\n.  ..  <span class="er">.env</span>  README.md  package.json  server.js\n<span class="pr">guest$</span> cat /workspace/.env\n<span class="er">cat: /workspace/.env: Permission denied</span>');
}
async function copyUp() {
  if (S.vm !== 'running') return fx(V(0, VM.top, 0), 'no running sandbox', C.red);
  stage([coreP, slot.upper(0), layers.image[1]], 3);
  log('workload edits <b>/etc/motd</b> (from an image layer)', C.orange);
  const p = new Packet(C.violet, 'read /etc/motd', 0.7).at(coreP.clone());
  clawd.mood('think', 1.5).say('editing /etc/motd', {spin: true, dur: 1.5}).watch(p.g);
  await p.path([layers.image[1].position.clone().add(V(1.6, 0.1, 1.2))], 0.7);
  burst(p.pos.clone(), C.violet, 0.7);
  p.color(C.amber).text('copy-up');
  await p.path([slot.upper(tok.upper.length).add(V(0, 0.2, 0))], 0.6); p.die();
  addTok('upper');
  fx(slot.upper(0).add(V(0, 0.8, 0)), 'lower stays read-only', C.amber);
  clawd.watch(null).mood('happy').say('done — the image never changed');
  term('mounts', '<span class="pr">guest$</span> echo hello >> /etc/motd\n<span class="ok">✓</span> <span class="cm"># overlay copied the file up into the writable layer</span>');
}
async function catCmdline() {
  if (S.vm !== 'running') return fx(V(0, VM.top, 0), 'no running sandbox', C.red);
  stage([procs.init, coreP], 3);
  term('mounts', '<span class="pr">guest$</span> cat /proc/cmdline\nconsole=hvc0 upper.dev=/dev/vda composefs.descriptor.dev=/dev/vdb …\n<span class="cm"># lns-init mounted a sanitized copy: the boot token is gone</span>');
  fx(procs.init.position.clone().add(V(0, 1.1, 0)), 'boot token scrubbed', C.cyan);
  clawd.mood('think', 2.4).say('no secrets in /proc/cmdline', {dur: 2.8});
  burst(procs.init.position.clone().add(V(0, 0.4, 0)), C.cyan, 0.6);
}
async function execSession() {
  if (S.vm !== 'running') return fx(V(0, VM.top, 0), 'no running sandbox', C.red);
  stage([svc, VSOCK, procs.broker, coreP]);
  log('<b>lns exec agent -- sh</b> — a second session over vsock 1029', C.cyan);
  const p = new Packet(C.cyan, 'exec session').at(pipes.vs1029.curve.getPointAt(0));
  await p.along(pipes.vs1029.curve, 0.9, 0, 1, 'vs1029');
  await p.path([procs.broker.position.clone().add(V(0, 0.3, 0))], 0.4);
  p.text('sh · same env, user, mounts');
  clawd.watch(p.g).mood('surprised', 2.6).say('a new shell appeared next to me', {dur: 3});
  setTimeout(() => clawd.watch(null), 2600);
  await p.path([coreP.clone().add(V(0.6, -0.4, 0.8))], 0.5);
  burst(p.pos.clone(), C.cyan, 0.6);
  await sleep(0.8); p.die();
  term('supervisor', '<span class="pr">$</span> lns exec agent -- id\nuid=65534(sandbox) gid=65534(sandbox)');
}
async function seedFilesets() {
  if (S.vm !== 'running') return newRun();
  stage([cache, gitfile, plates['p-fs'], plates['p-git']]);
  log('filesets are written at <b>launch</b>, before the workload starts', C.lime);
  clearTok('fs'); clearTok('git');
  await sleep(0.3);
  pipes.content.pulse = 1;
  addTok('fs', {from: cache.position.clone().add(V(0, 1.6, 0)), dur: 1.0, color: S.mix.prod ? C.pink : C.lime});
  addTok('git', {from: gitfile.position.clone().add(V(0, 0.8, 0)), dur: 1.0});
  S.gitGuest = S.gitHost;
  await sleep(1.0);
  clawd.mood('happy').say('my settings arrived');
  term('filesets', `<span class="pr">guest$</span> cat /opt/app/settings.json\n${esc(S.settings)}\n<span class="pr">guest$</span> git config user.name\nyou${S.gitGuest > 1 ? ' (v' + S.gitGuest + ')' : ''}`);
}
function editGitHost() {
  S.gitHost++;
  stage([gitfile, plates['p-git']], 3);
  log(`you edit <b>~/.gitconfig</b> on your Mac (v${S.gitHost})`, C.lime);
  tween(0.8, k => gitfile.userData.mat.emissiveIntensity = 0.3 + Math.sin(k * Math.PI) * 2.5);
  fx(gitfile.position.clone().add(V(0, 1.8, 0)), 'nothing flows: hostPath is a snapshot', C.lime);
  if (S.vm === 'running') { fx(plates['p-git'].position.clone().add(V(0, 0.8, 0)), `guest still has v${S.gitGuest}`, C.amber); clawd.mood('think', 2.6).say(`my gitconfig is still v${S.gitGuest}`, {dur: 3}); }
  term('filesets', `<span class="cm"># host: ~/.gitconfig is now v${S.gitHost}</span>\n<span class="pr">guest$</span> git config user.name\nyou${S.gitGuest > 1 ? ' (v' + S.gitGuest + ')' : ''} <span class="cm"># read once at launch (v${S.gitGuest})</span>`);
  refresh();
}
async function editSettings() {
  if (S.vm !== 'running') return fx(V(0, VM.top, 0), 'no running sandbox', C.red);
  stage([coreP, plates['p-fs']], 3);
  const root = S.fsRoot || S.mix.prod;
  const p = new Packet(C.orange, 'write settings.json', 0.7).at(coreP.clone());
  clawd.watch(p.g);
  await p.path([slot.fs(0).add(V(0, 0.3, 0))], 0.8);
  if (root) {
    p.color(C.red).text('EACCES'); burst(p.pos.clone(), C.red);
    fx(p.pos.clone().add(V(0, 0.6, 0)), 'owner: root — a pinned input', C.red);
    clawd.watch(null).mood('sad', 3).say('settings.json is pinned (owner: root)', {dur: 3});
    term('filesets', '<span class="pr">guest$</span> echo {} > /opt/app/settings.json\n<span class="er">sh: can\'t create /opt/app/settings.json: Permission denied</span>');
  } else {
    p.color(C.green).text('written'); burst(p.pos.clone(), C.green, 0.8);
    S.settings = '{"theme":"hacked"}';
    clawd.watch(null).mood('happy').say('rewrote my settings');
    fx(p.pos.clone().add(V(0, 0.6, 0)), 'owner: workload — it may rewrite it', C.green);
    term('filesets', '<span class="pr">guest$</span> echo \'{"theme":"hacked"}\' > /opt/app/settings.json\n<span class="ok">✓</span> <span class="cm"># the artifact is untouched; the next boot seeds it fresh</span>');
  }
  await sleep(0.4); p.die();
}
async function secondRun() {
  if (ghost.visible) return;
  stage([folder, disk, ghost.position.clone().add(V(0, 2, 0))]);
  log('<b>lns run --name agent-2</b> with the same bind and volume', C.cyan);
  ghost.visible = true;
  ghost.scale.setScalar(0.001);
  await tween(0.5, k => ghost.scale.setScalar(Math.max(1e-3, k)), backOut);
  const a = new Packet(C.teal, 'bind . → shared', 0.8).at(folder.position.clone().add(V(0.6, 1, 1)));
  await a.to(ghost.position.clone().add(V(-1.5, 1.4, 0)), 0.9, 0.8);
  burst(a.pos.clone(), C.green, 0.7); a.text('✓ virtio-fs serves both'); await sleep(0.6); a.die();
  const b = new Packet(C.blue, 'volume data', 0.8).at(disk.position.clone().add(V(0.6, 1, 0.4)));
  await b.to(ghost.position.clone().add(V(-1.4, 1.0, 0.5)), 0.9, 0.8);
  b.color(C.red).text('volume "data" in use'); burst(b.pos.clone(), C.red);
  fx(ghost.position.clone().add(V(0, 3.1, 0)), S.vm === 'gone' ? 'free now — the lease went with lns rm' : 'held by run agent (even while stopped)', S.vm === 'gone' ? C.green : C.red);
  term('volumes', `<span class="pr">$</span> lns run --name agent-2 -v data:/opt/data\n${S.vm === 'gone' ? '<span class="ok">running</span> agent-2' : '<span class="er">error: volume "data" in use by run agent</span>\n<span class="cm"># binds are shared live; a named volume is one guest\'s disk</span>'}`);
  await sleep(1.4); b.die();
  await sleep(1.6);
  await tween(0.5, k => ghost.scale.setScalar(Math.max(1e-3, 1 - k)));
  ghost.visible = false;
}
function toggleOwnerRoot() {
  S.fsRoot = !S.fsRoot;
  log(`fileset /opt/app <b>owner: ${S.fsRoot ? 'root' : 'workload'}</b>`, C.lime);
  refresh();
}
async function toggleMixin(k) {
  if (booting) return;
  S.mix[k] = !S.mix[k];
  const L = LAYERS.find(l => l.k === k);
  if (L && S.mix[k]) {
    const s = L.g.position.clone();
    await tween(0.5, t => { L.g.position.lerpVectors(s, V(0, VM.top + 0.6, 0), t); L.g.scale.setScalar(1 - t * 0.6); }, easeIO);
    burst(V(0, VM.top + 0.3, 0), C.pink, 1.6);
    tween(0.5, t => { L.g.position.lerpVectors(V(0, VM.top + 0.6, 0), L.home, t); L.g.scale.setScalar(0.4 + t * 0.6); }, easeOut);
  }
  if (k === 'prod') S.settings = S.mix.prod ? '{"theme":"light","telemetry":false}' : '{"theme":"dark"}';
  const flags = ['anthropic', 'team', 'prod'].filter(m => S.mix[m]).map(m => ({anthropic: '--mixin ./mixins/anthropic', team: '--mixin ./team-egress.yaml', prod: '--mixin ./mixins/prod-settings'}[m]));
  refresh();
  if (k === 'node') log(`${S.mix.node ? 'added' : 'removed'} <b>./mixins/node</b> in spec.mixins`, C.pink);
  await relaunch(['lns run', ...flags].join(' '));
}

// ─────────────────────────────────────────────────────────────── panels
function yaml(lines) {
  return '<pre class="yaml">' + lines.map(L => {
    const o = typeof L === 'string' ? {t: L} : L;
    let t = esc(o.t);
    t = t.replace(/(#.*)$/, '<span class="cm">$1</span>')
      .replace(/^(\s*-?\s*)([\w.~\/-]+)(:)(?=\s|$)/, '$1<span class="k">$2</span>$3')
      .replace(/(:\s)(allow)\b/, '$1<span class="v-a">$2</span>').replace(/(:\s)(deny)\b/, '$1<span class="v-d">$2</span>')
      .replace(/(:\s)(\d[\w.]*)$/, '$1<span class="n">$2</span>');
    const src = o.src ? `<span class="src">${o.src}</span>` : '';
    return `<span class="l${o.hl ? ' hl' : ''}${o.dim ? ' dim' : ''}${o.fresh ? ' new' : ''}${o.ch ? ' click' : ''}" ${o.ch ? `data-ch="${o.ch}"` : ''} style="${o.c ? '--hc:' + o.c : ''}">${src}${t || ' '}</span>`;
  }).join('') + '</pre>';
}
const SANDBOX_YAML = [
  {t: 'apiVersion: lns.run/v1'}, {t: 'kind: sandbox'}, {t: 'name: agent'}, {t: 'spec:'},
  {t: '  image: node:22-slim', ch: 'supervisor'}, {t: '  command: claude', ch: 'supervisor'}, {t: '  workdir: /workspace', ch: 'mounts'},
  {t: '  resources:', ch: 'supervisor'}, {t: '    cpu: 2', ch: 'supervisor'}, {t: '    memory: 2Gi', ch: 'supervisor'},
  {t: '  volumes:', ch: 'volumes', k: 'vol'}, {t: '    - type: bind', ch: 'mounts', k: 'vol'}, {t: '      source: .', ch: 'mounts', k: 'vol'}, {t: '      target: /workspace', ch: 'mounts', k: 'vol'}, {t: '      exclude: [.env]', ch: 'mounts', k: 'vol'},
  {t: '    - type: volume', ch: 'volumes', k: 'vol'}, {t: '      source: data', ch: 'volumes', k: 'vol'}, {t: '      target: /opt/data', ch: 'volumes', k: 'vol'},
  {t: '  filesets:', ch: 'filesets', k: 'fs'}, {t: '    - inline:', ch: 'filesets', k: 'fs'}, {t: '        settings.json: |', ch: 'filesets', k: 'fs'}, {t: '          {"theme":"dark"}', ch: 'filesets', k: 'fs'}, {t: '      guestPath: /opt/app', ch: 'filesets', k: 'fs'},
  {t: '    - hostPath: ~/.gitconfig', ch: 'filesets', k: 'fs'}, {t: '      guestPath: /etc/gitconfig', ch: 'filesets', k: 'fs'}, {t: '      optional: true', ch: 'filesets', k: 'fs'},
  {t: '  ports:', ch: 'network', k: 'net'}, {t: '    - host: 8642', ch: 'network', k: 'net'}, {t: '      container: 8642', ch: 'network', k: 'net'},
  {t: '  egress:', ch: 'policy', k: 'pol'}, {t: '    http:', ch: 'policy', k: 'pol'}, {t: '      - match: registry.npmjs.org', ch: 'policy', k: 'pol'}, {t: '        verdict: allow', ch: 'policy', k: 'pol'}, {t: '      - match: telemetry.evil.example', ch: 'policy', k: 'pol'}, {t: '        verdict: deny', ch: 'policy', k: 'pol'},
  {t: '  mixins:', ch: 'mixin', k: 'mix'}, {t: '    - ./mixins/node', ch: 'mixin', k: 'mix'},
];
function term(ch, html) {
  (S.term[ch] = S.term[ch] || []).push(html);
  if (S.term[ch].length > 6) S.term[ch].shift();
  if (current.id === ch) { const t = $('#term'); if (t) { t.innerHTML = S.term[ch].join('\n'); t.scrollTop = 1e6; } }
}
const termBox = (ch, hint) => `<section class="card pane"><h3>Terminal <em>${hint || 'what the workload sees'}</em></h3><pre class="term" id="term">${(S.term[ch] || ['<span class="cm"># try the buttons on the left</span>']).join('\n')}</pre></section>`;

let overviewTab = 'yaml', overviewOpen = false;
const PANELS = {
  overview() {
    if (!overviewOpen) return `<section class="card pane"><h3>The sandbox <em>one lns.yaml</em></h3><button class="btn" data-open="1" style="width:100%;justify-content:space-between">Show the document behind it <span class="k">lns.yaml ▸</span></button></section>`;
    const tabs = `<div class="tabs"><button data-tab="yaml" class="${overviewTab === 'yaml' ? 'on' : ''}">lns.yaml</button><button data-tab="banner" class="${overviewTab === 'banner' ? 'on' : ''}">lns run</button><button data-tab="map" class="${overviewTab === 'map' ? 'on' : ''}">legend</button></div>`;
    let body;
    if (overviewTab === 'yaml') body = yaml(SANDBOX_YAML.map(l => ({...l, c: CH.find(c => c.id === l.ch)?.color})));
    else if (overviewTab === 'banner') body = `<pre class="term" style="max-height:none">${[
      '<span class="pr">$</span> lns run --mixin ./mixins/anthropic', 'lns run', '  Image:     node:22-slim', '  Mixin:     ./mixins/node', '  Mount:     bind . → /workspace (exclude .env)',
      '  Volume:    data → /opt/data', '  Fileset:   inline → /opt/app', '  Fileset:   host file ~/.gitconfig → /etc/gitconfig', '  Resources: 2 vCPU · 2 GiB', '  Flags:     -i -t',
      '  Ports:     127.0.0.1:8642 -> 8642', '  Mixin:     ./mixins/anthropic (--mixin)', '  Egress:    allow api.anthropic.com  [mixins/anthropic]', '             allow *.npmjs.org  [mixins/node]', '             allow registry.npmjs.org  [lns.yaml]', '             deny  telemetry.evil.example  [lns.yaml]',
      '  Decisions: recorded in this run, and removed with it', '<span class="cm">[scripts 1/1] npm install -g @anthropic-ai/claude-code</span>', '<span class="ok">✓</span> running agent'].join('\n')}</pre>`;
    else body = `<div class="rows">${[
      [C.cyan, 'lns itself', 'the microVM, supervisor, proxy gate, service, vsock'], [C.orange, 'your workload', 'and what it writes to its own layer'],
      [C.ice, 'your files and data', 'binds, volumes, filesets, caches'], [C.green, 'allowed', 'traffic the gate lets through'],
      [C.red, 'denied', 'refused at the gate'], [C.gold, 'asking · secret', 'held for your answer, or a real token']]
      .map(([c, t, s]) => `<div class="row on" style="--c:${c}"><span class="ic"></span><span class="tx"><b>${t}</b><small>${s}</small></span></div>`).join('')}</div>`;
    return `<section class="card pane" style="flex:1"><h3>The sandbox <em><button class="btn" data-open="0" style="height:20px;padding:0 6px;font-size:10px">hide</button></em></h3>${tabs}<div class="scroll">${body}</div></section>`;
  },
  supervisor() {
    const rows = BOOT.map(([t, s, pk], i) => `<div class="row click ${S.boot === i ? 'on' : S.boot > i ? 'done' : ''}" data-part="${pk}" style="--c:${i < 2 ? C.green : i < 4 ? C.blue : C.cyan}"><span class="ic">${i + 1}</span><span class="tx"><b>${t}</b><small>${s}</small></span></div>`).join('');
    return `<section class="card pane" style="flex:1"><h3>Boot sequence <em>${S.vm === 'booting' ? 'booting…' : 'press Boot to watch'}</em></h3><div class="scroll"><div class="rows">${rows}</div></div></section>
      <section class="card pane"><h3>Process tree <em>inside the guest</em></h3><pre class="term">${S.vm === 'running' ? `<span class="cy">1</span>  lns-init <span class="cm">(PID 1 → execs the broker)</span>
└ <span class="cy">lns-session-broker</span>  <span class="cm">vsock 1029/1030</span>
  └ <span class="cy">lns-supervisor</span>  <span class="cm">root · nft · proxy · dns</span>
    └ <span class="am">sh -c "claude"</span>  <span class="cm">uid 65534 · Claude Code</span>` : S.vm === 'booting' ? '<span class="cm">booting…</span>' : '<span class="cm">no processes — the VM is powered off</span>'}</pre></section>${termBox('supervisor')}`;
  },
  mounts() {
    const rows = [
      ['/', 'overlay', 'composefs image layers (ro) + upper.img (rw)', C.violet, 'image2'],
      ['/.lens', 'runtime layer', 'supervisor, nft, tools, CA (ro)', C.cyan, 'runtime'],
      ['/workspace', 'bind .', 'virtio-fs lns-bind-0 · live', C.teal, 'p-ws'],
      ['/workspace/.env', 'excluded', 'masked: name visible, reads denied', C.red, 'p-ws'],
      ['/opt/data', 'volume data', 'ext4 on /dev/vdc', C.blue, 'p-data'],
      ['/opt/app/settings.json', 'fileset', 'inline, in the runtime layer', C.lime, 'p-fs'],
      ['/etc/gitconfig', 'fileset', 'hostPath ~/.gitconfig, copied at launch', C.lime, 'p-git'],
      ['/tmp  /run', 'tmpfs', 'RAM, gone on power-off', C.grey, 'p-tmp'],
      ['/proc/cmdline', 'sanitized', 'bind-mounted copy without the boot token', C.cyan, 'init'],
    ].map(([p, s, d, c, pk]) => `<div class="t" data-part="${pk}" style="--c:${c}"><span class="pill" style="--c:${c}">${s}</span><span class="p">${p} <u>· ${d}</u></span></div>`).join('');
    return `<section class="card pane"><h3>Guest filesystem <em>hover a row</em></h3><div class="scroll tree">${rows}</div></section>
      <section class="card pane"><h3>Devices <em>what the hypervisor attached</em></h3><div class="scroll"><table class="tbl"><tr><th>device</th><th>is</th></tr>
      <tr><td>/dev/vda</td><td>upper.img · the writable layer</td></tr><tr><td>/dev/vdb</td><td>composefs descriptor (EROFS, SHA-256 checked)</td></tr><tr><td>/dev/vdc</td><td>volume “data”</td></tr>
      <tr><td>lns-content</td><td>virtio-fs · layer contents, read-only</td></tr><tr><td>lns-bind-0</td><td>virtio-fs · ~/dev/app</td></tr></table></div></section>${termBox('mounts')}`;
  },
  volumes() {
    const Y = '<span class="y">✓</span>', N = '<span class="n">✕</span>', M = s => `<span class="m">${s}</span>`;
    return `<section class="card pane"><h3>Where a write lands <em>and how long it lives</em></h3><div class="scroll"><table class="tbl">
      <tr><th></th><th>stop/start</th><th>lns rm</th><th>2 runs</th></tr>
      <tr><td style="color:${C.teal}">bind</td><td>${Y}</td><td>${Y} your disk</td><td>${Y} shared</td></tr>
      <tr><td style="color:${C.blue}">volume</td><td>${Y}</td><td>${Y}</td><td>${N} in use</td></tr>
      <tr><td style="color:${C.amber}">writable layer</td><td>${Y}</td><td>${N} deleted</td><td>${M('per run')}</td></tr>
      <tr><td style="color:${C.grey}">/tmp</td><td>${N}</td><td>${N}</td><td>${M('per run')}</td></tr>
      <tr><td style="color:${C.lime}">fileset</td><td>${M('re-seeded')}</td><td>${M('in the doc')}</td><td>${M('per run')}</td></tr></table></div></section>
      <section class="card pane"><h3>On your Mac <em>lns volume ls</em></h3><pre class="term">NAME   SIZE   HOLDERS
data   10Gi   ${S.vm === 'gone' ? '<span class="cm">—</span>' : 'agent' + (S.vm === 'stopped' ? ' <span class="am">(stopped)</span>' : '')}
<span class="cm">~/.lns/volumes/data.img · ~/.lns/runs/agent/upper.img${S.vm === 'gone' ? ' (deleted)' : ''}</span></pre></section>${termBox('volumes', 'lns and the guest')}`;
  },
  filesets() {
    const src = [
      ['inline', 'text kept in lns.yaml itself (≤128 KiB a file, 1 MiB total)', C.lime, S.mix.prod ? 'displaced' : 'in use'],
      ['path', 'a directory packed into a layer of the same artifact at lns push', C.lime, 'not used here'],
      ['hostPath', 'one file from the machine that runs it, read once at launch', C.lime, `host v${S.gitHost} · guest v${S.gitGuest}`],
    ].map(([t, s, c, r]) => `<div class="row on" style="--c:${c}"><span class="ic">F</span><span class="tx"><b>${t}</b><small>${s}</small></span><span class="rt">${r}</span></div>`).join('');
    const y = S.mix.prod
      ? yaml([{t: '# lns inspect — /opt/app is claimed twice', c: C.pink}, {t: 'fileset: inline -> /opt/app (owner: root)', hl: true, c: C.pink, src: 'prod-settings'}, {t: '  replaced fileset from the sandbox', dim: true}, {t: 'fileset: host file ~/.gitconfig -> /etc/gitconfig', src: 'lns.yaml'}])
      : yaml([{t: '  filesets:'}, {t: '    - inline:', hl: true, c: C.lime}, {t: '        settings.json: |', hl: true, c: C.lime}, {t: '          {"theme":"dark"}', hl: true, c: C.lime}, {t: '      guestPath: /opt/app', hl: true, c: C.lime},
        {t: `      owner: ${S.fsRoot ? 'root' : 'workload'}`, hl: S.fsRoot, c: C.amber, fresh: false}, {t: '    - hostPath: ~/.gitconfig'}, {t: '      guestPath: /etc/gitconfig'}, {t: '      optional: true'}]);
    return `<section class="card pane"><h3>Three sources <em>exactly one per entry</em></h3><div class="rows">${src}</div></section>
      <section class="card pane"><h3>${S.mix.prod ? 'Displacement' : 'lns.yaml'} <em>${S.mix.prod ? 'one guest path, one owner' : 'the fileset entries'}</em></h3><div class="scroll">${y}</div></section>${termBox('filesets')}`;
  },
  network() {
    const hops = [
      ['socket', 'the workload opens a TCP connection (or a DNS query)', C.orange],
      ['nftables', 'inet lens_sandbox redirects TCP → :3129, DNS → :5355, drops the rest', C.cyan],
      ['proxy', 'reads the host name: CONNECT line, TLS SNI, or HTTP Host', C.cyan],
      ['policy', 'first matching rule wins; no match holds it and asks', C.amber],
      ['eth0', 'the proxy dials out itself over virtio-net', C.green],
      ['NAT', 'the Mac’s Virtualization.framework NAT', C.green],
      ['destination', 'the response comes back the same way', C.green],
    ].map(([t, s, c], i) => `<div class="row ${S.hop === i ? 'on' : S.hop > i ? 'done' : ''}" style="--c:${c}"><span class="ic">${i + 1}</span><span class="tx"><b>${t}</b><small>${s}</small></span></div>`).join('');
    return `<section class="card pane" style="flex:1"><h3>One outbound request <em>hop by hop</em></h3><div class="scroll"><div class="rows">${hops}</div></div></section>${termBox('network')}`;
  },
  policy() {
    const rows = Object.entries(DEST).map(([k, d]) => {
      const v = evaluate(d);
      const dec = (d.raw ? S.decisions.tcp : S.decisions.http).find(r => r.match === d.host);
      const cur = dec ? dec.verdict : 'none';
      const srcN = v.verdict === 'ask' ? (v.rule?.offer ? 'connector offer' : 'no rule') : (SRC[v.src]?.name || '');
      return `<tr><td><span style="color:${d.color}">●</span> ${d.host}</td><td><span class="pill" style="--c:${VCOL[v.verdict]}">${v.verdict}</span><div style="font:400 9.5px var(--mono);color:#7d86a0;margin-top:3px">${srcN}</div></td>
        <td><div class="seg3" data-host="${d.host}" data-raw="${d.raw ? 1 : 0}">${['allow', 'none', 'deny'].map(x => `<button data-v="${x}" class="${cur === x ? 'on' : ''}">${x === 'none' ? '—' : x}</button>`).join('')}</div></td></tr>`;
    }).join('');
    const dy = [{t: 'apiVersion: lns.run/v1'}, {t: 'kind: mixin'}, {t: 'name: decisions'}, {t: 'spec:'}, {t: '  egress:'},
      {t: '    http:' + (S.decisions.http.length ? '' : ' []')}, ...S.decisions.http.flatMap(r => [{t: `      - match: ${r.match}`, fresh: r.fresh, hl: true, c: VCOL[r.verdict]}, {t: `        verdict: ${r.verdict}`, hl: true, c: VCOL[r.verdict]}, ...(r.description ? [{t: `        description: ${r.description}`, dim: true}] : [])]),
      {t: '    tcp:' + (S.decisions.tcp.length ? '' : ' []')}, ...S.decisions.tcp.flatMap(r => [{t: `      - match: ${r.match}`, fresh: r.fresh, hl: true, c: VCOL[r.verdict]}, {t: `        verdict: ${r.verdict}`, hl: true, c: VCOL[r.verdict]}])];
    [...S.decisions.http, ...S.decisions.tcp].forEach(r => r.fresh = false);
    return `<section class="card pane"><h3>Every destination <em>verdict · who decided</em></h3><div class="scroll"><table class="tbl"><tr><th>host</th><th>now</th><th>your decision</th></tr>${rows}</table></div></section>
      <section class="card pane" style="flex:1"><h3>decisions.yaml <em>~/.lns/runs/agent/ · strongest source</em></h3><div class="scroll">${yaml(dy)}</div></section>`;
  },
  connector() {
    const c = S.conn;
    const lamp = (on, i, b, s) => `<div class="lamp ${on ? 'on' : ''}"><i>${i}</i><b>${b}</b><small>${s}</small></div>`;
    return `<section class="card pane"><h3>Three facts, three scopes <em>lns connector list</em></h3><div class="lamps">${lamp(c.installed, 'machine', 'installed', 'can be offered')}${lamp(c.connected, 'machine', 'connected', 'token stored')}${lamp(c.granted, 'this run', c.declined ? 'declined' : 'granted', 'may inject')}</div></section>
      <section class="card pane"><h3>./connectors/github <em>kind: connector</em></h3><div class="scroll">${yaml([
        {t: 'apiVersion: lns.run/v1'}, {t: 'kind: connector'}, {t: 'name: github'}, {t: 'spec:'}, {t: '  serves:', hl: c.installed, c: C.gold}, {t: '    - api.github.com', hl: c.installed, c: C.gold}, {t: '    - github.com', hl: c.installed, c: C.gold},
        {t: '  methods:'}, {t: '    - name: token'}, {t: '      label: Personal access token'}, {t: '      auth:', hl: c.connected, c: C.gold}, {t: '        kind: token', hl: c.connected, c: C.gold}, {t: '        help: Create one at github.com/settings/tokens', hl: c.connected, c: C.gold},
        {t: '      egress:', hl: c.granted, c: C.green}, {t: '        http:', hl: c.granted, c: C.green}, {t: '          - match: api.github.com', hl: c.granted, c: C.green}, {t: '            verdict: allow', hl: c.granted, c: C.green},
        {t: '      credentials:', hl: c.granted, c: C.gold}, {t: '        - envVar: GH_TOKEN', hl: c.granted, c: C.gold}, {t: '          placeholder: ghp_LNSPLACEHOLDER000000000000', hl: c.granted, c: C.gold},
        {t: '          injections:', hl: c.granted, c: C.gold}, {t: '            - kind: bearer_header', hl: c.granted, c: C.gold}, {t: '              domain: api.github.com', hl: c.granted, c: C.gold}])}</div></section>${termBox('connector', 'host and guest')}`;
  },
  mixin() {
    const on = k => k === 'sandbox' ? true : k === 'connector' ? S.conn.granted : k === 'decisions' ? (S.decisions.http.length + S.decisions.tcp.length) > 0 : S.mix[k];
    const what = {sandbox: 'image · command · 2 rules · mounts · filesets', node: 'tool node@22 · *.npmjs.org · installs Claude Code', anthropic: 'env ANTHROPIC_BASE_URL · api.anthropic.com', team: 'api.linear.app (saved answers)', prod: 'fileset /opt/app (owner: root)', connector: 'egress + injection, once granted', decisions: `${S.decisions.http.length + S.decisions.tcp.length} rule(s) you answered`};
    const stack = LAYERS.map((L, i) => `<div class="lay ${on(L.k) ? 'on' : ''}" style="--c:${L.color}"><button class="sw" data-mix="${L.k}" ${L.fixed ? 'disabled' : ''} aria-label="toggle ${L.name}"></button><span class="tx"><b>${L.name}</b><small>${what[L.k]}</small></span><span class="pr">${i + 1}</span></div>`).join('');
    const env = [['NPM_CONFIG_CACHE', '/opt/data/npm', 'node', S.mix.node], ['ANTHROPIC_BASE_URL', 'https://api.anthropic.com', 'anthropic', S.mix.anthropic]].filter(e => e[3]);
    const rules = mergedRules().filter(r => !r.offer);
    const out = [{t: 'Sandbox: agent'}, {t: '  image:    node:22-slim', src: 'lns.yaml', c: C.cyan},
      ...env.map(([k, v, s]) => ({t: `  env:      ${k}=${v}`, src: s, c: C.pink, hl: true})),
      {t: '  mount:    bind . -> /workspace', src: 'lns.yaml'}, {t: '  mount:    volume data -> /opt/data', src: 'lns.yaml'},
      S.mix.prod ? {t: '  fileset:  inline -> /opt/app (root)', src: 'prod-settings', c: C.pink, hl: true} : {t: '  fileset:  inline -> /opt/app', src: 'lns.yaml'},
      ...(S.mix.node ? [{t: '  tool:     node@22', src: 'node', c: C.pink, hl: true}] : []),
      ...rules.map(r => ({t: `  egress:   ${r.verdict.padEnd(5)} ${r.match}`, src: SRC[r.src].name.replace('--mixin ', ''), c: SRC[r.src].color, hl: r.src !== 'sandbox'})),
      ...(S.mix.node ? [{t: '  script:   npm install -g @anthropic-ai/claude-code', src: 'node', c: C.pink}] : [])];
    return `<section class="card pane"><h3>The layers <em>toggle a mixin · 1 = weakest</em></h3><div class="scroll"><div class="stk">${stack}</div></div></section>
      <section class="card pane" style="flex:1"><h3>The merge <em>lns inspect -f lns.yaml --mixin …</em></h3><div class="scroll">${yaml(out)}</div></section>
`;
  },
};

// ─────────────────────────────────────────────────────────────── chapters
const CH = [
  {id: 'overview', title: 'The whole machine', color: C.cyan, cam: [V(0.5, 33, 55), V(-1.2, -0.4, 2.2)],
    labels: ['host', 'shell', 'workload', 'gate', 'service', 'folder'],
    lede: 'lns runs your agent, command or OCI image inside a <b>microVM</b> on your own machine. It gets a whole Linux computer, but it only sees what you mount in, and every connection it opens has to pass one gate.',
    body: `<p><b>Left</b>, your Mac. <b>Middle</b>, the <b class="c-cy">microVM</b>, with <b class="c-am">Claude Code</b> working inside and the <b class="c-cy">proxy gate</b> on its wall. <b>Right</b>, the internet. Each tower’s light is what the gate would do: <b class="c-gr">allow</b>, <b class="c-rd">deny</b> or <b class="c-gd">ask</b>.</p>
      <p style="color:#8d97b3">Hover anything to learn what it is · <code>→</code> next chapter</p>`,
    acts: () => [
      ['▶ Take the tour', 'pri', () => startTour()],
      ['<code>claude -p "fix the tests"</code>', '', () => request('claude', {cmd: 'claude -p "fix the tests"'}), C.green],
      ['<code>curl telemetry.evil.example</code>', '', () => request('evil'), C.red],
      ['<code>curl api.linear.app</code>', '', () => request('linear'), C.amber],
    ]},
  {id: 'supervisor', title: 'Boot & the supervisor', color: C.cyan, cam: [V(-9, 16, 25), V(-5.4, 2.4, -2)],
    labels: ['cli', 'service', 'init', 'broker', 'supervisor', 'workload', 'vsock'],
    lede: '<code>lns</code> is a thin client. <b>lns-service</b> does the work, a hypervisor boots a real kernel, and three small static binaries turn that kernel into a cage <b>before</b> your code runs.',
    body: `<p><b class="c-cy">lns-init</b> is PID 1. It checks the root filesystem’s descriptor against a SHA-256 on the kernel command line, mounts the layers, your binds and volumes, then hides its own boot token.</p>
      <p><b class="c-cy">lns-session-broker</b> gets an address by DHCP and serves terminal sessions over <b>vsock</b>, a host↔guest socket that isn’t a network at all.</p>
      <p><b class="c-cy">lns-supervisor</b> runs as root: it makes itself un-traceable, installs the <b>nftables</b> cage, starts the proxy and DNS stub, and opens a WebSocket to the host on vsock 1024. On the first <b>policy frame</b> it runs your pre-start scripts, then drops to uid 65534 and starts the <b class="c-am">workload</b>. Even a root workload loses <code>CAP_NET_ADMIN</code> and <code>CAP_NET_RAW</code>, so it cannot rewrite the firewall.</p>`,
    acts: () => [
      ['▶ Boot the microVM', 'pri', () => S.vm === 'running' || S.vm === 'booting' ? relaunch('lns run') : newRun()],
      ['<code>lns exec agent -- sh</code>', '', execSession, C.cyan],
      S.vm === 'stopped' ? ['<code>lns start agent</code>', '', startVm, C.green] : ['<code>lns stop agent</code>', '', stopVm, C.amber],
    ]},
  {id: 'mounts', title: 'Mounts: what the guest sees', color: C.cyan, cam: [V(-15.5, 14, 21), V(-6.4, 1.7, 0.6)],
    labels: ['folder', 'cache', 'image2', 'upper', 'p-ws', 'p-data'],
    lede: 'The guest’s root filesystem is a stack: <b class="c-vi">read-only image layers</b>, a <b class="c-am">writable layer</b> on top, and a few doors cut in where your directories and disks are mounted.',
    body: `<p>The image never gets unpacked into the VM. Its files stay in the host’s <b class="c-vi">content store</b>, shared read-only over <b>virtio-fs</b>. A small <b>composefs</b> descriptor tells the guest which file is which, and the kernel refuses a descriptor whose SHA-256 doesn’t match.</p>
      <p>On top, <b>overlayfs</b> adds the <b class="c-am">writable layer</b>. Change a file from the image and it is <b>copied up</b>: the lower layer is never touched, so ten sandboxes can share one image.</p>
      <p>A <b class="c-tl">bind</b> is your folder, live, in both directions. An <code>exclude</code> leaves a <b class="c-rd">mask</b>: the name is still there, reading it is denied. That is how <code>.env</code> stays on your side.</p>`,
    acts: () => [
      ['Edit README.md on your Mac', '', editOnHost, C.teal],
      ['<code>cat /workspace/.env</code>', '', catEnv, C.red],
      ['<code>echo &gt;&gt; /etc/motd</code>', '', copyUp, C.amber],
      ['<code>cat /proc/cmdline</code>', '', catCmdline, C.cyan],
    ]},
  {id: 'volumes', title: 'Volumes: what survives', color: C.cyan, cam: [V(-7.5, 17, 27), V(-5.6, 1.3, 1.2)],
    labels: ['folder', 'disk', 'upper', 'p-ws', 'p-data', 'p-tmp'],
    lede: 'Four places a write can land, four lifetimes. Write to each, then <b>stop</b>, <b>start</b> and <b>remove</b> the run and watch which files are still there.',
    body: `<p><b class="c-tl">A bind</b> is your folder. It outlives everything because it was never the sandbox’s. Any number of guests can share it.</p>
      <p><b class="c-bl">A named volume</b> is an ext4 disk image the service keeps. It outlives every run, but it is one guest’s block device, so while a sandbox holds it (even a <b>stopped</b> one) a second run is refused with <code>volume in use</code>.</p>
      <p><b class="c-am">The writable layer</b> belongs to one run. It survives <code>lns stop</code> and <code>lns start</code>, and <code>lns rm</code> deletes it. So does <code>--rm</code>.</p>
      <p><b>/tmp</b> is RAM. Processes and /tmp never survive a restart.</p>`,
    acts: () => [
      ['write <code>/workspace</code>', '', () => writeFile('ws'), C.teal],
      ['write <code>/opt/data</code>', '', () => writeFile('data'), C.blue],
      ['write <code>/var/cache</code>', '', () => writeFile('upper'), C.amber],
      ['write <code>/tmp</code>', '', () => writeFile('tmp'), C.grey],
      S.vm === 'stopped' ? ['<code>lns start</code>', '', startVm, C.green] : ['<code>lns stop</code>', '', stopVm, C.amber],
      S.vm === 'gone' ? ['<code>lns run</code>', 'pri', () => newRun()] : ['<code>lns rm</code>', '', rmVm, C.red],
      ['2nd sandbox, same mounts', '', secondRun, C.cyan],
    ]},
  {id: 'filesets', title: 'Filesets: files that ship with it', color: C.cyan, cam: [V(-7.5, 19, 32), V(-5.8, 1.4, 1.6)],
    labels: ['cache', 'gitfile', 'p-fs', 'p-git'],
    lede: 'Volumes bring <b>your</b> files in. Filesets go the other way: files the <b>author</b> ships inside the artifact, written into the guest as a <b>snapshot</b> each time it boots.',
    body: `<p>An entry has exactly one source. <b>inline</b> text lives in lns.yaml itself. A <b>path</b> directory is packed into a layer of the same artifact at <code>lns push</code>, so the files and the declaration that mounts them share one digest. A <b>hostPath</b> reads one file off the machine that runs it, such as <code>~/.gitconfig</code>.</p>
      <p>None of them is a share. Edit the host file after boot and the guest keeps its copy. Edit it in the guest and the host never knows.</p>
      <p><code>owner: root</code> makes a file a <b>pinned input</b> the workload cannot rewrite. And a guest path is <b>one claim</b>: a mixin that claims <code>/opt/app</code> replaces the sandbox’s fileset there <b>wholesale</b>. That is how a provider mixin swaps a whole config directory.</p>
      <p>Connectors use filesets too, for clients that read a token from a file. The file carries a placeholder, never the value.</p>`,
    acts: () => [
      ['Seed at boot', 'pri', seedFilesets],
      ['Edit ~/.gitconfig on your Mac', '', editGitHost, C.lime],
      ['workload writes settings.json', '', editSettings, C.orange],
      [`owner: ${S.fsRoot ? 'root → workload' : 'workload → root'}`, '', toggleOwnerRoot, C.amber],
      [S.mix.prod ? 'drop --mixin prod-settings' : '<code>--mixin prod-settings</code>', '', () => toggleMixin('prod'), C.pink],
    ]},
  {id: 'network', title: 'Network: one door out', color: C.cyan, cam: [V(9.5, 19, 33), V(9.5, 1.6, 1.4)],
    labels: ['gate', 'nic', 'nat', 'dest-*', 'browser'],
    lede: 'No route out skips the gate. Inside the guest, <b>nftables</b> sends every TCP connection to the supervisor’s <b class="c-cy">proxy</b> and every DNS query to its stub, and drops the rest.',
    body: `<p>The proxy reads the <b>host name</b>, from the <code>CONNECT</code> line, the TLS SNI, or the HTTP Host, and matches it against the rule table. An allowed connection is dialed <b>by the proxy</b>, out through <b class="c-gr">eth0</b> and the Mac’s NAT.</p>
      <p>Setting <code>--noproxy</code> doesn’t help: nftables redirects the socket anyway, and a TLS connection with no name is refused. A denied name gets <b>NXDOMAIN</b> from the DNS stub, so it never even resolves.</p>
      <p>Traffic lns can’t read, such as Postgres, can only be <b>spliced</b> through by an <code>egress.tcp</code> rule. That means no inspection and no injection, so it raises a <b class="c-rd">RAW</b> card.</p>
      <p>Inbound is separate: <code>spec.ports</code> publishes a guest port on <b>127.0.0.1</b> over vsock 1030.</p>`,
    acts: () => [
      ['<code>curl registry.npmjs.org</code>', '', () => request('npm'), C.green],
      ['<code>curl api.linear.app</code>', '', () => request('linear'), C.amber],
      ['<code>curl telemetry.evil.example</code>', '', () => request('evil'), C.red],
      ['<code>nslookup telemetry.evil…</code>', '', () => dnsLookup('telemetry.evil.example'), C.red],
      ['skip the proxy', '', bypass, C.red],
      ['<code>psql db.internal:5432</code>', '', () => request('db', {cmd: 'psql -h db.internal'}), C.teal],
      ['open localhost:8642', '', inbound, C.pink],
    ]},
  {id: 'policy', title: 'Policy: allow, deny, or ask', color: C.cyan, cam: [V(10, 15, 27), V(5.8, 2.4, 0.6)],
    labels: ['gate', 'dest-*'],
    lede: 'A rule only ever says <b class="c-gr">allow</b> or <b class="c-rd">deny</b>. <b class="c-am">Ask</b> is what happens when no rule matches: the request is <b>held</b> and a card appears. Your answers become this run’s own rules.',
    body: `<p>The host merges the rules from every source and pushes the table to the supervisor as a <b>policy frame</b> over vsock 1024. The <b>first matching rule wins</b>, and stronger sources come first, so the run’s <b class="c-am">decisions.yaml</b> is checked before anything you pulled.</p>
      <p>A held request sends its question up the same socket. <b>Once</b> answers only this request; <b>always</b> writes a rule to <code>~/.lns/runs/agent/decisions.yaml</code>. No answer in 60 s means <b class="c-rd">denied</b>, and the question stays listed.</p>
      <p>End the list with <code>match: "*" · deny</code> to <b>close the directory</b>: nothing asks any more, so the file is how you widen it. Decisions belong to the run. <code>lns sandbox save --kind mixin</code> keeps them as a mixin you can commit.</p>`,
    acts: () => [
      ['Send to every destination', 'pri', sendAll],
      [S.closed ? 'Re-open (drop <code>"*"</code> deny)' : 'Close the directory', '', () => { S.closed = !S.closed; log(S.closed ? 'lns.yaml += <b>deny "*"</b> (directory closed)' : 'directory re-opened', S.closed ? C.red : C.green); refresh(); }, S.closed ? C.green : C.red],
      ['Clear decisions', '', () => { S.decisions = {http: [], tcp: []}; log('decisions.yaml cleared'); refresh(); }],
      ['<code>lns sandbox save</code>', '', saveDecisions, C.pink],
    ]},
  {id: 'connector', title: 'Connectors: secrets stay out', color: C.cyan, cam: [V(-3.2, 16.5, 25), V(-2.4, 2.4, -3)],
    labels: ['vault', 'service', 'gate', 'dest-github'],
    lede: 'The workload holds a <b>placeholder</b>. The real token stays on your Mac until you grant it to this run. Then the proxy swaps it in on the wire, only for the domain it belongs to.',
    body: `<p>Installing, connecting and granting are three separate facts. <b>Installed</b> (this machine) means its destinations stop guessing and <b>ask</b>. <b>Connected</b> (this machine) means you gave it a token, in a terminal, with no echo. <b>Granted</b> (<i>this run</i>) means the method’s egress opens and its injection is armed.</p>
      <p>On grant the service sends the value down vsock 1024 to the supervisor’s proxy. That is a root process the workload cannot read or trace, and it is the only place the value exists in the guest. The workload’s <code>$GH_TOKEN</code> is <code>ghp_LNSPLACEHOLDER…</code>, and the proxy adds <code>Authorization: Bearer</code> to requests for <b>api.github.com</b>, and nowhere else.</p>
      <p>A grant belongs to one run: <code>lns rm</code> takes it away, and a new run asks again.</p>`,
    acts: () => [
      [S.conn.installed ? '✓ installed' : '1 · install', S.conn.installed ? '' : 'pri', installConnector, C.gold],
      [S.conn.connected ? '✓ connected' : '2 · connect', S.conn.installed && !S.conn.connected ? 'pri' : '', connectConnector, C.gold],
      [S.conn.granted ? '✓ granted' : '3 · grant --run agent', S.conn.connected && !S.conn.granted ? 'pri' : '', () => grantConnector(true), C.gold],
      ['<code>gh api user</code>', S.conn.granted ? 'pri' : '', () => request('github', {cmd: 'gh api user'}), C.green],
      ['<code>echo $GH_TOKEN</code>', '', () => term('connector', `<span class="pr">guest$</span> echo $GH_TOKEN\n${S.conn.granted ? '<span class="gd">ghp_LNSPLACEHOLDER000000000000</span> <span class="cm"># never the real one</span>' : '<span class="cm">(empty — nothing granted to this run)</span>'}`), C.gold],
      ['<code>forget</code>', '', forgetConnector, C.red],
    ]},
  {id: 'mixin', title: 'Mixins: compose a sandbox', color: C.cyan, cam: [V(1.5, 15, 29), V(0, 5.4, -0.4)],
    labels: [],
    lede: 'A mixin is a capability you layer onto a sandbox: a toolchain, a provider, a set of approved hosts, a config directory. The sandbox stays neutral, and <b>each run</b> chooses its mixins.',
    body: `<p>Toggle a layer on the right. Mixins resolve when a run <b>launches</b>, so each change relaunches the run with a new <code>--mixin</code> line. Watch the tool shelf, the beacons and the merged view change.</p>
      <p>Precedence runs weakest to strongest: <b>the sandbox</b> &lt; its <code>spec.mixins</code> &lt; <code>--mixin</code> flags &lt; a <b class="c-gd">granted connector</b> &lt; <b class="c-am">the run’s decisions</b>. Env merges per key. Egress rules union. A mount path is one claim, and the last one displaces the rest. Scripts append.</p>
      <p>A mixin may not carry <b>image, command, workdir, user or resources</b>; those belong to the workload. It may not name a connector either, because which method supplies a credential is decided per machine.</p>
      <p style="color:#8d97b3">Rule of thumb: if two users could want different values, it is a mixin chosen at run time.</p>`,
    acts: () => [
      ['<code>curl api.anthropic.com</code>', '', () => request('claude'), C.pink],
      ['<code>curl api.linear.app</code>', '', () => request('linear'), C.amber],
      ['All mixins on', '', async () => { for (const k of ['anthropic', 'team']) if (!S.mix[k]) S.mix[k] = true; refresh(); await relaunch('lns run --mixin ./mixins/anthropic --mixin ./team-egress.yaml'); }, C.pink],
    ]},
];
CH.forEach((c, i) => c.n = String(i + 1).padStart(2, '0'));
let current = CH[0];

async function sendAll() {
  stage([coreP, GATE, ...Object.values(DEST).map(d => d.pos.clone().add(V(0, d.h, 0)))]);
  const ks = Object.keys(DEST);
  for (const k of ks) { request(k, {cmd: k === 'db' ? 'psql -h db.internal' : k === 'github' ? 'gh api user' : undefined}); await sleep(0.5); }
}
function saveDecisions() {
  const n = S.decisions.http.length + S.decisions.tcp.length;
  term('policy', '');
  log(`<b>lns sandbox save agent --kind mixin -f ./team-egress.yaml</b> — ${n} rule(s)`, C.pink);
  fx(svc.position.clone().add(V(0, 4.4, 0)), n ? `${n} rule(s) → ./team-egress.yaml` : 'nothing decided yet', C.pink);
}

// ─────────────────────────────────────────────────────────────── UI rendering
const rp = $('#rp');
function refreshPanel() {
  const f = PANELS[current.id];
  const scrolls = [...rp.querySelectorAll('.scroll')].map(s => s.scrollTop);
  rp.innerHTML = f();
  rp.querySelectorAll('.scroll').forEach((s, i) => s.scrollTop = scrolls[i] || 0);
  rp.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { overviewOpen = b.dataset.open === '1'; refreshPanel(); });
  rp.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { overviewTab = b.dataset.tab; refreshPanel(); });
  rp.querySelectorAll('[data-ch]').forEach(l => { l.style.cursor = 'pointer'; l.onclick = () => go(CH.findIndex(c => c.id === l.dataset.ch)); });
  rp.querySelectorAll('[data-part]').forEach(r => {
    r.onmouseenter = () => hilite(r.dataset.part, true);
    r.onmouseleave = () => hilite(r.dataset.part, false);
  });
  rp.querySelectorAll('.seg3').forEach(sg => sg.querySelectorAll('button').forEach(b => b.onclick = () => {
    const host = sg.dataset.host, raw = sg.dataset.raw === '1', list = raw ? S.decisions.tcp : S.decisions.http;
    const i = list.findIndex(r => r.match === host);
    if (i >= 0) list.splice(i, 1);
    if (b.dataset.v !== 'none') list.push({match: host, verdict: b.dataset.v, fresh: true});
    log(b.dataset.v === 'none' ? `decisions.yaml −= ${host}` : `decisions.yaml += <b>${b.dataset.v} ${host}</b>`, VCOL[b.dataset.v] || C.white);
    refresh();
  }));
  rp.querySelectorAll('[data-mix]').forEach(b => b.onclick = () => toggleMixin(b.dataset.mix));
  const t = $('#term'); if (t) t.scrollTop = 1e6;
}
function refreshActs() {
  const box = $('#c-acts');
  box.innerHTML = '';
  current.acts().forEach(([html, cls, fn, color]) => {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    b.innerHTML = html;
    b.onclick = () => { stopTour(); beginDemo(); Promise.resolve(fn()).finally(() => { endDemo(); refreshActs(); }); setTimeout(refreshActs, 50); };
    box.appendChild(b);
  });
}
function refreshWorld() {
  for (const [k, d] of Object.entries(DEST)) {
    const v = evaluate(d);
    const c = v.rule?.offer ? C.gold : VCOL[v.verdict];
    d.beacon.material.color.copy(col(c, 2.4 + (d.flash || 0) * 3));
    const who = v.verdict === 'ask' ? (v.rule?.offer ? 'connector offer' : d.raw ? 'no tcp rule' : 'no rule') : SRC[v.src]?.name;
    d.label.set(d.host, `${v.verdict} · ${who}`);
    d.label.el.style.setProperty('--c', c);
  }
  LAYERS.forEach(L => {
    const on = L.k === 'sandbox' || (L.k === 'connector' ? S.conn.granted : L.k === 'decisions' ? S.decisions.http.length + S.decisions.tcp.length > 0 : S.mix[L.k]);
    L.on = on;
  });
}
function refresh() { refreshWorld(); refreshPanel(); refreshActs(); }

function hilite(key, on) {
  const p = parts[key];
  if (!p) return;
  p.labels.forEach(L => { L.el.classList.toggle('hot', on); if (on) L.el.classList.remove('off'); else applyLabels(); });
  p.hot = on;
}

// ─────────────────────────────────────────────────────────────── chapter navigation, camera
const steps = $('#steps');
CH.forEach((c, i) => {
  const b = document.createElement('button');
  b.className = 'step';
  b.style.setProperty('--c', c.color);
  b.innerHTML = `<span class="n">${c.n}</span><span class="t">${c.title.split(':')[0]}</span>`;
  b.title = c.title + ` (${i + 1})`;
  b.onclick = () => { stopTour(); go(i); };
  steps.appendChild(b);
});
let camTween = null;
function camFor(c) {
  const [p, t] = c.cam;
  const k = clamp(0.84 / camera.aspect, 1, 2.1);
  return [t.clone().add(p.clone().sub(t).multiplyScalar(k)), t];
}
function flyTo(pos, tgt, dur = 1.7) {
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  const id = {};
  camTween = id;
  return tween(dur, k => {
    if (camTween !== id) return;
    camera.position.lerpVectors(p0, pos, k);
    controls.target.lerpVectors(t0, tgt, k);
    const lift = Math.sin(k * Math.PI) * p0.distanceTo(pos) * 0.08;
    camera.position.y += lift;
  }, easeIO);
}
controls.addEventListener('start', () => { camTween = null; });

// Demo focus: while a demo runs, labels fade and the camera frames only the parts involved.
let demoN = 0, demoT;
const wp = p => p.isVector3 ? p.clone() : p.getWorldPosition(new THREE.Vector3());
function beginDemo() { demoN++; clearTimeout(demoT); $('#labels').classList.add('demo'); }
function endDemo() {
  demoN = Math.max(0, demoN - 1);
  if (demoN) return;
  clearTimeout(demoT);
  demoT = setTimeout(() => { if (demoN) return; $('#labels').classList.remove('demo'); flyTo(...camFor(current), 1.4); }, 2200);
}
function fitDist(r) {
  const narrow = innerWidth < 900, vf = THREE.MathUtils.degToRad(camera.fov) / 2;
  const free = narrow ? 0.95 : Math.max(0.35, (innerWidth - 780) / innerWidth);
  const hf = Math.atan(Math.tan(vf) * camera.aspect * free);
  const vfe = narrow ? Math.atan(Math.tan(vf) * 0.5) : Math.atan(Math.tan(vf) * 0.82);
  return clamp(r / Math.tan(Math.min(hf, vfe)) * 1.08, 7, 70);
}
function stage(pts, minR = 2.6) {
  if (!demoN) return;
  const box = new THREE.Box3().setFromPoints(pts.map(wp));
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(minR, box.getSize(new THREE.Vector3()).length() / 2);
  const [cp, ct] = camFor(current);
  const dir = cp.clone().sub(ct).normalize();
  flyTo(c.clone().add(dir.multiplyScalar(fitDist(r))), c, 1.1);
}
const VMFOCUS = () => [core.position.clone().add(V(-1.3, 1.4, 0.6)), GATE.clone().add(V(0, 1.4, 0)), NIC.clone().add(V(0.6, -1.2, 0))];
const VMBOX = [V(-VM.w / 2, VM.floor, -VM.d / 2), V(VM.w / 2, VM.top, VM.d / 2)];
let labelsOn = true;
function applyLabels() {
  const want = current.labels;
  const show = key => want.some(w => w.endsWith('*') ? key.startsWith(w.slice(0, -1)) : w === key);
  allLabels.forEach(L => {
    if (L.o.parent === null) return;
    let vis;
    if (!L.part) vis = current.id === 'network';
    else vis = show(L.part);
    if (LAYERS.some(x => x.label === L)) vis = current.id === 'mixin';
    if (L === precLabel) vis = current.id === 'mixin';
    if (Object.values(chips).some(c => c.L === L)) vis = Object.values(chips).find(c => c.L === L).on && (current.id === 'supervisor' || current.id === 'mixin');
    if (L === ghost.userData.label) vis = true;
    if (!labelsOn) vis = false;
    L.el.classList.toggle('off', !vis);
    L.el.classList.toggle('hot', !!(L.part && parts[L.part]?.hot));
  });
}
function go(i) {
  i = (i + CH.length) % CH.length;
  current = CH[i];
  S.seen.add(current.id);
  document.documentElement.style.setProperty('--acc', current.color);
  $('#c-no').textContent = current.n;
  $('#c-title').textContent = current.title;
  $('#c-lede').innerHTML = current.lede;
  $('#c-body').innerHTML = current.body;
  $('#c-body').scrollTop = 0;
  steps.querySelectorAll('.step').forEach((b, j) => { b.classList.toggle('on', j === i); b.classList.toggle('seen', S.seen.has(CH[j].id)); });
  cards.visible = current.id === 'mixin';
  flyTo(...camFor(current));
  applyLabels();
  refresh();
  try { history.replaceState(null, '', '#' + current.id); } catch (e) {}
}

// ─────────────────────────────────────────────────────────────── tour
let touring = false, tourTimer = null;
const TOUR_DEMO = {
  overview: () => request('claude', {cmd: 'claude -p "fix the tests"'}),
  supervisor: () => relaunch('lns run'),
  mounts: async () => { await editOnHost(); await catEnv(); },
  volumes: async () => { await writeFile('ws'); await writeFile('upper'); },
  filesets: async () => { await seedFilesets(); editGitHost(); },
  network: async () => { request('npm'); await sleep(1.2); await request('evil'); },
  policy: () => request('linear'),
  connector: async () => { await installConnector(); await sleep(0.6); await connectConnector(); await sleep(0.6); await grantConnector(true); await request('github', {cmd: 'gh api user'}); },
  mixin: () => toggleMixin('anthropic'),
};
async function startTour() {
  touring = true;
  $('#tour').classList.add('on');
  let i = CH.indexOf(current);
  while (touring) {
    go(i);
    await sleep(1.9);
    if (!touring) break;
    const t0 = performance.now();
    beginDemo();
    await Promise.race([TOUR_DEMO[current.id]?.(), sleep(14)]);
    endDemo();
    await sleep(Math.max(2.5, 6 - (performance.now() - t0) / 1000));
    i = (i + 1) % CH.length;
  }
}
function stopTour() { if (!touring) return; touring = false; $('#tour').classList.remove('on'); }

// ─────────────────────────────────────────────────────────────── hover, click
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tip = $('#tip');
let hoverKey = null, downAt = null;
renderer.domElement.addEventListener('pointermove', e => {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects(pickables, false).filter(h => h.object.visible && isShown(h.object));
  const h = hits.find(h => h.object.userData.part || h.object.userData.card);
  const key = h ? (h.object.userData.part || 'card:' + h.object.userData.card) : null;
  if (key !== hoverKey) {
    if (hoverKey && parts[hoverKey]) hilite(hoverKey, false);
    hoverKey = key;
    if (key && parts[key]) hilite(key, true);
  }
  if (key) {
    let info = parts[key];
    if (!info && key.startsWith('card:')) { const L = LAYERS.find(l => l.k === key.slice(5)); info = {title: L.name, kicker: L.sub, color: L.color, text: L.fixed ? 'Always part of the merge.' : 'Click to toggle this mixin; the run relaunches with it.'}; }
    tip.innerHTML = `<i>${info.kicker || ''}</i><b>${info.title}</b>${info.text || ''}`;
    tip.style.setProperty('--c', info.color || C.cyan);
    const x = Math.min(e.clientX + 16, innerWidth - 300), y = Math.min(e.clientY + 14, innerHeight - 160);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
    tip.classList.add('on');
    renderer.domElement.style.cursor = 'pointer';
  } else { tip.classList.remove('on'); renderer.domElement.style.cursor = ''; }
});
renderer.domElement.addEventListener('pointerleave', () => tip.classList.remove('on'));
renderer.domElement.addEventListener('pointerdown', e => downAt = [e.clientX, e.clientY]);
renderer.domElement.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5 || !hoverKey) return;
  stopTour();
  if (hoverKey.startsWith('card:')) { const k = hoverKey.slice(5); if (!LAYERS.find(l => l.k === k).fixed) toggleMixin(k); return; }
  const p = parts[hoverKey];
  const i = CH.findIndex(c => c.id === p.chapter);
  if (i >= 0 && CH[i] !== current) go(i);
});
function isShown(o) { for (let n = o; n; n = n.parent) { if (!n.visible) return false; if (n.scale.x < 0.01) return false; } return true; }
document.getElementById('labels').addEventListener('click', e => {
  const el = e.target.closest('.lb');
  if (!el) return;
  const L = allLabels.find(l => l.el === el);
  if (!L || !L.part) return;
  const i = CH.findIndex(c => c.id === parts[L.part]?.chapter);
  stopTour();
  if (i >= 0) go(i);
});

// ─────────────────────────────────────────────────────────────── controls, keys
$('#prev').onclick = () => { stopTour(); go(CH.indexOf(current) - 1); };
$('#next').onclick = () => { stopTour(); go(CH.indexOf(current) + 1); };
$('#tour').onclick = () => touring ? stopTour() : startTour();
$('#lbltog').onclick = () => { labelsOn = !labelsOn; $('#lbltog').classList.toggle('on', labelsOn); applyLabels(); };
$('#tilt').onclick = () => { tiltH.enabled = tiltV.enabled = !tiltH.enabled; $('#tilt').classList.toggle('on', tiltH.enabled); hint(tiltH.enabled ? 'Miniature on: tilt-shift blur' : 'Miniature off'); };
$('#uitog').onclick = () => { $('#app').classList.toggle('ui-off'); $('#uitog').classList.toggle('on'); };
$('#help').onclick = () => $('#info').showModal();
$('#info-x').onclick = () => $('#info').close();
$('#info').addEventListener('click', e => { if (e.target === $('#info')) $('#info').close(); });
let hintT;
function hint(t) { const h = $('#hint'); h.textContent = t; h.classList.add('on'); clearTimeout(hintT); hintT = setTimeout(() => h.classList.remove('on'), 1800); }
addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || $('#info').open) return;
  const k = e.key;
  if (k >= '1' && k <= '9') { stopTour(); go(+k - 1); }
  else if (k === 'ArrowRight') { stopTour(); go(CH.indexOf(current) + 1); }
  else if (k === 'ArrowLeft') { stopTour(); go(CH.indexOf(current) - 1); }
  else if (k === 't' || k === 'T') touring ? stopTour() : startTour();
  else if (k === 'l' || k === 'L') $('#lbltog').click();
  else if (k === 'm' || k === 'M') $('#tilt').click();
  else if (k === '/') { e.preventDefault(); $('#uitog').click(); }
  else if (k === '?') $('#info').showModal();
  else if (k === 'r' || k === 'R') flyTo(...camFor(current), 1.1);
  else if (k === ' ') { e.preventDefault(); paused = !paused; hint(paused ? 'Paused · Space to resume' : 'Resumed'); }
  else return;
});

// ─────────────────────────────────────────────────────────────── the loop
const clkT = {last: performance.now(), getDelta() { const n = performance.now(), d = (n - this.last) / 1000; this.last = n; return d; }};
let last = 0;
function frame() {
  requestAnimationFrame(frame);
  const rawDt = Math.min(clkT.getDelta(), 0.1);
  tick(paused ? 0 : rawDt * speed);
  render();
}
function tick(dt) {
  time.value += dt;
  const t = time.value;
  stepTweens(dt);
  controls.update();

  const alive = S.vm === 'running';
  ring.userData.t1.rotation.z += dt * (alive ? 0.6 : 0);
  ring.userData.t2.rotation.z -= dt * (alive ? 0.35 : 0);
  clawd.update(dt);
  shellMat.uniforms.uK.value = lerp(shellMat.uniforms.uK.value, demoN ? 0.32 : 1, Math.min(1, dt * 3));
  coreLight.position.copy(core.position).add(V(0, 0.2, 0.4));
  svc.userData.rings.forEach((r, i) => { if (!booting) r.material.color.copy(col(C.cyan, 1.2 + 0.8 * Math.max(0, Math.sin(t * 2 - i * 0.8)))); });
  keyObj.rotation.y = t * 0.9; keyObj.position.y = 2.1 + Math.sin(t * 1.6) * 0.08;
  if (gateKey.visible) { gateKey.rotation.y = t * 1.3; gateKey.position.y = GATE_KEY_POS.y + Math.sin(t * 2) * 0.07; }
  gateScanMat.uniforms.uF.value *= Math.pow(0.12, dt);
  if (gateScanMat.uniforms.uF.value < 0.02) gateScanMat.uniforms.uC.value.lerp(new THREE.Color(C.cyan), 0.05);
  for (const p of Object.values(pipes)) {
    p.pulse *= Math.pow(0.2, dt);
    p.mat.uniforms.uA.value = p.pulse;
  }
  if (alive && t - last > 3.2) { last = t; pipes.vs1024.pulse = Math.max(pipes.vs1024.pulse, 0.35); }
  for (const d of Object.values(DEST)) {
    if (d.flash > 0) { d.flash = Math.max(0, d.flash - dt * 1.5); refreshWorldBeacon(d); }
    d.beacon.scale.setScalar(1 + Math.sin(t * 2.4 + d.pos.z) * 0.08);
  }
  packets.forEach(p => p.update(t));
  LAYERS.forEach(L => {
    L.mat.emissiveIntensity = lerp(L.mat.emissiveIntensity, L.on ? 0.9 : 0.12, 0.08);
    L.mat.opacity = lerp(L.mat.opacity, L.on ? 0.96 : 0.45, 0.08);
    L.lines.children.forEach(b => b.material.opacity = L.on ? 0.65 : 0.18);
    const b = L.beam;
    const top = L.g.getWorldPosition(V(0, 0, 0)).add(V(0, -1.3, 0));
    const bot = V(top.x * 0.25, VM.top + 0.05, -0.2);
    b.position.lerpVectors(top, bot, 0.5);
    b.scale.set(1, top.distanceTo(bot), 1);
    b.lookAt(bot); b.rotateX(Math.PI / 2);
    b.material.opacity = lerp(b.material.opacity, cards.visible && L.on ? 0.55 + Math.sin(t * 3) * 0.15 : 0, 0.1);
    b.visible = b.material.opacity > 0.01;
    L.g.position.y = L.home.y + Math.sin(t * 0.8 + L.home.x) * 0.08;
  });
}
function render() {
  for (const L of allLabels) {
    let n = L.o.parent, hidden = false;
    for (; n; n = n.parent) if (!n.visible || n.scale.x < 0.2) { hidden = true; break; }
    L.o.visible = !hidden;
  }
  composer.render();
  labelRenderer.render(scene, camera);
}
function refreshWorldBeacon(d) {
  const v = evaluate(d);
  const c = v.rule?.offer ? C.gold : VCOL[v.verdict];
  d.beacon.material.color.copy(col(c, 2.4 + d.flash * 3));
}

// ─────────────────────────────────────────────────────────────── start
addEventListener('resize', resize);
resize();
['server.js', 'package.json', 'README.md'].forEach(() => addTok('host'));
addTok('host', {masked: true});
tok.host.forEach(m => addTok('ws', {masked: m.userData.masked}));
addTok('data');
addTok('fs');
addTok('git');
setChip('node', true);
diskFill.geometry.dispose(); diskFill.geometry = new THREE.RingGeometry(0.34, 0.92, 64, 1, 0, 0.9);
camera.position.set(-30, 40, 60);
controls.target.set(0, 2, 0);
const start = Math.max(0, CH.findIndex(c => '#' + c.id === location.hash));
go(start);
frame();
window.__lab = {camera, controls, async advance(sec, step = 1 / 30) { for (let t = 0; t < sec; t += step) { tick(step); await new Promise(r => setTimeout(r, 0)); } render(); }, go, S, request, get current() { return current.id; }};
requestAnimationFrame(() => setTimeout(() => { $('#loading').classList.add('done'); setTimeout(() => hint('Drag to orbit · hover anything · → next chapter'), 900); }, 350));
setTimeout(() => { if (current.id === 'overview' && !touring) { clawd.mood('happy', 2.4).say('hi! I’m Claude Code, sandboxed', {dur: 3.4}); } }, 2200);
