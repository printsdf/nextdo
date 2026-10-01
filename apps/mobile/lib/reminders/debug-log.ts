/**
 * Desktop delivery debug channel (task 09-30, field-diagnostics for the
 * desktop notification path): the RELEASE build serves the web bundle from
 * the loopback static server (`http://127.0.0.1:52123`, see the desktop
 * `lib.rs`); when that server was started with `NEXTDO_NOTIFY_DEBUG=1` it
 * also accepts `POST /__log` and appends the JSON body to a log file the
 * developer can read. This module POSTs compact delivery diagnostics
 * (reconcile decisions, send outcomes) to that endpoint.
 *
 * Inert by design everywhere else: the origin check no-ops on the expo
 * dev server, plain web, and native; the fetch is fire-and-forget and can
 * never throw (a debug channel must not affect delivery).
 */

const LOOPBACK_ORIGIN = 'http://127.0.0.1:52123';

type LogHost = {
  location?: { origin?: string };
  fetch?: (url: string, init: {
    method: string;
    body: string;
    keepalive: boolean;
  }) => Promise<unknown>;
};

export function postDebugLog(entry: Record<string, unknown>): void {
  try {
    const host = globalThis as LogHost;
    if (host.location?.origin !== LOOPBACK_ORIGIN || host.fetch === undefined) return;
    void host
      .fetch('/__log', { method: 'POST', body: JSON.stringify(entry), keepalive: true })
      .catch(() => undefined);
  } catch {
    // A debug channel never affects delivery.
  }
}
