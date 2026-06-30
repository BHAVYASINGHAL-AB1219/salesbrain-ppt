/**
 * fontFit.js — Dynamic font-size calculation engine
 *
 * Ports the font-metric logic from scripts/structural_review.py to JavaScript.
 * Instead of relying on PowerPoint's runtime `fit: 'shrink'` (which is unreliable
 * and doesn't pre-calculate), this module computes the optimal font size BEFORE
 * rendering so text always fits within its box without overflow or overlap.
 *
 * Core idea:
 *   1. Estimate how many lines text will wrap to at a given font size
 *   2. Estimate the rendered height of those lines
 *   3. Binary-search the largest font size where estimated height ≤ box height
 */

// ─── Per-font average character-width ratios (width_pt / font_size_pt) ───────
// Measured from real font metrics (Calibri, Cambria, Arial, etc.)
const FONT_AVG_CHAR_WIDTH_RATIO = {
  calibri: 0.55,
  'calibri light': 0.55,
  cambria: 0.57,
  arial: 0.56,
  helvetica: 0.56,
  times: 0.54,
  'times new roman': 0.54,
  georgia: 0.56,
  verdana: 0.62,
  trebuchet: 0.58,
  default: 0.56,
};

// Line-height multiplier (line height as a multiple of font size in pts)
const LINE_HEIGHT_RATIO = 1.25;

// Points per inch
const PT_PER_INCH = 72.0;

// Minimum readable font sizes (pt)
const MIN_BODY_FONT = 8;
const MIN_TITLE_FONT = 12;

/**
 * Normalise a font name to our lookup key.
 * @param {string} fontName
 * @returns {string}
 */
function fontKey(fontName) {
  if (!fontName) return 'default';
  const name = fontName.toLowerCase().trim();
  for (const k of Object.keys(FONT_AVG_CHAR_WIDTH_RATIO)) {
    if (k !== 'default' && name.includes(k)) return k;
  }
  return 'default';
}

/**
 * Estimate how many lines the text will produce when word-wrapped inside
 * boxWidthInches at the given fontSizePt.
 *
 * Handles explicit newlines (\n) and breakLine markers.
 *
 * @param {string} text - The text to measure
 * @param {number} fontSizePt - Font size in points
 * @param {number} boxWidthInches - Available width in inches
 * @param {string} [fontName] - Font family name
 * @returns {number} Estimated line count
 */
function estimateWrappedLines(text, fontSizePt, boxWidthInches, fontName) {
  if (!text || boxWidthInches <= 0 || !fontSizePt || fontSizePt <= 0) return 0;

  const charRatio = FONT_AVG_CHAR_WIDTH_RATIO[fontKey(fontName)] || FONT_AVG_CHAR_WIDTH_RATIO.default;
  const avgCharWidthPt = fontSizePt * charRatio;
  const avgCharWidthInch = avgCharWidthPt / PT_PER_INCH;
  const charsPerLine = Math.max(1, boxWidthInches / avgCharWidthInch);

  // Word-wrap simulation: respect newlines and spaces
  let lines = 0;
  for (const paragraph of String(text).split('\n')) {
    const words = paragraph.split(' ');
    if (!words.length || (words.length === 1 && words[0] === '')) {
      lines += 1; // empty paragraph = blank line
      continue;
    }
    let currentLineChars = 0;
    for (const word of words) {
      const wordChars = word.length + 1; // +1 for space
      if (currentLineChars + wordChars > charsPerLine && currentLineChars > 0) {
        lines += 1;
        currentLineChars = wordChars;
      } else {
        currentLineChars += wordChars;
      }
    }
    lines += 1; // last line in paragraph
  }

  return lines;
}

/**
 * Estimate the rendered height (in inches) of text when word-wrapped.
 *
 * @param {string} text
 * @param {number} fontSizePt
 * @param {number} boxWidthInches
 * @param {string} [fontName]
 * @returns {number} Estimated height in inches
 */
function estimateTextHeight(text, fontSizePt, boxWidthInches, fontName) {
  const lines = estimateWrappedLines(text, fontSizePt, boxWidthInches, fontName);
  const lineHeightPt = fontSizePt * LINE_HEIGHT_RATIO;
  const lineHeightInch = lineHeightPt / PT_PER_INCH;
  return lines * lineHeightInch;
}

/**
 * Calculate the optimal font size that fits text within a box.
 *
 * Uses binary search to find the largest font size (between minSize and maxSize)
 * where the estimated text height fits within boxHeightInches.
 *
 * @param {string} text - The text to fit
 * @param {number} boxWidthInches - Box width in inches
 * @param {number} boxHeightInches - Box height in inches
 * @param {object} [opts]
 * @param {string} [opts.fontName='Calibri'] - Font family
 * @param {number} [opts.minSize=8] - Minimum font size (pt)
 * @param {number} [opts.maxSize=44] - Maximum font size (pt)
 * @param {number} [opts.fillRatio=0.92] - Max fraction of box height to use (safety margin)
 * @returns {number} Optimal font size in points (rounded to nearest 0.5)
 */
function fitFontSize(text, boxWidthInches, boxHeightInches, opts = {}) {
  const {
    fontName = 'Calibri',
    minSize = MIN_BODY_FONT,
    maxSize = 44,
    fillRatio = 0.92,
  } = opts;

  if (boxWidthInches <= 0 || boxHeightInches <= 0) return minSize;
  if (!text || !String(text).trim()) return maxSize; // empty text → no constraint, use max

  const targetHeight = boxHeightInches * fillRatio;

  // Binary search for the largest font size that fits
  let lo = minSize;
  let hi = maxSize;
  let best = minSize;

  // Quick check: does even the min size fit? If not, return min (let shrink handle)
  const minHeight = estimateTextHeight(text, minSize, boxWidthInches, fontName);
  if (minHeight > targetHeight) {
    return minSize;
  }

  // Does the max size already fit? Use it
  const maxHeight = estimateTextHeight(text, maxSize, boxWidthInches, fontName);
  if (maxHeight <= targetHeight) {
    return maxSize;
  }

  // Binary search
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const height = estimateTextHeight(text, mid, boxWidthInches, fontName);
    if (height <= targetHeight) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < 0.25) break; // converge to 0.25pt precision
  }

  // Round to nearest 0.5pt for cleaner rendering
  return Math.round(best * 2) / 2;
}

/**
 * Calculate optimal font size for multi-run text (e.g., bold title + body desc).
 *
 * Each run may have a different relative size. We compute based on the largest
 * run's font size as the "base" and scale others proportionally.
 *
 * @param {Array<{text: string, sizeRatio?: number}>} runs - Text runs with size ratios
 * @param {number} boxWidthInches
 * @param {number} boxHeightInches
 * @param {object} [opts]
 * @returns {number} Base font size in points (multiply by sizeRatio for each run)
 */
function fitMultiRunFontSize(runs, boxWidthInches, boxHeightInches, opts = {}) {
  const {
    fontName = 'Calibri',
    minSize = MIN_BODY_FONT,
    maxSize = 44,
    fillRatio = 0.92,
  } = opts;

  if (!runs || !runs.length || boxWidthInches <= 0 || boxHeightInches <= 0) return minSize;

  // Combine all text with newlines between runs for height estimation
  const fullText = runs.map(r => r.text).join('\n');
  const targetHeight = boxHeightInches * fillRatio;

  // Binary search on the base size
  let lo = minSize;
  let hi = maxSize;
  let best = minSize;

  const minHeight = estimateTextHeight(fullText, minSize, boxWidthInches, fontName);
  if (minHeight > targetHeight) return minSize;

  const maxHeight = estimateTextHeight(fullText, maxSize, boxWidthInches, fontName);
  if (maxHeight <= targetHeight) return maxSize;

  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const height = estimateTextHeight(fullText, mid, boxWidthInches, fontName);
    if (height <= targetHeight) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < 0.25) break;
  }

  return Math.round(best * 2) / 2;
}

/**
 * Calculate optimal font size for a list of bullet items.
 *
 * Each bullet is a separate paragraph. We estimate total height including
 * paragraph spacing.
 *
 * @param {string[]} bullets - Array of bullet text strings
 * @param {number} boxWidthInches
 * @param {number} boxHeightInches
 * @param {object} [opts]
 * @param {number} [opts.paraSpaceAfter=8] - Space after each paragraph in pt
 * @param {number} [opts.bulletIndent=0.25] - Indent for bullet marker in inches (reduces text width)
 * @returns {number} Optimal font size in points
 */
function fitBulletListFontSize(bullets, boxWidthInches, boxHeightInches, opts = {}) {
  const {
    fontName = 'Calibri',
    minSize = MIN_BODY_FONT,
    maxSize = 24,
    fillRatio = 0.92,
    paraSpaceAfter = 8,
    bulletIndent = 0.25,
  } = opts;

  if (!bullets || !bullets.length || boxWidthInches <= 0 || boxHeightInches <= 0) return minSize;

  // Effective text width is reduced by bullet indent
  const effectiveWidth = boxWidthInches - bulletIndent;
  const targetHeight = boxHeightInches * fillRatio;

  // Binary search
  let lo = minSize;
  let hi = maxSize;
  let best = minSize;

  const calcHeight = (size) => {
    let totalLines = 0;
    for (const b of bullets) {
      totalLines += estimateWrappedLines(b, size, effectiveWidth, fontName);
    }
    const lineHeightInch = (size * LINE_HEIGHT_RATIO) / PT_PER_INCH;
    const paraSpaceInch = (paraSpaceAfter * bullets.length) / PT_PER_INCH;
    return totalLines * lineHeightInch + paraSpaceInch;
  };

  if (calcHeight(minSize) > targetHeight) return minSize;
  if (calcHeight(maxSize) <= targetHeight) return maxSize;

  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (calcHeight(mid) <= targetHeight) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < 0.25) break;
  }

  return Math.round(best * 2) / 2;
}

module.exports = {
  FONT_AVG_CHAR_WIDTH_RATIO,
  LINE_HEIGHT_RATIO,
  PT_PER_INCH,
  MIN_BODY_FONT,
  MIN_TITLE_FONT,
  fontKey,
  estimateWrappedLines,
  estimateTextHeight,
  fitFontSize,
  fitMultiRunFontSize,
  fitBulletListFontSize,
};
