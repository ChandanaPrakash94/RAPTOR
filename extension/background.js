// ConvoMemory background service worker
'use strict';

const DEFAULT_BACKEND = 'http://localhost:8001';

async function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

async function setStorage(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

async function fetchRetry(url, opts = {}, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(30000) });
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

async function pollStatus(backendUrl, convId, maxAttempts = 90) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await fetchRetry(`${backendUrl}/api/status/${convId}`);
      const data = await res.json();
      chrome.runtime.sendMessage({
        type: 'INDEX_PROGRESS',
        conversationId: convId,
        progress: data.progress || 'Processing...',
        status: data.status,
        stats: data.stats || {},
      }).catch(() => {});
      if (data.status !== 'indexing') return data;
    } catch (e) {
      // continue polling
    }
  }
  return { status: 'timeout' };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
  return true;
});

async function handleMessage(msg, sender) {
  const s = await getStorage(['backendUrl', 'tokenBudget', 'model']);
  const backendUrl = s.backendUrl || DEFAULT_BACKEND;

  switch (msg.type) {
    case 'CHECK_BACKEND': {
      try {
        const res = await fetch(`${backendUrl}/api/health`, { signal: AbortSignal.timeout(4000) });
        const data = await res.json();
        return { success: true, status: data.status, raptor_ready: data.raptor_ready };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    case 'GET_BACKEND_SETTINGS': {
      try {
        const res = await fetch(`${backendUrl}/api/settings`, { signal: AbortSignal.timeout(4000) });
        const data = await res.json();
        return data;
      } catch (e) {
        return { has_api_key: false, error: e.message };
      }
    }

    case 'SAVE_API_KEY': {
      try {
        const res = await fetch(`${backendUrl}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: msg.apiKey }),
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();
        return { success: data.status === 'ok' };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    case 'INDEX_CONVERSATION': {
      const { conversationId, messages } = msg;
      await setStorage({ indexStatus: 'indexing', conversationId });
      try {
        const res = await fetchRetry(`${backendUrl}/api/index`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversation_id: conversationId, messages }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: 'Server error' }));
          return { success: false, error: err.detail || 'Index request failed' };
        }

        const finalStatus = await pollStatus(backendUrl, conversationId);
        await setStorage({ indexStatus: finalStatus.status });

        if (finalStatus.status === 'indexed' && sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, { type: 'INDEX_COMPLETE' }).catch(() => {});
        }
        return { success: finalStatus.status === 'indexed', status: finalStatus.status, stats: finalStatus.stats };
      } catch (e) {
        await setStorage({ indexStatus: 'error' });
        return { success: false, error: e.message };
      }
    }

    case 'QUERY': {
      const { conversationId, query, tokenBudget, model } = msg;
      try {
        const res = await fetchRetry(`${backendUrl}/api/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: conversationId,
            query,
            token_budget: tokenBudget || 4000,
            model: model || 'gemini-2.0-flash',
          }),
        });
        const data = await res.json();
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    case 'GET_STATUS': {
      try {
        const res = await fetchRetry(`${backendUrl}/api/status/${msg.conversationId}`);
        const data = await res.json();
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    case 'LIST_CONVERSATIONS': {
      try {
        const res = await fetchRetry(`${backendUrl}/api/conversations`);
        const data = await res.json();
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    case 'EXPORT_CONTEXT': {
      try {
        const res = await fetchRetry(`${backendUrl}/api/export/${encodeURIComponent(msg.conversationId)}`);
        const data = await res.json();
        if (!res.ok) {
          return { success: false, error: data.detail || 'Conversation not indexed yet' };
        }
        return { success: true, data };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    case 'UPDATE_SETTINGS': {
      await setStorage({ backendUrl: msg.backendUrl, tokenBudget: msg.tokenBudget, model: msg.model });
      return { success: true };
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}
