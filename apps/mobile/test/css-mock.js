/**
 * Jest stub for `import '../global.css'` (see jest.config.js). Metro +
 * NativeWind process the real CSS; in tests the style registration is
 * irrelevant — components render unstyled.
 */
module.exports = {};
