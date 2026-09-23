/**
 * The Clarify / Re-clarify wizard (design.md §4.3) — shared by
 * `app/clarify/[inboxId].tsx` (Q1–Q5, full table) and `app/reclarify/[id].tsx`
 * (re-enters at Q2).
 *
 * Layering:
 * - the step machine + validation + submission builders are PURE and live
 *   in `lib/clarify-flow.ts` (unit-tested there);
 * - `ClarifyWizard` loads the target's title from the db and hands it to
 *   `WizardBody`;
 * - `WizardBody` owns the `useReducer` and the ONE db transaction per
 *   submission (`applyClarify` / `reclarifyAction`); errors surface through
 *   `lib/error-messages` (Chinese), never raw.
 *
 * Presentational otherwise: no engine logic, no stored engine output
 * (component-guidelines).
 */
import { useMemo, useReducer, useState, type Dispatch, type ReactNode } from 'react';
import { router } from 'expo-router';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Button, Card, cn } from '@nextdo/ui';
import {
  applyClarify,
  reclarifyAction,
  wrapDb,
  type ActionKind,
} from '@nextdo/db';
import { usePowerSync } from '@powersync/react';
import type { Project, Value } from '@nextdo/core';
import { useAppClock } from '@/hooks/use-app-clock';
import { useInboxItem } from '@/hooks/use-inbox-item';
import { useActionTitle } from '@/hooks/use-action-title';
import { useProjects } from '@/hooks/use-projects';
import { errorMessage } from '@/lib/error-messages';
import {
  buildDoNowSubmission,
  buildFormSubmission,
  clarifyReducer,
  createWizardState,
  outcomeLabel,
  validateForm,
  type FormKind,
  type FormFields,
  type Submission,
  type WizardAction,
  type WizardMode,
  type WizardState,
} from '@/lib/clarify-flow';

const INPUT_CLASS =
  'rounded-md border border-border bg-surface p-3 text-base text-ink placeholder:text-muted dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

const EST_CHIPS = [5, 10, 20, 30, 60, 120];
const VALUE_CHIPS: Value[] = [1, 2, 3, 4, 5];

/** The quick-pick minute estimates (design.md §4.3) + a custom box. */
function EstPicker({ value, onSelect }: { value: number | null; onSelect: (minutes: number) => void }) {
  const [custom, setCustom] = useState('');
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {EST_CHIPS.map((chip) => (
        <Chip key={chip} label={`${chip} 分钟`} active={value === chip} onPress={() => onSelect(chip)} />
      ))}
      <TextInput
        className={cn(INPUT_CLASS, 'h-11 w-24 flex-row items-center p-2')}
        placeholder="自定义"
        keyboardType="number-pad"
        value={custom}
        onChangeText={setCustom}
        onSubmitEditing={() => {
          const parsed = Number(custom);
          if (Number.isFinite(parsed) && parsed >= 1) onSelect(Math.round(parsed));
        }}
      />
    </View>
  );
}

/** A 1–5 value chip row. */
function ValuePicker({ value, onSelect }: { value: Value; onSelect: (value: Value) => void }) {
  return (
    <View className="flex-row gap-2">
      {VALUE_CHIPS.map((chip) => (
        <Chip key={chip} label={String(chip)} active={value === chip} onPress={() => onSelect(chip)} />
      ))}
    </View>
  );
}

/** A small tappable chip (44pt touch target kept via padding). */
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={cn(
        'h-8 items-center justify-center rounded-full px-3',
        active
          ? 'bg-accent text-on-accent dark:bg-accent-dark'
          : 'border border-border bg-surface text-ink dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark',
      )}
    >
      <Text className="text-sm">{label}</Text>
    </Pressable>
  );
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: ReactNode }) {
  return (
    <View className="gap-1">
      <Text className="text-sm font-medium text-ink dark:text-ink-dark">
        {label}
        {optional ? <Text className="text-muted dark:text-muted-dark">（可选）</Text> : null}
      </Text>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// WizardBody — owns the reducer + the submission transaction
// ---------------------------------------------------------------------------

export interface WizardBodyProps {
  mode: WizardMode;
  /** InboxItem id (clarify) or the existing action id (reclarify). */
  id: string;
  /** Reclarify only: the action kind (habits are rejected before navigation). */
  actionKind: Extract<ActionKind, 'next' | 'calendar'> | null;
  /** The target's title — defaults for every editable title field. */
  defaultTitle: string;
  /** Reclarify only: the existing action's project (null = standalone) —
   *  marks the Q2b "current" project. */
  currentProjectId: string | null;
}

export function WizardBody({ mode, id, actionKind, defaultTitle, currentProjectId }: WizardBodyProps) {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();

  // Q2b: the attachable projects (active only — on-hold/done/dropped are
  // not attachable; the db layer re-checks status at submit time).
  const { data: allProjects } = useProjects();
  const activeProjects = allProjects.filter((project) => project.status === 'active');

  const [state, dispatch] = useReducer(clarifyReducer, undefined, () => createWizardState(mode, defaultTitle));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(submission: Submission) {
    setSubmitting(true);
    try {
      if (submission.mode === 'clarify') {
        const result = await applyClarify(db, {
          inboxId: id,
          answers: submission.answers,
          target: submission.target,
          now,
        });
        dispatch({ type: 'done', result: { outcome: result.outcome, createdIds: result.createdIds } });
      } else {
        if (actionKind === null) throw new Error('re-clarify requires an action kind');
        const result = await reclarifyAction(db, {
          actionKind,
          actionId: id,
          answers: submission.answers,
          target: submission.target,
          now,
        });
        dispatch({ type: 'done', result: { outcome: result.outcome, createdIds: result.createdIds } });
      }
      setSubmitError(null);
    } catch (err: unknown) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function handleDoNow() {
    void submit(buildDoNowSubmission(mode));
  }

  function handleFormSubmit(form: FormKind, fields: FormFields, twoMinute: boolean, projectId?: string) {
    const problem = validateForm(form, fields);
    if (problem !== null) {
      dispatch({ type: 'form-error', error: problem });
      return;
    }
    void submit(buildFormSubmission(mode, form, fields, twoMinute, projectId));
  }

  function setField(field: keyof FormFields, value: string | number | null) {
    dispatch({ type: 'field', field, value });
  }

  const errorText = state.step === 'form' ? state.error : null;

  return (
    <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
      <View className="mb-4 flex-row items-center justify-between">
        <Button label="← 返回" variant="ghost" onPress={() => router.back()} />
        <Text className="text-lg font-semibold text-ink dark:text-ink-dark">
          {mode === 'clarify' ? '明晰' : '重新明晰'}
        </Text>
        <View className="w-16" />
      </View>

      {state.step === 'done' ? (
        <Card className="items-center gap-3 py-8">
          <Text className="text-base font-medium text-ink dark:text-ink-dark">
            已整理为「{outcomeLabel(state.result.outcome)}」
          </Text>
          {/* Explicit exits (R1): loop back to capture, or return to the
           *  screen the wizard was pushed from. No auto-back timer. The
           *  recapture param is a one-shot (the inbox screen consumes it). */}
          <Button
            label="再记一条"
            onPress={() =>
              router.navigate({ pathname: '/(tabs)/inbox', params: { recapture: '1' } })
            }
          />
          <Button label="完成" variant="secondary" onPress={() => router.back()} />
        </Card>
      ) : (
        <Card>
          {(state.step === 'q1' || state.step === 'q2' || state.step === 'q2b' || state.step === 'q3' || state.step === 'q4' || state.step === 'q5' || state.step === 'q3b') && (
            <QuestionCard
              state={state}
              dispatch={dispatch}
              onDoNow={handleDoNow}
              disabled={submitting}
              projects={activeProjects}
              currentProjectId={currentProjectId}
            />
          )}
          {state.step === 'q1b' && (
            <View className="gap-4">
              <Question title="那它更接近哪一类？" />
              <Button label="资料（留个参考）" variant="secondary" onPress={() => dispatch({ type: 'answer-q1b', kind: 'reference' })} />
              <Button label="有空再说" variant="secondary" onPress={() => dispatch({ type: 'answer-q1b', kind: 'someday' })} />
              <Button label="删除" variant="secondary" onPress={() => dispatch({ type: 'answer-q1b', kind: 'trash' })} />
            </View>
          )}
          {state.step === 'form' && (
            <FormCard
              state={state}
              onField={setField}
              onSubmit={() => handleFormSubmit(state.form, state.fields, state.twoMinute, state.projectId)}
              disabled={submitting}
            />
          )}
          {errorText !== null ? (
            <Text className="mt-3 text-sm text-danger">{errorText}</Text>
          ) : null}
          {submitError !== null ? (
            <Text className="mt-3 text-sm text-danger">{submitError}</Text>
          ) : null}
        </Card>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Question steps (one question per screen, two big buttons)
// ---------------------------------------------------------------------------

interface QuestionCardProps {
  state: Extract<WizardState, { step: 'q1' | 'q2' | 'q2b' | 'q3' | 'q3b' | 'q4' | 'q5' }>;
  dispatch: Dispatch<WizardAction>;
  onDoNow: () => void;
  disabled: boolean;
  /** Q2b only: the active (attachable) projects. */
  projects: Project[];
  /** Q2b only (reclarify): the action's current project — gets the
   *  "当前" marker. */
  currentProjectId: string | null;
}

function Question({ title, sub }: { title: string; sub?: string }) {
  return (
    <View className="mb-4 gap-1">
      <Text className="text-base font-medium text-ink dark:text-ink-dark">{title}</Text>
      {sub !== undefined ? <Text className="text-sm text-muted dark:text-muted-dark">{sub}</Text> : null}
    </View>
  );
}

function QuestionCard({ state, dispatch, onDoNow, disabled, projects, currentProjectId }: QuestionCardProps) {
  switch (state.step) {
    case 'q1':
      return (
        <View className="gap-4">
          <Question title="可以变成下一步行动吗？" sub="这件事能由你做成一件具体的事吗？" />
          <Button label="可以，是行动" onPress={() => dispatch({ type: 'answer-q1', actionable: true })} disabled={disabled} />
          <Button label="不行" variant="secondary" onPress={() => dispatch({ type: 'answer-q1', actionable: false })} disabled={disabled} />
        </View>
      );
    case 'q2':
      return (
        <View className="gap-4">
          <Question title="需要多个步骤才能完成吗？" />
          <Button label="是，拆成项目" onPress={() => dispatch({ type: 'answer-q2', multipleSteps: true })} disabled={disabled} />
          <Button label="否，一步能完成" variant="secondary" onPress={() => dispatch({ type: 'answer-q2', multipleSteps: false })} disabled={disabled} />
        </View>
      );
    case 'q2b':
      return (
        <View className="gap-4">
          <Question title="它属于哪个项目？" sub="挂到已有项目下（价值默认跟随项目），或新建 / 不挂。" />
          {projects.map((project) => (
            <Pressable
              key={project.id}
              accessibilityRole="button"
              accessibilityLabel={`挂到项目：${project.title}`}
              onPress={() =>
                dispatch({
                  type: 'answer-q2b',
                  choice: 'attach',
                  projectId: project.id,
                  projectValue: project.value,
                  projectTitle: project.title,
                })
              }
              disabled={disabled}
              className="rounded-md border border-border bg-surface p-3 dark:border-border-dark dark:bg-surface-dark"
            >
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-base text-ink dark:text-ink-dark">
                  {project.title}（价值 {project.value}）
                </Text>
                {currentProjectId === project.id ? (
                  <Text className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent dark:bg-accent-dark/20 dark:text-accent-dark">
                    当前
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
          <Button label="新建项目" variant="secondary" onPress={() => dispatch({ type: 'answer-q2b', choice: 'new-project' })} disabled={disabled} />
          <Button label="不属于项目" variant="secondary" onPress={() => dispatch({ type: 'answer-q2b', choice: 'none' })} disabled={disabled} />
        </View>
      );
    case 'q3':
      return (
        <View className="gap-4">
          <Question title="大约 2 分钟内能完成吗？" />
          <Button label="是，2 分钟内" onPress={() => dispatch({ type: 'answer-q3', twoMinutes: true })} disabled={disabled} />
          <Button label="否" variant="secondary" onPress={() => dispatch({ type: 'answer-q3', twoMinutes: false })} disabled={disabled} />
        </View>
      );
    case 'q3b':
      return (
        <View className="gap-4">
          <Question title="现在就做掉吗？" sub="做完直接记为完成，不再排队。" />
          <Button label="是，现在就做完" onPress={onDoNow} disabled={disabled} />
          <Button label="否，记成行动" variant="secondary" onPress={() => dispatch({ type: 'answer-q3b', completedOnTheSpot: false })} disabled={disabled} />
        </View>
      );
    case 'q4':
      return (
        <View className="gap-4">
          <Question title="应该由你完成吗？" />
          <Button label="是，我的事" onPress={() => dispatch({ type: 'answer-q4', myResponsibility: true })} disabled={disabled} />
          <Button label="否，在等别人" variant="secondary" onPress={() => dispatch({ type: 'answer-q4', myResponsibility: false })} disabled={disabled} />
        </View>
      );
    case 'q5':
      return (
        <View className="gap-4">
          <Question title="必须在固定日期/时间执行吗？" />
          <Button label="是，固定时间" onPress={() => dispatch({ type: 'answer-q5', fixedTime: true })} disabled={disabled} />
          <Button label="否，普通行动" variant="secondary" onPress={() => dispatch({ type: 'answer-q5', fixedTime: false })} disabled={disabled} />
        </View>
      );
  }
}

// ---------------------------------------------------------------------------
// The outcome forms (design.md §4.3 表单字段)
// ---------------------------------------------------------------------------

interface FormCardProps {
  state: Extract<WizardState, { step: 'form' }>;
  onField: (field: keyof FormFields, value: string | number | null) => void;
  onSubmit: () => void;
  disabled: boolean;
}

function FormCard({ state, onField, onSubmit, disabled }: FormCardProps) {
  const { form, fields } = state;

  const body = (() => {
    switch (form) {
      case 'trash':
        return (
          <View className="gap-4">
            <Question title="删除这条捕获？" sub="删除后进回收站（软删除），可找回。" />
          </View>
        );
      case 'reference':
        return (
          <View className="gap-4">
            <Field label="标题">
              <TextInput className={INPUT_CLASS} value={fields.title} onChangeText={(v) => onField('title', v)} />
            </Field>
            <Field label="链接（URL）">
              <TextInput
                className={INPUT_CLASS}
                value={fields.url}
                onChangeText={(v) => onField('url', v)}
                placeholder="https://…"
                autoCapitalize="none"
              />
            </Field>
            <Field label="备注" optional>
              <TextInput className={INPUT_CLASS} value={fields.note} onChangeText={(v) => onField('note', v)} />
            </Field>
          </View>
        );
      case 'someday':
        return (
          <View className="gap-4">
            <Question title="有空再说" sub="放进 Someday/Maybe，周回顾时再看。" />
            <Field label="标题">
              <TextInput className={INPUT_CLASS} value={fields.title} onChangeText={(v) => onField('title', v)} />
            </Field>
            <Field label="备注" optional>
              <TextInput className={INPUT_CLASS} value={fields.note} onChangeText={(v) => onField('note', v)} />
            </Field>
          </View>
        );
      case 'project':
        return (
          <View className="gap-4">
            <Question title="新建项目" sub="项目会带上它的第一个行动（原子创建）。" />
            <Field label="项目名">
              <TextInput className={INPUT_CLASS} value={fields.projectTitle} onChangeText={(v) => onField('projectTitle', v)} />
            </Field>
            <Field label='项目结果（"完成"是什么样）'>
              <TextInput
                className={INPUT_CLASS}
                value={fields.projectOutcome}
                onChangeText={(v) => onField('projectOutcome', v)}
                placeholder="用一句话描述完成的样貌"
              />
            </Field>
            <Field label="项目价值（1–5）">
              <ValuePicker value={fields.projectValue} onSelect={(v) => onField('projectValue', v)} />
            </Field>
            <Field label="第一个行动的标题">
              <TextInput className={INPUT_CLASS} value={fields.actionTitle} onChangeText={(v) => onField('actionTitle', v)} />
            </Field>
            <Field label="行动预估时长（分钟）">
              <EstPicker value={fields.estMinutes} onSelect={(v) => onField('estMinutes', v)} />
            </Field>
          </View>
        );
      case 'waiting':
        return (
          <View className="gap-4">
            <Question title="等待他人" sub="记为 Waiting For，设了期望日期会进回顾。" />
            <Field label="标题">
              <TextInput className={INPUT_CLASS} value={fields.title} onChangeText={(v) => onField('title', v)} />
            </Field>
            <Field label="在等谁 / 什么">
              <TextInput
                className={INPUT_CLASS}
                value={fields.waitingOn}
                onChangeText={(v) => onField('waitingOn', v)}
                placeholder="例：等设计同学反馈"
              />
            </Field>
            <Field label="期望日期（YYYY-MM-DD）" optional>
              <TextInput
                className={INPUT_CLASS}
                value={fields.expectedBy}
                onChangeText={(v) => onField('expectedBy', v)}
                placeholder="2026-09-30"
                autoCapitalize="none"
              />
            </Field>
          </View>
        );
      case 'calendar':
        return (
          <View className="gap-4">
            <Question title="固定时间行动" sub="放进日程，按开始时间进入执行池。" />
            <Field label="标题">
              <TextInput className={INPUT_CLASS} value={fields.title} onChangeText={(v) => onField('title', v)} />
            </Field>
            <Field label="开始日期（YYYY-MM-DD）">
              <TextInput
                className={INPUT_CLASS}
                value={fields.startsAtDate}
                onChangeText={(v) => onField('startsAtDate', v)}
                placeholder="2026-09-30"
                autoCapitalize="none"
              />
            </Field>
            <Field label="开始时间（HH:mm）">
              <TextInput
                className={INPUT_CLASS}
                value={fields.startsAtTime}
                onChangeText={(v) => onField('startsAtTime', v)}
                placeholder="09:30"
                autoCapitalize="none"
              />
            </Field>
            <Field label="预估时长（分钟）">
              <EstPicker value={fields.estMinutes} onSelect={(v) => onField('estMinutes', v)} />
            </Field>
            <Field label="价值（1–5）">
              <ValuePicker value={fields.value} onSelect={(v) => onField('value', v)} />
            </Field>
            <Field label="截止（YYYY-MM-DD）" optional>
              <TextInput
                className={INPUT_CLASS}
                value={fields.deadline}
                onChangeText={(v) => onField('deadline', v)}
                placeholder="2026-10-01"
                autoCapitalize="none"
              />
            </Field>
          </View>
        );
      case 'action':
        return (
          <View className="gap-4">
            {state.projectId !== undefined ? (
              // Q2b attach: the project is fixed for this submission —
              // changing it means going back to Q2b (not in-form).
              <Text className="rounded-md bg-canvas p-2.5 text-sm text-muted dark:bg-canvas-dark dark:text-muted-dark">
                所属项目：{state.projectTitle ?? ''}
              </Text>
            ) : null}
            <Question
              title={state.twoMinute ? '记成一个行动（约 2 分钟）' : '记成一个行动'}
              sub="进入 Now 执行池，可以被推荐。"
            />
            <Field label="行动标题">
              <TextInput className={INPUT_CLASS} value={fields.actionTitle} onChangeText={(v) => onField('actionTitle', v)} />
            </Field>
            <Field label="预估时长（分钟）">
              <EstPicker value={fields.estMinutes} onSelect={(v) => onField('estMinutes', v)} />
            </Field>
            {!state.twoMinute ? (
              <Field label="价值（1–5）">
                <ValuePicker value={fields.value} onSelect={(v) => onField('value', v)} />
              </Field>
            ) : null}
            <Field label="截止（YYYY-MM-DD）" optional>
              <TextInput
                className={INPUT_CLASS}
                value={fields.deadline}
                onChangeText={(v) => onField('deadline', v)}
                placeholder="2026-10-01"
                autoCapitalize="none"
              />
            </Field>
          </View>
        );
    }
  })();

  return (
    <View className="gap-4">
      {body}
      <Button
        label={form === 'trash' ? '确认删除' : '保存'}
        onPress={onSubmit}
        disabled={disabled}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// ClarifyWizard — title loader + WizardBody
// ---------------------------------------------------------------------------

export interface ClarifyWizardProps {
  mode: WizardMode;
  /** InboxItem id (clarify) or the existing action id (reclarify). */
  id: string | null;
  /** Reclarify only: the action kind (next | calendar). */
  actionKind?: Extract<ActionKind, 'next' | 'calendar'> | null;
}

export function ClarifyWizard({ mode, id, actionKind = null }: ClarifyWizardProps) {
  const isReclarify = mode === 'reclarify';
  const inbox = useInboxItem(isReclarify ? null : id);
  const action = useActionTitle(isReclarify ? actionKind : null, isReclarify ? id : null);

  if (id === null) {
    return (
      <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
        <Card className="items-center gap-3 py-8">
          <Text className="text-base text-ink dark:text-ink-dark">缺少参数，无法打开</Text>
          <Button label="返回" variant="secondary" onPress={() => router.back()} />
        </Card>
      </View>
    );
  }

  // Re-clarify without a resolvable action kind (habit, or a bad/missing
  // `?kind=` param): the title hooks settle nothing, so without this branch
  // the screen would sit on "加载中…" forever. Say so instead (the db layer
  // enforces the same rule: reclarify.unsupported-kind).
  if (isReclarify && actionKind === null) {
    return (
      <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
        <Card className="items-center gap-3 py-8">
          <Text className="text-base text-ink dark:text-ink-dark">
            这个行动不能重新明晰（习惯请编辑习惯本身）
          </Text>
          <Button label="返回" variant="secondary" onPress={() => router.back()} />
        </Card>
      </View>
    );
  }

  const error = inbox.error ?? action.error;
  const loaded = isReclarify ? action.loaded : inbox.loaded;
  const title = isReclarify ? action.title : inbox.item?.title ?? null;

  if (error !== null) {
    return (
      <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
        <Card className="items-center gap-3 py-8">
          <Text className="text-base text-ink dark:text-ink-dark">{errorMessage(error)}</Text>
          <Button label="返回" variant="secondary" onPress={() => router.back()} />
        </Card>
      </View>
    );
  }

  if (!loaded) {
    return (
      <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
        <Card className="items-center py-8">
          <Text className="text-base text-ink dark:text-ink-dark">加载中…</Text>
        </Card>
      </View>
    );
  }

  if (title === null) {
    return (
      <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
        <Card className="items-center gap-3 py-8">
          <Text className="text-base text-ink dark:text-ink-dark">
            {isReclarify ? '这个行动不存在了' : '这条收件箱记录不存在了'}
          </Text>
          <Button label="返回" variant="secondary" onPress={() => router.back()} />
        </Card>
      </View>
    );
  }

  return (
    <WizardBody
      key={`${mode}-${id}`}
      mode={mode}
      id={id}
      actionKind={actionKind}
      defaultTitle={title}
      currentProjectId={isReclarify ? action.projectId : null}
    />
  );
}
