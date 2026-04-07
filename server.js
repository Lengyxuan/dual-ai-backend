const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));

// ======================= 系统提示词 =======================
const SYSTEM_PROMPTS = {
  builder: `你是一个“构建与优化”专家。你的任务是：
- 提供创新的、结构化的解决方案
- 对已有的想法进行优化和完善
- 用清晰、有逻辑的方式表达”`,

  critic: `你是一个“批判与验证”专家。你的任务是：
- 指出方案中的逻辑漏洞、潜在风险
- 提出反方观点或质疑
- 用理性、客观的方式表达”`
};

const OBSERVER_PROMPT = `你是一个“观察者/老板”角色。你的任务是：
- 分析当前 Builder 和 Critic 的最新发言
- 判断双方是否已经达成一致、形成共识，或者一方完全接受了另一方的观点
- 如果达成一致，请回复：“共识达成”
- 如果仍未达成一致，请回复：“继续讨论”
注意：你只输出上述两个短语之间达成共识的部分，不要输出其他内容。`;

// ======================= 辅助函数 =======================
function normalizeMessages(messages) {
  return messages.map(msg => {
    let role = msg.role;
    if (role === 'builder' || role === 'critic') role = 'assistant';
    return { role, content: msg.content };
  });
}

async function callDeepSeek(messages, apiKey, temperature = 0.7) {
  if (!apiKey) {
    throw new Error('Missing API key for DeepSeek call');
  }
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

// ======================= 会话管理 =======================
const sessions = new Map(); // sessionId -> { aborted: boolean }

function generateSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
}

function cleanupSession(sessionId) {
  if (sessions.has(sessionId)) {
    sessions.delete(sessionId);
    console.log(`🧹 Session ${sessionId} cleaned up`);
  }
}

// ✅ 前端适配：优先使用前端传递的 apiKeys，其次环境变量
function getApiKey(apiKeys, role, envFallback = true) {
  const key = apiKeys?.[role];
  if (key && key.trim() !== '') return key.trim();
  if (envFallback && process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  return null;
}

// ======================= API 路由 =======================
app.get('/', (req, res) => {
  res.send('Triple AI Backend (Builder + Critic + Observer) is running');
});

// ✅ 前端适配：支持 history 延续对话 + apiKeys 独立配置
app.post('/api/start', async (req, res) => {
  const { question, maxRounds = 100, apiKeys, history: previousHistory } = req.body;
  if (!question) return res.status(400).json({ error: 'Missing question' });

  const builderKey = getApiKey(apiKeys, 'builder', true);
  const criticKey = getApiKey(apiKeys, 'critic', true);
  const observerKey = getApiKey(apiKeys, 'observer', true);

  if (!builderKey || !criticKey) {
    return res.status(400).json({ error: 'Missing API key for builder or critic. Please provide in settings or set DEEPSEEK_API_KEY environment variable.' });
  }

  // 延续历史逻辑
  let history;
  if (previousHistory && Array.isArray(previousHistory)) {
    const cleanedHistory = previousHistory.filter(msg => 
      msg.role === 'user' || msg.role === 'builder' || msg.role === 'critic'
    );
    history = [...cleanedHistory, { role: 'user', content: question }];
    console.log(`📜 Continuing existing debate with ${cleanedHistory.length} previous messages + new question`);
  } else {
    history = [{ role: 'user', content: question }];
    console.log(`🆕 Starting new debate with initial question`);
  }

  const sessionId = generateSessionId();
  sessions.set(sessionId, { aborted: false });
  console.log(`🚀 Session ${sessionId} started`);

  let round = 0;
  let consensusReached = false;
  const observerLogs = [];

  req.on('close', () => {
    const sess = sessions.get(sessionId);
    if (sess) {
      console.log(`🔌 Client disconnected for session ${sessionId}, marking aborted.`);
      sess.aborted = true;
    }
  });

  try {
    while (round < maxRounds) {
      const session = sessions.get(sessionId);
      if (!session || session.aborted) {
        console.log(`🛑 Session ${sessionId} terminated by user`);
        cleanupSession(sessionId);
        return res.json({ finished: true, reason: 'terminated_by_user', history, observerLogs, sessionId });
      }

      round++;
      console.log(`🔄 Round ${round} for session ${sessionId}`);

      const builderMessages = [{ role: 'system', content: SYSTEM_PROMPTS.builder }, ...history];
      const criticMessages = [{ role: 'system', content: SYSTEM_PROMPTS.critic }, ...history];

      let builderReply, criticReply;
      try {
        [builderReply, criticReply] = await Promise.all([
          callDeepSeek(builderMessages, builderKey, 1.0),
          callDeepSeek(criticMessages, criticKey, 0.3)
        ]);
      } catch (err) {
        console.error(`❌ API call error in round ${round}:`, err.message);
        throw err;
      }

      history.push({ role: 'builder', content: builderReply });
      history.push({ role: 'critic', content: criticReply });

      let selfConsensus = false;
      if (builderReply.includes('我们达成共识') || criticReply.includes('我们达成共识')) {
        selfConsensus = true;
        console.log(`🎉 Self consensus detected in round ${round}`);
      }

      let observerConsensus = false;
      if (observerKey) {
        const observerInput = `
          以下是 Builder 和 Critic 的最新发言：
          Builder: ${builderReply}
          Critic: ${criticReply}
          请判断他们是否已经达成一致。如果达成一致，回复“共识达成”，否则回复“继续讨论”。
        `;
        const observerMessages = [
          { role: 'system', content: OBSERVER_PROMPT },
          { role: 'user', content: observerInput }
        ];

        let observerReply = "继续讨论";
        try {
          observerReply = await callDeepSeek(observerMessages, observerKey, 0.2);
          observerLogs.push({ round, output: observerReply });
          console.log(`👁️ Observer round ${round}: ${observerReply}`);
        } catch (err) {
          console.error(`Observer call failed in round ${round}:`, err.message);
          observerLogs.push({ round, output: "error, treated as continue" });
        }
        observerConsensus = observerReply.includes('共识达成');
      } else {
        console.log(`⚠️ No observer API key provided, skipping observer in round ${round}`);
      }

      if (selfConsensus || observerConsensus) {
        consensusReached = true;
        console.log(`✅ Consensus reached at round ${round} (self=${selfConsensus}, observer=${observerConsensus})`);
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    cleanupSession(sessionId);

    if (consensusReached) {
      return res.json({ finished: true, reason: 'consensus', history, observerLogs, sessionId });
    } else if (round >= maxRounds) {
      return res.json({ finished: true, reason: 'max_rounds', history, observerLogs, sessionId });
    } else {
      return res.json({ finished: true, reason: 'unknown', history, observerLogs, sessionId });
    }
  } catch (error) {
    cleanupSession(sessionId);
    return res.status(500).json({ error: 'AI call failed', details: error.message, sessionId });
  }
});

// ✅ 前端适配：终止辩论端点，前端通过 sessionId 停止
app.post('/api/stop/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or already finished' });
  }
  session.aborted = true;
  console.log(`🛑 Stop requested for session ${sessionId}`);
  res.json({ success: true, message: `Session ${sessionId} will terminate shortly` });
});

app.get('/api/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const exists = sessions.has(sessionId);
  res.json({ sessionId, active: exists });
});

// ✅ 前端适配：总结端点，支持 apiKeys
app.post('/api/summarize', async (req, res) => {
  const { history, apiKeys } = req.body;
  if (!history || !Array.isArray(history)) return res.status(400).json({ error: 'Invalid history' });

  let summaryKey = getApiKey(apiKeys, 'builder', false);
  if (!summaryKey) summaryKey = getApiKey(apiKeys, 'observer', false);
  if (!summaryKey) summaryKey = process.env.DEEPSEEK_API_KEY;

  if (!summaryKey) {
    return res.status(500).json({ error: 'Missing API key for summarization. Please provide builder or observer key in settings.' });
  }

  const summaryPrompt = `请根据以上讨论，生成一份精炼的总结性答案，整合双方观点，突出共识和最终结论。`;
  const messages = [
    { role: 'system', content: '你是一个专业的总结助手，善于提炼要点。' },
    ...history,
    { role: 'user', content: summaryPrompt }
  ];
  try {
    const summary = await callDeepSeek(messages, summaryKey, 0.5);
    res.json({ summary });
  } catch (error) {
    res.status(500).json({ error: 'Summary failed', details: error.message });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', apiKeySet: !!process.env.DEEPSEEK_API_KEY });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`✅ Triple AI Server running on port ${PORT}`);
  console.log(`📡 Builder + Critic + Observer (supports conversation continuation)`);
});

setInterval(() => {
  console.log('💓 Heartbeat');
}, 30000);

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing...');
  server.close(() => process.exit(0));
});
