/** UI protocol v1. Transport adapters own AG-UI/STOMP decoding. */
export type AgentEventKind = 'thinking' | 'message' | 'plan' | 'toolCall' | 'toolResult' | 'delegation' | 'handback' | 'error' | 'empty' | 'finish';
export interface AgentEvent {
  id: string;
  runId: string;
  at: number;
  kind: AgentEventKind;
  callId?: string;
  parentCallId?: string;
  tool?: string;
  source?: string;
  label?: string;
  text?: string;
  args?: unknown;
  result?: unknown;
  todos?: { content: string; status: 'pending' | 'in_progress' | 'completed' }[];
  fatal?: boolean;
}
export interface AgentRun {
  runId: string;
  requestId: string;
  startedAt: number;
  finishedAt?: number;
  currentActivity: string;
  status: 'running' | 'done' | 'failed';
  events: AgentEvent[];
}
export const activeLabels: Record<string, string> = {
  get_company_profile: 'Проверяю данные компании…',
  ask_methodologist: 'Подключаю методолога…',
  get_company_risks: 'Сверяю с реестром рисков…',
  profiler_search: 'Изучаю профиль компании…',
  ask_analyst: 'Подключаю аналитика…',
  get_company_fin_indicators: 'Проверяю финансовые показатели…',
  get_company_laws: 'Смотрю законы компании…',
  task: 'Подключаю профильного эксперта…',
  write_todos: 'Составляю план проверки…',
  get_incident_form: 'Готовлю форму события…',
  create_incident: 'Обращаюсь к регистрации события…',
};
/** Human names for tools: the trace shows who was asked, not the raw tool id. */
export const toolNames: Record<string, string> = {
  get_company_profile: 'Профайлер',
  profiler_search: 'Профайлер',
  ask_methodologist: 'Методолог',
  ask_analyst: 'Аналитик',
  get_company_fin_indicators: 'Аналитик',
  get_company_laws: 'Законы',
  get_company_risks: 'Реестр рисков',
  get_incident_form: 'Зарегистрировать меру',
  create_incident: 'Зарегистрировать меру',
};
export function sourceName(event: Pick<AgentEvent, 'tool' | 'source'>): string {
  return toolNames[event.tool || ''] || event.source || 'Источник';
}
const callEnds: AgentEventKind[] = ['toolResult', 'empty', 'error', 'handback'];
/** How long a call was open: until its outcome, the end of the run, or `now` while it still runs. */
export function callDuration(run: AgentRun, call: AgentEvent, now = Date.now()): number {
  const end = run.events.find(event => event !== call && event.callId === call.callId && callEnds.includes(event.kind));
  return (end?.at ?? run.finishedAt ?? now) - call.at;
}
/** Orchestrator-level source or expert calls the run is waiting for right now (several when called in parallel). */
export function openCalls(run: AgentRun): AgentEvent[] {
  if (run.status !== 'running') return [];
  return run.events.filter(event => (event.kind === 'toolCall' || event.kind === 'delegation') && event.callId && !event.parentCallId
    && !run.events.some(other => other !== event && other.callId === event.callId && callEnds.includes(other.kind)));
}
// Whole seconds, like a stopwatch: 0, 1, 2… — no «<1 с» that flickers on short calls.
export const formatDuration = (ms: number) => `${Math.max(0, Math.floor(ms / 1000))} с`;
/** «Думаю» only once the orchestrator actually reasons; a model without reasoning is just preparing the answer. */
const idleActivity = (events: AgentEvent[]) => events.some(event => event.kind === 'thinking' && !event.parentCallId) ? 'Думаю' : 'Готовлю ответ…';
export function createRun(runId: string, requestId: string, startedAt: number): AgentRun {
  return { runId, requestId, startedAt, currentActivity: idleActivity([]), status: 'running', events: [] };
}
export function appendEvent(run: AgentRun, event: AgentEvent): AgentRun {
  // A reconnect replay must not duplicate events or reopen a completed run.
  if (event.runId !== run.runId || run.events.some(item => item.id === event.id) || run.status !== 'running') return run;
  const events = [...run.events, event];
  if (event.kind === 'finish' || (event.kind === 'error' && event.fatal)) {
    const status = event.fatal ? 'failed' : 'done';
    return { ...run, events, status, finishedAt: event.at, currentActivity: status === 'failed' ? 'Не удалось завершить ответ' : 'Ответ готов' };
  }
  // While sources are open the activity names them, so one parallel call answering does not hide another
  // and an expert's own work keeps naming the expert until it hands back.
  const open = openCalls({ ...run, events });
  const currentActivity = open.length > 1 ? 'Проверяю несколько источников…'
    : open.length ? open[0].label || activeLabels[open[0].tool || ''] || 'Проверяю источник…'
    : event.kind === 'error' ? 'Продолжаю с доступными источниками…'
    : event.kind === 'empty' ? 'Уточняю по другим источникам…'
    : event.kind === 'plan' ? (event.todos?.every(todo => todo.status === 'completed') ? 'Формирую ответ…' : 'Составляю план проверки…')
    : event.kind === 'message' ? run.currentActivity
    : idleActivity(events);
  return { ...run, events, currentActivity };
}
export function runSummary(run: AgentRun): string {
  return `${run.status === 'failed' ? 'Прогон прерван' : 'Ответ готов'}${run.finishedAt ? ` за ${formatDuration(run.finishedAt - run.startedAt)}` : ''}`;
}
