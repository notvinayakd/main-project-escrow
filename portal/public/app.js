/* CTCCS portal front-end. Vanilla JS, no build step, no framework.
 *
 * Three audiences share one page, and the navigation changes to match who is signed in:
 *   public   — track a consignment, browse the register, read the API docs
 *   trader   — register consignments, amend them before lodgement, withdraw them
 *   officer  — a station work queue, and the actions that move a consignment
 *
 * The session token lives in a plain variable, never in localStorage: this page is opened
 * inside preview panes where browser storage is unreliable, and a bearer token has no
 * business outliving the tab.
 */

const API = '/ctccs/api/v2';
const AUTH = '/ctccs/auth';
const TRADER = '/ctccs/trader';
const OFFICER = '/ctccs/officer';

const state = {
  tab: 'track', token: null, actor: null,
  selectedId: null, record: null, movements: [], entries: [], amendments: [],
  recordActions: [],
  list: null, listQuery: { q: '', status: '', port: '', page: 1 },
  queue: null, report: null, formError: null, editing: false,
  // Live values of whatever form is on screen. The whole view is re-rendered as a string
  // on every state change, so without this a validation error would wipe everything the
  // user had typed -- 14 fields lost per mistake on the declaration form, and a silently
  // reset account picker on the sign-in form.
  form: {}
};

const LABELS = {
  booking_confirmed: 'Booking confirmed',
  documents_lodged: 'Documents lodged',
  dispatched: 'Dispatched',
  customs_cleared: 'Customs cleared',
  cancelled: 'Cancelled',
  held: 'Held'
};
const UNITS = ['MT', 'KG', 'TEU', 'CBM', 'PCS'];
const CURRENCIES = ['USD', 'EUR', 'INR', 'SGD', 'GBP', 'AED'];

/* ---------- helpers ---------- */

const $ = (s) => document.querySelector(s);
/** Current value for a form control: what the user last typed, else the supplied default. */
const val = (id, fallback = '') => (state.form[id] !== undefined ? state.form[id] : fallback);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Intl.NumberFormat throws a RangeError on an unrecognised currency code. With the
// testing switch on, a record can legitimately carry one, and an exception here would
// blank the whole screen -- so fall back to "<amount> <code>" rather than crash.
const money = (n, c = 'USD') => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);
  } catch (_) {
    return `${Number(n).toLocaleString('en-US')} ${esc(c)}`;
  }
};
const pill = (s) => `<span class="pill s-${esc(s)}">${esc(LABELS[s] || s)}</span>`;

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = ''; }, 3800);
}

// Records carry their own UTC offset (+05:30, +02:00). Render in that zone, so a Kochi
// dispatch reads as Kochi local time the way the paperwork would.
function fmtStamp(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/([+-]\d{2}):?(\d{2})$/);
  const d = new Date(iso);
  if (isNaN(d)) return esc(iso);
  if (!m) return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const off = (m[1][0] === '-' ? -1 : 1) * (parseInt(m[1].slice(1), 10) * 60 + parseInt(m[2], 10));
  const shifted = new Date(d.getTime() + (off + d.getTimezoneOffset()) * 60000);
  return shifted.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    + `<span class="tiny"> UTC${m[1]}:${m[2]}</span>`;
}

function highlight(obj) {
  return esc(JSON.stringify(obj, null, 2))
    .replace(/&quot;([^&]+?)&quot;:/g, '<span class="k">"$1"</span>:')
    .replace(/: &quot;(.*?)&quot;/g, ': <span class="s">"$1"</span>')
    .replace(/: (-?\d+\.?\d*)/g, ': <span class="n">$1</span>')
    .replace(/: (null|true|false)/g, ': <span class="null">$1</span>');
}

// Server errors name the field by its wire name ("lcRef"). Users read labels, not schema.
const FIELD_LABELS = {
  lcRef: 'LC reference', importerName: 'Importer / consignee', importerCountry: 'Importer country',
  vesselName: 'Vessel', vesselImo: 'IMO number', vesselVoyage: 'Voyage',
  originPort: 'Origin UN/LOCODE', originName: 'Origin port name',
  destinationPort: 'Destination UN/LOCODE', destinationName: 'Destination port name',
  commodityDescription: 'Commodity', hsCode: 'HS code',
  quantityValue: 'Quantity', quantityUnit: 'Unit',
  declaredAmount: 'Declared value', declaredCurrency: 'Currency',
  status: 'Action', remark: 'Remark', reason: 'Reason'
};

function humanise(message, field) {
  if (!field || !FIELD_LABELS[field]) return message;
  return message.replace(new RegExp(`"${field}"`, 'g'), `"${FIELD_LABELS[field]}"`);
}

/* The bearer token is kept in sessionStorage, not localStorage: it survives an accidental
   refresh mid-demo but dies with the tab, and it is never shared with another tab or
   another user of the machine. Every access is guarded -- some embedded browsers throw on
   storage access outright, and a portal that white-screens because storage is blocked
   would be worse than one that simply asks you to sign in again. */
const TOKEN_KEY = 'ctccs.token';

function saveToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch (_) { /* storage unavailable: the session simply won't survive a refresh */ }
}

function loadToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch (_) { return null; }
}

async function api(path, opts = {}) {
  const headers = { ...opts.headers };
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const res = await fetch(path, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // An expired or revoked session should drop us back to signed-out cleanly.
    if (res.status === 401 && state.token) { state.token = null; state.actor = null; saveToken(null); }
    const err = new Error(humanise(body.message || res.statusText, body.field));
    err.code = body.error;
    err.field = body.field;
    throw err;
  }
  return body;
}

/* ---------- navigation ---------- */

function tabsFor(actor) {
  const tabs = [{ key: 'track', label: 'Track' }, { key: 'register', label: 'All consignments' }];
  // Officers clear consignments; exporters file them. Registration is deliberately absent
  // from the officer's navigation -- an officer who could both create and advance a record
  // would defeat the separation of duties the whole system rests on.
  if (actor?.role === 'officer') tabs.push({ key: 'queue', label: 'Work queue' });
  if (actor?.role === 'trader') {
    tabs.push({ key: 'mine', label: 'My consignments' }, { key: 'new', label: 'New consignment' });
  }
  tabs.push({ key: 'api', label: 'Public API' }, { key: 'reports', label: 'Reports' });
  return tabs;
}

function renderNav() {
  $('#nav').innerHTML = tabsFor(state.actor)
    .map((t) => `<button data-tab="${t.key}" aria-current="${state.tab === t.key}">${esc(t.label)}</button>`).join('');
}

function renderWho() {
  const slot = $('#whoSlot');
  if (!state.actor) {
    slot.innerHTML = `<div class="who">Not signed in</div>
      <div><button class="linky" id="goSignIn">Sign in</button></div>`;
    return;
  }
  const a = state.actor;
  slot.innerHTML = a.role === 'officer'
    ? `<div class="who">Officer: ${esc(a.id)} — ${esc(a.name)}</div>
       <div>${esc(a.station)} (${esc(a.port)}) · <button class="linky" id="signOut">Sign out</button></div>`
    : `<div class="who">Exporter: ${esc(a.name)}</div>
       <div>${esc(a.id)} · <button class="linky" id="signOut">Sign out</button></div>`;
}

/* ---------- data ---------- */

async function loadRecord(id) {
  if (!id) return;
  state.selectedId = id;
  const [rec, mv, en, am] = await Promise.all([
    api(`${API}/consignment/${id}`),
    api(`${API}/consignment/${id}/movements`),
    api(`${API}/consignment/${id}/entries`),
    api(`${API}/consignment/${id}/amendments`)
  ]);
  state.record = rec; state.movements = mv.movements;
  state.entries = en.entries; state.amendments = am.amendments;
}

async function loadList() {
  const { q, status, port, page } = state.listQuery;
  const qs = new URLSearchParams({ page, pageSize: 10 });
  if (q) qs.set('q', q);
  if (status) qs.set('status', status);
  if (port) qs.set('port', port);
  state.list = await api(`${API}/consignments?${qs}`);
}

/* ---------- screen: track ---------- */

function screenTrack() {
  const r = state.record;
  return `
  <div class="panel">
    <h2>Track a consignment <span class="hint">public enquiry — no sign-in required</span></h2>
    <div class="panel-body">
      <form class="trackbar" id="trackForm">
        <div class="grow">
          <label class="f" for="ref">Consignment reference, bill of lading or LC reference</label>
          <input id="ref" placeholder="SHP-88214 · KOCH-88214 · LC-2026-0417"
                 value="${esc(val('ref', state.selectedId || ''))}" autocomplete="off">
        </div>
        <div class="tight"><button class="btn" type="submit">Track</button></div>
      </form>
      ${state.formError ? `<div class="err">${esc(state.formError)}</div>` : ''}
    </div>
  </div>
  ${r ? recordPanels(r) : `<div class="panel"><div class="empty">
      Enter a reference above, or browse everything from the <strong>All consignments</strong> tab.
    </div></div>`}`;
}

function recordPanels(r) {
  const rows = [
    ['Consignment', esc(r.consignmentId)],
    ['LC reference', esc(r.lcRef)],
    ['Status', pill(r.status) + ` <span class="std">code ${r.statusCode}</span>`],
    ['Bill of lading', r.billOfLading ? esc(r.billOfLading) : '<span class="std">not yet issued</span>'],
    ['Exporter', `${esc(r.exporter.name)}<div class="std">${esc(r.exporter.country)}</div>`],
    ['Importer', `${esc(r.importer.name)}<div class="std">${esc(r.importer.country)}</div>`],
    ['Vessel', `${esc(r.vessel.name)}<div class="std">IMO ${esc(r.vessel.imo)} · voyage ${esc(r.vessel.voyage)}</div>`],
    ['Origin', `${esc(r.origin.name)}<div class="std">UN/LOCODE ${esc(r.origin.port)}</div>`],
    ['Destination', `${esc(r.destination.name)}<div class="std">UN/LOCODE ${esc(r.destination.port)}</div>`],
    ['Commodity', `${esc(r.commodity.description)}<div class="std">HS ${esc(r.commodity.hsCode)}</div>`],
    ['Quantity', `${esc(r.quantity.value)} ${esc(r.quantity.unit)}`],
    ['Declared value', `${money(r.declaredValue.amount, r.declaredValue.currency)}<div class="std">${esc(r.declaredValue.currency)}</div>`],
    ['Customs entry', r.customsEntryNo ? esc(r.customsEntryNo) : '<span class="std">not yet filed</span>'],
    ['Status set by', esc(r.statusSetBy)],
    ['Status set at', fmtStamp(r.statusSetAt)],
    ['Record hash', `<span class="mono std">${esc(r.recordHash.slice(0, 24))}…</span>`]
  ];

  return `
  <div class="panel">
    <h2>Consignment ${esc(r.consignmentId)} — record detail <span class="hint">public record</span></h2>
    <div class="panel-body">
      <dl class="rec">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>
    </div>
  </div>
  ${actionPanel(r)}
  <div class="panel">
    <h2>Movement &amp; clearance history</h2>
    <div class="scroll"><table>
      <thead><tr><th>Timestamp</th><th>Status set</th><th>Location</th><th>Entered by</th><th>Remark</th></tr></thead>
      <tbody>${state.movements.map((m) => `<tr>
        <td>${fmtStamp(m.at)}</td><td>${pill(m.status)}</td>
        <td>${esc(m.loc)}</td><td>${esc(m.officer)}</td><td>${esc(m.remark || '—')}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>
  <div class="panel">
    <h2>Customs entries</h2>
    ${state.entries.length ? `<div class="scroll"><table>
      <thead><tr><th>Entry no.</th><th>Type</th><th>Office</th><th>Officer</th><th>Filed</th><th>Outcome</th></tr></thead>
      <tbody>${state.entries.map((e) => `<tr>
        <td class="mono">${esc(e.entryNo)}</td><td>${esc(e.type)}</td><td>${esc(e.office)}</td>
        <td>${esc(e.officer)}</td><td>${fmtStamp(e.filedAt)}</td><td>${esc(e.outcome)}</td>
      </tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">No entry declarations filed. An entry is created when clearance is recorded at the destination port.</div>`}
  </div>
  ${state.amendments.length ? `<div class="panel">
    <h2>Amendment history <span class="hint">declaration changes before lodgement</span></h2>
    <div class="scroll"><table>
      <thead><tr><th>When</th><th>By</th><th>Change</th><th>Reason</th></tr></thead>
      <tbody>${state.amendments.map((a) => `<tr>
        <td>${fmtStamp(a.at)}</td><td>${esc(a.by)}</td>
        <td class="diff">${Object.keys(a.after).map((k) =>
          `<div><span class="mono tiny">${esc(k)}</span> <del>${esc(a.before[k])}</del> <ins>${esc(a.after[k])}</ins></div>`).join('')}</td>
        <td>${esc(a.reason || '—')}</td></tr>`).join('')}</tbody>
    </table></div>
  </div>` : ''}
  <div class="panel">
    <h2>Public API response <span class="hint">this is the endpoint the notary records</span></h2>
    <div class="panel-body">
      <p class="epath"><span class="m">GET</span> <code>${API}/consignment/${esc(r.consignmentId)}</code> → 200 OK · application/json</p>
      <pre class="json">${highlight(r)}</pre>
    </div>
  </div>`;
}

/** Actions available to whoever is signed in, for the record on screen. */
function actionPanel(r) {
  if (!state.actor) {
    return `<div class="panel"><h2>Record a status change</h2><div class="panel-body">
      <div class="locked">Sign in as a customs officer to record a change, or as the exporter to amend or withdraw.</div>
    </div></div>`;
  }
  const a = state.actor;
  const acts = state.recordActions || [];
  const canAmend = a.role === 'trader' && r.status === 'booking_confirmed'
    && r.exporter.name === a.name;

  if (!acts.length && !canAmend) {
    return `<div class="panel"><h2>Available actions</h2><div class="panel-body">
      <div class="locked">Nothing to do on this consignment from your account${a.role === 'officer' ? ` at ${esc(a.port)}` : ''}.</div>
    </div></div>`;
  }

  // Explain a refusal before the server has to issue one.
  const warn = [];
  if (a.role === 'officer') {
    if (r.status === 'documents_lodged' && a.port !== r.origin.port)
      warn.push(`Dispatch must be recorded at ${r.origin.port}; you are at ${a.port}.`);
    if (r.status === 'dispatched' && a.port !== r.destination.port)
      warn.push(`Clearance must be recorded at ${r.destination.port}; you are at ${a.port}.`);
  }

  return `<div class="panel">
    <h2>Available actions <span class="hint">${esc(a.id)}</span></h2>
    <div class="panel-body">
      ${acts.length ? `<div class="row mb12">
        <div><label class="f" for="newStatus">Action</label>
          <select id="newStatus">${acts.map((s) => `<option value="${esc(s)}">${esc(LABELS[s] || s)}</option>`).join('')}</select></div>
        <div class="grow2"><label class="f" for="remark">Remark (appended to the public movement log)</label>
          <input id="remark" placeholder="e.g. MV Anjali Star departed berth 4"></div>
        <div class="tight"><button class="btn" id="submitStatus">Submit &amp; publish</button></div>
      </div>` : ''}
      ${canAmend ? `<div class="actions-row"><button class="btn ghost" id="amendBtn">Amend declaration</button></div>` : ''}
      ${warn.length ? `<div class="locked mt12">${warn.map(esc).join('<br>')}</div>` : ''}
    </div>
  </div>`;
}

/* ---------- screen: register (browse all) ---------- */

function screenRegister() {
  const l = state.list;
  return `
  <div class="panel">
    <h2>Consignment register <span class="hint">all records held by CTCCS</span></h2>
    <div class="panel-body">
      <form class="trackbar" id="searchForm">
        <div class="grow"><label class="f" for="q">Search</label>
          <input id="q" value="${esc(state.listQuery.q)}" placeholder="reference, exporter, commodity, HS code"></div>
        <div><label class="f" for="fstatus">Status</label>
          <select id="fstatus"><option value="">Any</option>
            ${Object.keys(LABELS).map((s) => `<option value="${s}" ${state.listQuery.status === s ? 'selected' : ''}>${LABELS[s]}</option>`).join('')}
          </select></div>
        <div><label class="f" for="fport">Port</label>
          <input id="fport" value="${esc(state.listQuery.port)}" placeholder="INCOK" maxlength="5"></div>
        <div class="tight"><button class="btn" type="submit">Search</button></div>
      </form>
    </div>
    ${l ? listTable(l) : '<div class="empty">Loading…</div>'}
  </div>`;
}

function listTable(l) {
  if (!l.consignments.length) return '<div class="empty">No consignments match those filters.</div>';
  return `<div class="scroll"><table>
    <thead><tr><th>Reference</th><th>Status</th><th>Exporter</th><th>Route</th><th>Commodity</th><th class="num">Declared value</th><th></th></tr></thead>
    <tbody>${l.consignments.map((c) => `<tr>
      <td class="mono">${esc(c.consignmentId)}<div class="tiny">${esc(c.lcRef)}</div></td>
      <td>${pill(c.status)}</td>
      <td>${esc(c.exporter.name)}</td>
      <td class="mono">${esc(c.origin.port)} → ${esc(c.destination.port)}</td>
      <td>${esc(c.commodity.description)}<div class="tiny">HS ${esc(c.commodity.hsCode)}</div></td>
      <td class="num">${money(c.declaredValue.amount, c.declaredValue.currency)}</td>
      <td><button class="linky" data-open="${esc(c.consignmentId)}">open</button></td>
    </tr>`).join('')}</tbody>
  </table></div>
  <div class="pager">
    <span class="muted">${l.total} record${l.total === 1 ? '' : 's'} · page ${l.page} of ${l.pageCount}</span>
    <button class="btn ghost" data-page="${l.page - 1}" ${l.page <= 1 ? 'disabled' : ''}>Previous</button>
    <button class="btn ghost" data-page="${l.page + 1}" ${l.page >= l.pageCount ? 'disabled' : ''}>Next</button>
  </div>`;
}

/* ---------- screen: officer work queue ---------- */

function screenQueue() {
  const q = state.queue;
  if (!q) return '<div class="panel"><div class="empty">Loading…</div></div>';
  return `<div class="panel">
    <h2>Work queue — ${esc(q.station.name)} (${esc(q.station.port)})
      <span class="hint">consignments awaiting action at your station</span></h2>
    ${q.consignments.length ? `<div class="scroll"><table>
      <thead><tr><th>Reference</th><th>Status</th><th>Exporter</th><th>Route</th><th>Waiting since</th><th>Next action</th></tr></thead>
      <tbody>${q.consignments.map((c) => `<tr>
        <td class="mono">${esc(c.consignmentId)}<div class="tiny">${esc(c.lcRef)}</div></td>
        <td>${pill(c.status)}</td>
        <td>${esc(c.exporter.name)}</td>
        <td class="mono">${esc(c.origin.port)} → ${esc(c.destination.port)}</td>
        <td>${fmtStamp(c.statusSetAt)}</td>
        <td><button class="linky" data-open="${esc(c.consignmentId)}">${esc(
          LABELS[c.actions.find((a) => a !== 'held' && a !== 'cancelled')] || 'open')}</button></td>
      </tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Nothing is waiting on your station. Cleared work leaves this queue.</div>'}
  </div>`;
}

/* ---------- screen: a trader's own book ---------- */

function screenMine() {
  const l = state.list;
  return `<div class="panel">
    <h2>My consignments <span class="hint">${esc(state.actor?.name || '')}</span></h2>
    ${l ? listTable(l) : '<div class="empty">Loading…</div>'}
  </div>`;
}

/* ---------- screen: register / amend a declaration ---------- */

function field(id, label, value = '', o = {}) {
  return `<div class="${o.full ? 'full' : ''}">
    <label class="f" for="${id}">${esc(label)}</label>
    <input id="${id}" type="${o.type || 'text'}" value="${esc(val(id, value))}" placeholder="${esc(o.placeholder || '')}">
    ${o.hint ? `<div class="tiny">${esc(o.hint)}</div>` : ''}
  </div>`;
}
function select(id, label, options, value) {
  const current = val(id, value);
  return `<div><label class="f" for="${id}">${esc(label)}</label>
    <select id="${id}">${options.map((o) => `<option ${o === current ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
}

function screenNew() {
  const editing = state.editing && state.record;
  const r = editing ? state.record : null;

  return `<div class="panel">
    <h2>${editing ? `Amend declaration — ${esc(r.consignmentId)}` : 'Register a new consignment'}
      <span class="hint">${editing ? 'permitted only before documents are lodged' : 'creates a record at status “booking confirmed”'}</span></h2>
    <div class="panel-body">
      <form id="declForm">
        <fieldset><legend>Commercial</legend><div class="formgrid">
          ${field('lcRef', 'LC reference', r?.lcRef || '', { placeholder: 'LC-2026-0417', hint: 'One LC backs one consignment.' })}
          ${field('importerName', 'Importer / consignee', r?.importer.name || '', { placeholder: 'Rotterdam Commodity BV' })}
          ${field('importerCountry', 'Importer country', r?.importer.country || '', { placeholder: 'NL', hint: 'ISO 3166 two-letter code' })}
        </div></fieldset>

        <fieldset><legend>Carriage</legend><div class="formgrid">
          ${field('vesselName', 'Vessel', r?.vessel.name || '', { placeholder: 'MV Anjali Star' })}
          ${field('vesselImo', 'IMO number', r?.vessel.imo || '', { placeholder: '9401235', hint: '7 digits' })}
          ${field('vesselVoyage', 'Voyage', r?.vessel.voyage || '', { placeholder: 'AS-118W' })}
          ${field('originPort', 'Origin UN/LOCODE', r?.origin.port || '', { placeholder: 'INCOK' })}
          ${field('originName', 'Origin port name', r?.origin.name || '', { placeholder: 'Kochi' })}
          ${field('destinationPort', 'Destination UN/LOCODE', r?.destination.port || '', { placeholder: 'NLRTM' })}
          ${field('destinationName', 'Destination port name', r?.destination.name || '', { placeholder: 'Rotterdam' })}
        </div></fieldset>

        <fieldset><legend>Goods</legend><div class="formgrid">
          ${field('commodityDescription', 'Commodity', r?.commodity.description || '', { placeholder: 'Black pepper' })}
          ${field('hsCode', 'HS code', r?.commodity.hsCode || '', { placeholder: '090411', hint: '6-digit Harmonised System subheading' })}
          ${field('quantityValue', 'Quantity', r?.quantity.value ?? '', { type: 'number', placeholder: '12' })}
          ${select('quantityUnit', 'Unit', UNITS, r?.quantity.unit || 'MT')}
          ${field('declaredAmount', 'Declared value', r?.declaredValue.amount ?? '', { type: 'number', placeholder: '74160' })}
          ${select('declaredCurrency', 'Currency', CURRENCIES, r?.declaredValue.currency || 'USD')}
        </div></fieldset>

        <fieldset><legend>Notes</legend><div class="formgrid">
          ${field(editing ? 'reason' : 'remark', editing ? 'Reason for amendment' : 'Remark', '',
            { full: true, placeholder: editing ? 'Revised packing list' : 'Consignment booked' })}
        </div></fieldset>

        ${state.formError ? `<div class="err">${esc(state.formError)}</div>` : ''}
        <div class="actions-row mt14">
          <button class="btn" type="submit">${editing ? 'Submit amendment' : 'Register consignment'}</button>
          ${editing ? '<button class="btn ghost" type="button" id="cancelEdit">Cancel</button>' : ''}
        </div>
      </form>
    </div>
  </div>`;
}

/* ---------- screen: public API ---------- */

function screenApi() {
  const id = state.selectedId || 'SHP-88214';
  const endpoints = [
    ['GET', `${API}/track?ref=${id}`, 'Track by consignment reference, bill of lading or LC reference.'],
    ['GET', `${API}/consignments`, 'Search and page the register. Filters: q, status, port.'],
    ['GET', `${API}/consignment/${id}`, '<strong>The attestation target.</strong> Full public record.'],
    ['GET', `${API}/consignment/${id}/movements`, 'Movement and clearance history.'],
    ['GET', `${API}/consignment/${id}/entries`, 'Customs entry declarations.'],
    ['GET', `${API}/consignment/${id}/amendments`, 'Declaration amendment trail.'],
    ['GET', `${API}/reports/summary`, 'Operational aggregates.'],
    ['GET', `${API}/reference/statuses`, 'Status vocabulary and codes.'],
    ['GET', '/healthz', 'Liveness check.']
  ];
  return `
  <div class="panel">
    <h2>Public API — v2 <span class="hint">reads require no authentication</span></h2>
    <div class="panel-body">
      <p class="muted mt0">Read endpoints are open by design. The attestation target
      must be fetchable without credentials — a key would otherwise travel inside the very TLS session
      being proven.</p>
      <div class="scroll"><table>
        <thead><tr><th>Method</th><th>Path</th><th>Returns</th><th></th></tr></thead>
        <tbody>${endpoints.map(([m, p, d]) => `<tr>
          <td class="mono"><strong>${m}</strong></td><td class="mono">${esc(p)}</td><td>${d}</td>
          <td><a href="${esc(p)}" target="_blank" rel="noopener">open</a></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
  </div>
  <div class="panel">
    <h2>Status vocabulary — frozen</h2>
    <div class="scroll"><table>
      <thead><tr><th>status</th><th class="num">statusCode</th><th>Recorded by</th><th>Escrow effect</th></tr></thead>
      <tbody>
        <tr><td class="mono">booking_confirmed</td><td class="num">1</td><td>exporter</td><td>—</td></tr>
        <tr><td class="mono">documents_lodged</td><td class="num">2</td><td>officer, origin port</td><td>—</td></tr>
        <tr><td class="mono">dispatched</td><td class="num">3</td><td>officer, origin port</td><td>advances escrow to <strong>Shipped</strong></td></tr>
        <tr><td class="mono">customs_cleared</td><td class="num">4</td><td>officer, destination port</td><td>advances escrow to <strong>Customs cleared</strong></td></tr>
        <tr><td class="mono">cancelled</td><td class="num">98</td><td>exporter or officer, before dispatch</td><td>escrow refunded</td></tr>
        <tr><td class="mono">held</td><td class="num">99</td><td>officer</td><td>off-flow; dispute branch</td></tr>
      </tbody>
    </table></div>
  </div>
  ${state.record ? `<div class="panel">
    <h2>Response schema</h2>
    <div class="panel-body">
      <p class="muted mt0">Field names, key order and status codes are a contract with the
      escrow verification code. Changing one invalidates every proof already generated.</p>
      <pre class="json">${highlight(state.record)}</pre>
    </div>
  </div>` : ''}`;
}

/* ---------- screen: reports ---------- */

function screenReports() {
  const r = state.report;
  if (!r) return '<div class="panel"><div class="empty">Loading…</div></div>';
  const tbl = (title, rows, head) => `<div class="panel"><h2>${title}</h2>
    <div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div></div>`;

  return `
  <div class="panel">
    <h2>Operational summary <span class="hint">all consignments on record</span></h2>
    <div class="panel-body"><div class="kpi">
      <div><div class="f">On record</div><div class="v">${r.totalConsignments}</div></div>
      <div><div class="f">In transit</div><div class="v">${r.inTransitCount}</div></div>
      <div><div class="f">Cleared</div><div class="v">${r.clearedCount}</div></div>
      <div><div class="f">Held</div><div class="v">${r.heldCount}</div></div>
      <div><div class="f">Cancelled</div><div class="v">${r.cancelledCount}</div></div>
      <div><div class="f">Declared value</div><div class="v">${money(r.declaredValueUsdTotal)}</div></div>
    </div></div>
  </div>
  ${tbl('By status',
    Object.entries(r.byStatus).map(([s, n]) => `<tr><td>${pill(s)}</td><td class="num">${n}</td></tr>`).join(''),
    '<th>Status</th><th class="num">Consignments</th>')}
  ${tbl('By route',
    r.byRoute.map((x) => `<tr><td class="mono">${esc(x.route)}</td><td class="num">${x.count}</td><td class="num">${money(x.declaredValueUsd)}</td></tr>`).join(''),
    '<th>Route</th><th class="num">Consignments</th><th class="num">Declared value</th>')}
  ${tbl('By exporter',
    r.byExporter.map((x) => `<tr><td>${esc(x.exporter)}</td><td class="num">${x.count}</td><td class="num">${money(x.declaredValueUsd)}</td></tr>`).join(''),
    '<th>Exporter</th><th class="num">Consignments</th><th class="num">Declared value</th>')}`;
}

/* ---------- screen: sign in ---------- */

function screenSignIn() {
  return `<div class="panel narrow">
    <h2>Sign in</h2>
    <div class="panel-body">
      <div class="mb12">
        <label class="f" for="accountId">Account</label>
        <select id="accountId"><option>Loading…</option></select>
      </div>
      <div class="mb14">
        <label class="f" for="pin">PIN</label>
        <input type="password" id="pin" autocomplete="off" placeholder="PIN" value="${esc(val('pin'))}">
      </div>
      ${state.formError ? `<div class="err mb10">${esc(state.formError)}</div>` : ''}
      <div class="actions-row">
        <button class="btn" id="doSignIn">Sign in</button>
        <button class="btn ghost" id="cancelSignIn">Cancel</button>
      </div>
      <p class="tiny mb0">
        Demo build: officers share one PIN and exporters share another, set by the OFFICER_PIN and
        TRADER_PIN environment variables. Dispatch may only be recorded at a consignment's origin
        port, clearance at its destination.
      </p>
    </div>
  </div>`;
}

async function fillAccounts() {
  const sel = $('#accountId');
  if (!sel) return;
  const d = await api(`${AUTH}/directory`);
  sel.innerHTML =
    `<optgroup label="Customs officers">${d.officers.map((o) =>
      `<option value="${esc(o.id)}">${esc(o.id)} — ${esc(o.name)}, ${esc(o.station)} (${esc(o.port)})</option>`).join('')}</optgroup>` +
    `<optgroup label="Registered exporters">${d.traders.map((t) =>
      `<option value="${esc(t.id)}">${esc(t.id)} — ${esc(t.name)}</option>`).join('')}</optgroup>`;
  // Options arrive after the render, so re-apply the chosen account. Without this a failed
  // PIN silently resets the picker to the first officer and the next attempt signs in as
  // the wrong account -- or fails again for no visible reason.
  if (state.form.accountId) sel.value = state.form.accountId;
  else state.form.accountId = sel.value;
}

/* ---------- render and routing ---------- */

const SCREENS = {
  signin: screenSignIn, track: screenTrack, register: screenRegister,
  queue: screenQueue, mine: screenMine, new: screenNew, api: screenApi, reports: screenReports
};

function render() {
  renderNav();
  renderWho();
  $('#view').innerHTML = (SCREENS[state.tab] || screenTrack)();
  if (state.tab === 'signin') fillAccounts();
}

/** Loads whatever the chosen tab needs, then renders. */
async function go(tab, { keepError = false } = {}) {
  // Moving to a different screen abandons whatever was half-typed on the last one.
  if (tab !== state.tab) state.form = {};
  state.tab = tab;
  if (!keepError) state.formError = null;
  try {
    if (tab === 'register') { state.listQuery.page = 1; await loadList(); }
    if (tab === 'mine') state.list = await api(`${TRADER}/consignments?pageSize=10`);
    if (tab === 'queue') state.queue = await api(`${OFFICER}/queue?pageSize=25`);
    if (tab === 'reports') state.report = await api(`${API}/reports/summary`);
    if (tab === 'track' && state.selectedId && !state.record) await loadRecord(state.selectedId);
  } catch (err) {
    toast(err.message, true);
  }
  render();
}

/** Opens one consignment and works out what the signed-in actor may do to it. */
async function openRecord(id) {
  try {
    await loadRecord(id);
    state.recordActions = [];
    if (state.actor?.role === 'officer') {
      state.recordActions = (await api(`${OFFICER}/consignment/${id}/actions`)).actions;
    } else if (state.actor?.role === 'trader' && state.record.exporter.name === state.actor.name) {
      // A trader's only status action is withdrawal, and only before dispatch.
      state.recordActions = ['booking_confirmed', 'documents_lodged'].includes(state.record.status)
        ? ['cancelled'] : [];
    }
    state.editing = false;
    state.tab = 'track';
    render();
  } catch (err) { toast(err.message, true); }
}

function readForm(ids) {
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && String(el.value).trim() !== '') out[id] = el.value.trim();
  }
  return out;
}

const DECL_FIELDS = ['lcRef', 'importerName', 'importerCountry', 'vesselName', 'vesselImo',
  'vesselVoyage', 'originPort', 'originName', 'destinationPort', 'destinationName',
  'commodityDescription', 'hsCode', 'quantityValue', 'quantityUnit', 'declaredAmount',
  'declaredCurrency', 'remark', 'reason'];

/* ---------- events ---------- */

// One listener captures every form control's current value, so a re-render can restore it.
for (const evt of ['input', 'change']) {
  document.addEventListener(evt, (e) => {
    if (e.target.id && 'value' in e.target) state.form[e.target.id] = e.target.value;
  });
}

document.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (e.target.id === 'trackForm') {
    const ref = $('#ref').value.trim();
    if (!ref) return;
    try {
      const rec = await api(`${API}/track?ref=${encodeURIComponent(ref)}`);
      await openRecord(rec.consignmentId);
    } catch (err) { state.formError = err.message; state.record = null; render(); }
    return;
  }

  if (e.target.id === 'searchForm') {
    state.listQuery = {
      q: $('#q').value.trim(),
      status: $('#fstatus').value,
      port: $('#fport').value.trim().toUpperCase(),
      page: 1
    };
    try { await loadList(); render(); } catch (err) { toast(err.message, true); }
    return;
  }

  if (e.target.id === 'declForm') {
    const body = readForm(DECL_FIELDS);
    if (body.quantityValue) body.quantityValue = Number(body.quantityValue);
    if (body.declaredAmount) body.declaredAmount = Number(body.declaredAmount);
    try {
      if (state.editing) {
        const updated = await api(`${TRADER}/consignment/${state.record.consignmentId}`,
          { method: 'PATCH', body: JSON.stringify(body) });
        state.form = {};
        toast(`${updated.consignmentId} amended.`);
        await openRecord(updated.consignmentId);
      } else {
        const created = await api(`${TRADER}/consignments`, { method: 'POST', body: JSON.stringify(body) });
        state.form = {};
        toast(`${created.consignmentId} registered.`);
        await openRecord(created.consignmentId);
      }
    } catch (err) { state.formError = err.message; render(); }
  }
});

document.addEventListener('click', async (e) => {
  const t = e.target;

  const tabBtn = t.closest('nav button[data-tab]');
  if (tabBtn) { state.editing = false; return go(tabBtn.dataset.tab); }

  if (t.id === 'goSignIn') { state.formError = null; state.tab = 'signin'; return render(); }
  if (t.id === 'cancelSignIn') return go('track');
  if (t.id === 'cancelEdit') { state.editing = false; state.form = {}; return openRecord(state.record.consignmentId); }

  if (t.id === 'signOut') {
    try { await api(`${AUTH}/session`, { method: 'DELETE' }); } catch (_) {}
    state.token = null; state.actor = null; state.recordActions = []; state.form = {};
    saveToken(null);
    toast('Signed out.');
    return go('track');
  }

  if (t.id === 'doSignIn') {
    try {
      const d = await api(`${AUTH}/session`, {
        method: 'POST',
        body: JSON.stringify({ accountId: $('#accountId').value, pin: $('#pin').value })
      });
      state.token = d.token; state.actor = d.actor; state.formError = null;
      state.form = {};
      saveToken(d.token);
      toast(`Signed in as ${d.actor.id}.`);
      return go(d.actor.role === 'officer' ? 'queue' : 'mine');
    } catch (err) {
      state.formError = err.message;
      delete state.form.pin;            // clear the PIN, keep the chosen account
      render();
    }
    return;
  }

  if (t.dataset.open) return openRecord(t.dataset.open);

  if (t.dataset.page) {
    state.listQuery.page = Number(t.dataset.page);
    try { await loadList(); render(); } catch (err) { toast(err.message, true); }
    return;
  }

  if (t.id === 'amendBtn') {
    state.editing = true; state.tab = 'new'; state.formError = null;
    state.form = {};                    // pre-fill from the record, not from earlier typing
    return render();
  }

  if (t.id === 'submitStatus') {
    const status = $('#newStatus').value;
    const remark = $('#remark').value.trim();
    t.disabled = true;
    try {
      // Withdrawal is a trader route; every other status change is an officer route.
      const traderWithdrawal = status === 'cancelled' && state.actor.role === 'trader';
      const path = traderWithdrawal
        ? `${TRADER}/consignment/${state.selectedId}/withdraw`
        : `${OFFICER}/consignment/${state.selectedId}/status`;
      const body = traderWithdrawal ? { remark } : { status, remark };
      const rec = await api(path, { method: 'POST', body: JSON.stringify(body) });
      state.form = {};          // don't leave the last remark sitting in the box
      toast(`${rec.consignmentId} recorded as ${LABELS[rec.status] || rec.status}.`);
      await openRecord(rec.consignmentId);
    } catch (err) { toast(err.message, true); t.disabled = false; }
  }
});

/* ---------- boot ---------- */

const deep = location.pathname.match(/\/ctccs\/consignment\/([A-Za-z0-9-]+)/);
if (deep) state.selectedId = deep[1].toUpperCase();

/** Restore a session from a previous page load, if the server still honours the token. */
(async () => {
  const token = loadToken();
  if (token) {
    state.token = token;
    try {
      state.actor = (await api(`${AUTH}/session`)).actor;
    } catch (_) {
      state.token = null; state.actor = null; saveToken(null);   // expired or revoked
    }
  }
  await go('track');
  if (state.selectedId) await openRecord(state.selectedId);
})();
