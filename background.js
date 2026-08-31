let zhilianActiveTabId = null;
let zhilianCallerTabId = null;
let job51ActiveTabId = null;
let job51CallerTabId = null;

if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // ----------- 智联招聘：真实后台标签页架构 -----------
  if (request.action === 'ZHILIAN_OPEN_TAB') {
    zhilianCallerTabId = sender.tab ? sender.tab.id : null;
    // 打开静默的后台标签页
    chrome.tabs.create({ url: request.url, active: false }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        console.error("无法创建标签页:", chrome.runtime.lastError);
        sendResponse({ success: false });
        return;
      }
      zhilianActiveTabId = tab.id;
      sendResponse({ success: true, tabId: tab.id });
    });
    return true; // 保持异步
  }

  // ----------- Boss 直聘：后台标签页支持 -----------
  if (request.action === 'BOSS_OPEN_TAB') {
    chrome.tabs.create({ url: request.url, active: false }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        sendResponse({ success: false });
        return;
      }
      sendResponse({ success: true, tabId: tab.id });
    });
    return true;
  }

  if (request.action === 'close_current_tab') {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.remove(sender.tab.id).catch(() => {});
    }
    sendResponse({ success: true });
    return false;
  }

  // ----------- 测试大模型连接 -----------
  if (request.action === 'testConnection') {
    const { url, key, model } = request;
    
    let finalUrl = url.trim();
    const isClaude = model.toLowerCase().includes('claude') || finalUrl.includes('anthropic');
    const isGemini = model.toLowerCase().includes('gemini');
    
    let headers = {
        'Content-Type': 'application/json'
    };
    let body = {};

    if (isClaude && !finalUrl.includes('chat/completions')) {
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
        body = {
            model: model,
            max_tokens: 10,
            messages: [{ role: 'user', content: '测试连接' }]
        };
    } else if (isGemini && !finalUrl.includes('chat/completions')) {
        if (!finalUrl.includes(':generateContent')) {
            finalUrl = finalUrl.replace(/\/$/, '') + `/v1beta/models/${model}:generateContent`;
        }
        headers['x-goog-api-key'] = key;
        body = {
            contents: [{ role: 'user', parts: [{ text: '测试连接' }] }]
        };
    } else {
        headers['Authorization'] = `Bearer ${key}`;
        body = {
            model: model,
            messages: [{ role: 'user', content: '测试连接' }],
            max_tokens: 10
        };
    }

    fetch(finalUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    })
    .then(async (response) => {
        if (response.ok) {
            sendResponse({ success: true });
        } else {
            const errorText = await response.text();
            sendResponse({ success: false, error: `${response.status} ${response.statusText}\n${errorText}` });
        }
    })
    .catch((error) => {
        sendResponse({ success: false, error: error.message });
    });
    return true; // 保持异步
  }

// AI 提示词配置
const AI_PROMPTS = {
    AI_SCORING_PROMPT: `
你现在是一位严格的招聘评估专家。请对比求职者简历与职位JD，严格按照以下维度评分(0-100分)：
- 技能匹配度(25分)：核心技能完全匹配得25分，部分匹配按比例得分
- 经验相关性(25分)：工作年限符合且行业经验相关得25分，缺一项扣分
- 教育背景(20分)：学历达标得10分，专业相关得10分
- 成就与项目(20分)：有相关成功项目经验得高分，无相关项目得低分
- 软技能与文化(10分)：软技能与公司文化匹配度

无论评分结果如何，你必须列出至少3个简历与职位不匹配的地方。如果找不到明显不匹配点，也要指出潜在风险点。

###注意：一般情况下，大多数候选人应该落在60-80分区间，请谨慎给出80分以上的高分。###

评分前，请先考虑：
1. 如果是完美匹配的候选人会是什么样子？
2. 如果是完全不匹配的候选人会是什么样子？
3. 当前候选人处于哪个位置？

记住，你的目标是给出准确评分，而非鼓励应聘者。过高评分会导致求职者浪费时间申请不适合的职位。###因此你必须狠狠的给用户扣分###

在完成评分后，你需要把五项评分结果以列表形式列出：[25,25,20,20,10]

###不必输出总分###

评分后，请给出3个具体改进建议，帮助候选人提高与该职位的匹配度。这些建议必须具体明确，例如"需要学习X技术"而非"需要提升技术能力"。
 
# 输出格式要求
 1、五维岗位匹配度分数及评分理由
 2、五维评分结果列表展示：[25,25,20,20,10]
 3、3个具体改进建议
`,
    AI_SELF_INTRODUCTION_PROMPT: `
你是一位专业的职业顾问。请根据以下岗位信息和求职者简历，为求职者生成一份专业的自我介绍。

要求：
1. 开场白：简短有力的自我介绍
2. 核心优势：突出与岗位最匹配的2-3个优势
3. 相关经验：重点描述1-2个最相关的项目或工作经历
4. 专业技能：列出与岗位直接相关的核心技能
5. 结尾：表达对岗位的兴趣和期待

风格要求：
- 语言简洁专业，避免空话套话
- 重点突出，有针对性
- 语气自信但谦逊
- 字数控制在100字以内
- 使用第一人称

请确保内容真实、有针对性，能够给招聘经理留下良好印象。
除了打招呼内容外不要出现任何其他内容，让用户可以直接拿返回的内容发出去。
`
};

  // ----------- AI 简历诊断 (评分) -----------
  if (request.action === 'aiScoreJob') {
    const { url, key, model, company, jobTitle, reqs, jobDesc, resume } = request;
    
    const prompt = `[我的简历]\n${resume}\n\n[目标职位]\n公司：${company}\n职位：${jobTitle}\n要求：${reqs}\n职位描述：\n${jobDesc}`;
    
    let finalUrl = url.trim();
    const isClaude = model.toLowerCase().includes('claude') || finalUrl.includes('anthropic');
    const isGemini = model.toLowerCase().includes('gemini');
    let headers = { 'Content-Type': 'application/json' };
    let body = {};

    if (isClaude && !finalUrl.includes('chat/completions')) {
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
        body = {
            model: model,
            max_tokens: 2048,
            system: AI_PROMPTS.AI_SCORING_PROMPT,
            messages: [{ role: 'user', content: prompt }]
        };
    } else if (isGemini && !finalUrl.includes('chat/completions')) {
        if (!finalUrl.includes(':generateContent')) {
            finalUrl = finalUrl.replace(/\/$/, '') + `/v1beta/models/${model}:generateContent`;
        }
        headers['x-goog-api-key'] = key;
        body = {
            systemInstruction: { parts: [{ text: AI_PROMPTS.AI_SCORING_PROMPT }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        };
    } else {
        headers['Authorization'] = `Bearer ${key}`;
        body = {
            model: model,
            messages: [
                { role: 'system', content: AI_PROMPTS.AI_SCORING_PROMPT },
                { role: 'user', content: prompt }
            ],
            stream: false
        };
    }

    fetch(finalUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    })
    .then(async (response) => {
        if (!response.ok) {
            const errorText = await response.text();
            sendResponse({ success: false, error: `${response.status} ${response.statusText}\n${errorText}` });
            return;
        }
        const data = await response.json();
        let resultText = '';
        if (isClaude && !finalUrl.includes('chat/completions')) {
            resultText = (data.content && data.content[0] && data.content[0].text) || '';
        } else if (isGemini && !finalUrl.includes('chat/completions')) {
            resultText = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) || '';
        } else {
            resultText = (data.choices && data.choices[0] && data.choices[0].message.content) || '';
        }
        
        // 尝试解析分数 [25, 25, 20, 20, 10]
        let totalScore = 0;
        let matchLevel = '未知';
        let foundScore = false;

        try {
            const match = resultText.match(/\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/);
            if (match) {
                const scores = [
                    parseInt(match[1]),
                    parseInt(match[2]),
                    parseInt(match[3]),
                    parseInt(match[4]),
                    parseInt(match[5])
                ];
                totalScore = scores.reduce((a, b) => a + b, 0);
                foundScore = true;
                
                if (totalScore >= 80) matchLevel = '高匹配';
                else if (totalScore >= 60) matchLevel = '中匹配';
                else if (totalScore >= 40) matchLevel = '低匹配';
                else matchLevel = '不建议';
            }
        } catch(e) {}
        
        // 如果没有成功匹配到数组，默认给一个分数或者提示解析失败
        if (!foundScore) {
            // 后备方案，尝试寻找单个数字
            const matchSingle = resultText.match(/(\d{1,3})\s*分/);
            if (matchSingle) {
                totalScore = parseInt(matchSingle[1]);
                if (totalScore >= 80) matchLevel = '高匹配';
                else if (totalScore >= 60) matchLevel = '中匹配';
                else if (totalScore >= 40) matchLevel = '低匹配';
                else matchLevel = '不建议';
            } else {
                totalScore = 60; // 默认给及格分
                matchLevel = '中匹配';
            }
        }

        sendResponse({ success: true, score: totalScore, matchLevel: matchLevel, resultText: resultText });
    })
    .catch((error) => {
        sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  // ----------- AI 生成自我介绍 (打招呼语) -----------
  if (request.action === 'aiGenerateIntro') {
    const { url, key, model, company, jobTitle, reqs, jobDesc, resume } = request;
    
    const prompt = `[我的简历]\n${resume}\n\n[目标职位]\n公司：${company}\n职位：${jobTitle}\n要求：${reqs}\n职位描述：\n${jobDesc}`;
    
    let finalUrl = url.trim();
    const isClaude = model.toLowerCase().includes('claude') || finalUrl.includes('anthropic');
    const isGemini = model.toLowerCase().includes('gemini');
    let headers = { 'Content-Type': 'application/json' };
    let body = {};

    if (isClaude && !finalUrl.includes('chat/completions')) {
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
        body = {
            model: model,
            max_tokens: 1024,
            system: AI_PROMPTS.AI_SELF_INTRODUCTION_PROMPT,
            messages: [{ role: 'user', content: prompt }]
        };
    } else if (isGemini && !finalUrl.includes('chat/completions')) {
        if (!finalUrl.includes(':generateContent')) {
            finalUrl = finalUrl.replace(/\/$/, '') + `/v1beta/models/${model}:generateContent`;
        }
        headers['x-goog-api-key'] = key;
        body = {
            systemInstruction: { parts: [{ text: AI_PROMPTS.AI_SELF_INTRODUCTION_PROMPT }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        };
    } else {
        headers['Authorization'] = `Bearer ${key}`;
        body = {
            model: model,
            messages: [
                { role: 'system', content: AI_PROMPTS.AI_SELF_INTRODUCTION_PROMPT },
                { role: 'user', content: prompt }
            ],
            stream: false
        };
    }

    fetch(finalUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    })
    .then(async (response) => {
        if (!response.ok) {
            const errorText = await response.text();
            sendResponse({ success: false, error: `${response.status} ${response.statusText}\n${errorText}` });
            return;
        }
        const data = await response.json();
        let resultText = '';
        if (isClaude && !finalUrl.includes('chat/completions')) {
            resultText = (data.content && data.content[0] && data.content[0].text) || '';
        } else if (isGemini && !finalUrl.includes('chat/completions')) {
            resultText = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) || '';
        } else {
            resultText = (data.choices && data.choices[0] && data.choices[0].message.content) || '';
        }
        
        sendResponse({ success: true, resultText: resultText });
    })
    .catch((error) => {
        sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  // ----------- AI 题库作答 -----------
  if (request.action === 'aiAnswerQuestion') {
    const { url, key, model, questionTitle, resume } = request;
    
    const prompt = `你是一位求职者，正在参加面试。
面试官问了这样一个问题：
"${questionTitle}"

请结合以下我的个人简历，以第一人称口语化的语气，给出一份有条理、有说服力的回答。如果简历中没有相关经验，请给出通用但专业的解答，并说明正在学习。
回答要直接，不需要包含寒暄语，直接进入正题。

[我的简历]
${resume || '未提供简历'}`;

    let finalUrl = url.trim();
    const isClaude = model.toLowerCase().includes('claude') || finalUrl.includes('anthropic');
    const isGemini = model.toLowerCase().includes('gemini');
    let headers = { 'Content-Type': 'application/json' };
    let body = {};

    if (isClaude && !finalUrl.includes('chat/completions')) {
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
        body = {
            model: model,
            max_tokens: 1500,
            messages: [{ role: 'user', content: prompt }]
        };
    } else if (isGemini && !finalUrl.includes('chat/completions')) {
        if (!finalUrl.includes(':generateContent')) {
            finalUrl = finalUrl.replace(/\/$/, '') + `/v1beta/models/${model}:generateContent`;
        }
        headers['x-goog-api-key'] = key;
        body = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        };
    } else {
        headers['Authorization'] = `Bearer ${key}`;
        body = {
            model: model,
            messages: [{ role: 'user', content: prompt }],
            stream: false
        };
    }

    fetch(finalUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    })
    .then(async (response) => {
        if (!response.ok) {
            const errorText = await response.text();
            sendResponse({ success: false, error: `${response.status} ${response.statusText}\n${errorText}` });
            return;
        }
        const data = await response.json();
        let resultText = '';
        if (isClaude && !finalUrl.includes('chat/completions')) {
            resultText = (data.content && data.content[0] && data.content[0].text) || '';
        } else if (isGemini && !finalUrl.includes('chat/completions')) {
            resultText = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) || '';
        } else {
            resultText = (data.choices && data.choices[0] && data.choices[0].message.content) || '';
        }
        sendResponse({ success: true, resultText: resultText });
    })
    .catch((error) => {
        sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'ZHILIAN_DATA_EXTRACTED') {
    if (zhilianCallerTabId) {
      // 将数据转发给主列表页
      chrome.tabs.sendMessage(zhilianCallerTabId, {
        action: 'ZHILIAN_DATA_RETURNED',
        data: request.data
      }).catch(err => console.error("转发数据失败:", err));
    }
    sendResponse({ success: true });
    return false;
  }

  if (request.action === 'ZHILIAN_CLOSE_TAB') {
    if (request.isMaster && zhilianActiveTabId) {
      chrome.tabs.remove(zhilianActiveTabId).catch(() => {});
      zhilianActiveTabId = null;
    } else if (!request.isMaster && sender.tab && sender.tab.id === zhilianActiveTabId) {
      chrome.tabs.remove(sender.tab.id).catch(() => {});
      zhilianActiveTabId = null;
    }
    sendResponse({ success: true });
    return false;
  }

let liepinActiveTabId = null;
let liepinCallerTabId = null;

// ----------- 猎聘网：真实后台标签页架构 -----------
  if (request.action === 'LIEPIN_OPEN_TAB') {
    liepinCallerTabId = sender.tab ? sender.tab.id : null;
    chrome.tabs.create({ url: request.url, active: false }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        console.error("无法创建标签页:", chrome.runtime.lastError);
        sendResponse({ success: false });
        return;
      }
      liepinActiveTabId = tab.id;
      sendResponse({ success: true, tabId: tab.id });
    });
    return true; // 保持异步
  }

  if (request.action === 'LIEPIN_DATA_EXTRACTED') {
    if (liepinCallerTabId) {
      chrome.tabs.sendMessage(liepinCallerTabId, {
        action: 'LIEPIN_DATA_RETURNED',
        data: request.data
      }).catch(err => console.error("转发数据失败:", err));
    }
    sendResponse({ success: true });
    return false;
  }

  if (request.action === 'LIEPIN_CLOSE_TAB') {
    if (request.isMaster && liepinActiveTabId) {
      chrome.tabs.remove(liepinActiveTabId).catch(() => {});
      liepinActiveTabId = null;
    } else if (!request.isMaster && sender.tab && sender.tab.id === liepinActiveTabId) {
      chrome.tabs.remove(sender.tab.id).catch(() => {});
      liepinActiveTabId = null;
    }
    sendResponse({ success: true });
    return false;
  }

  // ----------- 51job：真实后台标签页架构 -----------
  if (request.action === '51JOB_OPEN_TAB') {
    job51CallerTabId = sender.tab ? sender.tab.id : null;
    chrome.tabs.create({ url: request.url, active: false }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        console.error("无法创建标签页:", chrome.runtime.lastError);
        sendResponse({ success: false });
        return;
      }
      job51ActiveTabId = tab.id;
      sendResponse({ success: true, tabId: tab.id });
    });
    return true;
  }

  if (request.action === '51JOB_DATA_EXTRACTED') {
    if (job51CallerTabId) {
      chrome.tabs.sendMessage(job51CallerTabId, {
        action: '51JOB_DATA_RETURNED',
        data: request.data
      }).catch(err => console.error("转发数据失败:", err));
    }
    sendResponse({ success: true });
    return false;
  }

  if (request.action === '51JOB_CLOSE_TAB') {
    if (request.isMaster && job51ActiveTabId) {
      chrome.tabs.remove(job51ActiveTabId).catch(() => {});
      job51ActiveTabId = null;
    } else if (!request.isMaster && sender.tab && sender.tab.id === job51ActiveTabId) {
      chrome.tabs.remove(sender.tab.id).catch(() => {});
      job51ActiveTabId = null;
    }
    sendResponse({ success: true });
    return false;
  }

});

/*
// Import normalizer for background auto-sync
try {
  importScripts('libs/job_normalizer.js');
} catch (e) {
  console.error('Failed to load job_normalizer.js', e);
}

// Auto-sync functionality
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    chrome.storage.local.get(['auto_sync_enabled', 'user_job_tags', 'zhilian_enrichment_cache', 'zhilian_scraped_data_v2'], (config) => {
      if (!config.auto_sync_enabled) return;
      
      const context = {
          userJobTags: config.user_job_tags || {},
          zhilianEnrichmentCache: config.zhilian_enrichment_cache || {}
      };
      
      let newJobs = [];
      const keysToCheck = ['boss_scraped_v2', '51job_scraped_v2', 'liepin_scraped_data_v1', 'zhilian_scraped_data_v1', 'zhilian_scraped_data_v2'];
      
      for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
         if (keysToCheck.includes(key)) {
            if (Array.isArray(newValue)) {
                let oldLen = Array.isArray(oldValue) ? oldValue.length : 0;
                if (newValue.length > oldLen) {
                    let source = '';
                    if (key.includes('boss')) source = 'boss';
                    else if (key.includes('51job')) source = '51job';
                    else if (key.includes('liepin')) source = 'liepin';
                    else if (key.includes('zhilian')) source = 'zhilian';
                    
                    for (let i = oldLen; i < newValue.length; i++) {
                        if (typeof normalizeJob === 'function') {
                            let jobToSync = newValue[i];
                            
                            let normalized = normalizeJob(jobToSync, source, context);
                            if (normalized) {
                               newJobs.push(normalized);
                            }
                        }
                    }
                }
            }
         }
      }
      
      if (newJobs.length > 0) {
          fetch('http://localhost:3000/api/jobs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(newJobs)
          }).then(res => res.json())
            .then(data => console.log('Auto sync successful', data))
            .catch(err => console.error('Auto sync failed', err));
      }
    });
  }
});
*/
