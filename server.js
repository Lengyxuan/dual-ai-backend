const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// 角色提示词
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

// 将自定义角色映射为 API 允许的角色
function normalizeMessages(messages) {
  return messages.map(msg => {
    let role = msg.role;
    if (role === 'builder' || role === 'critic') role = 'assistant';
    return { role, content: msg.content };
  });
}

// 调用 DeepSeek API（使用环境变量中的密钥）
async function callDeepSeek(messages, apiKey) {
  try {
    const normalized = normalizeMessages(messages);
    console.log('Calling DeepSeek with messages:', JSON.stringify(normalized, null, 2));
    const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: normalized,
      stream: false
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    console.log('DeepSeek response:', response.data);
    return response.data.choices[0].message.content;
  } catch (error) {
    if (error.response) {
      console.error('DeepSeek API error status:', error.response.status);
      console.error('DeepSeek API error data:', error.response.data);
    } else if (error.request) {
      console.error('No response received from DeepSeek:', error.request);
    } else {
      console.error('Error setting up request:', error.message);
    }
    throw new Error('AI call failed');
  }
}

// 获取 API 密钥（优先从环境变量读取，其次从请求体读取）
function getApiKey(req) {
  const envKey = process.env.DEEPSEEK_API_KEY;
  if (envKey && envKey !== '') {
    return envKey;
  }
  return req.body.apiKey;
}

// 讨论启动接口
app.post('/api/start', async (req, res) => {
  const { question, maxRounds = 10 } = req.body;
  const apiKey = getApiKey(req);
  if (!apiKey) return res.status(400).json({ error: 'Missing API key. Please set DEEPSEEK_API_KEY in environment or provide in request.' });
  
  let history = [{ role: 'user', content: question }];
  let round = 0;
  let currentRole = 'builder'; // 先由构建者发言
  
  try {
    while (round < maxRounds) {
      round++;
      const systemPrompt = currentRole === 'builder' ? SYSTEM_PROMPTS.builder : SYSTEM_PROMPTS.critic;
      const messagesForAI = [
        { role: 'system', content: systemPrompt },
        ...history
      ];
      
      const reply = await callDeepSeek(messagesForAI, apiKey);
      history.push({ role: currentRole, content: reply });
      
      // 检查是否达成共识
      if (reply.includes('我们达成共识')) {
        return res.json({ finished: true, reason: 'consensus', history });
      }
      
      // 切换角色
      currentRole = currentRole === 'builder' ? 'critic' : 'builder';
    }
    // 达到最大轮次
    return res.json({ finished: true, reason: 'max_rounds', history });
  } catch (error) {
    console.error('Error in /api/start:', error);
    return res.status(500).json({ error: 'AI call failed', details: error.message });
  }
});

// 生成总结接口
app.post('/api/summarize', async (req, res) => {
  const { history } = req.body;
  const apiKey = getApiKey(req);
  if (!apiKey) return res.status(400).json({ error: 'Missing API key. Please set DEEPSEEK_API_KEY in environment or provide in request.' });
  
  const summaryPrompt = `请根据以上讨论，生成一份精炼的总结性答案，整合双方观点，突出共识和最终结论。`;
  const messages = [
    { role: 'system', content: '你是一个专业的总结助手，善于提炼要点。' },
    ...history,
    { role: 'user', content: summaryPrompt }
  ];
  
  try {
    const summary = await callDeepSeek(messages, apiKey);
    res.json({ summary });
  } catch (error) {
    console.error('Error in /api/summarize:', error);
    res.status(500).json({ error: 'Summary failed' });
  }
});

// 全局异常捕获
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
