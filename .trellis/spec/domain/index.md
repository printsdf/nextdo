# Domain Guidelines (packages/core)

> The GTD domain model and the Next Action Engine — pure TypeScript, zero runtime
> dependencies, no React/RN/PowerSync imports.

---

## Pre-Development Checklist

- [ ] Re-read the relevant Proposal section (`轻量 GTD 行动系统 Proposal.md`) — the domain model in this spec must stay consistent with it
- [ ] New entity, status, or Clarify branch? Update `domain-model.md` (including the decision table) in the same change
- [ ] Engine change? Weights/formula in `next-action-engine.md` are a contract — changing them is a spec change, not an implementation detail
- [ ] Engine change? Determinism check: same (actions, context, now) in → same output out
- [ ] New pure logic has a co-located test (`*.test.ts` next to the source file)
- [ ] No `Date.now()` / `new Date()` / `Math.random()` without an injected `now` / seed

---

## Quality Check

- [ ] `packages/core` imports nothing from `react`, `react-native`, `expo-*`, `powersync*` (grep-able)
- [ ] Every engine rule (filter, signal) has positive + negative unit tests
- [ ] Recommendation is explainable: every returned action carries non-empty `reasons`
- [ ] Exhaustive switches over enums (engine output codes, action statuses) with `never` checks

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Domain Model](./domain-model.md) | Entities, Clarify state machine, invariants |
| [Next Action Engine](./next-action-engine.md) | Hard filter, value ranking, recommendation contract, skip handling |

---

**Language**: All documentation should be written in **English**.
