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
