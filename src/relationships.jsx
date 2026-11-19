import { tr } from './i18n';
import { useMemo, useState } from 'react';
import { BriefcaseBusiness, CalendarDays, FileText, Link2, Maximize2, Minus, Network, Pencil, Plus, Users } from 'lucide-react';
import { documentTitle } from './records';
import { locate } from './data';
import { Badge, Button, CardHead, Empty, IconButton, PageHead, RefList, SearchBox, useWorkspace } from './ui';

const types = ['Person', 'Organization', 'Place', 'Other', 'Event', 'Evidence'];
const styles = { Person: ['#dff2e9', '#2e7b62'], Organization: ['#e9e2ff', '#6446bf'], Place: ['#fff0d7', '#958044'], Other: ['#ebedf4', '#4b5876'], Event: ['#e3edff', '#396cb2'], Evidence: ['#fff0d7', '#a56d23'] };
const actionKey = handler => event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); handler(); } };

function buildGraph(p, showRecords) {
  const nodes = p.entities.map(entity => ({ id: entity.id, name: entity.name, type: entity.type, entity }));
  const edges = p.relationships.filter(edge => edge.refs.some(ref => locate(p, ref))).map(edge => ({ ...edge, type: 'Relationship', editable: true }));
  if (showRecords) {
    for (const fact of p.facts.filter(fact => fact.kind === 'event')) {
      const id = `event:${fact.id}`;
      nodes.push({ id, name: fact.title, type: 'Event', fact });
      for (const entity of fact.entities) edges.push({ id: `linked:${id}:${entity}`, from: entity, to: id, label: 'Linked to event', refs: fact.refs, type: 'Record link' });
      for (const doc of new Set(fact.refs.map(ref => ref.doc))) edges.push({ id: `source:${id}:${doc}`, from: id, to: `doc:${doc}`, label: 'Event cites evidence', refs: fact.refs.filter(ref => ref.doc === doc), type: 'Record link' });
    }
    for (const doc of p.evidence) nodes.push({ id: `doc:${doc.id}`, name: documentTitle(doc), type: 'Evidence', doc });
    for (const entity of p.entities) for (const doc of new Set(entity.refs.map(ref => ref.doc))) edges.push({ id: `source:${entity.id}:${doc}`, from: entity.id, to: `doc:${doc}`, label: 'Profile cites evidence', refs: entity.refs.filter(ref => ref.doc === doc), type: 'Record link' });
  }
  return { nodes, edges };
}

function Graph({ nodes, edges, selection, chooseGraph, zoom, setZoom }) {
  const positions = new Map();
  const anchors = nodes.filter(node => node.type === 'Organization');
  const orbit = nodes.filter(node => node.type !== 'Organization');
  const horizontal = Math.max(780, Math.ceil((nodes.length - 8) / 12) * 340 + 780);
  const vertical = Math.max(410, Math.ceil((nodes.length - 8) / 12) * 260 + 410);
  anchors.forEach((node, index) => positions.set(node.id, [horizontal / 2 + (index - (anchors.length - 1) / 2) * Math.min(230, (horizontal - 120) / anchors.length), vertical / 2]));
  orbit.forEach((node, index) => {
    const angle = (index / orbit.length) * 2 * Math.PI - 3 * Math.PI / 4;
    positions.set(node.id, [horizontal / 2 + (horizontal / 2 - 110) * Math.cos(angle), vertical / 2 + (vertical / 2 - 68) * Math.sin(angle)]);
  });
  const width = horizontal / zoom;
  const height = vertical / zoom;
  const [pan, setPan] = useState([0, 0]);
  const focusedEdge = edges.find(edge => selection?.id === edge.id && selection.kind === 'edge');
  const focusNodes = focusedEdge ? [focusedEdge.from, focusedEdge.to] : selection?.kind === 'node' ? [selection.id, ...edges.flatMap(e => e.from === selection.id ? [e.to] : e.to === selection.id ? [e.from] : [])] : [];
  return <div className="graph-canvas">
    {nodes.length ? <svg viewBox={`${(horizontal - width) / 2 + pan[0]} ${(vertical - height) / 2 + pan[1]} ${width} ${height}`} className="relationship-graph" role="group" aria-label={tr("Interactive relationship graph")} onKeyDown={event => {
      const changes = { ArrowLeft: [-65, 0], ArrowRight: [65, 0], ArrowUp: [0, -65], ArrowDown: [0, 65] };
      if (changes[event.key]) { event.preventDefault(); setPan(([x, y]) => [x + changes[event.key][0], y + changes[event.key][1]]); }
    }}>
      {edges.map(edge => {
        const [x1, y1] = positions.get(edge.from);
        const [x2, y2] = positions.get(edge.to);
        const selected = focusedEdge?.id === edge.id;
        const near = focusNodes.includes(edge.from) && focusNodes.includes(edge.to);
        const pick = () => chooseGraph(edge.id, 'edge', true);
        const label = `${nodes.find(n => n.id === edge.from)?.name} — ${edge.label} — ${nodes.find(n => n.id === edge.to)?.name}`;
        const middle = [(x1 + x2) / 2, (y1 + y2) / 2];
        return <g key={edge.id} className="graph-edge svg-pick" role="button" tabIndex="0" aria-label={label} onClick={pick} onKeyDown={actionKey(pick)}><title>{label}</title><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth="18"/><line x1={x1} y1={y1} x2={x2} y2={y2} stroke={selected ? '#6545e8' : near ? '#a58df1' : '#c5c2dd'} strokeWidth={selected ? 3 : 1.8} strokeDasharray={edge.editable ? undefined : '5 4'} pointerEvents="none"/><circle cx={middle[0]} cy={middle[1]} r="4.5" fill={selected ? '#6545e8' : '#b8aceb'} stroke="#fff" pointerEvents="none"/></g>;
      })}
      {nodes.map(node => {
        const [x, y] = positions.get(node.id);
        const [fill, color] = styles[node.type] || styles.Other;
        const chosen = selection?.id === node.id && selection.kind === 'node';
        const nodeWidth = Math.min(178, Math.max(108, node.name.length * 6.8 + 32));
        const label = node.name.length <= 25 ? node.name : `${node.name.slice(0, 23)}…`;
        const pick = () => chooseGraph(node.id, 'node', true);
        return <g key={node.id} className="graph-node svg-pick" role="button" tabIndex="0" aria-label={`${node.name}, ${tr(node.type)}`} onClick={pick} onKeyDown={actionKey(pick)}><title>{node.name} · {tr(node.type)}</title><rect x={x - nodeWidth / 2} y={y - 24} width={nodeWidth} height="48" rx="15" fill={fill} stroke={color} strokeWidth={chosen ? 2.6 : 1} strokeOpacity={chosen ? 1 : .35}/><text x={x} y={y - 3} textAnchor="middle" className="graph-name" fill={color}>{label}</text><text x={x} y={y + 13} textAnchor="middle" className="graph-type" fill={color}>{tr(node.type)}</text></g>;
      })}
    </svg> : <Empty icon={Network} title={tr("No matching graph nodes")}>{tr("Add an entity or change the current filters.")}</Empty>}
    <div className="graph-controls"><IconButton icon={Minus} label={tr("Zoom out")} onClick={() => setZoom(Math.max(.55, zoom - .2))} disabled={zoom <= .55}/><IconButton icon={Plus} label={tr("Zoom in")} onClick={() => setZoom(Math.min(2.6, zoom + .2))} disabled={zoom >= 2.6}/><IconButton icon={Maximize2} label={tr("Reset graph view")} onClick={() => { setZoom(1); setPan([0, 0]); }}/></div>
  </div>;
}

export default function Relationships() {
  const { p, edit, activeGraph, chooseGraph, chooseEvent, openDocument, t } = useWorkspace();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [relationship, setRelationship] = useState('');
  const [showRecords, setShowRecords] = useState(Boolean(activeGraph?.id?.startsWith('doc:') || activeGraph?.id?.startsWith('event:')));
  const [zoom, setZoom] = useState(1);
  const graph = useMemo(() => buildGraph(p, showRecords), [p, showRecords]);
  const unavailable = p.relationships.filter(edge => !edge.refs.some(ref => locate(p, ref)) || ![edge.from, edge.to].every(id => p.entities.some(entity => entity.id === id)));
  const nodeMap = new Map(graph.nodes.map(node => [node.id, node]));
  const matchingEdges = graph.edges.filter(edge => !relationship || edge.label === relationship);
  const primary = graph.nodes.filter(node => (!type || node.type === type) && node.name.toLowerCase().includes(query.trim().toLowerCase()));
  const primaryIds = new Set(primary.map(node => node.id));
  const edges = matchingEdges.filter(edge => (primaryIds.has(edge.from) || primaryIds.has(edge.to)) && nodeMap.has(edge.from) && nodeMap.has(edge.to));
  const shownIds = new Set([...primaryIds, ...edges.flatMap(edge => [edge.from, edge.to])]);
  const nodes = graph.nodes.filter(node => shownIds.has(node.id) && (!relationship || edges.some(edge => edge.from === node.id || edge.to === node.id)));
  const pickedEdge = activeGraph?.kind === 'edge' && edges.find(edge => edge.id === activeGraph.id);
  const pickedNode = !pickedEdge && (nodes.find(node => node.id === activeGraph?.id) || primary.find(node => nodes.includes(node)) || nodes[0]);
  const neighbors = pickedNode ? edges.filter(edge => edge.from === pickedNode.id || edge.to === pickedNode.id) : [];
  const entityEvents = pickedNode?.entity ? p.facts.filter(record => record.entities.includes(pickedNode.id)) : [];
  const PickIcon = pickedNode?.type === 'Organization' ? BriefcaseBusiness : pickedNode?.type === 'Event' ? CalendarDays : pickedNode?.type === 'Evidence' ? FileText : Users;
  const selected = pickedEdge ? { id: pickedEdge.id, kind: 'edge' } : pickedNode ? { id: pickedNode.id, kind: 'node' } : null;
  return <><PageHead title={t('Relationships')} description={tr("Explore entities and inspect the evidence for each connection.")} actions={<><Button icon={Link2} onClick={() => edit('relationship')} disabled={p.entities.length < 2}>{t('Add relationship')}</Button><Button variant="primary" icon={Plus} onClick={() => edit('entity')}>{t('Add entity')}</Button></>}/>
    <div className="context-layout"><section className="card graph-card"><div className="filter-bar"><SearchBox value={query} onChange={setQuery} placeholder={tr("Find a node…")}/><select aria-label={tr("Node type")} value={type} onChange={e => setType(e.target.value)}><option value="">{t('All entities')}</option>{types.filter(value => showRecords || !['Event', 'Evidence'].includes(value)).map(value => <option key={value} value={value}>{tr(value)}</option>)}</select><select aria-label={tr("Relationship type")} value={relationship} onChange={e => setRelationship(e.target.value)}><option value="">{tr("All relationships")}</option>{[...new Set(graph.edges.map(edge => edge.label))].sort().map(value => <option key={value}>{value}</option>)}</select><label className="check"><input type="checkbox" checked={showRecords} onChange={e => { setShowRecords(e.target.checked); setType(''); setRelationship(''); }}/>{" " + tr("Include events and evidence") + ""}</label></div>
    <Graph nodes={nodes} edges={edges} selection={selected} chooseGraph={chooseGraph} zoom={zoom} setZoom={setZoom}/><div className="graph-legend">{types.filter(value => nodes.some(node => node.type === value)).map(value => <span key={value}><i style={{ background: styles[value][0], borderColor: styles[value][1] }}/>{tr(value)}</span>)}<small>{nodes.length}{" " + tr("nodes ·") + " "}{edges.length}{" " + tr("links") + ""}</small></div>{unavailable.length > 0 && <div className="issue-flags"><h3>{tr("Unavailable connections")}</h3>{unavailable.map(item => <button key={item.id} className="simple-link" onClick={() => edit('relationship', { item })}><Link2 size={15}/>{item.label}</button>)}</div>}</section>
    <aside className="card inspector"><CardHead title={pickedEdge ? tr("Connection details") : tr("Entity profile")} action={pickedEdge?.editable ? <IconButton icon={Pencil} label={tr("Edit relationship")} onClick={() => edit('relationship', { item: pickedEdge })}/> : pickedNode?.entity ? <IconButton icon={Pencil} label={tr("Edit entity")} onClick={() => edit('entity', { item: pickedNode.entity })}/> : undefined}/><div className="inspector-body">
      {pickedEdge ? <><Badge tone="violet">{tr(pickedEdge.type)}</Badge><h3 className="panel-title">{pickedEdge.editable ? pickedEdge.label : tr(pickedEdge.label)}</h3><div className="graph-ends">{[pickedEdge.from, pickedEdge.to].map(id => <button className="simple-link" key={id} onClick={() => chooseGraph(id, 'node', true)}>{nodeMap.get(id)?.name}</button>)}</div>{pickedEdge.notes && <p className="notes-text">{pickedEdge.notes}</p>}<section className="inspector-section"><h3>{tr("Supporting evidence")}</h3><RefList refs={pickedEdge.refs} quote empty={tr("This record link has no cited passage.")}/></section></> : pickedNode ? <>
        <div className="profile-heading"><div className="profile-icon"><PickIcon size={20}/></div><div><h3>{pickedNode.name}</h3><small>{tr(pickedNode.type)}</small></div></div>
        {(pickedNode.entity?.notes || pickedNode.fact?.body) && <p className="notes-text">{pickedNode.entity?.notes || pickedNode.fact?.body}</p>}
        {pickedNode.doc && <Button variant="quiet" onClick={() => openDocument(pickedNode.doc.id)}>{tr("Open evidence record")}</Button>}{pickedNode.fact && <Button variant="quiet" onClick={() => chooseEvent(pickedNode.fact.id)}>{tr("Open timeline event")}</Button>}
        <section className="inspector-section"><h3>{"" + tr("Connections") + " "}<span>{neighbors.length}</span></h3>{neighbors.map(edge => <button key={edge.id} className="simple-link" onClick={() => chooseGraph(edge.id, 'edge', true)}><Link2 size={15}/><span>{edge.editable ? edge.label : tr(edge.label)}<small>{nodeMap.get(edge.from === pickedNode.id ? edge.to : edge.from)?.name}</small></span></button>)}{!neighbors.length && <p className="muted">{tr("No visible connections.")}</p>}</section>
        {entityEvents.length > 0 && <section className="inspector-section"><h3>{tr("Linked case records")}</h3>{entityEvents.map(event => <button key={event.id} className="simple-link" onClick={() => chooseEvent(event.id)}><CalendarDays size={15}/>{event.title}</button>)}</section>}
        <section className="inspector-section"><h3>{tr("Supporting evidence")}</h3><RefList refs={pickedNode.entity?.refs || pickedNode.fact?.refs} quote empty={tr("No passage attached to this node.")}/></section>
      </> : <Empty icon={Users} title={tr("Select a node or connection")}/>}</div></aside></div></>;
}
