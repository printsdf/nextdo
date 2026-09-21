/**
 * @nextdo/core — isomorphic shared package.
 *
 * Exports types, constants, and pure utility libraries shared by
 * server/app, apps/mobile, and apps/desktop. This barrel is safe to
 * import from bundler environments (Expo): it must never pull in Node
 * builtins. Node-only utilities (JSON file I/O) live in the `./json`
 * subpath export.
 */

// types
export * from './types/task';
export * from './types/agent';
export * from './types/channel';
export * from './types/forum';
export * from './types/skill';
export * from './types/note';
export * from './types/session';
export * from './types/state';
export * from './types/events';
export * from './types/ipc';

// constants
export * from './constants/schema-version';
export * from './constants/agent-types';
export * from './constants/task-statuses';
export * from './constants/task-types';

// lib (pure)
export * from './lib/logger';
export * from './lib/paths';
export * from './lib/errors';
export * from './lib/slugify';
