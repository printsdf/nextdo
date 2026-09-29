/**
 * Robust back navigation (web deep-load fix).
 *
 * `router.back()` requires a parent in the navigation stack. On native there
 * is always a tab root under a detail route, but on web a page can boot
 * directly on a subroute (refresh / bookmark / hard navigation to
 * `/projects/[id]`, `/focus/[id]`, …) — the stack then has no parent, the
 * GO_BACK action is unhandled (dev-only warning) and the back button does
 * nothing. When there is no parent, replace the current route with the
 * screen's tab root so the user always lands somewhere sensible
 * (replace, not push — leaves no dead history entry).
 */
import { router } from 'expo-router';

export function goBack(fallbackPath: string): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallbackPath);
  }
}
