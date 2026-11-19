import { tr } from './i18n';
import { useRef, useState } from 'react';
import { Check, CircleAlert, Plus, Save, Trash2, UploadCloud } from 'lucide-react';
import { bytesOf, locate, tagsOf, uid, updateItem, validDate } from './data';
import { importEvidence } from './documents';
import { effectiveStatus } from './records';
import { Button, Field, FileMark, IconButton, Modal, RefPicker, useWorkspace } from './ui';

function updateExisting(records, item, original) {
  if (original && !records.some(record => record.id === original.id)) throw new Error(tr("This record is no longer available."));
  return updateItem(records, item);
}

function useSubmit(save) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try { await save(); } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return { busy, error, submit };
}

export function Editor({ title, description, save, children, submitLabel, wide = false, trash }) {
  const { close, t, edit } = useWorkspace();
  const { submit, busy, error } = useSubmit(save);
  return <Modal title={title} description={description} onClose={() => !busy && close()} wide={wide}><form onSubmit={submit}><div className="modal-body form-stack">{children}{error && <p className="notice danger" role="alert"><CircleAlert size={16}/>{error}</p>}</div><footer>{trash && <Button className="footer-start" icon={Trash2} variant="danger-outline" disabled={busy} onClick={() => edit('trash-record', trash)}>{t('Move to Trash')}</Button>}<Button onClick={close} disabled={busy}>{t('Cancel')}</Button><button type="submit" className="button primary" disabled={busy}><Save size={16}/>{busy ? tr("Saving…") : submitLabel || t('Save changes')}</button></footer></form></Modal>;
}

export function ProjectEditor({ item, onSave }) {
  const { t } = useWorkspace();
  const [name, setName] = useState(item?.name || '');
  const [summary, setSummary] = useState(item?.summary || '');
  return <Editor title={item ? t('Project settings') : t('New investigation')} submitLabel={item ? undefined : tr("Create investigation")} save={() => {
    if (!name.trim()) throw new Error(tr("Enter an investigation name."));
    return onSave(name.trim(), summary.trim());
  }}><Field label={tr("Investigation name")}><input value={name} onChange={e => setName(e.target.value)} required maxLength={100} autoFocus placeholder={tr("e.g. Harborline Procurement Review")}/></Field><Field label={tr("Investigation summary")}><textarea value={summary} onChange={e => setSummary(e.target.value)} rows={4} maxLength={5000} placeholder={tr("What question are you investigating?")}/></Field></Editor>;
}

export function DeleteProject({ item, onDelete }) {
  const { close } = useWorkspace();
  const { submit, busy, error } = useSubmit(onDelete);
  return <Modal title={tr("Delete investigation?")} onClose={() => !busy && close()}><form onSubmit={submit}><div className="modal-body"><p><strong>{item.name}</strong>{" " + tr("and its evidence and records will be removed from this browser. Export a backup first if you need a copy.") + ""}</p>{error && <p className="error-text" role="alert">{error}</p>}</div><footer><Button onClick={close} disabled={busy}>{tr("Cancel")}</Button><button className="button danger-solid" type="submit" disabled={busy}><Trash2 size={16}/>{busy ? tr("Deleting…") : tr("Delete investigation")}</button></footer></form></Modal>;
}

export function ImportEditor() {
  const { p, change, close, openDocument, notify, t } = useWorkspace();
  const input = useRef();
  const [files, setFiles] = useState([]);
  const [source, setSource] = useState('');
  const [problems, setProblems] = useState([]);
  const [progress, setProgress] = useState('');
  const [drag, setDrag] = useState(false);
  const { submit, busy, error } = useSubmit(async () => {
    const parsed = [];
    const rejected = [];
    const hashes = new Set(p.evidence.map(doc => doc.hash));
    const archived = new Set(p.trash.filter(row => row.kind === 'evidence').map(row => row.item.hash));
    for (const file of files) {
      setProgress(tr("Reading {v1}…", { v1: file.name }));
      try {
        const doc = await importEvidence(file, source);
        if (archived.has(doc.hash)) throw new Error(tr('This original is in Trash. Restore it to reconnect its citations.'));
        if (hashes.has(doc.hash)) throw new Error(tr("Identical original is already in this investigation."));
        hashes.add(doc.hash);
        parsed.push(doc);
      } catch (problem) { rejected.push({ name: file.name, message: problem.message }); }
    }
    if (parsed.length) {
      await change(current => {
        const existing = new Set([...current.evidence, ...current.trash.filter(row => row.kind === 'evidence').map(row => row.item)].map(doc => doc.hash));
        if (parsed.some(doc => existing.has(doc.hash))) throw new Error(tr("Another tab imported a duplicate. Reopen this dialog and retry."));
        return { ...current, evidence: [...parsed, ...current.evidence] };
      }, tr("Imported {v1} evidence {v2}.", { v1: parsed.length, v2: tr(parsed.length === 1 ? 'file' : 'files') }));
      notify(tr("Imported {v1} {v2}.", { v1: parsed.length, v2: tr(parsed.length === 1 ? 'file' : 'files') }));
    }
    if (!rejected.length && parsed.length) { close(); openDocument(parsed[0].id); }
    else { setProblems(rejected); setFiles([]); }
    setProgress('');
  });
  const add = selected => {
    setFiles(current => [...current, ...selected.filter(file => !current.some(other => file.name === other.name && file.size === other.size && file.lastModified === other.lastModified))]);
    setProblems([]);
  };
  return <Modal title={t('Import evidence')} description={tr("Add original files and index their text on this device.")} onClose={() => !busy && close()}><form onSubmit={submit}><div className="modal-body form-stack">
    <input type="file" multiple ref={input} accept=".pdf,.docx,.txt,.csv" className="visually-hidden" aria-label={tr("Choose evidence files")} onChange={e => { add([...e.target.files]); e.target.value = ''; }}/>
    <button type="button" className={`drop-zone ${drag ? 'drag' : ''}`} disabled={busy} onClick={() => input.current.click()} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); if (!busy) add([...e.dataTransfer.files]); }}><UploadCloud size={27}/><strong>{tr("Choose files or drop them here")}</strong><small>{tr("PDF, DOCX, TXT, CSV · 35 MB per file")}</small></button>
    {files.map((file, i) => <div className="chosen-file" key={`${file.name}-${i}`}><FileMark compact type={file.name.split('.').at(-1).toUpperCase()}/><div><strong>{file.name}</strong><small>{bytesOf(file.size)}</small></div><IconButton icon={Trash2} label={tr("Remove {v1}", { v1: file.name })} disabled={busy} onClick={() => setFiles(files.filter((_, n) => n !== i))}/></div>)}
    <Field label={tr("Source reference")} hint={tr("Optional for this batch. You can edit each source later.")}><input value={source} onChange={e => setSource(e.target.value)} disabled={busy} maxLength={500} placeholder={tr("URL, custodian, or records request reference")}/></Field>
    {progress && busy && <p className="notice">{progress}</p>}{error && <p className="notice danger" role="alert">{error}</p>}
    {problems.map(({ name, message }, i) => <p className="notice danger" key={i} role="alert"><CircleAlert size={16}/><span><strong>{name}</strong><br/>{message}</span></p>)}
    </div><footer><Button onClick={close} disabled={busy}>{problems.length ? tr("Done") : t('Cancel')}</Button><button type="submit" className="button primary" disabled={busy || !files.length}><UploadCloud size={16}/>{busy ? tr("Importing…") : tr("Import {v1} {v2}", { v1: files.length || '', v2: tr(files.length === 1 ? 'file' : 'files') })}</button></footer></form></Modal>;
}

export function FactEditor({ item, refs: initialRefs, kind = 'event', initialText = '' }) {
  const { p, change, close, notify, chooseEvent, t } = useWorkspace();
  const [title, setTitle] = useState(item?.title || '');
  const [body, setBody] = useState(item?.body || initialText);
  const [date, setDate] = useState(item?.date || '');
  const [end, setEnd] = useState(item?.end || '');
  const [status, setStatus] = useState(item ? effectiveStatus(p, item) : 'unverified');
  const [entities, setEntities] = useState(item?.entities || []);
  const [tags, setTags] = useState(item?.tags?.join(', ') || '');
  const [refs, setRefs] = useState(item?.refs || initialRefs || []);
  const [recordKind, setKind] = useState(item?.kind || kind);
  async function save() {
    if (!title.trim()) throw new Error(tr("Enter a title."));
    if ((date && !validDate(date)) || (end && (!validDate(end) || !date || end < date))) throw new Error(tr("Choose a valid end date on or after the start date."));
    const fact = { id: item?.id || uid(), kind: recordKind, title: title.trim(), body: body.trim(), date, end, status, entities, tags: tagsOf(tags), refs, origin: item?.origin || 'Manual' };
    await change(current => {
      if (status === 'verified' && (!refs.length || refs.some(ref => !locate(current, ref)))) throw new Error(tr("Attach available source passages before marking this record verified."));
      if (item && !current.facts.some(row => row.id === item.id)) throw new Error(tr("This record is no longer available."));
      return { ...current, facts: updateItem(current.facts, fact) };
    }, `${item ? 'Updated' : 'Added'} ${recordKind} · ${fact.title}`);
    close(); notify(item ? tr("Record updated.") : tr("Record added."));
    if (recordKind === 'event') chooseEvent(fact.id, Boolean(item));
  }
  return <Editor title={item ? (item.kind === 'event' ? t('Edit event') : t('Edit fact')) : recordKind === 'event' ? t('Add event') : t('Create fact')} save={save} submitLabel={item ? undefined : (recordKind === 'event' ? t('Create event') : t('Create fact'))} trash={item && { kind: 'fact', item }} wide>
    <Field label={tr("Title")}><input value={title} onChange={e => setTitle(e.target.value)} placeholder={tr("Describe what happened or what the source states")} maxLength={200} required autoFocus/></Field>
    <Field label={tr("Description")}><textarea value={body} onChange={e => setBody(e.target.value)} rows={3} maxLength={6000} /></Field>
    <div className="form-row"><Field label={tr("Record type")}><select value={recordKind} onChange={e => setKind(e.target.value)}><option value="event">{tr("Event")}</option><option value="fact">{tr("Fact")}</option></select></Field><Field label={tr("Verification")}><select value={status} onChange={e => setStatus(e.target.value)}><option value="unverified">{t('Unverified')}</option><option value="verified">{t('Verified')}</option><option value="disputed">{t('Disputed')}</option></select></Field></div>
    <div className="form-row"><Field label={tr("Date")}><input type="date" value={date} onChange={e => setDate(e.target.value)}/></Field><Field label={tr("End date (optional)")}><input type="date" value={end} min={date || undefined} onChange={e => setEnd(e.target.value)}/></Field></div>
    <Field label={tr("Tags")} hint={tr("Separate tags with commas.")}><input value={tags} onChange={e => setTags(e.target.value)} maxLength={320}/></Field>
    {!!p.entities.length && <fieldset className="check-group"><legend>{tr("Linked entities")}</legend>{p.entities.map(entity => <label key={entity.id}><input type="checkbox" checked={entities.includes(entity.id)} onChange={e => setEntities(e.target.checked ? [...entities, entity.id] : entities.filter(id => id !== entity.id))}/>{entity.name}</label>)}</fieldset>}
    <RefPicker refs={refs} onChange={setRefs}/>
  </Editor>;
}

export function EntityEditor({ item }) {
  const { change, close, notify, chooseGraph, t } = useWorkspace();
  const [name, setName] = useState(item?.name || '');
  const [type, setType] = useState(item?.type || 'Person');
  const [notes, setNotes] = useState(item?.notes || '');
  const [refs, setRefs] = useState(item?.refs || []);
  async function save() {
    if (!name.trim()) throw new Error(tr("Enter an entity name."));
    const entity = { id: item?.id || uid(), name: name.trim(), type, notes: notes.trim(), refs };
    await change(current => ({ ...current, entities: updateExisting(current.entities, entity, item) }), tr("{v1} entity · {v2}", { v1: tr(item ? 'Updated' : 'Added'), v2: entity.name }));
    close(); notify(tr("Entity saved.")); chooseGraph(entity.id);
  }
  return <Editor title={item ? tr("Edit entity") : t('Add entity')} save={save} trash={item && { kind: 'entity', item }} wide><div className="form-row"><Field label={tr("Name")}><input value={name} onChange={e => setName(e.target.value)} required autoFocus maxLength={130}/></Field><Field label={tr("Type")}><select value={type} onChange={e => setType(e.target.value)}>{['Person', 'Organization', 'Place', 'Other'].map(value => <option key={value} value={value}>{tr(value)}</option>)}</select></Field></div><Field label={tr("Profile notes")}><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} maxLength={6000}/></Field><RefPicker refs={refs} onChange={setRefs}/></Editor>;
}

export function RelationshipEditor({ item, start = '' }) {
  const { p, change, close, notify, chooseGraph, t } = useWorkspace();
  const [from, setFrom] = useState(item?.from || start);
  const [to, setTo] = useState(item?.to || '');
  const [label, setLabel] = useState(item?.label || '');
  const [notes, setNotes] = useState(item?.notes || '');
  const [refs, setRefs] = useState(item?.refs || []);
  async function save() {
    if (from === to || !label.trim()) throw new Error(tr("Choose two different entities and name the relationship."));
    const relationship = { id: item?.id || uid(), from, to, label: label.trim(), notes: notes.trim(), refs };
    await change(current => {
      if (!refs.some(ref => locate(current, ref))) throw new Error(tr("Attach a passage that explicitly supports this relationship."));
      if (![from, to].every(id => current.entities.some(entity => entity.id === id))) throw new Error(tr("Choose two active entities."));
      return { ...current, relationships: updateExisting(current.relationships, relationship, item) };
    }, tr("{v1} relationship · {v2}", { v1: tr(item ? 'Updated' : 'Added'), v2: relationship.label }));
    close(); notify(tr("Relationship saved.")); chooseGraph(relationship.id, 'edge');
  }
  return <Editor title={item ? tr("Edit relationship") : t('Add relationship')} description={tr("Attach a passage that directly supports this connection.")} save={save} trash={item && { kind: 'relationship', item }} wide><div className="form-row">{[[from, setFrom, 'From entity'], [to, setTo, 'To entity']].map(([value, set, caption]) => <Field label={tr(caption)} key={caption}><select value={value} onChange={e => set(e.target.value)} required><option value="">{tr("Choose entity")}</option>{p.entities.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></Field>)}</div><Field label={tr("Relationship label")}><input value={label} onChange={e => setLabel(e.target.value)} required maxLength={100} placeholder={tr("e.g. Signed purchase order for")}/></Field><Field label={tr("Notes")}><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} maxLength={6000}/></Field><RefPicker refs={refs} onChange={setRefs}/></Editor>;
}

export function IssueEditor({ item, refs: initialRefs, initialText = '' }) {
  const { change, notify, close, t } = useWorkspace();
  const [title, setTitle] = useState(item?.title || '');
  const [body, setBody] = useState(item?.body || initialText);
  const [kind, setKind] = useState(item?.kind || 'Contradiction');
  const [resolved, setResolved] = useState(item?.resolved || false);
  const [refs, setRefs] = useState(item?.refs || initialRefs || []);
  async function save() {
    if (!title.trim()) throw new Error(tr("Enter an issue title."));
    const issue = { id: item?.id || uid(), title: title.trim(), body: body.trim(), kind, resolved, refs };
    await change(current => ({ ...current, issues: updateExisting(current.issues, issue, item) }), tr("{v1} issue · {v2}", { v1: tr(item ? 'Updated' : 'Added'), v2: issue.title }));
    close(); notify(tr("Issue saved."));
  }
  return <Editor title={item ? tr("Edit issue") : t('Add issue')} save={save} trash={item && { kind: 'issue', item }} wide><Field label={tr("Title")}><input value={title} onChange={e => setTitle(e.target.value)} required autoFocus maxLength={200}/></Field><Field label={tr("Issue type")}><select value={kind} onChange={e => setKind(e.target.value)}><option value="Contradiction">{tr("Contradiction")}</option><option value="Evidence gap">{tr("Evidence gap")}</option><option value="Open question">{tr("Open question")}</option></select></Field><Field label={tr("Description and follow-up")}><textarea value={body} onChange={e => setBody(e.target.value)} rows={3} maxLength={6000}/></Field><label className="check"><input type="checkbox" checked={resolved} onChange={e => setResolved(e.target.checked)}/>{" " + tr("Mark resolved") + ""}</label><RefPicker refs={refs} onChange={setRefs}/></Editor>;
}

export function SuggestionEditor({ item }) {
  const { change, close, notify } = useWorkspace();
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [date, setDate] = useState(item.date);
  const [refs, setRefs] = useState(item.refs);
  async function save() {
    if (!title.trim() || (date && !validDate(date))) throw new Error(tr("Enter a title and a valid date."));
    await change(current => {
      const live = current.suggestions.find(row => row.id === item.id);
      if (live?.state !== 'pending') throw new Error(tr("This suggestion has already been reviewed."));
      return { ...current, suggestions: updateItem(current.suggestions, { ...live, title: title.trim(), body: body.trim(), date, refs }) };
    }, tr("Edited suggestion · {v1}", { v1: title.trim() }));
    close(); notify(tr("Suggestion updated."));
  }
  return <Editor title={tr("Edit suggestion")} description={tr("Check the wording and exact quotations before approving.")} save={save} wide><Field label={tr("Title")}><input value={title} onChange={e => setTitle(e.target.value)} required autoFocus maxLength={240}/></Field><Field label={tr("Text")}><textarea value={body} onChange={e => setBody(e.target.value)} rows={4} maxLength={6000}/></Field><Field label={tr("Date")}><input type="date" value={date} onChange={e => setDate(e.target.value)}/></Field><RefPicker refs={refs} onChange={setRefs}/></Editor>;
}

export function AnnotationEditor({ doc, ref, annotation }) {
  const { change, close, notify } = useWorkspace();
  const [note, setNote] = useState(annotation?.note || '');
  async function save() {
    await change(p => ({ ...p, evidence: p.evidence.map(item => item.id === doc.id ? { ...item, annotations: updateExisting(item.annotations, { id: annotation?.id || uid(), note: note.trim(), ref }, annotation) } : item) }), tr("Saved passage highlight · {v1}", { v1: doc.name }));
    close(); notify(tr("Highlight saved."));
  }
  return <Editor title={annotation ? tr("Edit highlight") : tr("Highlight passage")} save={save} submitLabel={tr("Save highlight")} trash={annotation && { kind: 'annotation', item: annotation, docId: doc.id }}><blockquote className="source-quote">{ref.quote}</blockquote><Field label={tr("Annotation note")}><textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={3000} autoFocus placeholder={tr("Why does this passage matter?")}/></Field></Editor>;
}
