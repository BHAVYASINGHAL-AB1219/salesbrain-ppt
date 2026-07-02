# SalesBrain PPT — Complete Project Guide

> An AI-powered system that generates professional sales presentation decks (.pptx) from a Sales Brain alignment payload. Multi-agent LLM pipeline with iterative review loops, dynamic font-fitting, and structural/visual quality checks.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [The Pipeline — Step by Step](#2-the-pipeline--step-by-step)
3. [File-by-File Reference](#3-file-by-file-reference)
4. [Configuration & Environment](#4-configuration--environment)
5. [Token Tracking & Cost](#5-token-tracking--cost)
6. [Key Design Decisions](#6-key-design-decisions)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              server.js (Express)                            │
│                          POST /build-deck  →  orchestrator                  │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │    orchestrator.js     │
                    │   (Phase 1: Planning)  │
                    │   LLM → deck plan JSON │
                    └───────────┬───────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                   ▼
    ┌─────────────────┐ ┌──────────────┐  ┌──────────────┐
    │ contentAgent.js │ │ designAgent  │  │  validator   │
    │  LLM → text     │ │ rules→layout │  │  sanitiser   │
    │  per slide      │ │ per slide    │  │  per slide   │
    └────────┬────────┘ └──────┬───────┘  └──────┬───────┘
             │                 │                  │
             └────────┬────────┘                  │
                      ▼                            │
              ┌──────────────┐                     │
              │  deckSpec    │◄────────────────────┘
              │ (merged)     │
              └──────┬───────┘
                     │
         ┌───────────▼───────────┐
         │   assembler_v2.js     │
         │  deckSpec → .pptx     │
         │  (pptxgenjs render)   │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐         ┌────────────────────┐
         │   reviewerAgent.js    │         │ visualReviewerAgent│
         │  Extract text → LLM   │         │  Python structural │
         │  scores content       │         │  + optional vision │
         └───────────┬───────────┘         └─────────┬──────────┘
                     │                               │
                     └───────────┬───────────────────┘
                                 │
                        ┌────────▼────────┐
                        │  Failing slides? │
                        │  → regenerate    │
                        │  (contentAgent)  │
                        └────────┬────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  Rebuild .pptx          │
                    │  Repeat up to           │
                    │  MAX_REVIEW_ITERATIONS  │
                    └────────────┬────────────┘
                                 │
                          ┌──────▼──────┐
                          │  Final .pptx │
                          │  → download  │
                          └─────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| LLM SDK | `@anthropic-ai/sdk` (Anthropic SDK, used as a generic OpenAI-compatible client) |
| LLM Proxy | LiteLLM (routes all model requests through a single endpoint) |
| LLM Model | `glm-5p2` via Fireworks AI (configurable via `.env`) |
| PPTX Generation | `pptxgenjs` (JavaScript library that creates .pptx files) |
| Slide Extraction | `python-pptx` (Python script extracts text from built .pptx) |
| Structural Review | Custom Python script (`scripts/structural_review.py`) |
| Frontend | Vanilla HTML/CSS/JS (single page in `public/`) |

---

## 2. The Pipeline — Step by Step

### Step 0: User Input (Frontend → Server)

The user submits a **Sales Brain payload** via `POST /build-deck`. This is a JSON object describing the client, our company, and the sales context:

```json
{
  "client": { "name": "Autodesk", "industry": "SaaS", "pain_points": ["manual processes", "slow reporting"] },
  "our_company": { "name": "Quarks", "products": ["Agentic AI", "AIOps"], "differentiators": ["17+ years", "Fortune 500 clients"] },
  "alignment_score": 87,
  "recommended_angle": "Cost reduction through automation",
  "deck_goal": "proposal"
}
```

Alternatively, the user can paste raw text and hit `POST /extract-payload`, which uses [`extractor.js`](src/extractor.js) to have the LLM extract a structured payload from unstructured text.

### Step 1: Planning (orchestrator.js)

[`orchestrator.js`](src/orchestrator.js) is the brain of the system. It:

1. **Matches capabilities** — calls [`capabilities.js`](src/capabilities.js) → `matchCapabilities()` to find the top 6 Quarks services that match the client's industry and pain points (keyword scoring + industry-practice boosting).

2. **Calls the LLM** — sends the payload + matched capabilities to the planning model with a massive system prompt that encodes:
   - A 7-stage **Sales Story Arc** (Hook → Why Now → Turning Point → Toolkit → Proof → Path Forward → Call)
   - **Layout selection rules** — the LLM picks a `layout` field for each slide from a list of valid options per slide type
   - **Theme selection decision tree** — picks a color theme based on industry → deck_goal → pain point keywords
   - **Slide type schema** — 15 slide types with specific content requirements
   - **JSON output rules** — must wrap in ```` ```json ```` fences, no chain-of-thought

3. **Parses the response** — uses [`llmUtils.js`](src/utils/llmUtils.js) → `parseLLMResponse()` which has a 5-step repair pipeline:
   - Strip chain-of-thought reasoning before JSON
   - Extract from markdown fences
   - Direct `JSON.parse()`
   - Repair trailing commas / control characters
   - Repair truncated JSON (close open brackets if LLM hit max_tokens)

4. **Retries on failure** — 3 attempts with exponential backoff. If all 3 fail, falls back to `buildFallbackPlan()` — a hardcoded 10-slide deck plan that follows the story arc.

5. **Validates slide count** — trims to 16 max, warns if under 10.

6. **Returns a deck plan** — JSON with `deck_thesis`, `narrative_summary`, `slides[]` (each with `slide_type`, `layout`, `purpose`, `content_brief`, etc.), `theme_choice`, `deck_title`.

### Step 2: Content + Design Generation (parallel, per slide)

For each slide in the plan, two agents run in parallel (batched 3 at a time):

#### contentAgent.js → `generate()`
- Receives the slide plan + narrative context (what came before, what comes next)
- Calls the LLM with a system prompt encoding:
  - Story-driven writing principles (client = hero, pain = villain, us = guide)
  - **Character budgets** — strict max lengths for titles (60 chars), subtitles (120 chars), bullets (100 chars each), etc.
  - **Layout-specific content rules** — e.g. `comparison_columns` needs even bullets split into pain/solution halves; `three_column` needs exactly 3 bullets in "Header: point1 | point2 | point3" format
  - **Slide-type specific rules** — e.g. CTA must be a powerful closing, cover must frame a partnership
- Returns: `{ title, subtitle, bullets, speaker_notes, stat_callout, chart_data, stats_strip }`

#### designAgent.js → `assign()`
- **No LLM call** — pure rule-based, deterministic
- Validates the orchestrator's layout choice against `LAYOUT_OPTIONS[slide_type]` (falls back to default if invalid)
- Looks up the color theme from `COLOR_THEMES` (8 themes with primary/secondary/accent colors, fonts, background)
- Determines dark vs light slide master
- Returns: `{ layout, theme, is_dark_slide, slide_number, total_slides, slide_type }`

#### validator.js → `validate()`
- **No LLM call** — sanitises the merged slide spec
- Guards against absurdly long titles (moves overflow to subtitle at 80 chars)
- Limits bullet **count** (not text length) per slide type — e.g. services_grid max 12, engagement_models max 3
- Validates `stat_callout` structure (nulls out if missing number or label)
- Does NOT truncate text — the font-fit engine handles that at render time

### Step 3: Assembly (assembler_v2.js → `build()`)

[`assembler_v2.js`](src/assembler_v2.js) takes the merged `deckSpec` and renders a .pptx file using `pptxgenjs`:

1. **Sets up the presentation** — 16:9 layout (or custom Quarks 10×5.625), loads theme + brand.json (logo)
2. **Defines slide masters** — `DARK_MASTER` and `LIGHT_MASTER` with background colors, decorative shapes, logo placement
3. **Renders each slide** — looks up the renderer function from `LAYOUT_MAP`:

   | Layout Key | Renderer Function | What It Draws |
   |-----------|-------------------|---------------|
   | `cover_layout` | `renderCover()` | Dark slide with title, subtitle, stats strip, "Prepared for" badge |
   | `section_header_dark` | `renderSectionHeader()` | Large slide number, section title, decorative lines |
   | `bullets_with_icon` | `renderBulletsWithIcons()` | Title, subtitle, vertical bullet list with icon shapes |
   | `agenda` | `renderAgenda()` | Numbered list with circle badges, two-column layout |
   | `split_two_column` | `renderSplitTwoCol()` | Bullets on left, large stat callout on right |
   | `comparison_columns` | `renderComparison()` | Two labeled columns: "Current Situation" vs "With Our Solution" |
   | `data_callout_chart` | `renderDataChart()` | Title, stat callout, embedded chart (bar/line/pie) |
   | `case_study_layout` | `renderCaseStudy()` | Quote subtitle, result bullets with colored bars, stat callout |
   | `cards_grid` | `renderCardsGrid()` | Grid of cards with icon, title, description |
   | `pricing_table` | `renderPricing()` | Table with tier rows, stat callout |
   | `cta_dark` | `renderCTA()` | Dark slide with CTA title, subtitle, two action buttons |
   | `three_column` | `renderThreeColumn()` | Three columns with colored headers and bullet items |
   | `client_logos` | `renderClientLogos()` | Grid of client name badges |

4. **Dynamic font fitting** — every text box uses [`fontFit.js`](src/utils/fontFit.js) to calculate the optimal font size:
   - Estimates how many lines text will wrap to at a given font size (using per-font character-width ratios)
   - Estimates the rendered height of those lines
   - Binary-searches the largest font size where estimated height ≤ box height
   - Ensures text never overflows or overlaps

5. **Writes the .pptx** file to disk

### Step 4: Review Loop (server.js)

The server runs up to `MAX_REVIEW_ITERATIONS` (default 2) review cycles:

#### 4a: Content Review (reviewerAgent.js)
- **Extracts** text from the built .pptx using `python-pptx` (`scripts/extract_slides.py`)
- **Sends** the extracted text + original payload to the LLM
- LLM **scores** each slide on 4 criteria (1-10): Relevance, Specificity, Clarity, Completeness
- Slides with average score < 7/10 **fail** and get specific feedback
- Output-saving rule: passing slides get minimal JSON, failing slides get full detail

#### 4b: Visual/Structural Review (visualReviewerAgent.js)
Two layers:

**Layer 1 — Structural Review** (always runs):
- Python script [`scripts/structural_review.py`](scripts/structural_review.py) analyses the .pptx geometry:
  - Text overflow (horizontal + vertical)
  - Out-of-bounds shapes
  - Font size checks (too small?)
  - Empty text boxes
  - Shape overlaps
  - Layout zone violations
  - Whitespace balance
  - Color contrast (WCAG)
  - Duplicate text detection
  - Image aspect ratio
  - Spacing consistency
  - Font count per slide

**Layer 2 — Vision Review** (optional, disabled by default):
- Converts slides to PNG images using LibreOffice
- Sends each image to a vision-capable LLM
- Scores: Layout Balance, Text Readability, Visual Hierarchy, Alignment, Professional Feel

#### 4c: Merge Failures & Regenerate
- Combines content failures + visual failures into a unified set
- For each failing slide:
  - Builds combined feedback string (content issues + visual issues + constraints)
  - May suggest a **layout switch** (e.g. `split_two_column` → `bullets_with_icon` if text overflows)
  - Calls `contentAgent.generate()` again with the feedback as `reviewFeedback`
  - Re-validates with `validator.validate()`
- Rebuilds the .pptx and repeats

### Step 5: Output

- Final .pptx is saved to `./output/deck-{jobId}-iter{N}.pptx`
- Server returns `{ success: true, downloadUrl: "/download/{filename}" }`
- File auto-deletes after 5 minutes
- Token usage summary logged to console (both summary + detailed per-call breakdown)

---

## 3. File-by-File Reference

### Core Pipeline

| File | Role | LLM Calls? |
|------|------|-----------|
| [`server.js`](src/server.js) | Express server, HTTP endpoints, orchestrates the review loop | No |
| [`orchestrator.js`](src/orchestrator.js) | Plans the deck structure (slide types, layouts, narrative arc) | Yes (planning) |
| [`contentAgent.js`](src/contentAgent.js) | Generates text content for each slide (titles, bullets, stats) | Yes (per slide) |
| [`designAgent.js`](src/designAgent.js) | Assigns layout + color theme to each slide (rule-based) | No |
| [`assembler_v2.js`](src/assembler_v2.js) | Renders the .pptx file using pptxgenjs (13 layout renderers) | No |
| [`validator.js`](src/validator.js) | Sanitises slide specs (title length, bullet count, stat callout) | No |

### Review Agents

| File | Role | LLM Calls? |
|------|------|-----------|
| [`reviewerAgent.js`](src/reviewerAgent.js) | Content quality review (relevance, specificity, clarity, completeness) | Yes (review) |
| [`visualReviewerAgent.js`](src/visualReviewerAgent.js) | Structural geometry review (Python) + optional vision review (LLM) | Optional (vision) |

### Utilities

| File | Role |
|------|------|
| [`utils/llmUtils.js`](src/utils/llmUtils.js) | `parseLLMResponse()` — 5-step JSON extraction + repair pipeline |
| [`utils/tokenTracker.js`](src/utils/tokenTracker.js) | Per-call token tracking, cost calculation, detailed logging |
| [`utils/fontFit.js`](src/utils/fontFit.js) | Dynamic font-size calculation (binary search to fit text in boxes) |
| [`capabilities.js`](src/capabilities.js) | 20 Quarks capabilities with keyword matching to client context |
| [`extractor.js`](src/extractor.js) | LLM-based extraction of structured payload from raw text |

### Python Scripts

| File | Role |
|------|------|
| [`scripts/extract_slides.py`](scripts/extract_slides.py) | Extracts text content from a .pptx file using python-pptx |
| [`scripts/slide_to_images.py`](scripts/slide_to_images.py) | Converts .pptx slides to PNG images using LibreOffice |
| [`scripts/structural_review.py`](scripts/structural_review.py) | 15-check structural review of .pptx geometry (overflow, contrast, etc.) |

### Configuration

| File | Role |
|------|------|
| [`.env`](.env) | Environment variables (model names, API keys, feature flags) |
| [`litellm_config.yaml`](litellm_config.yaml) | LiteLLM proxy config (model routing, API keys) |
| [`templates/brand.json`](templates/brand.json) | Brand config (default theme, logo path) |
| [`start-litellm.sh`](start-litellm.sh) | Shell script to start the LiteLLM proxy |

### Frontend

| File | Role |
|------|------|
| [`public/index.html`](public/index.html) | Single-page UI for building decks |
| [`public/app.js`](public/app.js) | Frontend JavaScript (form submission, download handling) |
| [`public/index.css`](public/index.css) | Styling |

---

## 4. Configuration & Environment

### .env Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LITELLM_API_KEY` | — | API key for the LiteLLM proxy |
| `LITELLM_BASE_URL` | `http://localhost:4000` | LiteLLM proxy endpoint |
| `PLANNING_MODEL` | `CONTENT_MODEL` | Model for orchestrator planning |
| `CONTENT_MODEL` | `kimi-k2p6` | Model for content generation |
| `REVIEWER_MODEL` | `CONTENT_MODEL` | Model for content review |
| `VISION_MODEL` | `CONTENT_MODEL` | Model for vision review |
| `EXTRACTOR_MODEL` | `CONTENT_MODEL` | Model for payload extraction |
| `MAX_REVIEW_ITERATIONS` | `2` | How many review→regenerate cycles |
| `VISUAL_REVIEW_ENABLED` | `false` | Enable LLM vision review (needs vision-capable model) |
| `STRUCTURAL_REVIEW_ENABLED` | `true` | Enable Python structural review |
| `RATE_LIMIT_DELAY_MS` | `0` | Delay between LLM calls (0 = parallel batching) |
| `OUTPUT_DIR` | `./output` | Where .pptx files are saved |
| `PORT` | `3001` | Express server port |

### LiteLLM Proxy

All LLM calls go through LiteLLM (running on port 4000). The proxy routes model names to actual providers:

```yaml
# litellm_config.yaml (simplified)
model_list:
  - model_name: glm-5p2
    litellm_params:
      model: fireworks_ai/accounts/fireworks/models/glm-5p2
      api_key: "fw-..."
  - model_name: gpt-5
    litellm_params:
      model: openai/gpt-5
      api_key: "sk-..."
```

The Anthropic SDK is used as a generic client — it sends requests to LiteLLM which forwards to the actual provider (Fireworks AI, OpenAI, etc.).

---

## 5. Token Tracking & Cost

### How It Works

Every LLM call in the pipeline calls `tokenTracker.record()` with:
- **Phase**: `planning` | `content_generation` | `regeneration` | `content_review` | `visual_review` | `extraction`
- **Model**: The model name used
- **Usage**: The raw `response.usage` object (includes `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`)
- **Label**: Human-readable context (e.g. "slide 3", "deck plan")

### What Gets Logged

At the end of each deck generation, two summaries are printed:

1. **`getSummary()`** — Aggregated totals by phase and model
2. **`getDetailedSummary()`** — Three sections:
   - **Per-call table**: Every LLM call with caller file:line, model, label, input/output tokens, cost
   - **Raw usage breakdown**: Cache read/create tokens per call (detects if prompt caching is active)
   - **Per-function cost breakdown**: Total cost per phase

### Pricing (tokenTracker.js PRICE_TABLE)

| Model | Input ($/M) | Cached Input ($/M) | Output ($/M) |
|-------|------------|-------------------|-------------|
| glm-5p2 | $1.40 | $0.14 | $4.40 |
| gpt-5 | $1.25 | $0.125 | $10.00 |
| gpt-4o | $2.50 | $0.25 | $10.00 |
| claude-sonnet-4 | $3.00 | $0.30 | $15.00 |
| kimi-k2p6 | $0.60 | $0.06 | $2.50 |

### Prompt Caching

All LLM calls now use `cache_control: { type: 'ephemeral' }` on the system prompt. This means:
- The **first call** creates the cache (charged at full input rate)
- **Subsequent calls** with the same system prompt read from cache (charged at 10% of input rate)
- Biggest savings: 13 content generation calls share the same ~1,500-token system prompt

### Estimated Cost Per Deck (glm-5p2)

| Phase | Calls | Est. Cost |
|-------|-------|-----------|
| Planning | 1 | ~$0.06 |
| Content generation | 13 | ~$0.16 |
| Regeneration | 0-2 | ~$0.03 |
| Content review | 1-2 | ~$0.05 |
| **Total** | **~18** | **~$0.29** |

---

## 6. Key Design Decisions

### LLM-Driven Layout Variety (Option C)
The orchestrator LLM picks from multiple valid layouts per slide type (e.g. `problem` can be `split_two_column`, `comparison_columns`, or `bullets_with_icon`). This prevents every deck from looking identical. The design agent validates the choice and falls back to the default if invalid.

### Dynamic Font Fitting (fontFit.js)
Instead of truncating text with "…" (which loses content), the system calculates the optimal font size to fit all text within each box. This uses per-font character-width ratios and binary search. Minimum font sizes are enforced (8pt body, 12pt title) to maintain readability.

### 5-Step JSON Repair Pipeline (llmUtils.js)
LLMs sometimes produce broken JSON — chain-of-thought reasoning before the JSON, truncated output (hitting max_tokens), trailing commas, or control characters. The parser handles all of these:
1. Strip chain-of-thought (find first ```` ```json ```` or `{`)
2. Extract from markdown fences
3. Direct `JSON.parse()`
4. Repair trailing commas + control characters
5. Repair truncated JSON (count open brackets/braces and close them)

### Fallback Deck Plan
If all 3 orchestrator planning attempts fail, a hardcoded 10-slide deck plan is used instead of crashing. It follows the full story arc and uses the client name + matched capabilities, so the deck is still tailored — just less nuanced.

### Iterative Review Loop
The system doesn't just generate once — it builds, reviews, and regenerates failing slides up to `MAX_REVIEW_ITERATIONS` times. Content review catches generic text and fabricated stats. Structural review catches overflow, overlaps, and contrast issues. Visual review (optional) catches design problems using vision AI.

### Batched Parallel Generation
Content + design for multiple slides run in parallel (batch of 3) to speed up generation. If `RATE_LIMIT_DELAY_MS` is set, it switches to sequential with delays to respect API rate limits.

### Narrative Context
Each slide receives context about what came before and what comes next (`buildNarrativeContext()`). This ensures the deck reads as a coherent story, not disconnected slides. The content agent knows the deck thesis, the current story stage, and the previous/next slide purposes.
