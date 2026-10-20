import { EIconName, Icon } from '@sber-orm/ui-kit';
import { type AgentEvent, type AgentRun, runSummary, sourceName } from './model';
import classes from './styles.module.scss';
const names: Record<AgentEvent['kind'], string> = {
  thinking: 'Обдумывание', message: 'Промежуточная реплика', plan: 'План', toolCall: 'Вызов источника', toolResult: 'Результат', delegation: 'Делегирование', handback: 'Возврат эксперта', error: 'Ошибка источника', empty: 'Ничего не найдено', finish: 'Завершено',
};
const marks = { pending: 'Ожидает', in_progress: 'В работе', completed: 'Готово' };
const iconByKind: Record<AgentEvent['kind'], EIconName> = {
  thinking: EIconName.clock, message: EIconName.fill, plan: EIconName.taskList, toolCall: EIconName.taskSearch, toolResult: EIconName.success, delegation: EIconName.users, handback: EIconName.userSwap, error: EIconName.errorRounded, empty: EIconName.warningRounded, finish: EIconName.check,
};

const outcomeSuffix = { error: ' — недоступен', empty: ' — нет данных' };

function TraceSteps({ run, parent }: { run: AgentRun; parent?: string }) {
  // A call step only says which source was asked: its result is not repeated,
  // and an unavailable/empty outcome is folded into the same step.
  const callIds = new Set(run.events.filter(event => event.kind === 'toolCall').map(event => event.callId));
  const outcomes = new Map(run.events.filter(event => (event.kind === 'error' || event.kind === 'empty') && callIds.has(event.callId)).map(event => [event.callId, event]));
  // Unlabeled messages are the model's intermediate replies; labeled ones are backend service steps.
  const isVisible = (event: AgentEvent) => event.kind !== 'finish' && event.kind !== 'toolResult' && !(event.kind === 'message' && !event.label) && !(outcomes.get(event.callId) === event);
  const activeId = run.status === 'running' ? run.events.filter(isVisible).at(-1)?.id : undefined;
  return <ol className={classes.trace}>
    {run.events.filter(event => isVisible(event) && event.parentCallId === parent).map(item => {
      const outcome = item.kind === 'toolCall' ? outcomes.get(item.callId) : undefined;
      const event = outcome ? {...item, kind: outcome.kind, text: outcome.text} : item;
      const title = event.kind === 'toolCall' || event.kind === 'delegation' ? sourceName(event)
        : event.kind === 'error' || event.kind === 'empty' ? sourceName(event) + outcomeSuffix[event.kind]
        : event.label || names[event.kind];
      const lines = event.text?.split('\n').map(line => line.trim()).filter(Boolean) || [];
      const bulletItems = lines.length > 1 && lines.every(line => /^[✓→•]\s+/.test(line))
        ? lines.map(line => line.replace(/^[✓→•]\s+/, ''))
        : null;
      return <li key={event.id} className={classes.step} data-kind={event.kind} data-active={event.id === activeId} tabIndex={0}>
      <div className={classes.stepHeader}><Icon className={classes.marker} name={iconByKind[event.kind]} width={16} height={16}/><strong>{event.id === activeId ? run.currentActivity : title}</strong></div>
      {bulletItems ? <ul className={classes.backendPlan}>{bulletItems.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
        : event.text && <p>{event.text}</p>}
      {event.todos && <ul className={classes.plan}>{event.todos.map((todo, index) => <li key={`${index}-${todo.content}`} data-status={todo.status}><span>{todo.content}</span><small>{marks[todo.status]}</small></li>)}</ul>}
      {event.kind === 'delegation' && event.callId && <TraceSteps run={run} parent={event.callId}/>}
    </li>})}
  </ol>;
}

/** Presentation-only trace, reusable inside an inline disclosure or drawer. */
export function AgentTrace({ run }: { run: AgentRun }) {
  return <div className={classes.traceIslands}>
    <div className={classes.traceContent}>
    <div className={classes.traceTitle}>Ход работы <span>{run.status === 'running' ? 'Выполняется сейчас' : runSummary(run)}</span></div>
    <TraceSteps run={run}/>
    </div>
  </div>;
}
