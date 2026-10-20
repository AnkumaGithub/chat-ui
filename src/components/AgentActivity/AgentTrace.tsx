import { useState } from 'react';
import { EIconName, Icon } from '@sber-orm/ui-kit';
import { type AgentEvent, type AgentRun, callDuration, formatDuration, openCall, runSummary, sourceName } from './model';
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

type Step = { event: AgentEvent; reasoning: string[] };

/** A step with the orchestrator reasoning that led to it, collapsed behind a chevron. */
function TraceStep({ run, step: { event: item, reasoning }, outcome, active, now }: { run: AgentRun; step: Step; outcome?: AgentEvent; active: boolean; now: number }) {
  const [expanded, setExpanded] = useState(false);
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
    {reasoning.length
      ? <button type="button" className={`${classes.stepHeader} ${classes.reasoningToggle}`} aria-expanded={expanded} aria-label={`${title}: ${expanded ? 'скрыть' : 'показать'} рассуждение`} onClick={() => setExpanded(value => !value)}>
          {header}<Icon className={classes.chevron} name={expanded ? EIconName.chevronFillUp : EIconName.chevronFillDown} width={16} height={16}/>
        </button>
      : <div className={classes.stepHeader} tabIndex={0}>{header}</div>}
    {expanded && reasoning.map((text, index) => <p key={index}>{text}</p>)}
    {bulletItems ? <ul className={classes.backendPlan}>{bulletItems.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul>
      : event.text && <p>{event.text}</p>}
    {event.todos && <ul className={classes.plan}>{event.todos.map((todo, index) => <li key={`${index}-${todo.content}`} data-status={todo.status}><span>{todo.content}</span><small>{marks[todo.status]}</small></li>)}</ul>}
  </li>;
}

function TraceSteps({ run, now }: { run: AgentRun; now: number }) {
  // Only the orchestrator level is shown: an expert is one step, its own calls and reasoning stay inside.
  // A call step only says which source was asked: its result is not repeated,
  // and an unavailable/empty outcome is folded into the same step.
  const steps = run.events.filter(event => !event.parentCallId);
  const callIds = new Set(steps.filter(event => event.kind === 'toolCall').map(event => event.callId));
  const outcomes = new Map(steps.filter(event => (event.kind === 'error' || event.kind === 'empty') && callIds.has(event.callId)).map(event => [event.callId, event]));
  // Unlabeled messages are the model's intermediate replies; labeled ones are backend service steps.
  const visible = steps.filter(event => event.kind !== 'finish' && event.kind !== 'toolResult' && !(event.kind === 'message' && !event.label) && outcomes.get(event.callId) !== event);
  // Reasoning is not a step of its own: it belongs to the step it led to.
  // Reasoning after the last step (before the answer) has no step to belong to and is not shown.
  const grouped: Step[] = [];
  let reasoning: string[] = [];
  for (const event of visible) {
    if (event.kind === 'thinking') { if (event.text) reasoning.push(event.text); continue; }
    grouped.push({event, reasoning});
    reasoning = [];
  }
  const activeId = run.status === 'running' ? grouped.at(-1)?.event.id : undefined;
  return <ol className={classes.trace}>
    {grouped.map(step => <TraceStep key={step.event.id} run={run} step={step} now={now} active={step.event.id === activeId}
      outcome={step.event.kind === 'toolCall' ? outcomes.get(step.event.callId) : undefined}/>)}
  </ol>;
}

/** Presentation-only trace, reusable inside an inline disclosure or drawer. */
export function AgentTrace({ run }: { run: AgentRun }) {
  const now = useNow(!!openCall(run));
  return <div className={classes.traceIslands}>
    <div className={classes.traceContent}>
    <div className={classes.traceTitle}>Ход работы <span>{run.status === 'running' ? 'Выполняется сейчас' : runSummary(run)}</span></div>
    <TraceSteps run={run} now={now}/>
    </div>
  </div>;
}
