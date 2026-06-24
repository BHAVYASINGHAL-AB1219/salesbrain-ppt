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