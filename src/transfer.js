import { audit, evidenceLabel, digest, fileName, locate, orderFacts, uid, validDate } from './data';
import { download, maxFileSize } from './documents';
import { effectiveStatus } from './records';
import { tr } from './i18n';

export const statuses = { verified: 'Verified', disputed: 'Disputed', unverified: 'Unverified' };
const maxBackupSize = 300 * 1024 * 1024;

export async function backupProject(p) {
  async function encode(doc) {
    const bytes = new Uint8Array(await doc.original.arrayBuffer());
    return { ...doc, original: bytes.toBase64 ? bytes.toBase64() : btoa(Array.from({ length: Math.ceil(bytes.length / 8192) }, (_, i) => String.fromCharCode(...bytes.subarray(i * 8192, (i + 1) * 8192))).join('')) };
  }
  const evidence = await Promise.all(p.evidence.map(encode));
  const trash = await Promise.all(p.trash.map(async entry => entry.kind === 'evidence' ? { ...entry, item: await encode(entry.item) } : entry));
  const data = new Blob([JSON.stringify({ format: 'CaseWeave', version: 2, project: { ...p, evidence, trash } })], { type: 'application/json' });
  if (data.size > maxBackupSize) throw new Error(tr('This project exceeds the 300 MB backup limit.'));
  download(`${fileName(p.name)}.caseweave.json`, data);
}

const isString = value => typeof value === 'string';
const isTime = value => isString(value) && Number.isFinite(Date.parse(value));
const strings = value => Array.isArray(value) && value.every(isString);
const records = (list, valid) => Array.isArray(list) && list.every(item => item && isString(item.id) && item.id && valid(item)) && new Set(list.map(item => item.id)).size === list.length;
const validPeriod = (start, end) => (start === '' || validDate(start)) && (end === '' || (validDate(end) && validDate(start) && end >= start));

export async function restoreProject(file) {
  if (file.size > maxBackupSize) throw new Error(tr("This backup exceeds the 300 MB restore limit."));
  let payload;
  try { payload = JSON.parse(await file.text()); } catch { throw new Error(tr("Choose a valid CaseWeave JSON backup.")); }
  const imported = payload?.project;
  if (payload?.format !== 'CaseWeave' || ![1, 2].includes(payload.version) || !imported || !isString(imported.name) || !imported.name.trim() || !isString(imported.summary) || !isTime(imported.updated)) throw new Error(tr("This file is not a supported CaseWeave backup."));
  const p = { trash: [], drafts: [], runs: [], ...imported };
  if (!records(p.trash, entry => ['evidence', 'fact', 'relationship', 'entity', 'issue', 'annotation', 'draft'].includes(entry.kind) && entry.item && isString(entry.item.id) && isTime(entry.at))) throw new Error(tr("Backup records or their passage references are invalid."));
  const archived = kind => p.trash.filter(entry => entry.kind === kind).map(entry => entry.item);
  const validDoc = d => isString(d.name) && (!d.title || isString(d.title)) && ['PDF', 'DOCX', 'TXT', 'CSV'].includes(d.type) && isString(d.original) && isString(d.hash) && isString(d.source) && isString(d.notes) && isTime(d.imported) && (d.modified === null || isTime(d.modified)) && strings(d.tags) && records(d.parts, part => isString(part.label) && isString(part.text) && (!part.page || (Number.isInteger(part.page) && part.page > 0))) && Array.isArray(d.annotations);
  if (!Array.isArray(p.evidence) || !records([...p.evidence, ...archived('evidence')], validDoc)) throw new Error(tr("Backup evidence records are invalid."));
  const mime = { PDF: 'application/pdf', DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', TXT: 'text/plain', CSV: 'text/csv' };
  function decode(doc) {
    if (doc.original.length > maxFileSize * 1.34) throw new Error(tr("An original file in the backup exceeds the import limit."));
    let bytes;
    try { bytes = Uint8Array.fromBase64 ? Uint8Array.fromBase64(doc.original) : Uint8Array.from(atob(doc.original), ch => ch.charCodeAt(0)); } catch { throw new Error(tr("An original file in the backup is invalid.")); }
    if (bytes.length !== doc.size || digest(bytes) !== doc.hash) throw new Error(tr("Integrity check failed for {v1}.", { v1: doc.name }));
    return { ...doc, original: new Blob([bytes], { type: mime[doc.type] }) };
  }
  const evidence = p.evidence.map(decode);
  const trash = p.trash.map(entry => entry.kind === 'evidence' ? { ...entry, item: decode(entry.item) } : entry);
  const project = { ...p, evidence, trash, id: uid() };
  const allEvidence = { ...project, evidence: [...evidence, ...trash.filter(entry => entry.kind === 'evidence').map(entry => entry.item)] };
  const refs = list => Array.isArray(list) && list.every(ref => locate(allEvidence, ref));
  const textRecord = item => isString(item.title) && isString(item.body) && refs(item.refs);
  const combined = (list, kind, validate) => Array.isArray(list) && records([...list, ...archived(kind)], validate);
  const entityExists = id => [...p.entities, ...archived('entity')].some(row => row.id === id);
  if (!allEvidence.evidence.every(doc => records(doc.annotations, entry => isString(entry.note) && entry.ref?.doc === doc.id && locate(allEvidence, entry.ref))) ||
    !p.trash.filter(row => row.kind === 'annotation').every(row => isString(row.item.note) && row.item.ref?.doc === row.docId && locate(allEvidence, row.item.ref)) ||
    !combined(p.entities, 'entity', e => isString(e.name) && isString(e.type) && isString(e.notes) && refs(e.refs)) ||
    !combined(p.facts, 'fact', f => textRecord(f) && ['event', 'fact'].includes(f.kind) && Object.hasOwn(statuses, f.status) && validPeriod(f.date, f.end) && strings(f.tags) && strings(f.entities) && f.entities.every(entityExists)) ||
    !combined(p.relationships, 'relationship', r => isString(r.label) && isString(r.notes) && r.from !== r.to && [r.from, r.to].every(entityExists) && refs(r.refs)) ||
    !combined(p.issues, 'issue', i => textRecord(i) && isString(i.kind) && typeof i.resolved === 'boolean') ||
    !combined(p.drafts, 'draft', d => isString(d.title) && isString(d.summary) && isTime(d.updated) && records(d.sections, s => textRecord(s) && typeof s.reviewed === 'boolean' && ['manual', 'ai'].includes(s.origin))) ||
    !records(p.suggestions, s => textRecord(s) && isString(s.kind) && isString(s.mode) && isString(s.origin) && (s.date === '' || validDate(s.date)) && strings(s.participants) && ['pending', 'accepted', 'rejected'].includes(s.state)) ||
    !records(p.runs, run => isTime(run.started) && isString(run.mode) && isString(run.question) && isString(run.destination) && isString(run.model) && Array.isArray(run.sources) && run.sources.every(row => isString(row.doc) && isString(row.name) && typeof row.hasText === 'boolean') && records(run.batches, batch => ['pending', 'running', 'done', 'failed', 'skipped'].includes(batch.state) && Array.isArray(batch.parts) && batch.parts.every(part => isString(part.id) && isString(part.doc) && isString(part.part) && Number.isInteger(part.start) && Number.isInteger(part.end)))) ||
    !records(p.activity, a => isString(a.text) && isTime(a.at))) throw new Error(tr("Backup records or their passage references are invalid."));
  return project;
}

function createBibliography(p) {
  const bibliography = [];
  const numbers = new Map();
  const register = refs => (refs || []).filter(ref => locate(p, ref)).map(ref => {
    const key = JSON.stringify([ref.doc, ref.part, ref.start, ref.end]);
    if (!numbers.has(key)) {
      const source = locate(p, ref);
      numbers.set(key, bibliography.length + 1);
      bibliography.push({ number: bibliography.length + 1, ref, label: evidenceLabel(p, ref), doc: source.doc });
    }
    return numbers.get(key);
  });
  return { bibliography, register };
}

export function reportOf(p) {
  const { bibliography, register } = createBibliography(p);
  const findings = p.facts.filter(f => effectiveStatus(p, f) === 'verified');
  const unverified = p.facts.filter(f => effectiveStatus(p, f) !== 'verified');
  const chronology = p.facts.filter(f => f.kind === 'event').toSorted(orderFacts);
  const factRow = f => ({ title: f.title, body: f.body, meta: [f.date ? [f.date, f.end].filter(Boolean).join(tr(' to ')) : (f.kind === 'event' ? tr('Undated') : ''), tr(statuses[effectiveStatus(p, f)])].filter(Boolean).join(' · '), refs: register(f.refs) });
  const issueRow = i => ({ title: i.title, body: i.body, meta: tr(i.kind), refs: register(i.refs) });
  const open = audit(p);
  const sections = [
    { title: 'Event chronology', rows: chronology.map(factRow) },
    { title: 'Key people and entities', rows: p.entities.map(e => ({ title: e.name, body: e.notes, meta: tr(e.type), refs: register(e.refs) })) },
    { title: 'Source-backed relationships', rows: p.relationships.filter(r => r.refs.some(ref => locate(p, ref)) && [r.from, r.to].every(id => p.entities.some(e => e.id === id))).map(r => ({ title: `${p.entities.find(e => e.id === r.from).name} · ${r.label} · ${p.entities.find(e => e.id === r.to).name}`, body: r.notes, refs: register(r.refs) })) },
    { title: 'Confirmed findings', rows: findings.map(factRow) },
    { title: 'Unverified and disputed records', rows: unverified.map(factRow) },
    { title: 'Unresolved questions', rows: [...open.open.map(issueRow), ...open.undated.map(e => ({ title: tr('Date needed · {title}', { title: e.title }), refs: register(e.refs) })), ...open.unsupported.map(e => ({ title: tr('Source needed · {title}', { title: e.title }), refs: [] }))] },
  ];
  return { name: p.name, summary: p.summary, fictional: p.fictional, sections: sections.map(section => ({ ...section, title: tr(section.title) })), bibliography };
}

export function draftReviewed(project, section) {
  return section.reviewed && section.refs.length > 0 && section.refs.every(ref => locate(project, ref));
}

export function reportFromDraft(project, draft) {
  const { register, bibliography } = createBibliography(project);
  return {
    name: draft.title,
    summary: draft.summary,
    fictional: project.fictional,
    draft: true,
    sections: draft.sections.map(section => ({ title: section.title, rows: [{
      body: section.body,
      meta: [tr(section.origin === 'ai' ? 'AI-assisted' : 'Manual'), tr(draftReviewed(project, section) ? 'Reviewed' : 'Needs review'), ...(section.refs.some(ref => !locate(project, ref)) ? [tr('Source unavailable')] : [])].join(' · '),
      refs: register(section.refs),
    }] })),
    bibliography,
  };
}

const safeMd = value => (value || '').replace(/[\\`*_{}\[\]()#+!|<>]/g, '\\$&').replace(/\r?\n/g, ' ');
export function exportMarkdown(report) {
  const lines = [`# ${safeMd(report.name)}`, '', ...(report.fictional ? [`**${tr('Fictional demonstration investigation')}**`, ''] : []), ...(report.draft ? [`**${tr('Investigation draft')}**`, ''] : []), `## ${tr('Investigation summary')}`, '', safeMd(report.summary || tr('No summary recorded.'))];
  for (const section of report.sections) {
    lines.push('', `## ${section.title}`, '');
    if (!section.rows.length) lines.push(tr('No records.'));
    for (const row of section.rows) {
      const refs = row.refs.map(number => ` [\[${number}\]](#source-${number})`).join('');
      if (report.draft) lines.push(`*${safeMd(row.meta)}*`, '', `${safeMd(row.body)}${refs}`, '');
      else lines.push(`- **${safeMd(row.title)}**${row.meta ? ` (${safeMd(row.meta)})` : ''}${row.body ? ` — ${safeMd(row.body)}` : ''}${refs}`);
    }
  }
  lines.push('', `## ${tr('Supporting evidence')}`, '');
  for (const { number, ref, label, doc } of report.bibliography) {
    lines.push(`<a id="source-${number}"></a>`, `**[${number}] ${safeMd(label)}**`, '', `> ${safeMd(ref.quote)}`, '', `${tr('Source')}: ${safeMd(doc.source)} · ${tr('Imported')} ${doc.imported}`, '', `SHA-256: \`${doc.hash}\``, '');
  }
  download(`${fileName(report.name)}.md`, new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }));
}
