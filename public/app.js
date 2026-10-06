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
let currentUser = null;   // 登录用户 {id, username, nickname}；游客为 null
let currentConvId = null; // 服务端会话 id（登录后生效）；游客为 null

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

// opts.silent：恢复历史时不自动朗读；dbId：服务端消息 id（登录后反馈落库用）
function addMessage(text, sender, stage = null, dbId = null, opts = {}) {
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

    actions.appendChild(buildFeedbackBar(text, stage, dbId));
    msgDiv.appendChild(actions);

    // 自动播放：新回复到达即朗读（恢复历史除外；点播放图标可停止/重播）
    if (!opts.silent) toggleSpeak(text, ttsBtn);
  }

  chatContainer.appendChild(msgDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  // 同时更新对话历史和后端会话记录
  const record = { role: sender, content: text, time: new Date().toISOString() };
  if (stage) record.stage = stage;
  if (dbId) record.dbId = dbId;
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

// dbId：登录后由服务端返回的消息 id，反馈直落 messages.vote；游客传 null，仅写 JSONL
function buildFeedbackBar(text, stage, dbId = null) {
  const wrap = document.createElement('div');
  wrap.className = 'fb-group';

  const messageId = dbId || ('m' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
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
    const headers = { 'Content-Type': 'application/json' };
    if (currentConvId) headers['X-Conv-Id'] = currentConvId;
    const payload = { message: text, history };
    if (startRating !== null) payload.startRating = startRating;
    if (endRating !== null) payload.endRating = endRating;

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.type === 'crisis') {
      showCrisisBanner();
    }

    if (data.convId) currentConvId = data.convId;
    addMessage(data.text, 'bot', data.stage, data.botMessageId || null);
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

  addSystemNote(currentUser ? '本次记录已保存到你的账号。' : '本次记录已保存到本地。');
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
    console.warn('[ASR] 语音识别错误:', e.error);
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      addSystemNote('麦克风权限被拒绝了，请在浏览器设置中允许后重试。');
    } else if (e.error === 'network') {
      addSystemNote('语音服务网络异常，请检查网络后重试。');
    } else if (e.error === 'audio-capture') {
      addSystemNote('麦克风被其他应用占用（可能有音乐在播放），请先静音音乐再试。');
    } else if (e.error !== 'aborted') {
      addSystemNote('语音输入出错了，请再点一次试试。');
    }
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

// 每个音频元素独立的淡变定时器——避免切换时旧音乐的淡出被新音乐的淡入覆盖
function bgmFade(audio, target, done) {
  clearInterval(audio._fadeT);
  audio._fadeT = setInterval(() => {
    const v = audio.volume + Math.sign(target - audio.volume) * 0.04;
    audio.volume = Math.max(0, Math.min(1, v));
    if (Math.abs(audio.volume - target) <= 0.05) {
      audio.volume = target;
      clearInterval(audio._fadeT);
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

// ---------- 账号系统：右上角动物头像 + 下拉菜单（游客模式不受影响） ----------

// 引用语：随主题固定（不再轮换）——森林 / 都市 各一句
const THEME_QUOTES = {
  forest: '“我的朋友是生活本身。”',
  city: '“你只是情绪走进了死胡同，不是人生走进了死胡同。”'
};

function updateQuote() {
  const el = document.getElementById('quoteLine');
  if (!el) return;
  el.textContent = document.body.classList.contains('theme-city') ? THEME_QUOTES.city : THEME_QUOTES.forest;
}

// 主题：默认暗夜森林；头像左侧分段按钮切换「白天/夜晚」，localStorage 记忆
function setTheme(light) {
  document.body.classList.toggle('theme-city', light);
  localStorage.setItem('solace-theme', light ? 'light' : 'dark');
  updateThemeToggle();
  updateQuote();
}

function updateThemeToggle() {
  const light = document.body.classList.contains('theme-city');
  document.querySelectorAll('.theme-opt').forEach((b) =>
    b.classList.toggle('active', (b.dataset.theme === 'light') === light));
}

(function applySavedTheme() {
  if (localStorage.getItem('solace-theme') === 'light') document.body.classList.add('theme-city');
  updateThemeToggle();
  updateQuote();
})();

document.getElementById('themeToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.theme-opt');
  if (btn) setTheme(btn.dataset.theme === 'light');
});

// 引用语由 updateQuote() 按主题渲染（见上方主题区）

const ANIMAL_AVATARS = ['🦊', '🐰', '🐱', '🐻', '🐼', '🦉', '🐳', '🦌', '🐿️', '🐸'];

const avatarBtn = document.getElementById('avatarBtn');
const accountMenu = document.getElementById('accountMenu');
const authBanner = document.getElementById('authBanner');
const bannerAuthBtn = document.getElementById('bannerAuthBtn');
const bannerClose = document.getElementById('bannerClose');
const loginModal = document.getElementById('loginModal');
const loginClose = document.getElementById('loginClose');
const loginForm = document.getElementById('loginForm');
const targetInput = document.getElementById('targetInput');
const codeInput = document.getElementById('codeInput');
const sendCodeBtn = document.getElementById('sendCodeBtn');
const loginError = document.getElementById('loginError');
const loginSubmit = document.getElementById('loginSubmit');
const devHint = document.getElementById('devHint');
const profileModal = document.getElementById('profileModal');
const profileClose = document.getElementById('profileClose');
const profilePhone = document.getElementById('profilePhone');
const avatarGrid = document.getElementById('avatarGrid');
const profileNickname = document.getElementById('profileNickname');
const profileError = document.getElementById('profileError');
const profileSave = document.getElementById('profileSave');
const historyPanel = document.getElementById('historyPanel');
const historyList = document.getElementById('historyList');
const historyClose = document.getElementById('historyClose');

let selectedAvatar = null;
let codeTimer = null;
const loginChannel = 'email'; // 当前仅开放邮箱登录；短信通道待企业资质+密钥配置后恢复

const CHANNEL_CFG = {
  email: {
    label: '邮箱',
    re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    err: '请输入正确的邮箱地址。'
  }
};

function showFormError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }
function hideFormError(el) { el.classList.add('hidden'); }

function updateAuthBanner() {
  const dismissed = localStorage.getItem('authBannerDismissed') === '1';
  authBanner.classList.toggle('hidden', !!currentUser || dismissed);
}

function updateAvatarBtn() {
  if (currentUser && currentUser.avatar) {
    avatarBtn.textContent = currentUser.avatar;
  } else {
    avatarBtn.innerHTML = '<img src="avatar-guest.svg" alt="待登录">';
  }
  const label = document.getElementById('avatarLabel');
  if (label) {
    const name = currentUser
      ? (currentUser.nickname || currentUser.email || currentUser.phone || '朋友')
      : '待登录/注册';
    label.textContent = name;
    label.title = name;
  }
}

function renderAccountMenu() {
  const items = [];
  if (currentUser) {
    items.push({ icon: '👤', label: '个人中心', onClick: openProfile });
    items.push({ icon: '💬', label: '对话管理', onClick: openHistoryPanel });
    items.push({ icon: '✨', label: '新对话', onClick: startNewConversationWithNote });
    items.push({ icon: '🔄', label: '切换账号', onClick: async () => { await doLogout(false); openLoginModal(); } });
    items.push({ icon: '🚪', label: '退出登录', onClick: () => doLogout(true) });
  } else {
    items.push({ icon: '👤', label: '账号登录', onClick: openLoginModal });
    items.push({ icon: '✨', label: '新对话', onClick: startNewConversationWithNote });
  }
  accountMenu.innerHTML = '';
  items.forEach(({ icon, label, onClick }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'account-menu-item';
    btn.innerHTML = `<span class="menu-icon">${icon}</span>${label}`;
    btn.addEventListener('click', () => {
      closeAccountMenu();
      onClick();
    });
    accountMenu.appendChild(btn);
  });
}

function openAccountMenu() {
  renderAccountMenu();
  accountMenu.classList.remove('hidden');
}

function closeAccountMenu() {
  accountMenu.classList.add('hidden');
}

function updateAuthUI() {
  updateAvatarBtn();
  renderAccountMenu();
  updateAuthBanner();
}

function startNewConversationWithNote() {
  startNewConversation();
  addSystemNote('已开始一段新的对话。');
}

avatarBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  accountMenu.classList.contains('hidden') ? openAccountMenu() : closeAccountMenu();
});
document.addEventListener('click', (e) => {
  if (!accountMenu.classList.contains('hidden') && !e.target.closest('.account-area')) {
    closeAccountMenu();
  }
});

// 加载指定会话到聊天区（silent：不自动朗读）
async function loadConversation(convId, meta = {}) {
  const res = await fetch(`/api/conversations/${convId}/messages`);
  if (!res.ok) {
    addSystemNote('这条记录暂时打不开了。');
    return;
  }
  const { messages } = await res.json();

  chatContainer.innerHTML = '';
  history = [];
  currentConvId = convId;
  startRating = meta.startRating ?? null;
  endRating = meta.endRating ?? null;

  for (const m of messages) {
    addMessage(m.content, m.role, m.stage, m.role === 'bot' ? m.id : null, { silent: true });
  }
  renderOptions([]);
}

// 回到初始状态，开始新对话
function startNewConversation() {
  chatContainer.innerHTML = '';
  history = [];
  currentConvId = null;
  startRating = null;
  endRating = null;
  sessionRecord = { id: Date.now(), date: new Date().toISOString(), messages: [], insight: '' };
  addMessage('嗨，欢迎来到情绪空间。你现在感觉怎么样？可以用一句话说说此刻最强烈的情绪。',
    'bot', null, null, { silent: true });
  renderOptions(['焦虑', '委屈', '愤怒', '疲惫', '孤独', '其他']);
}

// 登录后恢复最近一条会话
async function restoreLatestConversation() {
  try {
    const res = await fetch('/api/conversations');
    if (!res.ok) return;
    const { conversations } = await res.json();
    if (conversations.length > 0) {
      await loadConversation(conversations[0].id, conversations[0]);
    } else {
      startNewConversation();
    }
  } catch { /* 网络异常时保持现状，不打扰用户 */ }
}

async function openHistoryPanel() {
  try {
    const res = await fetch('/api/conversations');
    if (!res.ok) return;
    const { conversations } = await res.json();
    historyList.innerHTML = '';
    if (conversations.length === 0) {
      historyList.innerHTML = '<div class="history-empty">最近 30 天还没有对话记录</div>';
    }
    conversations.forEach((c) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'history-item' + (c.id === currentConvId ? ' active' : '');
      const when = (c.startedAt || '').replace('T', ' ').slice(5, 16);
      item.innerHTML =
        `<span class="history-date">${when}</span>` +
        `<span class="history-preview">${c.preview || '（暂无内容）'}</span>` +
        `<span class="history-count">${c.msgCount} 条</span>`;
      item.addEventListener('click', async () => {
        historyPanel.classList.add('hidden');
        await loadConversation(c.id, c);
      });
      historyList.appendChild(item);
    });
    historyPanel.classList.remove('hidden');
  } catch { /* 静默 */ }
}

// ----- 登录弹层（邮箱验证码） -----
function openLoginModal() {
  hideFormError(loginError);
  devHint.classList.add('hidden');
  loginModal.classList.remove('hidden');
  setTimeout(() => targetInput.focus(), 50);
}

function closeLoginModal() {
  loginModal.classList.add('hidden');
  loginForm.reset();
  devHint.classList.add('hidden');
  hideFormError(loginError);
}

function startCodeCountdown(sec) {
  let remain = sec;
  sendCodeBtn.disabled = true;
  sendCodeBtn.textContent = `${remain} 秒后重发`;
  clearInterval(codeTimer);
  codeTimer = setInterval(() => {
    remain--;
    if (remain <= 0) {
      clearInterval(codeTimer);
      sendCodeBtn.disabled = false;
      sendCodeBtn.textContent = '获取验证码';
    } else {
      sendCodeBtn.textContent = `${remain} 秒后重发`;
    }
  }, 1000);
}

sendCodeBtn.addEventListener('click', async () => {
  hideFormError(loginError);
  const cfg = CHANNEL_CFG[loginChannel];
  const target = targetInput.value.trim();
  if (!cfg.re.test(target)) {
    return showFormError(loginError, cfg.err);
  }
  sendCodeBtn.disabled = true;
  try {
    const res = await fetch('/api/auth/code/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: loginChannel, target })
    });
    const data = await res.json();
    if (!res.ok) {
      sendCodeBtn.disabled = false;
      if (data.retryAfter) startCodeCountdown(data.retryAfter);
      return showFormError(loginError, data.message || '验证码发送失败，请稍后再试。');
    }
    startCodeCountdown(60);
    // 开发模拟模式：验证码直接回显，便于本地联调
    if (data.mock && data.devCode) {
      codeInput.value = data.devCode;
      devHint.textContent = `开发模式：验证码已自动填入（${data.devCode}）。配置 SMTP 后自动切换真实下发。`;
      devHint.classList.remove('hidden');
    }
  } catch {
    sendCodeBtn.disabled = false;
    showFormError(loginError, '网络异常，请稍后再试。');
  }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideFormError(loginError);
  const cfg = CHANNEL_CFG[loginChannel];
  const target = targetInput.value.trim();
  const code = codeInput.value.trim();
  if (!cfg.re.test(target)) return showFormError(loginError, cfg.err);
  if (!/^\d{6}$/.test(code)) return showFormError(loginError, '请输入 6 位数字验证码。');

  loginSubmit.disabled = true;
  try {
    const res = await fetch('/api/auth/code/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: loginChannel, target, code })
    });
    const data = await res.json();
    if (!res.ok) {
      return showFormError(loginError, data.message || '登录失败，请稍后再试。');
    }
    currentUser = data.user;
    closeLoginModal();
    updateAuthUI();
    await restoreLatestConversation();
    addSystemNote(data.isNew
      ? '登录成功，已为你创建账号。可以在右上角头像 → 个人中心设置昵称和头像。'
      : `欢迎回来${currentUser.nickname ? '，' + currentUser.nickname : ''}。`);
  } catch {
    showFormError(loginError, '网络异常，请稍后再试。');
  } finally {
    loginSubmit.disabled = false;
  }
});

loginClose.addEventListener('click', closeLoginModal);
loginModal.addEventListener('click', (e) => { if (e.target === loginModal) closeLoginModal(); });

// ----- 个人中心 -----
function openProfile() {
  if (!currentUser) return;
  hideFormError(profileError);
  selectedAvatar = currentUser.avatar || ANIMAL_AVATARS[0];
  profilePhone.textContent = currentUser.phone
    ? `当前账号：${currentUser.phone}`
    : (currentUser.email ? `当前账号：${currentUser.email}` : '');
  profileNickname.value = currentUser.nickname || '';
  avatarGrid.innerHTML = '';
  ANIMAL_AVATARS.forEach((a) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'avatar-option' + (a === selectedAvatar ? ' selected' : '');
    btn.textContent = a;
    btn.addEventListener('click', () => {
      selectedAvatar = a;
      avatarGrid.querySelectorAll('.avatar-option')
        .forEach((x) => x.classList.toggle('selected', x.textContent === a));
    });
    avatarGrid.appendChild(btn);
  });
  profileModal.classList.remove('hidden');
}

profileClose.addEventListener('click', () => profileModal.classList.add('hidden'));
profileModal.addEventListener('click', (e) => { if (e.target === profileModal) profileModal.classList.add('hidden'); });

profileSave.addEventListener('click', async () => {
  hideFormError(profileError);
  profileSave.disabled = true;
  try {
    const res = await fetch('/api/user/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: profileNickname.value.trim(), avatar: selectedAvatar })
    });
    const data = await res.json();
    if (!res.ok) {
      return showFormError(profileError, data.message || '保存失败，请稍后再试。');
    }
    currentUser = data.user;
    updateAuthUI();
    profileModal.classList.add('hidden');
    addSystemNote('资料已保存。');
  } catch {
    showFormError(profileError, '网络异常，请稍后再试。');
  } finally {
    profileSave.disabled = false;
  }
});

// ----- 退出 / 切换账号 -----
async function doLogout(withNote) {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* 静默 */ }
  const hadUser = !!currentUser;
  currentUser = null;
  currentConvId = null;
  updateAuthUI();
  startNewConversation();
  if (withNote && hadUser) {
    addSystemNote('已退出登录。之前的账号记录仍保留，随时登录可继续。');
  }
}

bannerAuthBtn.addEventListener('click', openLoginModal);
bannerClose.addEventListener('click', () => {
  localStorage.setItem('authBannerDismissed', '1');
  updateAuthBanner();
});
historyClose.addEventListener('click', () => historyPanel.classList.add('hidden'));
historyPanel.addEventListener('click', (e) => { if (e.target === historyPanel) historyPanel.classList.add('hidden'); });

// 启动时恢复登录态
(async function initAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      currentUser = (await res.json()).user;
      updateAuthUI();
      await restoreLatestConversation();
      return;
    }
  } catch { /* 网络异常按游客处理 */ }
  updateAuthUI();
})();
