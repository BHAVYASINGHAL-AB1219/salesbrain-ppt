/**
 * designAgent.js — Sales Brain PPT Builder
 *
 * DESIGN OVERHAUL v3:
 * 1. Added 2 new color themes: ocean_gradient, sage_calm
 * 2. Added new layout rules: services_grid, tech_stack, client_wall,
 *    engagement_models, global_presence → new assembler layout types
 * 3. Added slide_type passthrough for eyebrow labels
 */

// ─── Color themes — single source of truth ───────────────────────────────────
// These MUST match assembler_v2.js COLOR_THEMES exactly.
const COLOR_THEMES = {
  quarks_brand: {
    dark_bg: '0D1B2A',   // Deep Navy — spec token --navy
    light_bg: 'F0F4F8',   // Ice White — spec token --ice
    card_bg: 'E2E8F0',   // Pearl Gray — spec token --pearl (was E8EEF4)
    primary: '059669',   // Muted Emerald — spec token --emerald
    secondary: '047857',   // Deeper Emerald — eyebrows, dividers (was same as primary)
    accent: 'E8B84B',   // Amber Gold — spec token --amber, stats ONLY
    title_dark: 'F8F9FA',   // Off-White — spec token --text-light
    title_light: '1A1A2E',   // Slate Black — spec token --text-dark
    body_light: '64748B',   // Cool Gray — spec token --muted (was 374151)
    body_dark: 'C8D8E8',   // Pale blue-grey on dark slides
    chart: ['059669', 'E8B84B', '0D1B2A', '6EE7B7'],
  },
  midnight_executive: {
    dark_bg: '1E2761',
    light_bg: 'EEF2FF',
    card_bg: 'F4F6FB',
    primary: '1E2761',
    secondary: 'CADCFC',
    accent: '4F8EF7',
    title_dark: 'FFFFFF',
    title_light: '1E2761',
    body_light: '374151',
    body_dark: 'CADCFC',
    chart: ['4F8EF7', 'CADCFC', '7EAAFF', 'A8C4FF'],
  },
  teal_trust: {
    dark_bg: '028090',
    light_bg: 'F0FAFA',
    card_bg: 'E6F7F8',
    primary: '028090',
    secondary: '00A896',
    accent: '02C39A',
    title_dark: 'FFFFFF',
    title_light: '028090',
    body_light: '1F4E52',
    body_dark: 'B2EAE8',
    chart: ['02C39A', '028090', '00A896', '5EEAD4'],
  },
  coral_energy: {
    dark_bg: '2F3C7E',
    light_bg: 'FFF8F8',
    card_bg: 'FFF0EE',
    primary: 'F96167',
    secondary: '2F3C7E',
    accent: 'F9E795',
    title_dark: 'FFFFFF',
    title_light: '2F3C7E',
    body_light: '3D2B2B',
    body_dark: 'F9E795',
    chart: ['F96167', 'F9E795', 'FF8A80', 'FFD180'],
  },
  charcoal_minimal: {
    dark_bg: '36454F',
    light_bg: 'FAFAFA',
    card_bg: 'F2F2F2',
    primary: '36454F',
    secondary: '8899A6',
    accent: '212121',
    title_dark: 'FFFFFF',
    title_light: '36454F',
    body_light: '4B5563',
    body_dark: 'D1D9E0',
    chart: ['36454F', '8899A6', '5A6E7A', 'B0BEC5'],
  },
  ocean_gradient: {
    dark_bg: '065A82',
    light_bg: 'EFF8FF',
    card_bg: 'E0F0FE',
    primary: '065A82',
    secondary: '1C7293',
    accent: '21295C',
    title_dark: 'FFFFFF',
    title_light: '065A82',
    body_light: '2D4A5E',
    body_dark: 'B8D8E8',
    chart: ['065A82', '1C7293', '21295C', '4DA8DA'],
  },
  sage_calm: {
    dark_bg: '50808E',
    light_bg: 'F4F9F4',
    card_bg: 'E8F3E8',
    primary: '50808E',
    secondary: '84B59F',
    accent: '69A297',
    title_dark: 'FFFFFF',
    title_light: '50808E',
    body_light: '3A5A40',
    body_dark: 'C8DCC8',
    chart: ['50808E', '84B59F', '69A297', 'A8D5BA'],
  },
  quarks_brand: {
    dark_bg: '1A1A1A',
    light_bg: 'F5F9F5',
    card_bg: 'EDF5ED',
    primary: '4CAF50',
    secondary: '2E7D32',
    accent: '66BB6A',
    title_dark: 'FFFFFF',
    title_light: '1A1A1A',
    body_light: '37474F',
    body_dark: 'B9E4BC',
    chart: ['4CAF50', '66BB6A', '2E7D32', '81C784'],
  },
  golden_navy: {
    dark_bg: '0A1F44',   // deep navy — cover bg, dark masters
    light_bg: 'F0F7FF',   // ice blue-white — body slide bg
    card_bg: 'E8F2FF',   // slightly deeper — card surfaces
    primary: '0078D4',   // electric blue — buttons, borders, headings on light
    secondary: '00B4D8',   // cyan — eyebrows, subtitles, taglines on dark slides
    accent: 'FFC200',   // gold — stat_callout numbers, cover stats strip ONLY
    title_dark: 'FFFFFF',   // white — h1 on dark bg slides
    title_light: '0A1F44',   // navy — h1 on light bg slides
    body_light: '5A6A85',   // muted slate — bullet text on light slides
    body_dark: 'B0D4F8',   // pale blue — bullet text on dark slides
    chart: ['0078D4', '00B4D8', 'FFC200', '5A6A85'],  // blue, cyan, gold, slate
  },
};

// ─── Layout rules — slide_type → layout name used by assembler ───────────────
const LAYOUT_RULES = {
  cover: 'cover_layout',
  agenda: 'agenda',
  problem: 'split_two_column',
  solution: 'split_two_column',
  comparison: 'comparison_columns',
  data: 'data_callout_chart',
  case_study: 'case_study_layout',
  team: 'cards_grid',
  pricing: 'pricing_table',
  cta: 'cta_dark',
  section_header: 'section_header_dark',
  // New layout types
  services_grid: 'cards_grid',
  tech_stack: 'cards_grid',
  client_wall: 'client_logos',
  engagement_models: 'three_column',
  global_presence: 'cards_grid',
};

// ─── Dark slide types — drives DARK_MASTER selection in assembler ─────────────
const DARK_SLIDE_TYPES = new Set(['cover', 'cta', 'section_header']);

/**
 * Assigns layout type and visual properties for a slide.
 * Pure rule-based — no API call. Fast and deterministic.
 */
async function assign(slidePlan, colorTheme, slideIndex, totalSlides) {
  const theme = COLOR_THEMES[colorTheme] || COLOR_THEMES.midnight_executive;

  const isDark = DARK_SLIDE_TYPES.has(slidePlan.slide_type) || slidePlan.visual_tone === 'dark';
  const layout = LAYOUT_RULES[slidePlan.slide_type] || 'bullets_with_icon';

  return {
    layout,
    theme,
    is_dark_slide: isDark,
    slide_number: slideIndex + 1,
    total_slides: totalSlides,
    slide_type: slidePlan.slide_type,
  };
}

module.exports = { assign, COLOR_THEMES, LAYOUT_RULES };
