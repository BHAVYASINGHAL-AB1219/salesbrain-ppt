const Anthropic = require('@anthropic-ai/sdk');
const { parseLLMResponse } = require('./utils/llmUtils');
const tokenTracker = require('./utils/tokenTracker');

const claude = new Anthropic({
  apiKey: process.env.LITELLM_API_KEY || 'dummy',
  baseURL: process.env.LITELLM_BASE_URL || 'http://localhost:4000'
});

const CONTENT_MODEL = process.env.CONTENT_MODEL || 'kimi-k2p6';
// Extraction is a structured task (text → fixed JSON schema) — can use a
// cheaper open-source model via NVIDIA. Falls back to CONTENT_MODEL if unset.
const EXTRACTOR_MODEL = process.env.EXTRACTOR_MODEL || CONTENT_MODEL;

async function extract(text) {
  const systemPrompt = `You are an expert data extractor. Given an unstructured text document (e.g. an alignment strategy, article, or briefing), extract the relevant information into a specific JSON structure.
CRITICAL: You MUST wrap the JSON in \`\`\`json and \`\`\` fences. Do NOT output any chain of thought, reasoning, or explanation. Start your response immediately with \`\`\`json.

Schema:
{
  "client_name": "string (name of the client/prospect, e.g. UKG)",
  "client_industry": "string (infer from text, e.g. HR Tech)",
  "pain_points": ["string (up to 3)"],
  "client_size": "number or null",
  "budget_range": "string or null",
  "products": ["string (our products mentioned)"],
  "differentiators": ["string (why we fit, our strengths)"],
  "case_study_title": "string or null (e.g. 78% faster regression cycles)",
  "case_study_outcome": "string or null (e.g. 0 production defects post-go-live)",
  "tagline": "string or null",
  "alignment_score": "number (0-100, e.g. 85)",
  "recommended_angle": "string (the main strategic angle or pitch)",
  "deck_goal": "proposal"
}`;

  console.log(`[Extractor] Using model: ${EXTRACTOR_MODEL}`);
  const response = await claude.messages.create({
    model: EXTRACTOR_MODEL,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Text to extract:\n\n${text}\n\nCRITICAL INSTRUCTION: You MUST wrap the JSON in \`\`\`json and \`\`\` fences. Do NOT output any chain of thought, reasoning, or explanation. Start your response immediately with \`\`\`json.`
      }
    ]
  });

  tokenTracker.record('extraction', EXTRACTOR_MODEL, response.usage, 'payload extraction');
  console.log("LLM RESPONSE:", JSON.stringify(response, null, 2));

  try {
    return parseLLMResponse(response);
  } catch (e) {
    throw new Error(`Failed to parse extracted JSON: ${e.message}`);
  }
}

module.exports = { extract };
