/**
 * AI 流式客户端 (AI Streaming Client)
 * 支持与 background.js 建立长期 Port 连接实现 SSE 打字机效果，并支持常规 Message 自动降级
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AiStreamClient = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * 发起流式 AI 调用
     * @param {Object} params
     * @param {string} params.action - 'streamScoreJob' | 'streamGenerateIntro' | 'streamAnswerQuestion'
     * @param {string} params.url - API Base URL
     * @param {string} params.key - API Key
     * @param {string} params.model - Model Name
     * @param {Function} [params.onChunk] - (textDelta, accumulatedText) => void
     * @returns {Promise<Object>}
     */
    function requestStream(params) {
        const { action, onChunk, ...payload } = params;

        return new Promise((resolve, reject) => {
            let port = null;
            let isResolved = false;

            try {
                port = chrome.runtime.connect({ name: 'ai-stream' });
            } catch (err) {
                console.warn('[AiStreamClient] 无法连接到流式端口，降级至普通请求:', err);
                return fallbackNonStreaming(params).then(resolve).catch(reject);
            }

            if (!port) {
                return fallbackNonStreaming(params).then(resolve).catch(reject);
            }

            port.onMessage.addListener((msg) => {
                if (msg.type === 'chunk') {
                    if (typeof onChunk === 'function') {
                        onChunk(msg.text, msg.fullText);
                    }
                } else if (msg.type === 'done') {
                    isResolved = true;
                    port.disconnect();
                    resolve({
                        success: true,
                        score: msg.score,
                        matchLevel: msg.matchLevel,
                        resultText: msg.resultText
                    });
                } else if (msg.type === 'error') {
                    isResolved = true;
                    port.disconnect();
                    reject(new Error(msg.error || '流式传输报错'));
                }
            });

            port.onDisconnect.addListener(() => {
                if (!isResolved) {
                    const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : '连接已中断';
                    reject(new Error(err));
                }
            });

            port.postMessage({
                action,
                ...payload
            });
        });
    }

    // 降级使用普通 chrome.runtime.sendMessage
    function fallbackNonStreaming(params) {
        const actionMap = {
            'streamScoreJob': 'aiScoreJob',
            'streamGenerateIntro': 'aiGenerateIntro',
            'streamAnswerQuestion': 'aiAnswerQuestion'
        };

        const targetAction = actionMap[params.action] || params.action;
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                action: targetAction,
                ...params
            }, (res) => {
                if (chrome.runtime.lastError) {
                    return reject(new Error(chrome.runtime.lastError.message));
                }
                if (!res || !res.success) {
                    return reject(new Error(res ? res.error : '请求失败'));
                }
                if (typeof params.onChunk === 'function' && res.resultText) {
                    params.onChunk(res.resultText, res.resultText);
                }
                resolve(res);
            });
        });
    }

    return {
        requestStream
    };
});
