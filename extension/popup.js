'use strict';

let settings = { backendUrl: 'http://localhost:8001', tokenBudget: 4000, model: 'gemini-2.5-flash', apiKey: '' };
let currentConvId = '';

// ── DOM helpers ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showState(state) {
  ['stateNotIndexed', 'stateIndexing', 'stateIndexed', 'stateDomFail', 'stateError', 'stateNeedsKey'].forEach(s => {
    $(s).classList.add('hidden');
  });
  $('stateThinking')?.classList.add('hidden');
  $('answerPanel')?.classList.add('hidden');

  const map = {
    not_indexed: 'stateNotIndexed',
    indexing: 'stateIndexing',
    indexed: 'stateIndexed',
    dom_fail: 'stateDomFail',
    error: 'stateError',
    needs_key: 'stateNeedsKey',
  };
  const el = $(map[state]);
  if (el) el.classList.remove('hidden');
}

function setBackend(online) {
  const dot = $('statusDot');
  const txt = $('statusText');
  dot.className = `status-dot ${online ? 'online' : 'offline'}`;
  txt.textContent = online ? 'Backend connected' : `Cannot reach ${settings.backendUrl}`;
}

function send(msg) {
  return new Promise((res, rej) => {
    chrome.runtime.sendMessage(msg, r => {
      if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
      else res(r);
    });
  });
}

function genId() { return 'conv-' + Date.now().toString(36); }

function parsePasted(text) {
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j) && j[0]?.role) return j;
  } catch (_) {}

  const msgs = [];
  let idx = 0, role = null, lines = [];
  for (const line of text.split('\n')) {
    if (/^(Human|User):\s*/i.test(line)) {
      if (role && lines.length) msgs.push({ role, text: lines.join('\n').trim(), index: idx++ });
      role = 'human'; lines = [line.replace(/^(Human|User):\s*/i, '')];
    } else if (/^(Assistant|Claude):\s*/i.test(line)) {
      if (role && lines.length) msgs.push({ role, text: lines.join('\n').trim(), index: idx++ });
      role = 'assistant'; lines = [line.replace(/^(Assistant|Claude):\s*/i, '')];
    } else if (role) {
      lines.push(line);
    }
  }
  if (role && lines.length) msgs.push({ role, text: lines.join('\n').trim(), index: idx++ });
  return msgs;
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const stored = await new Promise(r => chrome.storage.local.get(
      ['backendUrl', 'tokenBudget', 'model', 'conversationId', 'apiKey'], r
    ));
    settings.backendUrl = stored.backendUrl || 'http://localhost:8001';
    settings.tokenBudget = stored.tokenBudget || 4000;
    settings.model = stored.model || 'gemini-2.5-flash';
    settings.apiKey = stored.apiKey || '';
    currentConvId = stored.conversationId || genId();

    // Populate settings panel
    $('backendUrlInput').value = settings.backendUrl;
    $('budgetRange').value = settings.tokenBudget;
    $('budgetDisplay').textContent = settings.tokenBudget;
    $('modelSelect').value = settings.model;
    $('convIdInput').value = currentConvId;
    $('apiKeyInput').value = settings.apiKey;

    // Backend check
    const check = await send({ type: 'CHECK_BACKEND' }).catch(() => ({ success: false }));
    setBackend(check.success);
    if (!check.success) {
      showState('error');
      $('errorMsg').textContent = `Cannot connect to ${settings.backendUrl}. Is the backend running?`;
      return;
    }

    // Check if API key is configured (on backend or locally)
    const settingsRes = await send({ type: 'GET_BACKEND_SETTINGS' }).catch(() => null);
    const hasKeyOnBackend = settingsRes?.has_api_key;
    const hasKeyLocally = !!settings.apiKey.trim();

    if (!hasKeyOnBackend && !hasKeyLocally) {
      showState('needs_key');
      return;
    }

    // If we have a key locally but backend doesn't know about it, sync it
    if (hasKeyLocally && !hasKeyOnBackend) {
      await send({ type: 'SAVE_API_KEY', apiKey: settings.apiKey }).catch(() => {});
    }

    // Load list of existing conversations from backend
    const convListRes = await send({ type: 'LIST_CONVERSATIONS' }).catch(() => null);
    const existingConvs = convListRes?.data || [];
    const selectEl = $('existingConvSelect');
    if (selectEl) {
      selectEl.innerHTML = '<option value="">Switch to indexed conversation...</option>' + 
        existingConvs.map(c => `<option value="${c.conversation_id}">${c.conversation_id} (${c.stats?.total_messages || 0} msgs)</option>`).join('');
      if (existingConvs.some(c => c.conversation_id === currentConvId)) {
        selectEl.value = currentConvId;
      }
    }

    // Get message count from page
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.includes('claude.ai')) {
      chrome.tabs.sendMessage(tab.id, { type: 'GET_LINE_COUNT' }, res => {
        if (res) $('msgCount').textContent = res.count || '--';
      });
    }

    // Check if current conversation is indexed
    const statusRes = await send({ type: 'GET_STATUS', conversationId: currentConvId }).catch(() => null);
    if (statusRes?.success && statusRes.data?.status === 'indexed') {
      showIndexedState(statusRes.data.stats || {});
    } else {
      showState('not_indexed');
    }
  } catch (err) {
    console.error('Init error:', err);
    showState('error');
    $('errorMsg').textContent = err.message || 'Initialization failed';
  }
}

function showIndexedState(stats) {
  $('statMsgs').textContent = `${stats.total_messages ?? '--'} msgs`;
  $('statTopics').textContent = `${stats.total_topics ?? '--'} topics`;
  $('statChunks').textContent = `${stats.total_chunks ?? '--'} chunks`;
  showState('indexed');
}

// ── Switch existing conversation dropdown ─────────────────────────────────────
$('existingConvSelect')?.addEventListener('change', async (e) => {
  const selectedId = e.target.value;
  if (!selectedId) return;
  currentConvId = selectedId;
  $('convIdInput').value = currentConvId;
  await chrome.storage.local.set({ conversationId: currentConvId });
  const statusRes = await send({ type: 'GET_STATUS', conversationId: currentConvId }).catch(() => null);
  if (statusRes?.success && statusRes.data?.status === 'indexed') {
    showIndexedState(statusRes.data.stats || {});
  }
});

// ── Open visual tree in Web App ───────────────────────────────────────────────
$('openTreeInWebBtn')?.addEventListener('click', () => {
  chrome.tabs.create({ url: `http://localhost:3000/tree/${encodeURIComponent(currentConvId)}` });
});

// ── Clipboard copy helper with fallback ─────────────────────────────────────
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
  return Promise.resolve();
}

// ── Copy Context Capsule for ChatGPT / Gemini ────────────────────────────────
$('copyContextCapsuleBtn')?.addEventListener('click', async () => {
  const btn = $('copyContextCapsuleBtn');
  const oldText = btn.textContent;
  btn.textContent = 'Exporting...';

  const exportRes = await send({ type: 'EXPORT_CONTEXT', conversationId: currentConvId }).catch(e => ({ success: false, error: e.message }));
  
  if (exportRes?.success && exportRes.data?.markdown) {
    await copyToClipboard(exportRes.data.markdown);
    btn.textContent = '✓ Copied Capsule!';
    btn.style.color = '#10B981';
    btn.style.borderColor = '#10B981';

    if (window.confirm('🧠 ConvoMemory Capsule copied to clipboard!\n\nWould you like to open ChatGPT in a new tab now to paste it?')) {
      chrome.tabs.create({ url: 'https://chatgpt.com' });
    }

    setTimeout(() => {
      btn.textContent = oldText;
      btn.style.color = '#8B5CF6';
      btn.style.borderColor = '#8B5CF6';
    }, 3000);
  } else {
    btn.textContent = oldText;
    const err = exportRes?.error || 'Conversation is not indexed yet. Please index it first.';
    alert(`Could not export: ${err}`);
  }
});

// ── Index button ─────────────────────────────────────────────────────────────
$('indexBtn').addEventListener('click', async () => {
  currentConvId = $('convIdInput').value.trim() || genId();
  await chrome.storage.local.set({ conversationId: currentConvId });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab?.id, { type: 'EXTRACT_MESSAGES' }, async res => {
    if (!res?.success) { showState('dom_fail'); return; }
    startIndexing(res.messages);
  });
});

async function startIndexing(messages) {
  showState('indexing');
  $('indexProgress').textContent = 'Building RAPTOR tree (~60s)...';

  const result = await send({
    type: 'INDEX_CONVERSATION',
    conversationId: currentConvId,
    messages,
  }).catch(e => ({ success: false, error: e.message }));

  if (result?.success) {
    showIndexedState(result.stats || {});
  } else {
    showState('error');
    $('errorMsg').textContent = result?.error || 'Indexing failed';
  }
}

$('pasteIndexBtn').addEventListener('click', async () => {
  const text = $('pasteArea').value.trim();
  const msgs = parsePasted(text);
  if (!msgs.length) { alert('Could not parse. Use format:\nHuman: ...\nAssistant: ...'); return; }
  currentConvId = $('convIdInput').value.trim() || genId();
  await chrome.storage.local.set({ conversationId: currentConvId });
  startIndexing(msgs);
});

// ── Ask button ────────────────────────────────────────────────────────────────
$('askBtn').addEventListener('click', async () => {
  const query = $('queryInput').value.trim();
  if (!query) return;

  $('answerPanel').classList.add('hidden');
  $('stateThinking').classList.remove('hidden');

  const res = await send({
    type: 'QUERY',
    conversationId: currentConvId,
    query,
    tokenBudget: settings.tokenBudget,
    model: settings.model,
  }).catch(e => ({ success: false, error: e.message }));

  $('stateThinking').classList.add('hidden');

  if (res?.success && res.data) {
    displayAnswer(res.data);
  } else {
    $('answerPanel').classList.remove('hidden');
    $('answerText').textContent = res?.error || 'AI service unavailable. Try again.';
  }
});

function displayAnswer(data) {
  $('answerPanel').classList.remove('hidden');
  $('answerText').textContent = data.answer || '--';

  const tc = data.token_counts || {};
  const used = tc.context_tokens || 0;
  const budget = tc.token_budget || 4000;
  const pct = Math.min(100, Math.round(used / budget * 100));

  $('tokenFill').style.width = pct + '%';
  $('tokenUsed').textContent = used.toLocaleString();
  $('tokenBudgetEl').textContent = budget.toLocaleString();
  $('reductionText').textContent = ` · ${tc.reduction_pct || 0}% less than raw`;

  if (data.nodes_used) {
    const list = $('sourcesList');
    list.innerHTML = data.nodes_used.map(n => `
      <div class="source-item ${n.level.toLowerCase()}">
        <span class="source-level">${n.level}</span>
        <span class="source-sim">${(n.similarity * 100).toFixed(0)}%</span>
        <span class="source-tokens">${n.token_count}t</span>
        ${n.topic_label ? `<span class="source-label">${n.topic_label}</span>` : ''}
      </div>`).join('');
  }
}

$('sourcesToggle').addEventListener('click', () => {
  const list = $('sourcesList');
  list.classList.toggle('hidden');
  $('sourcesToggle').textContent = list.classList.contains('hidden') ? 'Show sources' : 'Hide sources';
});

// ── Settings panel ────────────────────────────────────────────────────────────
$('settingsToggle').addEventListener('click', () => $('settingsPanel').classList.toggle('hidden'));
$('budgetRange').addEventListener('input', e => $('budgetDisplay').textContent = e.target.value);
$('closeSettingsBtn').addEventListener('click', () => $('settingsPanel').classList.add('hidden'));

// Toggle API key visibility
$('toggleApiKeyVisibility').addEventListener('click', () => {
  const input = $('apiKeyInput');
  input.type = input.type === 'password' ? 'text' : 'password';
});

// Open settings from needs_key state
$('openSettingsBtn').addEventListener('click', () => {
  $('settingsPanel').classList.remove('hidden');
});

$('saveSettingsBtn').addEventListener('click', async () => {
  const apiKey = $('apiKeyInput').value.trim();
  settings.backendUrl = $('backendUrlInput').value.trim() || 'http://localhost:8001';
  settings.tokenBudget = +$('budgetRange').value;
  settings.model = $('modelSelect').value;
  settings.apiKey = apiKey;

  // Save to chrome.storage
  await chrome.storage.local.set({
    backendUrl: settings.backendUrl,
    tokenBudget: settings.tokenBudget,
    model: settings.model,
    apiKey: settings.apiKey,
  });

  // Forward settings to background
  await send({ type: 'UPDATE_SETTINGS', ...settings });

  // Save API key to backend
  if (apiKey) {
    const result = await send({ type: 'SAVE_API_KEY', apiKey }).catch(e => ({ success: false, error: e.message }));
    if (!result?.success) {
      $('saveFeedback').textContent = 'Error saving API key: ' + (result?.error || 'unknown');
      $('saveFeedback').classList.remove('hidden');
      $('saveFeedback').style.color = '#EF4444';
      setTimeout(() => $('saveFeedback').classList.add('hidden'), 4000);
      return;
    }
  }

  // Show success feedback
  $('saveFeedback').textContent = 'Settings saved!';
  $('saveFeedback').style.color = '#10B981';
  $('saveFeedback').classList.remove('hidden');
  setTimeout(() => {
    $('saveFeedback').classList.add('hidden');
    $('settingsPanel').classList.add('hidden');
  }, 1500);

  setBackend(true);

  // Re-initialize to pick up new state
  init();
});

$('retryBtn').addEventListener('click', () => init());

// Progress updates
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'INDEX_PROGRESS' && $('indexProgress')) {
    $('indexProgress').textContent = msg.progress || 'Processing...';
  }
});

init();
