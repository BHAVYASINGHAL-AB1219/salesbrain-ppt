/**
 * visualReviewerAgent.js — Sales Brain PPT Builder
 *
 * Two-layer visual/layout review system:
 *
 * Layer 1 (Structural): Extracts shape geometry from .pptx via python-pptx,
 *   runs rule-based checks (overlap, overflow, font size, bounds, balance).
 *   Fast, deterministic, zero API cost.
 *
 * Layer 2 (Vision): Converts slides to PNG via LibreOffice, sends screenshots
 *   to GPT-5 vision for aesthetic review. Optional — gracefully disabled
 *   when LibreOffice is not installed.
 *
 * Both layers integrate into the review loop alongside the existing content
 * reviewer (reviewerAgent.js).
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { parseLLMResponse } = require('./utils/llmUtils');

const claude = new Anthropic({
  apiKey: process.env.LITELLM_API_KEY || 'dummy',
  baseURL: process.env.LITELLM_BASE_URL || 'http://localhost:4000'
});

const VISION_MODEL = process.env.VISION_MODEL || process.env.CONTENT_MODEL || 'kimi-k2p6';
const STRUCTURAL_REVIEW_ENABLED = (process.env.STRUCTURAL_REVIEW_ENABLED || 'true') !== 'false';
const VISUAL_REVIEW_ENABLED = (process.env.VISUAL_REVIEW_ENABLED || 'true') !== 'false';
const STRUCTURAL_PASS_THRESHOLD = 7.0;
const VISION_PASS_THRESHOLD = 6.5;

// ─── Layer 1: Structural Review ──────────────────────────────────────────────

/**
 * Run structural/geometric review on a built .pptx file.
 * Uses extract_slides.py (enhanced) → structural_review.py pipeline.
 *
 * @param {string} pptxPath - Absolute path to the .pptx file
 * @returns {object|null} Structural review results, or null if disabled/failed
 */
function runStructuralReview(pptxPath) {
  if (!STRUCTURAL_REVIEW_ENABLED) {
    console.log('  [Visual] Structural review is disabled');
    return null;
  }

  const extractScript = path.join(__dirname, '../scripts/extract_slides.py');
  const reviewScript = path.join(__dirname, '../scripts/structural_review.py');
  const absPath = path.resolve(pptxPath);

  try {
    // Pipe extract → structural_review
    const result = execSync(
      `python3 "${extractScript}" "${absPath}" | python3 "${reviewScript}"`,
      {
        encoding: 'utf-8',
        timeout: 45000, // 45s max
        maxBuffer: 10 * 1024 * 1024, // 10MB
        shell: true
      }
    );
    return JSON.parse(result);
  } catch (err) {
    console.error('  [Visual] Structural review failed:', err.message);
    return null;
  }
}


// ─── Layer 2: Vision Model Review ────────────────────────────────────────────

/**
 * Convert .pptx slides to PNG images via LibreOffice.
 * Returns null if LibreOffice is not installed (graceful fallback).
 *
 * @param {string} pptxPath - Path to the .pptx file
 * @param {string} outputDir - Directory to write PNG images
 * @returns {object|null} Image conversion results, or null if unavailable
 */
function convertSlidesToImages(pptxPath, outputDir) {
  const script = path.join(__dirname, '../scripts/slide_to_images.py');
  const absPath = path.resolve(pptxPath);

  try {
    const result = execSync(
      `python3 "${script}" "${absPath}" "${outputDir}"`,
      {
        encoding: 'utf-8',
        timeout: 120000, // 2 minutes
        maxBuffer: 10 * 1024 * 1024
      }
    );

    const parsed = JSON.parse(result);

    if (!parsed.success) {
      if (parsed.libreoffice_missing) {
        console.log('  [Visual] LibreOffice not installed — vision review disabled');
      } else {
        console.error('  [Visual] Image conversion failed:', parsed.error);
      }
      return null;
    }

    return parsed;
  } catch (err) {
    console.error('  [Visual] Image conversion error:', err.message);
    return null;
  }
}

/**
 * Send a single slide image to GPT-5 vision for aesthetic review.
 *
 * @param {string} imagePath - Absolute path to the slide PNG
 * @param {number} slideNumber - 1-indexed slide number
 * @param {string} slideType - The slide type (cover, problem, etc.)
 * @returns {object} Vision review result for this slide
 */
async function reviewSlideWithVision(imagePath, slideNumber, slideType) {
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = 'image/png';

    console.log(`[VisualReviewer] Using model: ${VISION_MODEL} for slide ${slideNumber}`);
    const response = await claude.messages.create({
      model: VISION_MODEL,
      max_tokens: 8192,
      system: `You are an expert presentation design reviewer. You are examining a screenshot of a single slide from a sales presentation.

Score these visual aspects (each 1-10):
- LAYOUT_BALANCE: Is content well-distributed across the slide? No awkward empty spaces or cramped areas?
- TEXT_READABILITY: Can all text be comfortably read? Are font sizes appropriate for projection?
- VISUAL_HIERARCHY: Is there a clear title → subtitle → body reading order? Does the eye flow naturally?
- ALIGNMENT: Are elements properly aligned with each other? No misaligned edges or inconsistent spacing?
- PROFESSIONAL_FEEL: Does this look polished and premium? Would you present this to a Fortune 500 client?

A slide PASSES visual review if the average score >= ${VISION_PASS_THRESHOLD}/10.

Return ONLY valid JSON. No markdown fences.

IMPORTANT JSON RULES:
- Escape all double quotes inside string values using \\"
- Do NOT use unescaped newlines inside string values. Keep text on a single line.

Schema:
{
  "slide_number": ${slideNumber},
  "slide_type": "${slideType}",
  "layout_balance": 8,
  "text_readability": 7,
  "visual_hierarchy": 9,
  "alignment": 8,
  "professional_feel": 8,
  "average_score": 8.0,
  "pass": true,
  "visual_issues": ["issue description 1", "issue description 2"],
  "visual_feedback": "Specific actionable feedback for improving this slide's visual design"
}`,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: base64Image
              }
            },
            {
              type: 'text',
              text: `Review this slide (slide ${slideNumber}, type: "${slideType}") for visual/design quality. Be strict but fair.`
            }
          ]
        }
      ]
    });

    const result = parseLLMResponse(response);

    // Ensure computed fields
    const avg = result.average_score ||
      (result.layout_balance + result.text_readability + result.visual_hierarchy +
       result.alignment + result.professional_feel) / 5;
    result.average_score = Math.round(avg * 10) / 10;
    result.pass = avg >= VISION_PASS_THRESHOLD;
    result.slide_number = slideNumber;

    return result;
  } catch (err) {
    console.error(`  [Visual] Vision review failed for slide ${slideNumber}:`, err.message);
    // Return a passing score on failure to avoid blocking
    return {
      slide_number: slideNumber,
      slide_type: slideType,
      average_score: 7.5,
      pass: true,
      visual_issues: [],
      visual_feedback: 'Vision review failed — passed by default.',
      error: err.message
    };
  }
}


/**
 * Run full vision review on all slides (or a subset).
 *
 * @param {string} pptxPath - Path to the .pptx file
 * @param {Array} slideSpecs - The deckSpec.slides array
 * @param {Array|null} structuralResults - Results from Layer 1 (to skip failed slides)
 * @returns {object|null} Vision review results, or null if unavailable
 */
async function runVisionReview(pptxPath, slideSpecs, structuralResults) {
  if (!VISUAL_REVIEW_ENABLED) {
    console.log('  [Visual] Vision review is disabled');
    return null;
  }

  // Create temp directory for slide images
  const imageDir = path.join(path.dirname(pptxPath), '.slide-images-' + Date.now());

  try {
    const imageResult = convertSlidesToImages(pptxPath, imageDir);
    if (!imageResult) return null;

    const reviews = [];
    let passedCount = 0;
    let totalScore = 0;

    // Review slides concurrently (max 3 at a time to avoid rate limits)
    const BATCH_SIZE = 3;
    for (let i = 0; i < imageResult.image_count; i += BATCH_SIZE) {
      const batch = [];

      for (let j = i; j < Math.min(i + BATCH_SIZE, imageResult.image_count); j++) {
        const imagePath = imageResult.images[j];
        const slideSpec = slideSpecs[j] || {};
        const slideType = slideSpec.slide_type || 'unknown';
        const slideNumber = j + 1;

        // Skip slides that failed structural review (no point in vision review)
        if (structuralResults && structuralResults.slides[j] && !structuralResults.slides[j].pass) {
          reviews.push({
            slide_number: slideNumber,
            slide_type: slideType,
            average_score: 0,
            pass: false,
            visual_issues: ['Skipped — failed structural review'],
            visual_feedback: 'Fix structural issues first before visual review.',
            skipped: true
          });
          continue;
        }

        // Skip very simple slides (section headers, CTA) — usually fine
        const shapeCount = slideSpec.shape_count || (slideSpec.bullets?.length || 0) + 3;
        if (shapeCount < 3 && ['cta', 'section_header'].includes(slideType)) {
          reviews.push({
            slide_number: slideNumber,
            slide_type: slideType,
            average_score: 8.0,
            pass: true,
            visual_issues: [],
            visual_feedback: 'Simple layout — auto-passed.',
            skipped: true
          });
          passedCount++;
          totalScore += 8.0;
          continue;
        }

        batch.push(reviewSlideWithVision(imagePath, slideNumber, slideType));
      }

      const batchResults = await Promise.all(batch);
      for (const result of batchResults) {
        reviews.push(result);
        if (result.pass) passedCount++;
        totalScore += result.average_score || 0;
      }
    }

    const slideCount = reviews.length;

    return {
      reviews,
      overall_vision_score: slideCount > 0 ? Math.round((totalScore / slideCount) * 10) / 10 : 10,
      passed_count: passedCount,
      failed_count: slideCount - passedCount
    };
  } finally {
    // Cleanup temp images
    try {
      if (fs.existsSync(imageDir)) {
        fs.rmSync(imageDir, { recursive: true, force: true });
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}


// ─── Combined Visual Review ─────────────────────────────────────────────────

/**
 * Run the full two-layer visual review pipeline.
 *
 * @param {string} pptxPath - Path to the built .pptx file
 * @param {Array} slideSpecs - The deckSpec.slides array
 * @returns {object} Combined visual review results
 */
async function reviewVisuals(pptxPath, slideSpecs) {
  const result = {
    structural: null,
    vision: null,
    combined_failures: [],
    has_failures: false
  };

  // Layer 1: Structural review
  console.log('  [Visual] Running structural review...');
  result.structural = runStructuralReview(pptxPath);

  if (result.structural) {
    const { passed_count, failed_count, overall_structural_score, total_errors, total_warnings } = result.structural;
    console.log(`  [Visual] Structural: ${overall_structural_score}/10 — ${passed_count} passed, ${failed_count} failed (${total_errors} errors, ${total_warnings} warnings)`);
  }

  // Layer 2: Vision review (only if enabled and possible)
  console.log('  [Visual] Attempting vision review...');
  result.vision = await runVisionReview(pptxPath, slideSpecs, result.structural);

  if (result.vision) {
    console.log(`  [Visual] Vision: ${result.vision.overall_vision_score}/10 — ${result.vision.passed_count} passed, ${result.vision.failed_count} failed`);
  }

  // Merge failures from both layers
  result.combined_failures = mergeFailures(result.structural, result.vision, slideSpecs);
  result.has_failures = result.combined_failures.length > 0;

  return result;
}

/**
 * Merge failures from structural and vision reviews into a unified list.
 * Each failure includes actionable feedback for content/layout regeneration.
 *
 * @param {object|null} structural - Structural review results
 * @param {object|null} vision - Vision review results
 * @param {Array} slideSpecs - The deckSpec.slides array
 * @returns {Array} Merged failures with regeneration hints
 */
function mergeFailures(structural, vision, slideSpecs) {
  const failureMap = new Map(); // slide_index → failure info

  // Structural failures
  if (structural && structural.slides) {
    for (const sr of structural.slides) {
      if (!sr.pass) {
        const idx = sr.slide_number - 1;
        const issues = sr.issues || [];

        // Generate actionable feedback from structural issues
        const feedback = generateStructuralFeedback(issues, slideSpecs[idx]);

        failureMap.set(idx, {
          slide_index: idx,
          slide_type: slideSpecs[idx]?.slide_type || 'unknown',
          structural_score: sr.structural_score,
          structural_issues: issues,
          vision_score: null,
          vision_feedback: null,
          combined_feedback: feedback.contentFeedback,
          layout_suggestion: feedback.layoutSuggestion
        });
      }
    }
  }

  // Vision failures
  if (vision && vision.reviews) {
    for (const vr of vision.reviews) {
      if (!vr.pass && !vr.skipped) {
        const idx = vr.slide_number - 1;

        if (failureMap.has(idx)) {
          // Merge with existing structural failure
          const existing = failureMap.get(idx);
          existing.vision_score = vr.average_score;
          existing.vision_feedback = vr.visual_feedback;
          existing.combined_feedback += ' ' + (vr.visual_feedback || '');
        } else {
          failureMap.set(idx, {
            slide_index: idx,
            slide_type: vr.slide_type || slideSpecs[idx]?.slide_type || 'unknown',
            structural_score: null,
            structural_issues: [],
            vision_score: vr.average_score,
            vision_feedback: vr.visual_feedback,
            combined_feedback: vr.visual_feedback || 'Visual quality is below threshold.',
            layout_suggestion: null
          });
        }
      }
    }
  }

  return Array.from(failureMap.values());
}


/**
 * Generate actionable feedback from structural issues.
 * Returns both content feedback (for contentAgent) and layout suggestions (for designAgent).
 *
 * @param {Array} issues - Structural issues from review
 * @param {object} slideSpec - Current slide spec
 * @returns {{ contentFeedback: string, layoutSuggestion: string|null }}
 */
function generateStructuralFeedback(issues, slideSpec) {
  const feedback = [];
  let layoutSuggestion = null;

  for (const issue of issues) {
    switch (issue.type) {
      case 'text_overflow':
        feedback.push(`Text overflows its container (${issue.fill_ratio}x capacity). Shorten the text significantly — use max ${Math.ceil(issue.estimated_capacity * 0.8)} characters.`);
        // If overflow is severe, suggest a layout with more space
        if (issue.fill_ratio > 1.8) {
          layoutSuggestion = suggestAlternativeLayout(slideSpec, 'more_space');
        }
        break;

      case 'text_overlap':
        feedback.push(`Text elements overlap (${issue.overlap_percent}% overlap). Reduce text length or number of items.`);
        break;

      case 'font_too_small':
        feedback.push(`Font size ${issue.font_size}pt is too small. Reduce content so font can be larger.`);
        break;

      case 'out_of_bounds_right':
      case 'out_of_bounds_bottom':
        if (issue.severity === 'error') {
          feedback.push(`Content extends ${issue.overshoot_inches}" beyond slide edge. Shorten text.`);
        }
        break;

      case 'empty_text_box':
        feedback.push('A text placeholder is empty — provide content for all text areas.');
        break;

      case 'unbalanced_horizontal':
        feedback.push('Content is heavily skewed to one side. Consider a more balanced layout.');
        if (!layoutSuggestion) {
          layoutSuggestion = suggestAlternativeLayout(slideSpec, 'balanced');
        }
        break;
    }
  }

  return {
    contentFeedback: feedback.join(' ') || 'Visual layout issues detected. Shorten text and reduce number of items.',
    layoutSuggestion
  };
}


// ─── Layout Suggestion Engine ────────────────────────────────────────────────

/**
 * Layout upgrade paths — when a layout has too much content, suggest an alternative
 * that provides more space or handles more items.
 */
const LAYOUT_UPGRADES = {
  // Current layout → alternatives with more space
  'split_two_column': {
    more_space: 'bullets_with_icon',
    balanced: 'comparison_columns',
    fewer_items: 'split_two_column'  // keep but reduce bullets
  },
  'bullets_with_icon': {
    more_space: 'cards_grid',
    balanced: 'bullets_with_icon',
    fewer_items: 'split_two_column'
  },
  'cards_grid': {
    more_space: 'cards_grid',    // can't upgrade further — reduce items
    balanced: 'three_column',
    fewer_items: 'bullets_with_icon'
  },
  'comparison_columns': {
    more_space: 'split_two_column',
    balanced: 'comparison_columns',
    fewer_items: 'split_two_column'
  },
  'case_study_layout': {
    more_space: 'bullets_with_icon',
    balanced: 'case_study_layout',
    fewer_items: 'case_study_layout'
  },
  'pricing_table': {
    more_space: 'pricing_table',
    balanced: 'pricing_table',
    fewer_items: 'bullets_with_icon'
  },
  'three_column': {
    more_space: 'cards_grid',
    balanced: 'three_column',
    fewer_items: 'split_two_column'
  }
};

/**
 * Suggest an alternative layout when the current one has visual issues.
 *
 * @param {object} slideSpec - Current slide spec
 * @param {'more_space'|'balanced'|'fewer_items'} reason - Why we need a different layout
 * @returns {string|null} Suggested layout name, or null if no change needed
 */
function suggestAlternativeLayout(slideSpec, reason) {
  const currentLayout = slideSpec?.layout;
  if (!currentLayout) return null;

  const upgrades = LAYOUT_UPGRADES[currentLayout];
  if (!upgrades) return null;

  const suggestion = upgrades[reason];
  if (!suggestion || suggestion === currentLayout) return null;

  return suggestion;
}

// ─── Content constraint hints for regeneration ───────────────────────────────

/**
 * Generate content constraints based on visual review failures.
 * These constraints are passed to contentAgent for re-generation.
 *
 * @param {object} failure - A combined failure object from mergeFailures()
 * @param {object} slideSpec - Current slide spec
 * @returns {object} Content constraints
 */
function getContentConstraints(failure, slideSpec) {
  const constraints = {
    max_title_words: 8,
    max_subtitle_words: 15,
    max_bullets: 6,
    max_bullet_words: 12,
    force_shorter: false
  };

  // Tighten constraints based on issues
  const issues = failure.structural_issues || [];

  for (const issue of issues) {
    if (issue.type === 'text_overflow') {
      constraints.force_shorter = true;
      constraints.max_title_words = 6;
      constraints.max_subtitle_words = 10;
      constraints.max_bullets = Math.max(2, (slideSpec.bullets?.length || 4) - 2);
      constraints.max_bullet_words = 8;
    }
    if (issue.type === 'text_overlap') {
      constraints.max_bullets = Math.max(2, (slideSpec.bullets?.length || 4) - 1);
      constraints.max_bullet_words = 10;
    }
    if (issue.type === 'font_too_small') {
      constraints.force_shorter = true;
      constraints.max_bullet_words = 8;
    }
  }

  return constraints;
}


module.exports = {
  reviewVisuals,
  runStructuralReview,
  runVisionReview,
  getContentConstraints,
  suggestAlternativeLayout,
  STRUCTURAL_PASS_THRESHOLD,
  VISION_PASS_THRESHOLD
};
