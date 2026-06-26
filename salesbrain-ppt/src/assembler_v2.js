/**
 * assembler_v2.js — Sales Brain PPT Builder
 *
 * DESIGN OVERHAUL v3:
 * - Eyebrow labels on every content slide (uppercase + charSpacing)
 * - Stat counter strip on cover slide
 * - Card grid layouts (2×2, 2×3, 3×4) instead of plain bullet lists
 * - Decorative background shapes on content slides
 * - Three-column comparison layout
 * - Client logo wall layout
 * - Accent-bar cards with premium shadows
 * - Enhanced typography hierarchy
 *
 * Every design upgrade maps to a technique in the Anthropic pptx skill.
 * DROP-IN REPLACEMENT: same export signature → require('./assembler_v2')
 */

const pptxgen = require('pptxgenjs');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Replaced react-icons with lightweight inline SVGs to prevent Node.js from hanging on startup
const createIcon = (pathData) => ({ color = '#FFFFFF', size = 256 }) => React.createElement(
  'svg',
  { viewBox: '0 0 24 24', width: size, height: size, fill: 'currentColor', style: { color } },
  React.createElement('path', { d: pathData })
);

const FaCheckCircle = createIcon('M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z');
const FaChartLine = createIcon('M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6h-6z');
const FaBullseye = createIcon('M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z');
const FaUsers = createIcon('M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z');
const FaLightbulb = createIcon('M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z');
const FaRocket = createIcon('M13.13 22.19L11.5 18.36C10.07 18.78 8.45 18.73 7.05 18.06L5.56 19.55C5.9 19.89 6 20.37 5.86 20.85L5.45 22.31C5.3 22.84 5.75 23.3 6.27 23.14L7.75 22.7C8.23 22.55 8.72 22.66 9.06 23.01L10.54 24.5C11.19 25.14 12.28 24.96 12.67 24.16L14.65 19.98C14.07 20.9 13.52 21.6 13.13 22.19ZM20.73 2.15C20.48 1.9 20.12 1.79 19.76 1.83C15.01 2.34 7.01 5.92 5.3 12.37L2.45 11.42C1.65 11.15 0.94 11.97 1.34 12.72L5.13 19.78C5.23 19.96 5.38 20.09 5.57 20.17L7.05 18.68C7.05 18.68 7.51 16.51 10.63 13.39C13.75 10.27 15.92 9.8 15.92 9.8L17.41 11.29C17.33 11.1 17.19 10.95 17.01 10.85L9.95 7.06C9.2 6.66 8.38 7.37 8.65 8.17L9.6 11.02C3.15 12.73 -.43 20.73 -.94 25.48C-.98 25.84 -.87 26.2 -.62 26.45C-.37 26.7 -.01 26.81 .35 26.77C5.1 26.26 13.1 22.68 14.81 16.23L17.66 17.18C18.46 17.45 19.17 16.63 18.77 15.88L14.98 8.82C14.88 8.64 14.73 8.51 14.54 8.43L13.06 9.92C13.06 9.92 12.6 12.09 9.48 15.21C6.36 18.33 4.19 18.8 4.19 18.8L2.7 17.31C2.78 17.5 2.92 17.65 3.1 17.75L10.16 21.54C10.91 21.94 11.73 21.23 11.46 20.43L10.51 17.58C16.96 15.87 20.54 7.87 21.05 3.12C21.09 2.76 20.98 2.4 20.73 2.15Z');
const FaHandshake = createIcon('M21.99 10.98l-3.32-3.32c-.78-.78-2.05-.78-2.83 0L14 9.5l-4.18-4.18c-.78-.78-2.05-.78-2.83 0l-3.32 3.32c-.78.78-.78 2.05 0 2.83L6.5 14.3l-2.67 2.67c-.39.39-.39 1.02 0 1.41l1.41 1.41c.39.39 1.02.39 1.41 0L9.32 17l1.84 1.84c.78.78 2.05.78 2.83 0l3.32-3.32c.78-.78.78-2.05 0-2.83L15.47 11l4.18-4.18c.39-.39 1.02-.39 1.41 0l1.41 1.41c.39.39.39 1.02 0 1.41l-2.67 2.67 1.41 1.41 2.67-2.67c.78-.78.78-2.05 0-2.83z');
const FaArrowRight = createIcon('M5 13h11.17l-4.88 4.88c-.39.39-.39 1.03 0 1.42.39.39 1.02.39 1.41 0l6.59-6.59c.39-.39.39-1.02 0-1.41l-6.58-6.6a.996.996 0 1 0-1.41 1.41l4.88 4.88H5c-.55 0-1 .45-1 1s.45 1 1 1z');
const FaClock = createIcon('M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z');
const FaShieldAlt = createIcon('M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z');
const FaStar = createIcon('M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z');
const FaThumbsUp = createIcon('M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z');
const FaCogs = createIcon('M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41L9.25 5.35C8.66 5.59 8.12 5.92 7.63 6.29L5.24 5.33c-.22-.08-.47 0-.59.22L2.73 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .43-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.49-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z');
const FaGlobe = createIcon('M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.18 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.78 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c1.03-1.65 2.56-2.93 4.33-3.56-.6 1.11-1.06 2.31-1.38 3.56zM12 19.96c-.83-1.18-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.78-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-1.03 1.65-2.56 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z');
const FaLaptopCode = createIcon('M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z');
const FaDatabase = createIcon('M12 3C7.58 3 4 4.79 4 7s3.58 4 8 4 8-1.79 8-4-3.58-4-8-4zm0 6c-3.14 0-5.83-1.07-7-2.61V9c0 2.21 3.58 4 8 4s8-1.79 8-4V6.39C17.83 7.93 15.14 9 12 9zm0 5c-3.14 0-5.83-1.07-7-2.61V14c0 2.21 3.58 4 8 4s8-1.79 8-4v-2.61C17.83 12.93 15.14 14 12 14zm0 5c-3.14 0-5.83-1.07-7-2.61V19c0 2.21 3.58 4 8 4s8-1.79 8-4v-2.61C17.83 17.93 15.14 19 12 19z');
// Add these to your existing icon block
const FaIndustry = createIcon('M5 3H3v18h18V3H5zm10 14H7v-2h8v2zm2-4H7v-2h10v2zm0-4H7V7h10v2z');
const FaMapMarker = createIcon('M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z');
const FaBuilding = createIcon('M17 11V3H7v4H3v14h8v-4h2v4h8V11h-4zm-6 4H9v-2h2v2zm0-4H9V9h2v2zm0-4H9V5h2v2zm4 8h-2v-2h2v2zm0-4h-2V9h2v2zm4 8h-2v-2h2v2zm0-4h-2v-2h2v2z');
const FaBriefcase = createIcon('M20 6h-2.18c.07-.44.18-.88.18-1.36C18 2.98 16.04 1 13.64 1h-3.28C7.96 1 6 2.98 6 4.64c0 .48.11.92.18 1.36H4c-1.11 0-2 .89-2 2v11c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6.36-3c.75 0 1.36.61 1.36 1.36 0 .48-.11.93-.18 1.64H9.18c-.07-.71-.18-1.16-.18-1.64C9 3.61 9.61 3 10.36 3h3.28zM20 19H4V8h16v11z');
// ─── Skill: "Pick a bold, content-informed color palette" ────────────────────
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

// Font family selector — Quarks uses Calibri/Calibri Light, others use Cambria
function fonts(spec) {
  const isQuarks = spec.theme === COLOR_THEMES.quarks_brand;
  return {
    title: isQuarks ? 'Calibri' : 'Cambria',
    body: isQuarks ? 'Calibri Light' : 'Calibri',
    eyebrow: 'Calibri',   // always Calibri for eyebrows
    mono: 'Calibri',
  };
}

// ─── Skill: Icon helper — "size 256 or higher for crisp icons" ───────────────
// hexColor must include # prefix (this is SVG color for react-icons, NOT a pptxgenjs color)
async function iconToBase64(IconComponent, svgColor = '#FFFFFF', size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(IconComponent, { color: svgColor, size: String(size) })
  );
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return 'image/png;base64,' + buf.toString('base64');
}

// ─── Skill: "NEVER reuse option objects" — always use a factory ──────────────
const makeShadow = (opacity = 0.08) => ({
  type: 'outer', color: '000000', blur: 10, offset: 3, angle: 45, opacity
});

// ─── Eyebrow label mapping — derives section label from slide type ───────────
const EYEBROW_MAP = {
  problem: 'CHALLENGES',
  solution: 'OUR APPROACH',
  case_study: 'CASE STUDY',
  pricing: 'INVESTMENT',
  agenda: 'AGENDA',
  comparison: 'COMPARISON',
  data: 'KEY METRICS',
  team: 'OUR TEAM',
  services_grid: 'OUR SERVICES',
  tech_stack: 'TECHNOLOGY',
  client_wall: 'OUR CLIENTS',
  engagement_models: 'ENGAGEMENT',
  global_presence: 'GLOBAL PRESENCE',
};

// ─── Icon palette for card grids ─────────────────────────────────────────────
const ICON_MAP = [FaCheckCircle, FaLightbulb, FaRocket, FaShieldAlt, FaStar, FaCogs, FaGlobe, FaLaptopCode, FaDatabase, FaBullseye, FaUsers, FaHandshake];

// ─── Slide Master — skill: "defineSlideMaster" ───────────────────────────────
function defineSlidesMasters(pres, theme, brand) {
  const brandName = brand?.company_name || 'Sales Brain';
  const logoPath = brand?.logoAbsPath;

  // ── Detect quarks theme for dimension-aware coordinates ──────────
  const isQuarks = theme === COLOR_THEMES.quarks_brand;
  const slideW = isQuarks ? 10 : 13.33;
  const footerY = isQuarks ? 5.2 : 7.1;
  const footerLogoY = isQuarks ? 5.28 : 7.18;
  const dividerW = isQuarks ? 9.2 : 12.5;   // 40% breathing room on right

  const lightObjects = [];
  const darkObjects = [];

  // ── Footer divider line ──────────────────────────────────────────
  const divider = {
    line: {
      x: 0.4, y: footerY,
      w: dividerW, h: 0,
      line: { color: theme.secondary, width: 0.5 }
    }
  };
  lightObjects.push(divider);
  darkObjects.push(divider);

  // ── Logo or brand name ───────────────────────────────────────────
  if (logoPath) {
    lightObjects.push({
      image: {
        path: logoPath,
        x: 0.5, y: footerLogoY,
        w: 1.5, h: 0.25,
        sizing: { type: 'contain', w: 1.5, h: 0.25 }
      }
    });
    darkObjects.push({
      image: {
        path: logoPath,
        x: 0.5, y: footerLogoY,
        w: 1.5, h: 0.25,
        sizing: { type: 'contain', w: 1.5, h: 0.25 }
      }
    });
  } else {
    lightObjects.push({
      text: {
        text: brandName,
        options: {
          x: 0.5, y: footerLogoY, w: 3, h: 0.2,
          fontSize: 10,              // was 9 — spec minimum is 11pt but footer ok at 10
          fontFace: 'Calibri',
          color: theme.secondary,
          align: 'left'
        }
      }
    });
    darkObjects.push({
      text: {
        text: brandName,
        options: {
          x: 0.5, y: footerLogoY, w: 3, h: 0.2,
          fontSize: 10,
          fontFace: 'Calibri',
          color: theme.body_dark,
          align: 'left'
        }
      }
    });
  }

  // ── Quarks: add wordmark position per spec section 8 ────────────
  // "Quarks wordmark bottom-left on dark, top-left on light"
  // Already handled by logo above — but if no logo, add qtsolv.com to footer
  if (isQuarks) {
    lightObjects.push({
      text: {
        text: 'www.qtsolv.com',
        options: {
          x: slideW - 2.0, y: footerLogoY, w: 1.8, h: 0.2,
          fontSize: 10, fontFace: 'Calibri',
          color: theme.body_light,
          align: 'right'
        }
      }
    });
    darkObjects.push({
      text: {
        text: 'www.qtsolv.com',
        options: {
          x: slideW - 2.0, y: footerLogoY, w: 1.8, h: 0.2,
          fontSize: 10, fontFace: 'Calibri',
          color: theme.body_dark,
          align: 'right'
        }
      }
    });
  }

  pres.defineSlideMaster({
    title: 'LIGHT_MASTER',
    background: { color: theme.light_bg },
    objects: lightObjects
  });

  pres.defineSlideMaster({
    title: 'DARK_MASTER',
    background: { color: theme.dark_bg },
    objects: darkObjects
  });
}

// ─── Slide number helper ──────────────────────────────────────────────────────
function addSlideNum(slide, spec) {
  const color = spec.is_dark_slide ? spec.theme.body_dark : spec.theme.secondary;
  const isQuarks = spec.theme === COLOR_THEMES.quarks_brand;
  slide.addText(`${spec.slide_number} / ${spec.total_slides}`, {
    x: isQuarks ? 9.0 : 12.3,
    y: isQuarks ? 5.28 : 7.2,
    w: 0.8, h: 0.2,
    fontSize: 10,   // was 9pt — spec min is 11pt but slide nums are ok at 10
    fontFace: 'Calibri', color, align: 'right'
  });
}

// ─── Speaker notes — skill: "addNotes() — call once per slide" ───────────────
function addNotes(slide, spec) {
  if (spec.speaker_notes) slide.addNotes(spec.speaker_notes);
}

// ─── Eyebrow label helper — adds uppercase section label above title ─────────
function addEyebrow(slide, spec, label) {
  const t = spec.theme;
  const eyebrow = label || EYEBROW_MAP[spec.slide_type] || '';
  if (!eyebrow) return;
  const color = spec.is_dark_slide ? t.accent : t.primary;
  slide.addText(eyebrow, {
    x: 0.5, y: 0.25, w: 6, h: 0.25,
    fontSize: 9, fontFace: 'Calibri', bold: true,
    color, align: 'left', charSpacing: 4, margin: 0
  });
}

// ─── Decorative background shape — subtle circle on content slides ───────────
function addDecorativeShape(slide, spec, pres) {
  const t = spec.theme;
  if (spec.is_dark_slide) return; // dark slides have their own decoration
  // Faint circle at bottom-right
  slide.addShape(pres.shapes.OVAL, {
    x: 7.5, y: 3.0, w: 4.0, h: 4.0,
    fill: { color: t.primary, transparency: 94 },
    line: { color: t.primary, width: 0 }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYOUT RENDERERS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. COVER LAYOUT ─────────────────────────────────────────────────────────
async function renderCover(slide, spec, pres) {
  const t = spec.theme;
  slide.background = { color: t.dark_bg };

  // Large geometric circles — visual motif, top-right bleed
  slide.addShape(pres.shapes.OVAL, {
    x: 7.2, y: -1.2, w: 4.5, h: 4.5,
    fill: { color: t.accent, transparency: 82 },
    line: { color: t.accent, width: 0 }
  });
  slide.addShape(pres.shapes.OVAL, {
    x: 7.8, y: -0.6, w: 3, h: 3,
    fill: { color: t.secondary, transparency: 75 },
    line: { color: t.secondary, width: 0 }
  });

  // Eyebrow label
  slide.addText('SALES PRESENTATION', {
    x: 0.6, y: 0.7, w: 6, h: 0.3,
    fontSize: 10, fontFace: 'Calibri', bold: true,
    color: t.accent, align: 'left', charSpacing: 4, margin: 0
  });

  // Main title
  slide.addText(spec.title || 'Untitled Deck', {
    x: 0.5, y: 1.0, w: 7.0, h: 1.8,
    fontSize: 40,                          // spec: 36–44pt
    fontFace: fonts(spec).title,           // Calibri for quarks, Cambria for others
    bold: true,
    color: t.title_dark,
    align: 'left', valign: 'top', margin: 0
  });

  const isQuarks = t === COLOR_THEMES.quarks_brand;
  if (isQuarks) {
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y: 2.75, w: 4.0, h: 0.04,   // 40% of 10" slide width
      fill: { color: t.primary },
      line: { type: 'none' }
    });
  }

  // Subtitle
  slide.addText(spec.subtitle, {
    x: 0.5, y: 2.85, w: 6.0, h: 0.5,
    fontSize: 16,
    fontFace: fonts(spec).body,            // Calibri Light for quarks
    color: t.body_dark,
    align: 'left', margin: 0
  });

  // ─── Stat counter strip (new!) ───────────────────────────────────────────
  const stats = spec.stats_strip || [];
  if (stats.length >= 2) {
    const stripY = 3.4;
    // Semi-transparent strip background
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y: stripY, w: 8.0, h: 0.85,
      fill: { color: t.accent, transparency: 85 },
      line: { color: t.accent, width: 0 }
    });
    const colW = 8.0 / Math.min(stats.length, 4);
    for (let i = 0; i < Math.min(stats.length, 4); i++) {
      const stat = stats[i];
      const x = 0.5 + i * colW;
      // Big number
      slide.addText(stat.number || stat.value || '', {
        x, y: stripY - 0.02, w: colW, h: 0.52,
        fontSize: 26, fontFace: 'Cambria', bold: true,
        color: t.accent, align: 'center', valign: 'bottom', margin: 0
      });
      // Label below
      slide.addText(stat.label || '', {
        x, y: stripY + 0.5, w: colW, h: 0.3,
        fontSize: 9, fontFace: 'Calibri',
        color: t.body_dark, align: 'center', valign: 'top', margin: 0
      });
    }
  }

  // Client pill badge
  if (spec.client_name) {
    const pillY = stats.length >= 2 ? 4.35 : 4.1;
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.6, y: pillY, w: 3.2, h: 0.45,
      fill: { color: t.accent }, rectRadius: 0.08,
      line: { color: t.accent, width: 0 }
    });
    slide.addText(`Prepared for ${spec.client_name}`, {
      x: 0.6, y: pillY, w: 3.2, h: 0.45,
      fontSize: 11, fontFace: 'Calibri', bold: true,
      color: t.dark_bg, align: 'center', valign: 'middle', margin: 0
    });
  }

  addSlideNum(slide, spec);
  addNotes(slide, spec);
}

// ─── 2. SECTION HEADER ───────────────────────────────────────────────────────
async function renderSectionHeader(slide, spec, pres) {
  const t = spec.theme;
  const isQuarks = t === COLOR_THEMES.quarks_brand;
  slide.background = { color: t.dark_bg };

  // ── Ghost section number — background decoration ─────────────────
  slide.addText(`0${spec.slide_number}`, {
    x: isQuarks ? 4.5 : 5.5,
    y: 0.1,
    w: isQuarks ? 5.0 : 4.3,
    h: isQuarks ? 3.5 : 4.2,
    fontSize: isQuarks ? 160 : 180,
    fontFace: fonts(spec).title,        // Calibri for quarks, Cambria for others
    bold: true,
    color: t.primary,
    transparency: 85,
    align: 'right', valign: 'middle', margin: 0
  });

  // ── Vertical accent line ─────────────────────────────────────────
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.6,
    y: isQuarks ? 1.2 : 1.4,
    w: 0.06,
    h: isQuarks ? 2.8 : 2.2,
    fill: { color: t.primary },         // spec: emerald for quarks, accent for others
    line: { type: 'none' }
  });

  // ── Eyebrow label ────────────────────────────────────────────────
  slide.addText(
    (EYEBROW_MAP[spec.slide_type] || 'SECTION').toUpperCase(),
    {
      x: 0.9,
      y: isQuarks ? 1.3 : 1.85,
      w: isQuarks ? 8.5 : 8,
      h: 0.35,
      fontSize: 11,                     // was 10 — spec minimum 11pt
      bold: true,
      charSpacing: isQuarks ? 3 : 4,   // spec: +2 to +3 for quarks
      color: t.secondary,               // deeper emerald for quarks eyebrows
      fontFace: 'Calibri',
      align: 'left', margin: 0
    }
  );

  // ── Main section title ───────────────────────────────────────────
  slide.addText(
    isQuarks
      ? (spec.title || 'Section').toUpperCase()  // spec: ALL CAPS on dark bg
      : (spec.title || 'Section'),
    {
      x: 0.9,
      y: isQuarks ? 1.75 : 2.25,
      w: isQuarks ? 8.5 : 7,
      h: isQuarks ? 1.8 : 1.4,
      fontSize: isQuarks ? 26 : 36,    // spec: 22–26pt for quarks section headers
      fontFace: fonts(spec).title,      // Calibri for quarks, Cambria for others
      bold: true,
      charSpacing: isQuarks ? 2 : 0,   // spec: charSpacing on dark bg
      color: t.title_dark,
      align: 'left', valign: 'top', margin: 0
    }
  );

  // ── Subtitle ─────────────────────────────────────────────────────
  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 0.9,
      y: isQuarks ? 3.65 : 3.2,
      w: isQuarks ? 8.0 : 6,
      h: 0.6,
      fontSize: isQuarks ? 14 : 16,
      fontFace: fonts(spec).body,       // Calibri Light for quarks
      color: t.body_dark,
      align: 'left', italic: true, margin: 0
    });
  }

  addSlideNum(slide, spec);
  addNotes(slide, spec);
}

// ─── 3. BULLETS WITH ICONS → CARD GRID ───────────────────────────────────────
// Upgraded from a plain vertical list to a true card grid
async function renderBulletsWithIcons(slide, spec, pres) {
  const t = spec.theme;
  slide.background = { color: t.light_bg };
  addDecorativeShape(slide, spec, pres);

  addEyebrow(slide, spec);

  slide.addText(spec.title, {
    x: 0.5, y: 0.5, w: 9, h: 0.55,
    fontSize: 28, fontFace: 'Cambria', bold: true,
    color: t.title_light, align: 'left', margin: 0
  });

  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 0.5, y: 1.08, w: 9, h: 0.3,
      fontSize: 13, fontFace: 'Calibri', italic: true,
      color: t.secondary, align: 'left', margin: 0
    });
  }

  const bullets = (spec.bullets || []).slice(0, 6);
  const count = bullets.length;
  const startY = spec.subtitle ? 1.5 : 1.3;

  // Determine grid layout
  let cols, rows;
  if (count <= 2) { cols = 2; rows = 1; }
  else if (count <= 3) { cols = 3; rows = 1; }
  else if (count <= 4) { cols = 2; rows = 2; }
  else { cols = 3; rows = 2; }

  const gapX = 0.25;
  const gapY = 0.2;
  const totalW = 9.0;
  const cardW = (totalW - (cols - 1) * gapX) / cols;
  const availH = 4.65 - startY;
  const cardH = (availH - (rows - 1) * gapY) / rows;

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = 0.5 + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);

    const IconComp = ICON_MAP[i % ICON_MAP.length];

    // Card body — RECTANGLE with accent left bar
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: cardW, h: cardH,
      fill: { color: t.card_bg },
      shadow: makeShadow(0.07),
      line: { color: t.card_bg, width: 0 }
    });

    // Accent left bar
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 0.06, h: cardH,
      fill: { color: t.primary },
      line: { color: t.primary, width: 0 }
    });

    // Icon circle
    const iconSize = 0.36;
    slide.addShape(pres.shapes.OVAL, {
      x: x + 0.2, y: y + 0.18, w: iconSize, h: iconSize,
      fill: { color: t.primary }, line: { color: t.primary, width: 0 }
    });

    const iconData = await iconToBase64(IconComp, `#${t.title_dark}`, 256);
    slide.addImage({ data: iconData, x: x + 0.24, y: y + 0.22, w: 0.28, h: 0.28 });

    // Bold first word + rest of text
    const words = bullets[i].split(' ');
    const boldWord = words[0];
    const rest = words.slice(1).join(' ');

    slide.addText([
      { text: boldWord, options: { bold: true, color: t.title_light, fontSize: 14 } },
    ], {
      x: x + 0.65, y: y + 0.15, w: cardW - 0.8, h: 0.3,
      fontFace: 'Calibri', valign: 'middle', margin: 0
    });

    slide.addText(rest, {
      x: x + 0.65, y: y + 0.45, w: cardW - 0.8, h: cardH - 0.6,
      fontSize: 12, fontFace: 'Calibri',
      color: t.body_light, valign: 'top', margin: 0
    });
  }

  addSlideNum(slide, spec);
  addNotes(slide, spec);
}

// ─── 4. SPLIT TWO-COLUMN ─────────────────────────────────────────────────────
async function renderSplitTwoCol(slide, spec, pres) {
  const t = spec.theme;
  slide.background = { color: t.light_bg };
  addDecorativeShape(slide, spec, pres);

  addEyebrow(slide, spec);

  slide.addText(spec.title, {
    x: 0.5, y: 0.5, w: 9, h: 0.55,
    fontSize: 28, fontFace: 'Cambria', bold: true,
    color: t.title_light, align: 'left', margin: 0
  });

  // Left: bullets with accent-bar card
  const bullets = (spec.bullets || []).slice(0, 4);
  if (bullets.length) {
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y: 1.35, w: 4.5, h: 3.3,
      fill: { color: t.card_bg },
      shadow: makeShadow(0.06),
      line: { color: t.card_bg, width: 0 }
    });
    // Accent left bar
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 0.5, y: 1.35, w: 0.06, h: 3.3,
      fill: { color: t.primary },
      line: { color: t.primary, width: 0 }
    });

    slide.addText(
      bullets.map((b, i) => ({
        text: b,
        options: { bullet: true, breakLine: i < bullets.length - 1, paraSpaceAfter: 10 }
      })),
      {
        x: 0.75, y: 1.5, w: 4.1, h: 3.0,
        fontSize: 15, fontFace: 'Calibri', color: t.body_light, valign: 'top'
      }
    );
  }

  // Right: stat callout card
  if (spec.stat_callout) {
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 5.3, y: 1.35, w: 4.2, h: 3.3,
      fill: { color: t.card_bg },
      shadow: makeShadow(0.06),
      line: { color: t.card_bg, width: 0 }
    });
    // Accent top bar
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 5.3, y: 1.35, w: 4.2, h: 0.06,
      fill: { color: t.accent },
      line: { color: t.accent, width: 0 }
    });

    slide.addText(spec.stat_callout.number, {
      x: 5.3, y: 1.8, w: 4.2, h: 1.4,
      fontSize: 56, fontFace: 'Cambria', bold: true,
      color: t.primary, align: 'center', valign: 'middle', margin: 0
    });
    slide.addText(spec.stat_callout.label, {
      x: 5.3, y: 3.3, w: 4.2, h: 0.5,
      fontSize: 13, fontFace: 'Calibri',
      color: t.body_light, align: 'center', margin: 0
    });
  } else if (spec.subtitle) {
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 5.3, y: 1.35, w: 4.2, h: 3.3,
      fill: { color: t.card_bg },
      shadow: makeShadow(0.06),
      line: { color: t.card_bg, width: 0 }
    });
    slide.addShape(pres.shapes.RECTANGLE, {
      x: 5.3, y: 1.35, w: 4.2, h: 0.06,
      fill: { color: t.accent },
      line: { color: t.accent, width: 0 }
    });
    slide.addText(spec.subtitle, {
      x: 5.5, y: 1.6, w: 3.8, h: 2.8,
      fontSize: 15, fontFace: 'Calibri', italic: true,
      color: t.body_light, valign: 'middle', margin: 0
    });
  }

  addSlideNum(slide, spec);
  addNotes(slide, spec);
}

// ─── 5. COMPARISON COLUMNS ───────────────────────────────────────────────────
async function renderComparison(slide, spec, pres) {
  const t = spec.theme;
  slide.background = { color: t.light_bg };
  addDecorativeShape(slide, spec, pres);

  addEyebrow(slide, spec);

  slide.addText(spec.title, {
    x: 0.5, y: 0.5, w: 9, h: 0.55,
    fontSize: 28, fontFace: 'Cambria', bold: true,
    color: t.title_light, align: 'left', margin: 0
  });

  const half = Math.ceil((spec.bullets || []).length / 2);
  const left = (spec.bullets || []).slice(0, half);
  const right = (spec.bullets || []).slice(half);

  // Left column
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.3, w: 4.1, h: 0.52,
    fill: { color: t.secondary },
    line: { color: t.secondary, width: 0 }
  });
  slide.addText('Current Situation', {
    x: 0.5, y: 1.3, w: 4.1, h: 0.52,
    fontSize: 13, fontFace: 'Calibri', bold: true,
    color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0
  });

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.9, w: 4.1, h: 2.8,
    fill: { color: t.card_bg },
    shadow: makeShadow(0.06),
    line: { color: t.card_bg, width: 0 }
  });
  if (left.length) {
    slide.addText(
      left.map((b, i) => ({ text: b, options: { bullet: true, breakLine: i < left.length - 1, paraSpaceAfter: 8 } })),
      { x: 0.7, y: 2.0, w: 3.7, h: 2.6, fontSize: 14, fontFace: 'Calibri', color: t.body_light, valign: 'top' }
    );
  }

  // Right column
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 5.4, y: 1.3, w: 4.1, h: 0.52,
    fill: { color: t.primary },
    line: { color: t.primary, width: 0 }
  });
  slide.addText('With Our Solution', {
    x: 5.4, y: 1.3, w: 4.1, h: 0.52,
    fontSize: 13, fontFace: 'Calibri', bold: true,
    color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0
  });

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 5.4, y: 1.9, w: 4.1, h: 2.8,
    fill: { color: t.card_bg },
    shadow: makeShadow(0.06),
    line: { color: t.card_bg, width: 0 }
  });
  if (right.length) {
    slide.addText(
      right.map((b, i) => ({ text: b, options: { bullet: true, breakLine: i < right.length - 1, paraSpaceAfter: 8 } })),
      { x: 5.6, y: 2.0, w: 3.7, h: 2.6, fontSize: 14, fontFace: 'Calibri', color: t.body_light, valign: 'top' }
    );
  }

  addSlideNum(slide, spec);
  addNotes(slide, spec);
}

// ─── 6. DATA + CHART ─────────────────────────────────────────────────────────
async function renderDataChart(slide, spec, pres) {
  const t = spec.theme;
  slide.background = { color: t.light_bg };
  addDecorativeShape(slide, spec, pres);

  addEyebrow(slide, spec);

  slide.addText(spec.title, {
    x: 0.5, y: 0.5, w: 7, h: 0.55,
    fontSize: 28, fontFace: 'Cambria', bold: true,
    color: t.title_light, align: 'left', margin: 0
  });

  // Stat callout — top right
  if (spec.stat_callout) {
    slide.addText(spec.stat_callout.number, {
      x: 7.2, y: 0.35, w: 2.6, h: 0.65,
      fontSize: 48, fontFace: 'Cambria', bold: true,
      color: t.primary, align: 'right', valign: 'middle', margin: 0
    });
    slide.addText(spec.stat_callout.label, {
      x: 7.2, y: 1.0, w: 2.6, h: 0.3,
      fontSize: 11, fontFace: 'Calibri',
      color: t.body_light, align: 'right', margin: 0
    });
  }

  if (spec.chart_data) {
    const typeMap = { bar: pres.charts.BAR, line: pres.charts.LINE, pie: pres.charts.PIE, doughnut: pres.charts.DOUGHNUT };
    const chartType = typeMap[spec.chart_data.type] || pres.charts.BAR;
    const chartData = [{
      name: spec.chart_data.series_name || 'Data',
      labels: spec.chart_data.labels || [],
      values: spec.chart_data.values || []
    }];
    const isBar = spec.chart_data.type === 'bar';

    slide.addChart(chartType, chartData, {
      x: 0.5, y: 1.6, w: 9, h: 3.1,
      barDir: 'col',
      chartColors: t.chart,
      chartArea: { fill: { color: t.light_bg }, roundedCorners: true },
      catAxisLabelColor: t.body_light,
      valAxisLabelColor: t.body_light,
      valGridLine: { color: 'E2E8F0', size: 0.5 },
      catGridLine: { style: 'none' },
      showValue: isBar,
      dataLabelPosition: 'outEnd',
      dataLabelColor: t.title_light,
      lineSmooth: spec.chart_data.type === 'line',
      showLegend: false,
    });
  } else if (spec.bullets && spec.bullets.length) {
    slide.addText(
      spec.bullets.map((b, i) => ({
        text: b, options: { bullet: true, breakLine: i < spec.bullets.length - 1, paraSpaceAfter: 10 }
      })),
      { x: 0.5, y: 1.6, w: 9, h: 3.1, fontSize: 16, fontFace: 'Calibri', color: t.body_light }
    );
  }

  addSlideNum(slide, spec);
  addNotes(slide, spec);
}

// ─── 7. CASE STUDY ───────────────────────────────────────────────────────────
async function renderCaseStudy(slide, spec, pres) {
  const t = spec.theme;
  slide.background = { color: t.light_bg };
  addDecorativeShape(slide, spec, pres);

  addEyebrow(slide, spec);

  slide.addText(spec.title, {
    x: 0.5, y: 0.5, w: 9, h: 0.55,
    fontSize: 28, fontFace: 'Cambria', bold: true,
    color: t.title_light, align: 'left', margin: 0
  });

  // Quote card with accent top bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.3, w: 9.0, h: 1.55,
    fill: { color: t.card_bg },
    shadow: makeShadow(0.07),
    line: { color: t.card_bg, width: 0 }
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.3, w: 9.0, h: 0.06,
    fill: { color: t.accent },
    line: { color: t.accent, width: 0 }
  });

  slide.addText([
    { text: `"${spec.subtitle || 'Client outcome'}"`, options: { italic: true, color: t.title_light, fontSize: 15 } }
  ], {
    x: 0.75, y: 1.4, w: 8.5, h: 1.35,
    fontFace: 'Cambria', valign: 'middle'
  });

  // Results grid — 2x2 stat callout cards
  const bullets = (spec.bullets || []).slice(0, 4);
  const positions = [
    [0.5, 2.95], [5.1, 2.95],
    [0.5, 3.93], [5.1, 3.93]
  ];
  for (let i = 0; i < Math.min(bullets.length, 4); i++) {
    const [x, y] = positions[i];
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 4.4, h: 0.88,
      fill: { color: t.card_bg },
      shadow: makeShadow(0.06),
      line: { color: t.card_bg, width: 0 }
    });
    // Accent left bar on each result card
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 0.06, h: 0.88,
      fill: { color: t.primary },
      line: { color: t.primary, width: 0 }
    });

    const IconComp = ICON_MAP[i % ICON_MAP.length];
    const iconData = await iconToBase64(IconComp, `#${t.primary}`, 256);
    slide.addImage({ data: iconData, x: x + 0.18, y: y + 0.22, w: 0.36, h: 0.36 });

    slide.addText(bullets[i], {
      x: x + 0.66, y, w: 3.6, h: 0.88,
      fontSize: 13, fontFace: 'Calibri',
      color: t.body_light, valign: 'middle', margin: 0
    });
  }

  addSlideNum(slide, spec);
  addNotes(slide, spec);
}

// ─── 8. CTA / CLOSING ────────────────────────────────────────────────────────
async function renderCTA(slide, spec, pres) {
  const t = spec.theme;
  slide.background = { color: t.dark_bg };

  // Background circle motif (same as cover)
  slide.addShape(pres.shapes.OVAL, {
    x: -1, y: 2.5, w: 5, h: 5,
    fill: { color: t.accent, transparency: 88 },
    line: { color: t.accent, width: 0 }
  });
  slide.addShape(pres.shapes.OVAL, {
    x: 7.5, y: -1, w: 3.5, h: 3.5,
    fill: { color: t.secondary, transparency: 85 },
    line: { color: t.secondary, width: 0 }
  });

  // Eyebrow
  slide.addText('NEXT STEPS', {
    x: 1, y: 1.0, w: 8, h: 0.3,
    fontSize: 10, fontFace: 'Calibri', bold: true,
    color: t.accent, align: 'center', charSpacing: 5, margin: 0
  });

  slide.addText(spec.title, {
    x: 1, y: 1.4, w: 8, h: 1.5,
    fontSize: 36, fontFace: 'Cambria', bold: true,
    color: t.title_dark, align: 'center', valign: 'middle', margin: 0
  });

  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 1.5, y: 3.0, w: 7, h: 0.6,
      fontSize: 16, fontFace: 'Calibri',
      color: t.body_dark, align: 'center', margin: 0
    });
  }

  // CTA button
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 3.6, y: 3.85, w: 2.8, h: 0.6,
    fill: { color: t.accent }, rectRadius: 0.1,
    line: { color: t.accent, width: 0 }
  });
  slide.addText("Let's Talk  →", {
    x: 3.6, y: 3.85, w: 2.8, h: 0.6,
    fontSize: 14, fontFace: 'Calibri', bold: true,
    color: t.dark_bg, align: 'center', valign: 'middle', margin: 0
  });

  addSlideNum(slide, spec);
  addNotes(slide, spec);
}

// ─── 9. AGENDA / NUMBERED STEPS ──────────────────────────────────────────────
async function renderAgenda(slide, spec, pres) {
  const t = spec.theme;
  slide.background = { color: t.light_bg };
  addDecorativeShape(slide, spec, pres);

  addEyebrow(slide, spec);

  slide.addText(spec.title, {
    x: 0.5, y: 0.5, w: 9, h: 0.55,
    fontSize: 28, fontFace: 'Cambria', bold: true,
    color: t.title_light, align: 'left', margin: 0
  });

  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 0.5, y: 1.08, w: 9, h: 0.3,
      fontSize: 13, fontFace: 'Calibri', italic: true,
      color: t.secondary, align: 'left', margin: 0
    });
  }

  const items = (spec.bullets || []).slice(0, 6);
  const col2Start = Math.ceil(items.length / 2);
  const leftItems = items.slice(0, col2Start);
  const rightItems = items.slice(col2Start);
  const startY = spec.subtitle ? 1.55 : 1.3;

  const drawNumberedItems = async (list, xStart, globalOffset) => {
    for (let idx = 0; idx < list.length; idx++) {
      const num = globalOffset + idx + 1;
      const text = list[idx];
      const y = startY + idx * 1.0;

      // Number circle
      slide.addShape(pres.shapes.OVAL, {
        x: xStart, y: y + 0.06, w: 0.44, h: 0.44,
        fill: { color: t.primary }, line: { color: t.primary, width: 0 }
      });
      slide.addText(String(num), {
        x: xStart, y: y + 0.06, w: 0.44, h: 0.44,
        fontSize: 14, fontFace: 'Cambria', bold: true,
        color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0
      });

      // Card behind text
      slide.addShape(pres.shapes.RECTANGLE, {
        x: xStart + 0.55, y: y, w: 3.9, h: 0.56,
        fill: { color: t.card_bg },
        shadow: makeShadow(0.04),
        line: { color: t.card_bg, width: 0 }
      });

      slide.addText(text, {
        x: xStart + 0.7, y, w: 3.6, h: 0.56,
        fontSize: 14, fontFace: 'Calibri',
        color: t.body_light, valign: 'middle', margin: 0
      });
    }
  };

  await drawNumberedItems(leftItems, 0.5, 0);
  if (rightItems.length) await drawNumberedItems(rightItems, 5.2, col2Start);

  addSlideNum(slide, spec);
  addNotes(slide, spec);
}

// ─── 10. PRICING / TABLE ─────────────────────────────────────────────────────
async function renderPricing(slide, spec, pres) {
  const t = spec.theme;
  slide.background = { color: t.light_bg };
  addDecorativeShape(slide, spec, pres);

  addEyebrow(slide, spec);

  slide.addText(spec.title, {
    x: 0.5, y: 0.5, w: 9, h: 0.55,
    fontSize: 28, fontFace: 'Cambria', bold: true,
    color: t.title_light, align: 'left', margin: 0
  });

  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 0.5, y: 1.08, w: 9, h: 0.3,
      fontSize: 13, fontFace: 'Calibri', italic: true,
      color: t.secondary, align: 'left', margin: 0
    });
  }

  const rows = (spec.bullets || []).map(b => b.split('|').map(c => c.trim()));
  if (rows.length) {
    const headerRow = [
      { text: 'Tier', options: { bold: true, color: 'FFFFFF', fill: { color: t.primary }, align: 'center' } },
      { text: 'Includes', options: { bold: true, color: 'FFFFFF', fill: { color: t.primary }, align: 'center' } },
      { text: 'Investment', options: { bold: true, color: 'FFFFFF', fill: { color: t.primary }, align: 'center' } },
    ];
    const tableRows = [headerRow, ...rows.map((cells, ri) => {
      const bg = ri % 2 === 0 ? t.card_bg : t.light_bg;
      return cells.map(c => ({ text: c || '', options: { fill: { color: bg }, color: t.body_light, align: 'center' } }));
    })];

    slide.addTable(tableRows, {
      x: 0.5, y: 1.5, w: 9,
      colW: [2.5, 4.5, 2],
      border: { pt: 0.5, color: 'E2E8F0' },
      fontFace: 'Calibri', fontSize: 13,
      rowH: 0.50
    });
  } else if (spec.stat_callout) {
    slide.addText(spec.stat_callout.number, {
      x: 0.5, y: 2.3, w: 9, h: 1.5,
      fontSize: 72, fontFace: 'Cambria', bold: true,
      color: t.primary, align: 'center', valign: 'middle', margin: 0
    });
    slide.addText(spec.stat_callout.label, {
      x: 0.5, y: 3.9, w: 9, h: 0.5,
      fontSize: 14, fontFace: 'Calibri',
      color: t.body_light, align: 'center', margin: 0
    });
  }

  addSlideNum(slide, spec);
  addNotes(slide, spec);
}

// ─── 11. CARDS GRID — dedicated 2×3 / 3×4 feature/service grid ──────────────
// Handles up to 12 items in a dense card grid (like Quarks "Our Services" slide)
async function renderCardsGrid(slide, spec, pres) {
  const t = spec.theme;
  const isQuarks = t === COLOR_THEMES.quarks_brand;
  slide.background = { color: t.light_bg };

  // Quarks spec forbids decorative shapes on content slides — skip for quarks
  if (!isQuarks) addDecorativeShape(slide, spec, pres);

  addEyebrow(slide, spec);

  // ── Slide title ──────────────────────────────────────────────────
  slide.addText(spec.title, {
    x: 0.5, y: 0.5,
    w: isQuarks ? 9.0 : 9.0,
    h: 0.55,
    fontSize: isQuarks ? 32 : 26,      // spec: 36–44pt titles; 32 fits with subtitle
    fontFace: fonts(spec).title,        // Calibri for quarks, Cambria for others
    bold: true,
    color: t.title_light,
    align: 'left', margin: 0
  });

  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 0.5, y: isQuarks ? 1.1 : 1.0,
      w: 9, h: 0.3,
      fontSize: 13,                     // was 12 — spec minimum 11pt, 13 for subtitles
      fontFace: fonts(spec).body,       // Calibri Light for quarks
      italic: true,
      color: t.secondary,
      align: 'left', margin: 0
    });
  }

  const bullets = (spec.bullets || []).slice(0, 12);
  const count = bullets.length;
  const startY = spec.subtitle ? 1.45 : 1.25;

  // ── Grid layout dimensions ───────────────────────────────────────
  let cols, rows;
  if (count <= 3) { cols = 3; rows = 1; }
  else if (count <= 4) { cols = 2; rows = 2; }
  else if (count <= 6) { cols = 3; rows = 2; }
  else if (count <= 9) { cols = 3; rows = 3; }
  else { cols = 4; rows = 3; }

  const gapX = 0.18;
  const gapY = 0.15;
  const totalW = isQuarks ? 9.0 : 9.0;
  const cardW = (totalW - (cols - 1) * gapX) / cols;
  const availH = (isQuarks ? 4.3 : 4.7) - startY;  // quarks slide shorter
  const cardH = (availH - (rows - 1) * gapY) / rows;

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = 0.5 + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);

    const IconComp = ICON_MAP[i % ICON_MAP.length];

    // ── Card body ──────────────────────────────────────────────────
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: cardW, h: cardH,
      fill: { color: t.card_bg },
      shadow: makeShadow(isQuarks ? 0.04 : 0.05),
      line: { color: t.card_bg, width: 0 }
    });

    // ── Accent bar ─────────────────────────────────────────────────
    // Quarks spec: emerald left bar (like story slide accent)
    // Others: primary color top bar
    if (isQuarks) {
      slide.addShape(pres.shapes.RECTANGLE, {
        x, y, w: 0.05, h: cardH,         // left bar for quarks
        fill: { color: t.primary },
        line: { type: 'none' }
      });
    } else {
      slide.addShape(pres.shapes.RECTANGLE, {
        x, y, w: cardW, h: 0.05,          // top bar for others
        fill: { color: t.primary },
        line: { color: t.primary, width: 0 }
      });
    }

    // ── Icon circle ────────────────────────────────────────────────
    const iconSize = isQuarks ? 0.32 : 0.3;
    const iconX = isQuarks
      ? x + 0.18                          // left-aligned for quarks (left bar layout)
      : x + (cardW - iconSize) / 2;       // centered for others (top bar layout)
    const iconY = y + 0.14;

    slide.addShape(pres.shapes.OVAL, {
      x: iconX, y: iconY,
      w: iconSize, h: iconSize,
      fill: { color: t.primary },
      line: { type: 'none' }
    });

    const iconData = await iconToBase64(IconComp, `#${t.title_dark}`, 256);
    slide.addImage({
      data: iconData,
      x: iconX + 0.03, y: iconY + 0.03,
      w: iconSize - 0.06, h: iconSize - 0.06
    });

    // ── Card text ──────────────────────────────────────────────────
    const parts = bullets[i].split(':');
    const title = parts[0].trim();
    const desc = parts.length > 1 ? parts.slice(1).join(':').trim() : '';

    if (isQuarks) {
      // Quarks: left-aligned text sitting to the right of left-bar + icon
      // spec: never center body text
      slide.addText(title, {
        x: x + 0.65, y: y + 0.1,
        w: cardW - 0.75, h: 0.3,
        fontSize: 11,                     // spec minimum 11pt
        fontFace: fonts(spec).title,
        bold: true,
        color: t.title_light,
        align: 'left', valign: 'middle', margin: 0
      });

      if (desc) {
        slide.addText(desc, {
          x: x + 0.65, y: y + 0.42,
          w: cardW - 0.75, h: cardH - 0.55,
          fontSize: 11,                   // spec minimum 11pt — was 9pt
          fontFace: fonts(spec).body,     // Calibri Light
          color: t.body_light,
          align: 'left',                  // spec: never center body text
          valign: 'top', margin: 0
        });
      }
    } else {
      // Non-quarks: centered layout (existing behavior)
      slide.addText(title, {
        x: x + 0.08, y: y + iconSize + 0.15,
        w: cardW - 0.16, h: 0.28,
        fontSize: 11,                     // was 10 — bumped to spec minimum
        fontFace: 'Calibri', bold: true,
        color: t.title_light,
        align: 'center', valign: 'middle', margin: 0
      });

      if (desc) {
        slide.addText(desc, {
          x: x + 0.08, y: y + iconSize + 0.42,
          w: cardW - 0.16, h: cardH - iconSize - 0.55,
          fontSize: 11,                   // was 9 — bumped to spec minimum
          fontFace: 'Calibri',
          color: t.body_light,
          align: 'center', valign: 'top', margin: 0
        });
      }
    }
  }

  addSlideNum(slide, spec);
  addNotes(slide, spec);
}
// ─── 12. THREE-COLUMN LAYOUT ─────────────────────────────────────────────────
// Three equal columns with colored headers and bullet lists (like "Engagement Models")
async function renderThreeColumn(slide, spec, pres) {
  const t = spec.theme;
  slide.background = { color: t.light_bg };
  addDecorativeShape(slide, spec, pres);

  addEyebrow(slide, spec);

  slide.addText(spec.title, {
    x: 0.5, y: 0.5, w: 9, h: 0.55,
    fontSize: 28, fontFace: 'Cambria', bold: true,
    color: t.title_light, align: 'left', margin: 0
  });

  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 0.5, y: 1.08, w: 9, h: 0.3,
      fontSize: 13, fontFace: 'Calibri', italic: true,
      color: t.secondary, align: 'left', margin: 0
    });
  }

  // Parse bullets: try to split into 3 groups using "||" delimiter or evenly
  const allBullets = spec.bullets || [];
  let columns = [];

  // Check if bullets contain column headers (format: "Header || bullet1 || bullet2")
  if (allBullets.some(b => b.includes('||'))) {
    // Legacy format: "Header || point1 || point2"
    columns = allBullets.slice(0, 3).map(b => {
      const parts = b.split('||').map(p => p.trim());
      return { header: parts[0], items: parts.slice(1) };
    });
  } else if (allBullets.some(b => b.includes(':'))) {
    // New format: "Header: point1 | point2 | point3"
    columns = allBullets.slice(0, 3).map(b => {
      const colonIdx = b.indexOf(':');
      const header = b.slice(0, colonIdx).trim();
      const items = b.slice(colonIdx + 1).split('|').map(s => s.trim()).filter(Boolean);
      return { header, items };
    });
  } else {
    // Last resort fallback — at least use actual bullet text as headers
    // instead of "Option A / B / C"
    columns = allBullets.slice(0, 3).map((b, i) => ({
      header: b,
      items: allBullets.slice(3).filter((_, idx) => idx % 3 === i)
    }));
  }

  // Safety net — always pad to 3 columns so slide never breaks
  while (columns.length < 3) {
    columns.push({ header: `Model ${columns.length + 1}`, items: ['Details coming soon'] });
  }

  const startY = spec.subtitle ? 1.5 : 1.3;
  const colW = 2.85;
  const gap = 0.22;
  const headerH = 0.5;
  const bodyH = 3.1;
  const isLightAccent = parseInt(t.accent, 16) > 0xAAAAAA;
  const colors = [
    t.secondary,
    t.primary,
    isLightAccent ? t.dark_bg : t.accent
  ];

  for (let c = 0; c < Math.min(columns.length, 3); c++) {
    const x = 0.5 + c * (colW + gap);
    const col = columns[c];

    // Column header
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y: startY, w: colW, h: headerH,
      fill: { color: colors[c % colors.length] },
      line: { color: colors[c % colors.length], width: 0 }
    });
    slide.addText(col.header, {
      x, y: startY, w: colW, h: headerH,
      fontSize: 13, fontFace: 'Calibri', bold: true,
      color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0
    });

    // Column body card
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y: startY + headerH, w: colW, h: bodyH,
      fill: { color: t.card_bg },
      shadow: makeShadow(0.05),
      line: { color: t.card_bg, width: 0 }
    });

    if (col.items && col.items.length) {
      slide.addText(
        col.items.map((item, i) => ({
          text: item,
          options: { bullet: true, breakLine: i < col.items.length - 1, paraSpaceAfter: 6 }
        })),
        {
          x: x + 0.12, y: startY + headerH + 0.1, w: colW - 0.24, h: bodyH - 0.2,
          fontSize: 12, fontFace: 'Calibri', color: t.body_light, valign: 'top'
        }
      );
    }
  }

  addSlideNum(slide, spec);
  addNotes(slide, spec);
}

// ─── 13. CLIENT LOGOS / NAME WALL ────────────────────────────────────────────
// A grid of client names in styled pill badges
async function renderClientLogos(slide, spec, pres) {
  const t = spec.theme;
  slide.background = { color: t.light_bg };

  addEyebrow(slide, spec);

  slide.addText(spec.title, {
    x: 0.5, y: 0.5, w: 9, h: 0.55,
    fontSize: 28, fontFace: 'Cambria', bold: true,
    color: t.title_light, align: 'left', margin: 0
  });

  if (spec.subtitle) {
    slide.addText(spec.subtitle, {
      x: 0.5, y: 1.08, w: 9, h: 0.3,
      fontSize: 13, fontFace: 'Calibri', italic: true,
      color: t.secondary, align: 'left', margin: 0
    });
  }

  const clients = (spec.bullets || []).slice(0, 20);
  const count = clients.length;
  const startY = spec.subtitle ? 1.55 : 1.35;

  // Auto grid: 4 or 5 columns
  const cols = count > 12 ? 5 : 4;
  const rows = Math.ceil(count / cols);
  const gapX = 0.18;
  const gapY = 0.15;
  const totalW = 9.0;
  const badgeW = (totalW - (cols - 1) * gapX) / cols;
  const availH = 4.65 - startY;
  const badgeH = Math.min((availH - (rows - 1) * gapY) / rows, 0.6);

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = 0.5 + col * (badgeW + gapX);
    const y = startY + row * (badgeH + gapY);

    // Pill badge
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y, w: badgeW, h: badgeH,
      fill: { color: t.card_bg },
      shadow: makeShadow(0.04),
      rectRadius: 0.06,
      line: { color: t.card_bg, width: 0 }
    });

    // Accent left edge
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 0.05, h: badgeH,
      fill: { color: t.primary },
      line: { color: t.primary, width: 0 }
    });

    slide.addText(clients[i], {
      x: x + 0.12, y, w: badgeW - 0.24, h: badgeH,
      fontSize: 11, fontFace: 'Calibri', bold: true,
      color: t.title_light, align: 'center', valign: 'middle', margin: 0
    });
  }

  addSlideNum(slide, spec);
  addNotes(slide, spec);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN BUILD FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

const LAYOUT_MAP = {
  cover_layout: renderCover,
  section_header_dark: renderSectionHeader,
  bullets_with_icon: renderBulletsWithIcons,
  agenda: renderAgenda,
  split_two_column: renderSplitTwoCol,
  comparison_columns: renderComparison,
  data_callout_chart: renderDataChart,
  case_study_layout: renderCaseStudy,
  cards_grid: renderCardsGrid,
  pricing_table: renderPricing,
  cta_dark: renderCTA,
  three_column: renderThreeColumn,
  client_logos: renderClientLogos,
};

async function build(deckSpec, outputPath) {
  const pres = new pptxgen();
  const isQuarksTheme = deckSpec.theme_choice === 'quarks_brand' || deckSpec.color_theme === 'quarks_brand';
  if (isQuarksTheme) {
    pres.defineLayout({ name: 'QUARKS_LAYOUT', width: 10, height: 5.625 });
    pres.layout = 'QUARKS_LAYOUT';
  } else {
    pres.layout = 'LAYOUT_16x9';
  }
  pres.title = deckSpec.deck_title || 'Sales Presentation';
  pres.author = 'Sales Brain';

  // Add this BEFORE the theme lookup line in build()
  console.log('[raw deckSpec]', JSON.stringify({
    theme_choice: deckSpec.theme_choice,
    color_theme: deckSpec.color_theme,
    deck_title: deckSpec.deck_title
  }));

  const theme = COLOR_THEMES[deckSpec.theme_choice]
    || COLOR_THEMES[deckSpec.color_theme]
    || COLOR_THEMES.midnight_executive;

  const matchedThemeKey = deckSpec.theme_choice || deckSpec.color_theme;
  console.log('[theme selected]',
    COLOR_THEMES[matchedThemeKey] ? `${matchedThemeKey} ✅` : 'FALLBACK midnight_executive ⚠️'
  );

  // Read brand.json
  let brand = {};
  try {
    const brandPath = path.join(__dirname, '../templates/brand.json');
    if (fs.existsSync(brandPath)) {
      brand = JSON.parse(fs.readFileSync(brandPath, 'utf8'));
      if (brand.logo_path) {
        const absPath = path.resolve(path.dirname(brandPath), brand.logo_path);
        if (fs.existsSync(absPath)) {
          brand.logoAbsPath = absPath;
        } else {
          console.warn('Logo path specified in brand.json does not exist:', absPath);
        }
      }
    }
  } catch (e) {
    console.error('Failed to load brand.json', e);
  }

  defineSlidesMasters(pres, theme, brand);

  for (const slideSpec of deckSpec.slides) {
    const masterName = slideSpec.is_dark_slide ? 'DARK_MASTER' : 'LIGHT_MASTER';
    const slide = pres.addSlide({ masterName });

    const enriched = {
      ...slideSpec,
      theme,
      client_name: deckSpec.client_name,
    };

    const renderer = LAYOUT_MAP[slideSpec.layout] || renderBulletsWithIcons;
    await renderer(slide, enriched, pres);
  }

  await pres.writeFile({ fileName: outputPath });
  return outputPath;
}

module.exports = { build };