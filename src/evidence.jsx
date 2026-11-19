import { tr } from './i18n';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Clipboard, Download, FileSearch, Highlighter, Link2, Pencil, Plus, ScanText, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { bytesOf, cite, dateOf, digest, locate, locationLabel, tagsOf } from './data';
import { documentTitle } from './records';
import { download, drawPage, ocrPage, readPdf } from './documents';
import { Badge, Button, CardHead, Empty, Field, FileMark, IconButton, PageHead, RefList, SearchBox, useWorkspace } from './ui';

function PdfPreview({ doc, page }) {
  const target = useRef();
  const [state, setState] = useState('Loading original page…');
  useEffect(() => {
    let active = true;
    let pdf;
    readPdf(doc.original).then(async loaded => {
      pdf = loaded;
      if (!active) { await pdf.destroy(); return; }
      const scratch = document.createElement('canvas');
      await drawPage(pdf, page, scratch, 1100);
      if (!active) return;
      const canvas = target.current;
      canvas.width = scratch.width;
      canvas.height = scratch.height;
      canvas.getContext('2d').drawImage(scratch, 0, 0);
      setState('');
    }).catch(() => { if (active) setState('This page could not be rendered. Use Download original to inspect the preserved PDF.'); });
    return () => { active = false; pdf?.destroy().catch(() => {}); };
  }, [doc.original, page]);
  return <div className="pdf-preview">{state && <p role="status">{tr(state)}</p>}<canvas ref={target} hidden={Boolean(state)} aria-label={tr("Original PDF page {v1}", { v1: page })}/></div>;
}

function markedText(text, ranges) {
  if (!ranges.length) return text;
  const boundaries = [...new Set([0, text.length, ...ranges.flatMap(ref => [ref.start, ref.end])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const selected = ranges.find(ref => ref.start <= start && ref.end >= end && ref.active);
    const annotation = ranges.some(ref => ref.start <= start && ref.end >= end);
    return annotation ? <mark className={selected ? 'active-mark' : ''} key={start}>{text.slice(start, end)}</mark> : text.slice(start, end);
  });
}

function passageSelection(doc, part, element) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const end = start + range.toString().length;
  return cite(doc, part, start, end);
}

function SourceInspector({ doc, focused, selectRef }) {
  const { p, change, edit, notify, chooseEvent, t } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(doc.title || '');
  const [source, setSource] = useState(doc.source);
  const [notes, setNotes] = useState(doc.notes);
  const [tags, setTags] = useState(doc.tags.join(', '));
  const [verified, setVerified] = useState(doc.verified);
  const [saving, setSaving] = useState(false);
  const [integrity, setIntegrity] = useState('');
  const linked = p.facts.filter(fact => fact.refs.some(ref => ref.doc === doc.id));
  let url;
  try { const candidate = new URL(doc.source); if (['https:', 'http:'].includes(candidate.protocol)) url = candidate.href; } catch { /* References may be archive labels. */ }
  async function save(event) {
    event.preventDefault(); setSaving(true);
    try {
      await change(current => ({ ...current, evidence: current.evidence.map(item => item.id === doc.id ? { ...item, title: title.trim(), source: source.trim() || 'Local file', notes: notes.trim(), tags: tagsOf(tags), verified } : item) }), tr("Reviewed evidence · {v1}", { v1: doc.name }));
      setEditing(false); notify(tr("Evidence details saved."));
    } catch (error) { notify(error.message, 'error'); }
    finally { setSaving(false); }
  }
  async function verify() {
    try { setIntegrity(digest(new Uint8Array(await doc.original.arrayBuffer())) === doc.hash ? tr("Original matches the recorded SHA-256.") : tr("Integrity check failed. The original differs.")); }
    catch { setIntegrity(tr("Could not read the stored original.")); }
  }
  return <aside className="card inspector"><CardHead title={t('Source inspector')} action={<div className="action-row"><IconButton icon={Pencil} label={tr("Edit evidence details")} onClick={() => setEditing(!editing)}/><IconButton icon={Trash2} label={tr("Trash evidence file")} onClick={() => edit('trash-record', { kind: 'evidence', item: doc })}/></div>}/><div className="inspector-body">
    {editing ? <form className="form-stack" onSubmit={save}><Field label={tr("Display title")}><input value={title} onChange={e => setTitle(e.target.value)} maxLength={130}/></Field><Field label={tr("Source reference")}><input value={source} onChange={e => setSource(e.target.value)} maxLength={500}/></Field><Field label={tr("Tags")}><input value={tags} onChange={e => setTags(e.target.value)} maxLength={320}/></Field><Field label={tr("Notes")}><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} maxLength={6000}/></Field><label className="check"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)}/>{" " + tr("Mark evidence reviewed") + ""}</label><button type="submit" disabled={saving} className="button primary">{t('Save changes')}</button></form> : <>
      <dl className="metadata">{doc.title && <div><dt>{tr("Original filename")}</dt><dd>{doc.name}</dd></div>}<div><dt>{tr("Format")}</dt><dd>{doc.type} · {bytesOf(doc.size)}</dd></div><div><dt>{tr("Source")}</dt><dd>{url ? <a href={url} target="_blank" rel="noreferrer">{doc.source}</a> : doc.source === 'Local file' ? tr(doc.source) : doc.source}</dd></div><div><dt>{tr("Imported")}</dt><dd>{dateOf(doc.imported)} <small>{doc.imported.slice(11, 19)}{" " + tr("UTC") + ""}</small></dd></div>{doc.modified && <div><dt>{tr("Original modified")}</dt><dd>{dateOf(doc.modified)} <small>{doc.modified.slice(11, 19)}{" " + tr("UTC") + ""}</small></dd></div>}<div><dt>{tr("SHA-256")}</dt><dd className="hash-box"><code>{doc.hash}</code><IconButton icon={Clipboard} label={tr("Copy integrity hash")} onClick={async () => { try { await navigator.clipboard.writeText(doc.hash); notify(tr("SHA-256 copied.")); } catch { notify(tr("Select the hash text to copy it."), 'error'); } }}/></dd></div></dl>
      <Button variant="quiet" icon={ShieldCheck} onClick={verify}>{tr("Check file integrity")}</Button>{integrity && <p className="muted" role="status">{integrity}</p>}
      {doc.tags.length > 0 && <div className="tag-row">{doc.tags.map(tag => <Badge key={tag} tone="violet">{tag}</Badge>)}</div>}
      {doc.notes && <p className="notes-text">{doc.notes}</p>}
    </>}
    {focused && <section className="inspector-section"><h3>{tr("Cited passage")}</h3><blockquote className="source-quote">“{focused.quote}”</blockquote><div className="source-location">{locate(p, focused) && locationLabel(locate(p, focused).part)}</div></section>}
    <section className="inspector-section"><h3>{"" + tr("Highlights") + " "}<span>{doc.annotations.length}</span></h3>{doc.annotations.length ? doc.annotations.map(annotation => <div className="mini-row" key={annotation.id}><button className="text-button" onClick={() => selectRef(annotation.ref)}><Highlighter size={15}/> {annotation.note || tr("Highlighted passage")}</button><IconButton icon={Pencil} label={tr("Edit highlight")} onClick={() => edit('annotation', { doc, ref: annotation.ref, annotation })}/></div>) : <p className="muted">{tr("Select text to save a highlight.")}</p>}</section>
    <section className="inspector-section"><h3>{"" + tr("Linked records") + " "}<span>{linked.length}</span></h3>{linked.length ? linked.map(fact => <button key={fact.id} className="simple-link" onClick={() => chooseEvent(fact.id)}><Link2 size={15}/>{fact.title}</button>) : <p className="muted">{tr("No linked facts or events.")}</p>}</section>
  </div></aside>;
}

export default function Evidence() {
  const { p, edit, activeDoc, sourceRef, openDocument, openCitation, navigate, t } = useWorkspace();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const search = useDeferredValue(query.toLowerCase().trim());
  const filtered = useMemo(() => p.evidence.filter(doc => (!type || doc.type === type) && (!search || [doc.name, documentTitle(doc), doc.source, doc.notes, ...doc.tags].some(value => value.toLowerCase().includes(search)) || doc.parts.some(part => part.text.toLowerCase().includes(search)))), [p.evidence, search, type]);
  const doc = p.evidence.find(item => item.id === activeDoc) || filtered[0];
  const activeRef = sourceRef?.doc === doc?.id ? sourceRef : null;
  const open = id => {
    const source = p.evidence.find(item => item.id === id);
    if (search) {
      const part = source?.parts.find(item => item.text.toLowerCase().includes(search));
      if (part) {
        const start = part.text.toLowerCase().indexOf(search);
        openCitation(cite(source, part, start, start + search.length)); return;
      }
    }
    openDocument(id);
  };
  return <><PageHead title={t('Evidence Library')} description={tr("Search original records, annotate passages, and attach them to findings.")} actions={<Button variant="primary" icon={Upload} onClick={() => edit('import')}>{t('Import evidence')}</Button>}/>
    {p.evidence.length ? <div className="evidence-layout"><section className="card evidence-list"><div className="library-filters"><SearchBox placeholder={t('Search evidence…')} value={query} onChange={setQuery}/><div className="library-filter-row"><small>{filtered.length} {filtered.length === 1 ? tr("document") : tr("documents")}</small><select aria-label={tr("Evidence format")} value={type} onChange={e => setType(e.target.value)}><option value="">{t('All types')}</option>{['PDF', 'DOCX', 'TXT', 'CSV'].map(value => <option key={value}>{value}</option>)}</select></div></div>
      {filtered.map(item => <button type="button" key={item.id} className={`document-row ${doc?.id === item.id ? 'selected' : ''}`} onClick={() => open(item.id)}><FileMark type={item.type} compact/><span><strong>{documentTitle(item)}</strong><small>{item.type} · {dateOf(item.imported)}</small></span></button>)}
      {!filtered.length && <p className="list-empty">{tr("No evidence matches this search.")}</p>}</section>
      {doc ? <><Viewer key={`${doc.id}:${activeRef?.part || ''}:${activeRef?.start ?? ''}`} doc={doc} focused={activeRef}/><SourceInspector key={doc.id} doc={doc} focused={activeRef} selectRef={openCitation}/></> : <section className="card"><Empty icon={FileSearch} title={tr("No matching evidence")}>{tr("Change the search or format filter.")}</Empty></section>}</div> : <section className="card"><Empty icon={FileSearch} title={tr("No evidence yet")} action={<Button variant="primary" icon={Upload} onClick={() => edit('import')}>{t('Import evidence')}</Button>}>{tr("Add PDF, DOCX, TXT, or CSV files to begin review.")}</Empty></section>}
    {activeRef && <Button variant="quiet" className="back-link" icon={ArrowLeft} onClick={() => navigate('evidence', { doc: doc.id })}>{tr("Clear citation selection")}</Button>}</>;
}

function Viewer({ doc, focused }) {
  const { p, edit, notify, change, lang, t } = useWorkspace();
  const isPdf = doc.type === 'PDF';
  const focusedPart = doc.parts.find(part => part.id === focused?.part);
  const [page, setPage] = useState(focusedPart?.page || 1);
  const [sheet, setSheet] = useState(Math.max(0, Math.floor(doc.parts.indexOf(focusedPart) / 75)));
  const [view, setView] = useState('text');
  const [selected, setSelected] = useState(null);
  const [reading, setReading] = useState(false);
  const focusElement = useRef();
  const pageParts = isPdf ? doc.parts.filter(part => part.page === page) : doc.parts.slice(sheet * 75, (sheet + 1) * 75);
  const lastPage = isPdf ? doc.parts.at(-1)?.page || 1 : Math.ceil(doc.parts.length / 75);
  const at = isPdf ? page : sheet + 1;
  useEffect(() => { focusElement.current?.scrollIntoView({ block: 'nearest' }); }, []);
  function turn(value) { setSelected(null); if (isPdf) setPage(value); else setSheet(value - 1); }
  async function ocr() {
    setReading(true);
    const targetPage = page;
    try {
      const text = await ocrPage(doc, targetPage, lang);
      if (!text) { notify(tr("OCR found no readable text on this page."), 'error'); return; }
      await change(current => ({ ...current, evidence: current.evidence.map(item => {
        if (item.id !== doc.id || item.parts.some(part => part.id === `ocr-${targetPage}`)) return item;
        const parts = [...item.parts, { id: `ocr-${targetPage}`, page: targetPage, label: `Page ${targetPage} · OCR transcription`, text, ocr: true }].sort((a, b) => a.page - b.page);
        return { ...item, parts };
      }) }), tr("Ran local OCR on page {v1} · {v2}", { v1: targetPage, v2: doc.name }));
      setView('text'); notify(tr("OCR transcription saved. Review it against the page image."));
    } catch (error) { notify(tr("OCR could not finish. {v1}", { v1: tr(error.message || 'Try another page.') }), 'error'); }
    finally { setReading(false); }
  }
  return <section className="card viewer"><div className="viewer-title"><FileMark type={doc.type}/><div><h2>{documentTitle(doc)}</h2><small>{doc.verified ? tr("Reviewed evidence") : tr("Pending evidence review")}</small></div><IconButton icon={Download} label={tr("Download original")} onClick={() => download(doc.name, doc.original)}/></div>
    <div className="viewer-tabs"><button type="button" className={view === 'text' ? 'active' : ''} onClick={() => setView('text')}>{t('Original text')}</button>{isPdf && <button type="button" className={view === 'pdf' ? 'active' : ''} onClick={() => { setSelected(null); setView('pdf'); }}>{t('Original page')}</button>}{lastPage > 1 && <div className="pagination"><IconButton icon={ChevronLeft} label={tr("Previous page")} disabled={at === 1} onClick={() => turn(at - 1)}/><span>{at} / {lastPage}</span><IconButton icon={ChevronRight} label={tr("Next page")} disabled={at === lastPage} onClick={() => turn(at + 1)}/></div>}</div>
    {isPdf && !pageParts.some(part => part.ocr) && <div className="ocr-toolbar"><Button variant="quiet" icon={ScanText} disabled={reading} onClick={ocr}>{reading ? tr("Reading page locally…") : tr("OCR page {v1}", { v1: page })}</Button><span>{lang === 'zh' ? tr("中文 + English") : tr("English")}</span></div>}
    {view === 'pdf' ? <PdfPreview key={page} doc={doc} page={page}/> : <><div className="document-paper" onMouseDown={() => setSelected(null)}>
      {pageParts.filter(part => part.text).map(part => {
        const annotations = doc.annotations.filter(annotation => annotation.ref.part === part.id && locate(p, annotation.ref)).map(annotation => annotation.ref);
        const current = focused?.part === part.id ? { ...focused, active: true } : null;
        return <article className="passage" key={part.id} ref={current ? focusElement : null}><div className="passage-label"><span>{locationLabel(part)}</span><IconButton icon={Plus} label={tr("Create fact from {v1}", { v1: locationLabel(part) })} onClick={() => edit('fact', { kind: 'fact', refs: [cite(doc, part)], initialText: part.text })}/></div><div tabIndex={0} className={`passage-text ${doc.type === 'CSV' ? 'mono' : ''}`} onMouseUp={event => setSelected(passageSelection(doc, part, event.currentTarget))} onKeyUp={event => setSelected(passageSelection(doc, part, event.currentTarget))}>{markedText(part.text, current ? [...annotations, current] : annotations)}</div></article>;
      })}
      {!pageParts.some(part => part.text) && <Empty icon={FileSearch} title={tr("No searchable text")}>{isPdf ? tr("View the original page or run local OCR to transcribe it.") : tr("Download the original to inspect its contents.")}</Empty>}
    </div>{selected && <div className="selection-toolbar"><span>{selected.quote.length}{" " + tr("characters selected") + ""}</span><Button variant="secondary" icon={Highlighter} onClick={() => edit('annotation', { doc, ref: selected })}>{tr("Highlight")}</Button><Button variant="primary" icon={Plus} onClick={() => edit('fact', { kind: 'fact', refs: [selected], initialText: selected.quote })}>{tr("Create fact")}</Button></div>}</>}
  </section>;
}
