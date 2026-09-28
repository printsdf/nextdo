/**
 * Minimal structured logger for the server process.
 *
 * The repo's single logger (packages/core/src/lib/logger.ts) is NOT
 * importable here — @nextdo/server is isolated (spec:
 * project/directory-structure.md Rule 1). This wrapper keeps the same
 * discipline: it is the only logging path in server/app (console is
 * forbidden everywhere else by lint).
 *
 * Log WHAT happened, never user free-text content (inbox items contain
 * personal data) and never tokens/secrets — with NO sanctioned exceptions.
 * (The owner token's only display path is the ONE `POST /claim` 200 body —
 * src/owner-token.ts claimOwnerToken, task 09-28; it never appears in a
 * log line.)
 */
export const logger = {
  info(message: string): void {
    console.info(`[nextdo-server] ${message}`);
  },
  error(message: string, error?: unknown): void {
    if (error === undefined) {
      console.error(`[nextdo-server] ${message}`);
    } else {
      console.error(`[nextdo-server] ${message}`, error);
    }
  },
};
