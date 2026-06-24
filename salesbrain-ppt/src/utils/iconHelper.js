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
