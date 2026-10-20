import { describe, it, expect } from 'vitest';
import { appendEvent, callDuration, createRun, formatDuration, openCalls, runSummary, sourceName, type AgentEvent } from './model';
const event = (id: string, kind: AgentEvent['kind'], extra: Partial<AgentEvent> = {}): AgentEvent => ({ id, kind, runId: 'run', at: 1000, ...extra });
describe('UI run protocol', () => {
  it('isolates runs and deduplicates reconnect replay', () => {
    const initial = createRun('run', 'request', 0);
    const first = event('a', 'thinking', { text: 'public trace' });
    const run = appendEvent(initial, first);
    expect(appendEvent(run, first)).toBe(run);
    expect(appendEvent(run, { ...first, id: 'b', runId: 'another' })).toBe(run);
  });
  it('keeps full payload and nested parent correlation', () => {
    const payload = 'x'.repeat(4000);
    const run = appendEvent(createRun('run', 'request', 0), event('a', 'toolResult', {parentCallId: 'expert', result: payload}));
    expect(run.events[0].result).toBe(payload);
    expect(run.events[0].parentCallId).toBe('expert');
  });
  it('continues the run after a source error', () => {
    let run = createRun('run', 'request', 0);
    for (const e of [event('a', 'toolCall', {callId: '1', source: 'Реестр'}), event('b', 'error', {callId: '1'})]) run = appendEvent(run, e);
    expect(run.status).toBe('running');
    expect(run.currentActivity).toBe('Думаю');
  });
  it('summarizes a finished run by its total time only', () => {
    let run = createRun('run', 'request', 0);
    for (const e of [event('a', 'toolCall', {callId: '1', source: 'Компания', tool: 'get_company_profile'}), event('b', 'empty', {callId: '1'}), event('c', 'finish', {at: 12000})]) run = appendEvent(run, e);
    expect(runSummary(run)).toBe('Ответ готов за 12 с');
    expect(appendEvent(run, event('late', 'toolCall'))).toBe(run);
  });
  it('terminates on fatal error without claiming a completed answer', () => {
    const run = appendEvent(createRun('run', 'request', 0), event('a', 'error', {fatal: true}));
    expect(run.status).toBe('failed');
    expect(runSummary(run)).toContain('Прогон прерван');
  });
  it('summarizes backend text steps without inventing source-call counts', () => {
    let run = createRun('run', 'request', 0);
    run = appendEvent(run, event('step', 'message', {label: 'Посмотрел профиль компании'}));
    run = appendEvent(run, event('finish', 'finish', {at: 2000}));
    expect(runSummary(run)).toBe('Ответ готов за 2 с');
  });
  it('names sources by role instead of raw tool ids', () => {
    expect(sourceName({tool: 'get_company_profile', source: 'Данные компании'})).toBe('Профайлер');
    expect(sourceName({tool: 'create_incident'})).toBe('Зарегистрировать меру');
    expect(sourceName({tool: 'task', source: 'Методолог'})).toBe('Методолог');
  });
  it('has three statuses while running: thinking, sources, expert', () => {
    let run = createRun('run', 'request', 0);
    expect(run.currentActivity).toBe('Думаю');
    run = appendEvent(run, event('a', 'toolCall', {callId: '1', tool: 'get_company_risks'}));
    expect(run.currentActivity).toBe('Собираю источники');
    run = appendEvent(run, event('b', 'toolResult', {callId: '1'}));
    expect(run.currentActivity).toBe('Думаю');
    run = appendEvent(run, event('c', 'toolCall', {callId: '2', tool: 'ask_analyst'}));
    expect(run.currentActivity).toBe('Делегирую: аналитик');
  });
  it('formats durations as whole seconds without «<1 с»', () => {
    expect(formatDuration(400)).toBe('0 с');
    expect(formatDuration(1900)).toBe('1 с');
  });
  it('times each source call and keeps counting only while it is open', () => {
    let run = createRun('run', 'request', 0);
    const call = event('a', 'toolCall', {callId: '1', tool: 'ask_methodologist', at: 1000});
    run = appendEvent(run, call);
    expect(openCalls(run)).toEqual([call]);
    expect(formatDuration(callDuration(run, call, 13_400))).toBe('12 с');
    run = appendEvent(run, event('b', 'toolResult', {callId: '1', at: 5200}));
    expect(openCalls(run)).toEqual([]);
    expect(formatDuration(callDuration(run, call, 60_000))).toBe('4 с');
  });
  it('stops an open call counter when the run fails', () => {
    let run = createRun('run', 'request', 0);
    const call = event('a', 'toolCall', {callId: '1', at: 1000});
    run = appendEvent(run, call);
    run = appendEvent(run, event('b', 'error', {fatal: true, at: 8000}));
    expect(openCalls(run)).toEqual([]);
    expect(callDuration(run, call, 60_000)).toBe(7000);
  });
  it('keeps an expert as one step: its own calls do not change the activity', () => {
    let run = createRun('run', 'request', 0);
    const expert = event('a', 'delegation', {callId: 'expert', tool: 'task', source: 'Методолог', label: 'Подключаю методолога…', at: 1000});
    run = appendEvent(run, expert);
    run = appendEvent(run, event('b', 'toolCall', {parentCallId: 'expert', callId: 'm', tool: 'ask_methodologist', at: 2000}));
    run = appendEvent(run, event('c', 'toolResult', {parentCallId: 'expert', callId: 'm', at: 5000}));
    expect(run.currentActivity).toBe('Делегирую: методолог');
    expect(openCalls(run)).toEqual([expert]);
    run = appendEvent(run, event('d', 'handback', {parentCallId: 'expert', callId: 'expert', at: 8000}));
    expect(run.currentActivity).toBe('Думаю');
    expect(callDuration(run, expert)).toBe(7000);
  });
  it('follows parallel calls: an expert is named while it works, one answer does not reset the status', () => {
    let run = createRun('run', 'request', 0);
    run = appendEvent(run, event('a', 'toolCall', {callId: '1', tool: 'get_company_laws'}));
    run = appendEvent(run, event('b', 'toolCall', {callId: '2', tool: 'get_company_risks'}));
    expect(run.currentActivity).toBe('Собираю источники');
    run = appendEvent(run, event('c', 'toolCall', {callId: '3', tool: 'ask_methodologist'}));
    expect(run.currentActivity).toBe('Делегирую: методолог');
    run = appendEvent(run, event('e', 'toolResult', {callId: '3'}));
    run = appendEvent(run, event('f', 'toolResult', {callId: '1'}));
    expect(run.currentActivity).toBe('Собираю источники');
    run = appendEvent(run, event('d', 'toolResult', {callId: '2'}));
    expect(run.currentActivity).toBe('Думаю');
  });
});
