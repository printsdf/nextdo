/**
 * Smoke test: the four tabs (Now / Inbox / Projects / Review) render
 * without crashing — empty states are the expected content (no synced data
 * exists in the test environment).
 *
 * The PowerSync layer is mocked at the package boundary — this test
 * exercises the SHELL (route tree, root layout, tab bar, screens, empty
 * states), not sync. The data path is covered by the packages/db query
 * tests. The mocks are self-contained factories (jest.mock hoisting).
 */
jest.mock('@nextdo/db', () => {
  const compilable = () => ({
    compile: () => ({ sql: 'SELECT 1', parameters: [] }),
    execute: async () => [],
  });
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    close: async () => undefined,
  };
  return {
    createPowerSyncDatabase: () => powersync,
    createPowerSyncConnector: () => ({
      fetchCredentials: async () => null,
      uploadData: async () => undefined,
    }),
    subscribeAppStream: async () => undefined,
    wrapDb: () => ({}),
    queryEnginePool: async () => ({ actions: [], calendar: [], projects: [] }),
    poolTriggerWatchQuery: compilable,
    inboxItemsWatchQuery: compilable,
    projectsWatchQuery: compilable,
    reviewRecordsWatchQuery: compilable,
    skipAction: async () => undefined,
  };
});

jest.mock('@powersync/react', () => {
  const React = jest.requireActual('react');
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    close: async () => undefined,
  };
  // Stable identity across renders — the real hook only returns a new
  // result reference when the query's result set changes; a fresh object
  // per render would loop the Now hook's recompute effect.
  const queryResult = {
    data: [],
    isLoading: false,
    isFetching: false,
    error: undefined,
    refresh: async () => undefined,
  };
  return {
    PowerSyncContext: React.createContext(powersync),
    usePowerSync: () => powersync,
    useQuery: () => queryResult,
    useStatus: () => ({ status: 'synced', isSynced: true }),
  };
});

import { act, renderRouter, screen } from 'expo-router/testing-library';

/** Each tab's expected empty-state title (unique per screen). */
const TABS = [
  { url: '/(tabs)/now', emptyState: 'Nothing to do right now' },
  { url: '/(tabs)/inbox', emptyState: 'Inbox is empty' },
  { url: '/(tabs)/projects', emptyState: 'No projects yet' },
  { url: '/(tabs)/review', emptyState: 'No reviews yet' },
];

describe('mobile shell smoke', () => {
  it.each(TABS)('renders the $url tab without crashing', async ({ url, emptyState }) => {
    // RNTL wraps render in act itself — do not nest another act around it.
    renderRouter('app', { initialUrl: url });
    expect(screen.getByText(emptyState)).toBeTruthy();
    // Flush the mocked async pool computation so its state update does not
    // leak out of the test as an "update not wrapped in act" warning.
    await act(async () => {});
  });
});
