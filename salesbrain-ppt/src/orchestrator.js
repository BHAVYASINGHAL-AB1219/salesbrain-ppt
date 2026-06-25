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
        system: `You are a sales deck strategist. Given a Sales Brain alignment payload, output a JSON slide plan. Return ONLY valid JSON, no markdown fences.

IMPORTANT JSON RULES:
- Escape all double quotes inside string values using \\"
- Do NOT use unescaped newlines (\\n) inside string values. Keep text on a single line.
- Ensure the JSON is strictly valid.

## SLIDE VARIETY RULES
- Never use the same slide_type twice in a row.
- Never use more than 2 slides of the same type in the entire deck.
- Always use at least 2 section_header slides to break the deck into sections.
- Deck length by goal: proposal=10-12 slides, pitch=8-10, overview=12-14, report=8-10, onboarding=6-8.
- For overview decks use: services_grid, client_wall, engagement_models, tech_stack.
- For proposal decks use: problem, solution, case_study, data, pricing.

## THEME SELECTION — follow this decision tree in order, stop at first match

STEP 1 — Match by client.industry:
- Tech, SaaS, Software, AI, Finance, Banking, Consulting → "golden_navy"
- Healthcare, Hospital, EdTech, Education, HR, Sustainability → "teal_trust"
- Retail, eCommerce, D2C, Marketing, Media, Entertainment → "coral_energy"
- Legal, Manufacturing, Logistics, Supply Chain, Architecture → "charcoal_minimal"
- Insurance, Telecom, Government, Automotive, Infrastructure → "ocean_gradient"
- Wellness, NGO, Agriculture, Real Estate, Social Impact → "sage_calm"

STEP 2 — If no industry match, use deck_goal:
- proposal, executive_review → "golden_navy"
- pitch, product_launch, brand_story → "coral_energy"
- onboarding, partnership, awareness → "teal_trust"
- case_study, report, internal_review → "charcoal_minimal"
- compliance, annual_report → "ocean_gradient"
- community, impact_report → "sage_calm"

STEP 3 — If still no match, scan client.pain_points for keywords:
- scale, global, enterprise, revenue, ROI, efficiency → "golden_navy"
- trust, safety, care, people, wellbeing, access → "teal_trust"
- growth, brand, customers, engagement, visibility → "coral_energy"
- compliance, risk, process, operations, cost → "charcoal_minimal"
- Fallback if nothing matches → "golden_navy"

OUTPUT RULE: theme_choice MUST be one of these exact strings only:
"golden_navy" | "teal_trust" | "coral_energy" | "charcoal_minimal" | "ocean_gradient" | "sage_calm"
Never output any other value. Never invent a theme name.

## VISUAL TONE RULES
- cover → always "dark"
- cta → always "dark"
- section_header → always "dark"
- problem, solution, comparison → "light"
- services_grid, tech_stack, engagement_models → "light"
- data, case_study → "light"
- client_wall → "light"
- agenda, team, pricing → "light"

## SLIDE TYPE SCHEMA
- cover: Always first.
- agenda: Second slide. Shows roadmap of sections.
- section_header: Introduces a new section. Use 2-3 times per deck.
- problem: Client pain points. Requires stat_callout in content_brief.
- solution: Your approach to the problem. Requires stat_callout.
- services_grid: 6-12 items. List them explicitly in content_brief.
- tech_stack: Group technologies by category in content_brief.
- comparison: Two columns. Label both sides explicitly in content_brief.
- engagement_models: Exactly 3 models/tiers. Name all three in content_brief.
- data: Requires has_chart: true and at least one stat in content_brief.
- case_study: Requires client name, outcome metric, and a quote in content_brief.
- client_wall: List 10-15 client names in content_brief.
- team: List team members or capability areas in content_brief.
- pricing: List tiers and key differentiators in content_brief.
- cta: Always last. One clear action.

Schema:
{
  "slides": [
    {
      "slide_type": "cover|agenda|problem|solution|case_study|pricing|cta|section_header|services_grid|tech_stack|client_wall|engagement_models|comparison|data|team",
      "purpose": "One sentence: why is this slide in the deck?",
      "content_brief": "VERY SHORT. Max 2 sentences. Include any required fields per slide type rules above.",
      "has_chart": boolean,
      "visual_tone": "dark|light"
    }
  ],
  "deck_title": "string",
  "theme_choice": "golden_navy|teal_trust|coral_energy|charcoal_minimal|ocean_gradient|sage_calm"
}`,

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