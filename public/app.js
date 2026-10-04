const chatContainer = document.getElementById('chatContainer');
const optionsContainer = document.getElementById('options');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const crisisBanner = document.getElementById('crisisBanner');
const crisisNumbers = document.getElementById('crisisNumbers');

let startRating = null;
let endRating = null;
let history = []; // 对话历史，后端从中恢复当前阶段
let isProcessing = false; // 防止重复提交

let sessionRecord = {
  id: Date.now(),
  date: new Date().toISOString(),
  messages: [],
  insight: ''
};

const HOTLINES = [
  { name: '全国 24 小时心理援助热线', number: '400-161-9995' },
  { name: '北京心理危机研究与干预中心', number: '010-82951332' },
  { name: '生命热线', number: '400-821-1215' }
];

function getCurrentStage() {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'bot' && history[i].stage) {
      return history[i].stage;
    }
  }
  return 'welcome';
}

function addMessage(text, sender, stage = null) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${sender}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  msgDiv.appendChild(bubble);

  // AI 回复附带操作栏：朗读 + 满意度反馈
  if (sender === 'bot') {
    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    const ttsBtn = document.createElement('button');
    ttsBtn.className = 'tts-btn';
    ttsBtn.textContent = '🔊 朗读';
    ttsBtn.dataset.label = '🔊 朗读';
    ttsBtn.title = '朗读这条回复';
    ttsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSpeak(text, ttsBtn);
    });
    actions.appendChild(ttsBtn);

    actions.appendChild(buildFeedbackBar(text, stage));
    msgDiv.appendChild(actions);

    // 自动播放：新回复到达即朗读（点播放图标可停止/重播；新回复会自然打断上一条）
    toggleSpeak(text, ttsBtn);
  }

  chatContainer.appendChild(msgDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  // 同时更新对话历史和后端会话记录
  const record = { role: sender, content: text, time: new Date().toISOString() };
  if (stage) record.stage = stage;
  history.push(record);

  sessionRecord.messages.push({ sender, text, time: new Date().toISOString() });
}

function addSystemNote(text) {
  const note = document.createElement('div');
  note.className = 'system-note';
  note.textContent = text;
  chatContainer.appendChild(note);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// 满意度反馈栏：👍/👎 + 👎 时可选原因标签（静默、不强制、可切换）
const FB_REASONS = ['不贴合我的情况', '太敷衍', '语气不舒服', '其他'];
let fbToastShown = false;

function buildFeedbackBar(text, stage) {
  const wrap = document.createElement('div');
  wrap.className = 'fb-group';

  const messageId = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  let vote = null;

  const up = document.createElement('button');
  up.className = 'fb-btn';
  up.textContent = '👍';
  up.title = '这条回复帮到了我';

  const down = document.createElement('button');
  down.className = 'fb-btn';
  down.textContent = '👎';
  down.title = '这条回复不太对';

  const chips = document.createElement('div');
  chips.className = 'fb-chips';
  FB_REASONS.forEach(r => {
    const c = document.createElement('button');
    c.className = 'fb-chip';
    c.textContent = r;
    c.addEventListener('click', () => submit('down', r));
    chips.appendChild(c);
  });

  function render() {
    up.classList.toggle('active', vote === 'up');
    down.classList.toggle('active', vote === 'down');
    chips.classList.toggle('show', vote === 'down');
  }

  function submit(v, reason = null) {
    vote = v;
    render();
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, stage: stage || 'unknown', vote: v, reason, text })
    }).catch(() => {}); // 失败静默，不打扰用户

    if (!fbToastShown) {
      fbToastShown = true;
      setTimeout(() => addSystemNote('收到你的反馈，谢谢你告诉我。'), 300);
    }
    // 未选原因时，标签条 8 秒后自动收起
    if (v === 'down' && !reason) {
      setTimeout(() => { if (vote === 'down') chips.classList.remove('show'); }, 8000);
    }
  }

  // 再点一次可取消；👍 ⇄ 👎 可切换（追加新记录，看板按 messageId 归并）
  up.onclick = () => { vote === 'up' ? (vote = null, render()) : submit('up'); };
  down.onclick = () => { vote === 'down' ? (vote = null, render()) : submit('down'); };

  wrap.appendChild(up);
  wrap.appendChild(down);
  wrap.appendChild(chips);
  return wrap;
}

function renderOptions(options) {
  optionsContainer.innerHTML = '';
  if (!options || options.length === 0) return;

  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = opt;
    btn.addEventListener('click', () => handleUserMessage(opt));
    optionsContainer.appendChild(btn);
  });
}

function showCrisisBanner() {
  crisisNumbers.textContent = HOTLINES.map(h => `${h.name} ${h.number}`).join('；');
  crisisBanner.classList.remove('hidden');
}

async function handleUserMessage(text) {
  if (!text.trim() || isProcessing) return;
  isProcessing = true;

  const currentStage = getCurrentStage();

  // 记录开始/结束情绪评分
  if (currentStage === 'welcome' && startRating === null) {
    const ratingMatch = text.match(/(\d+)/);
    if (ratingMatch) startRating = parseInt(ratingMatch[1], 10);
  }
  if (currentStage === 'closing' && endRating === null) {
    const ratingMatch = text.match(/(\d+)/);
    if (ratingMatch) endRating = parseInt(ratingMatch[1], 10);
  }

  addMessage(text, 'user');
  userInput.value = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history })
    });
    const data = await res.json();

    if (data.type === 'crisis') {
      showCrisisBanner();
    }

    addMessage(data.text, 'bot', data.stage);
    renderOptions(data.options);

    if (data.stage === 'end') {
      saveSession();
    }
  } catch (err) {
    addMessage('抱歉，发生了一些错误，请稍后再试。', 'bot');
    console.error(err);
  } finally {
    isProcessing = false;
  }
}

function saveSession() {
  sessionRecord.endRating = endRating;
  sessionRecord.startRating = startRating;

  // 简单提取 insight：取 rebuild 阶段后用户说的话
  const rebuildIdx = sessionRecord.messages.findIndex(m => m.text.includes('如果换成你最信任'));
  if (rebuildIdx >= 0 && sessionRecord.messages[rebuildIdx + 1]) {
    sessionRecord.insight = sessionRecord.messages[rebuildIdx + 1].text;
  }

  const stored = JSON.parse(localStorage.getItem('emotion_history') || '[]');
  stored.push(sessionRecord);
  if (stored.length > 30) stored.shift();
  localStorage.setItem('emotion_history', JSON.stringify(stored));

  addSystemNote('本次记录已保存到本地。');
}

// ---------- 语音能力：ASR 输入 + TTS 播报（浏览器原生，无额外依赖） ----------

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recording = false;
let speakingBtn = null;

// TTS：浏览器自带朗读（作为降级方案）
function speak(text, btn = null) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  if (speakingBtn) speakingBtn.classList.remove('speaking');
  speakingBtn = null;

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'zh-CN';
  utter.rate = 0.95;
  const zhVoice = speechSynthesis.getVoices().find(v => /zh|中文|Chinese/i.test(v.lang + v.name));
  if (zhVoice) utter.voice = zhVoice;

  if (btn) {
    btn.classList.add('speaking');
    speakingBtn = btn;
    const done = () => btn.classList.remove('speaking');
    utter.onend = done;
    utter.onerror = done;
  }
  speechSynthesis.speak(utter);
}

// 云端情感 TTS：优先调用豆包语音大模型；未配置或失败时静默降级浏览器朗读
let currentAudio = null;
let currentAudioUrl = null;
let speakSeq = 0;

function stopSpeaking() {
  speakSeq++; // 使进行中的异步播放失效
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if (currentAudioUrl) { URL.revokeObjectURL(currentAudioUrl); currentAudioUrl = null; }
  if (speakingBtn) {
    speakingBtn.classList.remove('speaking');
    speakingBtn.textContent = speakingBtn.dataset.label || '🔊 朗读';
    speakingBtn = null;
  }
}

async function toggleSpeak(text, btn) {
  const isSpeakingThis = speakingBtn === btn;
  stopSpeaking();
  if (isSpeakingThis) return; // 再点一次 = 停止
  const mySeq = ++speakSeq;   // 必须在 stopSpeaking 之后取序号，否则新播放会被自己判为已取消

  btn.classList.add('speaking');
  btn.textContent = '⏳ 合成中…';
  speakingBtn = btn;

  // 15 秒超时保护：网络异常时绝不永久卡在"合成中"
  const controller = new AbortController();
  const ttsTimeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal
    });
    clearTimeout(ttsTimeout);
    console.log('[朗读] 合成接口返回:', res.status);
    if (mySeq !== speakSeq) return; // 等待期间被取消了
    if (res.ok) {
      const blob = await res.blob();
      console.log('[朗读] 音频大小:', blob.size, '字节');
      if (mySeq !== speakSeq) return;
      currentAudioUrl = URL.createObjectURL(blob);
      const audio = new Audio(currentAudioUrl);
      currentAudio = audio;
      audio.onended = audio.onerror = () => {
        if (speakingBtn === btn) {
          btn.classList.remove('speaking');
          btn.textContent = btn.dataset.label || '🔊 朗读';
          speakingBtn = null;
        }
        if (currentAudioUrl) { URL.revokeObjectURL(currentAudioUrl); currentAudioUrl = null; }
        currentAudio = null;
      };
      btn.textContent = '🔊 点击停止';
      try {
        await audio.play();
        console.log('[朗读] 播放已开始');
      } catch (playErr) {
        console.warn('[朗读] 播放被浏览器阻止:', playErr.name, playErr.message);
        throw playErr;
      }
      return;
    }
  } catch (err) {
    clearTimeout(ttsTimeout);
    console.warn('[朗读] 异常:', err.name, err.message);
    // 网络超时或接口异常 → 走降级
  }
  if (mySeq !== speakSeq) return;
  btn.textContent = btn.dataset.label || '🔊 朗读';
  speak(text, btn);
}

// ASR：点击开始录音，转写结果填入输入框，用户确认后发送
function setRecordingState(on) {
  recording = on;
  micBtn.classList.toggle('recording', on);
  micBtn.textContent = on ? '■' : '🎤';
  userInput.placeholder = on ? '正在聆听，请说话…' : '输入你想说的话...';
}

function startRecording() {
  recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = true;
  recognition.continuous = false;

  let finalTranscript = '';
  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    userInput.value = finalTranscript + interim;
  };
  recognition.onend = () => setRecordingState(false);
  recognition.onerror = (e) => {
    setRecordingState(false);
    if (e.error === 'not-allowed') addSystemNote('麦克风权限被拒绝了，请在浏览器设置中允许后重试。');
  };

  setRecordingState(true);
  recognition.start();
}

if (micBtn) {
  if (!SpeechRecognition) {
    micBtn.disabled = true;
    micBtn.title = '当前浏览器不支持语音输入，建议使用 Chrome / Edge';
  } else {
    micBtn.addEventListener('click', () => {
      if (recording) {
        recognition && recognition.stop();
      } else {
        try { startRecording(); } catch (err) { setRecordingState(false); }
      }
    });
  }
}

sendBtn.addEventListener('click', () => handleUserMessage(userInput.value));
userInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleUserMessage(userInput.value);
});

// 初始化选项
renderOptions(['焦虑', '委屈', '愤怒', '疲惫', '孤独', '其他']);

// ---------- 背景音乐面板：九种治愈音景（含静音），淡入淡出切换 ----------
const BGM_LIST = [
  { id: 'mute', icon: '🔇', label: '静音', src: null },
  { id: 'fire', icon: '🔥', label: '篝火', src: '/bgm/fire.mp3' },
  { id: 'rain', icon: '🌧️', label: '下雨', src: '/bgm/rain.mp3' },
  { id: 'stream', icon: '💧', label: '泉水', src: '/bgm/stream.mp3' },
  { id: 'waves', icon: '🌊', label: '海浪', src: '/bgm/waves.mp3' },
  { id: 'wind', icon: '🍃', label: '风声', src: '/bgm/wind.mp3' },
  { id: 'night', icon: '🌙', label: '夜晚', src: '/bgm/night.mp3' },
  { id: 'musicbox', icon: '🎵', label: '八音盒', src: '/bgm/musicbox.mp3' },
  { id: 'bowl', icon: '🪷', label: '颂钵', src: '/bgm/bowl.mp3' }
];
const bgmListEl = document.getElementById('bgmList');
let bgmAudio = null;
let bgmCurrentId = null;
let bgmFadeTimer = null;

function bgmFade(audio, target, done) {
  clearInterval(bgmFadeTimer);
  bgmFadeTimer = setInterval(() => {
    const v = audio.volume + Math.sign(target - audio.volume) * 0.04;
    audio.volume = Math.max(0, Math.min(1, v));
    if (Math.abs(audio.volume - target) <= 0.05) {
      audio.volume = target;
      clearInterval(bgmFadeTimer);
      if (done) done();
    }
  }, 60);
}

function selectBgm(id) {
  const item = BGM_LIST.find(b => b.id === id) || BGM_LIST[0];
  document.querySelectorAll('.bgm-item').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.id === item.id));
  localStorage.setItem('bgm', item.id);

  if (bgmAudio) {
    const old = bgmAudio;
    bgmAudio = null;
    bgmFade(old, 0, () => old.pause());
  }
  bgmCurrentId = item.id;
  if (!item.src) return; // 静音

  const audio = new Audio(item.src);
  audio.loop = true;
  audio.volume = 0;
  audio.play().then(() => bgmFade(audio, 0.45)).catch(() => {
    // 浏览器拦截时静默失败，下次点击再试
  });
  bgmAudio = audio;
}

if (bgmListEl) {
  BGM_LIST.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'bgm-item';
    btn.dataset.id = item.id;
    btn.title = item.label;
    btn.innerHTML = `<span class="bgm-circle">${item.icon}</span><span class="bgm-label">${item.label}</span>`;
    btn.addEventListener('click', () => selectBgm(item.id));
    bgmListEl.appendChild(btn);
  });
  // 恢复上次选择（仅高亮，不自动播放——遵守浏览器自动播放策略）
  const saved = localStorage.getItem('bgm');
  if (saved) document.querySelectorAll('.bgm-item').forEach(b =>
    b.classList.toggle('active', b.dataset.id === saved));
}
