// The dashboard never simulates success. All records and statuses come from the backend.
const el = id => document.getElementById(id);
const state = { csrf: '', connection: { connected: false }, busy: false, dirty: false, config: null };
const descriptions = {
  sandbox: 'Run the real local MCP workflow against two persistent sandbox services. No keys needed.',
  github: 'Create real GitHub issues and link them to your local tracking board. Connect only checks access; Start performs the write.',
  client: 'Connect a local provider, then use the generated MCP URL in NitroStudio or another client on this computer.',
  remote: 'Forward dashboard actions to an existing RetryProof MCP server. Its bearer token stays on this backend.',
  agent: 'Give a tool-capable model one exact task. The model chooses the MCP call; RetryProof determines the result.'
};
function logEvent(message) {
  const pre = el('event-log');
  const lines = pre.textContent === 'Waiting for action...' ? [] : pre.textContent.split('\n');
  lines.push(`[${new Date().toLocaleTimeString()}] ${message}`);
  pre.textContent = lines.slice(-200).join('\n'); pre.scrollTop = pre.scrollHeight;
}
function status(value, hint = '') {
  const allowed = ['idle','completed','paused','in_flight','error'];
  const safe = allowed.includes(value) ? value : 'paused';
  el('status-badge').textContent = safe.toUpperCase(); el('status-badge').className = `badge-${safe}`;
  el('status-hint').textContent = hint;
}
function steps(intent, issue, verify, tracking) {
  [intent,issue,verify,tracking].forEach((v,i) => { el(['step-intent-status','step-issue-status','step-verify-status','step-track-status'][i]).textContent = v; });
}
function buttons() {
  const ready = state.connection.connected && !state.dirty;
  for (const id of ['btn-start','btn-resume','btn-receipt','btn-refresh','btn-discover','btn-reset']) el(id).disabled = state.busy || !ready;
  for (const id of ['btn-agent-start','btn-agent-resume']) { el(id).hidden = !state.connection.agentEnabled; el(id).disabled = state.busy || !ready; }
  el('btn-connect').disabled = state.busy || !state.csrf;
  el('btn-disconnect').disabled = state.busy || !state.connection.connected;
  el('fault').disabled = state.busy || !ready || !state.connection.faultsEnabled;
  for (const input of el('workflow-form').querySelectorAll('input,textarea')) input.disabled = state.busy;
  for (const input of el('setup-form').querySelectorAll('input,select')) if (state.busy) input.disabled = true;
  if (!state.busy) updateFields();
}
function updateFields() {
  const mode = el('usage-mode').value;
  const localBackend = ['client','agent'].includes(mode);
  const github = mode === 'github' || (localBackend && el('local-backend').value === 'github');
  el('mode-description').textContent = descriptions[mode];
  for (const [panel,visible] of [['github-fields',github],['remote-fields',mode === 'remote'],['client-fields',mode === 'client'],['agent-fields',mode === 'agent'],['backend-fields',localBackend],['workspace-field',mode !== 'remote']]) {
    el(panel).hidden = !visible;
    for (const field of el(panel).querySelectorAll('input,select')) field.disabled = !visible;
  }
  for (const id of ['github-owner','github-repo','github-token','marker-secret']) el(id).required = github;
  for (const id of ['llm-key','llm-model']) el(id).required = mode === 'agent';
  el('remote-url').required = mode === 'remote'; el('client-token').required = mode === 'client';
  el('usage-mode').disabled = false;
}
async function api(path, body) {
  const options = { credentials: 'same-origin', headers: {} };
  if (body !== undefined) Object.assign(options, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RP-CSRF': state.csrf }, body: JSON.stringify(body) });
  let response;
  try { response = await fetch(path, options); }
  catch { throw new Error('Backend unavailable. Keep the same request ID; reconnect and inspect its receipt before retrying.'); }
  const result = await response.json().catch(() => { throw new Error('The backend returned an invalid response.'); });
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}
async function action(callback) {
  if (state.busy) return;
  state.busy = true; buttons();
  try { await callback(); }
  catch (error) { logEvent(error.message); status('error', error.message); el('setup-message').textContent = error.message; }
  finally { state.busy = false; buttons(); }
}
function setupPayload() {
  const mode = el('usage-mode').value;
  const payload = { mode, workspace: el('workspace').value.trim(), backend: el('local-backend').value };
  const github = mode === 'github' || (['client','agent'].includes(mode) && payload.backend === 'github');
  if (github) Object.assign(payload, { githubOwner: el('github-owner').value.trim(), githubRepo: el('github-repo').value.trim(), githubToken: el('github-token').value, markerSecret: el('marker-secret').value });
  if (mode === 'remote') Object.assign(payload, { remoteUrl: el('remote-url').value.trim(), remoteToken: el('remote-token').value });
  if (mode === 'client') payload.clientToken = el('client-token').value;
  if (mode === 'agent') Object.assign(payload, { provider: el('llm-provider').value, model: el('llm-model').value.trim(), apiKey: el('llm-key').value });
  return payload;
}
function connectionDisplay() {
  const c = state.connection;
  el('connection-badge').textContent = c.connected ? `${c.mode.toUpperCase()} CONNECTED` : 'Not connected';
  el('connection-badge').classList.toggle('connected', !!c.connected);
  el('fault-group').hidden = !c.faultsEnabled;
  if (!c.faultsEnabled) el('fault').value = 'none';
  el('client-output').hidden = !c.clientEnabled;
}
function renderRows(tableId, records, columns) {
  const tbody = el(tableId).querySelector('tbody'); tbody.replaceChildren();
  if (!records.length) {
    const td = document.createElement('td'); td.colSpan = columns.length || 3; td.textContent = 'No observed records yet';
    const tr = document.createElement('tr'); tr.append(td); tbody.append(tr); return;
  }
  for (const record of records) {
    const tr = document.createElement('tr');
    for (const column of columns) { const td = document.createElement('td'); td.textContent = String(record[column] ?? '-'); tr.append(td); }
    tbody.append(tr);
  }
}
async function refresh() {
  const result = await api('/api/records');
  renderRows('table-issues', result.issues, ['id','title','marker']);
  renderRows('table-trackers', result.tracking, ['id','title','sourceId']);
  const sandbox = result.source === 'sandbox-ledger';
  el('issues-heading').textContent = sandbox ? 'Authoritative sandbox issue records' : 'Issue evidence from the last receipt';
  el('tracking-heading').textContent = sandbox ? 'Authoritative sandbox tracking records' : 'Tracking evidence from the last receipt';
  el('records-source').textContent = sandbox ? 'Read directly from the two persistent sandbox services.' : 'Historical observations in the loaded receipt. This is not a live list of all remote records.';
}
function renderReceipt(receipt) {
  el('receipt-json').textContent = JSON.stringify(receipt, null, 2);
  status(receipt.status, receipt.status === 'completed' ? 'Both operations were verified.' : 'Incomplete. Inspect evidence, then recover using the same request ID.');
  const issue = receipt.operations?.find(op => op.kind === 'issue');
  const tracking = receipt.operations?.find(op => op.kind === 'tracking');
  steps(receipt.operations?.length ? 'Persisted' : 'Waiting', issue?.state || 'Waiting', issue?.evidence ? 'Verified' : 'Not verified', tracking?.state || 'Waiting');
  for (const event of receipt.events?.slice(-8) ?? []) logEvent(`${event.operationKey}: ${event.state} — ${event.reason}`);
}
function task() {
  if (!el('workflow-form').reportValidity()) return null;
  return { request_id: el('request-id').value.trim(), title: el('title').value.trim(), body: el('body').value };
}
async function configure(event) {
  event.preventDefault(); if (!el('setup-form').reportValidity()) return;
  const payload = setupPayload();
  await action(async () => {
    el('setup-message').textContent = 'Connecting to the backend and checking MCP capabilities…';
    state.connection = await api('/api/connect', payload); state.dirty = false;
    for (const id of ['github-token','marker-secret','remote-token','client-token','llm-key']) el(id).value = '';
    connectionDisplay(); status('idle', 'Connected. Ready for a task.'); steps('Waiting','Waiting','Waiting','Waiting');
    el('receipt-json').textContent = '// Run or load a task to inspect its receipt.';
    el('setup-message').textContent = `Connected: ${state.connection.target}. Credentials are held in this backend session.`;
    logEvent(`Connected ${state.connection.mode}; no workflow action was sent during setup.`);
    if (state.connection.clientEnabled) {
      const config = await api('/api/client-config'); state.config = config.configuration;
      el('client-json').textContent = JSON.stringify(config.configuration, null, 2);
      el('client-instructions').textContent = config.instructions;
    }
    await refresh();
  });
}
async function run(actionName, useAgent = false) {
  const input = actionName === 'start' || useAgent ? task() : { request_id: el('request-id').value.trim() };
  if (!input || !/^[A-Za-z0-9_-]{1,80}$/.test(input.request_id)) return;
  await action(async () => {
    status('in_flight', useAgent ? 'Calling your model provider, then the permitted MCP tool…' : 'Waiting for the real MCP result…');
    if (state.connection.faultsEnabled) await api('/api/fault', { fault: el('fault').value });
    const result = await api(useAgent ? '/api/agent' : `/api/${actionName}`, useAgent ? { action: actionName, task: input } : input);
    if (useAgent) logEvent(`${result.provider} / ${result.model} selected ${result.tool}.`);
    renderReceipt(useAgent ? result.receipt : result); await refresh();
  });
}
el('setup-form').addEventListener('submit', configure);
el('setup-form').addEventListener('input', () => { if (state.connection.connected) { state.dirty = true; el('setup-message').textContent = 'Settings changed. Connect to apply them before running a task.'; } buttons(); });
el('usage-mode').addEventListener('change', updateFields); el('local-backend').addEventListener('change', updateFields);
el('workflow-form').addEventListener('submit', event => { event.preventDefault(); if (!el('btn-start').disabled) void run('start'); });
el('btn-start').addEventListener('click', () => void run('start'));
el('btn-resume').addEventListener('click', () => void run('resume'));
el('btn-agent-start').addEventListener('click', () => void run('start', true));
el('btn-agent-resume').addEventListener('click', () => void run('resume', true));
el('btn-receipt').addEventListener('click', () => void action(async () => { renderReceipt(await api(`/api/receipt?request_id=${encodeURIComponent(el('request-id').value.trim())}`)); await refresh(); }));
el('btn-refresh').addEventListener('click', () => void action(refresh));
el('btn-discover').addEventListener('click', () => void action(async () => { el('capabilities-json').textContent = JSON.stringify(await api('/api/capabilities'), null, 2); el('capabilities-output').hidden = false; el('capabilities-output').open = true; }));
el('btn-disconnect').addEventListener('click', () => void action(async () => { await api('/api/disconnect', {}); state.connection = { connected: false }; state.config = null; state.dirty = false; connectionDisplay(); status('idle', 'Disconnected. Re-enter credentials to reconnect.'); steps('Waiting','Waiting','Waiting','Waiting'); el('receipt-json').textContent = '// Disconnected. Reconnect and load a task to view its saved receipt.'; el('records-source').textContent = 'Connect to load records from the backend.'; el('setup-message').textContent = 'Disconnected. Backend connections and session credentials were released.'; renderRows('table-issues', [], []); renderRows('table-trackers', [], []); }));
el('btn-reset').addEventListener('click', () => { el('request-id').value = `task-${crypto.randomUUID().slice(0, 12)}`; status('idle', 'New intentional task. Previous task identities are still saved.'); steps('Waiting','Waiting','Waiting','Waiting'); });
el('btn-copy-config').addEventListener('click', () => void action(async () => { await navigator.clipboard.writeText(JSON.stringify(state.config, null, 2)); el('setup-message').textContent = 'Configuration copied. Replace the token placeholder using your client credential settings.'; }));
async function initialize() {
  updateFields(); buttons();
  if (location.protocol === 'file:') { el('setup-message').textContent = 'Run npm run dashboard, then open the printed HTTP URL. Opening this HTML directly cannot connect to the backend.'; return; }
  try {
    const session = await api('/api/session'); state.csrf = session.csrf; state.connection = session.connection;
    if (state.connection.connected) {
      el('usage-mode').value = state.connection.mode;
      el('local-backend').value = state.connection.backend === 'github' ? 'github' : 'sandbox';
      if (state.connection.workspace) el('workspace').value = state.connection.workspace;
      if (state.connection.provider) el('llm-provider').value = state.connection.provider;
      if (state.connection.model) el('llm-model').value = state.connection.model;
      if (state.connection.target?.startsWith('github:')) {
        const [owner,repo] = state.connection.target.slice(7).split('/');
        el('github-owner').value = owner; el('github-repo').value = repo;
      }
    }
    connectionDisplay(); buttons();
    if (state.connection.connected) {
      await refresh();
      if (state.connection.clientEnabled) {
        const config = await api('/api/client-config'); state.config = config.configuration;
        el('client-json').textContent = JSON.stringify(config.configuration, null, 2);
        el('client-instructions').textContent = config.instructions;
      }
    }
    logEvent('Backend session ready. No browser simulation is enabled.');
  } catch (error) { el('setup-message').textContent = error.message; status('error', error.message); }
}
void initialize();
