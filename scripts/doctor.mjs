#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const API_BASE = process.env.BATTA_API_BASE || 'http://localhost:3101/api';
const UI_URL = process.env.BATTA_UI_URL || 'http://localhost:3100';
const MCP_TEMPLATE = `${API_BASE}/mcp?repo=<repo-name>`;
const LLM_PROVIDER = process.env.LLM_PROVIDER || (process.env.AZURE_OPENAI_ENDPOINT ? 'azure-openai' : undefined);
const EMBEDDINGS_PROVIDER = process.env.EMBEDDINGS_PROVIDER || (process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT ? 'azure-openai' : undefined);

const results = [];
let failed = false;

function pass(label, detail) {
  results.push({ status: 'pass', label, detail });
}

function warn(label, detail) {
  results.push({ status: 'warn', label, detail });
}

function fail(label, detail) {
  failed = true;
  results.push({ status: 'fail', label, detail });
}

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return result.status === 0;
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= 18) pass('Node.js', process.version);
else fail('Node.js', `Expected >=18, found ${process.version}`);

if (commandExists('pnpm')) pass('pnpm', 'available');
else warn('pnpm', 'Not found on PATH');

if (commandExists('docker')) pass('Docker CLI', 'available');
else warn('Docker CLI', 'Not found on PATH');

try {
  const health = await fetchJson(`${API_BASE}/health`);
  if (health?.status === 'ok') pass('API health', `${API_BASE}/health`);
  else fail('API health', 'Unexpected health response');
} catch (error) {
  fail('API health', `Unreachable at ${API_BASE}/health (${error.message})`);
}

try {
  const capabilities = await fetchJson(`${API_BASE}/capabilities`);
  const reviewLoop = capabilities.capabilities?.find(capability => capability.id === 'securityReviewLoop');
  if (reviewLoop?.available) pass('securityReviewLoop capability', 'available');
  else fail('securityReviewLoop capability', reviewLoop?.reasons?.join('. ') || 'missing');

  if (capabilities.process?.llm) pass('LLM provider', LLM_PROVIDER ? `configured (${LLM_PROVIDER})` : 'configured');
  else warn('LLM provider', LLM_PROVIDER ? `Not available (${LLM_PROVIDER})` : 'Not configured. Local indexing and security reviews still work.');

  if (capabilities.process?.embeddings) pass('Embeddings', EMBEDDINGS_PROVIDER ? `configured (${EMBEDDINGS_PROVIDER})` : 'configured');
  else warn('Embeddings', EMBEDDINGS_PROVIDER ? `Disabled or not available (${EMBEDDINGS_PROVIDER})` : 'Disabled or not configured. Structured local flows still work.');
} catch (error) {
  fail('Capabilities endpoint', `Unreachable at ${API_BASE}/capabilities (${error.message})`);
}

try {
  const response = await fetch(UI_URL, { signal: AbortSignal.timeout(3000) });
  if (response.ok) pass('UI', UI_URL);
  else warn('UI', `Reachable but returned HTTP ${response.status}`);
} catch (error) {
  warn('UI', `Unreachable at ${UI_URL} (${error.message})`);
}

console.log('\nbatta-ai doctor\n');
for (const result of results) {
  const icon = result.status === 'pass' ? 'OK ' : result.status === 'warn' ? 'WARN' : 'FAIL';
  console.log(`${icon} ${result.label}${result.detail ? ` - ${result.detail}` : ''}`);
}

console.log(`\nMCP endpoint template:\n  ${MCP_TEMPLATE}\n`);

if (failed) {
  console.log('Critical checks failed. Start the local stack, then retry `pnpm doctor`.');
  process.exit(1);
}

console.log('Critical checks passed.');
