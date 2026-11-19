import { locate, now, uid } from './data.js';
import { tr } from './i18n.js';

export const collectionOf = { evidence: 'evidence', fact: 'facts', entity: 'entities', relationship: 'relationships', issue: 'issues', draft: 'drafts' };

export function effectiveStatus(project, record) {
  return record.status === 'verified' && (!record.refs.length || record.refs.some(ref => !locate(project, ref))) ? 'unverified' : record.status;
}

export function documentTitle(doc) { return doc.title || doc.name; }

export function recordTitle(kind, item) {
  return kind === 'evidence' ? documentTitle(item) : item.title || item.name || item.label || item.note || tr('Highlighted passage');
}

export function recordType(kind, item) {
  return tr({ evidence: 'Evidence file', fact: item.kind === 'event' ? 'Event' : 'Fact', entity: 'Entity', relationship: 'Relationship', issue: 'Issue', annotation: 'Annotation', draft: 'Report draft' }[kind]);
}

export function findRecord(project, kind, id, docent) {
  const records = kind === 'annotation' ? project.evidence.find(doc => doc.id === docent)?.annotations : project[collectionOf[kind]];
  return records?.find(item => item.id === id);
}

export function affectedRecords(project, kind, id) {
  if (kind === 'entity') return project.facts.filter(row => row.entities.includes(id)).length + project.relationships.filter(row => row.from === id || row.to === id).length;
  if (kind !== 'evidence') return 0;
  return [project.facts, project.entities, project.relationships, project.issues, project.suggestions, project.drafts.flatMap(draft => draft.sections)].flat().filter(row => row.refs.some(ref => ref.doc === id)).length;
}

export function moveToTrash(project, kind, id, docId) {
  const item = findRecord(project, kind, id, docId);
  if (!item) throw new Error(tr('This record is no longer available.'));
  const entry = { id: uid(), kind, item, at: now(), ...(docId ? { docId } : {}) };
  if (kind === 'annotation') return { ...project, trash: [entry, ...project.trash], evidence: project.evidence.map(doc => doc.id === docId ? { ...doc, annotations: doc.annotations.filter(row => row.id !== id) } : doc) };
  const collection = collectionOf[kind];
  return { ...project, trash: [entry, ...project.trash], [collection]: project[collection].filter(row => row.id !== id) };
}

export function restoreFromTrash(project, entryId) {
  const entry = project.trash.find(row => row.id === entryId);
  if (!entry) throw new Error(tr('This record is no longer available.'));
  const trash = project.trash.filter(row => row.id !== entryId);
  const { kind, item, docId } = entry;
  if (kind === 'annotation') {
    if (!project.evidence.some(doc => doc.id === docId)) throw new Error(tr('Restore the original evidence file before restoring this annotation.'));
    return { ...project, trash, evidence: project.evidence.map(doc => doc.id === docId ? { ...doc, annotations: [...doc.annotations, item] } : doc) };
  }
  if (kind === 'evidence' && project.evidence.some(doc => doc.hash === item.hash)) throw new Error(tr('An identical original is already active. Move that copy to Trash first.'));
  const collection = collectionOf[kind];
  return { ...project, trash, [collection]: [...project[collection], item] };
}

export function permanentlyDelete(project, entryId) {
  const entry = project.trash.find(row => row.id === entryId);
  if (!entry) throw new Error(tr('This record is no longer available.'));
  let trash = project.trash.filter(row => row.id !== entryId);
  const { kind, item: { id } } = entry;
  if (kind === 'entity') {
    const clean = row => ({ ...row, entities: row.entities.filter(value => value !== id) });
    const independent = row => row.from !== id && row.to !== id;
    trash = trash.filter(row => row.kind !== 'relationship' || independent(row.item)).map(row => row.kind === 'fact' ? { ...row, item: clean(row.item) } : row);
    return { ...project, trash, facts: project.facts.map(clean), relationships: project.relationships.filter(independent) };
  }
  if (kind !== 'evidence') return { ...project, trash };
  const clean = record => {
    const refs = record.refs.filter(ref => ref.doc !== id);
    if (refs.length === record.refs.length) return record;
    return { ...record, refs, ...(record.status === 'verified' ? { status: 'unverified' } : {}), ...('reviewed' in record ? { reviewed: false } : {}) };
  };
  const cleanDraft = draft => ({ ...draft, sections: draft.sections.map(clean) });
  trash = trash.filter(row => row.docId !== id).map(row => row.kind === 'draft' ? { ...row, item: cleanDraft(row.item) } : row.item.refs ? { ...row, item: clean(row.item) } : row);
  const runs = project.runs.map(run => ({ ...run, sources: run.sources.map(source => source.doc === id ? { doc: source.doc, name: '', hasText: source.hasText, purged: true } : source), batches: run.batches.map(batch => {
    const parts = batch.parts.filter(part => part.doc !== id);
    if (parts.length === batch.parts.length) return batch;
    return { ...batch, parts, characters: parts.reduce((sum, part) => sum + part.end - part.start, 0), state: batch.state === 'done' ? 'done' : 'skipped', lease: '', error: '' };
  }) }));
  return { ...project, trash, runs, drafts: project.drafts.map(cleanDraft), facts: project.facts.map(clean), entities: project.entities.map(clean), issues: project.issues.map(clean), relationships: project.relationships.map(clean), suggestions: project.suggestions.map(clean) };
}
