import { cite, digest, project } from './data';

const demoFiles = [
  ['Procurement approval memo.txt', 'Harborline Transit · records office', ['approval', 'procurement'], [
    'HARBORLINE TRANSIT AUTHORITY\nFacilities upgrade · Procurement approval memo',
    'On 2024-05-24, procurement chair Elena Park authorized the evaluation committee to recommend Rivermere Systems for the facilities upgrade. This memo authorizes a recommendation only.',
    'The committee met between 2024-05-21 and 2024-05-24. The purchase order must be signed by finance before the supplier starts work.',
    'The bid register contains three bids. The scoring worksheet is referenced but missing from the records release.',
  ]],
  ['Vendor interview transcript.txt', 'Recorded interview · 2024-06-03', ['interview', 'disputed'], [
    'INTERVIEW RECORD\nMarcus Vale, operations director, Rivermere Systems',
    'Marcus Vale: We began the site installation on 2024-05-23 at the express direction of Elena Park. Our crew was already inside the depot before the authorization memo.',
    'Marcus Vale: I did not see a purchase order that week. I was speaking about physical installation, not the site survey.',
    'Follow-up request: Obtain the crew work order and task-level time sheets for May 23.',
  ]],
  ['Depot access register.csv', 'Harborline Transit · depot gate export', ['access', 'operations'], [
    'date,time,visitor,organization,purpose',
    '2024-05-22,09:10,Marcus Vale,Rivermere Systems,Site survey',
    '2024-05-23,08:42,Marcus Vale,Rivermere Systems,Measurement and survey only',
    '2024-05-28,07:55,Marcus Vale,Rivermere Systems,Installation crew escort',
  ]],
  ['Finance office statement.txt', 'Harborline Transit · statement by Priya Shah', ['finance', 'disputed'], [
    'FINANCE OFFICE STATEMENT\nPrepared for the internal records review on 2024-06-04',
    'Priya Shah: Survey access was permitted before signature. The first physical installation was on 2024-05-28, the day after the purchase order was signed.',
    'Priya Shah: The procurement chair requested an exception at a meeting. I cannot establish the date of that meeting from this file.',
  ]],
  ['Signed purchase order.txt', 'Harborline Transit · purchase order PO-0247', ['finance', 'contract'], [
    'PURCHASE ORDER PO-0247\nFacilities upgrade · Harborline Transit Authority',
    'Harborline Transit Authority issued purchase order PO-0247 to Rivermere Systems on 2024-05-27 for depot facilities installation.',
    'Signature: Priya Shah, Finance Controller. Contract amount: USD 486,000. The supplier may start installation upon signature.',
  ]],
  ['Committee work plan.txt', 'Facilities evaluation committee · meeting packet', ['procurement', 'operations'], [
    'EVALUATION COMMITTEE WORK PLAN\nVersion circulated 2024-05-20',
    'Technical evaluation ran from 2024-05-21 through 2024-05-24. Depot surveys for shortlisted suppliers were scheduled for 2024-05-22 through 2024-05-23.',
    'Elena Park chaired the Harborline Transit Authority procurement committee. Nadia Holt served as the depot operations liaison.',
  ]],
];

export function demoProject() {
  const p = project('Harborline Procurement Review', 'Establish whether depot installation began before Harborline Transit signed its purchase order.', 'harborline-demo');
  p.fictional = true;
  p.evidence = demoFiles.map(([name, source, tags, lines], index) => {
    const type = name.endsWith('.csv') ? 'CSV' : 'TXT';
    const payload = new TextEncoder().encode(lines.join(type === 'CSV' ? '\n' : '\n\n'));
    return {
      id: `demo-doc-${index + 1}`, name, type, source, tags, notes: '', verified: index !== 1 && index !== 3,
      imported: '2024-06-05T14:00:00.000Z', modified: null, hash: digest(payload), size: payload.length,
      original: new Blob([payload], { type: type === 'CSV' ? 'text/csv' : 'text/plain' }), annotations: [],
      parts: lines.map((text, n) => ({ id: `s${n + 1}`, label: `${type === 'CSV' ? 'Row' : 'Paragraph'} ${n + 1}`, text })),
    };
  });
  const ref = (doc, part) => cite(p.evidence[doc], p.evidence[doc].parts[part]);
  p.entities = [
    ['elena', 'Elena Park', 'Person', 'Procurement committee chair.', [ref(5, 2)]],
    ['marcus', 'Marcus Vale', 'Person', 'Operations director at Rivermere Systems.', [ref(1, 0)]],
    ['priya', 'Priya Shah', 'Person', 'Finance controller and purchase-order signatory.', [ref(4, 2)]],
    ['nadia', 'Nadia Holt', 'Person', 'Depot operations liaison.', [ref(5, 2)]],
    ['harborline', 'Harborline Transit', 'Organization', 'Transit authority responsible for the depot upgrade.', [ref(4, 1)]],
    ['rivermere', 'Rivermere Systems', 'Organization', 'Vendor selected for depot facilities installation.', [ref(4, 1)]],
  ].map(([id, name, type, notes, refs]) => ({ id, name, type, notes, refs }));
  p.facts = [
    ['01', 'Technical evaluation period', 'The committee evaluated bids over four days.', '2024-05-21', '2024-05-24', 'verified', ['elena', 'harborline'], ['procurement'], [ref(0, 2), ref(5, 1)]],
    ['02', 'Supplier site surveys', 'The work plan scheduled two days of surveys. The gate logged Rivermere on both days.', '2024-05-22', '2024-05-23', 'verified', ['marcus', 'rivermere'], ['operations'], [ref(5, 1), ref(2, 1), ref(2, 2)]],
    ['03', 'Vendor alleges installation started', 'Marcus Vale states that physical installation began May 23.', '2024-05-23', '', 'disputed', ['marcus', 'elena'], ['installation'], [ref(1, 1), ref(3, 1)]],
    ['04', 'Committee recommendation authorized', 'Elena Park authorized a recommendation naming Rivermere Systems.', '2024-05-24', '', 'verified', ['elena', 'rivermere'], ['procurement'], [ref(0, 1)]],
    ['05', 'Purchase order signed', 'Harborline issued PO-0247 to Rivermere Systems for USD 486,000.', '2024-05-27', '', 'verified', ['priya', 'harborline', 'rivermere'], ['finance'], [ref(4, 1), ref(4, 2)]],
    ['06', 'Installation crew logged at depot', 'The depot gate recorded an installation crew escort. Finance dates the first installation to this day.', '2024-05-28', '', 'unverified', ['marcus', 'priya'], ['installation'], [ref(2, 3), ref(3, 1)]],
    ['07', 'Exception meeting reported', 'Finance described a meeting about an exception. The meeting date remains unknown.', '', '', 'unverified', ['priya', 'elena'], ['procurement'], [ref(3, 2)]],
  ].map(([id, title, body, date, end, status, entities, tags, refs]) => ({ id, kind: 'event', title, body, date, end, status, entities, tags, refs, origin: 'Manual' }));
  p.relationships = [
    ['r1', 'elena', 'harborline', 'Chairs procurement for', ref(5, 2)],
    ['r2', 'marcus', 'rivermere', 'Operations director at', ref(1, 0)],
    ['r3', 'harborline', 'rivermere', 'Issued purchase order to', ref(4, 1)],
    ['r4', 'priya', 'harborline', 'Finance controller for', ref(4, 2)],
    ['r5', 'nadia', 'harborline', 'Depot liaison for', ref(5, 2)],
  ].map(([id, from, to, label, source]) => ({ id, from, to, label, notes: '', refs: [source] }));
  p.issues = [
    { id: 'start-dispute', kind: 'Contradiction', title: 'When did physical installation start?', body: 'Vale dates physical installation to May 23. Shah dates it to May 28. The gate register records access purposes and cannot establish the work performed. Request work orders and crew time sheets.', refs: [ref(1, 1), ref(3, 1), ref(2, 2)], resolved: false },
    { id: 'scoring-gap', kind: 'Evidence gap', title: 'Bid scoring worksheet missing', body: 'Request the committee scoring worksheet and any version history.', refs: [ref(0, 3)], resolved: false },
  ];
  p.suggestions = [
    { id: 'suggest-1', mode: 'Extract facts', kind: 'fact', title: 'Survey-only entry on May 23', body: 'The depot register describes the purpose of the May 23 entry as measurement and survey only.', date: '2024-05-23', participants: ['Marcus Vale'], refs: [ref(2, 2)], state: 'pending', origin: 'Demo suggestion' },
    { id: 'suggest-2', mode: 'Extract facts', kind: 'fact', title: 'Authorization scope', body: 'The May 24 memo authorized the committee to recommend the vendor.', date: '2024-05-24', participants: ['Elena Park'], refs: [ref(0, 1)], state: 'pending', origin: 'Demo suggestion' },
  ];
  p.evidence[0].annotations = [{ id: 'annotation-scope', note: 'Scope of authorization', ref: ref(0, 1) }];
  p.activity = [
    { id: 'demo-a1', at: '2024-06-05T15:10:00.000Z', text: 'Flagged conflicting accounts of the installation start.' },
    { id: 'demo-a2', at: '2024-06-05T14:30:00.000Z', text: 'Linked PO-0247 to the purchase order event.' },
    { id: 'demo-a3', at: '2024-06-05T14:00:00.000Z', text: 'Imported six fictional procurement records.' },
  ];
  return p;
}
