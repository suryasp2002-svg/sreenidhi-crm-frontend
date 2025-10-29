import React, { useEffect, useMemo, useState } from 'react';

function History() {
  const [filters, setFilters] = useState({
    q: '',
    entityType: { opportunity: true, contract: true, customer: true },
    dateFrom: '',
    dateTo: ''
  });
  const [activeTab, setActiveTab] = useState('stage'); // 'stage' | 'expenses' | 'passwords'
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
          <button className={activeTab==='passwords'?'btn':'btn ghost'} type="button" style={{marginLeft:8}} onClick={() => setActiveTab('passwords')}>Password Audit</button>
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
    </div>
  );
}

export default History;
