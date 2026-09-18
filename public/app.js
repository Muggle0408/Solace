const chatContainer = document.getElementById('chatContainer');
const optionsContainer = document.getElementById('options');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const crisisBanner = document.getElementById('crisisBanner');
const crisisNumbers = document.getElementById('crisisNumbers');

let currentStage = 'welcome';
let startRating = null;
let endRating = null;
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

function addMessage(text, sender) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${sender}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  msgDiv.appendChild(bubble);
  chatContainer.appendChild(msgDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;

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
  if (!text.trim()) return;

  addMessage(text, 'user');
  userInput.value = '';

  // 记录开始情绪评分
  if (currentStage === 'welcome' && startRating === null) {
    const ratingMatch = text.match(/(\d+)/);
    if (ratingMatch) startRating = parseInt(ratingMatch[1], 10);
  }

  // 记录结束情绪评分
  if (currentStage === 'closing' && endRating === null) {
    const ratingMatch = text.match(/(\d+)/);
    if (ratingMatch) endRating = parseInt(ratingMatch[1], 10);
  }

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, stage: currentStage })
    });
    const data = await res.json();

    currentStage = data.stage;

    if (data.type === 'crisis') {
      showCrisisBanner();
    }

    addMessage(data.text, 'bot');
    renderOptions(data.options);

    if (data.stage === 'end') {
      saveSession();
    }
  } catch (err) {
    addMessage('抱歉，发生了一些错误，请稍后再试。', 'bot');
    console.error(err);
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

  const history = JSON.parse(localStorage.getItem('emotion_history') || '[]');
  history.push(sessionRecord);
  // 只保留最近 30 条
  if (history.length > 30) history.shift();
  localStorage.setItem('emotion_history', JSON.stringify(history));

  addSystemNote('本次记录已保存到本地。');
}

sendBtn.addEventListener('click', () => handleUserMessage(userInput.value));
userInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleUserMessage(userInput.value);
});

// 初始化选项
renderOptions(['焦虑', '委屈', '愤怒', '疲惫', '孤独', '其他']);
