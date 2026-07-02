/**
 * tokenTracker.js — Centralised LLM token usage tracker
 *
 * Tracks input/output tokens for every LLM call across the pipeline, grouped
 * by phase (planning, content_generation, content_review, visual_review,
 * extraction, regeneration).  At the end of a build the caller can call
 * `getSummary()` to get a human-readable breakdown and `reset()` to clear
 * the counters for the next job.
 *
 * The Anthropic SDK (and LiteLLM proxy) returns `response.usage` with
 * `input_tokens` and `output_tokens`.  Some proxies may also return
 * `cache_read_input_tokens` / `cache_creation_input_tokens` — we include
 * those in the input total when present.
 */

// ─── Price table (USD per 1M tokens) ─────────────────────────────────────────
// Update these when models or pricing change.  $0 means free or unknown.
const PRICE_TABLE = {
  'glm-5p2':              { input: 1.40, output: 4.40, cachedInput: 0.14 },
  'accounts/fireworks/models/glm-5p2': { input: 1.40, output: 4.40, cachedInput: 0.14 },
  'gpt-5':                { input: 1.25, output: 10.00, cachedInput: 0.125 },
  'gpt-4o':               { input: 2.50, output: 10.00, cachedInput: 0.25 },
  'gpt-4o-mini':          { input: 0.15, output: 0.60, cachedInput: 0.015 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00, cachedInput: 0.30 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00, cachedInput: 0.30 },
  'kimi-k2p6':            { input: 0.60, output: 2.50, cachedInput: 0.06 },
};

/**
 * Compute the dollar cost for a single call.
 * @param {string} model
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {number} cost in USD
 */
function computeCost(model, inputTokens, outputTokens, cacheReadTokens = 0, cacheCreateTokens = 0) {
  const price = PRICE_TABLE[model] || PRICE_TABLE[model.split('/').pop()] || { input: 0, output: 0, cachedInput: 0 };
  const regularInputCost = (inputTokens / 1_000_000 * price.input);
  const cachedInputCost = (cacheReadTokens / 1_000_000 * (price.cachedInput || 0));
  const cacheCreateCost = (cacheCreateTokens / 1_000_000 * price.input);
  const outputCost = (outputTokens / 1_000_000 * price.output);
  return regularInputCost + cachedInputCost + cacheCreateCost + outputCost;
}

// ─── Internal state ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} PhaseTotals
 * @property {number} calls        - Number of LLM calls in this phase
 * @property {number} inputTokens  - Total input (prompt) tokens
 * @property {number} outputTokens - Total output (completion) tokens
 */

/** @type {Object<string, PhaseTotals>} */
let _phases = {};

/** @type {Array<Object>} */
let _callLog = [];

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Record a single LLM call's token usage.
 *
 * @param {string} phase - Logical phase: 'planning' | 'content_generation' |
 *                                   'content_review' | 'visual_review' |
 *                                   'extraction' | 'regeneration'
 * @param {string} model - The model name used (e.g. 'kimi-k2p6')
 * @param {Object} usage - The `response.usage` object from the Anthropic SDK
 *                         (must contain at least `input_tokens` and `output_tokens`)
 * @param {string} [label] - Optional human-readable label (e.g. "slide 3")
 */
/**
 * Extract the caller's file:line from the current call stack.
 * Skips frames inside tokenTracker.js itself to find the real caller.
 * @returns {string} e.g. "contentAgent.js:180"
 */
function getCallerLocation() {
  const stack = new Error().stack;
  if (!stack) return 'unknown';
  const lines = stack.split('\n');
  for (const line of lines) {
    // Match lines like "    at contentAgent.generate (/path/to/contentAgent.js:180:25)"
    const match = line.match(/\s+at\s+.+\((.+):(\d+):\d+\)/);
    if (match) {
      const filePath = match[1];
      const lineNum = match[2];
      // Skip frames inside tokenTracker.js itself
      if (filePath.includes('tokenTracker')) continue;
      // Extract just the filename (not full path) for readability
      const fileName = filePath.split('/').pop();
      return `${fileName}:${lineNum}`;
    }
  }
  return 'unknown';
}

function record(phase, model, usage, label) {
  if (!usage) return;

  // Log the raw usage object so you can see cache_read, cache_creation, etc.
  const caller = getCallerLocation();
  console.log(`[tokenTracker] ${phase} | ${label || 'n/a'} | ${caller} | raw usage: ${JSON.stringify(usage)}`);

  const regularInputTokens = usage.input_tokens || 0;
  const cacheReadTokens = usage.cache_read_input_tokens || 0;
  const cacheCreateTokens = usage.cache_creation_input_tokens || 0;
  const inputTokens = regularInputTokens + cacheReadTokens + cacheCreateTokens;
  const outputTokens = usage.output_tokens || 0;

  if (!_phases[phase]) {
    _phases[phase] = { calls: 0, inputTokens: 0, outputTokens: 0 };
  }
  _phases[phase].calls += 1;
  _phases[phase].inputTokens += inputTokens;
  _phases[phase].outputTokens += outputTokens;

  const cost = computeCost(model, regularInputTokens, outputTokens, cacheReadTokens, cacheCreateTokens);

  _callLog.push({
    phase,
    model,
    label: label || '',
    caller,
    inputTokens,
    outputTokens,
    total: inputTokens + outputTokens,
    cost,
    // Store the raw usage breakdown for inspection
    rawUsage: {
      input_tokens: usage.input_tokens || 0,
      cache_read_input_tokens: usage.cache_read_input_tokens || 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get the current totals grouped by phase.
 *
 * @returns {Object<string, PhaseTotals>}
 */
function getPhases() {
  return { ..._phases };
}

/**
 * Get the current totals grouped by model.
 * Aggregates across all phases so you can see which model consumed what.
 *
 * @returns {Object<string, PhaseTotals>}
 */
function getModels() {
  const models = {};
  for (const call of _callLog) {
    const m = call.model || 'unknown';
    if (!models[m]) {
      models[m] = { calls: 0, inputTokens: 0, outputTokens: 0 };
    }
    models[m].calls += 1;
    models[m].inputTokens += call.inputTokens;
    models[m].outputTokens += call.outputTokens;
  }
  return models;
}

/**
 * Get the detailed per-call log.
 *
 * @returns {Array<Object>}
 */
function getCallLog() {
  return [..._callLog];
}

/**
 * Compute grand totals across all phases.
 *
 * @returns {{calls: number, inputTokens: number, outputTokens: number, total: number}}
 */
function getTotals() {
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const phase of Object.keys(_phases)) {
    calls += _phases[phase].calls;
    inputTokens += _phases[phase].inputTokens;
    outputTokens += _phases[phase].outputTokens;
  }
  return { calls, inputTokens, outputTokens, total: inputTokens + outputTokens };
}

/**
 * Generate a human-readable summary string suitable for console logging.
 * Includes a per-phase breakdown and a per-model breakdown.
 *
 * @param {string} [jobId] - Optional job ID prefix
 * @returns {string} Multi-line summary
 */
function getSummary(jobId) {
  const prefix = jobId ? `[${jobId}] ` : '';
  const totals = getTotals();
  const lines = [];

  lines.push(`${prefix}═══════════════════════════════════════════════════════════════`);
  lines.push(`${prefix}  📊 TOKEN USAGE SUMMARY`);
  lines.push(`${prefix}═══════════════════════════════════════════════════════════════`);
  lines.push(`${prefix}`);
  lines.push(`${prefix}  ── By Phase ──────────────────────────────────────────────────`);
  lines.push(`${prefix}  Phase                          Calls   Input      Output     Total`);
  lines.push(`${prefix}  ─────────────────────────────────────────────────────────────`);

  // Define display order
  const phaseOrder = [
    'planning',
    'content_generation',
    'regeneration',
    'content_review',
    'visual_review',
    'extraction',
  ];

  // Show known phases first, then any unknown ones
  const allPhases = [...phaseOrder, ...Object.keys(_phases).filter(p => !phaseOrder.includes(p))];

  for (const phase of allPhases) {
    const p = _phases[phase];
    if (!p) continue;
    const name = phase.padEnd(30);
    const calls = String(p.calls).padStart(5);
    const input = String(p.inputTokens).padStart(9);
    const output = String(p.outputTokens).padStart(9);
    const total = String(p.inputTokens + p.outputTokens).padStart(9);
    lines.push(`${prefix}  ${name}  ${calls}   ${input}    ${output}   ${total}`);
  }

  lines.push(`${prefix}  ─────────────────────────────────────────────────────────────`);
  const tCalls = String(totals.calls).padStart(5);
  const tInput = String(totals.inputTokens).padStart(9);
  const tOutput = String(totals.outputTokens).padStart(9);
  const tTotal = String(totals.total).padStart(9);
  lines.push(`${prefix}  ${'TOTAL'.padEnd(30)}  ${tCalls}   ${tInput}    ${tOutput}   ${tTotal}`);

  // ── Per-model breakdown ──────────────────────────────────────────────────
  const models = getModels();
  lines.push(`${prefix}`);
  lines.push(`${prefix}  ── By Model ──────────────────────────────────────────────────`);
  lines.push(`${prefix}  Model                          Calls   Input      Output     Total`);
  lines.push(`${prefix}  ─────────────────────────────────────────────────────────────`);

  for (const model of Object.keys(models).sort()) {
    const m = models[model];
    const name = model.padEnd(30);
    const calls = String(m.calls).padStart(5);
    const input = String(m.inputTokens).padStart(9);
    const output = String(m.outputTokens).padStart(9);
    const total = String(m.inputTokens + m.outputTokens).padStart(9);
    lines.push(`${prefix}  ${name}  ${calls}   ${input}    ${output}   ${total}`);
  }

  lines.push(`${prefix}  ─────────────────────────────────────────────────────────────`);
  lines.push(`${prefix}  ${'TOTAL'.padEnd(30)}  ${tCalls}   ${tInput}    ${tOutput}   ${tTotal}`);
  lines.push(`${prefix}═══════════════════════════════════════════════════════════════`);

  return lines.join('\n');
}

/**
 * Generate a detailed per-call breakdown showing every individual LLM call
 * with its function, model, tokens, and cost.
 *
 * @param {string} [jobId] - Optional job ID prefix
 * @returns {string} Multi-line detailed summary
 */
function getDetailedSummary(jobId) {
  const prefix = jobId ? `[${jobId}] ` : '';
  const lines = [];

  lines.push(`${prefix}═══════════════════════════════════════════════════════════════════════════`);
  lines.push(`${prefix}  📊 DETAILED TOKEN USAGE — EVERY LLM CALL (with source location)`);
  lines.push(`${prefix}═══════════════════════════════════════════════════════════════════════════`);
  lines.push(`${prefix}`);
  lines.push(`${prefix}  #   Function (Phase)             Caller (file:line)         Model                    Label              Input    Output   Total      Cost`);
  lines.push(`${prefix}  ──  ───────────────────────────  ─────────────────────────  ───────────────────────  ─────────────────  ───────  ───────  ───────  ──────────`);

  let totalCost = 0;

  for (let i = 0; i < _callLog.length; i++) {
    const c = _callLog[i];
    const num = String(i + 1).padStart(3);
    const phase = c.phase.padEnd(28);
    const caller = (c.caller || 'unknown').padEnd(26);
    const model = (c.model || 'unknown').padEnd(24);
    const label = (c.label || '').padEnd(16);
    const input = String(c.inputTokens).padStart(6);
    const output = String(c.outputTokens).padStart(6);
    const total = String(c.total).padStart(6);
    const cost = `$${c.cost.toFixed(4)}`.padStart(8);
    lines.push(`${prefix}  ${num}  ${phase}  ${caller}  ${model}  ${label}  ${input}    ${output}    ${total}    ${cost}`);
    totalCost += c.cost;
  }

  lines.push(`${prefix}  ──  ───────────────────────────  ─────────────────────────  ───────────────────────  ─────────────────  ───────  ───────  ───────  ──────────`);

  const totals = getTotals();
  const tInput = String(totals.inputTokens).padStart(6);
  const tOutput = String(totals.outputTokens).padStart(6);
  const tTotal = String(totals.total).padStart(6);
  const tCost = `$${totalCost.toFixed(4)}`.padStart(8);
  lines.push(`${prefix}  ${'   '.padStart(3)}  ${'TOTAL'.padEnd(28)}  ${''.padEnd(30)}  ${''.padEnd(16)}  ${tInput}    ${tOutput}    ${tTotal}    ${tCost}`);

  lines.push(`${prefix}═══════════════════════════════════════════════════════════════════════`);

  // ── Raw usage breakdown (cache stats) ─────────────────────────────────────
  lines.push(`${prefix}`);
  lines.push(`${prefix}  ── Raw Usage Breakdown (cache detection) ──────────────────────────────`);
  lines.push(`${prefix}  #   Function (Phase)             Input   CacheRead  CacheCreate  Output`);
  lines.push(`${prefix}  ──  ───────────────────────────  ──────  ─────────  ───────────  ──────`);

  for (let i = 0; i < _callLog.length; i++) {
    const c = _callLog[i];
    const r = c.rawUsage || {};
    const num = String(i + 1).padStart(3);
    const phase = c.phase.padEnd(28);
    const input = String(r.input_tokens || 0).padStart(6);
    const cacheRead = String(r.cache_read_input_tokens || 0).padStart(8);
    const cacheCreate = String(r.cache_creation_input_tokens || 0).padStart(10);
    const output = String(r.output_tokens || 0).padStart(6);
    lines.push(`${prefix}  ${num}  ${phase}  ${input}   ${cacheRead}    ${cacheCreate}   ${output}`);
  }

  // Totals for raw usage
  let totalRawInput = 0, totalCacheRead = 0, totalCacheCreate = 0, totalRawOutput = 0;
  for (const c of _callLog) {
    const r = c.rawUsage || {};
    totalRawInput += r.input_tokens || 0;
    totalCacheRead += r.cache_read_input_tokens || 0;
    totalCacheCreate += r.cache_creation_input_tokens || 0;
    totalRawOutput += r.output_tokens || 0;
  }
  lines.push(`${prefix}  ──  ───────────────────────────  ──────  ─────────  ───────────  ──────`);
  lines.push(`${prefix}  ${'   '.padStart(3)}  ${'TOTAL'.padEnd(28)}  ${String(totalRawInput).padStart(6)}   ${String(totalCacheRead).padStart(8)}    ${String(totalCacheCreate).padStart(10)}   ${String(totalRawOutput).padStart(6)}`);

  if (totalCacheRead > 0 || totalCacheCreate > 0) {
    // Calculate savings from caching (cache read tokens charged at 10% of input rate)
    let cacheSavings = 0;
    for (const c of _callLog) {
      const r = c.rawUsage || {};
      const cacheRead = r.cache_read_input_tokens || 0;
      if (cacheRead > 0) {
        const price = PRICE_TABLE[c.model] || PRICE_TABLE[(c.model || '').split('/').pop()] || { input: 0, cachedInput: 0 };
        cacheSavings += (cacheRead / 1_000_000) * (price.input - (price.cachedInput || 0));
      }
    }
    lines.push(`${prefix}  ✅ Prompt caching is ACTIVE — cache_read=${totalCacheRead}, cache_create=${totalCacheCreate}`);
    lines.push(`${prefix}  💰 Cache savings: $${cacheSavings.toFixed(4)} (cached tokens charged at 10% of input rate)`);
  } else {
    lines.push(`${prefix}  ⚠️  No prompt caching detected — all input tokens charged at full rate`);
  }
  lines.push(`${prefix}═══════════════════════════════════════════════════════════════════════`);

  // ── Per-function (phase) cost breakdown ──────────────────────────────────
  lines.push(`${prefix}`);
  lines.push(`${prefix}  ── Per-Function Cost Breakdown ──────────────────────────────────────`);
  lines.push(`${prefix}  Function (Phase)               Calls   Input      Output     Total       Cost`);
  lines.push(`${prefix}  ────────────────────────────────────────────────────────────────────────`);

  const phaseOrder = [
    'extraction',
    'planning',
    'content_generation',
    'regeneration',
    'content_review',
    'visual_review',
  ];
  const allPhases = [...phaseOrder, ...Object.keys(_phases).filter(p => !phaseOrder.includes(p))];

  for (const phase of allPhases) {
    const p = _phases[phase];
    if (!p) continue;
    const phaseCost = _callLog
      .filter(c => c.phase === phase)
      .reduce((sum, c) => sum + c.cost, 0);
    const name = phase.padEnd(30);
    const calls = String(p.calls).padStart(5);
    const input = String(p.inputTokens).padStart(9);
    const output = String(p.outputTokens).padStart(9);
    const total = String(p.inputTokens + p.outputTokens).padStart(9);
    const cost = `$${phaseCost.toFixed(4)}`.padStart(8);
    lines.push(`${prefix}  ${name}  ${calls}   ${input}    ${output}   ${total}    ${cost}`);
  }

  lines.push(`${prefix}  ────────────────────────────────────────────────────────────────────────`);
  const tCalls = String(totals.calls).padStart(5);
  const tInput2 = String(totals.inputTokens).padStart(9);
  const tOutput2 = String(totals.outputTokens).padStart(9);
  const tTotal2 = String(totals.total).padStart(9);
  const tCost2 = `$${totalCost.toFixed(4)}`.padStart(8);
  lines.push(`${prefix}  ${'TOTAL'.padEnd(30)}  ${tCalls}   ${tInput2}    ${tOutput2}   ${tTotal2}    ${tCost2}`);
  lines.push(`${prefix}═══════════════════════════════════════════════════════════════════════`);

  return lines.join('\n');
}

/**
 * Reset all counters.  Call this at the start of a new build job.
 */
function reset() {
  _phases = {};
  _callLog = [];
}

module.exports = {
  record,
  getPhases,
  getModels,
  getCallLog,
  getTotals,
  getSummary,
  getDetailedSummary,
  computeCost,
  reset,
};
