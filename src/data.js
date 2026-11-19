import { sha256 } from '@noble/hashes/sha256';
import { tr, locale } from './i18n.js';

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const digest = bytes => Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
export const tagsOf = text => [...new Set(text.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))];
export const dateOf = date => date ? new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(date.length === 10 ? `${date}T00:00:00Z` : date)) : tr('Undated');
export const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
export const bytesOf = size => size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`;
export const fileName = name => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 90) || 'CaseWeave';

export function project(name, summary = '', id = uid()) {
  return { id, name, summary, updated: now(), evidence: [], facts: [], entities: [], relationships: [], suggestions: [], issues: [], activity: [], trash: [], drafts: [], runs: [] };
}

const upgrade = p => p ? { trash: [], drafts: [], runs: [], ...p } : p;
const storageError = error => new Error(tr(error?.name === 'QuotaExceededError' ? 'Browser storage is full. Export a backup before removing records.' : 'The browser could not access workspace storage. Check its data and privacy settings.'));

let database;
function db() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('caseweave-workspace-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => reject(new Error(tr("Close other CaseWeave tabs and reopen the app.")));
  });
  return database;
}

export async function loadProjects() {
  const store = (await db()).transaction('projects').objectStore('projects');
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result.map(upgrade));
    request.onerror = () => reject(storageError(request.error));
  });
}

export async function writeProject(id, change, activity) {
  const tx = (await db()).transaction('projects', 'readwrite');
  const store = tx.objectStore('projects');
  return new Promise((resolve, reject) => {
    let next;
    let failure;
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        next = change(upgrade(request.result));
        if (!next) { store.delete(id); return; }
        next = { ...next, updated: now(), activity: activity ? [{ id: uid(), at: now(), text: activity }, ...next.activity].slice(0, 100) : next.activity };
        store.put(next);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(next);
    tx.onabort = tx.onerror = () => reject(failure || storageError(tx.error));
  });
}

export function cite(doc, segment, start = 0, end = segment.text.length) {
  return { doc: doc.id, part: segment.id, start, end, quote: segment.text.slice(start, end) };
}

export function locate(p, ref) {
  const doc = p.evidence.find(item => item.id === ref?.doc);
  const part = doc?.parts.find(item => item.id === ref?.part);
  if (!part || !Number.isInteger(ref.start) || !Number.isInteger(ref.end) || ref.start < 0 || ref.end > part.text.length || ref.end <= ref.start || part.text.slice(ref.start, ref.end) !== ref.quote) return null;
  return { doc, part };
}

export function evidenceLabel(p, ref) {
  const source = locate(p, ref);
  return source ? `${source.doc.name} · ${locationLabel(source.part)}` : tr(p.trash?.some(entry => entry.kind === 'evidence' && entry.item.id === ref?.doc) ? 'Source in Trash' : 'Unavailable source');
}

export function locationLabel(part) {
  const match = part.label.match(/^(Page|Paragraph|Row) (\d+)(?:, passage (\d+))?(?: · OCR transcription)?$/);
  if (!match) return part.label;
  const [, kind, number, passage] = match;
  const label = tr(`${kind} {n}`, { n: number });
  return passage ? `${label}${tr(', passage {n}', { n: passage })}` : part.ocr ? `${label} · ${tr('OCR transcription')}` : label;
}

export const orderFacts = (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.title.localeCompare(b.title);
export const updateItem = (list, item) => list.some(value => value.id === item.id) ? list.map(value => value.id === item.id ? item : value) : [...list, item];

export function audit(p) {
  const events = p.facts.filter(fact => fact.kind === 'event');
  const dated = events.filter(event => validDate(event.date)).sort(orderFacts);
  const overlaps = new Map();
  for (let i = 0; i < dated.length; i++) {
    const event = dated[i];
    for (let j = i + 1; j < dated.length && dated[j].date <= (event.end || event.date); j++) {
      const other = dated[j];
      if (!overlaps.has(event.id)) overlaps.set(event.id, []);
      if (!overlaps.has(other.id)) overlaps.set(other.id, []);
      overlaps.get(event.id).push(other.title);
      overlaps.get(other.id).push(event.title);
    }
  }
  return {
    undated: events.filter(event => !event.date),
    unsupported: p.facts.filter(fact => !fact.refs.length || fact.refs.some(ref => !locate(p, ref))),
    open: p.issues.filter(issue => !issue.resolved),
    overlaps,
  };
}
