import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowLeft, BookOpen, CalendarDays, ChevronDown, ChevronRight, CircleAlert, Database, FileText, FolderOpen, LayoutDashboard, LockKeyhole, Menu, Network, Settings2, Sparkles, X } from 'lucide-react';
import { cite, loadProjects, locate, project, writeProject } from './data';
import { demoProject } from './demo';
import { Badge, Button, Empty, IconButton, Workspace } from './ui';
import { AnnotationEditor, DeleteProject, EntityEditor, FactEditor, ImportEditor, IssueEditor, ProjectEditor, RelationshipEditor, SuggestionEditor } from './editors';
import { Overview, Projects, Reports, Settings } from './pages';
import Evidence from './evidence';
import Timeline from './timeline';
import Relationships from './relationships';
import Analysis from './analysis-view';
import { AddSuggestionToDraft, DraftEditor, DraftSectionEditor, RemoveDraftSection } from './drafts';
import { TrashDialog, TrashPage } from './trash';
import { tr, setLocale } from './i18n';
import './style.css';

const navigation = [
  ['overview', 'Overview', LayoutDashboard], ['evidence', 'Evidence Library', BookOpen], ['timeline', 'Event Timeline', CalendarDays], ['relationships', 'Relationships', Network], ['analysis', 'AI Analysis', Sparkles], ['reports', 'Reports', FileText],
];
const views = { overview: Overview, evidence: Evidence, timeline: Timeline, relationships: Relationships, analysis: Analysis, reports: Reports, settings: Settings, projects: Projects, trash: TrashPage };
const storage = {
  get(key) { try { return localStorage.getItem(`caseweave-${key}`); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(`caseweave-${key}`, value); } catch { /* IndexedDB remains authoritative. */ } },
};

function readRoute() {
  const [page, values] = location.hash.slice(1).split('?', 2);
  const params = Object.fromEntries(new URLSearchParams(values));
  return { ...params, page: Object.hasOwn(views, page) ? page : 'overview' };
}

function Brand({ onClick }) {
  return <button type="button" className="brand" onClick={onClick} aria-label={tr("CaseWeave investigations")}><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span><span>{tr("CaseWeave")}</span></button>;
}

function App() {
  const [projects, setProjects] = useState([]);
  const [route, setRoute] = useState(readRoute);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [lang, setLanguage] = useState(() => storage.get('language') === 'zh' ? 'zh' : 'en');
  const [ai, setAi] = useState(null);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [graphSelection, setGraphSelection] = useState(null);
  const [eventSelection, setEventSelection] = useState('');
  setLocale(lang);
  const t = useCallback((key, values) => tr(key, values), [lang]);
  const p = projects.find(item => item.id === route.project) || projects.find(item => item.id === storage.get('active')) || projects[0];
  const view = p ? route.page : 'projects';
  const Screen = views[view];
  const notify = (message, tone = 'success') => setToast({ message, tone, nonce: performance.now() });

  function navigate(page, params = {}, id = p?.id) {
    const next = { ...(id ? { project: id } : {}), ...params };
    const search = new URLSearchParams(next).toString();
    const hash = `#${page}${search ? `?${search}` : ''}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
    if (id) storage.set('active', id);
    setRoute({ ...next, page });
    if (page !== route.page || id !== route.project) window.scrollTo(0, 0);
    setNavOpen(false);
  }

  useEffect(() => {
    let cancelled = false;
    loadProjects().then(async loaded => {
      if (!loaded.length && !storage.get('initialized')) {
        const demo = demoProject();
        const saved = await writeProject(demo.id, current => current || demo);
        loaded = [saved];
      }
      if (cancelled) return;
      storage.set('initialized', '1');
      setProjects(loaded); setLoading(false);
    }).catch(error => { if (!cancelled) { setLoadError(error.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const sync = () => { setRoute(readRoute()); setModal(null); };
    addEventListener('popstate', sync);
    addEventListener('hashchange', sync);
    return () => { removeEventListener('popstate', sync); removeEventListener('hashchange', sync); };
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.tone === 'error' ? 8500 : 3800); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = tr('CaseWeave · Investigation Workspace');
  }, [lang]);
  useEffect(() => {
    if (!globalThis.BroadcastChannel) return;
    const channel = new BroadcastChannel('caseweave-changes-v1');
    channel.onmessage = () => loadProjects().then(setProjects).catch(() => {});
    return () => channel.close();
  }, []);

  async function commit(id, updater, activity) {
    const next = await writeProject(id, updater, activity);
    setProjects(items => next ? items.some(item => item.id === id) ? items.map(item => item.id === id ? next : item) : [...items, next] : items.filter(item => item.id !== id));
    if (globalThis.BroadcastChannel) {
      const channel = new BroadcastChannel('caseweave-changes-v1');
      channel.postMessage(id); channel.close();
    }
    return next;
  }
  function change(updater, activity) {
    return commit(p.id, current => {
      if (!current) throw new Error(tr("This investigation is no longer available."));
      return updater(current);
    }, activity);
  }

  function openProject(id) { setEventSelection(''); setGraphSelection(null); navigate('overview', {}, id); }
  function openDocument(id) { navigate('evidence', { doc: id }); }
  function chooseEvent(id, stay = false) {
    if (p.facts.find(item => item.id === id)?.kind === 'fact') { navigate('analysis', { tab: 'facts', fact: id }); return; }
    setEventSelection(id); if (!stay) navigate('timeline', { event: id });
  }
  function chooseGraph(id, kind = 'node', stay = false) { setGraphSelection({ id, kind }); if (!stay) navigate('relationships', { node: id, graphKind: kind }); }
  function openCitation(ref) {
    if (!locate(p, ref)) { notify(tr("This citation could not be resolved."), 'error'); return; }
    setModal(null); navigate('evidence', { doc: ref.doc, part: ref.part, start: ref.start, end: ref.end });
  }
  const sourceDoc = p?.evidence.find(item => item.id === route.doc);
  const sourcePart = sourceDoc?.parts.find(part => part.id === route.part);
  const sourceStart = Number(route.start);
  const sourceEnd = Number(route.end);
  const sourceRef = sourcePart && Number.isInteger(sourceStart) && Number.isInteger(sourceEnd) && sourceStart >= 0 && sourceEnd > sourceStart && sourceEnd <= sourcePart.text.length ? cite(sourceDoc, sourcePart, sourceStart, sourceEnd) : null;

  const edit = (name, props = {}) => setModal({ name, ...props });
  const close = () => setModal(null);
  async function saveProject(name, summary) {
    if (modal.item) await commit(modal.item.id, current => { if (!current) throw new Error(tr("This investigation was removed.")); return { ...current, name, summary }; }, tr("Updated investigation details."));
    else { const item = project(name, summary); await commit(item.id, () => item, tr("Created investigation.")); openProject(item.id); }
    close(); notify(tr("Investigation saved."));
  }
  async function deleteProject() {
    await commit(modal.item.id, () => null);
    if (p?.id === modal.item.id) navigate('projects', { project: '' }, '');
    close(); notify(tr("Investigation deleted."));
  }
  async function createDemo() {
    const demo = demoProject();
    try { await commit(demo.id, current => current || demo); openProject(demo.id); } catch (error) { notify(error.message, 'error'); }
  }
  async function restore(item) {
    await commit(item.id, () => ({ ...item, name: tr('{title} (restored)', { title: item.name }) }), tr("Restored from project backup.")); openProject(item.id); notify(tr("Project restored."));
  }
  const context = { p, projects, route, navigate, t, lang, setLang: value => { storage.set('language', value); setLanguage(value); setToast(null); }, ai, setAi, edit, close, notify, openProject, createDemo, restore, change, openDocument, openCitation, activeDoc: route.doc, sourceRef, activeEvent: eventSelection || route.event, chooseEvent, activeGraph: graphSelection || (route.node ? { id: route.node, kind: route.graphKind } : null), chooseGraph };
  const dialogs = { import: ImportEditor, fact: FactEditor, annotation: AnnotationEditor, entity: EntityEditor, relationship: RelationshipEditor, issue: IssueEditor, suggestion: SuggestionEditor, 'trash-record': TrashDialog, draft: DraftEditor, 'draft-section': DraftSectionEditor, 'add-to-draft': AddSuggestionToDraft, 'remove-draft-section': RemoveDraftSection };
  const Editor = dialogs[modal?.name];

  if (loading || loadError) return <main className="bootstrap"><Brand onClick={() => location.reload()}/><section className="card"><Empty icon={loadError ? CircleAlert : Database} title={loadError ? tr("Could not open the local workspace") : tr("Opening your workspace…")} action={loadError && <Button onClick={() => location.reload()}>{tr("Retry")}</Button>}>{loadError}</Empty></section></main>;
  return <Workspace.Provider value={context}>
    <div className="app-shell"><aside className={`sidebar ${navOpen ? 'mobile-open' : ''}`}><Brand onClick={() => navigate('projects')}/>
      <div className="workspace-switch"><span>{t('Local workspace')}</span><button type="button" onClick={() => navigate('projects')}><FolderOpen size={17}/><span>{p?.name || t('Investigations')}</span><ChevronDown size={15}/></button></div>
      <nav aria-label={tr("Investigation navigation")}>
        {view === 'projects' && <button className="nav-item active" type="button" onClick={() => navigate('projects')}><FolderOpen size={18}/>{t('Investigations')}</button>}
        {p && navigation.map(([id, title, Icon]) => <button key={id} type="button" aria-current={view === id ? 'page' : undefined} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => navigate(id)}><Icon size={18}/>{t(title)}</button>)}
        {p && <button type="button" aria-current={view === 'settings' ? 'page' : undefined} className={`nav-item settings-nav ${view === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={18}/>{t('Settings')}</button>}
      </nav><div className="sidebar-footer"><LockKeyhole size={17}/><div><strong>{tr("Private by default")}</strong><small>{tr("Evidence stored on this device")}</small></div></div>
    </aside>{navOpen && <button className="mobile-overlay" aria-label={tr("Close navigation")} onClick={() => setNavOpen(false)}/>}
    <div className="app-content"><header className="topbar"><div className="breadcrumb"><IconButton icon={Menu} className="icon-button mobile-toggle" label={tr("Toggle navigation")} onClick={() => setNavOpen(!navOpen)}/><button type="button" onClick={() => navigate('projects')}><FolderOpen size={16}/>{t('Investigations')}</button>{view !== 'projects' && <><ChevronRight size={14}/><strong>{p.name}</strong></>}</div><span className="local-status"><span className="state-dot"/>{t('Local workspace')}</span></header>
    <main className="workspace-main"><Screen key={`${view}-${p?.id || ''}`}/></main></div></div>
    {modal?.name === 'project' && <ProjectEditor item={modal.item} onSave={saveProject}/>}
    {modal?.name === 'delete' && <DeleteProject item={modal.item} onDelete={deleteProject}/>}
    {Editor && p && <Editor {...modal}/>}
    {toast && <div className={`toast ${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>{toast.tone === 'error' ? <CircleAlert size={19}/> : <Activity size={18}/>}<span>{toast.message}</span><IconButton icon={X} label={tr("Dismiss message")} onClick={() => setToast(null)}/></div>}
  </Workspace.Provider>;
}

createRoot(document.getElementById('root')).render(<App/>);
