import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startDashboard } from '../dist/dashboard/server.js';
import { remoteEndpoint } from '../dist/dashboard/profiles.js';
import { runAgent } from '../dist/dashboard/agent.js';
import { unpack } from '../dist/mcp/client.js';

async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'retryproof-ui-'));
  const server = await startDashboard({ dataDir: dir, port: 0, ...options });
  t.after(async () => { await server.close(); rmSync(dir, { recursive: true, force: true }); });
  const bootstrap = await fetch(`${server.url}/api/session`);
  const cookie = bootstrap.headers.get('set-cookie').split(';')[0], info = await bootstrap.json();
  async function request(path, body, extras = {}) {
    const r = await fetch(`${server.url}${path}`, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-RP-CSRF': info.csrf }), ...extras } });
    return { status: r.status, data: await r.json() };
  }
  return { server, dir, cookie, csrf: info.csrf, request };
}
const task = { request_id: 'ui-task', title: 'Test dashboard handoff', body: '' };

test('dashboard serves the uploaded theme and connects real sandbox API routes', async t => {
  const f = await fixture(t);
  const html = await fetch(f.server.url); assert.match(await html.text(), /Connection setup/);
  assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const connected = await f.request('/api/connect', { mode: 'sandbox' }); assert.equal(connected.data.connected, true);
  assert.equal((await f.request('/api/start', task)).data.status, 'completed');
  const records = (await f.request('/api/records')).data;
  assert.equal(records.source, 'sandbox-ledger'); assert.equal(records.issues.length, 1); assert.equal(records.tracking.length, 1);
  assert.equal((await f.request('/api/resume', { request_id: task.request_id })).data.status, 'completed');
  assert.equal((await f.request('/api/records')).data.tracking.length, 1);
});
test('dashboard credentials/CSRF session are required and cross-origin calls are blocked', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.server.url}/api/connect`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: '{"mode":"sandbox"}' })).status, 401);
  assert.equal((await f.request('/api/connect', { mode: 'sandbox' }, { 'X-RP-CSRF':'wrong' })).status, 403);
  assert.equal((await f.request('/api/connect', { mode: 'sandbox' }, { Origin:'https://attacker.invalid' })).status, 403);
  assert.equal((await f.request('/api/connect', { mode:'sandbox', unexpected:'injected' })).status, 400);
});
test('browser sessions do not inherit another browser session connection or keys', async t => {
  const f = await fixture(t); await f.request('/api/connect', { mode:'sandbox' });
  const second = await fetch(`${f.server.url}/api/session`), data = await second.json();
  assert.equal(data.connection.connected, false);
});
test('sandbox hidden-read injection routes to real MCP state and recovery clears it', async t => {
  const f = await fixture(t); await f.request('/api/connect', { mode:'sandbox' });
  await f.request('/api/fault', { fault:'hidden_read' });
  assert.equal((await f.request('/api/start', task)).data.status, 'paused');
  assert.equal((await f.request('/api/records')).data.issues.length, 1);
  await f.request('/api/fault', { fault:'none' });
  assert.equal((await f.request('/api/resume', { request_id:task.request_id })).data.status, 'completed');
});
test('MCP client setup exports a real token-protected endpoint without returning its token', async t => {
  const f = await fixture(t), token = 'private-test-client-token-over-32-characters';
  const connected = await f.request('/api/connect', { mode:'client', clientToken:token });
  assert.equal(connected.data.clientEnabled, true);
  const exported = (await f.request('/api/client-config')).data;
  assert.equal(JSON.stringify(exported).includes(token), false);
  const unauthorized = await fetch(exported.endpoint, { method:'POST',headers:{'Content-Type':'application/json'},body:'{}' });
  assert.equal(unauthorized.status, 401);
  const client = new Client({ name:'external-client-test',version:'0.1.0' }); t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(exported.endpoint), { requestInit:{headers:{Authorization:`Bearer ${token}`}} }));
  assert.equal((await client.listTools()).tools.length, 4);
  assert.equal(unpack(await client.callTool({name:'rp_start_workflow',arguments:task})).status,'completed');
});
test('remote setup forwards a workflow to an actual second RetryProof MCP endpoint', async t => {
  const origin = await fixture(t), remote = await fixture(t), token='remote-test-bearer-token-over-thirty-two-characters';
  await origin.request('/api/connect',{mode:'client',clientToken:token});
  const endpoint=(await origin.request('/api/client-config')).data.endpoint;
  const connected=await remote.request('/api/connect',{mode:'remote',remoteUrl:endpoint,remoteToken:token});
  assert.equal(connected.status,200);assert.equal(connected.data.backend,'remote');
  assert.equal((await remote.request('/api/start',task)).data.status,'completed');
  assert.equal((await remote.request('/api/records')).data.source,'verified-receipt');
  assert.equal((await remote.request('/api/fault',{fault:'none'})).status,409);
});
test('remote policy rejects unapproved origins, embedded credentials and non-HTTPS internet targets', () => {
  assert.throws(()=>remoteEndpoint('http://169.254.169.254/latest/meta-data',[]),/not allowed/);
  assert.throws(()=>remoteEndpoint('https://example.com/mcp',[]),/not allowed/);
  assert.throws(()=>remoteEndpoint('https://user:password@example.com/mcp',['https://example.com']),/embedded/);
  assert.equal(remoteEndpoint('https://example.com/mcp',['https://example.com']).origin,'https://example.com');
});
test('GitHub settings validate read access without returning credentials or creating an issue', async t => {
  const calls=[],token='github-test-token-private',secret='stable-test-marker-secret-more-than-32-characters';
  const f=await fixture(t,{fetcher:async(url,init)=>{calls.push({url,init});return Response.json({id:123});}});
  const result=await f.request('/api/connect',{mode:'github',githubOwner:'owner',githubRepo:'repo',githubToken:token,markerSecret:secret});
  assert.equal(result.status,200);assert.equal(result.data.target,'github:owner/repo');assert.equal(calls.length,2);
  assert.ok(calls.every(c=>!c.init.method || c.init.method==='GET'));
  for(const path of ['/api/session','/api/capabilities','/api/records']) {
    const data=JSON.stringify((await f.request(path)).data);assert.ok(!data.includes(token)&&!data.includes(secret));
  }
  function files(dir){return readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?files(p):[p];});}
  for(const path of files(f.dir)) {const text=readFileSync(path).toString();assert.ok(!text.includes(token)&&!text.includes(secret),path);}
});
test('agent settings perform an actual bounded function-call request and execute the permitted MCP action', async t => {
  let modelCalls=0;
  const key='private-llm-api-key-for-test';
  const f=await fixture(t,{fetcher:async(url,init)=>{
    modelCalls++;assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(init.headers.Authorization,`Bearer ${key}`);
    const body=JSON.parse(init.body),task=JSON.parse(body.messages[1].content);
    return Response.json({choices:[{message:{tool_calls:[{type:'function',function:{name:body.tool_choice.function.name,arguments:JSON.stringify(task.arguments)}}]}}]});
  }});
  const configured=await f.request('/api/connect',{mode:'agent',provider:'groq',model:'model-from-account',apiKey:key});
  assert.equal(configured.status,200);assert.equal(modelCalls,0);assert.equal(JSON.stringify(configured.data).includes(key),false);
  const result=await f.request('/api/agent',{action:'start',task});
  assert.equal(result.status,200);assert.equal(result.data.receipt.status,'completed');assert.equal(modelCalls,1);
  assert.equal((await f.request('/api/records')).data.issues.length,1);
});
test('agent rejects changed task identity and multiple calls before any MCP mutation', async () => {
  let mutations=0;
  const gateway={client:{listTools:async()=>({tools:[{name:'rp_start_workflow',inputSchema:{type:'object'}}]})},call:async()=>{mutations++;}};
  const config={provider:'openai',model:'test',apiKey:'never-return-this-key'};
  const bad=async()=>Response.json({choices:[{message:{tool_calls:[{type:'function',function:{name:'rp_start_workflow',arguments:JSON.stringify({...task,request_id:'different-task'})}}]}}]});
  await assert.rejects(runAgent(gateway,config,task,'start',bad),/changed/);assert.equal(mutations,0);
  const multiple=async()=>Response.json({choices:[{message:{tool_calls:[]}}]});
  await assert.rejects(runAgent(gateway,config,task,'start',multiple),/single permitted/);assert.equal(mutations,0);
});
test('disconnect releases the profile while reconnecting the same workspace preserves the ledger', async t => {
  const f=await fixture(t);await f.request('/api/connect',{mode:'sandbox'});await f.request('/api/start',task);
  await f.request('/api/disconnect',{});assert.equal((await f.request('/api/records')).status,409);
  await f.request('/api/connect',{mode:'sandbox'});
  assert.equal((await f.request('/api/resume',{request_id:task.request_id})).data.status,'completed');
  assert.equal((await f.request('/api/records')).data.issues.length,1);
});
test('failed replacement configuration preserves the previous active connection', async t => {
  const f=await fixture(t);await f.request('/api/connect',{mode:'sandbox'});
  assert.equal((await f.request('/api/connect',{mode:'client',clientToken:'short'})).status,400);
  assert.equal((await f.request('/api/session')).data.connection.mode,'sandbox');
  assert.equal((await f.request('/api/start',task)).data.status,'completed');
});
test('a second operation cannot change connections while a provider check is pending', async t => {
  let unblock,entered;const started=new Promise(r=>{entered=r;});const gate=new Promise(r=>{unblock=r;});
  const f=await fixture(t,{fetcher:async()=>{entered();await gate;return Response.json({id:123});}});
  const pending=f.request('/api/connect',{mode:'github',githubOwner:'owner',githubRepo:'repo',githubToken:'test',markerSecret:'a'.repeat(32)});
  await started;
  assert.equal((await f.request('/api/connect',{mode:'sandbox'})).status,409);
  unblock();assert.equal((await pending).status,200);
});
