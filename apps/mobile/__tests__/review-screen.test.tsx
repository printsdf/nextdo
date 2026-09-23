/**
 * Component tests — the Review tab (PRD R7, design.md §4.5): the two entry
 * cards (今日回顾 / 本周回顾) + the append-only history (kind tag + date +
 * one-line digest). The daily/weekly flows themselves are covered by
 * review-daily.test.tsx / review-weekly.test.tsx.
 */
const NOW = '2026-09-23T10:00:00.000Z';

const recordsRef = {
  records: [
    {
      id: 'r-1', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      at: '2026-09-22T15:00:00.000Z',
      kind: 'daily',
      snapshot: {
        inboxCount: 0,
        completedToday: ['c-1'],
        stillOpen: [],
        projectsMissingActions: [],
        waitingFollowUps: [],
        calendarToday: [],
        calendarTomorrow: [],
        repeatedSkips: [],
      },
      answers: { completedActionIds: ['c-1'], rescheduled: [], skippedNoted: [], tomorrowMustDo: [] },
    },
    {
      id: 'r-2', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      at: '2026-09-20T15:00:00.000Z',
      kind: 'weekly',
      snapshot: {
        inboxCount: 0,
        projects: [],
        waitingFollowUps: [],
        somedayCount: 0,
        stalledProjects: [],
        calendarNext7: [],
      },
      answers: {
        inboxCleared: true,
        followUpsRaised: [],
        calendarReasonable: true,
        somedayDecisions: [],
        projectDecisions: [],
      },
    },
  ],
};

jest.mock('@nextdo/db', () => {
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
    isReactNativeRuntime: () => false,
    reviewRecordsWatchQuery: () => ({
      compile: () => ({ sql: 'SELECT 1', parameters: [] }),
      execute: async () => [],
    }),
  };
});

jest.mock('@powersync/react', () => {
  const React = jest.requireActual('react');
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    close: async () => undefined,
  };
  return {
    PowerSyncContext: React.createContext(powersync),
    usePowerSync: () => powersync,
    useQuery: () => ({
      data: recordsRef.records,
      isLoading: false,
      isFetching: false,
      error: undefined,
      refresh: async () => undefined,
    }),
    useStatus: () => ({ status: 'synced', isSynced: true }),
  };
});

import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

describe('Review tab', () => {
  it('shows the two entry cards and the history trail (kind + date + digest)', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/review' });

    await waitFor(() => expect(screen.getByText('今日回顾')).toBeTruthy());
    expect(screen.getByText('本周回顾')).toBeTruthy();
    expect(screen.getByText('历史记录')).toBeTruthy();

    // Both records: kind tags + digests.
    expect(screen.getByText('日常')).toBeTruthy();
    expect(screen.getByText('每周')).toBeTruthy();
    expect(screen.getByText('完成 1 · 排期 0 · 明日必做 0')).toBeTruthy();
    expect(screen.getByText('项目 0 · 待跟进 0 · Someday 0')).toBeTruthy();
  });
});
