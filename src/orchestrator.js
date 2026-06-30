const Anthropic = require('@anthropic-ai/sdk');
const { parseLLMResponse } = require('./utils/llmUtils');
const tokenTracker = require('./utils/tokenTracker');
const contentAgent = require('./contentAgent');
const designAgent = require('./designAgent');
const validator = require('./validator');
const fs = require('fs');
const path = require('path');
const { matchCapabilities } = require('./capabilities')

const claude = new Anthropic({
  apiKey: process.env.LITELLM_API_KEY || 'dummy',
  baseURL: process.env.LITELLM_BASE_URL || 'http://localhost:4000'
});

const CONTENT_MODEL = process.env.CONTENT_MODEL || 'kimi-k2p6';

/**
 * Builds narrative context for a single slide so the content agent can write
 * story-driven content that flows naturally between slides.
 *
 * @param {object} plan - The full deck plan from the LLM
 * @param {number} slideIndex - Index of the slide to build context for
 * @returns {object} Narrative context for the content agent
 */
function buildNarrativeContext(plan, slideIndex) {
  const slides = plan.slides;
  const current = slides[slideIndex];
  const prev = slideIndex > 0 ? slides[slideIndex - 1] : null;
  const next = slideIndex < slides.length - 1 ? slides[slideIndex + 1] : null;

  return {
    deck_thesis: plan.deck_thesis || '',
    narrative_summary: plan.narrative_summary || '',
    current_stage: current?.narrative_stage || '',
    current_purpose: current?.purpose || '',
    transition_hint: current?.transition_hint || '',
    prev_purpose: prev?.purpose || null,
    prev_type: prev?.slide_type || null,
    next_purpose: next?.purpose || null,
    next_type: next?.slide_type || null,
    slide_position: `${slideIndex + 1} of ${slides.length}`,
  };
}

/**
 * Main orchestration function.
 * Uses Claude to plan the deck, then delegates content + design to sub-agents.
 */
async function run(payload, jobId) {
  console.log(`[${jobId}] Orchestrator: planning deck structure...`);
  tokenTracker.reset();
  const matchedCapabilities = matchCapabilities(payload, 6);

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
        system: `You are a master sales deck strategist and storyteller. Given a Sales Brain alignment payload, you design a deck that reads as a single, compelling narrative — not a disconnected sequence of slides.

IMPORTANT JSON RULES:
- MUST wrap the JSON in \`\`\`json and \`\`\` fences.
- CRITICAL: DO NOT output any chain of thought, reasoning, or explanation. Start your response IMMEDIATELY with \`\`\`json.
- Escape all double quotes inside string values using \\"
- Do NOT use unescaped newlines (\\n) inside string values. Keep text on a single line.
- Ensure the JSON is strictly valid.

## THE SALES STORY ARC — mandatory for ALL deck goals

Every deck follows this 7-stage narrative arc. The arc is universal — it works for
discovery calls, follow-ups, proposals, and demos. The deck_goal only changes the
EMPHASIS and slide count per stage, not the arc itself.

Think of the deck as a story with a hero (the client), a villain (their pain),
a guide (us), and a happy ending (the outcome).

### STAGE 1 — THE HOOK (Opening) — always 2 slides
The deck opens by making the client the hero of their own story.
- cover        → 1 slide, dark. Title is about the CLIENT's aspiration, not our company.
                 Example: "Transforming [Client]'s [process] for [outcome]"
- agenda       → 1 slide, light. A roadmap framed as a journey, not a table of contents.
                 Use action verbs: "Where you are → What's holding you back → How we help → Proof → Next steps"

### STAGE 2 — THEIR WORLD (Context) — 1-2 slides
Show you understand their world before you talk about yours. Empathy first.
- section_header → 1 dark slide opening this section. Title must be client-specific:
  "Why [industry] Teams Like [client] Struggle With [pain_point]"
- problem      → 1 slide. Frame pain points as the villain. Use the client's own language.
  Requires stat_callout with a real number from the payload.
- data         → ADD 1 slide ONLY IF alignment_score < 70 (pain needs more evidence)
  OR payload has chart_data. has_chart: true.

### STAGE 3 — THE TURNING POINT (Insight) — 1-2 slides
This is the "aha" moment — the insight that reframes their problem.
- section_header → 1 dark slide. Title: "A New Way Forward for [client]"
- solution     → 1 slide. Our approach as the guide's wisdom. Requires stat_callout.
  Frame as "Here's the shift that changes everything for [client]"

### STAGE 4 — THE GUIDE'S TOOLKIT (Capabilities) — 1-3 slides
Now we show what we bring. This is where we earn the right to be trusted.
- services_grid → 1 slide. ONLY use the MATCHED CAPABILITIES provided. Max 6.
  Format: "Capability Title: one-line client benefit [signal]"
- comparison   → ADD 1 slide ONLY IF recommended_angle mentions "vs", "replace",
  "switch", "migration", "currently using", "alternative"
- tech_stack   → ADD 1 slide ONLY IF our_company.products has 4+ technology items

### STAGE 5 — THE PROOF (Evidence) — 1-2 slides
Stories need proof. Show that the happy ending is real and repeatable.
- section_header → 1 dark slide. Title: "Proof That This Works"
- case_study   → 1 slide. Requires client name, outcome metric, and a quote.
- data         → ADD 1 slide ONLY IF case_studies has more than 1 entry.

### STAGE 6 — THE PATH FORWARD (How We Work) — 1-2 slides
Make the next step feel easy and low-risk.
- engagement_models → 1 slide. Exactly 3 models. Frame as "Choose your starting point"
- pricing      → ADD 1 slide ONLY IF budget_range exists AND deck_goal is "proposal"

### STAGE 7 — THE CALL (Close) — always 2 slides
End with momentum. The client should feel inspired to act.
- section_header → 1 dark slide. Title: "Where We Go From Here"
- cta           → 1 slide, dark. One clear, specific action.

## DECK GOAL EMPHASIS — adjust slide count per stage, NOT the arc

- discovery_call: Emphasize Stages 2-3 (their world + turning point). Lighter on proof.
  Target 10-12 slides.
- follow_up: Emphasize Stage 5 (proof). They've heard the story; now they need evidence.
  Target 10-12 slides.
- proposal: Full arc with emphasis on Stages 4-6 (toolkit + proof + path forward).
  Include pricing. Target 12-14 slides.
- demo: Emphasize Stages 3-4 (turning point + toolkit). Skip heavy proof.
  Target 8-10 slides.

## NARRATIVE COHERENCE RULES — critical for a presentable deck
- Every slide's "purpose" must connect to the slide before and after it.
- The "transition_hint" field tells the content agent HOW to bridge to the next slide.
  Example: "End by asking 'but what does this look like in practice?' → leads to case_study"
- The "narrative_stage" field labels which story stage this slide belongs to.
- Section headers must use the CLIENT'S name and situation, never generic labels.
- The deck_title must be a benefit statement, not a label.
  GOOD: "Accelerating Revenue Intelligence at [Client]"
  BAD: "Sales Presentation for [Client]"

## SLIDE COUNT RULES
Minimum slides: 10
Maximum slides: 16
Never go below 10 or above 16 regardless of payload richness.

## SLIDE VARIETY RULES
- Never use the same slide_type twice in a row (section_headers excepted).
- Never use more than 2 slides of the same type in the entire deck.
- Always use at least 3 section_header slides to break the deck into sections.
- section_header slides do NOT count toward the "max 2 of same type" rule.

## THEME SELECTION — follow this decision tree in order, stop at first match

STEP 0 — Check our_company identity first:
- If our_company.name contains "Quarks" → "quarks_brand" always
- This overrides all industry and deck_goal rules below
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
- services_grid: ONLY use the MATCHED CAPABILITIES provided in the user message.
  Do not invent capabilities. Do not list all services generically.
  Format each bullet as "Capability Title: one-line client benefit"
  Max 6 items. Choose the ones most directly tied to client.pain_points.
- cover: Always first.
- agenda: Second slide. Shows roadmap of sections as a journey.
- section_header: Introduces a new story stage. Use 3+ times per deck.
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
  "deck_thesis": "One sentence: the core argument of this deck (e.g. 'By automating reconciliation, [client] can cut processing time 80% and reallocate talent to growth')",
  "narrative_summary": "2-3 sentences describing the story flow from hook to close",
  "slides": [
    {
      "slide_type": "cover|agenda|problem|solution|case_study|pricing|cta|section_header|services_grid|tech_stack|client_wall|engagement_models|comparison|data|team",
      "narrative_stage": "hook|their_world|turning_point|toolkit|proof|path_forward|call",
      "purpose": "One sentence: why is this slide in the deck AND how does it advance the story?",
      "content_brief": "VERY SHORT. Max 2 sentences. Include any required fields per slide type rules above.",
      "transition_hint": "One sentence: how this slide should bridge to the next slide (e.g. 'End with a question that the next slide answers')",
      "has_chart": boolean,
      "visual_tone": "dark|light"
    }
  ],
  "deck_title": "string — a benefit statement, not a label",
  "theme_choice": "golden_navy|teal_trust|coral_energy|charcoal_minimal|ocean_gradient|sage_calm|quarks_brand",
  "total_slides": number
}`,

        messages: [
          {
            role: 'user', content: `${JSON.stringify(payload)}

            MATCHED CAPABILITIES FOR THIS CLIENT (use these in services_grid slide):
            ${matchedCapabilities.map((c, i) => `${i + 1}. ${c}`).join('\n')}

            Only show capabilities that are relevant to the client's pain points above.
            Do not show all 20. Max 6 in the services_grid slide.
            
            CRITICAL INSTRUCTION: You MUST wrap the JSON in \`\`\`json and \`\`\` fences. Do NOT output any chain of thought, reasoning, or explanation. Start your response immediately with \`\`\`json.`
          }
        ]
      });

      tokenTracker.record('planning', CONTENT_MODEL, planResponse.usage, 'deck plan');
      plan = parseLLMResponse(planResponse);

      // Validate slide count is within bounds
      if (plan.slides.length < 10) {
        console.warn(`[orchestrator] Slide count too low: ${plan.slides.length} — check payload richness`);
      }
      if (plan.slides.length > 16) {
        console.warn(`[orchestrator] Slide count too high: ${plan.slides.length} — trimming`);
        // Keep first 2 (cover+agenda), last 2 (section_header+cta), trim middle
        const opening = plan.slides.slice(0, 2);
        const closing = plan.slides.slice(-2);
        const middle = plan.slides.slice(2, -2).slice(0, 12);
        plan.slides = [...opening, ...middle, ...closing];
      }

      // Inject total count into each slide spec so assembler can use it
      plan.slides = plan.slides.map((s, i) => ({
        ...s,
        slide_number: i + 1,
        total_slides: plan.slides.length
      }));

      console.log(`[orchestrator] Planned ${plan.slides.length} slides for ${payload.client?.name}`);
      break; // Success
    } catch (e) {
      console.error(`[${jobId}] Orchestrator plan attempt ${attempts} failed: ${e.message}`);
      if (attempts >= 3) {
        throw new Error(`failed to parse slide plan after 3 attempts — ${e.message}`);
      }
      // Wait before retrying to respect rate limits
      const retryDelay = 5000 * attempts;
      console.log(`[${jobId}] Sleeping for ${retryDelay}ms before retrying...`);
      await new Promise(r => setTimeout(r, retryDelay));
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
  // Each slide receives narrative context so content flows as a coherent story.
  const slides = [];
  const delayMs = parseInt(process.env.RATE_LIMIT_DELAY_MS || '0', 10);
  const BATCH_SIZE = delayMs > 0 ? 1 : 3;

  for (let i = 0; i < plan.slides.length; i += BATCH_SIZE) {
    const batch = plan.slides.slice(i, i + BATCH_SIZE);
    const batchJobs = batch.map((slidePlan, idx) => {
      const actualIdx = i + idx;
      const narrativeContext = buildNarrativeContext(plan, actualIdx);
      return Promise.all([
        contentAgent.generate(slidePlan, payload, actualIdx, null, narrativeContext),
        designAgent.assign(slidePlan, themeToUse, actualIdx, plan.slides.length)
      ]).then(([content, design]) => validator.validate({ ...slidePlan, ...content, ...design, index: actualIdx }));
    });
    const batchResults = await Promise.all(batchJobs);
    slides.push(...batchResults);

    if (delayMs > 0 && i + BATCH_SIZE < plan.slides.length) {
      console.log(`[${jobId}] Sleeping for ${delayMs}ms to respect rate limits...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  console.log(`[${jobId}] Orchestrator: all slides generated and validated`);

  return {
    deck_title: plan.deck_title || 'Sales Deck',
    color_theme: themeToUse,
    client_name: payload.client?.name || 'Client',
    deck_goal: payload.deck_goal,
    deck_thesis: plan.deck_thesis || '',
    narrative_summary: plan.narrative_summary || '',
    slides
  };
}

module.exports = { run };