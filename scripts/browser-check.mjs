import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboard } from '../dist/dashboard/server.js';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { throw new Error('Optional browser QA needs Playwright and its Chromium binary. See docs/UI_SETUP.md.'); }
const dir = mkdtempSync(join(tmpdir(), 'retryproof-browser-'));
const checks = [], errors = [];
let modelRequests = 0;
const dashboard = await startDashboard({ dataDir:join(dir,'main'), port:0, fetcher:async(url,init)=>{
  if (url.startsWith('https://api.github.com/')) return Response.json({id:123});
  modelRequests++;
  const data=JSON.parse(init.body), task=JSON.parse(data.messages[1].content);
  return Response.json({choices:[{message:{tool_calls:[{type:'function',function:{name:data.tool_choice.function.name,arguments:JSON.stringify(task.arguments)}}]}}]});
}});
const remote = await startDashboard({ dataDir:join(dir,'remote'), port:0 });
let browser, passed = false;
try {
  browser=await chromium.launch({headless:true,channel:'chromium',args:['--no-sandbox'],
    ...(process.env.RP_BROWSER_EXECUTABLE ? {executablePath:process.env.RP_BROWSER_EXECUTABLE} : {})});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(dashboard.url);await page.waitForFunction(()=>!document.getElementById('btn-connect').disabled);
  await page.click('#btn-connect');await page.waitForFunction(()=>document.getElementById('connection-badge').textContent==='SANDBOX CONNECTED');
  await page.click('#btn-start');await page.waitForFunction(()=>document.getElementById('status-badge').textContent==='COMPLETED');
  assert.equal(await page.locator('#table-issues tbody tr').count(),1);
  checks.push('Browser sandbox form executes a real MCP handoff');

  await page.click('#btn-reset');await page.selectOption('#fault','hidden_read');await page.click('#btn-start');
  await page.waitForFunction(()=>document.getElementById('status-badge').textContent==='PAUSED');
  await page.selectOption('#fault','none');await page.click('#btn-resume');
  await page.waitForFunction(()=>document.getElementById('status-badge').textContent==='COMPLETED');
  assert.equal(await page.locator('#table-issues tbody tr').count(),2);checks.push('Hidden read pauses and browser recovery reuses the original issue');

  const clientToken='browser-client-bearer-token-at-least-32-characters';
  await page.selectOption('#usage-mode','client');assert.equal(await page.locator('#btn-start').isDisabled(),true);
  await page.fill('#client-token',clientToken);await page.click('#btn-connect');
  await page.waitForFunction(()=>document.getElementById('connection-badge').textContent==='CLIENT CONNECTED');
  await page.waitForFunction(()=>document.getElementById('client-json').textContent.includes('mcpServers'));
  assert.equal(await page.inputValue('#client-token'),'');assert.ok(!(await page.textContent('#client-json')).includes(clientToken));
  await page.reload();await page.waitForFunction(()=>document.getElementById('connection-badge').textContent==='CLIENT CONNECTED');
  assert.equal(await page.inputValue('#usage-mode'),'client');checks.push('Client setup returns configuration, clears the secret and restores the correct mode on reload');

  await page.selectOption('#usage-mode','agent');await page.selectOption('#llm-provider','groq');
  await page.fill('#llm-model','controlled-tool-model');await page.fill('#llm-key','browser-test-key-not-a-live-secret');
  await page.click('#btn-connect');await page.waitForFunction(()=>document.getElementById('connection-badge').textContent==='AGENT CONNECTED');
  assert.equal(await page.inputValue('#llm-key'),'');await page.click('#btn-reset');await page.click('#btn-agent-start');
  await page.waitForFunction(()=>document.getElementById('status-badge').textContent==='COMPLETED');
  assert.equal(modelRequests,1);checks.push('Agent form calls the controlled provider once and executes the returned MCP action');

  await page.selectOption('#usage-mode','github');await page.fill('#github-owner','owner');await page.fill('#github-repo','repo');
  await page.fill('#github-token','browser-github-test-token');await page.fill('#marker-secret','browser-stable-marker-secret-more-than-32-characters');
  await page.click('#btn-connect');await page.waitForFunction(()=>document.getElementById('connection-badge').textContent==='GITHUB CONNECTED');
  assert.equal(await page.inputValue('#github-token'),'');assert.equal(await page.locator('#fault-group').isVisible(),false);
  checks.push('GitHub setup validates read access using controlled responses and disables sandbox faults');

  const bootstrap=await fetch(`${remote.url}/api/session`), info=await bootstrap.json();
  const cookie=bootstrap.headers.get('set-cookie').split(';')[0], token='browser-remote-token-at-least-32-characters';
  await fetch(`${remote.url}/api/connect`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-RP-CSRF':info.csrf},body:JSON.stringify({mode:'client',clientToken:token})});
  const config=await(await fetch(`${remote.url}/api/client-config`,{headers:{Cookie:cookie}})).json();
  await page.selectOption('#usage-mode','remote');await page.fill('#remote-url',config.endpoint);await page.fill('#remote-token',token);
  await page.click('#btn-connect');await page.waitForFunction(()=>document.getElementById('connection-badge').textContent==='REMOTE CONNECTED');
  await page.fill('#request-id','remote-browser-task');await page.click('#btn-start');
  await page.waitForFunction(()=>document.getElementById('status-badge').textContent==='COMPLETED');
  assert.match(await page.textContent('#records-source'),/Historical observations/);checks.push('Remote UI forwards to a second real MCP endpoint and labels historical evidence correctly');

  await page.click('#btn-disconnect');await page.waitForFunction(()=>document.getElementById('connection-badge').textContent==='Not connected');
  assert.equal(await page.locator('#btn-start').isDisabled(),true);
  const storage=await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}));
  assert.deepEqual(storage,{local:[],session:[]});checks.push('Disconnect disables actions; no keys or settings were written to browser storage');

  await page.setViewportSize({width:390,height:844});
  const mobile=await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth);
  assert.ok(mobile);checks.push('390px mobile layout has no horizontal page overflow');
  if(process.env.RP_UI_SCREENSHOT) {await page.setViewportSize({width:1280,height:900});await page.screenshot({path:process.env.RP_UI_SCREENSHOT,fullPage:true});}
  assert.deepEqual(errors,[]);
  passed = true;
} finally {
  await browser?.close();await Promise.allSettled([dashboard.close(),remote.close()]);rmSync(dir,{recursive:true,force:true});
  mkdirSync('evidence',{recursive:true});writeFileSync('evidence/browser-check.json',JSON.stringify({generated_at:new Date().toISOString(),passed,
    checks,errors,scope:'Chromium browser against the real local backend/MCP services. GitHub read checks and model responses are controlled fixtures; no paid model call or GitHub write.'},null,2)+'\n');
}
console.log(`${checks.length} browser scenarios passed.`);
