import React, { useEffect, useState } from 'react';
import useDebouncedValue from '../utils/useDebouncedValue';
import useValidation from '../utils/useValidation';
import { isAdmin, getRole } from '../utils/auth';
import { uniqueSeed, fakeCompany } from '../utils/autofill';

function Targets({ perms }) {
  const [form, setForm] = useState({ client_name: '', notes: '', status: 'PENDING', assignedToUserId: '', assigned_to: '' });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  // All available statuses (DUPLICATE removed per request)
  const ALL_STATUSES = ['PENDING','FOLLOW_UP','COMPETITOR','ON_HOLD','CANCELLED','DONE'];
  const [statusFilter, setStatusFilter] = useState(() => ALL_STATUSES.reduce((acc, s) => { acc[s] = true; return acc; }, {}));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [userRole, setUserRole] = useState(null);
  // Sub-tab to switch between list and creation panel (restores the missing Create tab)
  const [subTab, setSubTab] = useState('list'); // 'list' | 'create'
  const [userOptions, setUserOptions] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [myUserId, setMyUserId] = useState('');
  const [myUsername, setMyUsername] = useState('');
  const v = useValidation(form, {
    client_name: { required: true },
    status: { required: true },
  }, { debounceMs: 150 });

  useEffect(() => {
    (async () => {
      try { setIsAdminUser(await isAdmin()); setUserRole(await getRole()); } catch { setIsAdminUser(false); setUserRole(null); }
      try {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const res = await fetch('/api/auth/me', { headers: token ? { Authorization: 'Bearer ' + token } : undefined });
        if (res.ok) {
          const me = await res.json();
          setMyUserId(me.id || '');
          setMyUsername(me.username || '');
        }
      } catch {}
    })();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      const statuses = Object.entries(statusFilter).filter(([,v])=>v).map(([k])=>k);
      // Only send statuses when not selecting all
      if (statuses.length && statuses.length < ALL_STATUSES.length) params.set('status', statuses.join(','));
      if (debouncedSearch) params.set('q', debouncedSearch);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      const headers = token ? { Authorization: 'Bearer ' + token } : undefined;
      const res = await fetch(`/api/targets?${params.toString()}`, { headers });
      if (!res.ok) {
        let msg = 'Failed to load targets';
        try { const t = await res.json(); if (t?.error) msg = t.error; } catch {}
        if (res.status === 401) {
          msg = 'Unauthorized. Please login again.';
        }
        throw new Error(msg);
      }
      const data = await res.json();
      setItems(data.items || []);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* initial */ }, []);
  useEffect(() => { load(); /* filters/paging */ }, [debouncedSearch, statusFilter, page, pageSize]);
  // Auto-refresh every 20s
  useEffect(() => {
    const t = setInterval(() => { load(); }, 20000);
    return () => clearInterval(t);
  }, [debouncedSearch, statusFilter, page, pageSize]);

  // Load users for assignment
  // Admin: include OWNER, EMPLOYEE, ADMIN (show all active users)
  // Others: include OWNER, EMPLOYEE
  useEffect(() => {
    let aborted = false;
    async function fetchUsers() {
      setLoadingUsers(true); setUsersError('');
      try {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const roles = (String(userRole).toUpperCase() === 'ADMIN') ? 'OWNER,EMPLOYEE,ADMIN' : 'OWNER,EMPLOYEE';
        const res = await fetch(`/api/users-lookup?roles=${encodeURIComponent(roles)}`, { headers: token ? { Authorization: 'Bearer ' + token } : undefined });
        const data = await res.json();
        if (!aborted) {
          if (res.ok) setUserOptions(Array.isArray(data)?data:[]);
          else { setUserOptions([]); setUsersError(data?.error || 'Failed to load users'); }
        }
      } catch (e) { if (!aborted) setUsersError('Failed to load users'); }
      finally { if (!aborted) setLoadingUsers(false); }
    }
    fetchUsers();
    return () => { aborted = true; };
  }, [userRole]);

  function onChange(e) { const { name, value } = e.target; setForm(f=>({ ...f, [name]: value })); v.schedule(name, value); }

  const can = perms ? { create: !!perms?.actions?.['Targets.create'], edit: !!perms?.actions?.['Targets.edit'], delete: !!perms?.actions?.['Targets.delete'] } : { create: true, edit: true, delete: true };

  const statusOptions = [
    { value: 'PENDING', label: 'Pending', color: '#f59e0b', bg: '#fffbeb' },
    { value: 'FOLLOW_UP', label: 'Follow-up', color: '#2563eb', bg: '#eff6ff' },
    { value: 'COMPETITOR', label: 'Competitor', color: '#b91c1c', bg: '#fef2f2' },
    { value: 'ON_HOLD', label: 'On hold', color: '#6b7280', bg: '#f3f4f6' },
    { value: 'CANCELLED', label: 'Cancelled', color: '#6b7280', bg: '#f3f4f6' },
    { value: 'DONE', label: 'Done', color: '#166534', bg: '#dcfce7' },
  ];
  const statusChip = (s) => {
    const opt = statusOptions.find(x=>x.value===String(s).toUpperCase());
    const color = opt?.color || '#374151';
    const bg = opt?.bg || '#f3f4f6';
    const label = opt?.label || s;
    return <span style={{padding:'3px 8px',borderRadius:999,fontSize:11,fontWeight:700,background:bg,color}}>{label}</span>;
  };

  async function createTarget() {
    setError('');
    const token = localStorage.getItem('authToken');
    const auth = token ? { Authorization: 'Bearer ' + token } : {};
    const client_name = form.client_name.trim();
    if (!client_name) { setError('Client name is required'); return; }
    const payload = {
      client_name,
      notes: form.notes.trim() || null,
      status: form.status,
      assignedToUserId: form.assignedToUserId || myUserId || undefined,
      assigned_to: form.assigned_to || undefined,
    };
    try {
      const res = await fetch('/api/targets', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(payload) });
      if (!res.ok) {
        let msg = 'Failed to create target';
        try { const t = await res.json(); if (t?.error) msg = t.error; } catch {}
        throw new Error(msg);
      }
      setForm({ client_name: '', notes: '', status: 'PENDING', assignedToUserId: '', assigned_to: '' });
      setPage(1);
      await load();
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  async function toggleStatus(id, to) {
    try {
      const token = localStorage.getItem('authToken');
      const auth = token ? { Authorization: 'Bearer ' + token } : {};
      const res = await fetch(`/api/targets/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ status: to })});
      if (!res.ok) throw new Error('Failed to update status');
      await load();
    } catch (e) { setError(e.message || String(e)); }
  }

  async function updateItem(item) {
    try {
      const payload = { client_name: item.client_name, notes: item.notes, status: item.status };
      const token = localStorage.getItem('authToken');
      const auth = token ? { Authorization: 'Bearer ' + token } : {};
      const res = await fetch(`/api/targets/${item.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(payload)});
      if (!res.ok) throw new Error('Failed to update target');
      await load();
    } catch (e) { setError(e.message || String(e)); }
  }

  async function removeItem(id) {
    if (!window.confirm('Delete this target?')) return;
    try {
      const token = localStorage.getItem('authToken');
      const auth = token ? { Authorization: 'Bearer ' + token } : {};
      const res = await fetch(`/api/targets/${id}`, { method: 'DELETE', headers: { ...auth } });
      if (!res.ok) throw new Error('Failed to delete target');
      await load();
    } catch (e) { setError(e.message || String(e)); }
  }

  // Server-driven pagination: enable Next if we received a full page
  const hasNext = items.length === pageSize;

  return (
    <div style={{ padding: '16px 0' }}>
      {/* Sub tabs: Targets list / Create Target */}
      <div style={{display:'flex', gap:8, marginBottom:12}}>
        <button
          type="button"
          onClick={()=> setSubTab('list')}
          className={subTab==='list' ? 'nav-btn active' : 'nav-btn'}
          style={{background: subTab==='list' ? '#111' : '#f5f5f5', color: subTab==='list' ? '#fff' : '#222', border:'none', borderRadius:20, padding:'6px 14px', cursor:'pointer'}}
        >
          Targets
        </button>
        {userRole !== 'EMPLOYEE' && (
          <button
            type="button"
            onClick={()=> setSubTab('create')}
            className={subTab==='create' ? 'nav-btn active' : 'nav-btn'}
            style={{background: subTab==='create' ? '#111' : '#f5f5f5', color: subTab==='create' ? '#fff' : '#222', border:'none', borderRadius:20, padding:'6px 14px', cursor:'pointer'}}
          >
            Create Target
          </button>
        )}
      </div>

      {/* Panels rendered based on subTab selection */}
      {subTab === 'list' && (
        /* Left panel: List of created targets */
        <div className="card">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}>
            <h3 style={{margin:0}}>Targets</h3>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <input value={search} onChange={e=>{ setSearch(e.target.value); setPage(1); }} placeholder="Search client name" style={{padding:'6px 10px',border:'1px solid #ccc',borderRadius:4}} />
              {ALL_STATUSES.map(s => (
                <label key={s} style={{display:'inline-flex',alignItems:'center',gap:6}}>
                  <input type="checkbox" checked={!!statusFilter[s]} onChange={e=>{ setStatusFilter(f=>({ ...f, [s]: e.target.checked })); setPage(1); }} /> {s}
                </label>
              ))}
              <select value={pageSize} onChange={e=>{ setPageSize(Number(e.target.value)); setPage(1); }}>
                {[10,20,50].map(n => <option key={n} value={n}>{n}/page</option>)}
              </select>
              <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={()=> setPage(p=>Math.max(1,p-1))} disabled={page===1}>Prev</button>
              <div style={{fontSize:12,color:'#6b7280'}}>Page {page}</div>
              <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={()=> setPage(p=>p+1)} disabled={!hasNext}>Next</button>
            </div>
          </div>
          {loading && <div style={{padding:8}}>Loading…</div>}
          <table style={{width:'100%',marginTop:8,borderCollapse:'collapse'}}>
            <thead>
              <tr>
                <th style={{textAlign:'left',padding:'8px 10px'}}>Client Name</th>
                <th style={{textAlign:'left',padding:'8px 10px'}}>Notes</th>
                <th style={{textAlign:'left',padding:'8px 10px'}}>Status</th>
                <th style={{textAlign:'left',padding:'8px 10px'}}>Assigned To</th>
                <th style={{textAlign:'left',padding:'8px 10px'}}>Updated</th>
                <th style={{textAlign:'left',padding:'8px 10px'}}>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={6} className="muted">No targets</td></tr>
              ) : items.map(it => (
                <tr key={it.id}>
                  <td style={{padding:'8px 10px', fontWeight:600}}>{it.client_name}</td>
                  <td style={{padding:'8px 10px', color:'#374151'}}>{it.notes || '—'}</td>
                  <td style={{padding:'8px 10px'}}>{statusChip(it.status)}</td>
                  <td style={{padding:'8px 10px'}}>
                    {it.assigned_to ? (
                      <span style={{padding:'3px 8px', borderRadius:999, fontSize:11, fontWeight:700, background:'#eef2ff', color:'#3730a3', border:'1px solid #c7d2fe'}} title="Assigned To">{it.assigned_to}</span>
                    ) : (
                      <span className="muted">Unassigned</span>
                    )}
                  </td>
                  <td style={{padding:'8px 10px'}}>{new Date(it.updated_at || it.created_at).toLocaleString()}</td>
                  <td style={{padding:'8px 10px'}}>
                    {can.edit && (
                      <>
                        <button className="btn" type="button" onClick={()=> { setEditingId(it.id); setForm({ client_name: it.client_name, notes: it.notes || '', status: it.status, assignedToUserId: it.assigned_to_user_id || '', assigned_to: it.assigned_to || '' }); }}>
                          Edit
                        </button>
                        {it.status === 'PENDING'
                          ? <button className="btn" type="button" style={{marginLeft:8}} onClick={()=> toggleStatus(it.id, 'DONE')}>✓ Mark Done</button>
                          : <button className="btn" type="button" style={{marginLeft:8}} onClick={()=> toggleStatus(it.id, 'PENDING')}>↺ Mark Pending</button>
                        }
                      </>
                    )}
                    <button className="btn" type="button" style={{marginLeft:8, background:'#e74c3c', color:'#fff', opacity: can.delete?1:0.5}} onClick={()=> removeItem(it.id)} disabled={!can.delete}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Server-driven paging: we don't know total; omit summary */}
          {error && <div style={{color:'#b91c1c',marginTop:8}}>{error}</div>}
        </div>
      )}

      {/* Right panel: Create form (hidden for EMPLOYEE), shown when subTab is 'create' */}
      {subTab === 'create' && userRole !== 'EMPLOYEE' && (
        <div className="card">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <h3 style={{margin:0}}>{editingId ? 'Edit Target' : 'Create Target'}</h3>
            {isAdminUser && (
              <button
                className="btn"
                type="button"
                title="Autofill (Admin only)"
                style={{background:'#111', color:'#fff'}}
                onClick={() => {
                  const seed = uniqueSeed('TGT');
                  setForm(f => ({ ...f, client_name: fakeCompany(seed), notes: `Target for ${seed}` }));
                }}
              >Autofill</button>
            )}
          </div>
          <form onSubmit={async (e)=>{
            e.preventDefault();
            if (!v.validateAll()) return;
            if (editingId) {
              try {
                const token = localStorage.getItem('authToken');
                const auth = token ? { Authorization: 'Bearer ' + token } : {};
                const payload = {
                  client_name: form.client_name.trim(),
                  notes: form.notes.trim() || null,
                  status: form.status,
                  assignedToUserId: form.assignedToUserId || undefined,
                  assigned_to: form.assigned_to || undefined,
                };
                const res = await fetch(`/api/targets/${editingId}`, { method:'PUT', headers:{ 'Content-Type':'application/json', ...auth }, body: JSON.stringify(payload) });
                if (!res.ok) {
                  let msg = 'Failed to update target';
                  try { const t = await res.json(); if (t?.error) msg = t.error; } catch {}
                  throw new Error(msg);
                }
                setEditingId(null);
                setForm({ client_name:'', notes:'', status:'PENDING', assignedToUserId:'', assigned_to:'' });
                await load();
              } catch (e) { setError(e.message || String(e)); }
              return;
            }
            await createTarget();
          }} className="grid cols-1">
            <div className="row">
              <label className="block">Client Name</label>
              <input name="client_name" value={form.client_name} onChange={onChange} onBlur={()=>v.onBlur('client_name')} placeholder="Enter client name" className={(v.touched.client_name && v.errors.client_name) ? 'input-error' : ''} />
              {v.touched.client_name && v.errors.client_name && <div style={{fontSize:12,color:'crimson',marginTop:4}}>{v.errors.client_name}</div>}
            </div>
            <div className="row">
              <label className="block">Notes</label>
              <textarea name="notes" rows={5} value={form.notes} onChange={onChange} placeholder="Notes / plan" />
            </div>
            <div className="row">
              <label className="block">Status</label>
              <select name="status" value={form.status} onChange={onChange} onBlur={()=>v.onBlur('status')} className={(v.touched.status && v.errors.status) ? 'input-error' : ''}>
                {statusOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              {v.touched.status && v.errors.status && <div style={{fontSize:12,color:'crimson',marginTop:4}}>{v.errors.status}</div>}
            </div>
            <div className="row">
              <label className="block">Assign To</label>
              <select
                value={form.assignedToUserId || ''}
                onChange={e=> setForm(f=> ({ ...f, assignedToUserId: e.target.value }))}
              >
                {myUserId
                  ? <option value={myUserId}>{`Myself - ${myUsername} (${String(userRole || '').toUpperCase() || 'USER'})`}</option>
                  : <option value="">Select user</option>
                }
                {loadingUsers && <option value="" disabled>(Loading users...)</option>}
                {!loadingUsers && userOptions.length === 0 && <option value="" disabled>(No users)</option>}
                {userOptions
                  .filter(u => String(u.id) !== String(myUserId))
                  .map(u => {
                  const label = u.username || '';
                  return <option key={u.id} value={u.id}>{label} ({u.role})</option>;
                })}
              </select>
              {usersError && <div style={{fontSize:12,color:'crimson',marginTop:4}}>{usersError}</div>}
            </div>
            <div className="row" style={{ marginTop:8 }}>
              <button className="btn" type="submit" disabled={!can.create || !v.canSubmit}>{editingId ? 'Update' : 'Create'}</button>
              {editingId && <button className="btn ghost" type="button" style={{marginLeft:8}} onClick={()=> { setEditingId(null); setForm({ client_name:'', notes:'', status:'PENDING', assignedToUserId:'', assigned_to:'' }); }}>Cancel</button>}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default Targets;
