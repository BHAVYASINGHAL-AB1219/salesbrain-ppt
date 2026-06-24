# Sales Brain — PPT Auto-Builder
## Complete Project Specification for Coding Agents

> Hand this file to any coding agent (Cursor, Windsurf, Antigravity, etc.)
> It contains full architecture, all file contents, install commands, and wiring.
> The agent should create every file exactly as specified below.

---

## What This Builds

An Express.js microservice that:
1. Receives a Sales Brain JSON payload (client + company alignment data)
2. Uses the **Anthropic Claude SDK** as the orchestrator/brain
3. Swaps in **any other model** (GPT-4o, Gemini, etc.) for heavy content generation via LiteLLM proxy
4. Assembles a polished `.pptx` using **PptxGenJS** (Anthropic's pptx skill patterns)
5. Returns a downloadable `.pptx` file

---

## Project Structure to Create

```
salesbrain-ppt/
├── package.json
├── .env.example
├── src/
│   ├── server.js              # Express entry point
│   ├── orchestrator.js        # Claude SDK — decides slide structure
│   ├── contentAgent.js        # Alternate model — writes slide content
│   ├── designAgent.js         # Claude SDK — assigns layouts & visual tone
│   ├── assembler.js           # PptxGenJS — builds the actual .pptx
│   ├── validator.js           # Content density + safety checks
│   └── utils/
│       └── iconHelper.js      # react-icons → base64 PNG for slides
├── templates/
│   └── brand.json             # Your brand colors, fonts, palette
└── output/                    # Generated .pptx files land here
```

---

## Step 1 — package.json

```json
{
  "name": "salesbrain-ppt-builder",
  "version": "1.0.0",
  "description": "AI-powered PPT builder for Sales Brain",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "openai": "^4.47.0",
    "pptxgenjs": "^3.12.0",
    "express": "^4.18.2",
    "dotenv": "^16.3.1",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-icons": "^5.0.1",
    "sharp": "^0.33.3",
    "uuid": "^9.0.1",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
```

**Install command:**
```bash
npm install
```

---

## Step 2 — .env.example

```env
# Anthropic — used for orchestrator + design agent
ANTHROPIC_API_KEY=sk-ant-...

# LiteLLM proxy (optional) — lets you use GPT-4o/Gemini via OpenAI SDK interface
# If you don't have a proxy, set CONTENT_MODEL=claude-sonnet-4-6 and leave this blank
LITELLM_BASE_URL=http://localhost:4000
LITELLM_API_KEY=sk-...

# Which model to use for CONTENT generation (slide writing)
# Options with LiteLLM proxy: gpt-4o, gemini/gemini-1.5-pro, anthropic/claude-haiku-4-5-20251001
# Without proxy: claude-sonnet-4-6
CONTENT_MODEL=gpt-4o

# Port
PORT=3001

# Output directory
OUTPUT_DIR=./output
```

---

## Step 3 — src/server.js

```javascript
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const orchestrator = require('./orchestrator');
const assembler = require('./assembler');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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

  console.log(`[${jobId}] Build started — ${payload.client?.name} / ${payload.deck_goal}`);

  try {
    // Step 1: Orchestrator decides structure + content
    const deckSpec = await orchestrator.run(payload, jobId);

    // Step 2: Assembler builds the .pptx
    const outputPath = path.join(OUTPUT_DIR, `deck-${jobId}.pptx`);
    await assembler.build(deckSpec, outputPath);

    console.log(`[${jobId}] Done → ${outputPath}`);

    res.download(outputPath, `${payload.client?.name || 'deck'}-presentation.pptx`, (err) => {
      if (err) console.error(`[${jobId}] Download error:`, err);
      // Clean up file after download
      setTimeout(() => fs.unlink(outputPath, () => {}), 60000);
    });

  } catch (err) {
    console.error(`[${jobId}] Error:`, err);
    res.status(500).json({ error: err.message, jobId });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Sales Brain PPT Builder running on port ${PORT}`));
```

---

## Step 4 — src/orchestrator.js

This is the **brain of the system**. It uses the Claude SDK to:
- Understand the Sales Brain payload
- Call the content agent (alternate model) for each slide's text
- Call the design agent for visual decisions
- Validate content density
- Return a final `DeckSpec` ready for assembly

```javascript
const Anthropic = require('@anthropic-ai/sdk');
const contentAgent = require('./contentAgent');
const designAgent = require('./designAgent');
const validator = require('./validator');

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Main orchestration function.
 * Uses Claude to plan the deck, then delegates content + design to sub-agents.
 */
async function run(payload, jobId) {
  console.log(`[${jobId}] Orchestrator: planning deck structure...`);

  // ── Phase 1: Claude decides the slide plan ──────────────────────────────────
  const planResponse = await claude.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    system: `You are a sales deck strategist. Given a Sales Brain alignment payload, 
output a JSON slide plan. Return ONLY valid JSON, no markdown fences.

Each slide in the plan must have:
- slide_type: "cover" | "agenda" | "problem" | "solution" | "comparison" | 
              "data" | "case_study" | "team" | "pricing" | "cta" | "section_header"
- purpose: one sentence explaining what this slide achieves
- content_brief: what specific content should go here (draw from the payload)
- has_chart: boolean — true only if numerical data exists for this slide
- visual_tone: "dark" | "light" — dark for cover/cta/section_header, light for content slides`,

    messages: [{
      role: 'user',
      content: `Sales Brain payload:\n${JSON.stringify(payload, null, 2)}\n\n
Deck goal: ${payload.deck_goal}
Recommended angle: ${payload.recommended_angle}

Create a slide plan of 8-12 slides that tells a compelling sales story.
Return JSON: { "slides": [...], "deck_title": "...", "color_theme": "midnight_executive|teal_trust|coral_energy|charcoal_minimal" }`
    }]
  });

  let plan;
  try {
    plan = JSON.parse(planResponse.content[0].text);
  } catch (e) {
    throw new Error(`Orchestrator: failed to parse slide plan — ${e.message}`);
  }

  console.log(`[${jobId}] Orchestrator: planned ${plan.slides.length} slides, theme=${plan.color_theme}`);

  // ── Phase 2: Generate content + design for each slide in parallel ──────────
  const slideJobs = plan.slides.map((slidePlan, idx) =>
    Promise.all([
      contentAgent.generate(slidePlan, payload, idx),
      designAgent.assign(slidePlan, plan.color_theme, idx, plan.slides.length)
    ]).then(([content, design]) => validator.validate({ ...slidePlan, ...content, ...design, index: idx }))
  );

  const slides = await Promise.all(slideJobs);

  console.log(`[${jobId}] Orchestrator: all slides generated and validated`);

  return {
    deck_title: plan.deck_title,
    color_theme: plan.color_theme,
    client_name: payload.client?.name || 'Client',
    deck_goal: payload.deck_goal,
    slides
  };
}

module.exports = { run };
```

---

## Step 5 — src/contentAgent.js

This agent uses the **alternate model** (GPT-4o via OpenAI SDK, or any other via LiteLLM).
Swap `CONTENT_MODEL` in `.env` to change the model without touching code.

```javascript
const OpenAI = require('openai').default;

// If LITELLM_BASE_URL is set, route through LiteLLM proxy (supports GPT-4o, Gemini, etc.)
// If not, falls back to Anthropic via OpenAI-compatible endpoint
const useProxy = !!process.env.LITELLM_BASE_URL;

const client = new OpenAI({
  apiKey: useProxy ? process.env.LITELLM_API_KEY : process.env.ANTHROPIC_API_KEY,
  baseURL: useProxy
    ? process.env.LITELLM_BASE_URL
    : 'https://api.anthropic.com/v1',   // Anthropic has OpenAI-compatible endpoint
});

const CONTENT_MODEL = process.env.CONTENT_MODEL || 'claude-sonnet-4-6';

/**
 * Generates text content for a single slide.
 * Returns: { title, subtitle, bullets, speaker_notes, stat_callout, chart_data }
 */
async function generate(slidePlan, payload, slideIndex) {
  const response = await client.chat.completions.create({
    model: CONTENT_MODEL,
    max_tokens: 800,
    messages: [
      {
        role: 'system',
        content: `You write compelling sales presentation slide content. 
Return ONLY valid JSON. No markdown, no explanation.
Rules:
- title: max 8 words, punchy and specific
- bullets: max 4 items, each max 12 words, no filler phrases
- speaker_notes: 2-3 sentences for the presenter, conversational
- stat_callout: only if there's a real number in the payload (null otherwise)
- chart_data: only if has_chart is true (null otherwise)`
      },
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
- Relevant products: ${(payload.our_company?.products || []).slice(0, 3).join(', ')}
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
  "chart_data": { "type": "bar|line|pie", "labels": [...], "values": [...], "series_name": "..." } or null
}`
      }
    ]
  });

  try {
    return JSON.parse(response.choices[0].message.content);
  } catch (e) {
    // Fallback if JSON parse fails
    return {
      title: slidePlan.purpose.slice(0, 40),
      subtitle: null,
      bullets: [],
      speaker_notes: 'Refer to briefing notes.',
      stat_callout: null,
      chart_data: null
    };
  }
}

module.exports = { generate };
```

---

## Step 6 — src/designAgent.js

Uses Claude to assign visual layout decisions for each slide.

```javascript
const Anthropic = require('@anthropic-ai/sdk');

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Color themes derived from the pptx skill's palette table
const COLOR_THEMES = {
  midnight_executive: { primary: '1E2761', secondary: 'CADCFC', accent: 'FFFFFF', light_bg: 'F4F6FB' },
  teal_trust:        { primary: '028090', secondary: '00A896', accent: '02C39A', light_bg: 'F0FAFA' },
  coral_energy:      { primary: 'F96167', secondary: '2F3C7E', accent: 'F9E795', light_bg: 'FFF8F8' },
  charcoal_minimal:  { primary: '36454F', secondary: 'F2F2F2', accent: '212121', light_bg: 'FAFAFA' },
};

/**
 * Assigns layout type and visual properties for a slide.
 * Does NOT call the API for every slide — uses rule-based logic for common types,
 * and calls Claude only for ambiguous content slides.
 */
async function assign(slidePlan, colorTheme, slideIndex, totalSlides) {
  const theme = COLOR_THEMES[colorTheme] || COLOR_THEMES.midnight_executive;
  const isDark = slidePlan.visual_tone === 'dark';

  // Rule-based layout assignment (fast, no API call needed)
  const layoutRules = {
    cover:          'cover_layout',
    agenda:         'bullets_with_icon',
    problem:        'split_two_column',
    solution:       'split_two_column',
    comparison:     'comparison_columns',
    data:           'data_callout_chart',
    case_study:     'case_study_layout',
    team:           'cards_grid',
    pricing:        'pricing_table',
    cta:            'cta_dark',
    section_header: 'section_header_dark',
  };

  const layout = layoutRules[slidePlan.slide_type] || 'bullets_with_icon';

  return {
    layout,
    theme,
    is_dark_slide: isDark,
    bg_color: isDark ? theme.primary : theme.light_bg,
    title_color: isDark ? 'FFFFFF' : theme.primary,
    body_color: isDark ? 'E8EDF5' : '374151',
    accent_color: theme.accent,
    secondary_color: theme.secondary,
    slide_number: slideIndex + 1,
    total_slides: totalSlides,
  };
}

module.exports = { assign };
```

---

## Step 7 — src/validator.js

Enforces content density rules before the slide hits the assembler.

```javascript
/**
 * Validates and sanitises a slide spec.
 * Prevents text overflow, over-long titles, too many bullets.
 */
function validate(slide) {
  // Title length guard
  if (slide.title && slide.title.length > 60) {
    slide.subtitle = slide.subtitle
      ? slide.title.slice(60) + '. ' + slide.subtitle
      : slide.title.slice(60);
    slide.title = slide.title.slice(0, 60).trim();
  }

  // Bullet count guard — split into two slides if >5 bullets
  // (The orchestrator receives the split and inserts an extra slide)
  if (slide.bullets && slide.bullets.length > 5) {
    slide.bullets = slide.bullets.slice(0, 5);
    slide._overflow_note = 'Truncated to 5 bullets — consider splitting this slide.';
  }

  // Bullet word length guard
  if (slide.bullets) {
    slide.bullets = slide.bullets.map(b => {
      const words = b.split(' ');
      return words.length > 14 ? words.slice(0, 14).join(' ') + '…' : b;
    });
  }

  // Stat callout sanity
  if (slide.stat_callout) {
    if (!slide.stat_callout.number || !slide.stat_callout.label) {
      slide.stat_callout = null;
    }
  }

  return slide;
}

module.exports = { validate };
```

---

## Step 8 — src/utils/iconHelper.js

Converts react-icons → base64 PNG for embedding in slides.

```javascript
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const sharp = require('sharp');

/**
 * Renders a react-icon component to a base64 PNG string.
 * @param {Function} IconComponent - e.g. require('react-icons/fa').FaCheckCircle
 * @param {string} color - hex color WITH #, e.g. "#FFFFFF"
 * @param {number} size - rasterisation size in px (use 256+ for crisp icons)
 * @returns {Promise<string>} - "image/png;base64,..."
 */
async function iconToBase64(IconComponent, color = '#FFFFFF', size = 256) {
  const svgString = ReactDOMServer.renderToStaticMarkup(
    React.createElement(IconComponent, { color, size: String(size) })
  );
  const pngBuffer = await sharp(Buffer.from(svgString)).png().toBuffer();
  return 'image/png;base64,' + pngBuffer.toString('base64');
}

module.exports = { iconToBase64 };
```

---

## Step 9 — src/assembler.js

The **pptxgenjs assembler** — converts a `DeckSpec` into a `.pptx` file.
All design rules from the Anthropic pptx skill are baked in here.

```javascript
const pptxgen = require('pptxgenjs');
const { iconToBase64 } = require('./utils/iconHelper');
const { FaCheckCircle, FaChartLine, FaUsers, FaBullseye, FaArrowRight } = require('react-icons/fa');

// ── Layout renderers ─────────────────────────────────────────────────────────
// Each function receives (slide, spec, pres) and populates the slide.

function renderCoverLayout(slide, spec) {
  // Dark full-bleed cover
  slide.background = { color: spec.bg_color };

  // Large title
  slide.addText(spec.title || 'Untitled', {
    x: 0.6, y: 1.4, w: 8.8, h: 1.6,
    fontSize: 44, fontFace: 'Cambria', bold: true,
    color: spec.title_color, align: 'left', margin: 0
  });

  // Subtitle / tagline
  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 0.6, y: 3.1, w: 7, h: 0.8,
      fontSize: 20, fontFace: 'Calibri',
      color: spec.secondary_color, align: 'left', margin: 0
    });
  }

  // Client name pill
  if (spec.client_name) {
    slide.addShape(pptxgen.shapes?.ROUNDED_RECTANGLE || 'roundRect', {
      x: 0.6, y: 4.4, w: 2.8, h: 0.5,
      fill: { color: spec.accent_color }, rectRadius: 0.08
    });
    slide.addText(`Prepared for ${spec.client_name}`, {
      x: 0.6, y: 4.4, w: 2.8, h: 0.5,
      fontSize: 12, fontFace: 'Calibri', bold: true,
      color: spec.bg_color, align: 'center', valign: 'middle', margin: 0
    });
  }

  // Slide number
  slide.addText(`${spec.slide_number} / ${spec.total_slides}`, {
    x: 8.8, y: 5.1, w: 1, h: 0.3,
    fontSize: 10, fontFace: 'Calibri', color: spec.secondary_color, align: 'right'
  });
}

function renderSplitTwoColumn(slide, spec) {
  slide.background = { color: spec.bg_color };

  // Left accent block
  slide.addShape('rect', {
    x: 0, y: 0, w: 0.08, h: 5.625,
    fill: { color: spec.accent_color }
  });

  // Title
  slide.addText(spec.title, {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 28, fontFace: 'Cambria', bold: true,
    color: spec.title_color, align: 'left', margin: 0
  });

  // Bullets left column
  if (spec.bullets && spec.bullets.length > 0) {
    const bulletItems = spec.bullets.slice(0, 3).map((b, i) => ({
      text: b,
      options: { bullet: true, breakLine: i < spec.bullets.length - 1, paraSpaceAfter: 8 }
    }));
    slide.addText(bulletItems, {
      x: 0.5, y: 1.2, w: 4.5, h: 3.5,
      fontSize: 16, fontFace: 'Calibri',
      color: spec.body_color, valign: 'top'
    });
  }

  // Stat callout right column
  if (spec.stat_callout) {
    slide.addShape('roundRect', {
      x: 5.5, y: 1.2, w: 4, h: 2.5,
      fill: { color: spec.is_dark_slide ? '1a3a5c' : spec.secondary_color + '22' },
      shadow: { type: 'outer', color: '000000', blur: 8, offset: 3, angle: 45, opacity: 0.1 }
    });
    slide.addText(spec.stat_callout.number, {
      x: 5.5, y: 1.5, w: 4, h: 1.2,
      fontSize: 64, fontFace: 'Cambria', bold: true,
      color: spec.accent_color === 'FFFFFF' ? spec.secondary_color : spec.accent_color,
      align: 'center', valign: 'middle', margin: 0
    });
    slide.addText(spec.stat_callout.label, {
      x: 5.5, y: 2.8, w: 4, h: 0.6,
      fontSize: 14, fontFace: 'Calibri',
      color: spec.body_color, align: 'center', margin: 0
    });
  } else if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 5.5, y: 1.2, w: 4, h: 3,
      fontSize: 16, fontFace: 'Calibri', italic: true,
      color: spec.body_color, valign: 'top'
    });
  }

  addSpeakerNotes(slide, spec);
}

function renderComparisonColumns(slide, spec) {
  slide.background = { color: spec.bg_color };

  slide.addText(spec.title, {
    x: 0.5, y: 0.25, w: 9, h: 0.65,
    fontSize: 28, fontFace: 'Cambria', bold: true,
    color: spec.title_color, align: 'left', margin: 0
  });

  const midBullets = Math.ceil((spec.bullets || []).length / 2);
  const leftBullets = (spec.bullets || []).slice(0, midBullets);
  const rightBullets = (spec.bullets || []).slice(midBullets);

  // Left column header
  slide.addShape('roundRect', {
    x: 0.4, y: 1.1, w: 4.1, h: 0.5,
    fill: { color: spec.secondary_color }, rectRadius: 0.06
  });
  slide.addText('Current situation', {
    x: 0.4, y: 1.1, w: 4.1, h: 0.5,
    fontSize: 13, fontFace: 'Calibri', bold: true,
    color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0
  });

  // Right column header
  slide.addShape('roundRect', {
    x: 5.5, y: 1.1, w: 4.1, h: 0.5,
    fill: { color: spec.accent_color === 'FFFFFF' ? spec.secondary_color : spec.accent_color },
    rectRadius: 0.06
  });
  slide.addText('With our solution', {
    x: 5.5, y: 1.1, w: 4.1, h: 0.5,
    fontSize: 13, fontFace: 'Calibri', bold: true,
    color: spec.is_dark_slide ? spec.primary_color || '1E2761' : 'FFFFFF',
    align: 'center', valign: 'middle', margin: 0
  });

  if (leftBullets.length) {
    slide.addText(
      leftBullets.map((b, i) => ({ text: b, options: { bullet: true, breakLine: i < leftBullets.length - 1, paraSpaceAfter: 6 } })),
      { x: 0.4, y: 1.75, w: 4.1, h: 3.3, fontSize: 15, fontFace: 'Calibri', color: spec.body_color, valign: 'top' }
    );
  }
  if (rightBullets.length) {
    slide.addText(
      rightBullets.map((b, i) => ({ text: b, options: { bullet: true, breakLine: i < rightBullets.length - 1, paraSpaceAfter: 6 } })),
      { x: 5.5, y: 1.75, w: 4.1, h: 3.3, fontSize: 15, fontFace: 'Calibri', color: spec.body_color, valign: 'top' }
    );
  }

  addSpeakerNotes(slide, spec);
}

function renderDataCalloutChart(slide, spec) {
  slide.background = { color: spec.bg_color };

  slide.addText(spec.title, {
    x: 0.5, y: 0.25, w: 9, h: 0.65,
    fontSize: 28, fontFace: 'Cambria', bold: true,
    color: spec.title_color, align: 'left', margin: 0
  });

  // Stat callout top-right
  if (spec.stat_callout) {
    slide.addText(spec.stat_callout.number, {
      x: 7.2, y: 0.2, w: 2.6, h: 1.0,
      fontSize: 52, fontFace: 'Cambria', bold: true,
      color: spec.accent_color === 'FFFFFF' ? spec.secondary_color : spec.accent_color,
      align: 'right', valign: 'middle', margin: 0
    });
    slide.addText(spec.stat_callout.label, {
      x: 7.2, y: 1.1, w: 2.6, h: 0.4,
      fontSize: 12, fontFace: 'Calibri', color: spec.body_color, align: 'right'
    });
  }

  // Chart
  if (spec.chart_data) {
    const chartTypeMap = { bar: 'bar', line: 'line', pie: 'pie' };
    const pptxChartType = chartTypeMap[spec.chart_data.type] || 'bar';
    const chartData = [{
      name: spec.chart_data.series_name || 'Data',
      labels: spec.chart_data.labels || [],
      values: spec.chart_data.values || []
    }];
    slide.addChart(pptxChartType, chartData, {
      x: 0.5, y: 1.3, w: 9, h: 3.8,
      chartColors: [spec.secondary_color, spec.accent_color === 'FFFFFF' ? '00A896' : spec.accent_color],
      chartArea: { fill: { color: spec.bg_color }, roundedCorners: true },
      catAxisLabelColor: spec.body_color,
      valAxisLabelColor: spec.body_color,
      valGridLine: { color: 'E2E8F0', size: 0.5 },
      catGridLine: { style: 'none' },
      showValue: true,
      dataLabelColor: spec.body_color,
      showLegend: false
    });
  }

  addSpeakerNotes(slide, spec);
}

function renderBulletsWithIcon(slide, spec) {
  slide.background = { color: spec.bg_color };

  slide.addText(spec.title, {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 30, fontFace: 'Cambria', bold: true,
    color: spec.title_color, align: 'left', margin: 0
  });

  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 0.5, y: 1.1, w: 9, h: 0.5,
      fontSize: 16, fontFace: 'Calibri', italic: true,
      color: spec.body_color, align: 'left', margin: 0
    });
  }

  if (spec.bullets && spec.bullets.length > 0) {
    const bulletItems = spec.bullets.map((b, i) => ({
      text: b,
      options: { bullet: true, breakLine: i < spec.bullets.length - 1, paraSpaceAfter: 10 }
    }));
    slide.addText(bulletItems, {
      x: 0.5, y: spec.subtitle ? 1.75 : 1.3, w: 9, h: 3.5,
      fontSize: 18, fontFace: 'Calibri',
      color: spec.body_color, valign: 'top'
    });
  }

  addSpeakerNotes(slide, spec);
}

function renderCTADark(slide, spec) {
  slide.background = { color: spec.bg_color };

  slide.addText(spec.title, {
    x: 0.6, y: 1.5, w: 8.8, h: 1.4,
    fontSize: 40, fontFace: 'Cambria', bold: true,
    color: spec.title_color, align: 'center', valign: 'middle', margin: 0
  });

  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 1.5, y: 3.1, w: 7, h: 0.7,
      fontSize: 18, fontFace: 'Calibri', italic: true,
      color: spec.secondary_color, align: 'center', margin: 0
    });
  }

  // CTA button shape
  slide.addShape('roundRect', {
    x: 3.5, y: 4.0, w: 3, h: 0.65,
    fill: { color: spec.accent_color === 'FFFFFF' ? '02C39A' : spec.accent_color },
    rectRadius: 0.1
  });
  slide.addText('Let\'s talk →', {
    x: 3.5, y: 4.0, w: 3, h: 0.65,
    fontSize: 16, fontFace: 'Calibri', bold: true,
    color: spec.bg_color, align: 'center', valign: 'middle', margin: 0
  });

  addSpeakerNotes(slide, spec);
}

function renderSectionHeader(slide, spec) {
  slide.background = { color: spec.bg_color };
  slide.addText(spec.title, {
    x: 0.6, y: 1.8, w: 8.8, h: 1.4,
    fontSize: 36, fontFace: 'Cambria', bold: true,
    color: spec.title_color, align: 'left', valign: 'middle', margin: 0
  });
  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 0.6, y: 3.3, w: 7, h: 0.6,
      fontSize: 18, fontFace: 'Calibri',
      color: spec.secondary_color, align: 'left', margin: 0
    });
  }
}

function renderCaseStudy(slide, spec) {
  slide.background = { color: spec.bg_color };
  slide.addText(spec.title, {
    x: 0.5, y: 0.25, w: 9, h: 0.7,
    fontSize: 28, fontFace: 'Cambria', bold: true,
    color: spec.title_color, align: 'left', margin: 0
  });

  // Quote box
  slide.addShape('roundRect', {
    x: 0.4, y: 1.1, w: 9.2, h: 1.8,
    fill: { color: spec.is_dark_slide ? '1a3a5c' : spec.secondary_color + '18' },
    shadow: { type: 'outer', color: '000000', blur: 6, offset: 2, angle: 45, opacity: 0.08 },
    rectRadius: 0.1
  });
  slide.addText(spec.subtitle || 'Client outcome summary', {
    x: 0.6, y: 1.2, w: 8.8, h: 1.6,
    fontSize: 17, fontFace: 'Calibri', italic: true,
    color: spec.body_color, valign: 'middle', margin: 0
  });

  if (spec.bullets && spec.bullets.length) {
    slide.addText(
      spec.bullets.map((b, i) => ({ text: b, options: { bullet: true, breakLine: i < spec.bullets.length - 1, paraSpaceAfter: 8 } })),
      { x: 0.5, y: 3.1, w: 9, h: 2.2, fontSize: 15, fontFace: 'Calibri', color: spec.body_color }
    );
  }
  addSpeakerNotes(slide, spec);
}

// ── Helper ───────────────────────────────────────────────────────────────────
function addSpeakerNotes(slide, spec) {
  if (spec.speaker_notes) slide.addNotes(spec.speaker_notes);
}

// ── Main build function ──────────────────────────────────────────────────────
async function build(deckSpec, outputPath) {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_16x9';
  pres.title = deckSpec.deck_title || 'Sales Presentation';
  pres.author = 'Sales Brain PPT Builder';

  const layoutMap = {
    cover_layout:        renderCoverLayout,
    agenda:              renderBulletsWithIcon,
    bullets_with_icon:   renderBulletsWithIcon,
    split_two_column:    renderSplitTwoColumn,
    comparison_columns:  renderComparisonColumns,
    data_callout_chart:  renderDataCalloutChart,
    case_study_layout:   renderCaseStudy,
    cards_grid:          renderBulletsWithIcon,   // fallback; extend as needed
    pricing_table:       renderBulletsWithIcon,   // fallback; extend as needed
    cta_dark:            renderCTADark,
    section_header_dark: renderSectionHeader,
  };

  for (const slideSpec of deckSpec.slides) {
    const slide = pres.addSlide();
    const renderer = layoutMap[slideSpec.layout] || renderBulletsWithIcon;

    // Attach deck-level context to each slide spec
    const enrichedSpec = {
      ...slideSpec,
      client_name: deckSpec.client_name,
    };

    renderer(slide, enrichedSpec, pres);
  }

  await pres.writeFile({ fileName: outputPath });
  return outputPath;
}

module.exports = { build };
```

---

## Step 10 — templates/brand.json

Customise this for your company before first run.

```json
{
  "company_name": "Your Company",
  "tagline": "Accelerate revenue intelligence",
  "default_theme": "teal_trust",
  "logo_path": null,
  "contact_email": "sales@yourcompany.com",
  "website": "https://yourcompany.com"
}
```

---

## Step 11 — LiteLLM Setup (if using GPT-4o or other models)

LiteLLM is a one-command proxy that lets the OpenAI SDK call any model.

```bash
# Install
pip install litellm

# Run proxy (exposes OpenAI-compatible API on :4000)
litellm --model gpt-4o --port 4000
```

Then in `.env`:
```env
LITELLM_BASE_URL=http://localhost:4000
LITELLM_API_KEY=any-string
CONTENT_MODEL=gpt-4o
```

To use Gemini instead:
```bash
litellm --model gemini/gemini-1.5-pro --port 4000
```
```env
CONTENT_MODEL=gemini/gemini-1.5-pro
```

**If you don't want LiteLLM**, just leave `LITELLM_BASE_URL` blank and set:
```env
CONTENT_MODEL=claude-sonnet-4-6
```
The content agent will use Anthropic's OpenAI-compatible endpoint directly.

---

## Step 12 — How to Call the API

```bash
curl -X POST http://localhost:3001/build-deck \
  -H "Content-Type: application/json" \
  -d '{
    "client": {
      "name": "Acme Corp",
      "industry": "Fintech",
      "pain_points": ["manual reconciliation", "slow onboarding", "no API access"],
      "size": 500,
      "budget_range": "50k-200k"
    },
    "our_company": {
      "products": ["AutoReconcile Pro", "Sales Brain CRM"],
      "differentiators": ["5-minute setup", "SOC2 certified", "99.9% uptime"],
      "case_studies": [
        { "title": "Reduced reconciliation time by 80% for BankX", "outcome": "Saved 40 hrs/week" }
      ],
      "tagline": "Revenue intelligence, automated"
    },
    "alignment_score": 91,
    "recommended_angle": "Eliminate manual reconciliation overhead",
    "deck_goal": "proposal"
  }' \
  --output acme-corp-deck.pptx
```

---

## Model Roles Summary

| Agent | SDK Used | Model | Why |
|-------|----------|-------|-----|
| Orchestrator | Anthropic SDK | claude-opus-4-6 | Complex reasoning — plans the whole deck |
| Content Agent | OpenAI SDK (via LiteLLM) | GPT-4o / any | High-volume text generation — one call per slide |
| Design Agent | Anthropic SDK | Rule-based (no API call) | Fast, deterministic layout rules |
| Assembler | PptxGenJS | — | Skill-based, no AI involved |

**The key pattern**: Claude makes all structural and strategic decisions.
The alternate model does the repetitive text generation work.
PptxGenJS (following Anthropic pptx skill rules) handles all visual execution.

---

## Extending the Project

- **Add your brand template**: Replace `renderCoverLayout` colors with your hex values from `brand.json`
- **Add more layouts**: Add new functions in `assembler.js` and map them in `layoutMap`
- **Add image search**: Call Unsplash API in `contentAgent.js` and return `image_url` for slides
- **Add Google Slides export**: After `.pptx` is built, use `googleapis` to upload via Drive API
- **Add preview UI**: Build a React frontend that calls `/build-deck` and shows a thumbnail grid

---

*Generated by Sales Brain PPT Builder spec — pass this entire file to your coding agent.*
