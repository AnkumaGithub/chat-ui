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

/** Orchestrator reasoning: collapsed to its title until the user opens it. */
function ReasoningStep({ event, active }: { event: AgentEvent; active: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return <li className={classes.step} data-kind={event.kind} data-active={active}>
    <button type="button" className={`${classes.stepHeader} ${classes.reasoningToggle}`} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <Icon className={classes.marker} name={iconByKind.thinking} width={16} height={16}/><strong>{names.thinking}</strong>
      <Icon className={classes.chevron} name={expanded ? EIconName.chevronFillUp : EIconName.chevronFillDown} width={16} height={16}/>
    </button>
    {expanded && event.text && <p>{event.text}</p>}
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
  const activeId = run.status === 'running' ? visible.at(-1)?.id : undefined;
  return <ol className={classes.trace}>
    {visible.map(item => {
      if (item.kind === 'thinking') return <ReasoningStep key={item.id} event={item} active={item.id === activeId}/>;
      const outcome = item.kind === 'toolCall' ? outcomes.get(item.callId) : undefined;
      const event = outcome ? {...item, kind: outcome.kind, text: outcome.text} : item;
      const title = event.kind === 'toolCall' || event.kind === 'delegation' ? sourceName(event)
        : event.kind === 'error' || event.kind === 'empty' ? sourceName(event) + outcomeSuffix[event.kind]
        : event.label || names[event.kind];
      const duration = (item.kind === 'toolCall' || item.kind === 'delegation') && item.callId ? formatDuration(callDuration(run, item, now)) : undefined;
      const lines = event.text?.split('\n').map(line => line.trim()).filter(Boolean) || [];
      const bulletItems = lines.length > 1 && lines.every(line => /^[✓→•]\s+/.test(line))
        ? lines.map(line => line.replace(/^[✓→•]\s+/, ''))
        : null;
      return <li key={event.id} className={classes.step} data-kind={event.kind} data-active={event.id === activeId} tabIndex={0}>
      <div className={classes.stepHeader}><Icon className={classes.marker} name={iconByKind[event.kind]} width={16} height={16}/><strong>{title}</strong>{duration && <small className={classes.duration}>{duration}</small>}</div>
      {bulletItems ? <ul className={classes.backendPlan}>{bulletItems.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul>
        : event.text && <p>{event.text}</p>}
      {event.todos && <ul className={classes.plan}>{event.todos.map((todo, index) => <li key={`${index}-${todo.content}`} data-status={todo.status}><span>{todo.content}</span><small>{marks[todo.status]}</small></li>)}</ul>}
    </li>})}
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
