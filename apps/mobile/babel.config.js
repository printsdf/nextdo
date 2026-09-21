module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // NativeWind v4: JSX is compiled through the css-interop so the
      // `className` prop works on RN primitives (nativewind 4.x setup).
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
