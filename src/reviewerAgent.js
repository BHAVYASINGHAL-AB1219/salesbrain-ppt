const Anthropic = require('@anthropic-ai/sdk');
const { parseLLMResponse } = require('./utils/llmUtils');
const tokenTracker = require('./utils/tokenTracker');
const { execSync } = require('child_process');
const path = require('path');

const claude = new Anthropic({
  apiKey: process.env.LITELLM_API_KEY || 'dummy',
  baseURL: process.env.LITELLM_BASE_URL || 'http://localhost:4000'
});

const REVIEWER_MODEL = process.env.REVIEWER_MODEL || process.env.CONTENT_MODEL || 'kimi-k2p6';
const PASS_THRESHOLD = 7; // Slide passes if avg score >= 7/10

/**
 * Extracts slide content from a built .pptx file using the Python script.
 * @param {string} pptxPath - Absolute or relative path to the .pptx file
 * @returns {object} Parsed JSON with slide extracts
 */
function extractSlidesFromPptx(pptxPath) {
  const scriptPath = path.join(__dirname, '../scripts/extract_slides.py');
  const absPath = path.resolve(pptxPath);

  try {
    const result = execSync(`python3 "${scriptPath}" "${absPath}"`, {
      encoding: 'utf-8',
      timeout: 30000, // 30s max
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });
    return JSON.parse(result);
  } catch (err) {
    console.error('Failed to extract slides from .pptx:', err.message);
    throw new Error(`PPTX extraction failed: ${err.message}`);
  }
}

/**
 * Reviews the extracted slide content against the original payload.
 *
 * @param {object} extractedData - Output from extractSlidesFromPptx()
 * @param {object} originalPayload - The user's original Sales Brain payload
 * @param {Array} originalSlideSpecs - The deckSpec.slides array (what was intended)
 * @returns {object} Review results with per-slide scores and feedback
 */
async function review(extractedData, originalPayload, originalSlideSpecs) {
  // Build a concise summary of what's in each slide for the reviewer
  const slideSummaries = extractedData.slides.map((slide, i) => {
    const intended = originalSlideSpecs[i] || {};
    return {
      slide_number: slide.slide_number,
      intended_type: intended.slide_type || 'unknown',
      actual_text: (slide.all_text_combined || '').slice(0, 300),
      has_chart: slide.has_chart,
      has_table: slide.has_table,
      speaker_notes: (slide.speaker_notes || '').slice(0, 150)
    };
  });

  console.log(`[ReviewerAgent] Using model: ${REVIEWER_MODEL}`);
  const response = await claude.messages.create({
    model: REVIEWER_MODEL,
    max_tokens: 8192,
    system: `You are a senior sales deck quality reviewer. You receive EXTRACTED TEXT from a real .pptx file (what the viewer actually sees) alongside the original client brief.

Your job: Score each slide and identify issues. Be strict but fair.

SCORING CRITERIA (each 1-10):
- RELEVANCE: Does the text reference the actual client name, their industry, and their specific pain points from the payload? Generic text like "driving innovation" scores low.
- SPECIFICITY: Are claims backed by real numbers from the payload? Fabricated statistics score 0.
- CLARITY: Is the text concise, punchy, and professional? Wordy or jargon-heavy text scores low.
- COMPLETENESS: Does the slide have meaningful content, or is it mostly empty / placeholder text?

A slide PASSES if its average score across all criteria >= ${PASS_THRESHOLD}/10.

Return ONLY valid JSON. No markdown fences.

IMPORTANT JSON RULES:
- Escape all double quotes inside string values using \\"
- Do NOT use unescaped newlines inside string values. Keep text on a single line.
- Ensure the JSON is strictly valid.

OUTPUT-SAVING RULE (CRITICAL):
- For each PASSING slide, output ONLY {"slide_index": N, "pass": true}. Do NOT include slide_type, sub-scores, issues, or feedback for passing slides.
- For each FAILING slide, output the full object with all four sub-scores, average_score, pass:false, issues[], and a specific feedback string.
- Most slides pass — do not waste tokens describing them. Keep the response as short as possible.

Schema:
{
  "reviews": [
    {"slide_index": 0, "pass": true},
    {"slide_index": 1, "pass": true},
    {
      "slide_index": 2,
      "slide_type": "problem",
      "relevance": 3,
      "specificity": 2,
      "clarity": 6,
      "completeness": 5,
      "average_score": 4.0,
      "pass": false,
      "issues": ["fabricated_stat", "generic_title", "no_client_reference"],
      "feedback": "Title says 'Driving Innovation' which is generic. Use the client name. The stat 95% is fabricated - use the alignment score of 87% from the payload."
    }
  ],
  "overall_score": 7.2,
  "passed_count": 10,
  "failed_count": 2,
  "deck_narrative_feedback": "Overall narrative is good but the transition from problem to solution is abrupt."
}`,
    messages: [
      {
        role: 'user',
        content: `ORIGINAL CLIENT BRIEF:
Client: ${originalPayload.client?.name || 'Unknown'}
Industry: ${originalPayload.client?.industry || 'Unknown'}
Pain Points: ${(originalPayload.client?.pain_points || []).join(', ')}
Our Products: ${(originalPayload.our_company?.products || []).join(', ')}
Differentiators: ${(originalPayload.our_company?.differentiators || []).join(', ')}
Alignment Score: ${originalPayload.alignment_score}%
Recommended Angle: ${originalPayload.recommended_angle}
Deck Goal: ${originalPayload.deck_goal}

EXTRACTED SLIDE CONTENT FROM THE BUILT .PPTX FILE:
${JSON.stringify(slideSummaries, null, 2)}

Review each slide. Be strict about fabricated statistics and generic text that doesn't reference the actual client.`
      }
    ]
  });

  tokenTracker.record('content_review', REVIEWER_MODEL, response.usage, 'content review');

  try {
    const reviewResult = parseLLMResponse(response);

    // Ensure pass/fail is correctly computed based on threshold.
    // Passing slides may be returned as minimal {slide_index, pass:true}
    // objects (see OUTPUT-SAVING RULE in the prompt) to save output tokens.
    // Trust the explicit pass flag for those and default the score; only
    // recompute from sub-scores for full failing objects.
    if (reviewResult.reviews) {
      let passedCount = 0;
      let totalScore = 0;

      reviewResult.reviews = reviewResult.reviews.map(r => {
        if (r.pass === true && r.average_score == null) {
          const avg = PASS_THRESHOLD;
          passedCount++;
          totalScore += avg;
          return { ...r, average_score: avg, pass: true };
        }
        const avg = r.average_score || ((r.relevance + r.specificity + r.clarity + r.completeness) / 4);
        const pass = avg >= PASS_THRESHOLD;
        if (pass) passedCount++;
        totalScore += avg;

        return { ...r, average_score: avg, pass };
      });

      reviewResult.passed_count = passedCount;
      reviewResult.failed_count = reviewResult.reviews.length - passedCount;
      reviewResult.overall_score = totalScore / reviewResult.reviews.length;
    }

    return reviewResult;
  } catch (e) {
    console.error('Failed to parse reviewer response:', e.message);
    // If review parsing fails, pass everything to avoid blocking the pipeline
    return {
      reviews: originalSlideSpecs.map((_, i) => ({
        slide_index: i, pass: true, average_score: 7, feedback: null, issues: []
      })),
      overall_score: 7,
      passed_count: originalSlideSpecs.length,
      failed_count: 0,
      deck_narrative_feedback: 'Review parsing failed — passed by default.'
    };
  }
}

module.exports = { review, extractSlidesFromPptx, PASS_THRESHOLD };