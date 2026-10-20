import { useState } from 'react';
import { EIconName, Icon } from '@sber-orm/ui-kit';
import { type AgentEvent, type AgentRun, callDuration, formatDuration, openCalls, runSummary, sourceName } from './model';
import { useNow } from './useNow';
import classes from './styles.module.scss';
const names: Record<AgentEvent['kind'], string> = {
  thinking: 'Рассуждение', message: 'Промежуточная реплика', plan: 'План', toolCall: 'Вызов источника', toolResult: 'Результат', delegation: 'Делегирование', handback: 'Возврат эксперта', error: 'Ошибка источника', empty: 'Ничего не найдено', finish: 'Завершено',
};
const marks = { pending: 'Ожидает', in_progress: 'В работе', completed: 'Готово' };
const iconByKind: Record<AgentEvent['kind'], EIconName> = {
  thinking: EIconName.clock, message: EIconName.fill, plan: EIconName.taskList, toolCall: EIconName.taskSearch, toolResult: EIconName.success, delegation: EIconName.users, handback: EIconName.userSwap, error: EIconName.errorRounded, empty: EIconName.warningRounded, finish: EIconName.check,
};

const outcomeSuffix = { error: ' — недоступен', empty: ' — нет данных' };

/** `reasoningId` is the first reasoning chunk: it keeps the expanded state when live reasoning moves under its call. */
type Step = { event: AgentEvent; reasoning: string; reasoningId?: string };
type Toggle = { expanded: boolean; onToggle: () => void };

/** A step with the orchestrator reasoning that led to it, collapsed behind a chevron. */
function TraceStep({ run, step: { event: item, reasoning }, outcome, active, now, expanded, onToggle }: { run: AgentRun; step: Step; outcome?: AgentEvent; active: boolean; now: number } & Toggle) {
  const event = outcome ? {...item, kind: outcome.kind, text: outcome.text} : item;
  const title = event.kind === 'toolCall' || event.kind === 'delegation' ? sourceName(event)
    : event.kind === 'error' || event.kind === 'empty' ? sourceName(event) + outcomeSuffix[event.kind]
    : event.label || names[event.kind];
  const duration = (item.kind === 'toolCall' || item.kind === 'delegation') && item.callId ? formatDuration(callDuration(run, item, now)) : undefined;
  const lines = event.text?.split('\n').map(line => line.trim()).filter(Boolean) || [];
  const bulletItems = lines.length > 1 && lines.every(line => /^[✓→•]\s+/.test(line))
    ? lines.map(line => line.replace(/^[✓→•]\s+/, ''))
    : null;
  const header = <><Icon className={classes.marker} name={iconByKind[event.kind]} width={16} height={16}/><strong>{title}</strong>{duration && <small className={classes.duration}>{duration}</small>}</>;
  return <li className={classes.step} data-kind={event.kind} data-active={active}>
    {reasoning
      ? <button type="button" className={`${classes.stepHeader} ${classes.reasoningToggle}`} aria-expanded={expanded} aria-label={`${title}: ${expanded ? 'скрыть' : 'показать'} рассуждение`} onClick={onToggle}>
          {header}<Icon className={classes.chevron} name={expanded ? EIconName.chevronFillUp : EIconName.chevronFillDown} width={16} height={16}/>
        </button>
      : <div className={classes.stepHeader} tabIndex={0}>{header}</div>}
    {expanded && <p>{reasoning}</p>}
    {bulletItems ? <ul className={classes.backendPlan}>{bulletItems.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul>
      : event.text && <p>{event.text}</p>}
    {event.todos && <ul className={classes.plan}>{event.todos.map((todo, index) => <li key={`${index}-${todo.content}`} data-status={todo.status}><span>{todo.content}</span><small>{marks[todo.status]}</small></li>)}</ul>}
  </li>;
}

/** Reasoning not followed by a call: live «Думаю» until its call starts, or the final reasoning before the answer.
 * Collapsed like the step it may fold into, so nothing jumps. */
function TrailingReasoning({ reasoning, title, active, expanded, onToggle }: { reasoning: string; title: string; active: boolean } & Toggle) {
  return <li className={classes.step} data-kind="thinking" data-active={active}>
    <button type="button" className={`${classes.stepHeader} ${classes.reasoningToggle}`} aria-expanded={expanded} aria-label={`${title}: ${expanded ? 'скрыть' : 'показать'} рассуждение`} onClick={onToggle}>
      <Icon className={classes.marker} name={iconByKind.thinking} width={16} height={16}/><strong>{title}</strong>
      <Icon className={classes.chevron} name={expanded ? EIconName.chevronFillUp : EIconName.chevronFillDown} width={16} height={16}/>
    </button>
    {expanded && <p>{reasoning}</p>}
  </li>;
}

function TraceSteps({ run, now }: { run: AgentRun; now: number }) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id?: string): Toggle => ({
    expanded: !!id && expandedIds.has(id),
    onToggle: () => id && setExpandedIds(ids => { const next = new Set(ids); if (!next.delete(id)) next.add(id); return next; }),
  });
  // Only the orchestrator level is shown: an expert is one step, its own calls and reasoning stay inside.
  // A call step only says which source was asked: its result is not repeated,
  // and an unavailable/empty outcome is folded into the same step.
  const steps = run.events.filter(event => !event.parentCallId);
  const callIds = new Set(steps.filter(event => event.kind === 'toolCall').map(event => event.callId));
  const outcomes = new Map(steps.filter(event => (event.kind === 'error' || event.kind === 'empty') && callIds.has(event.callId)).map(event => [event.callId, event]));
  // Unlabeled messages are the model's intermediate replies; labeled ones are backend service steps.
  const visible = steps.filter(event => event.kind !== 'finish' && event.kind !== 'toolResult' && !(event.kind === 'message' && !event.label) && outcomes.get(event.callId) !== event);
  // Reasoning is not a step of its own: it streams in as text chunks and belongs to the step it led to.
  // While no step follows yet, it is shown live at the end; the final reasoning before the answer stays there.
  const grouped: Step[] = [];
  let reasoning = '';
  let reasoningId: string | undefined;
  for (const event of visible) {
    if (event.kind === 'thinking') { reasoning += event.text || ''; reasoningId ??= event.id; continue; }
    grouped.push({event, reasoning, reasoningId});
    reasoning = '';
    reasoningId = undefined;
  }
  const running = run.status === 'running';
  // Every open call is active (parallel calls run together); between calls, the live reasoning or the last step is.
  const open = openCalls(run);
  const activeIds = new Set(open.length ? open.map(event => event.id) : running && !reasoning ? [grouped.at(-1)?.event.id] : []);
  return <ol className={classes.trace}>
    {grouped.map(step => <TraceStep key={step.event.id} run={run} step={step} now={now} active={activeIds.has(step.event.id)}
      outcome={step.event.kind === 'toolCall' ? outcomes.get(step.event.callId) : undefined} {...toggle(step.reasoningId)}/>)}
    {reasoning && <TrailingReasoning reasoning={reasoning} title={running ? 'Думаю' : 'Итоговое рассуждение'} active={running && !open.length} {...toggle(reasoningId)}/>}
  </ol>;
}

/** Presentation-only trace, reusable inside an inline disclosure or drawer. */
export function AgentTrace({ run }: { run: AgentRun }) {
  const now = useNow(openCalls(run).length > 0);
  return <div className={classes.traceIslands}>
    <div className={classes.traceContent}>
    <div className={classes.traceTitle}>Ход работы <span>{run.status === 'running' ? 'Выполняется сейчас' : runSummary(run)}</span></div>
    <TraceSteps run={run} now={now}/>
    </div>
  </div>;
}
