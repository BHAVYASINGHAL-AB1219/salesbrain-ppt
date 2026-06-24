const Anthropic = require('@anthropic-ai/sdk');
const { parseLLMResponse } = require('./utils/llmUtils');
const contentAgent = require('./contentAgent');
const designAgent = require('./designAgent');
const validator = require('./validator');
const fs = require('fs');
const path = require('path');

const claude = new Anthropic({
  apiKey: process.env.LITELLM_API_KEY || 'dummy',
  baseURL: process.env.LITELLM_BASE_URL || 'http://localhost:4000'
});

const CONTENT_MODEL = process.env.CONTENT_MODEL || 'kimi-k2p6';

/**
 * Main orchestration function.
 * Uses Claude to plan the deck, then delegates content + design to sub-agents.
 */
async function run(payload, jobId) {
  console.log(`[${jobId}] Orchestrator: planning deck structure...`);

  // ── Phase 1: Claude decides the slide plan ──────────────────────────────────
  let plan;
  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    try {
      console.log(`[${jobId}] Orchestrator: Using model: ${CONTENT_MODEL} for planning`);
      const planResponse = await claude.messages.create({
        model: CONTENT_MODEL,
        max_tokens: 8192,
        system: `You are a sales deck strategist. Given a Sales Brain alignment payload, 
output a JSON slide plan. Return ONLY valid JSON, no markdown fences.

IMPORTANT JSON RULES:
- Escape all double quotes inside string values using \\"
- Do NOT use unescaped newlines (\\n) inside string values. Keep text on a single line.
- Ensure the JSON is strictly valid.

IMPORTANT: Vary your slide types! Don't use the same type repeatedly.
Use section_header slides to break the deck into clear sections.
For company overview decks, use services_grid, client_wall, engagement_models.
For proposal decks, use problem, solution, case_study, data, pricing.

Schema:
{
  "slides": [
    {
      "slide_type": "cover|agenda|problem|solution|case_study|pricing|cta|section_header|services_grid|tech_stack|client_wall|engagement_models|comparison|data|team",
      "purpose": "Why is this slide here?",
      "content_brief": "VERY SHORT bullet points. Max 2 sentences.",
      "has_chart": boolean,
      "visual_tone": "dark|light"
    }
  ],
  "deck_title": "string",
  "theme_choice": "quarks_brand|midnight_executive|teal_trust|coral_energy|charcoal_minimal|ocean_gradient|sage_calm"
}

Rules for slide_type selection:
- cover: Always first. Dark tone.
- agenda: After cover. Shows roadmap / flow.
- section_header: Dark tone. Use to introduce new sections.
- problem: Challenges/pain points. Use split_two_column layout with stat callout.
- solution: Our approach. Use split_two_column layout with stat callout.
- services_grid: Grid of 6-12 services/capabilities with icons.
- tech_stack: Grid of technologies grouped by category.
- comparison: Before/after or two-option comparison.
- engagement_models: Three-column layout (e.g., 3 tiers or models).
- data: Charts with stat callouts.
- case_study: Quote card + 4 result metrics.
- client_wall: Grid of 10-20 client names.
- team: Team members or capabilities grid.
- pricing: Table format.
- cta: Always last. Dark tone. Call to action.`,
        messages: [
          { role: 'user', content: JSON.stringify(payload) }
        ]
      });

      plan = parseLLMResponse(planResponse);
      break; // Success
    } catch (e) {
      console.error(`[${jobId}] Orchestrator plan attempt ${attempts} failed: ${e.message}`);
      if (attempts >= 3) {
        throw new Error(`failed to parse slide plan after 3 attempts — ${e.message}`);
      }
    }
  }

  // Read brand.json for default theme override
  let brandTheme = null;
  try {
    const brandPath = path.join(__dirname, '../templates/brand.json');
    if (fs.existsSync(brandPath)) {
      const brand = JSON.parse(fs.readFileSync(brandPath, 'utf8'));
      brandTheme = brand.default_theme || null;
    }
  } catch (e) { /* ignore */ }

  // Use brand default theme if set, otherwise use what the LLM chose
  const themeToUse = brandTheme || plan.theme_choice || plan.color_theme || 'midnight_executive';
  console.log(`[${jobId}] Orchestrator: planned ${plan.slides.length} slides, theme=${themeToUse}`);

  // ── Phase 2: Parallel Content Generation (Batched) ────────────────────────
  const slides = [];
  const BATCH_SIZE = 3;
  for (let i = 0; i < plan.slides.length; i += BATCH_SIZE) {
    const batch = plan.slides.slice(i, i + BATCH_SIZE);
    const batchJobs = batch.map((slidePlan, idx) => {
      const actualIdx = i + idx;
      return Promise.all([
        contentAgent.generate(slidePlan, payload, actualIdx),
        designAgent.assign(slidePlan, themeToUse, actualIdx, plan.slides.length)
      ]).then(([content, design]) => validator.validate({ ...slidePlan, ...content, ...design, index: actualIdx }));
    });
    const batchResults = await Promise.all(batchJobs);
    slides.push(...batchResults);
  }

  console.log(`[${jobId}] Orchestrator: all slides generated and validated`);

  return {
    deck_title: plan.deck_title || 'Sales Deck',
    color_theme: themeToUse,
    client_name: payload.client?.name || 'Client',
    deck_goal: payload.deck_goal,
    slides
  };
}

module.exports = { run };