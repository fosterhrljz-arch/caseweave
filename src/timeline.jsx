import { tr, locale } from './i18n';
import { useState } from 'react';
import { CalendarDays, CalendarPlus, ChevronRight, Pencil, Plus, TriangleAlert } from 'lucide-react';
import { effectiveStatus } from './records';
import { audit, dateOf, orderFacts } from './data';
import { Badge, Button, CardHead, Empty, IconButton, PageHead, RefList, Status, useWorkspace } from './ui';

const day = 86_400_000;
const dayLabel = value => new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(value);
const keyboardPick = click => event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); click(); } };

function ChronologyPlot({ records, selected, onPick }) {
  const dated = records.filter(record => record.date);
  if (!dated.length) return <Empty icon={CalendarDays} title={tr("No dated events")}>{tr("Dated events matching these filters will appear here.")}</Empty>;
  const start = Math.min(...dated.map(record => Date.parse(record.date)));
  const end = Math.max(start + day, ...dated.map(record => Date.parse(record.end || record.date)));
  const x = value => 58 + 904 * (value - start) / (end - start);
  const step = Math.max(1, Math.ceil((end - start) / day / 5));
  const ticks = Array.from({ length: Math.floor((end - start) / day / step) + 1 }, (_, index) => start + step * index * day);
  const laneEnds = [];
  const positions = dated.map(record => {
    const left = x(Date.parse(record.date));
    const right = x(Date.parse(record.end || record.date));
    let lane = laneEnds.findIndex(used => used + 116 < left);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = right;
    return { record, left, right, lane };
  });
  const height = laneEnds.length * 41 + 71;
  return <div className="timeline-plot-scroll"><svg className="timeline-plot" viewBox={`0 0 1020 ${height}`} role="group" aria-label={tr("Interactive date-scaled event chronology")}>
    {ticks.map(tick => <g key={tick}><line x1={x(tick)} x2={x(tick)} y1="36" y2={height - 20} stroke="#e9e7f6" strokeDasharray="3 4"/><text x={x(tick)} y="20" textAnchor="middle" className="chart-tick">{dayLabel(tick)}</text></g>)}
    <line x1="58" x2="962" y1="36" y2="36" stroke="#c3b7f8"/>
    {positions.map(({ record, left, right, lane }) => {
      const y = 56 + lane * 41;
      const label = record.title.length > 21 ? `${record.title.slice(0, 20)}…` : record.title;
      const color = record.status === 'verified' ? '#6545e8' : record.status === 'disputed' ? '#c37c16' : '#7790be';
      const labelRight = left < 790;
      const pick = () => onPick(record.id);
      return <g key={record.id} className={`svg-pick ${selected === record.id ? 'chosen' : ''}`} role="button" tabIndex="0" onClick={pick} onKeyDown={keyboardPick(pick)} aria-label={`${record.title}, ${record.date}`}>
        <title>{record.title}</title><line x1={left} x2={left} y1="36" y2={y} stroke={color} opacity=".38"/>
        <rect x={Math.min(left - 10, labelRight ? left : left - 165)} y={y - 15} width={Math.max(right - left + 20, 177)} height="35" fill="transparent"/>
        {right > left && <line x1={left} x2={right} y1={y} y2={y} stroke={color} strokeWidth="10" strokeLinecap="round" opacity=".35"/>}
        <circle cx={left} cy={y} r={selected === record.id ? 8 : 5} fill={color} stroke="white" strokeWidth="2"/>
        <text x={left + (labelRight ? 13 : -13)} y={y + 18} textAnchor={labelRight ? 'start' : 'end'} className="timeline-label">{label}</text>
      </g>;
    })}
  </svg></div>;
}

export default function Timeline() {
  const { p, edit, activeEvent, chooseEvent, navigate, t } = useWorkspace();
  const [status, setStatus] = useState('');
  const [person, setPerson] = useState('');
  const [tag, setTag] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dateMode, setDateMode] = useState('');
  const events = p.facts.filter(record => record.kind === 'event').map(record => ({ ...record, status: effectiveStatus(p, record) })).toSorted(orderFacts);
  const tags = [...new Set(events.flatMap(record => record.tags))].sort();
  const visible = events.filter(record => (!status || record.status === status) && (!person || record.entities.includes(person)) && (!tag || record.tags.includes(tag)) && (!dateMode || !record.date) && (!from || (record.date && (record.end || record.date) >= from)) && (!to || (record.date && record.date <= to)));
  const selected = visible.find(record => record.id === activeEvent) || visible[0];
  const review = audit(p);
  const contradictions = review.open.filter(issue => issue.kind === 'Contradiction');
  return <><PageHead title={t('Event Timeline')} description={tr("Review the chronology and open the evidence behind each event.")} actions={<><Button onClick={() => navigate('analysis', { mode: 'Extract facts' })}>{tr("Extract with AI")}</Button><Button variant="primary" icon={Plus} onClick={() => edit('fact', { kind: 'event' })}>{t('Add event')}</Button></>}/>
  <section className="card"><div className="filter-bar"><select aria-label={tr("Verification status")} value={status} onChange={e => setStatus(e.target.value)}><option value="">{t('All statuses')}</option>{['verified','unverified','disputed'].map(value => <option key={value} value={value}>{t(value[0].toUpperCase() + value.slice(1))}</option>)}</select><select aria-label={tr("Filter by entity")} value={person} onChange={e => setPerson(e.target.value)}><option value="">{t('All entities')}</option>{p.entities.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select><select aria-label={tr("Filter by tag")} value={tag} onChange={e => setTag(e.target.value)}><option value="">{t('All tags')}</option>{tags.map(name => <option key={name}>{name}</option>)}</select><select aria-label={tr("Date availability")} value={dateMode} onChange={e => { setDateMode(e.target.value); if (e.target.value) { setFrom(''); setTo(''); } }}><option value="">{t('All dates')}</option><option value="undated">{t('Undated')}</option></select><label className="date-filter">{"" + tr("From") + " "}<input type="date" aria-label={tr("Date from")} disabled={!!dateMode} value={from} onChange={e => setFrom(e.target.value)}/></label><label className="date-filter">{"" + tr("To") + " "}<input type="date" aria-label={tr("Date to")} disabled={!!dateMode} value={to} onChange={e => setTo(e.target.value)}/></label></div>
    <ChronologyPlot records={visible} selected={selected?.id} onPick={id => chooseEvent(id, true)}/></section>
  <div className="context-layout main-gap"><section className="card"><CardHead title={tr("Events ({v1})", { v1: visible.length })} action={(review.undated.length || contradictions.length) ? <Button variant="quiet" icon={TriangleAlert} onClick={() => navigate('analysis', { tab: 'issues' })}>{review.undated.length + contradictions.length}{" " + tr("date or account flags") + ""}</Button> : null}/>
  {visible.length ? <div className="table-scroll"><table><thead><tr><th>{tr("Date")}</th><th>{tr("Event")}</th><th>{tr("Status")}</th><th>{tr("Sources")}</th></tr></thead><tbody>{visible.map(record => <tr key={record.id} className={selected?.id === record.id ? 'selected-row' : ''}><td className="nowrap">{dateOf(record.date)}{record.end && <small className="block muted">{"" + tr("to") + " "}{dateOf(record.end)}</small>}</td><td><button type="button" className="table-link" onClick={() => chooseEvent(record.id, true)}>{record.title}</button>{review.overlaps.has(record.id) && <small className="block muted">{"" + tr("Overlaps") + " "}{review.overlaps.get(record.id).length} {review.overlaps.get(record.id).length === 1 ? tr("event") : tr("events")}</small>}</td><td><Status value={record.status}/></td><td>{record.refs.length}</td></tr>)}</tbody></table></div> : <Empty icon={CalendarPlus} title={events.length ? tr("No matching events") : tr("No events yet")}>{events.length ? tr("Adjust the date, entity, tag, or verification filters.") : tr("Add an event or review suggestions in AI Analysis.")}</Empty>}</section>
    <aside className="card inspector"><CardHead title={tr("Event details")} action={selected && <IconButton icon={Pencil} label={tr("Edit event")} onClick={() => edit('fact', { item: selected })}/>}/>{selected ? <><div className="inspector-body"><RecordDetail record={selected}/>{review.overlaps.has(selected.id) && <section className="inspector-section"><h3>{tr("Overlapping dates")}</h3><p className="muted">{review.overlaps.get(selected.id).join(', ')}</p></section>}</div></> : <Empty icon={CalendarDays} title={tr("Select an event")}/>}</aside>
  </div></>;
}

export function RecordDetail({ record }) {
  const { p, chooseGraph, t } = useWorkspace();
  return <div className="record-detail"><div className="tag-row"><Status value={record.status}/>{record.origin !== 'Manual' && <Badge tone="violet">{tr(record.origin)}</Badge>}</div><h3>{record.title}</h3><p className="detail-date"><CalendarDays size={15}/>{dateOf(record.date)}{record.end ? ` – ${dateOf(record.end)}` : ''}</p>{record.body && <p className="notes-text">{record.body}</p>}
    {record.tags.length > 0 && <div className="tag-row">{record.tags.map(tag => <Badge key={tag}>{tag}</Badge>)}</div>}
    {record.entities.some(id => p.entities.some(entity => entity.id === id)) && <section className="inspector-section"><h3>{tr("Linked entities")}</h3>{record.entities.map(id => p.entities.find(entity => entity.id === id)).filter(Boolean).map(entity => <button key={entity.id} className="simple-link" onClick={() => chooseGraph(entity.id)}>{entity.name}<ChevronRight size={15}/></button>)}</section>}
    <section className="inspector-section"><h3>{t('Source references')}</h3><RefList refs={record.refs} quote empty={tr("No source linked.")}/></section></div>;
}
