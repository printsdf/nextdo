/**
 * Typed error hierarchy (spec: project/conventions.md §Error Handling).
 *
 * Every application error extends NextdoError and carries a stable
 * `code` so the UI can branch without parsing messages.
 */

export class NextdoError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Domain validation failure (invariants, transitions, incomplete input). */
export class ValidationNextdoError extends NextdoError {}

/** Local sync / storage layer failure. */
export class SyncNextdoError extends NextdoError {}

/** Engine input/output contract violation. */
export class EngineNextdoError extends NextdoError {}

/** Local database (PowerSync/Kysely) failure. */
export class StorageNextdoError extends NextdoError {}
