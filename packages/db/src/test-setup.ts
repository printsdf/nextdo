/**
 * Jest setup: pin the device timezone so "device-local" window and
 * local-date logic is deterministic on any CI/dev machine.
 *
 * NOTE: the effective pin is `TZ=UTC` in package.json's test script —
 * ICU resolves the process TZ at worker startup, before this file runs,
 * so assigning process.env.TZ here alone is not enough on macOS.
 */
process.env.TZ = 'UTC';
