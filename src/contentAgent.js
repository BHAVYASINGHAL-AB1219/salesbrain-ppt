const Anthropic = require('@anthropic-ai/sdk');
const { parseLLMResponse } = require('./utils/llmUtils');
const tokenTracker = require('./utils/tokenTracker');

const claude = new Anthropic({
  apiKey: process.env.LITELLM_API_KEY || 'dummy',
  baseURL: process.env.LITELLM_BASE_URL || 'http://localhost:4000'
});

const CONTENT_MODEL = process.env.CONTENT_MODEL || 'kimi-k2p6';

/**
 * Generates text content for a single slide as part of a coherent sales narrative.
 * Returns: { title, subtitle, bullets, speaker_notes, stat_callout, chart_data, stats_strip }
 *
 * @param {object} slidePlan - The slide blueprint from the orchestrator
 * @param {object} payload - The original user payload
 * @param {number} slideIndex - Index of this slide in the deck
 * @param {string|null} reviewFeedback - Optional feedback from the reviewer agent for re-generation
 * @param {object|null} narrativeContext - Story context: deck thesis, stage, transitions, neighbors
 */
async function generate(slidePlan, payload, slideIndex, reviewFeedback = null, narrativeContext = null) {
  console.log(`[ContentAgent] Using model: ${CONTENT_MODEL} for slide ${slideIndex + 1}`);
  const response = await claude.messages.create({
    model: CONTENT_MODEL,
    max_tokens: 8192,
    system: `You are a master sales copywriter who writes presentation slide content that reads as a single, compelling narrative — not a disconnected sequence of bullet points.

IMPORTANT JSON RULES:
- MUST wrap the JSON in \`\`\`json and \`\`\` fences.
- CRITICAL: DO NOT output any chain of thought, reasoning, or explanation. Start your response IMMEDIATELY with \`\`\`json.
- Escape all double quotes inside string values using \\"
- Do NOT use unescaped newlines (\\n) inside string values. Keep text on a single line.
- Ensure the JSON is strictly valid.

## STORY-DRIVEN WRITING PRINCIPLES
- Every slide is a beat in a larger story. Write content that FLOWS from the previous slide and SETS UP the next one.
- The client is the HERO. We are the GUIDE. The pain is the VILLAIN. The outcome is the HAPPY ENDING.
- Use the client's name, industry, and specific pain points in EVERY slide. Generic text is forbidden.
- Titles should be benefit-driven or provocative, never labels. 
  GOOD: "Why [client]'s Manual Processes Cost More Than They Think"
  BAD: "Challenges"
- Bullets should read like a narrative argument, not a feature list. Each bullet should build on the previous.
- speaker_notes should sound like a presenter telling a story, not reading a spec sheet.

## CONTENT RULES — CHARACTER BUDGETS (CRITICAL)
Text boxes have fixed sizes. If you exceed these limits, text WILL overflow and look broken.
STAY WITHIN THESE LIMITS. Be concise. Every word must earn its place.

- title: max 60 characters (8 words max), punchy and specific to the client
- subtitle: max 120 characters — one sentence to bridge or add context
- bullets (regular slides): max 4-5 items, EACH max 100 characters
  Write punchy, impactful phrases — NOT full sentences. Think billboard, not paragraph.
  BAD: "Legacy data warehouse bottlenecks are forcing Genpact to wait 3-4 days for critical reports, turning urgent decisions into bottlenecks"
  GOOD: "3-4 day report delays from legacy warehouse bottlenecks"
- bullets (services_grid/tech_stack): up to 6-9 items, format "Title: description"
  Title max 25 chars, description max 35 chars. Total per item max 60 characters.
  Append signal in brackets: "Agentic AI: Autonomous resolution [Hot in 2026]"
- bullets (client_wall): up to 15-20 client/company names as simple strings, max 25 chars each
- bullets (engagement_models): exactly 3 bullets, format "Model Name: point1 | point2 | point3"
  Each point max 30 chars. Total per bullet max 110 characters.
- bullets (case_study): max 4 items, EACH max 80 characters — specific measurable results
- speaker_notes: max 180 characters, 2-3 sentences, conversational
- stat_callout: only if there's a real number in the payload (null otherwise)
  number: max 15 chars, label: max 60 chars
- chart_data: only if has_chart is true (null otherwise)
- stats_strip: ONLY for cover slide — array of 3-4 objects [{number: "17+", label: "Years"}, ...]
  number: max 10 chars, label: max 25 chars
  Pull real numbers from the payload (years of experience, client count, team size, etc.)`,
    messages: [
      {
        role: 'user',
        content: `Slide ${slideIndex + 1} of ${narrativeContext?.slide_position?.split(' of ')[1] || '?'}: ${slidePlan.slide_type}
Story stage: ${narrativeContext?.current_stage || 'unknown'}
Purpose: ${slidePlan.purpose}
Content brief: ${slidePlan.content_brief}
${narrativeContext?.transition_hint ? `Transition to next slide: ${narrativeContext.transition_hint}` : ''}

${narrativeContext?.deck_thesis ? `DECK THESIS (the core argument): ${narrativeContext.deck_thesis}` : ''}
${narrativeContext?.narrative_summary ? `STORY FLOW: ${narrativeContext.narrative_summary}` : ''}

${narrativeContext?.prev_purpose ? `PREVIOUS SLIDE (${narrativeContext.prev_type}): ${narrativeContext.prev_purpose}
→ Your slide must flow naturally from this. Do NOT repeat what was said. Build on it.` : 'This is the first slide — set the stage powerfully.'}
${narrativeContext?.next_purpose ? `NEXT SLIDE (${narrativeContext.next_type}): ${narrativeContext.next_purpose}
→ Your slide should set up this next beat. End in a way that makes the audience want to see what's next.` : 'This is the final slide — end with a clear, memorable call to action.'}

Client context:
- Name: ${payload.client?.name}
- Industry: ${payload.client?.industry}
- Pain points: ${(payload.client?.pain_points || []).join(', ')}

Our company:
- Name: ${payload.our_company?.name || 'Our Company'}
- Key differentiators: ${(payload.our_company?.differentiators || []).join(', ')}
- Relevant products: ${(payload.our_company?.products || []).slice(0, 5).join(', ')}
- Case study available: ${payload.our_company?.case_studies?.[0]?.title || 'none'}

Alignment score: ${payload.alignment_score}%
Recommended angle: ${payload.recommended_angle}

SLIDE-TYPE SPECIFIC RULES:
${slidePlan.slide_type === 'cta' ? `
- This is the CLOSING slide (Call To Action). It must feel like a powerful, memorable ending.
- "title" should be a compelling CTA headline (e.g. "Let's Transform ${payload.client?.name || 'Your Business'} Together")
- "subtitle" should be a second line that reinforces urgency or partnership (e.g. "Your AI & Cloud roadmap starts here")
- Do NOT use generic text. Make it specific to the client and their pain points.
- "bullets" are NOT shown — leave as empty array.
` : ''}${slidePlan.slide_type === 'cover' ? `
- "title" is the deck title — make it about the CLIENT's aspiration, not about us.
- "subtitle" should mention both our company and the client.
- Use stats_strip to show credibility numbers (years, clients, team size).
` : ''}${slidePlan.slide_type === 'section_header' ? `
- "title" should be provocative/client-specific, not generic like "Our Approach".
  Frame it as a question or insight about the CLIENT's situation.
  GOOD: "Why ${payload.client?.industry || 'Your Industry'} Teams Struggle With ${(payload.client?.pain_points || ['complex operations'])[0]}"
  BAD: "The Problem"
- "subtitle" is optional — one sentence of context that teases what's coming.
` : ''}${slidePlan.slide_type === 'problem' ? `
- Frame the pain points as the VILLAIN of the story. Use the client's own language.
- Each bullet should describe a pain point AND its business impact (cost, time, risk).
- stat_callout must use a real number from the payload.
` : ''}${slidePlan.slide_type === 'solution' ? `
- Frame our approach as the GUIDE's wisdom — the turning point that changes everything.
- Each bullet should map to a pain point from the problem slide (show the contrast).
- stat_callout must use a real number from the payload.
` : ''}${slidePlan.slide_type === 'case_study' ? `
- Tell a mini-story: who was the client, what was their pain, what did we do, what was the outcome.
- "subtitle" should be a powerful quote or outcome statement.
- bullets should be specific, measurable results.
` : ''}${slidePlan.slide_type === 'agenda' ? `
- Frame the agenda as a JOURNEY, not a table of contents.
- Use action verbs and benefit language: "Where you are → What's holding you back → How we help → Proof → Next steps"
` : ''}
Return JSON:
{
  "title": "...",
  "subtitle": "..." or null,
  "bullets": ["...", "...", "..."] or [],
  "speaker_notes": "...",
  "stat_callout": { "number": "87%", "label": "cost reduction" } or null,
  "chart_data": { "type": "bar|line|pie", "labels": [...], "values": [...], "series_name": "..." } or null,
  "stats_strip": [{"number": "17+", "label": "Years"}, ...] or null
}${reviewFeedback ? `

⚠️ REVISION REQUIRED — Your previous version of this slide was reviewed and REJECTED.
Reviewer feedback: "${reviewFeedback}"
You MUST fix the issues described above. Do NOT repeat the same mistakes. Be specific to the client.` : ''}`
      }
    ]
  });

  tokenTracker.record(
    reviewFeedback ? 'regeneration' : 'content_generation',
    CONTENT_MODEL,
    response.usage,
    `slide ${slideIndex + 1}`
  );

  try {
    return parseLLMResponse(response);
  } catch (e) {
    // Fallback if JSON parse fails
    return {
      title: slidePlan.purpose.slice(0, 40),
      subtitle: null,
      bullets: [],
      speaker_notes: 'Refer to briefing notes.',
      stat_callout: null,
      chart_data: null,
      stats_strip: null
    };
  }
}

module.exports = { generate };
