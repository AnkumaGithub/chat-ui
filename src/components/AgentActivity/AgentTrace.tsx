import { EIconName, Icon } from '@sber-orm/ui-kit';
import { type AgentEvent, type AgentRun, runSummary, sourcesForRun } from './model';
import classes from './styles.module.scss';
const names: Record<AgentEvent['kind'], string> = {
  thinking: 'Обдумывание', message: 'Промежуточная реплика', plan: 'План · write_todos', toolCall: 'Вызов источника', toolResult: 'Результат', delegation: 'Делегирование', handback: 'Возврат эксперта', error: 'Ошибка источника', empty: 'Ничего не найдено', finish: 'Завершено',
};
const statusLabels = { running: 'Выполняется', success: 'Завершён', empty: 'Нет данных', error: 'Недоступен' };
const marks = { pending: 'Ожидает', in_progress: 'В работе', completed: 'Готово' };
const iconByKind: Record<AgentEvent['kind'], EIconName> = {
  thinking: EIconName.clock, message: EIconName.fill, plan: EIconName.taskList, toolCall: EIconName.taskSearch, toolResult: EIconName.success, delegation: EIconName.users, handback: EIconName.userSwap, error: EIconName.errorRounded, empty: EIconName.warningRounded, finish: EIconName.check,
};

function TraceSteps({ run, parent }: { run: AgentRun; parent?: string }) {
  return <ol className={classes.trace}>
    {run.events.filter(event => event.kind !== 'finish' && event.parentCallId === parent).map(event => {
      const lines = event.text?.split('\n').map(line => line.trim()).filter(Boolean) || [];
      const bulletItems = lines.length > 1 && lines.every(line => /^[✓→•]\s+/.test(line))
        ? lines.map(line => line.replace(/^[✓→•]\s+/, ''))
        : null;
      return <li key={event.id} className={classes.step} data-kind={event.kind} data-active={run.status === 'running' && event.id === run.events.at(-1)?.id} tabIndex={0}>
      <div className={classes.stepHeader}><Icon className={classes.marker} name={iconByKind[event.kind]} width={16} height={16}/><strong>{run.status === 'running' && event.id === run.events.at(-1)?.id ? run.currentActivity : event.label || names[event.kind]}</strong></div>
      {(event.source || event.tool) && <div className={classes.meta}>{event.source}{event.source && event.tool ? ' · ' : ''}<code>{event.tool}</code></div>}
      {bulletItems ? <ul className={classes.backendPlan}>{bulletItems.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
        : event.text && event.kind !== 'toolResult' && <p>{event.text}</p>}
      {event.todos && <ul className={classes.plan}>{event.todos.map((todo, index) => <li key={`${index}-${todo.content}`} data-status={todo.status}><span>{todo.content}</span><small>{marks[todo.status]}</small></li>)}</ul>}
      {event.kind === 'delegation' && event.callId && <TraceSteps run={run} parent={event.callId}/>} 
    </li>})}
  </ol>;
}

/** Presentation-only trace, reusable inside an inline disclosure or drawer. */
export function AgentTrace({ run }: { run: AgentRun }) {
  const sources = sourcesForRun(run);
  return <div className={classes.traceIslands}>
    <div className={classes.traceContent}>
    <div className={classes.traceTitle}>Ход работы <span>{run.status === 'running' ? 'Выполняется сейчас' : runSummary(run)}</span></div>
    <TraceSteps run={run}/>
    </div>
    {!!sources.length && <div className={`${classes.traceContent} ${classes.sourceSummary}`}><strong>Источники</strong><ul>{sources.map(source => <li key={source.name} data-status={source.status}><span>{source.name}</span><small>{statusLabels[source.status]} · {source.calls} обр.</small></li>)}</ul></div>}
  </div>;
}
