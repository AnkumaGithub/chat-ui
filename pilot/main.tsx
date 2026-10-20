import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { reatomContext } from '@reatom/npm-react';
import { Button } from '@sber-orm/ui-kit';
import { ModalContainer } from '@/components/ModalContainer';
import { ctx } from '@/stores/ctx';
import { addMessageAction, attachmentsAtom, canLoadHistoryAtom, contextChatAtom, isLoadingAtom, messagesAtom, resetAction, textAtom } from '@/stores';
import { ERoles, type IMessage } from '@/types';
import { AgentRunsContext } from '../src/components/AgentActivity/context';
import { appendEvent, createRun, type AgentRun } from '../src/components/AgentActivity/model';
import { AssistantSkillsContext, type AssistantSkill } from '../src/components/AssistantSkills/context';
import { ThreadUiContext, type ChatThread } from '../src/components/ThreadDrawer/context';
import { chat$, EChatState } from './mocks/auth';
import { resetPending, setDemoOnline, setDemoSender } from './mocks/useChat';
import { chart, fixture, scenarios, type ScenarioId } from './scenarios';
import modalClasses from '@/components/ModalContainer/styles.module.scss';
import chatClasses from '@/components/Chat/styles.module.scss';
import '@/i18n';
import './vendor/ui-kit/dist/index.css';
import './styles.css';

interface DemoThread extends ChatThread { scenario: ScenarioId; messages: IMessage[]; runs: Record<string, AgentRun>; }
const assistantSkills: AssistantSkill[] = [
  {id: 'methodologist', title: 'Методолог'}, {id: 'risk-review', title: 'Проверка рисков'}, {id: 'createIncident', title: 'Регистрация события'},
];
const demoFlags = { assistantSkills: false } as const;

function historicalThread(id: string, title: string, scenario: ScenarioId, minutesAgo: number, pinned = false, initialSkill?: string): DemoThread {
  const startedAt = Date.now() - minutesAgo * 60_000;
  const requestId = `${id}-question`; const responseId = `${id}-answer`;
  const {events, answer} = fixture(scenario, responseId, startedAt);
  let run = createRun(responseId, requestId, startedAt);
  events.forEach(event => { run = appendEvent(run, event); });
  if (events.length) run = appendEvent(run, {id: `${responseId}-finish`, runId: responseId, at: startedAt + 10_000, kind: 'finish'});
  return {id, title, scenario, pinned, initialSkill, updatedAt: startedAt, runs: events.length ? {[responseId]: run} : {}, messages: [
    {id: requestId, role: ERoles.user, text: scenarios.find(item => item.id === scenario)!.question, timeCreated: new Date(startedAt).toISOString()},
    {id: responseId, requestId, role: ERoles.bot, text: answer, timeCreated: new Date(startedAt + 1).toISOString(), extras: scenario === 'rich' ? {fileIds:'["demo-report"]', chart} as IMessage['extras'] : undefined},
  ]};
}
const initialThreads = () => [
  historicalThread('risk', 'Анализ рисков компании', 'normal', 8, true),
  historicalThread('registration', 'Регистрация события', 'registration', 22, false, 'createIncident'),
  historicalThread('expert', 'Проверка поставщика', 'subagent', 65, true),
  historicalThread('registry', 'Риски нового направления', 'empty', 180),
  historicalThread('finance', 'Финансовые показатели', 'rich', 360),
];

function App() {
  const [threads, setThreads] = useState<DemoThread[]>(initialThreads); const threadsRef = useRef(threads);
  const [activeThreadId, setActiveThreadId] = useState('risk'); const activeIdRef = useRef(activeThreadId);
  const [scenario, setScenario] = useState<ScenarioId>('normal');
  const [runs, setRunsState] = useState<Record<string, AgentRun>>({}); const runsRef = useRef(runs);
  const [selectedSkillId, setSelectedSkillId] = useState<string>();
  const [playing, setPlaying] = useState(false); const [online, setOnline] = useState(true); const [actionUrl, setActionUrl] = useState('');
  const generation = useRef(0); const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const setRuns = (value: Record<string, AgentRun>) => { runsRef.current = value; setRunsState(value); };
  const clearTimers = () => { generation.current++; timeouts.current.forEach(clearTimeout); timeouts.current = []; };
  const later = (callback: () => void, delay: number) => { const current = generation.current; timeouts.current.push(setTimeout(() => {if (current === generation.current) callback();}, delay)); };
  const updateThreads = (change: (items: DemoThread[]) => DemoThread[]) => { const next = change(threadsRef.current); threadsRef.current = next; setThreads(next); };
  const storeCurrent = () => {
    const next = threadsRef.current.map(thread => thread.id === activeIdRef.current ? {...thread, messages: ctx.get(messagesAtom).map(({remove: _remove, ...message}) => message), runs: runsRef.current, updatedAt: Date.now()} : thread);
    threadsRef.current = next; setThreads(next); return next;
  };
  const loadThread = (thread: DemoThread) => {
    clearTimers(); resetPending(); resetAction(ctx); attachmentsAtom(ctx, []); textAtom(ctx, ''); thread.messages.forEach(message => addMessageAction(ctx, message));
    canLoadHistoryAtom(ctx, false); isLoadingAtom(ctx, false); contextChatAtom(ctx, thread.initialSkill === 'createIncident' ? {intent:'createIncident', company_id:'demo-company'} : {company_id:'demo-company'});
    activeIdRef.current = thread.id; setActiveThreadId(thread.id); setScenario(thread.scenario); setRuns(thread.runs); setPlaying(false); setSelectedSkillId(thread.initialSkill === 'createIncident' ? 'createIncident' : undefined);
  };
  const selectThread = (id: string) => { const saved = storeCurrent(); const thread = saved.find(item => item.id === id); if (thread) loadThread(thread); };
  const newThread = () => { const saved = storeCurrent(); const id = `thread-${crypto.randomUUID()}`; const thread: DemoThread = {id, title:'Новый диалог', pinned:false, updatedAt:Date.now(), scenario:'ordinary', messages:[], runs:{}}; const next = [...saved, thread]; threadsRef.current = next; setThreads(next); loadThread(thread); };
  const deleteThread = (id: string) => { const remaining = threadsRef.current.filter(item => item.id !== id); if (!remaining.length) { newThread(); return; } updateThreads(() => remaining); if (id === activeIdRef.current) loadThread(remaining[0]); };

  function play(id: ScenarioId, instant = false, body?: string, extras?: Record<string,string>) {
    clearTimers(); resetPending(); resetAction(ctx); attachmentsAtom(ctx, []); textAtom(ctx, ''); canLoadHistoryAtom(ctx, false); isLoadingAtom(ctx, false);
    const registration = id === 'registration' || selectedSkillId === 'createIncident';
    contextChatAtom(ctx, registration ? {intent:'createIncident', company_id:'demo-company'} : {company_id:'demo-company'});
    updateThreads(items => items.map(thread => thread.id === activeIdRef.current ? {...thread, scenario:id, initialSkill: registration ? 'createIncident' : undefined, updatedAt:Date.now()} : thread));
    setActionUrl(''); setScenario(id); setPlaying(!instant);
    const startedAt = Date.now(); const requestId = `question-${crypto.randomUUID()}`; const responseId = `answer-${requestId}`; const {events, backendSteps, answer} = fixture(id, responseId, startedAt);
    let run = createRun(responseId, requestId, startedAt); const updateRun = () => setRuns({[responseId]: run});
    const requestExtras = {...(extras || {}), ...(selectedSkillId ? {skill:selectedSkillId, skillTitle:assistantSkills.find(item => item.id === selectedSkillId)?.title || ''} : {})};
    addMessageAction(ctx, {id:requestId, role:ERoles.user, text:body || scenarios.find(item => item.id === id)!.question, timeCreated:new Date(startedAt).toISOString(), extras:Object.keys(requestExtras).length ? requestExtras : (id === 'rich' ? {fileIds:'["demo-input"]'} : {})});
    const base: IMessage = {id:responseId, requestId, role:ERoles.bot, timeCreated:new Date(startedAt + 1).toISOString()}; const resultExtras = id === 'rich' ? {fileIds:'["demo-report"]', chart} : undefined;
    if (!instant) addMessageAction(ctx, {...base, text:'', extras:{agentPending:'true'}});
    const finish = () => {
      const completedAt = Date.now();
      // The current backend sends service texts only after /ainvoke completes.
      // Put those exact texts into the activity trace in one update, not chat bubbles.
      backendSteps.forEach((serviceText, index) => {
        const [label, ...lines] = serviceText.split('\n');
        run = appendEvent(run, {id:`${responseId}-backend-${index}`, runId:responseId, at:completedAt + index, kind:'message', label, text:lines.join('\n') || undefined});
      });
      if (events.length || backendSteps.length) {
        run = appendEvent(run, {id:`${responseId}-finish`, runId:responseId, at:completedAt + backendSteps.length, kind:'finish'});
        updateRun();
      }
      isLoadingAtom(ctx, false);
      addMessageAction(ctx, {
        ...base, text:answer, extras:resultExtras as IMessage['extras'],
      });
      setPlaying(false);
      queueMicrotask(storeCurrent);
    };
    if (instant) { events.forEach(event => { run = appendEvent(run,event); }); finish(); }
    else if (!events.length) { later(finish, 2200); }
    else { events.forEach((event,index) => later(() => {run = appendEvent(run, {...event, at:Date.now()}); updateRun();}, (index + 1) * 700)); const chunks = answer.match(/.{1,36}(?:\s|$)|.{1,36}/gs) || [answer]; let text = ''; chunks.forEach((chunk,index) => later(() => {text += chunk; addMessageAction(ctx, {...base,text,extras:{agentPending:'true'}});}, events.length * 700 + (index + 1) * 65)); later(finish, events.length * 700 + (chunks.length + 1) * 65); }
    chat$.openChat();
  }
  useEffect(() => { const listener = (event: Event) => setActionUrl((event as CustomEvent<string>).detail); window.addEventListener('pilot:navigate',listener); later(() => {loadThread(threadsRef.current[0]); if (window.innerWidth >= 600) chat$.changeChatState(EChatState.fullScreen); chat$.openChat();}, 50); return () => {clearTimers(); window.removeEventListener('pilot:navigate',listener);}; }, []);
  useEffect(() => {setDemoSender(request => play(selectedSkillId === 'methodologist' ? 'subagent' : scenario, false, request.body, request.extras));}, [scenario, selectedSkillId]);
  const threadUi = {enabled:true, threads, activeThreadId, onSelect:selectThread, onNew:newThread, onRename:(id:string,title:string) => updateThreads(items => items.map(item => item.id === id ? {...item,title,updatedAt:Date.now()} : item)), onTogglePin:(id:string) => updateThreads(items => items.map(item => item.id === id ? {...item,pinned:!item.pinned,updatedAt:Date.now()} : item)), onDelete:deleteThread};
  const selectedSkill = demoFlags.assistantSkills ? assistantSkills.find(item => item.id === selectedSkillId) : undefined;
  return <reatomContext.Provider value={ctx}><ThreadUiContext.Provider value={threadUi}><AssistantSkillsContext.Provider value={{skills:demoFlags.assistantSkills ? assistantSkills : [], selectedSkill, onSelect:setSelectedSkillId}}><AgentRunsContext.Provider value={runs}>
    <style>{`.${modalClasses.wrapper}{top:64px;height:calc(100dvh - 64px)} @media(max-width:599px){.${modalClasses.wrapper}{top:112px;height:calc(100dvh - 112px);padding:0;width:100%}.${modalClasses.content},.${modalClasses.contentChatRight}{margin:8px;width:calc(100% - 16px);max-width:calc(100% - 16px);height:calc(100% - 16px)}.${chatClasses.chat}{min-width:0;width:100%;padding:20px 16px 16px}.${chatClasses.content}{margin-right:-16px;padding-right:16px}.${chatClasses.messages}{margin-right:-16px;padding-right:8px}.${chatClasses.titleLogo}{margin-right:0;width:32px;height:32px}.${chatClasses.titleText}{font-size:22px}.${chatClasses.title}{min-width:150px}.${chatClasses.header}>:last-child{gap:6px}.${chatClasses.header}>:last-child button:not(:first-child):not(:last-child),.${chatClasses.headerDivider}{display:none}}`}</style>
    <div className="demo-toolbar"><div className="demo-label"><strong>UI-пилот</strong><span>{scenario === 'backendCallback' ? 'Шаги из кода · пакет после ответа' : 'Демонстрационные данные'}</span></div><label className="scenario-picker"><span className="sr-only">Сценарий</span><select aria-label="Сценарий" value={scenario} onChange={event => play(event.target.value as ScenarioId)}>{scenarios.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><Button size="S" variant="secondary" onClick={() => play(scenario)}>Воспроизвести</Button><Button size="S" variant="secondary" onClick={() => play(scenario, true)}>Сразу результат</Button><label className="offline-toggle"><input type="checkbox" checked={!online} onChange={event => {const value = !event.target.checked; setOnline(value); setDemoOnline(value);}}/>Офлайн</label>{scenario === 'rich' && !playing && <label className="scenario-picker"><select aria-label="Вид графика" defaultValue="barChart" onChange={event => {const message = ctx.get(messagesAtom).find(item => item.role === ERoles.bot && item.extras?.chart); if (message) addMessageAction(ctx, {...message, extras:{...message.extras,chart:{...chart,metadata:{...chart.metadata,view:event.target.value}}} as IMessage['extras']});}}><option value="barChart">Столбчатый</option><option value="lineChart">Линейный</option><option value="pieChart">Круговой</option></select></label>}<span className="demo-state" role="status">{!online ? 'Отправка в очереди' : playing ? 'Агент работает' : 'Готово'}</span></div>
    <main className="product-backdrop"><aside><div className="norm-mark">Н</div></aside><section><p className="product-eyebrow">НОРМ / Компания</p><h1>Обзор компании</h1><p>Работа с рисками и событиями</p><div className="backdrop-cards"><div><small>Риски</small><strong>12</strong></div><div><small>Мероприятия</small><strong>8</strong></div><div><small>Источники</small><strong>4</strong></div></div><Button onClick={() => chat$.openChat()}>Открыть чат</Button></section></main><ModalContainer/>
    {actionUrl && <div className="demo-action" role="dialog" aria-modal="true" aria-label="Переход в НОРМ"><h2>Переход в форму НОРМ</h2><p>Продуктовый чат передал команду открытия формы. В демо она перехвачена локально.</p><code>{actionUrl}</code><Button onClick={() => {setActionUrl('');chat$.openChat();}}>Вернуться в чат</Button></div>}
  </AgentRunsContext.Provider></AssistantSkillsContext.Provider></ThreadUiContext.Provider></reatomContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<App/>);
