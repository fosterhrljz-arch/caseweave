import { tr } from './i18n';
import { cloneElement, createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronRight, File, FileSpreadsheet, FileText, Link2, Search, X } from 'lucide-react';
import { cite, dateOf, evidenceLabel, locate, locationLabel } from './data';
import { documentTitle } from './records';
import { statuses } from './transfer';

export const Workspace = createContext(null);
export const useWorkspace = () => useContext(Workspace);

export function Button({ icon: Icon, children, variant = 'secondary', className = '', ...props }) {
  return <button type="button" className={`button ${variant} ${className}`} {...props}>{Icon && <Icon size={16} aria-hidden="true" />}{children}</button>;
}

export function IconButton({ icon: Icon, label, ...props }) {
  return <button type="button" className="icon-button" title={label} aria-label={label} {...props}><Icon size={17} aria-hidden="true" /></button>;
}

export function Badge({ children, tone = 'gray' }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function Status({ value }) {
  const { t } = useWorkspace();
  return <Badge tone={{ verified: 'green', disputed: 'amber', unverified: 'gray' }[value]}>{t(statuses[value] || value)}</Badge>;
}

export function FileMark({ type, compact = false }) {
  const Icon = type === 'CSV' ? FileSpreadsheet : type === 'PDF' ? File : FileText;
  return <span className={`file-mark ${type?.toLowerCase() || 'txt'} ${compact ? 'compact' : ''}`}><Icon size={compact ? 15 : 18} aria-hidden="true" /></span>;
}

export function PageHead({ title, description, actions, extra }) {
  return <header className="page-head"><div><div className="heading-line"><h1>{title}</h1>{extra}</div>{description && <p>{description}</p>}</div>{actions && <div className="head-actions">{actions}</div>}</header>;
}

export function CardHead({ title, detail, action }) {
  return <header className="card-head"><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</header>;
}

export function Empty({ icon: Icon = FileText, title, children, action }) {
  return <div className="empty"><span className="empty-icon"><Icon size={22} /></span><strong>{title}</strong>{children && <p>{children}</p>}{action}</div>;
}

export function SearchBox({ value, onChange, placeholder, ...props }) {
  return <label className="search-box"><Search size={16}/><input type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} {...props} /></label>;
}

export function Field({ label, hint, children }) {
  const id = useId();
  return <div className="field"><label htmlFor={id}>{label}</label>{cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined })}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}

export function Modal({ title, description, children, onClose, wide }) {
  const ref = useRef();
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return <dialog ref={ref} className={wide ? 'modal wide' : 'modal'} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><h2 id={titleId}>{title}</h2>{description && <p>{description}</p>}</div><IconButton icon={X} label={tr("Close dialog")} onClick={onClose} /></header>
    {children}
  </dialog>;
}

export function RefList({ refs, quote = false, empty }) {
  const { p, openCitation } = useWorkspace();
  return refs?.length ? <div className="ref-list">{refs.map((ref, index) => <button className="source-link" type="button" key={`${ref.doc}-${ref.part}-${ref.start}-${index}`} disabled={!locate(p, ref)} onClick={() => openCitation(ref)}><Link2 size={15}/><span>{evidenceLabel(p, ref)}{quote && locate(p, ref) && <small>“{ref.quote}”</small>}</span><ArrowUpRight size={14}/></button>)}</div> : empty && <p className="muted">{empty}</p>;
}

export function RefPicker({ refs, onChange }) {
  const { p } = useWorkspace();
  const [docId, setDoc] = useState('');
  const [partId, setPart] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const doc = p.evidence.find(item => item.id === docId);
  const part = doc?.parts.find(item => item.id === partId);
  const offset = part?.text.indexOf(excerpt) ?? -1;
  function add() {
    if (!part?.text || offset < 0) return;
    const ref = excerpt ? cite(doc, part, offset, offset + excerpt.length) : cite(doc, part);
    if (!refs.some(item => item.doc === ref.doc && item.part === ref.part && item.start === ref.start && item.end === ref.end)) onChange([...refs, ref]);
    setExcerpt('');
  }
  return <fieldset className="ref-picker"><legend>{tr("Source references")}</legend>
    {refs.map((ref, i) => <div className="attached-ref" key={i}><Link2 size={15}/><span>{evidenceLabel(p, ref)}<small>{ref.quote}</small></span><IconButton icon={X} label={tr("Remove citation {v1}", { v1: i + 1 })} onClick={() => onChange(refs.filter((_, n) => n !== i))}/></div>)}
    {p.evidence.length ? <><div className="form-row"><select aria-label={tr("Evidence document")} value={docId} onChange={e => { setDoc(e.target.value); setPart(''); setExcerpt(''); }}><option value="">{tr("Choose evidence")}</option>{p.evidence.map(d => <option key={d.id} value={d.id}>{documentTitle(d)}</option>)}</select><select aria-label={tr("Evidence passage")} value={partId} disabled={!doc} onChange={e => { setPart(e.target.value); setExcerpt(''); }}><option value="">{tr("Choose passage")}</option>{doc?.parts.filter(s => s.text.trim()).map(s => <option key={s.id} value={s.id}>{locationLabel(s)} · {s.text.slice(0, 54)}</option>)}</select><Button icon={Check} onClick={add} disabled={!part || offset < 0}>{tr("Attach")}</Button></div>
    {part && <><blockquote className="source-quote">{part.text}</blockquote><input placeholder={tr("Optional exact excerpt from this passage")} aria-label={tr("Exact citation excerpt")} value={excerpt} onChange={e => setExcerpt(e.target.value)}/>{offset < 0 && <small className="error-text">{tr("The excerpt must match the original text.")}</small>}</>}</> : <p className="muted">{tr("Import a document to attach a passage.")}</p>}
  </fieldset>;
}

export function EvidenceTable({ docs, onOpen }) {
  return <div className="table-scroll"><table><thead><tr><th>{tr("Document")}</th><th>{tr("Format")}</th><th>{tr("Source")}</th><th>{tr("Status")}</th><th aria-label={tr("Open")}/></tr></thead><tbody>{docs.map(doc => <tr key={doc.id}><td><button type="button" className="table-link" onClick={() => onOpen(doc.id)}><FileMark type={doc.type} compact/>{documentTitle(doc)}</button></td><td>{doc.type}</td><td className="source-cell">{doc.source}</td><td><Status value={doc.verified ? 'verified' : 'unverified'}/></td><td><IconButton icon={ChevronRight} label={tr("Open {v1}", { v1: documentTitle(doc) })} onClick={() => onOpen(doc.id)}/></td></tr>)}</tbody></table></div>;
}

export function DateText({ value }) { return dateOf(value); }
