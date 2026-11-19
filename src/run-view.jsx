import { useState } from 'react';
import { ArrowRight, FileCheck2, Layers3, Play, SkipForward } from 'lucide-react';
import { batchRunnable, materializeBatch, runCoverage } from './analysis-runs';
import { reportContext } from './analysis';
import { dateOf, locationLabel } from './data';
import { tr } from './i18n';
import { Badge, Button, CardHead, Empty, Field, Modal } from './ui';

export function RunConsent({ p, pending, onClose, onSend, lang }) {
  const batches = pending.run.batches.filter(batchRunnable);
  const [selected, setSelected] = useState(batches[0]?.id);
  const displayed = batches.find(batch => batch.id === selected) || batches[0];
  let segments = [];
  let failure = '';
  try { if (displayed) segments = materializeBatch(p, displayed); } catch (error) { failure = error.message; }
  const reports = pending.run.mode === 'Draft report' ? reportContext(p, segments) : [];
  return <Modal title={tr('Review evidence transmission')} description={tr('The destination may retain your input or charge for each request.')} onClose={onClose} wide><div className="modal-body form-stack">
    <p className="notice"><strong>{pending.url}</strong><span>{pending.config.model}</span></p>
    <p>{tr('This run will send {batches} batches with {segments} passage ranges. Each request includes filenames, locations, the task, and your question. You can pause after the current batch.', { batches: batches.length, segments: batches.reduce((sum, item) => sum + item.parts.length, 0) })}</p>
    {pending.run.mode === 'Draft report' && <p className="muted">{tr('Report batches also include excerpts of verified case records tied to the displayed passages.')}</p>}
    {pending.run.question && <blockquote className="source-quote">{pending.run.question}</blockquote>}
    {batches.length > 1 && <Field label={tr('Preview batch')}><select value={displayed?.id || ''} onChange={event => setSelected(event.target.value)}>{batches.map((batch, index) => <option key={batch.id} value={batch.id}>{tr('Batch {n} · {count} passages', { n: index + 1, count: batch.parts.length })}</option>)}</select></Field>}
    {failure && <p className="notice danger" role="alert">{failure}</p>}
    <details className="payload-preview"><summary>{tr('Inspect the exact evidence text')}</summary>{segments.map(segment => <section key={segment.id}><strong>{segment.doc.name} · {locationLabel(segment.part)}</strong><blockquote>{segment.text}</blockquote></section>)}</details>
    {reports.length > 0 && <details className="payload-preview"><summary>{tr('Inspect the verified case records')}</summary>{reports.map((record, index) => <section key={index}><strong>{record.title}{record.date && ` · ${record.date}`}</strong><blockquote>{record.body}</blockquote></section>)}</details>}
  </div><footer><Button onClick={onClose}>{tr('Cancel')}</Button><Button variant="primary" icon={ArrowRight} disabled={!batches.length} onClick={onSend}>{tr('Allow and send')}</Button></footer></Modal>;
}

export function RunHistory({ runs, ai, running, onResume, onSkip, onCompare, suggestions }) {
  const [selected, setSelected] = useState('');
  const run = runs.find(item => item.id === selected) || runs[0];
  if (!run) return <Empty icon={Layers3} title={tr('No analysis runs')}>{tr('Run an analysis to see batches and source coverage here.')}</Empty>;
  const coverage = runCoverage(run);
  const retry = run.batches.filter(batchRunnable);
  const done = run.batches.filter(batch => batch.state === 'done').length;
  const rows = suggestions.filter(row => row.runId === run.id && row.state !== 'rejected');
  return <div className="run-history"><CardHead title={tr('Source coverage')} detail={tr('A completed batch returned a readable result. Coverage counts passages sent, including overlapping ranges.')} action={<Badge tone={done === run.batches.length ? 'green' : 'violet'}>{tr('{done} / {total} batches complete', { done, total: run.batches.length })}</Badge>}/>
    <div className="filter-bar"><Field label={tr('Analysis run')}><select value={run.id} onChange={event => setSelected(event.target.value)}>{runs.map(item => <option key={item.id} value={item.id}>{tr(item.mode)} · {dateOf(item.started)} · {item.model}</option>)}</select></Field><Button icon={Play} disabled={!ai || running || !retry.length} onClick={() => onResume(run)}>{tr('Resume remaining batches')}</Button><Button icon={FileCheck2} disabled={!ai || running || !rows.some(row => row.refs.length)} onClick={() => onCompare(run, rows)}>{tr('Compare cited results')}</Button></div>
    <div className="table-scroll"><table><thead><tr><th>{tr('Source')}</th><th>{tr('Passages analyzed')}</th><th>{tr('Coverage')}</th></tr></thead><tbody>{coverage.map(row => <tr key={row.doc}><td>{row.purged ? tr('Source unavailable') : row.name}</td><td>{row.done} / {row.total}</td><td><Badge tone={row.done && row.done === row.total ? 'green' : row.failed ? 'amber' : 'gray'}>{tr(row.purged ? 'Removed permanently' : !row.hasText ? 'No eligible text' : row.done === row.total && row.total ? 'Complete' : row.done ? 'Partial' : row.failed ? 'Failed' : 'Pending')}</Badge></td></tr>)}</tbody></table></div>
    <details className="run-batches"><summary>{tr('Batch details')}</summary>{run.batches.map((batch, index) => <div className="mini-row" key={batch.id}><span><strong>{tr('Batch {n}', { n: index + 1 })}</strong> · {tr({ pending: 'Pending', running: 'Running', done: 'Complete', failed: 'Failed', skipped: 'Skipped' }[batch.state])}{batch.model && <small className="block muted">{batch.model} · {batch.destination}</small>}{batch.error && <small className="block error-text">{tr(batch.error, { code: batch.errorCode })}</small>}</span>{!running && batchRunnable(batch) && <Button icon={SkipForward} onClick={() => onSkip(run, batch)}>{tr('Skip batch')}</Button>}</div>)}</details>
  </div>;
}
