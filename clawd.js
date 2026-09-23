// A little Claude Code, the demo workload: a blocky orange critter whose face tells you what it is going through.
import * as THREE from 'three';
import {CSS2DObject} from 'three/addons/renderers/CSS2DRenderer.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

const ORANGE = '#d97757';
const INK = '#2a1510';
const SPIN = ['✻', '✽', '✶', '✳', '✢', '·', '✢', '✳', '✶', '✽'];

export function makeClawd(parent) {
  const root = new THREE.Group();          // position + hop
  const body = new THREE.Group();          // turn + squash
  root.add(body);
  parent.add(root);

  const skin = new THREE.MeshStandardMaterial({color: ORANGE, roughness: 0.55, metalness: 0.05, emissive: new THREE.Color(ORANGE), emissiveIntensity: 0.3});
  const W = 1.3, H = 0.86, D = 0.8;
  const torso = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 3, 0.1), skin);
  torso.castShadow = true;
  body.add(torso);
  const arms = [-1, 1].map(s => {
    const a = new THREE.Group();
    a.position.set(s * (W / 2 + 0.02), -0.02, 0);
    const m = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.26, 0.34, 2, 0.05), skin);
    m.position.x = s * 0.1;
    m.castShadow = true;
    a.add(m);
    body.add(a);
    return a;
  });
  const legs = [-0.44, -0.16, 0.16, 0.44].map(x => {
    const l = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.3, 0.16, 1, 0.03), skin);
    l.position.set(x, -H / 2 - 0.12, 0.05);
    l.castShadow = true;
    body.add(l);
    return l;
  });

  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 160;
  const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.92, H * 0.9), new THREE.MeshBasicMaterial({map: tex, transparent: true, toneMapped: false}));
  face.position.z = D / 2 + 0.004;
  body.add(face);

  const el = document.createElement('div');
  el.className = 'bubble off';
  const bubble = new CSS2DObject(el);
  bubble.position.set(0, 1.05, 0);
  bubble.center.set(0.5, 1);
  root.add(bubble);

  const st = {
    mood: 'normal', moodUntil: 0, text: '', textUntil: 0, spin: false,
    blink: 0, nextBlink: 2, gaze: new THREE.Vector2(), gazeT: new THREE.Vector2(), watch: null, wander: 0,
    hop: 0, shake: 0, yaw: 0, yawT: 0, power: 1, t: 0, dirty: true, lastKey: '',
  };

  function draw() {
    const {mood} = st;
    const k = [mood, st.blink > 0.5 ? 1 : 0, Math.round(st.gaze.x * 10), Math.round(st.gaze.y * 10), st.power > 0.3 ? 1 : 0].join();
    if (k === st.lastKey) return;
    st.lastKey = k;
    g.clearRect(0, 0, 256, 160);
    g.fillStyle = INK; g.strokeStyle = INK; g.lineCap = 'round'; g.lineJoin = 'round';
    const gx = st.gaze.x * 16, gy = -st.gaze.y * 12;
    const eye = (cx, cy, w, h) => { g.beginPath(); g.roundRect(cx - w / 2, cy - h / 2, w, h, 6); g.fill(); };
    const L = 128 - 50 + gx, R = 128 + 50 + gx, Y = 64 + gy;
    const closed = st.blink > 0.5 || mood === 'sleep' || st.power < 0.3;
    if (closed) {
      g.lineWidth = 9;
      for (const x of [L, R]) { g.beginPath(); g.moveTo(x - 16, Y + 4); g.quadraticCurveTo(x, Y + 12, x + 16, Y + 4); g.stroke(); }
    } else if (mood === 'happy') {
      g.lineWidth = 10;
      for (const x of [L, R]) { g.beginPath(); g.moveTo(x - 17, Y + 8); g.quadraticCurveTo(x, Y - 18, x + 17, Y + 8); g.stroke(); }
      g.fillStyle = '#ff9aa8'; g.globalAlpha = 0.55;
      for (const x of [L - 22, R + 22]) { g.beginPath(); g.ellipse(x, Y + 30, 16, 9, 0, 0, 7); g.fill(); }
      g.globalAlpha = 1; g.fillStyle = INK;
      g.lineWidth = 7; g.beginPath(); g.moveTo(116, 112); g.quadraticCurveTo(128, 124, 140, 112); g.stroke();
    } else if (mood === 'ouch') {
      g.lineWidth = 10;
      g.beginPath(); g.moveTo(L - 14, Y - 14); g.lineTo(L + 12, Y); g.lineTo(L - 14, Y + 14); g.stroke();
      g.beginPath(); g.moveTo(R + 14, Y - 14); g.lineTo(R - 12, Y); g.lineTo(R + 14, Y + 14); g.stroke();
      g.lineWidth = 7; g.beginPath(); g.moveTo(112, 120); g.lineTo(122, 112); g.lineTo(134, 120); g.lineTo(144, 112); g.stroke();
    } else if (mood === 'sad') {
      eye(L, Y + 4, 30, 40); eye(R, Y + 4, 30, 40);
      g.fillStyle = ORANGE;
      g.beginPath(); g.moveTo(L - 20, Y - 22); g.lineTo(L + 20, Y - 22); g.lineTo(L - 20, Y - 4); g.fill();
      g.beginPath(); g.moveTo(R + 20, Y - 22); g.lineTo(R - 20, Y - 22); g.lineTo(R + 20, Y - 4); g.fill();
      g.fillStyle = INK;
      g.lineWidth = 7; g.beginPath(); g.moveTo(114, 124); g.quadraticCurveTo(128, 110, 142, 124); g.stroke();
      g.fillStyle = '#8fd3ff'; g.beginPath(); g.moveTo(R + 34, Y - 10); g.quadraticCurveTo(R + 44, Y + 8, R + 34, Y + 12); g.quadraticCurveTo(R + 24, Y + 8, R + 34, Y - 10); g.fill();
    } else if (mood === 'surprised') {
      eye(L, Y, 36, 56); eye(R, Y, 36, 56);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(L - 6, Y - 12, 5, 0, 7); g.arc(R - 6, Y - 12, 5, 0, 7); g.fill();
      g.fillStyle = INK; g.beginPath(); g.ellipse(128, 118, 9, 11, 0, 0, 7); g.fill();
    } else if (mood === 'think') {
      eye(L + 8, Y - 6, 30, 46); eye(R + 8, Y - 6, 30, 46);
      g.lineWidth = 6; g.beginPath(); g.moveTo(118, 116); g.lineTo(140, 112); g.stroke();
    } else if (mood === 'wait') {
      eye(L, Y + 2, 30, 36); eye(R, Y + 2, 30, 36);
      g.fillStyle = ORANGE; g.fillRect(L - 20, Y - 22, 40, 12); g.fillRect(R - 20, Y - 22, 40, 12);
      g.fillStyle = INK; g.lineWidth = 6; g.beginPath(); g.moveTo(120, 116); g.lineTo(136, 116); g.stroke();
    } else {
      eye(L, Y, 30, 50); eye(R, Y, 30, 50);
      g.fillStyle = '#fff'; g.globalAlpha = 0.9; g.beginPath(); g.arc(L - 5, Y - 12, 4, 0, 7); g.arc(R - 5, Y - 12, 4, 0, 7); g.fill(); g.globalAlpha = 1;
    }
    if (mood === 'sleep') { g.font = '700 26px "DM Mono", monospace'; g.fillStyle = INK; g.fillText('z', 206, 40); g.font = '700 18px monospace'; g.fillText('z', 226, 22); }
    tex.needsUpdate = true;
  }

  function say(text, {dur = 2.6, spin = false} = {}) {
    st.text = text; st.spin = spin; st.textUntil = st.t + dur;
    el.classList.toggle('off', !text);
    render();
  }
  function render() {
    const s = st.spin ? `<b class="sp">${SPIN[Math.floor(st.t * 8) % SPIN.length]}</b> ` : '';
    el.innerHTML = s + st.text;
  }
  const api = {
    root, body,
    get pos() { return root.getWorldPosition(new THREE.Vector3()); },
    hand() { return body.localToWorld(new THREE.Vector3(0.8, 0, 0.2)); },
    mood(m, dur = 2.4) { st.mood = m; st.moodUntil = dur ? st.t + dur : Infinity; st.dirty = true; if (m === 'happy') st.hop = 1; if (m === 'ouch' || m === 'sad') st.shake = 1; return api; },
    say(t, o) { say(t, o); return api; },
    quiet() { say(''); return api; },
    watch(obj) { st.watch = obj; return api; },
    turn(yaw) { st.yawT = yaw; return api; },
    power(k) { st.power = k; skin.emissiveIntensity = 0.05 + 0.25 * k; skin.color.set(ORANGE).multiplyScalar(0.45 + 0.55 * k); return api; },
    update(dt) {
      st.t += dt;
      bubble.visible = parent.scale.x > 0.3;
      const t = st.t;
      if (st.mood !== 'normal' && t > st.moodUntil) st.mood = 'normal';
      if (st.text && t > st.textUntil) { st.text = ''; el.classList.add('off'); }
      if (st.text && st.spin) render();
      st.nextBlink -= dt;
      if (st.nextBlink < 0) { st.blink = 1; st.nextBlink = 2.2 + Math.random() * 3.5; }
      st.blink = Math.max(0, st.blink - dt * 7);
      if (st.watch) {
        const p = st.watch.isVector3 ? st.watch : st.watch.getWorldPosition(new THREE.Vector3());
        const l = body.worldToLocal(p.clone());
        st.gazeT.set(THREE.MathUtils.clamp(l.x / 3, -1, 1), THREE.MathUtils.clamp(l.y / 2.5, -1, 1));
      } else {
        st.wander -= dt;
        if (st.wander < 0) { st.wander = 1.5 + Math.random() * 2.5; st.gazeT.set((Math.random() - 0.5) * 1.1, (Math.random() - 0.5) * 0.5); }
      }
      if (st.mood === 'think') st.gazeT.set(0.6, 0.7);
      st.gaze.lerp(st.gazeT, Math.min(1, dt * 8));
      st.yaw += (st.yawT - st.yaw) * Math.min(1, dt * 5);
      st.hop = Math.max(0, st.hop - dt * 1.6);
      st.shake = Math.max(0, st.shake - dt * 1.8);
      const alive = st.power > 0.3;
      const bob = alive ? Math.sin(t * 2.4) * 0.03 : 0;
      root.position.y = Math.abs(Math.sin(st.hop * Math.PI * 2)) * 0.45 * st.hop + bob;
      body.rotation.y = st.yaw + Math.sin(t * 40) * 0.12 * st.shake;
      body.scale.set(1 + (alive ? Math.sin(t * 2.4) * 0.015 : 0), 1 - (alive ? Math.sin(t * 2.4) * 0.02 : 0.05), 1);
      const wave = st.mood === 'happy' ? Math.sin(t * 14) * 0.5 : st.mood === 'wait' ? Math.sin(t * 5) * 0.12 : alive ? Math.sin(t * 2.4) * 0.05 : 0;
      arms[0].rotation.z = -0.1 - Math.max(0, wave);
      arms[1].rotation.z = 0.1 + Math.max(0, -wave) + (st.mood === 'happy' ? 0.4 : 0);
      legs.forEach((l, i) => l.position.y = -H / 2 - 0.12 + (st.mood === 'wait' ? Math.max(0, Math.sin(t * 9 + i * 1.6)) * 0.04 : 0));
      draw();
    },
  };
  api.power(1);
  draw();
  return api;
}
