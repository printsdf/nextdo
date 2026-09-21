/**
 * Babel plugin: replace `import.meta` with the CJS-equivalent file URL so
 * ESM-only packages (e.g. @powersync/web, which locates its worker script
 * via `import.meta.url`) merely PARSE once babel-jest compiles them to CJS.
 * The code path is never executed in tests — this is a parse-time fix.
 *
 * This lives in a FILE (referenced by path from jest.config.mjs) rather
 * than being inlined there on purpose: jest serializes the project config
 * to its worker processes as JSON, which would silently drop an inline
 * plugin's `visitor` functions — parallel (multi-worker) transforms would
 * then emit raw `import.meta` (SyntaxError) and cache that broken output
 * under the same key (the cache key also drops functions). A plugin
 * loaded by path is `require`d inside each worker, so the visitor
 * survives serialization.
 */
module.exports = function (api) {
  api.assertVersion(7);
  return {
    name: 'nextdo-import-meta-url',
    visitor: {
      MetaProperty(path) {
        if (path.node.meta.name !== 'import') {
          return;
        }
        // Covers both bare `import.meta` and `import.meta.url` (the `.url`
        // property access sits on the surrounding MemberExpression).
        path.replaceWithSourceString(
          '({ url: require("url").pathToFileURL(__filename).href })',
        );
      },
    },
  };
};
