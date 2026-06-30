require('dotenv').config({ override: true });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const orchestrator = require('./orchestrator');
const assembler = require('./assembler_v2');
const extractor = require('./extractor');
const reviewerAgent = require('./reviewerAgent');
const visualReviewerAgent = require('./visualReviewerAgent');
const contentAgent = require('./contentAgent');
const designAgent = require('./designAgent');
const validator = require('./validator');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../public')));

// Ensure output dir exists
const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

/**
 * POST /build-deck
 *
 * Body (Sales Brain payload):
 * {
 *   client: { name, industry, pain_points[], size, budget_range },
 *   our_company: { products[], differentiators[], case_studies[], tagline },
 *   alignment_score: 87,
 *   recommended_angle: "Cost reduction through automation",
 *   deck_goal: "discovery_call" | "follow_up" | "proposal" | "demo"
 * }
 *
 * Returns: .pptx file download
 */
app.post('/build-deck', async (req, res) => {
  const jobId = uuidv4().slice(0, 8);
  const payload = req.body;
  const MAX_REVIEW_ITERATIONS = parseInt(process.env.MAX_REVIEW_ITERATIONS || '2');

  console.log(`[${jobId}] Build started — ${payload.client?.name} / ${payload.deck_goal}`);

  try {
    // Step 1: Orchestrator decides structure + content
    const deckSpec = await orchestrator.run(payload, jobId);

    // Step 2: Review loop — build, extract, review (content + visual), refine
    let finalPath = null;
    let reviewPassed = false;

    for (let iteration = 0; iteration <= MAX_REVIEW_ITERATIONS; iteration++) {
      const iterPath = path.join(OUTPUT_DIR, `deck-${jobId}-iter${iteration}.pptx`);

      // 2a: Build the .pptx
      console.log(`[${jobId}] Building .pptx (iteration ${iteration + 1})...`);
      await assembler.build(deckSpec, iterPath);
      finalPath = iterPath;

      // Skip review on last iteration (just use whatever we have)
      if (iteration === MAX_REVIEW_ITERATIONS) {
        console.log(`[${jobId}] Max review iterations reached — using current build.`);
        break;
      }

      // 2b: Extract slide content from the built .pptx via python-pptx
      console.log(`[${jobId}] Extracting slide content via python-pptx...`);
      let extractedData;
      try {
        extractedData = reviewerAgent.extractSlidesFromPptx(iterPath);
      } catch (extractErr) {
        console.error(`[${jobId}] Extraction failed, skipping review:`, extractErr.message);
        break;
      }

      // 2c: Content review (existing — text quality, relevance, specificity)
      console.log(`[${jobId}] Reviewer agent scoring content...`);
      let contentReview;
      try {
        contentReview = await reviewerAgent.review(extractedData, payload, deckSpec.slides);
      } catch (reviewErr) {
        console.error(`[${jobId}] Content review failed, skipping:`, reviewErr.message);
        break;
      }

      const contentPassedCount = contentReview.passed_count || 0;
      const contentFailedCount = contentReview.failed_count || 0;
      const contentScore = (contentReview.overall_score || 0).toFixed(1);

      console.log(`[${jobId}] Content review: ${contentScore}/10 — ${contentPassedCount} passed, ${contentFailedCount} failed`);

      if (contentReview.deck_narrative_feedback) {
        console.log(`[${jobId}] Narrative feedback: ${contentReview.deck_narrative_feedback}`);
      }

      // 2d: Visual/structural review (NEW — layout quality, geometry checks)
      console.log(`[${jobId}] Running visual/structural review...`);
      let visualReview;
      try {
        visualReview = await visualReviewerAgent.reviewVisuals(iterPath, deckSpec.slides);
      } catch (visualErr) {
        console.error(`[${jobId}] Visual review failed, skipping:`, visualErr.message);
        visualReview = { has_failures: false, combined_failures: [] };
      }

      if (visualReview.structural) {
        console.log(`[${jobId}] Structural: ${visualReview.structural.overall_structural_score}/10 — ${visualReview.structural.total_errors} errors, ${visualReview.structural.total_warnings} warnings`);
      }

      // 2e: Merge content + visual failures
      const contentFailingSlides = (contentReview.reviews || []).filter(r => !r.pass);
      const contentFailingIndices = new Set(contentFailingSlides.map(r => r.slide_index));
      const visualFailingIndices = new Set(visualReview.combined_failures.map(f => f.slide_index));

      // Unified set of all failing slide indices
      const allFailingIndices = new Set([...contentFailingIndices, ...visualFailingIndices]);

      if (allFailingIndices.size === 0) {
        console.log(`[${jobId}] ✅ All slides passed both content and visual review!`);
        reviewPassed = true;
        break;
      }

      console.log(`[${jobId}] Failing slides: content=${[...contentFailingIndices].join(',') || 'none'}, visual=${[...visualFailingIndices].join(',') || 'none'}`);

      // 2f: Re-generate failing slides (content + optional layout switch)
      console.log(`[${jobId}] Re-generating ${allFailingIndices.size} failing slides...`);

      // Build narrative context from deckSpec so regenerated slides stay
      // coherent with the overall story arc (same logic as orchestrator).
      const buildRegenNarrativeContext = (slideIndex) => {
        const slides = deckSpec.slides;
        const current = slides[slideIndex];
        const prev = slideIndex > 0 ? slides[slideIndex - 1] : null;
        const next = slideIndex < slides.length - 1 ? slides[slideIndex + 1] : null;
        return {
          deck_thesis: deckSpec.deck_thesis || '',
          narrative_summary: deckSpec.narrative_summary || '',
          current_stage: current?.narrative_stage || '',
          current_purpose: current?.purpose || '',
          transition_hint: current?.transition_hint || '',
          prev_purpose: prev?.purpose || null,
          prev_type: prev?.slide_type || null,
          next_purpose: next?.purpose || null,
          next_type: next?.slide_type || null,
          slide_position: `${slideIndex + 1} of ${slides.length}`,
        };
      };

      const regenPromiseFn = async (idx) => {
        if (idx < 0 || idx >= deckSpec.slides.length) return;

        const slidePlan = deckSpec.slides[idx];
        const feedbackParts = [];

        // Content feedback
        const contentFail = contentFailingSlides.find(r => r.slide_index === idx);
        if (contentFail) {
          feedbackParts.push(`CONTENT: Score ${contentFail.average_score}/10. Issues: ${(contentFail.issues || []).join(', ')}. ${contentFail.feedback || ''}`);
        }

        // Visual feedback
        const visualFail = visualReview.combined_failures.find(f => f.slide_index === idx);
        if (visualFail) {
          feedbackParts.push(`VISUAL: ${visualFail.combined_feedback}`);

          // Apply layout switch if suggested
          if (visualFail.layout_suggestion) {
            const oldLayout = slidePlan.layout;
            const newLayout = visualFail.layout_suggestion;
            console.log(`[${jobId}]   → Slide ${idx + 1}: switching layout ${oldLayout} → ${newLayout}`);
            slidePlan.layout = newLayout;

            // Update dark/light based on new layout
            const darkLayouts = new Set(['cover_layout', 'section_header_dark', 'cta_dark']);
            slidePlan.is_dark_slide = darkLayouts.has(newLayout);
          }

          // Apply content constraints
          const constraints = visualReviewerAgent.getContentConstraints(visualFail, slidePlan);
          if (constraints.force_shorter) {
            feedbackParts.push(`CONSTRAINTS: Max ${constraints.max_title_words} words for title, max ${constraints.max_bullets} bullets, max ${constraints.max_bullet_words} words per bullet.`);
          }
        }

        const feedback = feedbackParts.join(' | ');

        try {
          const regenNarrativeContext = buildRegenNarrativeContext(idx);
          const newContent = await contentAgent.generate(slidePlan, payload, idx, feedback, regenNarrativeContext);
          // Merge new content into the existing slide spec (preserve layout/design fields)
          const designFields = {
            layout: slidePlan.layout,
            theme: slidePlan.theme,
            is_dark_slide: slidePlan.is_dark_slide,
            slide_number: slidePlan.slide_number,
            total_slides: slidePlan.total_slides,
            slide_type: slidePlan.slide_type
          };
          Object.assign(deckSpec.slides[idx], newContent, designFields);
          deckSpec.slides[idx] = validator.validate(deckSpec.slides[idx]);
          console.log(`[${jobId}]   → Slide ${idx + 1} regenerated`);
        } catch (regenErr) {
          console.error(`[${jobId}]   → Slide ${idx + 1} regen failed:`, regenErr.message);
        }
      };

      const delayMs = parseInt(process.env.RATE_LIMIT_DELAY_MS || '0', 10);
      const indicesToRegen = Array.from(allFailingIndices);
      
      if (delayMs > 0) {
        // Sequential with delay to avoid rate limits
        for (let i = 0; i < indicesToRegen.length; i++) {
          const idx = indicesToRegen[i];
          await regenPromiseFn(idx);
          if (i < indicesToRegen.length - 1) {
            console.log(`[${jobId}] Sleeping for ${delayMs}ms between regenerations...`);
            await new Promise(r => setTimeout(r, delayMs));
          }
        }
      } else {
        // Parallel as before
        await Promise.all(indicesToRegen.map(idx => regenPromiseFn(idx)));
      }

      // Clean up the iteration file (we'll build a new one)
      fs.unlink(iterPath, () => { });
    }

    console.log(`[${jobId}] Done → ${finalPath} (review ${reviewPassed ? 'PASSED' : 'used best effort'})`);

    const filename = path.basename(finalPath);
    res.json({ success: true, downloadUrl: `/download/${filename}` });

    // Clean up all iteration files EXCEPT the final one immediately
    for (let i = 0; i <= MAX_REVIEW_ITERATIONS; i++) {
      const p = path.join(OUTPUT_DIR, `deck-${jobId}-iter${i}.pptx`);
      if (p !== finalPath) {
        fs.unlink(p, () => { });
      }
    }

    // Clean up the final file after 5 minutes
    setTimeout(() => {
      fs.unlink(finalPath, () => { });
    }, 5 * 60 * 1000);

  } catch (err) {
    console.error(`[${jobId}] Error:`, err);
    res.status(500).json({ error: err.message, jobId });
  }
});

app.get('/download/:filename', (req, res) => {
  const file = path.join(OUTPUT_DIR, req.params.filename);
  if (!fs.existsSync(file)) {
    return res.status(404).send('File not found or expired.');
  }
  res.download(file, req.params.filename);
});

app.post('/extract-payload', async (req, res) => {
  try {
    const rawText = req.body.text;
    if (!rawText) return res.status(400).json({ error: 'Text is required' });

    console.log('Extracting payload from raw text...');
    const extractedData = await extractor.extract(rawText);
    res.json(extractedData);
  } catch (err) {
    console.error('Extraction error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => console.log(`Sales Brain PPT Builder running on port ${PORT}`));

// Graceful shutdown for nodemon to prevent EADDRINUSE errors
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

process.on('SIGUSR2', () => {
  server.close(() => {
    process.kill(process.pid, 'SIGUSR2');
  });
});
