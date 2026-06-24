const Anthropic = require('@anthropic-ai/sdk');
const { parseLLMResponse } = require('./utils/llmUtils');

const claude = new Anthropic({
  apiKey: process.env.LITELLM_API_KEY || 'dummy',
  baseURL: process.env.LITELLM_BASE_URL || 'http://localhost:4000'
});

const CONTENT_MODEL = process.env.CONTENT_MODEL || 'kimi-k2p6';

/**
 * Generates text content for a single slide.
 * Returns: { title, subtitle, bullets, speaker_notes, stat_callout, chart_data, stats_strip }
 * @param {object} slidePlan - The slide blueprint from the orchestrator
 * @param {object} payload - The original user payload
 * @param {number} slideIndex - Index of this slide in the deck
 * @param {string|null} reviewFeedback - Optional feedback from the reviewer agent for re-generation
 */
async function generate(slidePlan, payload, slideIndex, reviewFeedback = null) {
  console.log(`[ContentAgent] Using model: ${CONTENT_MODEL} for slide ${slideIndex + 1}`);
  const response = await claude.messages.create({
    model: CONTENT_MODEL,
    max_tokens: 8192,
    system: `You write compelling sales presentation slide content. 
Return ONLY valid JSON. No markdown, no explanation.

IMPORTANT JSON RULES:
- Escape all double quotes inside string values using \\"
- Do NOT use unescaped newlines (\\n) inside string values. Keep text on a single line.
- Ensure the JSON is strictly valid.

Rules:
- title: max 8 words, punchy and specific
- subtitle: optional, 1 sentence max for context
- bullets: max 4-6 items depending on slide type
  - For services_grid/tech_stack: up to 9-12 items, format "Title: description"
  - For client_wall: up to 15-20 client/company names as simple strings
  - For engagement_models: 3 items, format "Model Name || bullet1 || bullet2 || bullet3"
  - For regular slides: max 4 items, each max 12 words
- speaker_notes: 2-3 sentences for the presenter, conversational
- stat_callout: only if there's a real number in the payload (null otherwise)
- chart_data: only if has_chart is true (null otherwise)
- stats_strip: ONLY for cover slide — array of 3-4 objects [{number: "17+", label: "Years"}, ...]
  Pull real numbers from the payload (years of experience, client count, team size, etc.)`,
    messages: [
      {
        role: 'user',
        content: `Slide ${slideIndex + 1}: ${slidePlan.slide_type}
Purpose: ${slidePlan.purpose}
Content brief: ${slidePlan.content_brief}

Client context:
- Name: ${payload.client?.name}
- Industry: ${payload.client?.industry}
- Pain points: ${(payload.client?.pain_points || []).join(', ')}

Our company:
- Key differentiators: ${(payload.our_company?.differentiators || []).join(', ')}
- Relevant products: ${(payload.our_company?.products || []).slice(0, 5).join(', ')}
- Case study available: ${payload.our_company?.case_studies?.[0]?.title || 'none'}

Alignment score: ${payload.alignment_score}%
Recommended angle: ${payload.recommended_angle}

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
