import { tr } from './i18n';
import { Drafts } from './drafts';
import { ReportPaper } from './report-paper';
import { effectiveStatus } from './records';
import { useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, CalendarDays, Check, ChevronRight, CloudOff, Database, Download, FileCheck2, FileText, FolderOpen, Globe, KeyRound, Network, Pencil, Plus, Printer, ShieldCheck, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { audit, bytesOf, dateOf, orderFacts } from './data';
import { endpoint, readRelay, relayOrigin, testProvider } from './analysis';
import { backupProject, exportMarkdown, reportOf, restoreProject } from './transfer';
import { Badge, Button, CardHead, Empty, EvidenceTable, Field, IconButton, PageHead, useWorkspace } from './ui';

function OverviewChart({ events }) {
  const ordered = events.filter(event => event.date).toSorted(orderFacts);
  const dates = [...new Set(ordered.map(event => event.date))];
  if (!dates.length) return <Empty icon={CalendarDays} title={tr("No dated events yet")}>{tr("Add a dated event to plot the chronology.")}</Empty>;
  const first = Date.parse(dates[0]);
  const span = Date.parse(dates.at(-1)) - first;
  const total = ordered.length;
  const top = 22;
  const baseline = 137;
  const points = dates.map(date => [span ? 55 + (Date.parse(date) - first) / span * 597 : 353, baseline - (baseline - top) * ordered.filter(event => event.date <= date).length / total]);
  const path = points.map(([x, y], index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
  const ticks = [...new Set([0, Math.ceil(total / 3), Math.ceil(total * 2 / 3), total])];
  const labelIndices = new Set([0, Math.round((dates.length - 1) / 2), dates.length - 1]);
  return <div className="overview-chart"><svg viewBox="0 0 700 177" role="img" aria-label={tr("Cumulative dated events from {v1} to {v2}. Total {v3}.", { v1: dates[0], v2: dates.at(-1), v3: total })}>
  {ticks.map(count => { const y = baseline - (baseline - top) * count / total; return <g key={count}><line x1="45" x2="662" y1={y} y2={y} stroke="#eeedf4"/><text x="32" y={y + 4} textAnchor="end" className="chart-tick">{count}</text></g>; })}
  <path d={`${path} L ${points.at(-1)[0]} ${baseline} L ${points[0][0]} ${baseline} Z`} fill="#eee8ff"/><path d={path} fill="none" stroke="#7554ed" strokeWidth="2.6" strokeLinejoin="round"/>
  {points.map(([x, y], index) => <g key={dates[index]}><circle cx={x} cy={y} r="4.4" fill="#7554ed" stroke="white" strokeWidth="1.3"><title>{dateOf(dates[index])} · {ordered.filter(event => event.date <= dates[index]).length}{" " + tr("events") + ""}</title></circle>{labelIndices.has(index) && <text x={x} y="160" textAnchor="middle" className="chart-tick">{dateOf(dates[index]).replace(/, \d{4}$/, '')}</text>}</g>)}
  </svg></div>;
}

export function Overview() {
  const { p, edit, navigate, openDocument, t } = useWorkspace();
  const events = p.facts.filter(fact => fact.kind === 'event');
  const verified = p.facts.filter(fact => effectiveStatus(p, fact) === 'verified').length;
  const review = audit(p);
  const contradictions = review.open.filter(issue => issue.kind === 'Contradiction').length;
  const queue = p.suggestions.filter(item => item.state === 'pending').length;
  const size = p.evidence.reduce((sum, document) => sum + document.size, 0);
  const percent = p.facts.length ? Math.round(verified / p.facts.length * 100) : 0;
  const stats = [
    [FileText, 'Evidence', p.evidence.length, t('{size} of originals', { size: bytesOf(size) }), 'violet', 'evidence'],
    [CalendarDays, 'Timeline events', events.length, t('{n} events dated', { n: events.filter(event => event.date).length }), 'mint', 'timeline'],
    [Network, 'Entities', p.entities.length, t('{n} source-backed links', { n: p.relationships.filter(edge => edge.refs.some(ref => p.evidence.some(doc => doc.id === ref.doc)) && [edge.from, edge.to].every(id => p.entities.some(entity => entity.id === id))).length }), 'blue', 'relationships'],
    [TriangleAlert, 'Open issues', review.open.length, t(contradictions === 1 ? '{n} contradiction' : '{n} contradictions', { n: contradictions }), 'amber', 'analysis'],
  ];
  return <><PageHead title={p.name} description={p.summary || tr("Organize evidence and document your investigation.")} extra={p.fictional && <Badge tone="violet">{t('Fictional case')}</Badge>} actions={<Button icon={Upload} variant="primary" onClick={() => edit('import')}>{t('Import evidence')}</Button>}/>
    <div className="metric-grid">{stats.map(([Icon, label, value, meta, tone, route]) => <button key={label} className="card metric" onClick={() => navigate(route, route === 'analysis' ? { tab: 'issues' } : {})}><span className={`metric-icon ${tone}`}><Icon size={21}/></span><span className="metric-body"><small>{t(label)}</small><strong>{value}</strong><span>{meta}</span></span><ChevronRight size={16} className="metric-arrow"/></button>)}</div>
    <div className="context-layout overview-grid"><div className="stacked-cards"><section className="card chronology-card"><CardHead title={t('Event chronology')} detail={tr("Cumulative count of dated events")} action={<Button icon={ArrowRight} variant="quiet" onClick={() => navigate('timeline')}>{t('View timeline')}</Button>}/><OverviewChart events={events}/></section>
    <section className="card recent-card"><CardHead title={t('Recent evidence')} detail={tr("{v1} {v2} in this investigation", { v1: p.evidence.length, v2: tr(p.evidence.length === 1 ? 'document' : 'documents') })} action={<Button icon={ArrowRight} variant="quiet" onClick={() => navigate('evidence')}>{t('View library')}</Button>}/>{p.evidence.length ? <EvidenceTable docs={p.evidence.slice(0, 5)} onOpen={openDocument}/> : <Empty icon={FileText} title={tr("No documents imported")}>{tr("Add source material to build the evidence record.")}</Empty>}</section></div>
    <div className="stacked-cards"><aside className="card review-card"><CardHead title={t('Review queue')}/><div className="review-rows"><button onClick={() => navigate('analysis', { tab: 'issues' })}><span className="mini-mark amber"><TriangleAlert size={17}/></span><span><strong>{tr("Contradictory accounts")}</strong><small>{contradictions} {contradictions === 1 ? tr("issue needs") : tr("issues need")}{" " + tr("review") + ""}</small></span><ChevronRight size={16}/></button><button onClick={() => navigate('analysis', { tab: 'queue' })}><span className="mini-mark violet"><FileCheck2 size={17}/></span><span><strong>{tr("Fact suggestions")}</strong><small>{queue}{" " + tr("pending approval") + ""}</small></span><ChevronRight size={16}/></button></div><div className="review-progress"><div className="split-line"><span>{tr("Records verified")}</span><strong>{percent}%</strong></div><div className="progress-track" role="progressbar" aria-label={tr("Records verified")} aria-valuenow={percent}><span style={{ width: `${percent}%` }}/></div><small>{t('{count} of {total} records marked verified', { count: verified, total: p.facts.length })}</small></div><div className="review-footer"><Button icon={ArrowRight} variant="quiet" onClick={() => navigate('analysis')}>{t('Open analysis')}</Button></div></aside>
    <aside className="card activity-card"><CardHead title={t('Recent activity')}/><div className="activity-list">{p.activity.length ? p.activity.slice(0, 4).map(item => <div key={item.id}><span className="activity-dot"/><p>{tr(item.text)}<small>{dateOf(item.at)}</small></p></div>) : <p className="muted">{tr("Activity appears as you review evidence and add records.")}</p>}</div></aside></div></div></>;
}

export function Projects() {
  const { projects, edit, openProject, createDemo, restore, notify, t } = useWorkspace();
  const input = useRef();
  const [busy, setBusy] = useState(false);
  async function upload(file) {
    if (!file) return;
    setBusy(true);
    try { await restore(await restoreProject(file)); } catch (error) { notify(error.message, 'error'); }
    finally { setBusy(false); }
  }
  return <><PageHead title={t('Investigations')} description={tr("Create a case or pick up where you left off.")} actions={<><Button icon={Upload} disabled={busy} onClick={() => input.current.click()}>{busy ? tr("Restoring…") : t('Restore backup')}</Button><Button icon={Plus} variant="primary" onClick={() => edit('project')}>{t('New investigation')}</Button><input ref={input} type="file" accept=".json" aria-label={tr("Select backup")} className="visually-hidden" onChange={e => { upload(e.target.files[0]); e.target.value = ''; }}/></>}/>
    <section className="card projects-card"><CardHead title={tr("Recent investigations")} detail={tr("{v1} {v2} on this device", { v1: projects.length, v2: tr(projects.length === 1 ? 'project' : 'projects') })}/>{projects.length ? projects.toSorted((a, b) => b.updated.localeCompare(a.updated)).map(item => <div className="project-row" key={item.id}><button type="button" className="project-open" onClick={() => openProject(item.id)}><span className="metric-icon violet"><FolderOpen size={21}/></span><span><strong>{item.name} {item.fictional && <Badge tone="violet">{t('Fictional case')}</Badge>}</strong><small>{item.summary || tr("No investigation summary.")}</small><small>{item.evidence.length}{" " + tr("documents ·") + " "}{item.facts.length}{" " + tr("case records · Updated") + " "}{dateOf(item.updated)}</small></span><ChevronRight size={18}/></button><IconButton icon={Pencil} label={tr("Rename {v1}", { v1: item.name })} onClick={() => edit('project', { item })}/><IconButton icon={Trash2} label={tr("Delete {v1}", { v1: item.name })} onClick={() => edit('delete', { item })}/></div>) : <Empty icon={FolderOpen} title={tr("Your investigation workspace is ready")}>{tr("Create a project or open the fictional case to explore the workflow.")}</Empty>}</section>
    {!projects.some(item => item.id === 'harborline-demo') && <section className="card demo-invitation"><div><h2>{tr("Try the Harborline investigation")}</h2><p>{tr("Trace a disputed installation date through a fictional procurement record.")}</p></div><Button icon={ArrowRight} onClick={createDemo}>{tr("Open fictional case")}</Button></section>}</>;
}

export function Settings() {
  const { p, ai, setAi, t, lang, setLang, edit, notify, navigate } = useWorkspace();
  const [provider, setProvider] = useState(ai?.provider === 'OpenAI-compatible' ? ai.provider : 'OpenAI');
  const [base, setBase] = useState(ai?.base || '');
  const [model, setModel] = useState(ai?.model || 'gpt-4o-mini');
  const [key, setKey] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [storage, setStorage] = useState('');
  async function connect(event) {
    event.preventDefault(); setMessage(''); setWorking(true);
    try {
      const config = { provider, base, model: model.trim(), key: key.trim() };
      endpoint(config);
      await testProvider(config);
      setAi(config); setKey(''); notify(tr("AI provider connected."));
    } catch (error) { setMessage(error.message); }
    finally { setWorking(false); }
  }
  async function connectRelay() {
    setMessage(''); setWorking(true);
    try { const config = await readRelay(); await testProvider(config); setAi(config); notify(t('Windows relay connected.')); }
    catch (error) { setMessage(error.message); }
    finally { setWorking(false); }
  }
  async function backup() { try { await backupProject(p); notify(tr("Backup downloaded.")); } catch (error) { notify(error.message, 'error'); } }
  async function persist() {
    try { setStorage(await navigator.storage?.persist?.() ? tr("The browser granted persistent storage.") : tr("The browser did not grant persistent storage. Keep a project backup to protect against storage eviction.")); }
    catch { setStorage(tr("Could not request persistent storage in this browser.")); }
  }
  return <><PageHead title={t('Settings')} description={tr("Manage your investigation, local data, and optional AI provider.")}/><div className="settings-grid"><section className="card"><CardHead title={t('AI provider')} detail={tr("Connect a Chat Completions-compatible model.")} action={<Badge tone={ai ? 'green' : 'gray'}>{ai ? tr("Connected") : tr("Disconnected")}</Badge>}/><form className="settings-body form-stack" onSubmit={connect}>
    {ai && <p className="notice success"><Check size={17}/>{ai.model} · {new URL(endpoint(ai)).host}<Button onClick={() => { setAi(null); setKey(''); setMessage(''); notify(tr("AI provider disconnected.")); }} disabled={working}>{tr("Disconnect")}</Button></p>}
    <section className="relay-settings form-stack"><strong>{t('Windows AI relay')}</strong><p className="muted">{t('The relay keeps provider credentials in Windows process memory and sends only requests you approve. It works when the browser is blocked by CORS.')}</p>{location.origin === relayOrigin ? <Button icon={ShieldCheck} onClick={connectRelay} disabled={working}>{t(working ? 'Testing connection…' : 'Test Windows relay')}</Button> : <p className="muted">{t('Open CaseWeave AI Relay.exe from the release folder, configure a provider, then choose Open workspace.')}</p>}</section>
    <Field label={t('Direct provider')}><select value={provider} onChange={e => { setProvider(e.target.value); setKey(''); }} disabled={working}><option value="OpenAI">{tr("OpenAI")}</option><option value="OpenAI-compatible">{tr("OpenAI-compatible")}</option></select></Field>
    <Field label={tr("API base URL")} hint={provider === 'OpenAI' ? undefined : tr("Enter the base path, including /v1 if required by your provider.")}><input type="url" value={provider === 'OpenAI' ? 'https://api.openai.com/v1' : base} onChange={e => { setBase(e.target.value); setKey(''); }} disabled={provider === 'OpenAI' || working} required placeholder={tr("https://provider.example/v1")}/></Field>
    <Field label={tr("Model")}><input value={model} onChange={e => setModel(e.target.value)} disabled={working} required maxLength={200} placeholder={tr("Provider model name")}/></Field>
    <Field label={tr("API key")} hint={t('For direct mode, use a temporary session token or a credential-free local endpoint. The Windows relay keeps provider keys out of the browser.')}><input type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" disabled={working} required={provider === 'OpenAI'} placeholder={tr("Paste a session key")}/></Field>
    <p className="muted">{tr("The connection test sends a fixed test prompt and any entered credential to the displayed provider. Evidence requests require separate approval.")}</p>
    {message && <p className="notice danger" role="alert">{message}</p>}<div className="action-row"><button type="submit" className="button primary" disabled={working}><KeyRound size={16}/>{working ? tr("Testing connection…") : tr("Test and connect")}</button></div>
    </form></section><div className="stacked-cards"><section className="card"><CardHead title={t('Project settings')} action={<IconButton icon={Pencil} label={tr("Edit investigation settings")} onClick={() => edit('project', { item: p })}/>}/><div className="settings-body"><h3>{p.name}</h3><p className="notes-text">{p.summary || tr("No summary recorded.")}</p><Button icon={Trash2} variant="danger-outline" onClick={() => edit('delete', { item: p })}>{tr("Delete investigation")}</Button></div></section>
    <section className="card"><CardHead title={t('Local storage')} action={<Database size={18} className="accent"/>}/><div className="settings-body form-stack"><p>{tr("Projects and original files stay in this browser profile. Backups include the originals and are readable by anyone who has the file.")}</p><div className="action-row"><Button icon={Download} onClick={backup}>{t('Export backup')}</Button><Button icon={Upload} onClick={() => navigate('projects')}>{t('Restore backup')}</Button><Button icon={Trash2} onClick={() => navigate('trash')}>{t('Trash')} ({p.trash.length})</Button></div><Button icon={ShieldCheck} variant="quiet" onClick={persist}>{tr("Request persistent storage")}</Button>{storage && <p className="muted" role="status">{storage}</p>}</div></section>
    <section className="card"><CardHead title={t('Data security')} action={<ShieldCheck size={18} className="accent"/>}/><div className="settings-body form-stack"><p>{t('Browser storage belongs to this browser profile and address. Anyone with access to the profile can read its data. Clearing browser data or switching launch modes can make projects unavailable.')}</p><p>{t('JSON backups are plaintext and include originals, Trash, and analysis results. Store backups on encrypted storage and control access to copies.')}</p><p>{t('SHA-256 checks whether bytes match the saved digest. It does not establish authenticity, provenance, or the truth of a statement. Verification labels reflect investigator review.')}</p></div></section>
    <section className="card"><CardHead title={t('Language')} action={<Globe size={18} className="accent"/>}/><div className="settings-body"><Field label={tr("Interface and analysis language")} hint={tr("Sets interface, report, AI, and OCR language. Evidence text and your own case content retain their original language.")}><select value={lang} onChange={e => setLang(e.target.value)}><option value="en">{tr("English")}</option><option value="zh">简体中文</option></select></Field></div></section></div></div></>;
}

export function Reports() {
  const { p, edit, navigate, route, lang, t } = useWorkspace();
  const report = useMemo(() => reportOf(p), [p, lang]);
  const drafting = route.tab === 'drafts';
  return <><PageHead title={t('Reports')} description={tr("Assemble findings and export the chronology with its source references.")} actions={drafting ? <Button icon={Plus} variant="primary" onClick={() => edit('draft')}>{t('New report draft')}</Button> : <><Button icon={Download} onClick={() => exportMarkdown(report)}>{t('Export Markdown')}</Button><Button icon={Printer} variant="primary" onClick={() => window.print()}>{t('Save as PDF')}</Button></>}/><div className="card section-tabs" role="group" aria-label={t('Report views')}><button className={!drafting ? 'active' : ''} onClick={() => navigate('reports')}>{t('Case report')}</button><button className={drafting ? 'active' : ''} onClick={() => navigate('reports', { tab: 'drafts' })}>{t('Report drafts')}<span>{p.drafts.length}</span></button></div>{drafting ? <Drafts/> : <><div className="context-layout main-gap"><div className="card"><ReportPaper report={report}/></div><aside className="card inspector"><CardHead title={tr("Report settings")}/><div className="inspector-body form-stack"><Button icon={Pencil} onClick={() => edit('project', { item: p })}>{tr("Edit summary")}</Button><Button icon={FileText} onClick={() => navigate('analysis', { mode: 'Draft report' })}>{tr("Draft with AI")}</Button><div className="notice"><ShieldCheck size={17}/>{tr("Record status and source references carry through to exports.")}</div><p className="muted">{tr("Choose Save as PDF in your browser’s print dialog. The report includes numbered quotations, source details, and integrity hashes.")}</p></div></aside></div><ReportPaper report={report} print/></>}</>;
}
