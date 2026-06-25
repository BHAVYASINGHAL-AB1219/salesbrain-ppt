const Anthropic = require('@anthropic-ai/sdk');
const { parseLLMResponse } = require('./utils/llmUtils');

const claude = new Anthropic({
  apiKey: process.env.LITELLM_API_KEY || 'dummy',
  baseURL: process.env.LITELLM_BASE_URL || 'http://localhost:4000'
});

const CONTENT_MODEL = process.env.CONTENT_MODEL || 'kimi-k2p6';

async function extract(text) {
  const systemPrompt = `You are an expert data extractor. Given an unstructured text document (e.g. an alignment strategy, article, or briefing), extract the relevant information into a specific JSON structure.
CRITICAL: You must output ONLY the raw JSON object. Do not include ANY conversational text, reasoning, or markdown formatting. Start your response immediately with the JSON.

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

  console.log(`[Extractor] Using model: ${CONTENT_MODEL}`);
  const response = await claude.messages.create({
    model: CONTENT_MODEL,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Text to extract:\n\n${text}\n\nCRITICAL INSTRUCTION: You must output ONLY the raw JSON object. Do not include ANY conversational text, reasoning, or markdown formatting. Start your response immediately with the JSON { character.`
      }
    ]
  });

  console.log("LLM RESPONSE:", JSON.stringify(response, null, 2));

  try {
    return parseLLMResponse(response);
  } catch (e) {
    throw new Error(`Failed to parse extracted JSON: ${e.message}`);
  }
}

module.exports = { extract };
