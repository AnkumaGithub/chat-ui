import { useId, useState } from 'react';
import { EIconName, Icon } from '@sber-orm/ui-kit';
import { ChatLogoSVG } from '@/components/ChatLogoSVG';
import { type AgentRun } from './model';
import { AgentTrace } from './AgentTrace';
import classes from './styles.module.scss';

export function AgentActivity({ run }: { run: AgentRun }) {
  const [expanded, setExpanded] = useState(false);
  const traceId = useId();

  const label = run.status === 'running' ? run.currentActivity : run.status === 'failed' ? 'Не удалось завершить ответ' : 'Ответ готов';
  return <section className={classes.activity} aria-label="Ход работы агента" data-status={run.status} data-expanded={expanded}>
    <button type="button" className={classes.live} aria-label={label} aria-expanded={expanded} aria-controls={traceId} onClick={() => setExpanded(value => !value)}>
      <ChatLogoSVG className={classes.agentIcon}/><span role="status" aria-live="polite">{label}</span><Icon className={classes.chevron} name={expanded ? EIconName.chevronFillUp : EIconName.chevronFillDown} width={16} height={16}/>
    </button>
    {expanded && <div id={traceId} className={classes.expanded}><AgentTrace run={run}/></div>}
  </section>;
}
