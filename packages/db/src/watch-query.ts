/**
 * Kysely → PowerSync watched-query bridge (the `@powersync/react` boundary,
 * database-guidelines "PowerSync Rules").
 *
 * The `@powersync/react` hooks (`useQuery`, …) and `db.customQuery()` accept a
 * `CompilableQuery` — `{ compile(): CompiledQuery; execute(): Promise<T[]> }`
 * — NOT a raw Kysely builder. `toCompilableQuery` adapts a Kysely select
 * builder into that shape:
 *
 * - `compile()` → the builder's SQL + parameters (Kysely's own `compile()`;
 *   PowerSync parses this SQL to learn which tables the query depends on, so
 *   the watch re-fires when any of those tables change).
 * - `execute()` → runs the Kysely query and maps rows to domain objects. The
 *   watch processor calls `execute()` to fetch data, so the mapper applies.
 *
 * All Kysely stays in `packages/db` (app hooks never build queries — see the
 * `@powersync/react` boundary). The app passes the returned `CompilableQuery`
 * straight to `useQuery`.
 */
import type { CompilableQuery } from '@powersync/common';

/** The slice of Kysely's select builder this adapter relies on (kysely
 *  0.29.x: `Compilable.compile()` → `{ sql, parameters, … }`;
 *  `Executable.execute()` → rows). */
export interface KyselySelectBuilder<RowType> {
  compile(): { sql: string; parameters: ReadonlyArray<unknown> };
  execute(): Promise<RowType[]>;
}

/**
 * Adapt a Kysely select builder into a PowerSync `CompilableQuery`.
 *
 * @param builder   the Kysely select builder (from `NextdoDb.selectFrom(...)`).
 * @param mapRow    optional per-row row→domain mapper (defaults to identity).
 * @returns a `CompilableQuery<Mapped>` consumable by `useQuery`/`customQuery`.
 */
export function toCompilableQuery<RowType, Mapped = RowType>(
  builder: KyselySelectBuilder<RowType>,
  mapRow?: (row: RowType) => Mapped,
): CompilableQuery<Mapped> {
  return {
    compile(): { sql: string; parameters: ReadonlyArray<unknown> } {
      const { sql, parameters } = builder.compile();
      return { sql, parameters };
    },
    async execute(): Promise<Mapped[]> {
      const rows = await builder.execute();
      // With `mapRow` undefined, `Mapped` defaults to `RowType` — the cast is
      // sound by the default, but TS cannot track that through the ternary
      // (hence the hop through `unknown`).
      return mapRow === undefined ? (rows as unknown as Mapped[]) : rows.map(mapRow);
    },
  };
}
