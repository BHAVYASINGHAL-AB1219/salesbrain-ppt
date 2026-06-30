/**
 * Validates and sanitises a slide spec.
 *
 * IMPORTANT: We NO LONGER truncate text with "…". The user explicitly wants
 * FULL content displayed. Instead of cutting text, the dynamic font-size
 * engine (src/utils/fontFit.js) calculates the optimal font size to fit
 * all content within each text box.
 *
 * This validator now only:
 *   - Guards against absurdly long titles (moves overflow to subtitle)
 *   - Limits bullet COUNT (not text length) to prevent layout breakage
 *   - Validates stat_callout structure
 */
const BULLET_LIMITS = {
  services_grid: 12,
  tech_stack: 12,
  client_wall: 20,
  engagement_models: 3,
};
const DEFAULT_BULLET_LIMIT = 6;

function validate(slide) {
  // Title length guard — if title is extremely long, move excess to subtitle.
  // We use a generous 80-char limit (was 60) to preserve more of the title.
  // The font-fit engine will shrink the font to fit whatever remains.
  if (slide.title && slide.title.length > 80) {
    slide.subtitle = slide.subtitle
      ? slide.title.slice(80) + '. ' + slide.subtitle
      : slide.title.slice(80);
    slide.title = slide.title.slice(0, 80).trim();
  }

  // NOTE: Subtitle is NO LONGER truncated. The font-fit engine in
  // assembler_v2.js will calculate the correct font size to display
  // the full subtitle within the available box.

  // Bullet count guard — slide-type aware.
  // We limit COUNT (not text length) because too many bullets break grid layouts.
  // Individual bullet text length is handled by the font-fit engine.
  const maxBullets = BULLET_LIMITS[slide.slide_type] || DEFAULT_BULLET_LIMIT;
  if (slide.bullets && slide.bullets.length > maxBullets) {
    slide.bullets = slide.bullets.slice(0, maxBullets);
    slide._overflow_note = `Truncated to ${maxBullets} bullets — consider splitting this slide.`;
  }

  // NOTE: Bullet TEXT is NO LONGER truncated. The font-fit engine will
  // shrink the font to fit the full text within each card/box.

  // Stat callout sanity
  if (slide.stat_callout) {
    if (!slide.stat_callout.number || !slide.stat_callout.label) {
      slide.stat_callout = null;
    }
  }

  return slide;
}

module.exports = { validate };
