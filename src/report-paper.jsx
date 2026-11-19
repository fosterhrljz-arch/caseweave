import { useWorkspace } from './ui';
import { tr } from './i18n';

export function ReportPaper({ report, print = false }) {
  const { openCitation } = useWorkspace();
  return <article className={print ? 'print-sheet' : 'report-paper'}><h2>{report.name}</h2>{report.fictional && <p className="report-demo">{tr('Fictional demonstration investigation')}</p>}{report.draft && <p className="report-demo">{tr('Investigation draft')}</p>}
    <section><h3>{tr("Investigation summary")}</h3><p className="notes-text">{report.summary || tr("No summary recorded.")}</p></section>
    {report.sections.map(section => <section key={section.title}><h3>{section.title}</h3>{section.rows.length ? section.rows.map((row, i) => <div className="report-row" key={i}>{row.title && <strong>{row.title}</strong>}{row.meta && <small>{row.meta}</small>}{row.body && <p className="notes-text">{row.body}</p>}{row.refs.length > 0 && <div className="report-refs">{row.refs.map(number => print ? <a key={number} href={`#print-source-${number}`}>[{number}]</a> : <button key={number} aria-label={tr("Open source {v1}", { v1: number })} onClick={() => openCitation(report.bibliography[number - 1].ref)}>[{number}]</button>)}</div>}</div>) : <p className="muted">{tr("No records.")}</p>}</section>)}
    <section><h3>{tr("Supporting evidence")}</h3>{report.bibliography.length ? report.bibliography.map(({ number, ref, doc, label }) => <div className="report-source" key={number} id={print ? `print-source-${number}` : undefined}><strong>{print ? `[${number}] ${label}` : <button type="button" className="text-button" onClick={() => openCitation(ref)}>[{number}] {label}</button>}</strong><blockquote className="source-quote">{ref.quote}</blockquote><small>{doc.source}{" " + tr("· Imported") + " "}{doc.imported}</small><code>{"" + tr("SHA-256") + " "}{doc.hash}</code></div>) : <p className="muted">{tr("No citations attached.")}</p>}</section>
  </article>;
}

