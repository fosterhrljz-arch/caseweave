import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Bot, CalendarDays, Check, CircleHelp, ClipboardList, FileCheck2, ListFilter, Pause, Pencil, Plus, Sparkles, X } from 'lucide-react';
import { audit, locate, now, uid, updateItem } from './data';
import { endpoint, modes, reportContext, runAnalysis } from './analysis';
import { batchRunnable, combineSuggestions, makeRun, materializeBatch, setBatch } from './analysis-runs';
import { RunConsent, RunHistory } from './run-view';
import { documentTitle, effectiveStatus } from './records';
import { tr } from './i18n';
import { Badge, Button, CardHead, Empty, Field, IconButton, Modal, PageHead, RefList, Status, useWorkspace } from './ui';
import { RecordDetail } from './timeline';

const minSources = item => ['agreement', 'contradiction'].includes(item.kind) ? 2 : 1;
const hasSupport = (p, item) => new Set(item.refs.filter(ref => locate(p, ref)).map(ref => ref.doc)).size >= minSources(item);

export default function Analysis() {
  const { p, t, route, navigate, edit, ai, notify, change, lang } = useWorkspace();
  const [mode, setMode] = useState(modes.includes(route.mode) ? route.mode : 'Extract facts');
  const [question, setQuestion] = useState('');
  const [selected, setSelected] = useState([]);
  const [pending, setPending] = useState(null);
  const [running, setRunning] = useState(null);
  const [batchSize, setBatchSize] = useState(20000);
  const [pausing, setPausing] = useState(false);
  const job = useRef(null);
  useEffect(() => () => { if (job.current) job.current.pause = true; }, []);
  useEffect(() => { if (modes.includes(route.mode)) setMode(route.mode); }, [route.mode]);
  const [error, setError] = useState('');
  const [queueFilter, setQueueFilter] = useState('pending');
  const [factPick, setFactPick] = useState(route.fact || '');
  const [reviewing, setReviewing] = useState('');
  const queue = p.suggestions.filter(item => queueFilter === 'all' || item.state === queueFilter);
  const pendingCount = p.suggestions.filter(item => item.state === 'pending').length;
  const tab = route.tab || 'queue';
  const report = useMemo(() => audit(p), [p]);
  const docs = p.evidence.filter(doc => selected.includes(doc.id));
  const fact = p.facts.find(item => item.id === (route.fact || factPick)) || p.facts.find(item => item.kind === 'fact') || p.facts[0];

  function prepare(existing, citedRows) {
    setError('');
    try {
      if (!ai) throw new Error(tr('Connect a provider in Settings before requesting AI analysis.'));
      const url = endpoint(ai);
      if (existing && !citedRows) {
        if (!existing.batches.some(batchRunnable)) throw new Error(tr('This run has no remaining batches.'));
        setPending({ run: existing, url, config: ai, snapshot: p, resume: true });
        return;
      }
      const modeToRun = citedRows ? 'Compare sources' : mode;
      const query = citedRows ? existing.question : question.trim();
      const scoped = citedRows ? citedRows.flatMap(row => row.refs).filter(ref => locate(p, ref)) :
        modeToRun === 'Draft report' ? p.facts.filter(record => effectiveStatus(p, record) === 'verified').flatMap(record => record.refs) : undefined;
      const selection = citedRows ? p.evidence.filter(doc => scoped.some(ref => ref.doc === doc.id)) : docs;
      if (modeToRun === 'Compare sources' && selection.filter(doc => doc.parts.some(part => part.text.trim())).length < 2) throw new Error(tr('Select at least two documents with text to compare.'));
      if (modeToRun === 'Ask a question' && !query) throw new Error(tr('Enter a question about the selected documents.'));
      const run = makeRun(selection, { mode: modeToRun, question: query, cap: batchSize, language: lang, destination: url, model: ai.model }, scoped);
      if (!run.batches.length) throw new Error(tr(modeToRun === 'Draft report' ? 'Select evidence cited by at least one verified case record before drafting a report.' : 'Select at least one document with searchable text.'));
      setPending({ run, url, config: ai, snapshot: p });
    } catch (problem) { setError(problem.message); }
  }

  async function send() {
    const request = pending;
    if (!request || job.current) return;
    const run = request.run;
    const control = { pause: false };
    job.current = control;
    setPending(null); setError(''); setPausing(false);
    let completed = 0;
    let suggested = 0;
    try {
      if (!request.resume) await change(current => ({ ...current, runs: [run, ...current.runs] }), tr('Started analysis · {task}', { task: tr(run.mode) }));
      for (const [index, batch] of run.batches.entries()) {
        if (control.pause) break;
        if (!batchRunnable(batch)) continue;
        setRunning({ index: index + 1, total: run.batches.length });
        const lease = uid();
        let claimed = false;
        const snapshot = await change(current => setBatch(current, run.id, batch.id, live => {
          if (!batchRunnable(live)) return live;
          claimed = true;
          return { ...live, state: 'running', at: now(), lease, destination: request.url, model: request.config.model, error: '' };
        }));
        if (!claimed) continue;
        const liveBatch = snapshot.runs.find(item => item.id === run.id).batches.find(item => item.id === batch.id);
        try {
          const segments = materializeBatch(snapshot, liveBatch);
          const caseRecords = run.mode === 'Draft report' ? reportContext(request.snapshot, segments) : [];
          const items = await runAnalysis(request.config, run.mode, run.question, segments, run.language || lang, caseRecords);
          await change(current => {
            const live = current.runs.find(item => item.id === run.id)?.batches.find(item => item.id === batch.id);
            if (live?.state !== 'running' || live.lease !== lease) return current;
            const next = combineSuggestions(current, items, run.id, batch.id);
            return setBatch(next, run.id, batch.id, old => ({ ...old, state: 'done', at: now(), resultCount: items.length }));
          });
          completed++;
          suggested += items.length;
        } catch (problem) {
          await change(current => setBatch(current, run.id, batch.id, old => old.state === 'running' && old.lease === lease ? { ...old, state: 'failed', at: now(), error: problem.message } : old));
          throw problem;
        }
      }
      setQueueFilter('pending');
      if (!control.pause && run.batches.length === 1 && suggested) notify(tr('{n} suggestions ready for review.', { n: suggested }));
      else notify(tr('{n} batches completed. Open Analysis runs for source coverage.', { n: completed }));
    } catch (problem) { setError(problem.message); notify(problem.message, 'error'); }
    finally { job.current = null; setRunning(null); setPausing(false); }
  }

  async function skip(run, batch) {
    try { await change(current => setBatch(current, run.id, batch.id, live => batchRunnable(live) ? { ...live, state: 'skipped', at: now(), error: '' } : live)); }
    catch (problem) { notify(problem.message, 'error'); }
  }

  async function review(item, accept) {
    setReviewing(item.id);
    try {
      await change(current => {
        const live = current.suggestions.find(entry => entry.id === item.id);
        if (live?.state !== 'pending') throw new Error(tr("This suggestion was already reviewed."));
        if (accept && !hasSupport(current, live)) throw new Error(tr("Attach the required exact source passages before approving."));
        const next = { ...current, suggestions: updateItem(current.suggestions, { ...live, state: accept ? 'accepted' : 'rejected' }) };
        if (!accept) return next;
        if (['contradiction', 'gap'].includes(live.kind)) next.issues = [{ id: uid(), title: live.title, body: live.body, kind: live.kind === 'gap' ? 'Evidence gap' : 'Contradiction', refs: live.refs, resolved: false, origin: live.origin }, ...current.issues];
        else if (live.kind === 'entity') {
          if (current.entities.some(entity => entity.name.toLowerCase() === live.title.toLowerCase())) throw new Error(tr("An entity with that name already exists. Open its profile to review or attach new evidence."));
          next.entities = [...current.entities, { id: uid(), name: live.title, type: live.entityType || 'Other', notes: live.body, refs: live.refs }];
        } else {
          const entities = current.entities.filter(entity => live.participants.some(name => name.trim().toLowerCase() === entity.name.toLowerCase())).map(entity => entity.id);
          next.facts = [...current.facts, { id: uid(), kind: live.kind === 'event' ? 'event' : 'fact', title: live.title, body: live.body, date: live.date, end: '', status: 'unverified', tags: [], entities, refs: live.refs, origin: live.origin }];
        }
        return next;
      }, tr("{v1} suggestion · {v2}", { v1: accept ? 'Approved' : 'Rejected', v2: item.title }));
      notify(accept ? tr("Approved and added to the workspace for verification.") : tr("Suggestion rejected."));
    } catch (problem) { notify(problem.message, 'error'); }
    finally { setReviewing(''); }
  }

  return <><PageHead title={t('AI Analysis')} description={tr("Compare accounts, review proposed facts, and track gaps in the evidence.")} actions={<Button icon={Plus} variant="primary" onClick={() => edit('issue')}>{t('Add issue')}</Button>}/>
    <div className="context-layout analysis-layout"><div className="analysis-main"><section className="card"><div className="section-tabs" role="group" aria-label={tr("Analysis sections")}>{[['queue', t('Verification queue'), pendingCount], ['issues', 'Issues', report.open.length], ['facts', 'Case records', p.facts.length], ['runs', 'Analysis runs', p.runs.length]].map(([id, label, count]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => navigate('analysis', { tab: id, mode })}>{t(label)}<span>{count}</span></button>)}</div>
    {tab === 'runs' && <RunHistory runs={p.runs} ai={ai} running={running} onResume={run => prepare(run)} onSkip={skip} onCompare={prepare} suggestions={p.suggestions}/>}
    {tab === 'queue' && <><div className="filter-bar"><ListFilter size={16}/><select value={queueFilter} aria-label={tr("Suggestion state")} onChange={e => setQueueFilter(e.target.value)}><option value="pending">{tr("Pending review")}</option><option value="accepted">{tr("Approved")}</option><option value="rejected">{tr("Rejected")}</option><option value="all">{tr("All suggestions")}</option></select></div><div className="queue-items">{queue.length ? queue.map(item => <article key={item.id} className="queue-item"><div className="tag-row"><Badge tone="violet">{tr(item.origin)}</Badge><Badge>{tr(item.kind)}</Badge><Badge tone={item.state === 'accepted' ? 'green' : item.state === 'rejected' ? 'gray' : 'amber'}>{item.state === 'accepted' ? tr("Approved") : item.state === 'rejected' ? tr("Rejected") : tr("Unverified")}</Badge>{!hasSupport(p, item) && <Badge tone="amber">{tr("Insufficient source support")}</Badge>}</div><h3>{item.title}</h3><p className="notes-text">{item.body}</p>{(item.date || item.participants.length > 0) && <p className="muted">{[item.date, ...item.participants].filter(Boolean).join(' · ')}</p>}<RefList refs={item.refs} quote empty={tr("No quotation matched a provided passage.")}/>{item.state === 'pending' && <div className="action-row"><Button icon={Pencil} onClick={() => edit('suggestion', { item })}>{tr("Edit suggestion")}</Button><Button icon={X} disabled={!!reviewing} onClick={() => review(item, false)}>{tr("Reject")}</Button>{item.kind === 'draft' ? <Button icon={Plus} variant="primary" disabled={!item.refs.length || item.refs.some(ref => !locate(p, ref))} onClick={() => edit('add-to-draft', { item })}>{t('Add to draft')}</Button> : <Button icon={Check} variant="primary" disabled={!!reviewing || !hasSupport(p, item)} onClick={() => review(item, true)}>{tr("Approve")}</Button>}</div>}{item.kind === 'draft' && item.state === 'accepted' && <div className="action-row"><Button icon={Plus} onClick={() => edit('add-to-draft', { item })}>{t('Add to draft')}</Button></div>}</article>) : <Empty icon={FileCheck2} title={tr("No suggestions in this view")}>{tr("Run an analysis or review another queue state.")}</Empty>}</div></>}
    {tab === 'issues' && <><div className="queue-items">{p.issues.length ? p.issues.map(issue => <article key={issue.id} className="queue-item"><div className="split-line"><div className="tag-row"><Badge tone={issue.kind === 'Contradiction' ? 'amber' : 'violet'}>{tr(issue.kind)}</Badge><Badge tone={issue.resolved ? 'green' : 'gray'}>{issue.resolved ? tr("Resolved") : tr("Open")}</Badge>{issue.origin && <Badge>{tr(issue.origin)}</Badge>}</div><IconButton icon={Pencil} label={tr("Edit issue")} onClick={() => edit('issue', { item: issue })}/></div><h3>{issue.title}</h3><p className="notes-text">{issue.body}</p><RefList refs={issue.refs} quote empty={tr("No source attached.")}/></article>) : <Empty icon={CircleHelp} title={tr("No issues logged")}>{tr("Record different accounts or missing information as you review the evidence.")}</Empty>}</div><div className="issue-flags"><h3>{tr("Record checks")}</h3>{report.undated.map(item => <button key={`date-${item.id}`} className="simple-link" onClick={() => edit('fact', { item })}><CalendarDays size={16}/>{" " + tr("Date needed ·") + " "}{item.title}</button>)}{report.unsupported.map(item => <button key={`cite-${item.id}`} className="simple-link" onClick={() => edit('fact', { item })}><AlertTriangle size={16}/>{" " + tr("Source needed ·") + " "}{item.title}</button>)}{!report.undated.length && !report.unsupported.length && <p className="muted">{tr("All events have dates and all case records have sources.")}</p>}</div></>}
    {tab === 'facts' && (fact ? <div className="case-records"><div className="record-list">{p.facts.map(item => <button key={item.id} className={`document-row ${fact.id === item.id ? 'selected' : ''}`} onClick={() => { setFactPick(item.id); if (route.fact) navigate('analysis', { tab: 'facts', mode }); }}><span><strong>{item.title}</strong><small>{t({ event: 'Event', fact: 'Fact' }[item.kind])} · <Status value={effectiveStatus(p, item)}/></small></span></button>)}</div><div className="record-pane"><div className="split-line"><strong>{tr("Record details")}</strong><IconButton icon={Pencil} label={tr("Edit record")} onClick={() => edit('fact', { item: fact })}/></div><RecordDetail record={{ ...fact, status: effectiveStatus(p, fact) }}/></div></div> : <Empty icon={ClipboardList} title={tr("No case records")}>{tr("Create a fact from evidence or add an event to the timeline.")}</Empty>)}</section></div>
    <aside className="card inspector ai-composer"><CardHead title={t('New analysis')} action={<Sparkles size={19} className="accent"/>}/><div className="inspector-body form-stack">
    {ai ? <div className="notice success"><span className="state-dot"/>{ai.model}{" " + tr("connected") + ""}</div> : <div className="notice"><Bot size={17}/>{tr("AI is disconnected.")}<button type="button" className="inline-link" onClick={() => navigate('settings')}>{t('Connection settings')} <ArrowRight size={13}/></button></div>}
    <Field label={tr("Analysis task")}><select value={mode} onChange={e => setMode(e.target.value)}>{modes.map(value => <option key={value} value={value}>{t(value)}</option>)}</select></Field>
    <Field label={mode === 'Ask a question' ? tr("Your question") : tr("Focus (optional)")}><textarea placeholder={mode === 'Ask a question' ? tr("What do the records say about installation?") : tr("Narrow the task to a date, entity, or claim.")} value={question} onChange={e => setQuestion(e.target.value)} rows={3} maxLength={1800}/></Field>
    <fieldset className="document-select"><legend>{tr("Documents to analyze")}</legend>{p.evidence.length > 0 ? <>{p.evidence.map(doc => <label key={doc.id}><input type="checkbox" checked={selected.includes(doc.id)} onChange={e => setSelected(e.target.checked ? [...selected, doc.id] : selected.filter(id => id !== doc.id))}/><span>{documentTitle(doc)}</span></label>)}<div className="action-row"><Button variant="quiet" onClick={() => setSelected(p.evidence.map(doc => doc.id))}>{tr("Select all")}</Button><Button variant="quiet" onClick={() => setSelected([])} disabled={!selected.length}>{tr("Clear")}</Button></div></> : <p className="muted">{tr("Import evidence to analyze it.")}</p>}</fieldset>
    <Field label={t('Batch size')} hint={t('Smaller batches suit models with shorter context windows.')}><select value={batchSize} disabled={!!running} onChange={event => setBatchSize(Number(event.target.value))}>{[6000, 12000, 20000, 45000].map(size => <option key={size} value={size}>{t('{n} characters', { n: size.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US') })}</option>)}</select></Field><Button icon={Sparkles} variant="primary" disabled={!!running || !ai || !selected.length} onClick={() => prepare()}>{running ? t('Analyzing batch {n} of {total}…', { n: running.index, total: running.total }) : t('Preview AI request')}</Button>{running && <Button icon={Pause} disabled={pausing} onClick={() => { if (job.current) job.current.pause = true; setPausing(true); }}>{t(pausing ? 'Pausing after this batch…' : 'Pause after current batch')}</Button>}{error && <p className="notice danger" role="alert">{error}</p>}
    </div></aside></div>
    {pending && <RunConsent p={pending.snapshot} pending={pending} onClose={() => setPending(null)} onSend={send} lang={lang}/>}</>;
}
