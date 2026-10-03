/**
 * The project detail route (design.md §4.4 — PRD R6): the project header
 * (title / status / value / outcome) + its OPEN next actions (complete /
 * snooze / trash per row) + the inline add-action form (`addNextAction`
 * carrying the projectId).
 *
 * Data: the project row comes from the `useProjects` watched query (the
 * coverage tag re-derives itself when an action lands or completes); the
 * action list is query-style via `useProjectActions` (client-side
 * projectId filter, design.md §8). Project STATUS: active ↔ on-hold can be
 * switched right here (归档 / 恢复 quick actions — task 09-28 R2/R3,
 * revising the old app-ui decision); done/dropped (terminal) are still
 * decided by the weekly review only. Project fields (title/outcome/value,
 * R1) and the project's actions (title/est/value/deadline, R4) are edited
 * via inline forms. Action rows carry the read-only context chips
 * (design §4.2 — the PRD acceptance "项目详情行内 chips").
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useAppInsets } from '@/lib/use-app-insets';
import { useLocalSearchParams } from 'expo-router';
import { Button, Card, ContextChip, EmptyState, Tag, ValueChips, cn, type TagTone } from '@nextdo/ui';
import { DateTimePicker } from '@/components/datetime-picker';
import { localDateKey, type NextAction, type Project, type ProjectStatus, type Value } from '@nextdo/core';
import { useProjects } from '@/hooks/use-projects';
import { useProjectActions } from '@/hooks/use-project-actions';
import { useAddNextAction } from '@/hooks/use-add-next-action';
import { useUpdateProject } from '@/hooks/use-update-project';
import { useUpdateNextAction } from '@/hooks/use-update-next-action';
import { useCompleteAction } from '@/hooks/use-complete-action';
import { useSnoozeAction } from '@/hooks/use-snooze-action';
import { useTrashAction } from '@/hooks/use-trash-action';
import { useAppClock } from '@/hooks/use-app-clock';
import { useContexts } from '@/hooks/use-contexts';
import { errorMessage } from '@/lib/error-messages';
import { PROJECT_STATUS_LABELS } from '@/lib/status-labels';
import { endOfLocalDayIso } from '@/lib/clarify-flow';
import { formatLocalDate } from '@/lib/format';
import { goBack } from '@/lib/go-back';
import { SnoozeSheet } from '@/components/snooze-sheet';

const STATUS_TONES: Record<ProjectStatus, TagTone> = {
  active: 'accent',
  'on-hold': 'warning',
  done: 'neutral',
  dropped: 'neutral',
};

const EST_CHIPS = [5, 10, 20, 30, 60, 120];

const INPUT_CLASS =
  'rounded-md border border-border bg-surface p-3 text-base text-ink placeholder:text-muted dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={
        active
          ? 'h-8 w-8 items-center justify-center rounded-full bg-accent dark:bg-accent-dark'
          : 'h-8 w-8 items-center justify-center rounded-full border border-border dark:border-border-dark'
      }
    >
      <Text className={active ? 'text-sm text-on-accent' : 'text-sm text-ink dark:text-ink-dark'}>{label}</Text>
    </Pressable>
  );
}

/** The inline add-action form (title + est + value + optional deadline). */
function AddActionForm({ projectId, now, onDone, onAdded }: { projectId: string; now: Date; onDone: () => void; onAdded: () => void }) {
  const { add, error } = useAddNextAction();
  const [title, setTitle] = useState('');
  const [estMinutes, setEstMinutes] = useState<number | null>(null);
  const [value, setValue] = useState<Value>(3);
  const [deadline, setDeadline] = useState('');
  const [deadlineHint, setDeadlineHint] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [customEst, setCustomEst] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim() !== '' && estMinutes !== null && !submitting;

  const applyCustomEst = () => {
    const parsed = Number(customEst);
    if (Number.isFinite(parsed) && parsed >= 1) setEstMinutes(Math.round(parsed));
    setCustomEst('');
  };

  const addAction = () => {
    if (!canSubmit || estMinutes === null) return;
    // The domain deadline is an ISO *datetime*; the input is a local date —
    // compose that local day's 23:59:59 (the same convention as the Clarify
    // wizard), and block impossible dates instead of storing them raw.
    let deadlineIso: string | undefined;
    if (deadline.trim() !== '') {
      const iso = endOfLocalDayIso(deadline.trim());
      if (iso === null) {
        setDeadlineHint('日期格式应为 YYYY-MM-DD（例如 2026-10-01）');
        return;
      }
      deadlineIso = iso;
    }
    setSubmitting(true);
    void add({ title, estMinutes, value, projectId, deadline: deadlineIso }).then(() => {
      setSubmitting(false);
      setTitle('');
      setEstMinutes(null);
      setValue(3);
      setDeadline('');
      setDeadlineHint(null);
      onAdded();
      onDone();
    });
  };

  return (
    <Card className="gap-3">
      <Text className="text-sm font-medium text-muted dark:text-muted-dark">添加行动</Text>
      <TextInput
        className={INPUT_CLASS}
        placeholder="下一步行动（具体的、单步的）"
        value={title}
        onChangeText={setTitle}
      />
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-sm font-medium text-ink dark:text-ink-dark">预估时长（分钟）</Text>
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        {EST_CHIPS.map((chip) => (
          <Chip key={chip} label={String(chip)} active={estMinutes === chip} onPress={() => setEstMinutes(chip)} />
        ))}
        <TextInput
          className={`${INPUT_CLASS} h-8 w-20 p-1`}
          placeholder="自定义"
          keyboardType="number-pad"
          value={customEst}
          onChangeText={setCustomEst}
          onSubmitEditing={applyCustomEst}
        />
      </View>
      <ValueChips value={value} onChange={setValue} />
      <View className="flex-row items-center gap-2">
        <TextInput
          className={cn(INPUT_CLASS, 'flex-1')}
          placeholder="截止（YYYY-MM-DD，可选）"
          value={deadline}
          onChangeText={(value) => {
            setDeadline(value);
            setDeadlineHint(null);
          }}
          autoCapitalize="none"
        />
        <Button
          size="sm"
          label={deadline ? '更换日期' : '选择日期'}
          variant="secondary"
          onPress={() => setShowPicker(true)}
        />
      </View>
      {showPicker ? (
        <DateTimePicker
          mode="date"
          title="选择截止日期"
          value={deadline}
          now={now}
          onConfirm={(val) => {
            setDeadline(val);
            setDeadlineHint(null);
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      ) : null}
      {deadlineHint !== null ? (
        <Text className="text-sm text-danger">{deadlineHint}</Text>
      ) : null}
      {error !== null ? <Text className="text-sm text-danger">{errorMessage(error)}</Text> : null}
      <View className="flex-row gap-2">
        <Button label="添加" onPress={addAction} disabled={!canSubmit} />
        <Button label="取消" variant="secondary" onPress={onDone} />
      </View>
    </Card>
  );
}

/** The inline edit-project form (R1) — same Card + chips pattern as the
 *  Projects tab's NewProjectForm, pre-filled from the current row. Status
 *  is NOT an editable field (归档/恢复 are the header's quick actions).
 *  Empty title or empty outcome cannot submit. */
function EditProjectForm({ project, onDone, onSaved }: { project: Project; onDone: () => void; onSaved: () => void }) {
  const { update, error } = useUpdateProject();
  const [title, setTitle] = useState(project.title);
  const [outcome, setOutcome] = useState(project.outcome);
  const [value, setValue] = useState<Value>(project.value);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim() !== '' && outcome.trim() !== '' && !submitting;

  const save = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const ok = await update({ project, patch: { title: title.trim(), outcome: outcome.trim(), value } });
    setSubmitting(false);
    if (ok) onSaved();
  };

  return (
    <Card className="gap-3">
      <Text className="text-sm font-medium text-muted dark:text-muted-dark">编辑项目</Text>
      <TextInput
        className={INPUT_CLASS}
        placeholder="项目标题"
        value={title}
        onChangeText={setTitle}
      />
      <TextInput
        className={INPUT_CLASS}
        placeholder="完成是什么样（结果）"
        value={outcome}
        onChangeText={setOutcome}
      />
      <ValueChips value={value} onChange={setValue} />
      {error !== null ? <Text className="text-sm text-danger">{errorMessage(error)}</Text> : null}
      <View className="flex-row gap-2">
        <Button label="保存" onPress={() => void save()} disabled={!canSubmit} />
        <Button label="取消" variant="secondary" onPress={onDone} />
      </View>
    </Card>
  );
}

/** The inline edit-action form (R4) — the same field set and Card + chips
 *  pattern as `AddActionForm`, pre-filled from the current row. The
 *  deadline input keeps the `endOfLocalDayIso` convention (YYYY-MM-DD →
 *  that local day's 23:59:59; empty clears the deadline). */
function EditActionForm({ action, now, onDone, onSaved }: { action: NextAction; now: Date; onDone: () => void; onSaved: () => void }) {
  const { update, error } = useUpdateNextAction();
  const [title, setTitle] = useState(action.title);
  const [estMinutes, setEstMinutes] = useState<number | null>(action.estMinutes);
  const [value, setValue] = useState<Value>(action.value);
  const [deadline, setDeadline] = useState(
    action.deadline === undefined || action.deadline === null
      ? ''
      : localDateKey(new Date(action.deadline)),
  );
  const [deadlineHint, setDeadlineHint] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [customEst, setCustomEst] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim() !== '' && estMinutes !== null && !submitting;

  const applyCustomEst = () => {
    const parsed = Number(customEst);
    if (Number.isFinite(parsed) && parsed >= 1) setEstMinutes(Math.round(parsed));
    setCustomEst('');
  };

  const save = async () => {
    if (!canSubmit || estMinutes === null) return;
    // Same convention as AddActionForm: the domain deadline is an ISO
    // *datetime*; the input is a local date — compose that local day's
    // 23:59:59, and block impossible dates instead of storing them raw.
    let deadlineIso: string | undefined;
    if (deadline.trim() !== '') {
      const iso = endOfLocalDayIso(deadline.trim());
      if (iso === null) {
        setDeadlineHint('日期格式应为 YYYY-MM-DD（例如 2026-10-01）');
        return;
      }
      deadlineIso = iso;
    }
    setSubmitting(true);
    const ok = await update({ action, patch: { title: title.trim(), estMinutes, value, deadline: deadlineIso } });
    setSubmitting(false);
    if (ok) onSaved();
  };

  return (
    <Card className="gap-3">
      <Text className="text-sm font-medium text-muted dark:text-muted-dark">编辑行动</Text>
      <TextInput
        className={INPUT_CLASS}
        placeholder="下一步行动（具体的、单步的）"
        value={title}
        onChangeText={setTitle}
      />
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-sm font-medium text-ink dark:text-ink-dark">预估时长（分钟）</Text>
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        {EST_CHIPS.map((chip) => (
          <Chip key={chip} label={String(chip)} active={estMinutes === chip} onPress={() => setEstMinutes(chip)} />
        ))}
        <TextInput
          className={`${INPUT_CLASS} h-8 w-20 p-1`}
          placeholder="自定义"
          keyboardType="number-pad"
          value={customEst}
          onChangeText={setCustomEst}
          onSubmitEditing={applyCustomEst}
        />
      </View>
      <ValueChips value={value} onChange={setValue} />
      <View className="flex-row items-center gap-2">
        <TextInput
          className={cn(INPUT_CLASS, 'flex-1')}
          placeholder="截止（YYYY-MM-DD，可选）"
          value={deadline}
          onChangeText={(next) => {
            setDeadline(next);
            setDeadlineHint(null);
          }}
          autoCapitalize="none"
        />
        <Button
          size="sm"
          label={deadline ? '更换日期' : '选择日期'}
          variant="secondary"
          onPress={() => setShowPicker(true)}
        />
      </View>
      {showPicker ? (
        <DateTimePicker
          mode="date"
          title="选择截止日期"
          value={deadline}
          now={now}
          onConfirm={(val) => {
            setDeadline(val);
            setDeadlineHint(null);
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      ) : null}
      {deadlineHint !== null ? (
        <Text className="text-sm text-danger">{deadlineHint}</Text>
      ) : null}
      {error !== null ? <Text className="text-sm text-danger">{errorMessage(error)}</Text> : null}
      <View className="flex-row gap-2">
        <Button label="保存" onPress={() => void save()} disabled={!canSubmit} />
        <Button label="取消" variant="secondary" onPress={onDone} />
      </View>
    </Card>
  );
}

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = typeof id === 'string' ? id : null;

  const { data: projects, error: projectsError } = useProjects();
  const { data: actions, error: actionsError, reload } = useProjectActions(projectId);
  const { data: contexts } = useContexts();
  const { error: addError } = useAddNextAction();
  const { complete, error: completeError } = useCompleteAction();
  const { snooze, error: snoozeError } = useSnoozeAction();
  const { trash, error: trashError } = useTrashAction();
  const now = useAppClock();

  const [showForm, setShowForm] = useState(false);
  const [showEditProject, setShowEditProject] = useState(false);
  const [snoozeTarget, setSnoozeTarget] = useState<string | null>(null);
  // One open action edit at a time (R4).
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const { update: updateProject, error: updateProjectError } = useUpdateProject();
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);

  if (projectId === null) {
    return (
      <View
        style={{ paddingTop: topPadding }}
        className="flex-1 bg-canvas px-4 pb-4 dark:bg-canvas-dark"
      >
        <EmptyState title="缺少参数，无法打开" hint="返回项目列表重试。">
          <View className="mt-4">
            <Button label="返回" variant="secondary" onPress={() => goBack('/(tabs)/projects')} />
          </View>
        </EmptyState>
      </View>
    );
  }

  const project = projects.find((entry) => entry.id === projectId);
  // 归档 / 恢复 (screen-level useUpdateProject) failures surface with the
  // other mutation errors — the edit forms show their own hook's error.
  const mutationError = addError ?? completeError ?? snoozeError ?? trashError ?? updateProjectError;
  // Action-row context ids → display names (unknown ids fall back to the id).
  const contextName = (id: string) =>
    contexts?.find((entry) => entry.id === id)?.name ?? id;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-canvas dark:bg-canvas-dark"
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: topPadding, paddingHorizontal: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-4 flex-row items-center justify-between">
          <Button label="← 项目" variant="ghost" onPress={() => goBack('/(tabs)/projects')} />
        </View>

      {projectsError !== null ? (
        <EmptyState title="加载项目失败" hint={errorMessage(projectsError)} />
      ) : project === undefined ? (
        <EmptyState title="项目不存在" hint="它可能已被删除，或数据还在同步。" />
      ) : (
        <>
          <Card className="gap-2">
            <View className="flex-row items-center gap-2">
              <Text className="flex-1 text-lg font-semibold text-ink dark:text-ink-dark">{project.title}</Text>
              <Tag label={PROJECT_STATUS_LABELS[project.status]} tone={STATUS_TONES[project.status]} />
            </View>
            <Text className="text-sm text-muted dark:text-muted-dark">完成是什么样：{project.outcome}</Text>
            <View className="flex-row items-center gap-2">
              <Tag
                label={project.hasOpenAction ? '有进行中的行动' : '缺少行动'}
                tone={project.hasOpenAction ? 'accent' : 'danger'}
              />
              <Tag label={`价值 ${project.value}`} />
            </View>
            {/* 归档 / 恢复 = a `status` single-field update (no confirm —
                reversible); done/dropped (terminal) show no status/edit
                buttons here — the weekly review decides them. */}
            {project.status === 'active' || project.status === 'on-hold' ? (
              <View className="flex-row gap-2">
                <Button
                  label="编辑"
                  variant="secondary"
                  onPress={() => {
                    setEditingActionId(null);
                    setShowEditProject(true);
                  }}
                />
                {project.status === 'active' ? (
                  <Button
                    label="归档"
                    variant="ghost"
                    onPress={() => void updateProject({ project, patch: { status: 'on-hold' } }).then(reload)}
                  />
                ) : (
                  <Button
                    label="恢复"
                    variant="ghost"
                    onPress={() => void updateProject({ project, patch: { status: 'active' } }).then(reload)}
                  />
                )}
              </View>
            ) : null}
          </Card>

          {showEditProject ? (
            <View className="mt-2">
              <EditProjectForm
                project={project}
                onDone={() => setShowEditProject(false)}
                onSaved={() => setShowEditProject(false)}
              />
            </View>
          ) : null}

          {mutationError !== null ? (
            <Text className="mt-2 text-sm text-danger">{errorMessage(mutationError)}</Text>
          ) : null}

          <View className="mt-3 flex-row items-center justify-between">
            <Text className="text-base font-medium text-ink dark:text-ink-dark">进行中的行动</Text>
            <Button label="＋ 添加行动" variant="secondary" onPress={() => setShowForm((value) => !value)} />
          </View>

          {showForm ? (
            <View className="mt-2">
              <AddActionForm projectId={projectId} now={now} onDone={() => setShowForm(false)} onAdded={reload} />
            </View>
          ) : null}

          <View className="mt-2 gap-2">
            {actionsError !== null ? (
              <EmptyState title="加载行动失败" hint={errorMessage(actionsError)} />
            ) : actions === null ? (
              <EmptyState title="加载中…" />
            ) : actions.length === 0 ? (
              <EmptyState
                title="这个项目还没有进行中的行动"
                hint="没有下一步行动的项目是回顾时的红灯 — 点「＋ 添加行动」。"
              />
            ) : (
              actions.map((action) => (
                <Card key={action.id} className="gap-2">
                  {editingActionId === action.id ? (
                    <EditActionForm
                      action={action}
                      now={now}
                      onDone={() => setEditingActionId(null)}
                      onSaved={() => {
                        setEditingActionId(null);
                        reload();
                      }}
                    />
                  ) : (
                    <>
                      <Text className="text-base text-ink dark:text-ink-dark">{action.title}</Text>
                      <View className="flex-row flex-wrap items-center gap-2">
                        <Tag label={`${action.estMinutes} 分钟`} />
                        <Tag label={`价值 ${action.value}`} />
                        {action.deadline !== undefined && action.deadline !== null ? (
                          <Tag label={`截止 ${formatLocalDate(action.deadline)}`} tone="warning" />
                        ) : null}
                      </View>
                      {action.contextIds.length > 0 ? (
                        <View className="flex-row flex-wrap gap-1.5">
                          {action.contextIds.map((id) => (
                            <ContextChip key={id} name={contextName(id)} />
                          ))}
                        </View>
                      ) : null}
                      <View className="flex-row gap-2">
                        <Button
                          label="完成"
                          variant="secondary"
                          onPress={() => void complete({ actionKind: 'next', actionId: action.id }).then(reload)}
                        />
                        <Button label="稍后" variant="secondary" onPress={() => setSnoozeTarget(action.id)} />
                        <Button label="编辑" variant="ghost" onPress={() => setEditingActionId(action.id)} />
                        <Button
                          label="删除"
                          variant="ghost"
                          onPress={() => void trash({ actionKind: 'next', actionId: action.id }).then(reload)}
                        />
                      </View>
                    </>
                  )}
                </Card>
              ))
            )}
          </View>
        </>
      )}

      </ScrollView>
      <SnoozeSheet
        open={snoozeTarget !== null}
        now={now}
        onClose={() => setSnoozeTarget(null)}
        onSelect={(target) => {
          if (snoozeTarget !== null) {
            void snooze({ actionKind: 'next', actionId: snoozeTarget, snoozedUntil: target }).then(reload);
          }
        }}
      />
    </KeyboardAvoidingView>
  );
}
