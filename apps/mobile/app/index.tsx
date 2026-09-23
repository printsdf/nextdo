/**
 * Root route (design.md §4.1 — 收件箱是第一个 tab): landing redirect so the app
 * opens on the Inbox tab instead of the router's 404 screen.
 */
import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/inbox" />;
}
