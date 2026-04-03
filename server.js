const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));

const SYSTEM_PROMPTS = {
  builder: `你是一个“构建与优化”专家。你的任务是：
- 提供创新的、结构化的解决方案
- 对已有的想法进行优化和完善
- 用清晰、有逻辑的方式表达
- 如果与对方达成一致，请在发言末尾明确说“我们达成共识”`,

  critic: `你是一个“批判与验证”专家。你的任务是：
- 指出方案中的逻辑漏洞、潜在风险
- 提出反方观点或质疑
- 用理性、客观的方式表达
- 如果与对方达成一致，请在发言末尾明确说“我们达成共识”`
};

function normalizeMessages(messages) {
  return messages.map(msg => {
    let role = msg.role;
    if (role === 'builder' || role === 'critic') role = 'assistant';
    return { role, content: msg.content };
  });
}

async function callDeepSeek(messages, apiKey, temperature = 0.7) {
  try {
    const normalized = normalizeMessages(messages);
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: normalized,
        stream: false,
        temperature: temperature
      },
      {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 90000
      }
    );
    return response.data.choices[0].message.content;
  } catch (error) {
    if (error.code === 'ECONNABORTED') console.error('[DeepSeek] Timeout');
    else if (error.response) console.error(`[DeepSeek] HTTP ${error.response.status}:`, error.response.data);
    else console.error('[DeepSeek] Error:', error.message);
    throw new Error(`DeepSeek API call failed: ${error.message}`);
  }
}

const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) console.warn('⚠️ 警告: DEEPSEEK_API_KEY 未设置');
else console.log('✅ DeepSeek API key 已加载');

// 根路由
app.get('/', (req, res) => {
  res.send('Dual AI Backend is running');
});

app.post('/api/start', async (req, res) => {
  const { question, maxRounds = 10 } = req.body;
  if (!question) return res.status(400).json({ error: 'Missing question' });
  if (!API_KEY) return res.status(500).json({ error: 'Missing API key' });

  let history = [{ role: 'user', content: question }];
  let currentRole = 'builder';
  let round = 0;

  try {
    while (round < maxRounds) {
      round++;
      const systemPrompt = currentRole === 'builder' ? SYSTEM_PROMPTS.builder : SYSTEM_PROMPTS.critic;
      const messagesForAI = [{ role: 'system', content: systemPrompt }, ...history];
      const temperature = currentRole === 'builder' ? 1.0 : 0.3;
      const reply = await callDeepSeek(messagesForAI, API_KEY, temperature);
      history.push({ role: currentRole, content: reply });
      if (reply.includes('我们达成共识')) {
        return res.json({ finished: true, reason: 'consensus', history });
      }
      currentRole = currentRole === 'builder' ? 'critic' : 'builder';
    }
    return res.json({ finished: true, reason: 'max_rounds', history });
  } catch (error) {
    return res.status(500).json({ error: 'AI call failed', details: error.message });
  }
});

app.post('/api/summarize', async (req, res) => {
  const { history } = req.body;
  if (!history || !Array.isArray(history)) return res.status(400).json({ error: 'Invalid history' });
  if (!API_KEY) return res.status(500).json({ error: 'Missing API key' });

  const summaryPrompt = `请根据以上讨论，生成一份精炼的总结性答案，整合双方观点，突出共识和最终结论。`;
  const messages = [
    { role: 'system', content: '你是一个专业的总结助手，善于提炼要点。' },
    ...history,
    { role: 'user', content: summaryPrompt }
  ];
  try {
    const summary = await callDeepSeek(messages, API_KEY, 0.5);
    res.json({ summary });
  } catch (error) {
    res.status(500).json({ error: 'Summary failed', details: error.message });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', apiKeySet: !!API_KEY });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

// 心跳
setInterval(() => {
  console.log('💓 Heartbeat');
}, 30000);

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing...');
  server.close(() => process.exit(0));
});   
