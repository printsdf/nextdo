/**
 * Root route (design.md §2 — Now 是第一个 tab): landing redirect so the app
 * opens on the Now tab instead of the router's 404 screen.
 */
import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/now" />;
}
