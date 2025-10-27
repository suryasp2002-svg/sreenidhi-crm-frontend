import React, { useState, useEffect, useMemo } from 'react';
import { isValidGSTIN, isValidIndianPhoneLoose, normalizeIndianPhone, isValidEmail, isNonNegativeNumber } from '../utils/validators';
import SortIcon from './SortIcon';
import ClientProfileModal from './ClientProfileModal';
import { isAdmin } from '../utils/auth';
import { uniqueSeed, fakeCompany, fakePerson, fakePhone, fakeGSTIN, fakeEmail, futureDate } from '../utils/autofill';
import useValidation from '../utils/useValidation';

function Contracts({ perms }) {
  const [form, setForm] = useState({
    contract_id: '',
    opportunity_id: '',
    client_name: '',
    quoted_price_per_litre: '',
    start_date: '',
    end_date: '',
    primary_contact: '',
    credit_period: '',
    phone_number: '',
    alt_phone: '',
    gstin: '',
    email: ''
  });
  const [contracts, setContracts] = useState([]);
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
    quoted_price_per_litre: { validate: (v) => v!=='' && !isNonNegativeNumber(v) ? 'Enter a valid non-negative amount' : '' },
    credit_period: { validate: (v) => v!=='' && !isNonNegativeNumber(v) ? 'Enter a valid non-negative number of days' : '' },
    start_date: { validate: (v, vals) => (v && vals.end_date && new Date(v) > new Date(vals.end_date)) ? 'Start date must be before end date' : '' },
    end_date: { validate: (v, vals) => (v && vals.start_date && new Date(v) < new Date(vals.start_date)) ? 'End date must be after start date' : '' },
    phone_number: { validate: (v) => v && !isValidIndianPhoneLoose(v) ? 'Enter a valid Indian mobile number' : '' },
    alt_phone: { validate: (v) => v && !isValidIndianPhoneLoose(v) ? 'Enter a valid Indian mobile number' : '' },
    gstin: { validate: (v) => v && !isValidGSTIN(v) ? 'Invalid GSTIN format' : '' },
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
        const res = await fetch(`/api/contracts?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch contracts');
        const payload = await res.json();
        const items = Array.isArray(payload) ? payload : (payload.items || []);
        if (!aborted) {
          setContracts(items);
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
    const contract_id = isEdit ? editId : Math.random().toString(36).substr(2, 6).toUpperCase();
    // Validations
    const errs = {};
    if (form.quoted_price_per_litre !== '' && !isNonNegativeNumber(form.quoted_price_per_litre)) errs.quoted_price_per_litre = 'Enter a valid non-negative amount';
    if (form.credit_period !== '' && !isNonNegativeNumber(form.credit_period)) errs.credit_period = 'Enter a valid non-negative number of days';
  if (form.phone_number && !isValidIndianPhoneLoose(form.phone_number)) errs.phone_number = 'Enter a valid Indian mobile number';
  if (form.alt_phone && !isValidIndianPhoneLoose(form.alt_phone)) errs.alt_phone = 'Enter a valid Indian mobile number';
    if (form.gstin && !isValidGSTIN(form.gstin)) errs.gstin = 'Invalid GSTIN format';
    if (form.email && !isValidEmail(form.email)) errs.email = 'Invalid email';
    setFieldErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    // Ensure all fields are sent in the payload
    const payload = {
      contract_id: contract_id || '',
      client_name: form.client_name ?? '',
      opportunity_id: form.opportunity_id ?? '',
      quoted_price_per_litre: form.quoted_price_per_litre ?? '',
      start_date: form.start_date ?? '',
      end_date: form.end_date ?? '',
      primary_contact: form.primary_contact ?? '',
      credit_period: form.credit_period ?? '',
      phone_number: form.phone_number ? normalizeIndianPhone(form.phone_number) : '',
      alt_phone: form.alt_phone ? normalizeIndianPhone(form.alt_phone) : '',
      gstin: form.gstin ?? '',
      email: form.email ?? ''
    };
    try {
      let res, updatedContract;
      if (isEdit) {
        res = await fetch(`/api/contracts/${contract_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to update contract');
        updatedContract = await res.json();
        setContracts(cs => cs.map(c => c.contract_id === contract_id ? updatedContract : c));
      } else {
        res = await fetch('/api/contracts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to create contract');
        const newContract = await res.json();
        setContracts(cs => [...cs, newContract]);
      }
  setForm({ contract_id: '', client_name: '', quoted_price_per_litre: '', start_date: '', end_date: '', primary_contact: '', credit_period: '', phone_number: '', alt_phone: '', gstin: '', email: '' });
      setEditId(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEdit = (contract) => {
    setForm({
      contract_id: contract.contract_id,
      opportunity_id: contract.opportunity_id || '',
      client_name: contract.client_name || '',
      quoted_price_per_litre: contract.quoted_price_per_litre || '',
      start_date: contract.start_date || '',
      end_date: contract.end_date || '',
      primary_contact: contract.primary_contact || '',
      credit_period: contract.credit_period || '',
      phone_number: contract.phone_number || '',
      alt_phone: contract.alt_phone || '',
      gstin: contract.gstin || '',
      email: contract.email || ''
    });
    setEditId(contract.contract_id);
  };

  async function openProfileForContract(contractId) {
    if (!contractId) return;
    try {
      const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const res = await fetch(`/api/client-profile/by-contract/${encodeURIComponent(contractId)}`, { headers });
      if (!res.ok) {
        const t = await res.json().catch(() => ({}));
        throw new Error(t.error || `Failed to resolve opportunity for ${contractId}`);
      }
      const body = await res.json();
      const oppId = body?.resolvedOpportunityId || body?.opportunity?.opportunity_id || body?.opportunityId || body?.id;
      if (!oppId) throw new Error('Could not resolve Opportunity ID for this contract');
      setProfile({ open: true, opportunityId: oppId });
    } catch (e) {
      alert(e.message || String(e));
    }
  }

  // Sorting helper
  const sortedFiltered = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = contracts.filter(c =>
      c.client_name?.toLowerCase().includes(q) || c.contract_id?.toLowerCase().includes(q)
    );
    const { key, dir } = sort;
    const cmp = (a, b) => {
      let av = a[key];
      let bv = b[key];
      // Date columns
      if (key === 'start_date' || key === 'end_date') {
        const ad = new Date(av || 0).getTime();
        const bd = new Date(bv || 0).getTime();
        return dir === 'asc' ? ad - bd : bd - ad;
      }
      // Numeric columns
      if (key === 'quoted_price_per_litre' || key === 'credit_period') {
        const an = Number(av) || 0; const bn = Number(bv) || 0;
        return dir === 'asc' ? an - bn : bn - an;
      }
      // String fallback
      const as = (av ?? '').toString().toLowerCase();
      const bs = (bv ?? '').toString().toLowerCase();
      if (as < bs) return dir === 'asc' ? -1 : 1;
      if (as > bs) return dir === 'asc' ? 1 : -1;
      return 0;
    };
    return [...filtered].sort(cmp);
  }, [contracts, search, sort]);

  function toggleSort(key) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  }

  // Export CSV
  function exportCSV() {
    if (!contracts.length) return;
    const headers = [
      'Client Name',
      'Contract ID',
      'Quoted Price/Litre',
      'Start Date',
      'End Date',
      'Primary Contact',
      'Phone',
      'Alt Phone',
      'GSTIN',
      'Email',
      'Credit Period'
    ];
    const rows = contracts.map(c => [
      c.client_name,
      c.contract_id,
      c.quoted_price_per_litre,
      formatDate(c.start_date),
      formatDate(c.end_date),
      c.primary_contact,
      c.phone_number,
      c.alt_phone,
      c.gstin,
      c.email,
      c.credit_period
    ]);
    const csvContent = [
      ['Contracts Table'],
      headers,
      ...rows
    ].map(r => Array.isArray(r) ? r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',') : r).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contracts.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Print Table
  function printTable() {
    const printContents = document.getElementById('contractsTable').outerHTML;
    const win = window.open('', '', 'height=700,width=900');
    win.document.write('<html><head><title>Contracts</title>');
    win.document.write('<style>table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left;}th{background:#f5f5f5;}</style>');
    win.document.write('</head><body>');
    win.document.write(printContents);
    win.document.write('</body></html>');
    win.document.close();
    win.print();
  }

  // Format date as dd-mm-yyyy
  function formatDate(d) {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date)) return d;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  }

  const can = perms ? { create: !!perms?.actions?.['Contracts.create'], edit: !!perms?.actions?.['Contracts.edit'] } : { create: true, edit: true };
  return (
    <div>
      {loading && <div style={{padding:'16px'}}>Loading contracts...</div>}
      {error && <div style={{color:'red',padding:'8px'}}>{error}</div>}

      <div className="card" style={{position:'relative'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <h3 style={{margin:0}}>Manage Contracts</h3>
          <div style={{display:'flex', gap:8}}>
            {isAdminUser && (
              <button
                className="btn"
                type="button"
                title="Autofill (Admin only)"
                style={{background:'#111', color:'#fff'}}
                onClick={() => {
                  const seed = uniqueSeed('CONT');
                  const sd = futureDate(1);
                  const ed = futureDate(31);
                  setForm(f => ({
                    ...f,
                    client_name: fakeCompany(seed),
                    quoted_price_per_litre: String(85 + Math.floor(Math.random()*10)),
                    start_date: sd,
                    end_date: ed,
                    primary_contact: fakePerson(seed),
                    credit_period: String(15 + Math.floor(Math.random()*30)),
                    phone_number: fakePhone(seed),
                    alt_phone: '',
                    gstin: fakeGSTIN(seed),
                    email: fakeEmail(seed)
                  }));
                }}
              >Autofill</button>
            )}
            <button
              className="btn"
              type="button"
              style={{background:'#eee', color:'#222'}}
              onClick={() => {
                setForm({
                  contract_id: '',
                  client_name: '',
                  quoted_price_per_litre: '',
                  start_date: '',
                  end_date: '',
                  primary_contact: '',
                  credit_period: '',
                  phone_number: '',
                  alt_phone: '',
                  gstin: '',
                  email: ''
                });
                setEditId(null);
              }}
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
            <label className="block">Quoted Price Per Litre</label>
            <input name="quoted_price_per_litre" type="number" inputMode="decimal" min="0" step="0.01" value={form.quoted_price_per_litre} onChange={handleChange} onBlur={()=>vBlur('quoted_price_per_litre')} aria-invalid={!!(vErrors.quoted_price_per_litre)} aria-describedby={vErrors.quoted_price_per_litre? 'err-qpl': undefined} placeholder="Enter Quoted Price" className={vErrors.quoted_price_per_litre?'input-error':''} />
            {vErrors.quoted_price_per_litre && <div id="err-qpl" className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{vErrors.quoted_price_per_litre}</div>}
          </div>
          <div className="row">
            <label className="block">Start Date</label>
            <input name="start_date" type="date" value={form.start_date} onChange={handleChange} onBlur={()=>vBlur('start_date')} aria-invalid={!!(vErrors.start_date)} aria-describedby={vErrors.start_date? 'err-start': undefined} className={vErrors.start_date?'input-error':''} />
            {vErrors.start_date && <div id="err-start" className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{vErrors.start_date}</div>}
          </div>
          <div className="row">
            <label className="block">End Date</label>
            <input name="end_date" type="date" value={form.end_date} onChange={handleChange} onBlur={()=>vBlur('end_date')} aria-invalid={!!(vErrors.end_date)} aria-describedby={vErrors.end_date? 'err-end': undefined} className={vErrors.end_date?'input-error':''} />
            {vErrors.end_date && <div id="err-end" className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{vErrors.end_date}</div>}
          </div>
          <div className="row">
            <label className="block">Primary Contact</label>
            <input name="primary_contact" value={form.primary_contact} onChange={handleChange} placeholder="Enter Primary Contact" />
          </div>
          <div className="row">
            <label className="block">Credit Period</label>
            <input name="credit_period" type="number" inputMode="numeric" min="0" step="1" value={form.credit_period} onChange={handleChange} onBlur={()=>vBlur('credit_period')} aria-invalid={!!(vErrors.credit_period)} aria-describedby={vErrors.credit_period? 'err-credit': undefined} placeholder="Enter Credit Period" className={vErrors.credit_period?'input-error':''} />
            {vErrors.credit_period && <div id="err-credit" className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{vErrors.credit_period}</div>}
          </div>
          <div className="row">
            <label className="block">Phone Number</label>
            <input name="phone_number" value={form.phone_number} onChange={handleChange} onBlur={()=>vBlur('phone_number')} aria-invalid={!!(vErrors.phone_number)} aria-describedby={vErrors.phone_number? 'err-phone': undefined} placeholder="Enter Phone Number" className={vErrors.phone_number?'input-error':''} />
            {vErrors.phone_number && <div id="err-phone" className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{vErrors.phone_number}</div>}
          </div>
          <div className="row">
            <label className="block">Alternate Phone</label>
            <input name="alt_phone" value={form.alt_phone} onChange={handleChange} onBlur={()=>vBlur('alt_phone')} aria-invalid={!!(vErrors.alt_phone)} aria-describedby={vErrors.alt_phone? 'err-alt': undefined} placeholder="Enter Alternate Phone" className={vErrors.alt_phone?'input-error':''} />
            {vErrors.alt_phone && <div id="err-alt" className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{vErrors.alt_phone}</div>}
          </div>
          <div className="row">
            <label className="block">GSTIN</label>
            <input name="gstin" value={form.gstin} onChange={handleChange} onBlur={()=>vBlur('gstin')} aria-invalid={!!(vErrors.gstin)} aria-describedby={vErrors.gstin? 'err-gstin': undefined} placeholder="Enter GSTIN" className={vErrors.gstin?'input-error':''} />
            {vErrors.gstin && <div id="err-gstin" className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{vErrors.gstin}</div>}
          </div>
          <div className="row">
            <label className="block">Email</label>
            <input name="email" value={form.email} onChange={handleChange} onBlur={()=>vBlur('email')} aria-invalid={!!(vErrors.email)} aria-describedby={vErrors.email? 'err-email': undefined} placeholder="Enter Email" className={vErrors.email?'input-error':''} />
            {vErrors.email && <div id="err-email" className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{vErrors.email}</div>}
          </div>
          <div className="row" style={{alignSelf:'end'}}>
            <button className="btn" type="submit" style={{marginTop:16}} disabled={!(editId ? can.edit : can.create) || !canSubmit}>{editId ? 'Update' : 'Add'} Contract</button>
          </div>
        </form>
      </div>

      <div className="card" style={{marginTop:32}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <h3 style={{margin:0}}>All Contracts</h3>
          <div style={{display:'flex',gap:16,alignItems:'center'}}>
            <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={exportCSV}>Export CSV</button>
            <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={printTable}>Print / PDF</button>
          </div>
        </div>
        <div style={{display:'flex',justifyContent:'flex-start',alignItems:'center',marginBottom:8, gap:8}}>
          <input
            type="text"
            placeholder="Search by Client Name or Contract ID"
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
        <table id="contractsTable">
          <thead>
            <tr>
              <th onClick={() => toggleSort('client_name')} style={{cursor:'pointer'}}>Client Name <SortIcon active={sort.key==='client_name'} dir={sort.dir} /></th>
              <th onClick={() => toggleSort('contract_id')} style={{cursor:'pointer'}}>Contract ID <SortIcon active={sort.key==='contract_id'} dir={sort.dir} /></th>
              <th onClick={() => toggleSort('quoted_price_per_litre')} style={{cursor:'pointer'}}>Quoted Price/Litre <SortIcon active={sort.key==='quoted_price_per_litre'} dir={sort.dir} /></th>
              <th onClick={() => toggleSort('start_date')} style={{cursor:'pointer'}}>Start Date <SortIcon active={sort.key==='start_date'} dir={sort.dir} /></th>
              <th onClick={() => toggleSort('end_date')} style={{cursor:'pointer'}}>End Date <SortIcon active={sort.key==='end_date'} dir={sort.dir} /></th>
              <th onClick={() => toggleSort('primary_contact')} style={{cursor:'pointer'}}>Primary Contact <SortIcon active={sort.key==='primary_contact'} dir={sort.dir} /></th>
              <th onClick={() => toggleSort('phone_number')} style={{cursor:'pointer'}}>Phone <SortIcon active={sort.key==='phone_number'} dir={sort.dir} /></th>
              <th onClick={() => toggleSort('alt_phone')} style={{cursor:'pointer'}}>Alt Phone <SortIcon active={sort.key==='alt_phone'} dir={sort.dir} /></th>
              <th onClick={() => toggleSort('gstin')} style={{cursor:'pointer'}}>GSTIN <SortIcon active={sort.key==='gstin'} dir={sort.dir} /></th>
              <th onClick={() => toggleSort('email')} style={{cursor:'pointer'}}>Email <SortIcon active={sort.key==='email'} dir={sort.dir} /></th>
              <th onClick={() => toggleSort('credit_period')} style={{cursor:'pointer'}}>Credit Period <SortIcon active={sort.key==='credit_period'} dir={sort.dir} /></th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {(sortedFiltered.length === 0) ? (
              <tr><td colSpan={12} className="muted">No contracts</td></tr>
            ) : (
              sortedFiltered.map(contract => (
                <tr key={contract.contract_id}>
                  <td>{contract.client_name}</td>
                  <td>
                    <a
                      href="#"
                      onClick={(e) => { e.preventDefault(); openProfileForContract(contract.contract_id); }}
                      title="Open Client Profile"
                      style={{ color:'#2563eb', textDecoration:'underline', cursor:'pointer' }}
                    >
                      {contract.contract_id}
                    </a>
                  </td>
                  <td>{contract.quoted_price_per_litre}</td>
                  <td>{formatDate(contract.start_date)}</td>
                  <td>{formatDate(contract.end_date)}</td>
                  <td>{contract.primary_contact}</td>
                  <td>{contract.phone_number}</td>
                  <td>{contract.alt_phone}</td>
                  <td>{contract.gstin}</td>
                  <td>{contract.email}</td>
                  <td>{contract.credit_period}</td>
                  <td>
                    <button className="btn" style={{background:'#f1c40f',color:'#222',marginRight:8, opacity: can.edit?1:0.5}} onClick={() => handleEdit(contract)} disabled={!can.edit}>Edit</button>
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

export default Contracts;
