const chatContainer = document.getElementById('chatContainer');
const optionsContainer = document.getElementById('options');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
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

sendBtn.addEventListener('click', () => handleUserMessage(userInput.value));
userInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleUserMessage(userInput.value);
});

// 初始化选项
renderOptions(['焦虑', '委屈', '愤怒', '疲惫', '孤独', '其他']);
