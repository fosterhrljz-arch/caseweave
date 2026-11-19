import { useState } from 'react';
import { ArrowDown, ArrowUp, Download, FileText, Pencil, Plus, Printer, Sparkles, Trash2 } from 'lucide-react';
import { dateOf, locate, now, uid, updateItem } from './data';
import { Editor } from './editors';
import { tr } from './i18n';
import { draftReviewed, exportMarkdown, reportFromDraft } from './transfer';
import { Badge, Button, CardHead, Empty, Field, IconButton, RefList, RefPicker, useWorkspace } from './ui';
import { ReportPaper } from './report-paper';

function setDraft(current, draft) {
  return { ...current, drafts: updateItem(current.drafts, { ...draft, updated: now() }) };
}

function updateDraft(current, id, updater) {
  const draft = current.drafts.find(row => row.id === id);
  if (!draft) throw new Error(tr('This draft is no longer available.'));
  return setDraft(current, updater(draft));
}

export function DraftEditor({ item }) {
  const { change, close, navigate, notify } = useWorkspace();
  const [title, setTitle] = useState(item?.title || '');
  const [summary, setSummary] = useState(item?.summary || '');
  async function save() {
    if (!title.trim()) throw new Error(tr('Enter a title.'));
    const id = item?.id || uid();
    await change(current => item ? updateDraft(current, id, draft => ({ ...draft, title: title.trim(), summary: summary.trim() })) : setDraft(current, { id, title: title.trim(), summary: summary.trim(), sections: [] }), tr('Saved report draft · {title}', { title: title.trim() }));
    close(); notify(tr('Report draft saved.')); navigate('reports', { tab: 'drafts', draft: id });
  }
  return <Editor title={tr(item ? 'Edit report draft' : 'New report draft')} save={save} trash={item && { kind: 'draft', item }}><Field label={tr('Title')}><input autoFocus required maxLength={180} value={title} onChange={event => setTitle(event.target.value)}/></Field><Field label={tr('Draft summary')} hint={tr('Use section-level citations for factual statements.')}><textarea rows={4} maxLength={5000} value={summary} onChange={event => setSummary(event.target.value)}/></Field></Editor>;
}

export function DraftSectionEditor({ draft, item }) {
  const { p, change, close, notify } = useWorkspace();
  const [title, setTitle] = useState(item?.title || '');
  const [body, setBody] = useState(item?.body || '');
  const [refs, setRefs] = useState(item?.refs || []);
  const [reviewed, setReviewed] = useState(item ? draftReviewed(p, item) : false);
  async function save() {
    if (!title.trim() || !body.trim()) throw new Error(tr('Enter a section heading and text.'));
    await change(current => updateDraft(current, draft.id, live => {
      if (item && !live.sections.some(section => section.id === item.id)) throw new Error(tr('This section is no longer available.'));
      if (reviewed && (!refs.length || refs.some(ref => !locate(current, ref)))) throw new Error(tr('Attach available source passages before marking this section reviewed.'));
      const section = { ...item, id: item?.id || uid(), title: title.trim(), body: body.trim(), refs, reviewed, origin: item?.origin || 'manual' };
      return { ...live, sections: updateItem(live.sections, section) };
    }), tr('Saved report section · {title}', { title: title.trim() }));
    close(); notify(tr('Report section saved.'));
  }
  return <Editor title={tr(item ? 'Edit section' : 'Add section')} save={save} wide><Field label={tr('Section heading')}><input maxLength={200} value={title} required autoFocus onChange={event => { setTitle(event.target.value); setReviewed(false); }}/></Field><Field label={tr('Section text')}><textarea rows={6} maxLength={12000} value={body} required onChange={event => { setBody(event.target.value); setReviewed(false); }}/></Field><RefPicker refs={refs} onChange={value => { setRefs(value); setReviewed(false); }}/><label className="check"><input type="checkbox" checked={reviewed} disabled={!refs.length || refs.some(ref => !locate(p, ref))} onChange={event => setReviewed(event.target.checked)}/>{tr('I checked the section against its sources')}</label></Editor>;
}

export function AddSuggestionToDraft({ item }) {
  const { p, change, close, notify, navigate } = useWorkspace();
  const [target, setTarget] = useState(p.drafts[0]?.id || '');
  const [title, setTitle] = useState(tr('Report draft · {title}', { title: p.name }));
  async function save() {
    const id = target || uid();
    await change(current => {
      const live = current.suggestions.find(entry => entry.id === item.id && entry.state !== 'rejected');
      if (!live || !live.refs.length || live.refs.some(ref => !locate(current, ref))) throw new Error(tr('Attach available source passages before adding this suggestion.'));
      if (!target && !title.trim()) throw new Error(tr('Enter a title.'));
      const section = { id: uid(), title: live.title, body: live.body, refs: live.refs, reviewed: false, origin: 'ai', suggestionId: live.id };
      const next = target ? updateDraft(current, id, draft => {
        if (draft.sections.some(row => row.suggestionId === live.id)) throw new Error(tr('This suggestion is already in the selected draft.'));
        return { ...draft, sections: [...draft.sections, section] };
      }) : setDraft(current, { id, title: title.trim(), summary: '', sections: [section] });
      return { ...next, suggestions: updateItem(current.suggestions, { ...live, state: 'accepted' }) };
    }, tr('Added a cited AI section to a report draft.'));
    close(); notify(tr('Section added. Review the wording and citations in Reports.')); navigate('reports', { tab: 'drafts', draft: id });
  }
  return <Editor title={tr('Add to report draft')} description={tr('The section will be marked Needs review until you check its sources.')} save={save} submitLabel={tr('Add to draft')}><Field label={tr('Destination draft')}><select value={target} onChange={event => setTarget(event.target.value)}><option value="">{tr('Create a new draft')}</option>{p.drafts.map(draft => <option key={draft.id} value={draft.id}>{draft.title}</option>)}</select></Field>{!target && <Field label={tr('Title')}><input value={title} required maxLength={180} onChange={event => setTitle(event.target.value)}/></Field>}</Editor>;
}

export function RemoveDraftSection({ draft, item }) {
  const { change, close, notify } = useWorkspace();
  return <Editor title={tr('Remove section?')} description={tr('This section will be removed from the draft.')} submitLabel={tr('Remove section')} save={async () => {
    await change(current => updateDraft(current, draft.id, live => ({ ...live, sections: live.sections.filter(section => section.id !== item.id) })), tr('Removed report section · {title}', { title: item.title }));
    close(); notify(tr('Section removed.'));
  }}><p>{item.title}</p></Editor>;
}

export function Drafts() {
  const { p, route, navigate, change, edit, notify } = useWorkspace();
  const draft = p.drafts.find(row => row.id === route.draft) || p.drafts[0];
  const report = draft && reportFromDraft(p, draft);
  async function move(item, direction) {
    try {
      await change(current => updateDraft(current, draft.id, live => {
        const sections = [...live.sections];
        const index = sections.findIndex(row => row.id === item.id);
        const next = index + direction;
        if (index < 0 || next < 0 || next >= sections.length) return live;
        [sections[index], sections[next]] = [sections[next], sections[index]];
        return { ...live, sections };
      }), tr('Reordered report sections.'));
    } catch (error) { notify(error.message, 'error'); }
  }
  return <><div className="context-layout main-gap"><section className="card"><CardHead title={draft?.title || tr('Report drafts')} detail={draft ? tr('Updated {date}', { date: dateOf(draft.updated) }) : undefined} action={draft && <IconButton icon={Pencil} label={tr('Edit report draft')} onClick={() => edit('draft', { item: draft })}/>}/>
    {draft ? <><div className="filter-bar"><Field label={tr('Active draft')}><select value={draft.id} onChange={event => navigate('reports', { tab: 'drafts', draft: event.target.value })}>{p.drafts.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field><Button icon={Plus} variant="primary" onClick={() => edit('draft-section', { draft })}>{tr('Add section')}</Button></div>{draft.summary && <p className="draft-summary notes-text">{draft.summary}</p>}
    {draft.sections.length ? draft.sections.map((item, index) => <article className="queue-item" key={item.id}><div className="split-line"><div className="tag-row"><Badge tone={item.origin === 'ai' ? 'violet' : 'gray'}>{tr(item.origin === 'ai' ? 'AI-assisted' : 'Manual')}</Badge><Badge tone={draftReviewed(p, item) ? 'green' : 'amber'}>{tr(draftReviewed(p, item) ? 'Reviewed' : 'Needs review')}</Badge></div><div className="action-row"><IconButton icon={ArrowUp} label={tr('Move section up')} disabled={!index} onClick={() => move(item, -1)}/><IconButton icon={ArrowDown} label={tr('Move section down')} disabled={index === draft.sections.length - 1} onClick={() => move(item, 1)}/><IconButton icon={Pencil} label={tr('Edit section')} onClick={() => edit('draft-section', { draft, item })}/><IconButton icon={Trash2} label={tr('Remove section')} onClick={() => edit('remove-draft-section', { draft, item })}/></div></div><h3>{item.title}</h3><p className="notes-text">{item.body}</p><RefList refs={item.refs} quote empty={tr('No source attached.')}/></article>) : <Empty icon={FileText} title={tr('No sections yet')}>{tr('Add a section here or send a cited suggestion from the verification queue.')}</Empty>}</> : <Empty icon={FileText} title={tr('No report drafts')} action={<Button icon={Plus} variant="primary" onClick={() => edit('draft')}>{tr('New report draft')}</Button>}>{tr('Build a draft from cited AI suggestions and your own sections.')}</Empty>}</section>
    <aside className="card inspector"><CardHead title={tr('Draft actions')}/><div className="inspector-body form-stack"><Button icon={Plus} onClick={() => edit('draft')}>{tr('New report draft')}</Button><Button icon={Sparkles} onClick={() => navigate('analysis', { mode: 'Draft report' })}>{tr('Draft with AI')}</Button>{draft && <><Button icon={Download} onClick={() => exportMarkdown(report)}>{tr('Export Markdown')}</Button><Button icon={Printer} variant="primary" onClick={() => window.print()}>{tr('Save as PDF')}</Button><p className="muted">{tr('Exports preserve section order, review labels, and the evidence index.')}</p></>}</div></aside></div>
    {report && <ReportPaper report={report} print/>}</>;
}
