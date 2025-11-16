import React, { useEffect, useMemo, useState } from 'react';

// ---- Helpers to render audit diffs in plain language ----
function parseLocalDateTime(v) {
  if (!v && v !== 0) return null;
  if (v instanceof Date) return v;
  const s = String(v);
  // If already ISO with timezone, let Date parse it
  if (/Z|[+-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  // Match "YYYY-MM-DD HH:mm[:ss]"
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, Y, Mo, Da, H, Mi, S] = m;
    return new Date(+Y, +Mo - 1, +Da, +H, +Mi, +(S || 0), 0);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function fmtShortDateTime(v) {
  const d = parseLocalDateTime(v);
  if (!d) return String(v ?? '');
  const dateText = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  const timeText = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return `${dateText}, ${timeText}`;
}
function prettyValue(key, val) {
  if (val === null || val === undefined) return '';
  const k = String(key).toLowerCase();
  if (k.endsWith('_at') || k.endsWith('_ts') || k === 'when' || k === 'when_ts' || k === 'starts_at' || k === 'ends_at') {
    return fmtShortDateTime(val);
  }
  if (k.includes('phone')) {
    const s = String(val).replace(/[^0-9+]/g, '');
    return s.replace(/(\+?\d{1,3})?(\d{3})(\d{3})(\d{4})/, (_m, cc, a, b, c) => [cc || '', a, b, c].filter(Boolean).join(' ')) || String(val);
  }
  return String(val);
}
const MEETING_LABELS = {
  when_ts: 'Meeting time',
  starts_at: 'Start time',
  ends_at: 'End time',
  location: 'Location',
  person_name: 'Contact name',
  contact_phone: 'Phone',
  notes: 'Notes',
  assigned_to: 'Assigned to',
  assigned_to_user_id: 'Assigned to (user)',
  created_by: 'Created by',
  created_by_user_id: 'Created by (user)',
  status: 'Status',
  client_name: 'Client name'
};
const REMINDER_LABELS = {
  due_ts: 'Reminder time',
  type: 'Type',
  status: 'Status',
  title: 'Title',
  receiver_email: 'Email',
  recipient_email: 'Email',
  person_name: 'Person name',
  phone: 'Phone',
  notes: 'Notes',
  assigned_to: 'Assigned to',
  assigned_to_user_id: 'Assigned to (user)',
  created_by: 'Created by',
  created_by_user_id: 'Created by (user)'
};
function toPlainChangeLines(diff, labelsMap) {
  const keys = Object.keys(diff || {});
  const lines = [];
  for (const k of keys) {
    const label = labelsMap[k] || k;
    const from = diff[k] && ('from' in diff[k]) ? diff[k].from : undefined;
    const to = diff[k] && ('to' in diff[k]) ? diff[k].to : undefined;
    const fromText = prettyValue(k, from);
    const toText = prettyValue(k, to);
    if (from !== undefined && (to === undefined || to === null || to === '')) {
      lines.push(`${label} removed (was ${fromText || 'empty'})`);
    } else if ((from === undefined || from === null || from === '') && to !== undefined) {
      lines.push(`${label} set to ${toText || 'empty'}`);
    } else if (fromText !== toText) {
      lines.push(`${label} changed: ${fromText || 'empty'} → ${toText || 'empty'}`);
    }
  }
  return lines;
}

function History() {
  const [filters, setFilters] = useState({
    q: '',
    entityType: { opportunity: true, contract: true, customer: true },
    dateFrom: '',
    dateTo: ''
  });
  const [activeTab, setActiveTab] = useState('stage'); // 'stage' | 'expenses' | 'passwords' | 'meetings_v2' | 'reminders_v2' | 'reminders_email'
  // Password audit state
  const [pwdItems, setPwdItems] = useState([]);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState(null);
  const [pwdPage, setPwdPage] = useState(1);
  const [pwdPageSize, setPwdPageSize] = useState(25);
  const [pwdTarget, setPwdTarget] = useState('');
  const [pwdActor, setPwdActor] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  // Expense audit state
  const [expItems, setExpItems] = useState([]);
  const [expLoading, setExpLoading] = useState(false);
  const [expError, setExpError] = useState(null);
  const [expPage, setExpPage] = useState(1);
  const [expPageSize, setExpPageSize] = useState(25);
  const [expAction, setExpAction] = useState('');
  // Fallback map: opportunity_id -> client_name
  const [oppMap, setOppMap] = useState({});
  // Meetings audit v2 state
  const [maMeetingId, setMaMeetingId] = useState('');
  const [maItems, setMaItems] = useState([]);
  const [maLoading, setMaLoading] = useState(false);
  const [maError, setMaError] = useState(null);
  const [maExpanded, setMaExpanded] = useState({}); // idx -> boolean
  const [maPage, setMaPage] = useState(1);
  const [maPageSize, setMaPageSize] = useState(50);
  // Reminders audit v2 state
  const [raReminderId, setRaReminderId] = useState('');
  const [raAction, setRaAction] = useState('');
  const [raItems, setRaItems] = useState([]);
  const [raLoading, setRaLoading] = useState(false);
  const [raError, setRaError] = useState(null);
  const [raExpanded, setRaExpanded] = useState({});
  const [raPage, setRaPage] = useState(1);
  const [raPageSize, setRaPageSize] = useState(50);
  // Reminders Email Selected audit state
  const [reOperationId, setReOperationId] = useState('');
  const [reReminderId, setReReminderId] = useState('');
  const [reStatus, setReStatus] = useState(''); // '', 'SENT', 'FAILED'
  const [reItems, setReItems] = useState([]);
  const [reLoading, setReLoading] = useState(false);
  const [reError, setReError] = useState(null);
  const [reExpanded, setReExpanded] = useState({});
  const [rePage, setRePage] = useState(1);
  const [rePageSize, setRePageSize] = useState(50);

  const entityParam = useMemo(() => {
    const enabled = Object.entries(filters.entityType).filter(([,v]) => v).map(([k]) => k);
    return enabled.length === 3 ? undefined : enabled.join(',');
  }, [filters.entityType]);

  async function fetchHistory(p = page, s = pageSize) {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
  if (filters.q) params.append('q', filters.q);
    if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.append('dateTo', filters.dateTo);
    if (entityParam) params.append('entityType', entityParam);
    params.append('page', String(p));
    params.append('pageSize', String(s));
    try {
      const res = await fetch(`/api/history?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch history');
      const data = await res.json();
      setItems(data.items || []);
      setPage(p);
      setPageSize(s);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchHistory(1, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dynamic search/filtering with small debounce (Stage History)
  useEffect(() => {
    if (activeTab !== 'stage') return;
    const t = setTimeout(() => { fetchHistory(1, pageSize); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.dateFrom, filters.dateTo, filters.entityType, activeTab]);

  // When switching to Expense tab, auto-load data
  useEffect(() => {
    if (activeTab === 'expenses') {
      fetchExpenseAudit(1, expPageSize);
      // Also fetch opportunities to map client names as a fallback
      fetch('/api/opportunities?page=1&pageSize=500&sort=client_name_asc')
        .then(async r => {
          if (!r.ok) return { items: [] };
          const data = await r.json();
          return Array.isArray(data) ? { items: data } : data;
        })
        .then(payload => {
          const m = {};
          const list = payload.items || [];
          list.forEach(o => {
            if (o && o.opportunity_id) m[o.opportunity_id] = { name: o.client_name || '', assignment: o.assignment || 'CUSTOMER' };
          });
          setOppMap(m);
        })
        .catch(() => {});
    }
    if (activeTab === 'meetings_v2') {
      // default: load all when no input
      fetchMeetingsAuditV2(maMeetingId.trim(), 1, maPageSize);
    }
    if (activeTab === 'reminders_v2') {
      fetchRemindersAuditV2(raReminderId.trim(), raAction, 1, raPageSize);
    }
    if (activeTab === 'reminders_email') {
      fetchRemindersEmailSelected(reOperationId.trim(), reReminderId.trim(), reStatus, 1, rePageSize);
    }
    if (activeTab === 'passwords') {
      fetchPasswordAudit(1, pwdPageSize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Dynamic filters for Expense Audit
  useEffect(() => {
    if (activeTab !== 'expenses') return;
    const t = setTimeout(() => { fetchExpenseAudit(1, expPageSize); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.dateFrom, filters.dateTo, expAction, activeTab]);

  // Dynamic fetch for Meetings v2 when id changes
  useEffect(() => {
    if (activeTab !== 'meetings_v2') return;
    const t = setTimeout(() => {
      fetchMeetingsAuditV2(maMeetingId.trim(), 1, maPageSize);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maMeetingId, maPageSize, activeTab]);

  // Dynamic fetch for Reminders v2 when filters change
  useEffect(() => {
    if (activeTab !== 'reminders_v2') return;
    const t = setTimeout(() => {
      fetchRemindersAuditV2(raReminderId.trim(), raAction, 1, raPageSize);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raReminderId, raAction, raPageSize, filters.dateFrom, filters.dateTo, activeTab]);

  // Dynamic fetch for Reminders Email Selected when filters change
  useEffect(() => {
    if (activeTab !== 'reminders_email') return;
    const t = setTimeout(() => {
      fetchRemindersEmailSelected(reOperationId.trim(), reReminderId.trim(), reStatus, 1, rePageSize);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reOperationId, reReminderId, reStatus, rePageSize, filters.dateFrom, filters.dateTo, activeTab]);

  // Dynamic filters for Password Audit
  useEffect(() => {
    if (activeTab !== 'passwords') return;
    const t = setTimeout(() => { fetchPasswordAudit(1, pwdPageSize); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.dateFrom, filters.dateTo, pwdTarget, pwdActor, activeTab]);

  // Expenses audit fetcher
  async function fetchExpenseAudit(p = expPage, s = expPageSize) {
    setExpLoading(true);
    setExpError(null);
    const params = new URLSearchParams();
  if (filters.q) params.append('q', filters.q);
    if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.append('dateTo', filters.dateTo);
    if (expAction) params.append('action', expAction);
    params.append('page', String(p));
    params.append('pageSize', String(s));
    try {
      const res = await fetch(`/api/expenses-audit?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch expense audit');
      const data = await res.json();
      setExpItems(data.items || []);
      setExpPage(p);
      setExpPageSize(s);
    } catch (err) {
      setExpError(err.message);
    } finally {
      setExpLoading(false);
    }
  }

  async function fetchPasswordAudit(p = pwdPage, s = pwdPageSize) {
    setPwdLoading(true);
    setPwdError(null);
    const params = new URLSearchParams();
    if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.append('dateTo', filters.dateTo);
    if (pwdTarget) params.append('target', pwdTarget);
    if (pwdActor) params.append('actor', pwdActor);
    params.append('page', String(p));
    params.append('pageSize', String(s));
    try {
      const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const res = await fetch(`/api/password-audit?${params.toString()}`, { headers });
      if (!res.ok) {
        let msg = 'Failed to fetch password audit';
        try { const t = await res.json(); if (t?.error) msg = t.error; } catch {}
        throw new Error(msg);
      }
      const data = await res.json();
      setPwdItems(data.items || []);
      setPwdPage(p);
      setPwdPageSize(s);
    } catch (err) {
      setPwdError(err.message);
    } finally {
      setPwdLoading(false);
    }
  }

  async function fetchMeetingsAuditV2(meetingId, p = maPage, s = maPageSize) {
    setMaLoading(true);
    setMaError(null);
    try {
      const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const params = new URLSearchParams();
      if (meetingId) params.append('meetingId', meetingId);
      if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.append('dateTo', filters.dateTo);
      params.append('page', String(p));
      params.append('pageSize', String(s));
      const res = await fetch(`/api/meetings-audit-v2?${params.toString()}`, { headers });
      if (!res.ok) {
        let msg = 'Failed to fetch meetings audit';
        try { const t = await res.json(); if (t?.error) msg = t.error; } catch {}
        throw new Error(msg);
      }
      const data = await res.json();
      setMaItems(Array.isArray(data.items) ? data.items : []);
      setMaPage(p);
      setMaPageSize(s);
    } catch (err) {
      setMaError(err.message);
    } finally {
      setMaLoading(false);
    }
  }

  async function fetchRemindersAuditV2(reminderId, action, p = raPage, s = raPageSize) {
    setRaLoading(true);
    setRaError(null);
    try {
      const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const params = new URLSearchParams();
      if (reminderId) params.append('reminderId', reminderId);
      if (action) params.append('action', action);
      if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.append('dateTo', filters.dateTo);
      params.append('page', String(p));
      params.append('pageSize', String(s));
      const res = await fetch(`/api/reminders-audit-v2?${params.toString()}`, { headers });
      if (!res.ok) {
        let msg = 'Failed to fetch reminders audit';
        try { const t = await res.json(); if (t?.error) msg = t.error; } catch {}
        throw new Error(msg);
      }
      const data = await res.json();
      setRaItems(Array.isArray(data.items) ? data.items : []);
      setRaPage(p);
      setRaPageSize(s);
    } catch (err) {
      setRaError(err.message);
    } finally {
      setRaLoading(false);
    }
  }

  async function fetchRemindersEmailSelected(operationId, reminderId, status, p = rePage, s = rePageSize) {
    setReLoading(true);
    setReError(null);
    try {
      const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const params = new URLSearchParams();
      if (operationId) params.append('operationId', operationId);
      if (reminderId) params.append('reminderId', reminderId);
      if (status) params.append('status', status);
      if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.append('dateTo', filters.dateTo);
      params.append('page', String(p));
      params.append('pageSize', String(s));
      const res = await fetch(`/api/reminders-email-selected-audit?${params.toString()}`, { headers });
      if (!res.ok) {
        let msg = 'Failed to fetch reminders email audit';
        try { const t = await res.json(); if (t?.error) msg = t.error; } catch {}
        throw new Error(msg);
      }
      const data = await res.json();
      setReItems(Array.isArray(data.items) ? data.items : []);
      setRePage(p);
      setRePageSize(s);
    } catch (err) {
      setReError(err.message);
    } finally {
      setReLoading(false);
    }
  }

  function exportCSV() {
    if (!items.length) return;
    const headers = ['Opportunity ID', 'Client Name', 'Entity', 'From', 'To', 'Reason Code', 'Reason Text', 'Changed By', 'Action Time'];
    const rows = items.map(i => [
      i.opportunity_id || '',
      i.client_name || '',
      i.entity_type,
      i.from_value,
      i.to_value,
      i.reason_code || '',
      i.reason_text || '',
      i.changed_by || '',
      i.changed_at
    ]);
    const csvContent = [
      ['CRM History'],
      headers,
      ...rows
    ].map(r => Array.isArray(r) ? r.map(x => `"${String(x ?? '').replace(/"/g,'""')}"`).join(',') : r).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'history.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function printTable() {
    const printContents = document.getElementById('historyTable').outerHTML;
    const win = window.open('', '', 'height=700,width=1000');
    win.document.write('<html><head><title>History</title>');
    win.document.write('<style>table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left;}th{background:#f5f5f5;} .brand{display:flex;align-items:center;gap:10px;margin:8px 0 12px;} .brand img{border-radius:50%;object-fit:cover}</style>');
    win.document.write('</head><body>');
    win.document.write('<div class="brand"><img src="/assets/branding/logo.png" alt="Logo" width="36" height="36"/><div style="font-weight:800">Sreenidhi CRM — Stage History</div></div>');
    win.document.write(printContents);
    win.document.write('</body></html>');
    win.document.close();
    win.print();
  }

  // Assignment markers (reuseable small icons)
  const CustomerIcon = ({ size = 32 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="#111" opacity="0.08" />
      <circle cx="12" cy="10" r="3.3" fill="#111" />
      <path d="M5.5 18.4c1.7-3 4-4.4 6.5-4.4s4.8 1.4 6.5 4.4" fill="none" stroke="#111" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
  const ContractIcon = ({ size = 32 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <rect x="5" y="3" width="11" height="18" rx="2" ry="2" fill="#111" opacity="0.08" stroke="#111" />
      <path d="M8 7h6M8 10h6M8 13h4" stroke="#111" strokeWidth="2" strokeLinecap="round" />
      <path d="M14.5 15.5l3.8 3.8-2.8.7.7-2.8-1.7-1.7z" fill="#111" />
    </svg>
  );

  return (
    <div>
      <div className="card" style={{position:'relative'}}>
        <h3 style={{marginTop:0}}>History Filters</h3>
        <div style={{marginBottom:12}}>
          <button className={activeTab==='stage'?'btn':'btn ghost'} type="button" onClick={() => setActiveTab('stage')}>Stage History</button>
          <button className={activeTab==='expenses'?'btn':'btn ghost'} type="button" style={{marginLeft:8}} onClick={() => setActiveTab('expenses')}>Expense Audit</button>
          <button className={activeTab==='meetings_v2'?'btn':'btn ghost'} type="button" style={{marginLeft:8}} onClick={() => setActiveTab('meetings_v2')}>Meetings Audit (v2)</button>
          <button className={activeTab==='passwords'?'btn':'btn ghost'} type="button" style={{marginLeft:8}} onClick={() => setActiveTab('passwords')}>Password Audit</button>
          <button className={activeTab==='reminders_v2'?'btn':'btn ghost'} type="button" style={{marginLeft:8}} onClick={() => setActiveTab('reminders_v2')}>Reminders Audit (v2)</button>
          <button className={activeTab==='reminders_email'?'btn':'btn ghost'} type="button" style={{marginLeft:8}} onClick={() => setActiveTab('reminders_email')}>Reminders Email Selected</button>
        </div>
        <div className="grid cols-4">
          <div className="row" style={{gridColumn:'1/-1'}}>
            <label className="block">Search</label>
            <input value={filters.q} onChange={e => setFilters(f => ({...f, q: e.target.value}))} placeholder="Search by Opportunity ID, Client Name, Customer ID, Contract ID" />
          </div>
          <div className="row">
            <label className="block">From</label>
            <input type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({...f, dateFrom: e.target.value}))} />
          </div>
          <div className="row">
            <label className="block">To</label>
            <input type="date" value={filters.dateTo} onChange={e => setFilters(f => ({...f, dateTo: e.target.value}))} />
          </div>
          {activeTab === 'stage' && (
            <>
              <div className="row" style={{gridColumn:'1/-1'}}>
                <label className="block">Entity Types</label>
                <div style={{display:'flex',gap:12}}>
                  {['opportunity','contract','customer'].map(t => (
                    <label key={t} style={{display:'inline-flex',alignItems:'center',gap:8}}>
                      <input type="checkbox" checked={filters.entityType[t]} onChange={e => setFilters(f => ({...f, entityType: {...f.entityType, [t]: e.target.checked}}))} />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
              <div className="row" style={{gridColumn:'1/-1'}}>
                <button className="btn" type="button" style={{marginRight:8, background:'#eee', color:'#222'}} onClick={exportCSV}>Export CSV</button>
                <button className="btn" type="button" style={{background:'#eee', color:'#222'}} onClick={printTable}>Print / PDF</button>
              </div>
            </>
          )}
          {activeTab === 'expenses' && (
            <>
            <div className="row">
              <label className="block">Action</label>
              <select value={expAction} onChange={e => setExpAction(e.target.value)}>
                <option value="">All</option>
                <option value="CREATE">CREATE</option>
                <option value="UPDATE">UPDATE</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
            <div className="row" style={{gridColumn:'1/-1'}}>
              <button className="btn" type="button" style={{marginLeft:0, background:'#eee', color:'#222'}} onClick={() => {
                if (!expItems.length) return;
                const headers = ['Opportunity ID','Client Name','Action','Old Amount','New Amount','Old Note','New Note','Performed By','Performed At'];
                const rows = expItems.map(i => [i.opportunity_id, i.client_name || oppMap[i.opportunity_id] || '', i.action, i.old_amount ?? '', i.new_amount ?? '', i.old_note ?? '', i.new_note ?? '', i.performed_by ?? '', i.performed_at]);
                const csvContent = [ ['Expense Audit'], headers, ...rows ].map(r => Array.isArray(r) ? r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',') : r).join('\n');
                const blob = new Blob([csvContent], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'expense_audit.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
              }}>Export CSV</button>
              <button className="btn" type="button" style={{marginLeft:8, background:'#eee', color:'#222'}} onClick={() => {
                const html = document.getElementById('expenseAuditTable').outerHTML;
                const win = window.open('', '', 'height=700,width=1000');
                win.document.write('<html><head><title>Expense Audit</title>');
                win.document.write('<style>table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left;}th{background:#f5f5f5;} .brand{display:flex;align-items:center;gap:10px;margin:8px 0 12px;} .brand img{border-radius:50%;object-fit:cover}</style>');
                win.document.write('</head><body>');
                win.document.write('<div class="brand"><img src="/assets/branding/logo.png" alt="Logo" width="36" height="36"/><div style="font-weight:800">Sreenidhi CRM — Expense Audit</div></div>');
                win.document.write(html);
                win.document.write('</body></html>');
                win.document.close();
                win.print();
              }}>Print / PDF</button>
            </div>
            </>
          )}
          {activeTab === 'passwords' && (
            <>
              <div className="row">
                <label className="block">Target (email/username/name)</label>
                <input value={pwdTarget} onChange={e => setPwdTarget(e.target.value)} />
              </div>
              <div className="row">
                <label className="block">Actor (who changed)</label>
                <input value={pwdActor} onChange={e => setPwdActor(e.target.value)} />
              </div>
              <div className="row" style={{gridColumn:'1/-1'}} />
            </>
          )}
          {activeTab === 'meetings_v2' && (
            <>
              <div className="row" style={{gridColumn:'1/-1'}}>
                <label className="block">Meeting ID</label>
                <input value={maMeetingId} onChange={e => setMaMeetingId(e.target.value)} placeholder="Enter meeting ID (e.g., ABCD1234)" />
                <div className="muted" style={{marginTop:4,fontSize:12}}>Enter a Meeting ID to load its change history (JSON diff + snapshot).</div>
              </div>
            </>
          )}
          {activeTab === 'reminders_v2' && (
            <>
              <div className="row">
                <label className="block">Reminder ID</label>
                <input value={raReminderId} onChange={e => setRaReminderId(e.target.value)} placeholder="Enter reminder ID (optional)" />
              </div>
              <div className="row">
                <label className="block">Action</label>
                <select value={raAction} onChange={e => setRaAction(e.target.value)}>
                  <option value="">All</option>
                  <option value="CREATE">CREATE</option>
                  <option value="UPDATE">UPDATE</option>
                  <option value="STATUS">STATUS</option>
                </select>
              </div>
              <div className="row" style={{gridColumn:'1/-1'}} />
            </>
          )}
          {activeTab === 'reminders_email' && (
            <>
              <div className="row">
                <label className="block">Operation ID</label>
                <input value={reOperationId} onChange={e => setReOperationId(e.target.value)} placeholder="Filter by operation ID (optional)" />
              </div>
              <div className="row">
                <label className="block">Reminder ID</label>
                <input value={reReminderId} onChange={e => setReReminderId(e.target.value)} placeholder="Filter by reminder ID (optional)" />
              </div>
              <div className="row">
                <label className="block">Status</label>
                <select value={reStatus} onChange={e => setReStatus(e.target.value)}>
                  <option value="">All</option>
                  <option value="SENT">SENT</option>
                  <option value="FAILED">FAILED</option>
                </select>
              </div>
              <div className="row" style={{gridColumn:'1/-1'}} />
            </>
          )}
        </div>
      </div>

      {activeTab === 'stage' && (
      <div className="card" style={{marginTop:24}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <h3 style={{margin:0}}>Stage History</h3>
          <div style={{display:'flex',gap:16,alignItems:'center'}}>
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
              {[25,50,100].map(n => <option key={n} value={n}>{n}/page</option>)}
            </select>
            <div>
              <button className="btn" type="button" style={{background:'#eee',color:'#222',marginRight:8}} onClick={() => fetchHistory(Math.max(page-1,1), pageSize)}>Prev</button>
              <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={() => fetchHistory(page+1, pageSize)}>Next</button>
            </div>
          </div>
        </div>
        {loading && <div style={{padding:'8px'}}>Loading history...</div>}
        {error && <div style={{color:'red',padding:'8px'}}>{error}</div>}
        <table id="historyTable">
          <thead>
            <tr>
              <th>Client Name</th>
              <th>Opportunity ID</th>
              <th>Entity</th>
              <th>From</th>
              <th>To</th>
              <th>Reason Code</th>
              <th>Reason Text</th>
              <th>Changed By</th>
              <th>Action Time</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={9} className="muted">No history</td></tr>
            ) : (
              items.map((i,idx) => (
                <tr key={`${i.entity_type}-${i.entity_id}-${i.changed_at}-${idx}`}>
                  <td>
                    <span title={(i.entity_type||'').toUpperCase()==='CONTRACT'?'Contract':'Customer'} aria-label={(i.entity_type||'').toUpperCase()==='CONTRACT'?'Contract':'Customer'} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:36,marginRight:8,verticalAlign:'middle'}}>
                      {(i.entity_type||'').toUpperCase()==='CONTRACT' ? <ContractIcon /> : <CustomerIcon />}
                    </span>
                    {i.client_name || ''}
                  </td>
                  <td>{i.opportunity_id || ''}</td>
                  <td>{i.entity_type}</td>
                  <td>{i.from_value}</td>
                  <td>{i.to_value}</td>
                  <td>{i.reason_code || ''}</td>
                  <td>{i.reason_text || ''}</td>
                  <td>{i.changed_by || ''}</td>
                  <td>{new Date(i.changed_at).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      )}

      {activeTab === 'expenses' && (
      <div className="card" style={{marginTop:24}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <h3 style={{margin:0}}>Expense Audit</h3>
          <div style={{display:'flex',gap:16,alignItems:'center'}}>
            <select value={expPageSize} onChange={e => { const v = Number(e.target.value); setExpPageSize(v); fetchExpenseAudit(1, v); }}>
              {[25,50,100].map(n => <option key={n} value={n}>{n}/page</option>)}
            </select>
            <div>
              <button className="btn" type="button" style={{background:'#eee',color:'#222',marginRight:8}} onClick={() => fetchExpenseAudit(Math.max(expPage-1,1), expPageSize)}>Prev</button>
              <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={() => fetchExpenseAudit(expPage+1, expPageSize)}>Next</button>
            </div>
          </div>
        </div>
        {expLoading && <div style={{padding:'8px'}}>Loading expense audit...</div>}
        {expError && <div style={{color:'red',padding:'8px'}}>{expError}</div>}
        <table id="expenseAuditTable">
          <thead>
            <tr>
              <th>Client Name</th>
              <th>Opportunity ID</th>
              <th>Action</th>
              <th>Old Amount</th>
              <th>New Amount</th>
              <th>Old Note</th>
              <th>New Note</th>
              <th>Performed By</th>
              <th>Performed At</th>
            </tr>
          </thead>
          <tbody>
            {expItems.length === 0 ? (
              <tr><td colSpan={9} className="muted">No expense audits</td></tr>
            ) : (
              expItems.map((i,idx) => (
                <tr key={`${i.opportunity_id}-${i.performed_at}-${idx}`}>
                  <td>
                    <span title={(oppMap[i.opportunity_id]?.assignment||'CUSTOMER')==='CONTRACT'?'Contract':'Customer'} aria-label={(oppMap[i.opportunity_id]?.assignment||'CUSTOMER')==='CONTRACT'?'Contract':'Customer'} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:36,marginRight:8,verticalAlign:'middle'}}>
                      {(oppMap[i.opportunity_id]?.assignment||'CUSTOMER')==='CONTRACT' ? <ContractIcon /> : <CustomerIcon />}
                    </span>
                    {i.client_name || oppMap[i.opportunity_id]?.name || (typeof oppMap[i.opportunity_id] === 'string' ? oppMap[i.opportunity_id] : '')}
                  </td>
                  <td>{i.opportunity_id}</td>
                  <td>{i.action}</td>
                  <td>{i.old_amount ?? ''}</td>
                  <td>{i.new_amount ?? ''}</td>
                  <td>{i.old_note ?? ''}</td>
                  <td>{i.new_note ?? ''}</td>
                  <td>{i.performed_by ?? ''}</td>
                  <td>{new Date(i.performed_at).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      )}

      {activeTab === 'passwords' && (
      <div className="card" style={{marginTop:24}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <h3 style={{margin:0}}>Password Audit</h3>
          <div style={{display:'flex',gap:16,alignItems:'center'}}>
            <select value={pwdPageSize} onChange={e => { const v = Number(e.target.value); setPwdPageSize(v); fetchPasswordAudit(1, v); }}>
              {[25,50,100].map(n => <option key={n} value={n}>{n}/page</option>)}
            </select>
            <div>
              <button className="btn" type="button" style={{background:'#eee',color:'#222',marginRight:8}} onClick={() => fetchPasswordAudit(Math.max(pwdPage-1,1), pwdPageSize)}>Prev</button>
              <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={() => fetchPasswordAudit(pwdPage+1, pwdPageSize)}>Next</button>
            </div>
          </div>
        </div>
        {pwdLoading && <div style={{padding:'8px'}}>Loading password audit...</div>}
        {pwdError && <div style={{color:'red',padding:'8px'}}>{pwdError}</div>}
        <table id="passwordAuditTable">
          <thead>
            <tr>
              <th>Target</th>
              <th>Target Role</th>
              <th>Changed By</th>
              <th>Changed By Role</th>
              <th>Performed At</th>
            </tr>
          </thead>
          <tbody>
            {pwdItems.length === 0 ? (
              <tr><td colSpan={5} className="muted">No password updates</td></tr>
            ) : (
              pwdItems.map((i,idx) => (
                <tr key={`${i.performed_at}-${idx}`}>
                  <td>{i.target_full_name || i.target_username || i.target_email}</td>
                  <td>{i.target_role || ''}</td>
                  <td>{i.changed_by || ''}</td>
                  <td>{i.changed_by_role || ''}</td>
                  <td>{new Date(i.performed_at).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      )}

      {activeTab === 'meetings_v2' && (
      <div className="card" style={{marginTop:24}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <h3 style={{margin:0}}>Meetings Audit (v2)</h3>
          <div style={{display:'flex',gap:16,alignItems:'center'}}>
            <select value={maPageSize} onChange={e => { const v = Number(e.target.value); setMaPageSize(v); fetchMeetingsAuditV2(maMeetingId.trim(), 1, v); }}>
              {[25,50,100].map(n => <option key={n} value={n}>{n}/page</option>)}
            </select>
            <div>
              <button className="btn" type="button" style={{background:'#eee',color:'#222',marginRight:8}} onClick={() => fetchMeetingsAuditV2(maMeetingId.trim(), Math.max(maPage-1,1), maPageSize)}>Prev</button>
              <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={() => fetchMeetingsAuditV2(maMeetingId.trim(), maPage+1, maPageSize)}>Next</button>
            </div>
            <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={() => fetchMeetingsAuditV2(maMeetingId.trim(), maPage, maPageSize)}>Refresh</button>
          </div>
        </div>
        {maLoading && <div style={{padding:'8px'}}>Loading meetings audit…</div>}
        {maError && <div style={{color:'red',padding:'8px'}}>{maError}</div>}
        {!maLoading && !maError && (
          <table id="meetingsAuditV2Table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Action</th>
                <th>Performed By</th>
                <th>Performed At</th>
                <th>Note</th>
                <th>Changes</th>
                <th>Snapshot</th>
              </tr>
            </thead>
            <tbody>
              {maItems.length === 0 ? (
                <tr><td colSpan={7} className="muted">No meeting audits to display</td></tr>
              ) : maItems.map((i, idx) => {
                const diff = i.diff || {};
                const lines = toPlainChangeLines(diff, MEETING_LABELS);
                const expanded = !!maExpanded[idx];
                return (
                  <tr key={`${i.meeting_id}-${i.version}-${i.performed_at}-${idx}`}>
                    <td>{i.version}</td>
                    <td>{i.action}</td>
                    <td>{i.performed_by || i.performed_by_user_id || ''}</td>
                    <td>{new Date(i.performed_at).toLocaleString()}</td>
                    <td>{i.note || ''}</td>
                    <td style={{whiteSpace:'pre-wrap'}}>
                      {lines.length ? (
                        <ul style={{margin:'6px 0', paddingLeft:18}}>
                          {lines.slice(0,5).map((t, j) => <li key={j}>{t}</li>)}
                        </ul>
                      ) : '(no changes)'}
                      {lines.length > 5 && <div className="muted" style={{fontSize:12,marginTop:4}}>+{lines.length-5} more…</div>}
                    </td>
                    <td>
                      <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={() => setMaExpanded(m => ({...m, [idx]: !expanded}))}>{expanded ? 'Hide' : 'View'}</button>
                      {expanded && (
                        <div style={{maxWidth:480,maxHeight:260,overflow:'auto',border:'1px solid #eee',borderRadius:6,marginTop:8,padding:6,background:'#fafafa'}}>
                          <div style={{fontWeight:600}}>Diff</div>
                          <pre style={{fontSize:12,whiteSpace:'pre-wrap'}}>{JSON.stringify(i.diff, null, 2)}</pre>
                          <div style={{fontWeight:600, marginTop:8}}>Snapshot</div>
                          <pre style={{fontSize:12,whiteSpace:'pre-wrap'}}>{JSON.stringify(i.snapshot, null, 2)}</pre>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      )}

      {activeTab === 'reminders_v2' && (
      <div className="card" style={{marginTop:24}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <h3 style={{margin:0}}>Reminders Audit (v2)</h3>
          <div style={{display:'flex',gap:16,alignItems:'center'}}>
            <select value={raPageSize} onChange={e => { const v = Number(e.target.value); setRaPageSize(v); fetchRemindersAuditV2(raReminderId.trim(), raAction, 1, v); }}>
              {[25,50,100].map(n => <option key={n} value={n}>{n}/page</option>)}
            </select>
            <div>
              <button className="btn" type="button" style={{background:'#eee',color:'#222',marginRight:8}} onClick={() => fetchRemindersAuditV2(raReminderId.trim(), raAction, Math.max(raPage-1,1), raPageSize)}>Prev</button>
              <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={() => fetchRemindersAuditV2(raReminderId.trim(), raAction, raPage+1, raPageSize)}>Next</button>
            </div>
            <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={() => fetchRemindersAuditV2(raReminderId.trim(), raAction, raPage, raPageSize)}>Refresh</button>
          </div>
        </div>
        {raLoading && <div style={{padding:'8px'}}>Loading reminders audit…</div>}
        {raError && <div style={{color:'red',padding:'8px'}}>{raError}</div>}
        {!raLoading && !raError && (
          <table id="remindersAuditV2Table">
            <thead>
              <tr>
                <th>Reminder ID</th>
                <th>Type</th>
                <th>Version</th>
                <th>Action</th>
                <th>Performed By</th>
                <th>Performed At</th>
                <th>Note</th>
                <th>Changes</th>
                <th>Snapshot</th>
              </tr>
            </thead>
            <tbody>
              {raItems.length === 0 ? (
                <tr><td colSpan={8} className="muted">No reminder audits to display</td></tr>
              ) : raItems.map((i, idx) => {
                const diff = i.diff || {};
                const lines = toPlainChangeLines(diff, REMINDER_LABELS);
                const expanded = !!raExpanded[idx];
                return (
                  <tr key={`${i.reminder_id}-${i.version}-${i.performed_at}-${idx}`}>
                    <td>{i.reminder_id}</td>
                    <td>{i.reminder_type || (i.snapshot && i.snapshot.type) || ''}</td>
                    <td>{i.version}</td>
                    <td>{i.action}</td>
                    <td>{i.performed_by || i.performed_by_user_id || ''}</td>
                    <td>{new Date(i.performed_at).toLocaleString()}</td>
                    <td>{i.note || ''}</td>
                    <td style={{whiteSpace:'pre-wrap'}}>
                      {lines.length ? (
                        <ul style={{margin:'6px 0', paddingLeft:18}}>
                          {lines.slice(0,5).map((t, j) => <li key={j}>{t}</li>)}
                        </ul>
                      ) : '(no changes)'}
                      {lines.length > 5 && <div className="muted" style={{fontSize:12,marginTop:4}}>+{lines.length-5} more…</div>}
                    </td>
                    <td>
                      <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={() => setRaExpanded(m => ({...m, [idx]: !expanded}))}>{expanded ? 'Hide' : 'View'}</button>
                      {expanded && (
                        <div style={{maxWidth:480,maxHeight:260,overflow:'auto',border:'1px solid #eee',borderRadius:6,marginTop:8,padding:6,background:'#fafafa'}}>
                          <div style={{fontWeight:600}}>Diff</div>
                          <pre style={{fontSize:12,whiteSpace:'pre-wrap'}}>{JSON.stringify(i.diff, null, 2)}</pre>
                          <div style={{fontWeight:600, marginTop:8}}>Snapshot</div>
                          <pre style={{fontSize:12,whiteSpace:'pre-wrap'}}>{JSON.stringify(i.snapshot, null, 2)}</pre>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      )}

      {activeTab === 'reminders_email' && (
      <div className="card" style={{marginTop:24}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <h3 style={{margin:0}}>Reminders Email Selected</h3>
          <div style={{display:'flex',gap:16,alignItems:'center'}}>
            <select value={rePageSize} onChange={e => { const v = Number(e.target.value); setRePageSize(v); fetchRemindersEmailSelected(reOperationId.trim(), reReminderId.trim(), reStatus, 1, v); }}>
              {[25,50,100].map(n => <option key={n} value={n}>{n}/page</option>)}
            </select>
            <div>
              <button className="btn" type="button" style={{background:'#eee',color:'#222',marginRight:8}} onClick={() => fetchRemindersEmailSelected(reOperationId.trim(), reReminderId.trim(), reStatus, Math.max(rePage-1,1), rePageSize)}>Prev</button>
              <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={() => fetchRemindersEmailSelected(reOperationId.trim(), reReminderId.trim(), reStatus, rePage+1, rePageSize)}>Next</button>
            </div>
            <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={() => fetchRemindersEmailSelected(reOperationId.trim(), reReminderId.trim(), reStatus, rePage, rePageSize)}>Refresh</button>
          </div>
        </div>
        {reLoading && <div style={{padding:'8px'}}>Loading reminders email audit…</div>}
        {reError && <div style={{color:'red',padding:'8px'}}>{reError}</div>}
        {!reLoading && !reError && (
          <table id="remindersEmailSelectedAuditTable">
            <thead>
              <tr>
                <th>Operation ID</th>
                <th>Type</th>
                <th>Reminder ID</th>
                <th>Performed By</th>
                <th>Performed At</th>
                <th>Subject</th>
                <th>Sent Count</th>
                <th>Status</th>
                <th>Message ID</th>
                <th>Error</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {reItems.length === 0 ? (
                <tr><td colSpan={10} className="muted">No entries</td></tr>
              ) : reItems.map((i, idx) => {
                const expanded = !!reExpanded[idx];
                // estimate recipient count
                const recDedup = i.recipients_dedup || [];
                const to = Array.isArray(i.to_recipients) ? i.to_recipients : [];
                const cc = Array.isArray(i.cc_recipients) ? i.cc_recipients : [];
                const bcc = Array.isArray(i.bcc_recipients) ? i.bcc_recipients : [];
                const err = i.error ? String(i.error).slice(0,120) + (String(i.error).length>120?'…':'') : '';
                return (
                  <tr key={`${i.operation_id}-${i.reminder_id}-${i.performed_at}-${idx}`}>
                    <td style={{fontFamily:'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'}}>{i.operation_id}</td>
                    <td>{i.reminder_type || ''}</td>
                    <td>{i.reminder_id}</td>
                    <td>{i.performed_by || i.performed_by_user_id || ''}</td>
                    <td>{new Date(i.performed_at).toLocaleString()}</td>
                    <td title={i.subject || ''} style={{maxWidth:280,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{i.subject || ''}</td>
                    <td>{i.sent_count ?? recDedup.length ?? (to.length + cc.length + bcc.length)}</td>
                    <td>{i.status}</td>
                    <td style={{maxWidth:200,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={i.message_id || ''}>{i.message_id || ''}</td>
                    <td style={{color:'#991b1b'}} title={i.error || ''}>{err}</td>
                    <td>
                      <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={() => setReExpanded(m => ({...m, [idx]: !expanded}))}>{expanded ? 'Hide' : 'View'}</button>
                      {expanded && (
                        <div style={{maxWidth:520,maxHeight:260,overflow:'auto',border:'1px solid #eee',borderRadius:6,marginTop:8,padding:6,background:'#fafafa'}}>
                          <div style={{fontWeight:600}}>Recipients (dedup)</div>
                          <pre style={{fontSize:12,whiteSpace:'pre-wrap'}}>{JSON.stringify(i.recipients_dedup || [], null, 2)}</pre>
                          <div style={{fontWeight:600, marginTop:8}}>All Recipients</div>
                          <pre style={{fontSize:12,whiteSpace:'pre-wrap'}}>{JSON.stringify({ to: i.to_recipients, cc: i.cc_recipients, bcc: i.bcc_recipients }, null, 2)}</pre>
                          {(i.meta || i.error) && (
                            <>
                              <div style={{fontWeight:600, marginTop:8}}>Meta</div>
                              <pre style={{fontSize:12,whiteSpace:'pre-wrap'}}>{JSON.stringify(i.meta || {}, null, 2)}</pre>
                              {i.error && (
                                <>
                                  <div style={{fontWeight:600, marginTop:8, color:'#991b1b'}}>Error</div>
                                  <pre style={{fontSize:12,whiteSpace:'pre-wrap',color:'#991b1b'}}>{String(i.error)}</pre>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      )}
    </div>
  );
}

export default History;
