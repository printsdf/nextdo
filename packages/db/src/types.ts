/**
 * Shared types for the packages/db query layer.
 */
import type { PowerSyncKyselyDatabase } from '@powersync/kysely-driver';
import type { Database } from './schema';

/** The DB handle injected into every query function (design.md §3). */
export type NextdoDb = PowerSyncKyselyDatabase<Database>;

/**
 * The three action kinds that share the complete/skip/snooze transactions
 * (domain-model.md: "snooze/skip transactions target all three action kinds").
 * `habit` refers to a HabitDay row — the generated daily instance.
 */
export type ActionKind = 'next' | 'calendar' | 'habit';
