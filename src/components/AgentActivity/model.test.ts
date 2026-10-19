import { describe, it, expect } from 'vitest';
import { appendEvent, createRun, runSummary, sourcesForRun, type AgentEvent } from './model';
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
  it('keeps a source error visible after a successful call and continues the run', () => {
    let run = createRun('run', 'request', 0);
    for (const e of [event('a', 'toolCall', {callId: '1', source: 'Реестр'}), event('b', 'error', {callId: '1'}), event('c', 'toolCall', {callId: '2', source: 'Реестр'}), event('d', 'toolResult', {callId: '2'})]) run = appendEvent(run, e);
    expect(run.status).toBe('running');
    expect(sourcesForRun(run)).toEqual([{name: 'Реестр', status: 'error', calls: 2}]);
    expect(runSummary(run)).toContain('с замечаниями: 1');
  });
  it('distinguishes empty from error and counts only successfully checked sources', () => {
    let run = createRun('run', 'request', 0);
    for (const e of [event('a', 'toolCall', {callId: '1', source: 'Компания', tool: 'get_company_profile'}), event('b', 'empty', {callId: '1'}), event('c', 'finish', {at: 12000})]) run = appendEvent(run, e);
    expect(sourcesForRun(run)[0].status).toBe('empty');
    expect(runSummary(run)).toContain('0/1');
    expect(runSummary(run)).not.toMatch(/\d+ с(?:\s|$)/);
    expect(appendEvent(run, event('late', 'toolCall'))).toBe(run);
  });
  it('terminates on fatal error without claiming a completed answer', () => {
    const run = appendEvent(createRun('run', 'request', 0), event('a', 'error', {fatal: true}));
    expect(run.status).toBe('failed');
    expect(runSummary(run)).toContain('Прогон прерван');
  });
  it('switches to answer formation when every plan item is completed', () => {
    let run = createRun('run', 'request', 0);
    run = appendEvent(run, event('done', 'plan', {todos: [
      {content: 'Проверить источник', status: 'completed'},
      {content: 'Подготовить ответ', status: 'completed'},
    ]}));
    expect(run.currentActivity).toBe('Формирую ответ…');
  });
});
