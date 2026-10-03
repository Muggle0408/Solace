// 3D 粒子蝴蝶背景：Three.js + InstancedBufferGeometry + GLSL + UnrealBloom
// 状态循环：合拢(停靠呼吸) → 散开(扑朔弥散) → 合拢，平滑过渡
// MediaPipe Hands 预留入口：window.ButterflyBG.setOpen(true/false)

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const container = document.getElementById('bg3d');
const canvas = document.getElementById('bg-canvas');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  container.style.display = 'none'; // 无 WebGL 时回退为 CSS 渐变
  throw err;
}

const DPR = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(DPR);
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 0, 6.2);

// ---------- 天空渐变背景（大而远的渐变平面，保证辉光合成稳定） ----------
const skyMat = new THREE.ShaderMaterial({
  depthWrite: false,
  uniforms: {},
  vertexShader: `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    varying vec2 vUv;
    void main(){
      vec3 top = vec3(1.0, 1.0, 1.0);
      vec3 m1  = vec3(0.78, 0.91, 1.0);
      vec3 m2  = vec3(0.53, 0.81, 0.97);
      vec3 bot = vec3(0.29, 0.64, 0.94);
      vec3 c = mix(top, m1, smoothstep(0.0, 0.3, vUv.y));
      c = mix(c, m2, smoothstep(0.3, 0.65, vUv.y));
      c = mix(c, bot, smoothstep(0.65, 1.0, vUv.y));
      gl_FragColor = vec4(c, 1.0);
    }
  `
});
const sky = new THREE.Mesh(new THREE.PlaneGeometry(220, 130), skyMat);
sky.position.z = -40;
scene.add(sky);

// ---------- 蝴蝶翅膀轮廓采样（离屏画布画蝶形，按像素采样粒子） ----------
function sampleWings(count) {
  const S = 400;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.translate(S / 2, S / 2);
  // 左右上翅 + 下翅（椭圆组合成蝶形）
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
    if (data[(y * S + x) * 4 + 3] > 128) {
      pts.push([(x - S / 2) / 150, (S / 2 - y) / 150]);
    }
  }
  return pts;
}

// ---------- 粒子系统（实例化面片 + 自定义着色器） ----------
const COUNT = 14000;
const base = new THREE.PlaneGeometry(1, 1);
const geo = new THREE.InstancedBufferGeometry();
geo.index = base.index;
geo.setAttribute('position', base.attributes.position);
geo.setAttribute('uv', base.attributes.uv);

const pts = sampleWings(COUNT);
const aPos = new Float32Array(COUNT * 3);
const aRand = new Float32Array(COUNT * 4);
for (let i = 0; i < COUNT; i++) {
  aPos[i * 3] = pts[i][0];
  aPos[i * 3 + 1] = pts[i][1];
  aPos[i * 3 + 2] = (Math.random() - 0.5) * 0.14;
  aRand[i * 4] = Math.random();                 // 相位种子
  aRand[i * 4 + 1] = 0.5 + Math.random() * 1.0; // 尺寸
  aRand[i * 4 + 2] = Math.random();             // 颜色混合
  aRand[i * 4 + 3] = 0;                         // 预留
}
geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(aRand, 4));
geo.instanceCount = COUNT;

const uniforms = {
  uTime: { value: 0 },
  uFlap: { value: 1.25 },   // 翅膀折叠角（弧度），大开≈0.12，合拢≈1.25
  uScatter: { value: 0.05 },// 粒子弥散程度
  uSize: { value: 0.05 },
  uPixelRatio: { value: DPR },
  uColA: { value: new THREE.Color('#ffffff') },
  uColB: { value: new THREE.Color('#9fd8ff') },
  uColC: { value: new THREE.Color('#3f9df5') }
};

const mat = new THREE.ShaderMaterial({
  uniforms,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: `
    uniform float uTime, uFlap, uScatter, uSize, uPixelRatio;
    attribute vec3 aPos;
    attribute vec4 aRand;
    varying vec2 vUv;
    varying float vMix;
    varying float vFade;
    void main(){
      vUv = uv;
      float side = sign(aPos.x);
      float seed = aRand.x;
      // 翅膀绕虫体轴（Y）旋转：合拢时 x 折向 z
      float ang = uFlap * side;
      float c = cos(ang), s = sin(ang);
      vec3 p = vec3(aPos.x * c, aPos.y, abs(aPos.x) * s);
      // 常态微漂浮（呼吸感）
      p.x += sin(uTime * (0.8 + seed) + seed * 6.2831) * 0.02;
      p.y += sin(uTime * (1.1 + seed * 0.7) + seed * 9.42) * 0.025;
      p.z += cos(uTime * (0.9 + seed) + seed * 7.0) * 0.03;
      // 散开态：向外弥散 + 回旋
      float sc = uScatter * (0.4 + 0.6 * seed);
      vec3 dir = normalize(vec3(aPos.xy, 0.15) + vec3(0.001));
      p += dir * sc * (0.6 + 0.4 * sin(uTime * 0.9 + seed * 6.2831));
      p.z += sc * 0.5 * cos(uTime * 0.7 + seed * 12.0);
      // 公告板
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float size = uSize * aRand.y * uPixelRatio;
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      mv.xyz += (right * position.x + up * position.y) * size;
      vMix = aRand.z;
      vFade = 0.85 + 0.15 * sin(uTime * (1.3 + seed) + seed * 20.0);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    uniform vec3 uColA, uColB, uColC;
    varying vec2 vUv;
    varying float vMix;
    varying float vFade;
    void main(){
      float d = length(vUv - 0.5) * 2.0;
      float a = smoothstep(1.0, 0.15, d);
      vec3 col = mix(uColA, uColB, vMix);
      col = mix(col, uColC, smoothstep(0.6, 1.0, d) * 0.5);
      gl_FragColor = vec4(col, a * vFade);
    }
  `
});

const butterfly = new THREE.Mesh(geo, mat);
butterfly.frustumCulled = false;
const group = new THREE.Group();
group.add(butterfly);
group.scale.setScalar(1.55);
scene.add(group);

// 调试模式：URL 加 ?debug=1，粒子变为巨大红色不透明，用于定位不可见问题
if (new URLSearchParams(location.search).has('debug')) {
  uniforms.uSize.value = 0.3;
  uniforms.uColA.value.set('#ff2200');
  uniforms.uColB.value.set('#ff2200');
  uniforms.uColC.value.set('#ff2200');
  mat.blending = THREE.NormalBlending;
  console.log('[蝴蝶背景] DEBUG 模式：巨大红色粒子');
}

// ---------- 中心光晕（精灵贴图，叠 Bloom 出电影感光斑） ----------
function glowSprite(size, opacity) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  const sp = new THREE.Sprite(m);
  sp.scale.setScalar(size);
  return sp;
}
const halo = glowSprite(7.5, 0.32);
group.add(halo);
const core = glowSprite(2.4, 0.7);
group.add(core);

// ---------- 辉光合成 ----------
const composer = new EffectComposer(renderer);
composer.setPixelRatio(DPR);
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.1, 0.9, 0.22);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- 状态机：合拢 ↔ 散开 ----------
const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const CONF = {
  closedFlap: 0.92, closedFlapBreath: 0.05, closedScatter: 0.04,
  openFlap: 0.1, openFlapAmp: 0.26, openFlapFast: 0.06, openScatter: 0.55,
  durClosed: 5.0, durOpen: 7.0, durTrans: 1.6
};
let phase = 'closed';   // closed | toOpen | open | toClosed
let phaseT = 0;
let flapFrom = CONF.closedFlap, flapTo = CONF.closedFlap;
let scFrom = CONF.closedScatter, scTo = CONF.closedScatter;

// MediaPipe Hands 预留：window.ButterflyBG.setOpen(true/false) 可外部驱动
let externalHold = null;
window.ButterflyBG = {
  setOpen(v) { externalHold = v; }
};

function updateState(dt, t) {
  phaseT += dt;
  // 外部接管（如手势）
  if (externalHold !== null) {
    const want = externalHold ? 'open' : 'closed';
    if (phase !== want && phase !== 'toOpen' && phase !== 'toClosed') {
      flapFrom = uniforms.uFlap.value; scFrom = uniforms.uScatter.value;
      flapTo = want === 'open' ? CONF.openFlap : CONF.closedFlap;
      scTo = want === 'open' ? CONF.openScatter : CONF.closedScatter;
      phase = want === 'open' ? 'toOpen' : 'toClosed';
      phaseT = 0;
    }
    return;
  }
  switch (phase) {
    case 'closed':
      uniforms.uFlap.value = CONF.closedFlap + Math.sin(t * 1.6) * CONF.closedFlapBreath;
      uniforms.uScatter.value = CONF.closedScatter + Math.sin(t * 0.8) * 0.015;
      if (phaseT > CONF.durClosed) {
        flapFrom = uniforms.uFlap.value; flapTo = CONF.openFlap;
        scFrom = uniforms.uScatter.value; scTo = CONF.openScatter;
        phase = 'toOpen'; phaseT = 0;
      }
      break;
    case 'toOpen': {
      const k = easeInOutCubic(Math.min(phaseT / CONF.durTrans, 1));
      uniforms.uFlap.value = flapFrom + (flapTo - flapFrom) * k;
      uniforms.uScatter.value = scFrom + (scTo - scFrom) * k;
      if (phaseT >= CONF.durTrans) { phase = 'open'; phaseT = 0; }
      break;
    }
    case 'open':
      uniforms.uFlap.value = CONF.openFlap + Math.sin(t * 9.0) * CONF.openFlapAmp + Math.sin(t * 23.0) * CONF.openFlapFast;
      uniforms.uScatter.value = CONF.openScatter + Math.sin(t * 1.1) * 0.08;
      if (phaseT > CONF.durOpen) {
        flapFrom = uniforms.uFlap.value; flapTo = CONF.closedFlap;
        scFrom = uniforms.uScatter.value; scTo = CONF.closedScatter;
        phase = 'toClosed'; phaseT = 0;
      }
      break;
    case 'toClosed': {
      const k = easeInOutCubic(Math.min(phaseT / CONF.durTrans, 1));
      uniforms.uFlap.value = flapFrom + (flapTo - flapFrom) * k;
      uniforms.uScatter.value = scFrom + (scTo - scFrom) * k;
      if (phaseT >= CONF.durTrans) { phase = 'closed'; phaseT = 0; }
      break;
    }
  }
}

// ---------- 鼠标视差（轻微电影感运镜） ----------
let mx = 0, my = 0, tx = 0, ty = 0;
window.addEventListener('pointermove', e => {
  tx = (e.clientX / window.innerWidth - 0.5) * 0.14;
  ty = (e.clientY / window.innerHeight - 0.5) * 0.1;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- 主循环 ----------
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clock = new THREE.Clock();
let firstFrameLogged = false;
renderer.info.autoReset = false; // 手动计数，覆盖合成器的多次渲染
function tick() {
  renderer.info.reset();
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  uniforms.uTime.value = t;
  updateState(dt, t);
  // 整体缓慢悬浮 + 呼吸缩放
  group.position.y = Math.sin(t * 0.5) * 0.09;
  group.rotation.z = Math.sin(t * 0.42) * 0.05;
  const breathe = 1 + Math.sin(t * 0.9) * 0.02;
  group.scale.setScalar(1.55 * breathe);
  // 相机视差
  mx += (tx - mx) * 0.04;
  my += (ty - my) * 0.04;
  camera.position.x = mx;
  camera.position.y = -my;
  camera.lookAt(0, 0, 0);
  composer.render();
  if (!firstFrameLogged) {
    firstFrameLogged = true;
    console.log('[蝴蝶背景] 首帧已渲染，绘制调用', renderer.info.render.calls, '三角形', renderer.info.render.triangles);
  }
  requestAnimationFrame(tick);
}

if (reduced) {
  // 低刺激模式：静态渲染一帧（翅膀微开，无动画）
  uniforms.uFlap.value = 0.5;
  uniforms.uScatter.value = 0.1;
  composer.render();
} else {
  tick();
}
console.log('[蝴蝶背景] 启动完成，粒子数', COUNT, '当前阶段', phase);

// 自检接口：Console 输入 __bf.info() 查看渲染器内部状态
window.__bf = {
  info() {
    return {
      绘制调用: renderer.info.render.calls,
      三角形: renderer.info.render.triangles,
      画布尺寸: canvas.width + 'x' + canvas.height,
      当前阶段: phase,
      翅膀角度: +uniforms.uFlap.value.toFixed(3),
      粒子数: geo.instanceCount,
      画布显示: getComputedStyle(canvas).width + ' / ' + getComputedStyle(canvas).height
    };
  },
  renderer, scene, camera, uniforms
};
