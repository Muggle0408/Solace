// 3D 粒子蝴蝶背景 v2：最小化重建版
// 策略：先用最朴素的 THREE.Points 保证可见，再逐步加回高级特性
// 状态循环：合拢(停靠呼吸) ↔ 散开(扑朔弥散)；MediaPipe 预留 window.ButterflyBG.setOpen

import * as THREE from 'three';

const canvas = document.getElementById('bg-canvas');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch (err) {
  document.getElementById('bg3d').style.display = 'none';
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.z = 6.2;

// ---------- 蝶形采样 ----------
function sampleWings(count) {
  const S = 400;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.translate(S / 2, S / 2);
  for (const s of [-1, 1]) {
    g.beginPath(); g.ellipse(s * 74, -58, 80, 58, s * -0.45, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(s * 54, 46, 54, 42, s * 0.4, 0, Math.PI * 2); g.fill();
  }
  const data = g.getImageData(0, 0, S, S).data;
  const pts = [];
  let guard = 0;
  while (pts.length < count && guard < count * 60) {
    guard++;
    const x = (Math.random() * S) | 0;
    const y = (Math.random() * S) | 0;
    if (data[(y * S + x) * 4 + 3] > 128) pts.push([(x - S / 2) / 150, (S / 2 - y) / 150]);
  }
  return pts;
}

const COUNT = 12000;
const base = sampleWings(COUNT);
const pos = new Float32Array(COUNT * 3);
const col = new Float32Array(COUNT * 3);
const seedArr = new Float32Array(COUNT);
const cWhite = new THREE.Color('#ffffff');
const cBlue = new THREE.Color('#5ab4f5');
for (let i = 0; i < COUNT; i++) {
  pos[i * 3] = base[i][0];
  pos[i * 3 + 1] = base[i][1];
  pos[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
  seedArr[i] = Math.random();
  const c = cWhite.clone().lerp(cBlue, Math.random() * 0.55);
  col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
}

const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

const DEBUG = new URLSearchParams(location.search).has('debug');
const mat = new THREE.PointsMaterial({
  size: DEBUG ? 26 : 9,
  sizeAttenuation: false,
  vertexColors: !DEBUG,
  color: DEBUG ? new THREE.Color('#ff2200') : new THREE.Color('#ffffff'),
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

const points = new THREE.Points(geo, mat);
points.frustumCulled = false;
const group = new THREE.Group();
group.add(points);
group.scale.setScalar(1.55);
scene.add(group);

// ---------- 状态机 ----------
const CONF = {
  closedFlap: 0.92, closedBreath: 0.05, closedScatter: 0.03,
  openFlap: 0.1, openAmp: 0.26, openScatter: 0.5,
  durClosed: 5, durOpen: 7, durTrans: 1.6
};
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
let phase = 'closed', phaseT = 0;
let flapFrom = CONF.closedFlap, flapTo = CONF.closedFlap;
let scFrom = CONF.closedScatter, scTo = CONF.closedScatter;
let externalHold = null;
window.ButterflyBG = { setOpen(v) { externalHold = v; } };

// ---------- 每帧 CPU 侧翅膀变换（最小化版不用着色器做旋转） ----------
const cur = new Float32Array(COUNT * 3);
function updatePoints(t, flap, scatter) {
  for (let i = 0; i < COUNT; i++) {
    const bx = base[i][0], by = base[i][1], bz = pos[i * 3 + 2];
    const side = bx < 0 ? -1 : 1;
    const ang = flap * side;
    const c = Math.cos(ang), s = Math.sin(ang);
    let x = bx * c, z = Math.abs(bx) * s + bz;
    let y = by;
    // 微漂浮
    const seed = seedArr[i];
    x += Math.sin(t * (0.8 + seed) + seed * 6.2831) * 0.02;
    y += Math.sin(t * (1.1 + seed * 0.7) + seed * 9.42) * 0.025;
    z += Math.cos(t * (0.9 + seed) + seed * 7.0) * 0.03;
    // 弥散
    const sc = scatter * (0.4 + 0.6 * seed);
    const len = Math.sqrt(bx * bx + by * by) + 0.0001;
    const dx = bx / len, dy = by / len;
    const wob = 0.6 + 0.4 * Math.sin(t * 0.9 + seed * 6.2831);
    x += dx * sc * wob;
    y += dy * sc * wob;
    z += sc * 0.5 * Math.cos(t * 0.7 + seed * 12.0);
    cur[i * 3] = x; cur[i * 3 + 1] = y; cur[i * 3 + 2] = z;
  }
  geo.attributes.position.array.set(cur);
  geo.attributes.position.needsUpdate = true;
}

function updateState(dt, t) {
  phaseT += dt;
  if (externalHold !== null) {
    const want = externalHold ? 'open' : 'closed';
    if (phase !== want && phase !== 'toOpen' && phase !== 'toClosed') {
      flapFrom = curFlap; flapTo = want === 'open' ? CONF.openFlap : CONF.closedFlap;
      scFrom = curScatter; scTo = want === 'open' ? CONF.openScatter : CONF.closedScatter;
      phase = want === 'open' ? 'toOpen' : 'toClosed';
      phaseT = 0;
    }
    return;
  }
  switch (phase) {
    case 'closed':
      curFlap = CONF.closedFlap + Math.sin(t * 1.6) * CONF.closedBreath;
      curScatter = CONF.closedScatter + Math.sin(t * 0.8) * 0.012;
      if (phaseT > CONF.durClosed) {
        flapFrom = curFlap; flapTo = CONF.openFlap;
        scFrom = curScatter; scTo = CONF.openScatter;
        phase = 'toOpen'; phaseT = 0;
      }
      break;
    case 'toOpen': {
      const k = ease(Math.min(phaseT / CONF.durTrans, 1));
      curFlap = flapFrom + (flapTo - flapFrom) * k;
      curScatter = scFrom + (scTo - scFrom) * k;
      if (phaseT >= CONF.durTrans) { phase = 'open'; phaseT = 0; }
      break;
    }
    case 'open':
      curFlap = CONF.openFlap + Math.sin(t * 9) * CONF.openAmp + Math.sin(t * 23) * 0.06;
      curScatter = CONF.openScatter + Math.sin(t * 1.1) * 0.08;
      if (phaseT > CONF.durOpen) {
        flapFrom = curFlap; flapTo = CONF.closedFlap;
        scFrom = curScatter; scTo = CONF.closedScatter;
        phase = 'toClosed'; phaseT = 0;
      }
      break;
    case 'toClosed': {
      const k = ease(Math.min(phaseT / CONF.durTrans, 1));
      curFlap = flapFrom + (flapTo - flapFrom) * k;
      curScatter = scFrom + (scTo - scFrom) * k;
      if (phaseT >= CONF.durTrans) { phase = 'closed'; phaseT = 0; }
      break;
    }
  }
}
let curFlap = CONF.closedFlap, curScatter = CONF.closedScatter;

// ---------- 视差 ----------
let tx = 0, ty = 0, mx = 0, my = 0;
window.addEventListener('pointermove', e => {
  tx = (e.clientX / window.innerWidth - 0.5) * 0.14;
  ty = (e.clientY / window.innerHeight - 0.5) * 0.1;
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- 主循环 ----------
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clock = new THREE.Clock();
let firstFrameLogged = false;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  updateState(dt, t);
  updatePoints(t, curFlap, curScatter);
  group.position.y = Math.sin(t * 0.5) * 0.09;
  group.rotation.z = Math.sin(t * 0.42) * 0.05;
  mx += (tx - mx) * 0.04;
  my += (ty - my) * 0.04;
  camera.position.x = mx;
  camera.position.y = -my;
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  if (!firstFrameLogged) {
    firstFrameLogged = true;
    console.log('[蝴蝶背景v2] 首帧已渲染，绘制调用', renderer.info.render.calls, '三角形', renderer.info.render.triangles);
  }
  requestAnimationFrame(tick);
}

if (DEBUG) console.log('[蝴蝶背景] DEBUG 模式：巨大红色粒子');
console.log('[蝴蝶背景v2] 启动完成，粒子数', COUNT, '阶段', phase);

if (reduced) {
  updatePoints(0, 0.5, 0.08);
  renderer.render(scene, camera);
} else {
  tick();
}

window.__bf = {
  info() {
    return {
      绘制调用: renderer.info.render.calls,
      三角形: renderer.info.render.triangles,
      画布尺寸: canvas.width + 'x' + canvas.height,
      当前阶段: phase,
      翅膀角度: +curFlap.toFixed(3),
      粒子数: COUNT
    };
  },
  renderer, scene, camera
};
