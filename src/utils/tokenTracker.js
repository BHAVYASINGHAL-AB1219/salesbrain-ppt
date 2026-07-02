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
function record(phase, model, usage, label) {
  if (!usage) return;

  const inputTokens =
    (usage.input_tokens || 0) +
    (usage.cache_read_input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0);
  const outputTokens = usage.output_tokens || 0;

  if (!_phases[phase]) {
    _phases[phase] = { calls: 0, inputTokens: 0, outputTokens: 0 };
  }
  _phases[phase].calls += 1;
  _phases[phase].inputTokens += inputTokens;
  _phases[phase].outputTokens += outputTokens;

  _callLog.push({
    phase,
    model,
    label: label || '',
    inputTokens,
    outputTokens,
    total: inputTokens + outputTokens,
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
  reset,
};
