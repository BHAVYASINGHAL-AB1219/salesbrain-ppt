# assembler_v2.js — Bug Report & Fix Instructions
## For coding agents: apply every change below to assembler_v2.js exactly as specified

---

## BUG 1 — Slide master motif is a banned accent stripe
**File:** `assembler_v2.js` **Line:** 108
**Severity:** Design corruption — skill explicitly bans this pattern

**What's wrong:**
```javascript
// CURRENT — BANNED by skill: "NEVER add decorative color bars or accent stripes"
const motif = { rect: { x: 0, y: 4.75, w: 0.08, h: 0.4, fill: { color: theme.accent } } };
lightObjects.push(motif);
darkObjects.push(motif);
```
The skill says: *"thin solid-fill rectangles along one edge of the slide read as AI-generated filler"*. A `w: 0.08` stripe is exactly the banned pattern.

**Fix — replace lines 108–110 with a subtle divider line instead:**
```javascript
// REPLACEMENT — thin LINE separator, not a filled stripe
const divider = {
  line: { x: 0.4, y: 4.88, w: 9.2, h: 0, line: { color: theme.secondary, width: 0.5 } }
};
lightObjects.push(divider);
darkObjects.push(divider);
```

---

## BUG 2 — `iconToBase64` passes `#` prefix in hex color — corrupts icons
**File:** `assembler_v2.js` **Lines:** 84, 295, 573
**Severity:** Runtime error / visual corruption

**What's wrong:**
```javascript
// Line 84 — function default uses # prefix:
async function iconToBase64(IconComponent, hexColor = '#FFFFFF', size = 256) {

// Lines 295, 573 — all call sites pass # prefix:
const iconData = await iconToBase64(IconComp, `#${t.title_dark}`, 256);  // line 295
const iconData = await iconToBase64(IconComp, `#${t.primary}`, 256);     // line 573
```
The `#` prefix is correct for react-icons SVG color (CSS color), but the skill rule *"NEVER use # with hex colors"* applies to every pptxgenjs property. The real risk here is inconsistency — if this function is ever used to produce a color string passed to pptxgenjs, it will corrupt. More importantly, the call sites use template literals with `#` which is right for SVG but the pattern creates confusion and bugs when copy-pasted elsewhere.

Fix the default and make the `#` explicit and documented so it's never accidentally passed to pptxgenjs:
```javascript
// REPLACEMENT for line 84:
// hexColor must include # prefix (this is SVG color for react-icons, NOT a pptxgenjs color)
async function iconToBase64(IconComponent, svgColor = '#FFFFFF', size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(IconComponent, { color: svgColor, size: String(size) })
  );
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return 'image/png;base64,' + buf.toString('base64');
}

// REPLACEMENT for line 295 — document the # is intentional for SVG:
const iconData = await iconToBase64(IconComp, `#${t.title_dark}`, 256); // # required for SVG

// REPLACEMENT for line 573:
const iconData = await iconToBase64(IconComp, `#${t.primary}`, 256); // # required for SVG
```

---

## BUG 3 — `makeShadow` factory uses `angle: 135` but skill table says 135 = bottom-LEFT
**File:** `assembler_v2.js` **Line:** 94
**Severity:** Shadows fall in wrong direction on all cards

**What's wrong:**
```javascript
// CURRENT
const makeShadow = (opacity = 0.12) => ({
  type: 'outer', color: '000000', blur: 8, offset: 3, angle: 135, opacity
});
```
The skill table: *"angle: direction the shadow falls, 45 = bottom-right, 135 = bottom-left"*. Standard card shadows fall bottom-right (45°). Every card in the deck has its shadow going the wrong way.

**Fix:**
```javascript
// REPLACEMENT
const makeShadow = (opacity = 0.12) => ({
  type: 'outer', color: '000000', blur: 8, offset: 3, angle: 45, opacity
});
```

---

## BUG 4 — All content slide titles use `fontSize: 36` — too large, crowds content area
**File:** `assembler_v2.js` **Lines:** 325, 393, 464, 534, 700
**Severity:** Layout overflow — title pushes content out of safe area

**What's wrong:**
`renderSplitTwoCol` (line 325), `renderComparison` (line 393), `renderDataChart` (line 464), `renderCaseStudy` (line 534), and `renderPricing` (line 700) all use `fontSize: 36` for content slide titles. The slide height is 5.625". With `y: 0.5, h: 0.65` at 36pt, the title descends to `y: 1.15`, leaving only 4.5" for content — and the content in some layouts starts at `y: 1.3` leaving only `0.15"` of breathing room. The cover correctly uses 42pt because it's a full-bleed design with no body content competing. Content slides should use 28–30pt.

**Fix — change all five occurrences:**
```javascript
// renderSplitTwoCol — line 325:
// BEFORE: fontSize: 36
// AFTER:
fontSize: 28,

// renderComparison — line 393:
// BEFORE: fontSize: 36
// AFTER:
fontSize: 28,

// renderDataChart — line 464:
// BEFORE: fontSize: 36
// AFTER:
fontSize: 28,

// renderCaseStudy — line 534:
// BEFORE: fontSize: 36
// AFTER:
fontSize: 28,

// renderPricing — line 700:
// BEFORE: fontSize: 36
// AFTER:
fontSize: 28,
```
Also tighten the title box height from `h: 0.65` to `h: 0.6` on all five, and move the `y` from `0.5` to `0.28` so content has more room:
```javascript
// All five content slide titles — change:
x: 0.5, y: 0.5, w: 9, h: 0.65,
// TO:
x: 0.5, y: 0.28, w: 9, h: 0.6,
```

---

## BUG 5 — `renderBulletsWithIcons` title starts at `y: 0.5` but other slides start at `y: 0.28`
**File:** `assembler_v2.js` **Lines:** 268, 274, 282
**Severity:** Visual inconsistency — title position jumps between slides

**What's wrong:**
`renderBulletsWithIcons` starts title at `y: 0.5`, subtitle at `y: 1.35`, content at `y: 1.85`. After fixing Bug 4, all other content slides will start at `y: 0.28`. This layout will appear to have a "dropped" title compared to every other slide in the deck.

**Fix:**
```javascript
// Line 268 — title:
// BEFORE: x: 0.5, y: 0.5, w: 9, h: 0.7,
// AFTER:
x: 0.5, y: 0.28, w: 9, h: 0.65,

// Line 274 — subtitle:
// BEFORE: x: 0.5, y: 1.35, w: 9, h: 0.4,
// AFTER:
x: 0.5, y: 1.05, w: 9, h: 0.38,

// Line 282-283 — content startY:
// BEFORE:
const startY = spec.subtitle ? 1.85 : 1.55;
const rowH   = (3.5) / Math.max(bullets.length, 1);
// AFTER:
const startY = spec.subtitle ? 1.55 : 1.25;
const rowH   = (4.0) / Math.max(bullets.length, 1);
```

---

## BUG 6 — `renderAgenda` title at `y: 0.5` AND content `startY` creates overflow for 6 items
**File:** `assembler_v2.js` **Lines:** 646, 665
**Severity:** Content clips off slide bottom for 4+ agenda items

**What's wrong:**
```javascript
// Line 646
x: 0.5, y: 0.5, w: 9, h: 0.65,  // title ends at y=1.15

// Line 665 — y calculation:
const y = 1.4 + (items.indexOf(items.find(i => i.num === num))) * 1.05;
// For 3 items in left column: last item at y = 1.4 + 2*1.05 = 3.5 ✓
// But with title at y:0.5 (not 0.28), there's 0.25" less space than other slides
```
Also `items.indexOf(items.find(...))` is an O(n²) lookup — it searches the array twice per item. For 6 items this is harmless but it's a code smell.

**Fix:**
```javascript
// Line 646 — align title with other slides:
// BEFORE: x: 0.5, y: 0.5, w: 9, h: 0.65,
// AFTER:
x: 0.5, y: 0.28, w: 9, h: 0.65,

// Line 665 — fix the O(n²) index lookup:
// BEFORE:
const y = 1.4 + (items.indexOf(items.find(i => i.num === num))) * 1.05;
// AFTER — use the loop index directly (the `for...of` loop needs to become indexed):
```

Replace the entire `drawNumberedItems` function (lines 663–684) with:
```javascript
const drawNumberedItems = async (numberedItems, xStart) => {
  for (let idx = 0; idx < numberedItems.length; idx++) {
    const { num, text } = numberedItems[idx];
    const y = 1.15 + idx * 1.05;  // fixed, no O(n²) lookup

    slide.addShape(pres.shapes.OVAL, {
      x: xStart, y: y + 0.06, w: 0.44, h: 0.44,
      fill: { color: t.primary }, line: { color: t.primary, width: 0 }
    });
    slide.addText(String(num), {
      x: xStart, y: y + 0.06, w: 0.44, h: 0.44,
      fontSize: 14, fontFace: 'Cambria', bold: true,
      color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0
    });
    slide.addText(text, {
      x: xStart + 0.6, y, w: 3.8, h: 0.56,
      fontSize: 16, fontFace: 'Calibri',
      color: t.body_light, valign: 'middle', margin: 0
    });
  }
};
```

---

## BUG 7 — `renderPricing` title at 36pt with `y: 0.5` leaves only 0.9" before table starts at `y: 1.7`
**File:** `assembler_v2.js` **Lines:** 700, 705, 727
**Severity:** Subtitle overlaps table header for long subtitles

**What's wrong:**
- Title: `y: 0.5, h: 0.65` → ends at `y: 1.15`
- Subtitle: `y: 1.2, h: 0.38` → ends at `y: 1.58`
- Table: starts at `y: 1.7` → only `0.12"` gap between subtitle and table. Any subtitle wrapping to 2 lines will overlap the table.

**Fix — after applying Bug 4's title fix (`y: 0.28`, `fontSize: 28`), also update subtitle and table y:**
```javascript
// Subtitle — line 706:
// BEFORE: x: 0.5, y: 1.2, w: 9, h: 0.38,
// AFTER:
x: 0.5, y: 0.96, w: 9, h: 0.38,

// Table — line 727:
// BEFORE: x: 0.5, y: 1.7, w: 9,
// AFTER:
x: 0.5, y: 1.45, w: 9,
```

---

## BUG 8 — `renderDataChart` stat callout `y: 0.4` overlaps the title text box
**File:** `assembler_v2.js` **Lines:** 472–480
**Severity:** Stat number renders on top of title in PowerPoint

**What's wrong:**
```javascript
// Title box: x: 0.5, y: 0.5, w: 7, h: 0.65  → occupies x:0.5–7.5, y:0.5–1.15
// Stat number: x: 7.2, y: 0.4, w: 2.6, h: 0.9 → occupies x:7.2–9.8, y:0.4–1.3
```
After Bug 4 fixes the title to `y: 0.28`, the stat number at `y: 0.4` still starts 0.12" after the title but the stat's `h: 0.9` means it ends at `y: 1.3` while the label starts at `y: 1.3` — they collide. Also the stat number box (`y: 0.4`) starts BEFORE the title box would after the fix (`y: 0.28`) creating a misalignment.

**Fix — align stat to match title top, then stack label cleanly:**
```javascript
// BEFORE lines 471–480:
slide.addText(spec.stat_callout.number, {
  x: 7.2, y: 0.4, w: 2.6, h: 0.9,
  fontSize: 60, ...
});
slide.addText(spec.stat_callout.label, {
  x: 7.2, y: 1.3, w: 2.6, h: 0.35,
  ...
});

// AFTER — align to y: 0.22, match title top:
slide.addText(spec.stat_callout.number, {
  x: 7.2, y: 0.22, w: 2.6, h: 0.75,
  fontSize: 52, fontFace: 'Cambria', bold: true,
  color: t.primary, align: 'right', valign: 'middle', margin: 0
});
slide.addText(spec.stat_callout.label, {
  x: 7.2, y: 0.97, w: 2.6, h: 0.3,
  fontSize: 11, fontFace: 'Calibri',
  color: t.body_light, align: 'right', margin: 0
});
```

---

## BUG 9 — `renderSectionHeader` section number uses `transparency` property on `addText` — not supported
**File:** `assembler_v2.js` **Lines:** 232–237
**Severity:** The transparency is silently ignored — large opaque number covers slide content

**What's wrong:**
```javascript
slide.addText(`0${spec.slide_number}`, {
  ...
  transparency: 80,  // ❌ addText does not support transparency property
  ...
});
```
`transparency` only works on `addShape` and `addImage`, not on `addText`. The large decorative number renders fully opaque and covers the title text.

**Fix — render the background number as a shape with low-opacity fill, or use color with lightened hex instead:**
```javascript
// REPLACEMENT for lines 232–237:
// Use a lightened version of accent color to fake transparency
// (take the accent and blend toward dark_bg at 80% transparency manually)
// Simpler: just set the color to a very dim version of accent
slide.addText(`0${spec.slide_number}`, {
  x: 5.5, y: 0.1, w: 4.3, h: 4.2,
  fontSize: 180, fontFace: 'Cambria', bold: true,
  color: t.secondary,   // use secondary (already lighter) instead of faking transparency
  align: 'right', valign: 'middle', margin: 0
});
```
If you want true low-opacity, add a transparent shape on top of an opaque text box using `pres.shapes.RECTANGLE` with `fill: { color: t.dark_bg, transparency: 20 }` as an overlay — but the color approach above is simpler and more reliable.

---

## BUG 10 — `designAgent.js` COLOR_THEMES missing `dark_bg`, `card_bg`, `body_dark`, `title_dark`, `title_light`, `body_light`, `chart` keys
**File:** `designAgent.js` **Lines:** 7–14
**Severity:** Every theme object passed from designAgent is missing keys that assembler_v2 reads

**What's wrong:**
`designAgent.js` defines:
```javascript
midnight_executive: { primary, secondary, accent, light_bg }
```
But `assembler_v2.js` reads: `t.dark_bg`, `t.card_bg`, `t.title_dark`, `t.title_light`, `t.body_light`, `t.body_dark`, `t.chart` — none of which exist in the designAgent's theme objects. The assembler has its own `COLOR_THEMES` object too (lines 28–81) with all the right keys.

**The result:** the `theme` object that flows through `deckSpec → enriched → spec.theme` comes from `designAgent.assign()` which returns a stripped theme. The assembler's `const theme = COLOR_THEMES[deckSpec.color_theme]` line (769) re-reads from its own full themes — so the assembler itself is fine. But `designAgent.js` is sending broken theme objects into `slideSpec.theme` which overrides in the `enriched` spread on line 804–808:
```javascript
const enriched = {
  ...slideSpec,   // ← contains theme from designAgent (broken, missing keys)
  theme,          // ← this OVERRIDES slideSpec.theme with the correct full theme ✓
  client_name: deckSpec.client_name,
};
```
This actually saves you — the assembler's `theme` overrides the bad one. BUT if the orchestrator or any middleware reads `slideSpec.theme` directly before it reaches the assembler, it gets broken data.

**Fix — update `designAgent.js` COLOR_THEMES to match assembler's full schema:**
```javascript
// REPLACE the entire COLOR_THEMES in designAgent.js with:
const COLOR_THEMES = {
  midnight_executive: {
    dark_bg: '1E2761', light_bg: 'EEF2FF', card_bg: 'F4F6FB',
    primary: '1E2761', secondary: 'CADCFC', accent: '4F8EF7',
    title_dark: 'FFFFFF', title_light: '1E2761',
    body_light: '374151', body_dark: 'CADCFC',
    chart: ['4F8EF7', 'CADCFC', '7EAAFF', 'A8C4FF'],
  },
  teal_trust: {
    dark_bg: '028090', light_bg: 'F0FAFA', card_bg: 'E6F7F8',
    primary: '028090', secondary: '00A896', accent: '02C39A',
    title_dark: 'FFFFFF', title_light: '028090',
    body_light: '1F4E52', body_dark: 'B2EAE8',
    chart: ['02C39A', '028090', '00A896', '5EEAD4'],
  },
  coral_energy: {
    dark_bg: '2F3C7E', light_bg: 'FFF8F8', card_bg: 'FFF0EE',
    primary: 'F96167', secondary: '2F3C7E', accent: 'F9E795',
    title_dark: 'FFFFFF', title_light: '2F3C7E',
    body_light: '3D2B2B', body_dark: 'F9E795',
    chart: ['F96167', 'F9E795', 'FF8A80', 'FFD180'],
  },
  charcoal_minimal: {
    dark_bg: '36454F', light_bg: 'FAFAFA', card_bg: 'F2F2F2',
    primary: '36454F', secondary: '8899A6', accent: '212121',
    title_dark: 'FFFFFF', title_light: '36454F',
    body_light: '4B5563', body_dark: 'D1D9E0',
    chart: ['36454F', '8899A6', '5A6E7A', 'B0BEC5'],
  },
};
```
Also remove the unused `claude` import from `designAgent.js` line 3 — it's never called:
```javascript
// DELETE this line from designAgent.js:
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// And DELETE: const Anthropic = require('@anthropic-ai/sdk');
// (The whole Anthropic SDK import is dead code since assign() is rule-based)
```

---

## BUG 11 — `renderCaseStudy` result grid bottom row clips at `y: 4.2 + h: 0.9 = y: 5.1` — outside slide
**File:** `assembler_v2.js` **Lines:** 558–560
**Severity:** Bottom two cards are partially or fully invisible

**What's wrong:**
```javascript
const positions = [
  [0.5, 3.1], [5.1, 3.1],
  [0.5, 4.2], [5.1, 4.2]   // bottom row: y:4.2 + h:0.9 = y:5.1
];
```
Slide height is 5.625". Slide master footer is at `y: 4.88`. The bottom cards end at `y: 5.1` — they extend into the footer zone and clip against the slide edge in some renderers.

**Fix — compress positions to fit within safe area (above y: 4.75):**
```javascript
// REPLACEMENT for lines 558–560:
const positions = [
  [0.5, 3.0], [5.1, 3.0],
  [0.5, 3.98], [5.1, 3.98]  // bottom row ends at 3.98 + 0.9 = 4.88 ✓ exactly at footer
];
```

---

## BUG 12 — `renderSplitTwoCol` right-column text overflows its card when subtitle is long
**File:** `assembler_v2.js` **Lines:** 366–378
**Severity:** Text visually exits the card shape boundary

**What's wrong:**
```javascript
slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 5.5, y: 1.0, w: 4.0, h: 3.0,  // card: y:1.0 to y:4.0
  ...
});
slide.addText(spec.subtitle, {
  x: 5.7, y: 1.45, w: 3.6, h: 2.6,  // text: y:1.45 to y:4.05 — 0.05" overflow
  ...
});
```
Card ends at `y: 4.0`, text box ends at `y: 4.05`. On any subtitle exceeding ~8 lines at 16pt in 3.6" width, text spills 0.05" below the card.

**Fix:**
```javascript
// REPLACEMENT lines 366–378:
slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 5.5, y: 1.1, w: 4.0, h: 3.0,
  fill: { color: t.card_bg },
  shadow: makeShadow(0.1),
  rectRadius: 0.12,
  line: { color: t.card_bg, width: 0 }
});
slide.addText(spec.subtitle, {
  x: 5.7, y: 1.25, w: 3.6, h: 2.75,  // h reduced to stay inside card
  fontSize: 16, fontFace: 'Calibri', italic: true,
  color: t.body_light, valign: 'middle', margin: 0
});
```

---

## Summary Table for Agent

| # | File | Lines | Type | Impact |
|---|------|-------|------|--------|
| 1 | assembler_v2.js | 108 | Skill violation — banned stripe | Visual — AI-looking filler |
| 2 | assembler_v2.js | 84, 295, 573 | Naming confusion with # prefix | Potential corruption if copy-pasted |
| 3 | assembler_v2.js | 94 | Wrong shadow angle (135 vs 45) | Shadows fall bottom-LEFT on all cards |
| 4 | assembler_v2.js | 325,393,464,534,700 | Title fontSize 36 too large | Content overflow on all content slides |
| 5 | assembler_v2.js | 268,274,282 | Title y:0.5 misaligned vs other slides | Inconsistent title position deck-wide |
| 6 | assembler_v2.js | 646, 665 | y:0.5 title + O(n²) index lookup | Overflow + bad code |
| 7 | assembler_v2.js | 700,706,727 | Subtitle overlaps table header | Visual collision |
| 8 | assembler_v2.js | 472–480 | Stat number overlaps title y-position | Text collision on data slides |
| 9 | assembler_v2.js | 232–237 | `transparency` on addText — unsupported | Large opaque number covers title |
| 10 | designAgent.js | 7–14 | Incomplete theme schema | Missing keys, dead Anthropic import |
| 11 | assembler_v2.js | 558–560 | Bottom cards extend past y:4.75 | Cards clip into footer / off slide |
| 12 | assembler_v2.js | 366–378 | Text box 0.05" taller than card | Text overflows card boundary |

**Apply all 12 fixes in order. No other files need changes.**
