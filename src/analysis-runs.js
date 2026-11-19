import { locate, now, uid } from './data';
import { documentTitle } from './records';
import { tr } from './i18n';

export function makeRun(docs, options, priorRefs) {
  const cap = options.cap;
  const references = priorRefs && new Map(priorRefs.map(ref => [JSON.stringify([ref.doc, ref.part, ref.start, ref.end]), ref]));
  const queues = docs.map(doc => {
    const parts = new Map(doc.parts.map(part => [part.id, part]));
    const ranges = references ? [...references.values()].filter(ref => ref.doc === doc.id).map(ref => [parts.get(ref.part), ref.start, ref.end]) : doc.parts.map(part => [part, 0, part.text.length]);
    const fragments = [];
    for (const [part, first, last] of ranges) {
      if (!part) continue;
      for (let start = first; start < last; start += 1600) {
        const end = Math.min(last, start + 1800);
        if (part.text.slice(start, end).trim()) fragments.push({ doc: doc.id, part: part.id, start, end });
        if (end === last) break;
      }
    }
    return { doc, fragments, offset: 0 };
  });
  const batches = [];
  let batch;
  let segmentId = 0;
  let active = queues.filter(queue => queue.fragments.length);
  while (active.length) {
    for (const queue of active) {
      const part = queue.fragments[queue.offset++];
      const chars = part.end - part.start;
      if (!batch || batch.characters + chars > cap || batch.parts.length >= 120) {
        batch = { id: uid(), state: 'pending', characters: 0, parts: [] };
        batches.push(batch);
      }
      batch.parts.push({ ...part, id: `S${++segmentId}` });
      batch.characters += chars;
    }
    active = active.filter(queue => queue.offset < queue.fragments.length);
  }
  return {
    id: uid(), started: now(), mode: options.mode, question: options.question, destination: options.destination, model: options.model, language: options.language,
    sources: queues.map(({ doc, fragments }) => ({ doc: doc.id, name: documentTitle(doc), hash: doc.hash, hasText: Boolean(fragments.length) })), batches,
  };
}

export function materializeBatch(project, batch) {
  const documents = new Map(project.evidence.map(doc => [doc.id, doc]));
  const partsByDoc = new Map();
  return batch.parts.map(ref => {
    const doc = documents.get(ref.doc);
    if (doc && !partsByDoc.has(doc.id)) partsByDoc.set(doc.id, new Map(doc.parts.map(part => [part.id, part])));
    const part = partsByDoc.get(doc?.id)?.get(ref.part);
    if (!part || ref.start < 0 || ref.end <= ref.start || ref.end > part.text.length) throw new Error(tr('A planned source is unavailable. Restore the original or skip this batch.'));
    return { ...ref, doc, part, text: part.text.slice(ref.start, ref.end) };
  });
}

export const batchRunnable = batch => ['pending', 'failed'].includes(batch.state) || (batch.state === 'running' && Date.now() - Date.parse(batch.at) > 160_000);

export function setBatch(project, runId, batchId, update) {
  return { ...project, runs: project.runs.map(run => run.id === runId ? { ...run, batches: run.batches.map(batch => batch.id === batchId ? update(batch) : batch) } : run) };
}

export function combineSuggestions(project, rows, runId, batchId) {
  const originals = { ...project, evidence: [...project.evidence, ...project.trash.filter(entry => entry.kind === 'evidence').map(entry => entry.item)] };
  const normalize = text => text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const key = row => JSON.stringify([row.kind, normalize(row.title), normalize(row.body), row.date]);
  const suggestions = [...project.suggestions];
  const index = new Map(suggestions.flatMap((row, position) => row.runId === runId && row.state === 'pending' ? [[key(row), position]] : []));
  for (const item of rows) {
    const refs = item.refs.filter(ref => locate(originals, ref));
    const hash = key(item);
    const i = index.get(hash);
    if (i === undefined) {
      index.set(hash, suggestions.length);
      suggestions.push({ ...item, runId, refs, batchIds: [batchId] });
    } else {
      const old = suggestions[i];
      const citations = new Map([...old.refs, ...refs].map(ref => [JSON.stringify([ref.doc, ref.part, ref.start, ref.end]), ref]));
      suggestions[i] = { ...old, refs: [...citations.values()], batchIds: [...new Set([...(old.batchIds || []), batchId])] };
    }
  }
  return { ...project, suggestions };
}

export function runCoverage(run) {
  const coverage = new Map(run.sources.map(row => [row.doc, { ...row, done: 0, total: 0, failed: 0 }]));
  for (const batch of run.batches) for (const part of batch.parts) {
    const source = coverage.get(part.doc);
    if (!source) continue;
    source.total++;
    if (batch.state === 'done') source.done++;
    if (batch.state === 'failed') source.failed++;
  }
  return [...coverage.values()];
}
