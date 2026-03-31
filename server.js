const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
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

async function callDeepSeek(messages, apiKey) {
  try {
    const normalized = normalizeMessages(messages);
    console.log('[DeepSeek] Request messages:', JSON.stringify(normalized, null, 2));
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: normalized,
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30秒超时
      }
    );
    console.log('[DeepSeek] Response status:', response.status);
    return response.data.choices[0].message.content;
  } catch (error) {
    // 输出简洁的错误信息
    if (error.response) {
      console.error(`[DeepSeek] HTTP ${error.response.status}:`, error.response.data);
    } else if (error.request) {
      console.error('[DeepSeek] No response received:', error.request);
    } else {
      console.error('[DeepSeek] Request setup error:', error.message);
    }
    throw new Error(`DeepSeek API call failed: ${error.message || 'unknown error'}`);
  }
}

// 从环境变量读取 API 密钥（必须）
const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) {
  console.error('❌ 环境变量 DEEPSEEK_API_KEY 未设置！请添加后再启动。');
  process.exit(1);
}

// 启动讨论接口
app.post('/api/start', async (req, res) => {
  const { question, maxRounds = 10 } = req.body;
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid question' });
  }

  let history = [{ role: 'user', content: question }];
  let currentRole = 'builder';
  let round = 0;

  try {
    while (round < maxRounds) {
      round++;
      const systemPrompt = currentRole === 'builder' ? SYSTEM_PROMPTS.builder : SYSTEM_PROMPTS.critic;
      const messagesForAI = [
        { role: 'system', content: systemPrompt },
        ...history
      ];

      const reply = await callDeepSeek(messagesForAI, API_KEY);
      history.push({ role: currentRole, content: reply });

      if (reply.includes('我们达成共识')) {
        return res.json({ finished: true, reason: 'consensus', history });
      }

      currentRole = currentRole === 'builder' ? 'critic' : 'builder';
    }
    return res.json({ finished: true, reason: 'max_rounds', history });
  } catch (error) {
    console.error('[API] /api/start error:', error.message);
    return res.status(500).json({ error: 'AI call failed', details: error.message });
  }
});

// 生成总结接口
app.post('/api/summarize', async (req, res) => {
  const { history } = req.body;
  if (!history || !Array.isArray(history)) {
    return res.status(400).json({ error: 'Invalid history' });
  }

  const summaryPrompt = `请根据以上讨论，生成一份精炼的总结性答案，整合双方观点，突出共识和最终结论。`;
  const messages = [
    { role: 'system', content: '你是一个专业的总结助手，善于提炼要点。' },
    ...history,
    { role: 'user', content: summaryPrompt }
  ];

  try {
    const summary = await callDeepSeek(messages, API_KEY);
    res.json({ summary });
  } catch (error) {
    console.error('[API] /api/summarize error:', error.message);
    res.status(500).json({ error: 'Summary failed', details: error.message });
  }
});

// 健康检查（可选）
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
