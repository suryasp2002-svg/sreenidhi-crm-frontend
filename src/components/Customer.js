import React, { useState, useEffect, useMemo } from 'react';
import { isValidGSTIN, isValidIndianPhoneLoose, isValidEmail, normalizeIndianPhone } from '../utils/validators';
import SortIcon from './SortIcon';
import ClientProfileModal from './ClientProfileModal';
import { isAdmin } from '../utils/auth';
import { uniqueSeed, fakeCompany, fakeGSTIN, fakePerson, fakePhone, fakeEmail } from '../utils/autofill';
import useValidation from '../utils/useValidation';

function Customer({ perms }) {
  const [form, setForm] = useState({
    customer_id: '',
    client_name: '',
    gstin: '',
    primary_contact: '',
    phone: '',
    alt_phone: '',
    email: '',
  });
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editId, setEditId] = useState(null);
  const [search, setSearch] = useState('');
  const [listPage, setListPage] = useState(1);
  const [listPageSize, setListPageSize] = useState(25);
  const [listTotal, setListTotal] = useState(0);
  const [sort, setSort] = useState({ key: 'client_name', dir: 'asc' });
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [profile, setProfile] = useState({ open: false, opportunityId: '' });
  const [fieldErrors, setFieldErrors] = useState({});

  const { errors: vErrors, onBlur: vBlur, schedule: vSchedule, validateAll, canSubmit } = useValidation(form, {
    client_name: { required: true },
    gstin: { validate: (v) => v && !isValidGSTIN(v) ? 'Invalid GSTIN format' : '' },
    phone: { validate: (v) => v && !isValidIndianPhoneLoose(v) ? 'Enter a valid Indian mobile number' : '' },
    alt_phone: { validate: (v) => v && !isValidIndianPhoneLoose(v) ? 'Enter a valid Indian mobile number' : '' },
    email: { validate: (v) => v && !isValidEmail(v) ? 'Invalid email' : '' },
  }, { debounceMs: 200 });

  useEffect(() => {
    let aborted = false;
    async function loadPage() {
      setLoading(true); setError(null);
      try {
        const params = new URLSearchParams();
        if (search) params.set('q', search);
        params.set('page', String(listPage));
        params.set('pageSize', String(listPageSize));
        const res = await fetch(`/api/customers?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch customers');
        const payload = await res.json();
        const items = Array.isArray(payload) ? payload : (payload.items || []);
        if (!aborted) {
          setCustomers(items);
          setListTotal(payload.total || items.length || 0);
        }
      } catch (e) {
        if (!aborted) setError(e.message);
      } finally {
        if (!aborted) setLoading(false);
      }
    }
    loadPage();
    return () => { aborted = true; };
  }, [search, listPage, listPageSize]);

  useEffect(() => { (async () => { try { setIsAdminUser(await isAdmin()); } catch { setIsAdminUser(false); } })(); }, []);

  const handleChange = e => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
    setFieldErrors(prev => ({ ...prev, [name]: '' }));
    vSchedule(name, value);
  };

  const handleSubmit = async e => {
    e.preventDefault();
  const isEdit = !!editId;
  // validate all before submit
  if (!validateAll()) return;
    const customer_id = isEdit ? editId : 'CUST-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    // Validations
    const errs = {};
  if (form.gstin && !isValidGSTIN(form.gstin)) errs.gstin = 'Invalid GSTIN format';
  if (form.phone && !isValidIndianPhoneLoose(form.phone)) errs.phone = 'Enter a valid Indian mobile number';
  if (form.alt_phone && !isValidIndianPhoneLoose(form.alt_phone)) errs.alt_phone = 'Enter a valid Indian mobile number';
    if (form.email && !isValidEmail(form.email)) errs.email = 'Invalid email';
    setFieldErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    const payload = {
      ...form,
      customer_id,
      phone: form.phone ? normalizeIndianPhone(form.phone) : '',
      alt_phone: form.alt_phone ? normalizeIndianPhone(form.alt_phone) : ''
    };
    try {
      let res, updatedCustomer;
      if (isEdit) {
        res = await fetch(`/api/customers/${customer_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to update customer');
        updatedCustomer = await res.json();
        setCustomers(cs => cs.map(c => c.customer_id === customer_id ? updatedCustomer : c));
      } else {
        res = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to create customer');
        const newCustomer = await res.json();
        setCustomers(cs => [...cs, newCustomer]);
      }
      setForm({ customer_id: '', client_name: '', gstin: '', primary_contact: '', phone: '', alt_phone: '', email: '' });
      setEditId(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEdit = (customer) => {
    setForm({
      customer_id: customer.customer_id,
      client_name: customer.client_name,
      gstin: customer.gstin || '',
      primary_contact: customer.primary_contact || '',
      phone: customer.phone || '',
      alt_phone: customer.alt_phone || '',
      email: customer.email || ''
    });
    setEditId(customer.customer_id);
  };

  async function openProfileForCustomer(customerId) {
    if (!customerId) return;
    try {
      const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const res = await fetch(`/api/client-profile/by-customer/${encodeURIComponent(customerId)}`, { headers });
      if (!res.ok) {
        const t = await res.json().catch(() => ({}));
        throw new Error(t.error || `Failed to resolve opportunity for ${customerId}`);
      }
      const body = await res.json();
      const oppId = body?.resolvedOpportunityId || body?.opportunity?.opportunity_id || body?.opportunityId || body?.id;
      if (!oppId) throw new Error('Could not resolve Opportunity ID for this customer');
      setProfile({ open: true, opportunityId: oppId });
    } catch (e) {
      alert(e.message || String(e));
    }
  }

  // Sorting helper
  const sortedFiltered = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = customers.filter(c =>
      c.client_name?.toLowerCase().includes(q) || c.customer_id?.toLowerCase().includes(q)
    );
    const { key, dir } = sort;
    const get = (obj, k) => (obj?.[k] ?? '').toString().toLowerCase();
    const cmp = (a, b) => {
      let av = a[key];
      let bv = b[key];
      // Try numeric compare if both look like numbers
      const an = Number(av); const bn = Number(bv);
      if (!isNaN(an) && !isNaN(bn)) {
        return dir === 'asc' ? an - bn : bn - an;
      }
      // Fallback string compare
      const as = get(a, key);
      const bs = get(b, key);
      if (as < bs) return dir === 'asc' ? -1 : 1;
      if (as > bs) return dir === 'asc' ? 1 : -1;
      return 0;
    };
    return [...filtered].sort(cmp);
  }, [customers, search, sort]);

  function toggleSort(key) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  }

  function exportCSV() {
    if (!customers.length) return;
    const headers = [
      'Client Name',
      'Customer ID',
      'GSTIN',
      'Primary Contact',
      'Phone',
      'Alt Phone',
      'Email'
    ];
    const rows = customers.map(c => [
      c.client_name,
      c.customer_id,
      c.gstin,
      c.primary_contact,
      c.phone,
      c.alt_phone,
      c.email
    ]);
    const csvContent = [
      ['Customer Table'],
      headers,
      ...rows
    ].map(r => Array.isArray(r) ? r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',') : r).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'customers.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function printTable() {
    const printContents = document.getElementById('customersTable').outerHTML;
    const win = window.open('', '', 'height=700,width=900');
    win.document.write('<html><head><title>Customers</title>');
    win.document.write('<style>table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left;}th{background:#f5f5f5;}</style>');
    win.document.write('</head><body>');
    win.document.write(printContents);
    win.document.write('</body></html>');
    win.document.close();
    win.print();
  }

  const can = perms ? { create: !!perms?.actions?.['Customers.create'], edit: !!perms?.actions?.['Customers.edit'] } : { create: true, edit: true };
  return (
    <div>
      {loading && <div style={{padding:'16px'}}>Loading customers...</div>}
      {error && <div style={{color:'red',padding:'8px'}}>{error}</div>}

      <div className="card" style={{position:'relative'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <h3 style={{margin:0}}>Manage Customers</h3>
          <div style={{display:'flex', gap:8}}>
            {isAdminUser && (
              <button
                className="btn"
                type="button"
                title="Autofill (Admin only)"
                style={{background:'#111', color:'#fff'}}
                onClick={() => {
                  const seed = uniqueSeed('CUST');
                  setForm(f => ({
                    ...f,
                    client_name: fakeCompany(seed),
                    gstin: Math.random() < 0.7 ? fakeGSTIN(seed) : '',
                    primary_contact: fakePerson(seed),
                    phone: fakePhone(seed),
                    alt_phone: '',
                    email: fakeEmail(seed)
                  }));
                }}
              >Autofill</button>
            )}
            <button
              className="btn"
              type="button"
              style={{background:'#eee', color:'#222'}}
              onClick={() => setForm({ customer_id: '', client_name: '', gstin: '', primary_contact: '', phone: '', alt_phone: '', email: '' })}
            >Clear</button>
          </div>
        </div>
  <form onSubmit={handleSubmit} className="grid cols-3">
          <div className="row">
            <label className="block">Client Name</label>
            <input name="client_name" value={form.client_name} onChange={handleChange} onBlur={()=>vBlur('client_name')} aria-invalid={!!(vErrors.client_name)} aria-describedby={vErrors.client_name? 'err-client_name': undefined} placeholder="Enter Client Name" className={vErrors.client_name?'input-error':''} />
            {vErrors.client_name && <div id="err-client_name" className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{vErrors.client_name}</div>}
          </div>
          <div className="row">
            <label className="block">GSTIN</label>
            <input name="gstin" value={form.gstin} onChange={handleChange} onBlur={()=>vBlur('gstin')} aria-invalid={!!(vErrors.gstin)} aria-describedby={vErrors.gstin? 'err-gstin': undefined} placeholder="Enter GSTIN" className={vErrors.gstin?'input-error':''} />
            {vErrors.gstin && <div id="err-gstin" className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{vErrors.gstin}</div>}
          </div>
          <div className="row">
            <label className="block">Primary Contact</label>
            <input name="primary_contact" value={form.primary_contact} onChange={handleChange} placeholder="Enter Primary Contact" />
          </div>
          <div className="row">
            <label className="block">Phone</label>
            <input name="phone" value={form.phone} onChange={handleChange} onBlur={()=>vBlur('phone')} aria-invalid={!!(vErrors.phone)} aria-describedby={vErrors.phone? 'err-phone': undefined} placeholder="Enter Phone" className={vErrors.phone?'input-error':''} />
            {vErrors.phone && <div id="err-phone" className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{vErrors.phone}</div>}
          </div>
          <div className="row">
            <label className="block">Alt Phone</label>
            <input name="alt_phone" value={form.alt_phone} onChange={handleChange} onBlur={()=>vBlur('alt_phone')} aria-invalid={!!(vErrors.alt_phone)} aria-describedby={vErrors.alt_phone? 'err-alt_phone': undefined} placeholder="Enter Alt Phone" className={vErrors.alt_phone?'input-error':''} />
            {vErrors.alt_phone && <div id="err-alt_phone" className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{vErrors.alt_phone}</div>}
          </div>
          <div className="row">
            <label className="block">Email</label>
            <input name="email" value={form.email} onChange={handleChange} onBlur={()=>vBlur('email')} aria-invalid={!!(vErrors.email)} aria-describedby={vErrors.email? 'err-email': undefined} placeholder="Enter Email" className={vErrors.email?'input-error':''} />
            {vErrors.email && <div id="err-email" className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{vErrors.email}</div>}
          </div>
          <div style={{gridColumn:'1/-1',marginTop:8}}>
            <button className="btn" type="submit" disabled={!(editId ? can.edit : can.create) || !canSubmit}>{editId ? 'Update' : 'Create'}</button>
            {editId && (
              <button className="btn" type="button" style={{marginLeft:8}} onClick={() => { setEditId(null); setForm({customer_id: '', client_name: '', gstin: '', primary_contact: '', phone: '', alt_phone: '', email: ''}); }}>Cancel</button>
            )}
          </div>
        </form>
      </div>

      <div className="card" style={{marginTop:32}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <h3 style={{margin:0}}>All Customers</h3>
          <div style={{display:'flex',gap:16,alignItems:'center'}}>
            <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={exportCSV}>Export CSV</button>
            <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={printTable}>Print / PDF</button>
          </div>
        </div>
        <div style={{display:'flex',justifyContent:'flex-start',alignItems:'center',marginBottom:8, gap:8}}>
          <input
            type="text"
            placeholder="Search by Client Name or Customer ID"
            value={search}
            onChange={e => { setSearch(e.target.value); setListPage(1); }}
            style={{padding:'6px 10px',border:'1px solid #ccc',borderRadius:4,minWidth:220}}
          />
          <div style={{marginLeft:'auto', display:'flex', alignItems:'center', gap:8}}>
            <button className="btn" onClick={() => setListPage(p => Math.max(1, p - 1))} disabled={listPage <= 1}>Prev</button>
            <span className="muted" style={{fontSize:12}}>Page {listPage} of {Math.max(1, Math.ceil(listTotal / listPageSize))}</span>
            <button className="btn" onClick={() => setListPage(p => p + 1)} disabled={listPage >= Math.max(1, Math.ceil(listTotal / listPageSize))}>Next</button>
            <select value={listPageSize} onChange={(e)=>{ setListPageSize(parseInt(e.target.value,10)); setListPage(1); }} style={{padding:'6px 10px',border:'1px solid #ccc',borderRadius:4}}>
              {[10,25,50,100].map(n => <option key={n} value={n}>{n}/page</option>)}
            </select>
          </div>
        </div>
        <table id="customersTable">
          <thead>
            <tr>
              <th onClick={() => toggleSort('client_name')} style={{cursor:'pointer'}}>Client Name <SortIcon active={sort.key==='client_name'} dir={sort.dir} /></th>
              <th onClick={() => toggleSort('customer_id')} style={{cursor:'pointer'}}>Customer ID <SortIcon active={sort.key==='customer_id'} dir={sort.dir} /></th>
              <th onClick={() => toggleSort('gstin')} style={{cursor:'pointer'}}>GSTIN <SortIcon active={sort.key==='gstin'} dir={sort.dir} /></th>
              <th onClick={() => toggleSort('primary_contact')} style={{cursor:'pointer'}}>Primary Contact <SortIcon active={sort.key==='primary_contact'} dir={sort.dir} /></th>
              <th onClick={() => toggleSort('phone')} style={{cursor:'pointer'}}>Phone <SortIcon active={sort.key==='phone'} dir={sort.dir} /></th>
              <th onClick={() => toggleSort('alt_phone')} style={{cursor:'pointer'}}>Alt Phone <SortIcon active={sort.key==='alt_phone'} dir={sort.dir} /></th>
              <th onClick={() => toggleSort('email')} style={{cursor:'pointer'}}>Email <SortIcon active={sort.key==='email'} dir={sort.dir} /></th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {(sortedFiltered.length === 0) ? (
              <tr><td colSpan={8} className="muted">No customers</td></tr>
            ) : (
              sortedFiltered.map(c => (
                <tr key={c.customer_id}>
                  <td>{c.client_name}</td>
                  <td>
                    <a
                      href="#"
                      onClick={(e) => { e.preventDefault(); openProfileForCustomer(c.customer_id); }}
                      title="Open Client Profile"
                      style={{ color:'#2563eb', textDecoration:'underline', cursor:'pointer' }}
                    >
                      {c.customer_id}
                    </a>
                  </td>
                  <td>{c.gstin}</td>
                  <td>{c.primary_contact}</td>
                  <td>{c.phone}</td>
                  <td>{c.alt_phone}</td>
                  <td>{c.email}</td>
                  <td>
                    <button className="btn" style={{background:'#f1c40f',color:'#222',marginRight:8, opacity: can.edit?1:0.5}} onClick={() => handleEdit(c)} disabled={!can.edit}>Edit</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {profile.open && (
        <ClientProfileModal
          opportunityId={profile.opportunityId}
          onClose={() => setProfile({ open:false, opportunityId:'' })}
        />
      )}
    </div>
  );
}

export default Customer;
