import { useState } from 'react';
import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react';
import { dateOf } from './data';
import { affectedRecords, moveToTrash, permanentlyDelete, recordTitle, recordType, restoreFromTrash } from './records';
import { Button, CardHead, Empty, Modal, PageHead, useWorkspace } from './ui';
import { tr } from './i18n';

export function TrashDialog({ kind, item, docId, entry }) {
  const { p, change, close, notify } = useWorkspace();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const title = recordTitle(kind, item);
  const affected = affectedRecords(p, kind, item.id);
  async function remove() {
    setBusy(true);
    try {
      await change(current => entry ? permanentlyDelete(current, entry.id) : moveToTrash(current, kind, item.id, docId), tr(entry ? 'Permanently deleted {title}.' : 'Moved {title} to Trash.', { title }));
      close();
      notify(tr(entry ? 'Record permanently deleted.' : 'Record moved to Trash.'));
    } catch (problem) { setError(problem.message); }
    finally { setBusy(false); }
  }
  return <Modal title={tr(entry ? 'Permanently delete record?' : 'Move record to Trash?')} onClose={() => !busy && close()}><div className="modal-body form-stack"><p><strong>{title}</strong> · {recordType(kind, item)}</p><p>{tr(entry ? 'This removes the record from this workspace and cannot be undone. Previously exported copies remain separate.' : 'You can restore this record from Settings → Trash.')}</p>
    {kind === 'evidence' && <p className="notice">{tr(entry ? 'Citations to this original will be removed. Affected verification and draft review statuses will reset. Written notes and summaries may still contain details from this source.' : 'This original will be unavailable to linked records and reports until restored. Verification that relies on it will be shown as unverified.')}</p>}
    {kind === 'entity' && <p className="notice">{tr(entry ? 'Linked relationships and event associations will be removed.' : 'Linked relationships and event associations will be hidden until you restore this entity.')}</p>}
    {affected > 0 && <p className="muted">{tr('Active linked records: {n}', { n: affected })}</p>}{error && <p className="notice danger" role="alert">{error}</p>}</div><footer><Button onClick={close} disabled={busy}>{tr('Cancel')}</Button><Button icon={Trash2} variant="danger-solid" onClick={remove} disabled={busy}>{tr(entry ? 'Delete permanently' : 'Move to Trash')}</Button></footer></Modal>;
}

export function TrashPage() {
  const { p, change, notify, edit, navigate } = useWorkspace();
  const [busy, setBusy] = useState('');
  async function restore(entry) {
    setBusy(entry.id);
    try { await change(current => restoreFromTrash(current, entry.id), tr('Restored {title}.', { title: recordTitle(entry.kind, entry.item) })); notify(tr('Record restored.')); }
    catch (error) { notify(error.message, 'error'); }
    finally { setBusy(''); }
  }
  return <><PageHead title={tr('Trash')} description={tr('Restore individual records or remove them permanently from this workspace.')} actions={<Button icon={ArrowLeft} onClick={() => navigate('settings')}>{tr('Settings')}</Button>}/><section className="card"><CardHead title={tr('Deleted records ({n})', { n: p.trash.length })}/>{p.trash.length ? <div className="table-scroll"><table><thead><tr><th>{tr('Record')}</th><th>{tr('Type')}</th><th>{tr('Moved to Trash')}</th><th>{tr('Actions')}</th></tr></thead><tbody>{p.trash.map(entry => <tr key={entry.id}><td><strong>{recordTitle(entry.kind, entry.item)}</strong></td><td>{recordType(entry.kind, entry.item)}</td><td>{dateOf(entry.at)}</td><td><div className="action-row"><Button icon={RotateCcw} disabled={Boolean(busy)} onClick={() => restore(entry)}>{tr('Restore')}</Button><Button icon={Trash2} variant="danger-outline" onClick={() => edit('trash-record', { kind: entry.kind, item: entry.item, entry })}>{tr('Delete permanently')}</Button></div></td></tr>)}</tbody></table></div> : <Empty icon={Trash2} title={tr('Trash is empty')}/>}</section></>;
}
