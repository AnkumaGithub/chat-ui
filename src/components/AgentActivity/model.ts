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
/** The orchestrator-level source or expert call the run is waiting for right now, if any. */
export function openCall(run: AgentRun): AgentEvent | undefined {
  if (run.status !== 'running') return undefined;
  return run.events.filter(event => (event.kind === 'toolCall' || event.kind === 'delegation') && event.callId && !event.parentCallId
    && !run.events.some(other => other !== event && other.callId === event.callId && callEnds.includes(other.kind))).at(-1);
}
export const formatDuration = (ms: number) => ms < 1000 ? '<1 с' : `${Math.round(ms / 1000)} с`;
export function createRun(runId: string, requestId: string, startedAt: number): AgentRun {
  return { runId, requestId, startedAt, currentActivity: 'Думаю', status: 'running', events: [] };
}
export function appendEvent(run: AgentRun, event: AgentEvent): AgentRun {
  // A reconnect replay must not duplicate events or reopen a completed run.
  if (event.runId !== run.runId || run.events.some(item => item.id === event.id) || run.status !== 'running') return run;
  const events = [...run.events, event];
  if (event.kind === 'finish' || (event.kind === 'error' && event.fatal)) {
    const status = event.fatal ? 'failed' : 'done';
    return { ...run, events, status, finishedAt: event.at, currentActivity: status === 'failed' ? 'Не удалось завершить ответ' : 'Ответ готов' };
  }
  // Work inside an expert stays inside: the activity keeps naming the expert until it hands back.
  const currentActivity = event.parentCallId && event.kind !== 'handback' ? run.currentActivity
    : event.kind === 'toolCall' || event.kind === 'delegation'
    ? event.label || activeLabels[event.tool || ''] || 'Проверяю источник…'
    : event.kind === 'toolResult' || event.kind === 'thinking' || event.kind === 'handback' ? 'Думаю'
    : event.kind === 'error' ? 'Продолжаю с доступными источниками…'
    : event.kind === 'empty' ? 'Уточняю по другим источникам…'
    : event.kind === 'plan' ? (event.todos?.every(todo => todo.status === 'completed') ? 'Формирую ответ…' : 'Составляю план проверки…')
    : run.currentActivity;
  return { ...run, events, currentActivity };
}
export type SourceState = { name: string; status: 'running' | 'success' | 'empty' | 'error'; calls: number };
/** Sources and experts the orchestrator asked; an expert's own calls are not counted separately. */
export function sourcesForRun(run: AgentRun): SourceState[] {
  const calls = new Map<string, { name: string; status: SourceState['status'] }>();
  for (const event of run.events) {
    if (!event.callId) continue;
    if ((event.kind === 'toolCall' || event.kind === 'delegation') && !event.parentCallId && (event.source || event.tool)) calls.set(event.callId, {name: sourceName(event), status: 'running'});
    const call = calls.get(event.callId);
    if (call && ['toolResult', 'handback', 'empty', 'error'].includes(event.kind)) {
      call.status = event.kind === 'toolResult' || event.kind === 'handback' ? 'success' : event.kind as 'empty' | 'error';
    }
  }
  const sources = new Map<string, SourceState>();
  // Any unavailable/empty call remains visible even when another call succeeded.
  const priority = {success: 0, empty: 1, running: 2, error: 3};
  for (const call of calls.values()) {
    const previous = sources.get(call.name);
    sources.set(call.name, {name: call.name, calls: (previous?.calls || 0) + 1,
      status: previous && priority[previous.status] > priority[call.status] ? previous.status : call.status});
  }
  return [...sources.values()];
}
export function runSummary(run: AgentRun): string {
  const sources = sourcesForRun(run);
  const successful = sources.filter(source => source.status === 'success').length;
  const incomplete = sources.length - successful;
  return `${run.status === 'failed' ? 'Прогон прерван' : 'Ответ готов'}${run.finishedAt ? ` за ${formatDuration(run.finishedAt - run.startedAt)}` : ''}${sources.length ? ` · источников: ${successful}/${sources.length}` : ''}${incomplete ? ` · с замечаниями: ${incomplete}` : ''}`;
}
