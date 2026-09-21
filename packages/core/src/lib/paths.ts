/**
 * Application directory layout under a single root directory.
 *
 * Pure (no platform APIs): each runtime supplies the root itself —
 *   Node (server/desktop):  `~/.nextdo`  (see `nodeDefaultRoot` in server/app)
 *   Expo mobile:            `FileSystem.documentDirectory + '.nextdo/'`
 *
 * Convention: directory values end with '/'; file values do not.
 * Forward slashes are used everywhere (Windows accepts both).
 */

export interface NextdoPaths {
  root: string;
  /** SQLite database file (nextdo.db). */
  db: string;
  /** Skill definitions (SKILL.md + files). */
  skills: string;
  /** Agent working directories. */
  workspace: string;
  /** Task files. */
  tasks: string;
  /** Forum posts. */
  forum: string;
  /** Notes. */
  notes: string;
  /** Desktop logs (desktop.log, audit.log). */
  desktopLogs: string;
  /** Mobile logs (mobile.log). */
  mobileLogs: string;
}

export function createNextdoPaths(rootDir: string): NextdoPaths {
  const root = rootDir.endsWith('/') ? rootDir : `${rootDir}/`;
  return {
    root,
    db: `${root}nextdo.db`,
    skills: `${root}skills/`,
    workspace: `${root}workspace/`,
    tasks: `${root}tasks/`,
    forum: `${root}forum/`,
    notes: `${root}notes/`,
    desktopLogs: `${root}logs/desktop/`,
    mobileLogs: `${root}logs/mobile/`,
  };
}
