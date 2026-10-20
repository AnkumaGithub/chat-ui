import { useId, useState } from 'react';
import { EIconName, Icon } from '@sber-orm/ui-kit';
import { ChatLogoSVG } from '@/components/ChatLogoSVG';
import { type AgentRun } from './model';
import { AgentTrace } from './AgentTrace';
import classes from './styles.module.scss';

export function AgentActivity({ run }: { run?: AgentRun }) {
  const [expanded, setExpanded] = useState(false);
  const traceId = useId();

  const canExpand = !!run?.events.some(event => event.kind !== 'finish');
  const label = !run || !canExpand ? run?.currentActivity ?? 'Готовлю ответ…' : run.status === 'running' ? run.currentActivity : run.status === 'failed' ? 'Не удалось завершить ответ' : 'Ответ готов';
  const content = <><ChatLogoSVG className={classes.agentIcon}/><span role="status" aria-live="polite">{label}</span>{canExpand && <Icon className={classes.chevron} name={expanded ? EIconName.chevronFillUp : EIconName.chevronFillDown} width={16} height={16}/>}</>;
  return <section className={classes.activity} aria-label="Ход работы агента" data-status={run?.status ?? 'running'} data-expanded={canExpand && expanded}>
    {canExpand
      ? <button type="button" className={classes.live} aria-label={label} aria-expanded={expanded} aria-controls={traceId} onClick={() => setExpanded(value => !value)}>{content}</button>
      : <div className={`${classes.live} ${classes.liveStatic}`}>{content}</div>}
    {canExpand && expanded && run && <div id={traceId} className={classes.expanded}><AgentTrace run={run}/></div>}
  </section>;
}
