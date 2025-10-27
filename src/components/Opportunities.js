import React, { useState, useEffect, useMemo, useRef } from 'react';
import { isValidHttpUrl, isNonNegativeNumber, isValidGoogleMapsUrl } from '../utils/validators';
import useValidation from '../utils/useValidation';
import ClientProfileModal from './ClientProfileModal';
import SortIcon from './SortIcon';
import { isAdmin } from '../utils/auth';
import { uniqueSeed, companyName, purposeForClient, priceRandom, volumeRandom } from '../utils/autofill';

function Opportunities({ perms }) {
  // State hooks
  const [form, setForm] = useState({
    opportunity_id: '',
    client_name: '',
    purpose: '',
    expected_monthly_volume_l: '',
    proposed_price_per_litre: '',
    sector: '',
    location_url: '',
    stage: 'LEAD',
    notes: '',
    salesperson: '',
    assignment: 'CUSTOMER',
    contract_choice: '',
    loss_reason: '',
    spend: '',
  });
  const [opportunities, setOpportunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editId, setEditId] = useState(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [listPage, setListPage] = useState(1);
  const [listPageSize, setListPageSize] = useState(25);
  const [listTotal, setListTotal] = useState(0);
  const [sort, setSort] = useState({ key: 'client_name', dir: 'asc' });
  const [profile, setProfile] = useState({ open: false, opportunityId: '' });
  // Images selected for upload (previews)
  const [selectedImages, setSelectedImages] = useState([]); // [{file, url, uploaded?:boolean}]
  const fileInputRef = useRef(null);
  const [imageError, setImageError] = useState('');
  // Stage modal used when a chosen stage requires a reason (DISAGREED/CANCELLED or reopen)
  const [stageModal, setStageModal] = useState({ open: false, toStage: '', reasonRequired: false, reasonCode: '', reasonText: '' });
  const [pendingReason, setPendingReason] = useState({ code: '', text: '' });
  const [originalStage, setOriginalStage] = useState(null);
  // Expenses ledger state
  const [expenses, setExpenses] = useState([]);
  const [expenseModal, setExpenseModal] = useState({ open: false, id: null, amount: '', at: '', note: '' });
  const [userOptions, setUserOptions] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userOptionsError, setUserOptionsError] = useState('');
  const [isAdminUser, setIsAdminUser] = useState(false);
  // Sector filter state
  const [sectorFilterOpen, setSectorFilterOpen] = useState(false);
  const [sectorFilterSearch, setSectorFilterSearch] = useState('');
  const [sectorFilterSelected, setSectorFilterSelected] = useState([]); // committed selection
  const [sectorFilterTemp, setSectorFilterTemp] = useState([]); // selection while popup open

  const allSectors = useMemo(() => {
    const uniq = new Set((opportunities || []).map(o => o.sector || '—'));
    return Array.from(uniq).sort((a,b) => String(a).localeCompare(String(b)));
  }, [opportunities]);

  // Stage filter
  const [stageFilterOpen, setStageFilterOpen] = useState(false);
  const [stageFilterSearch, setStageFilterSearch] = useState('');
  const [stageFilterSelected, setStageFilterSelected] = useState([]);
  const [stageFilterTemp, setStageFilterTemp] = useState([]);
  const allStages = useMemo(() => {
    const uniq = new Set((opportunities || []).map(o => o.stage || '—'));
    return Array.from(uniq).sort((a,b) => String(a).localeCompare(String(b)));
  }, [opportunities]);

  // Salesperson filter
  const [salesFilterOpen, setSalesFilterOpen] = useState(false);
  const [salesFilterSearch, setSalesFilterSearch] = useState('');
  const [salesFilterSelected, setSalesFilterSelected] = useState([]);
  const [salesFilterTemp, setSalesFilterTemp] = useState([]);
  const allSalespeople = useMemo(() => {
    const uniq = new Set((opportunities || []).map(o => o.salesperson || '—'));
    return Array.from(uniq).sort((a,b) => String(a).localeCompare(String(b)));
  }, [opportunities]);

  // Live validation schema
  const v = useValidation(form, {
    salesperson: { required: true },
    expected_monthly_volume_l: {
      validate: (val) => {
        const s = String(val ?? '').trim();
        if (!s) return '';
        return isNonNegativeNumber(s) ? '' : 'Please enter a valid non-negative number.';
      }
    },
    proposed_price_per_litre: {
      validate: (val) => {
        const s = String(val ?? '').trim();
        if (!s) return '';
        return isNonNegativeNumber(s) ? '' : 'Please enter a valid non-negative amount.';
      }
    },
    location_url: {
      validate: (val) => {
        const s = String(val ?? '').trim();
        if (!s) return '';
        return isValidGoogleMapsUrl(s) ? '' : 'Please enter a valid Google Maps link.';
      }
    }
  }, { debounceMs: 200 });

  // Small inline map icon (Google Maps-style red pin)
  const MapPinIcon = ({ size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <path d="M12 22s7-7.58 7-12a7 7 0 1 0-14 0c0 4.42 7 12 7 12z" fill="#EA4335"/>
      <circle cx="12" cy="10" r="3.2" fill="#FFFFFF"/>
    </svg>
  );

  // Debounce search term to avoid chatty requests
  useEffect(() => {
    const h = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(h);
  }, [search]);

  // Fetch opportunities (paginated) from backend API
  useEffect(() => {
    async function loadList() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (debouncedSearch) params.set('q', debouncedSearch);
        // Map current sort to server sort param
        const sortKey = `${sort.key}_${sort.dir}`;
        params.set('sort', sortKey);
        params.set('page', String(listPage));
        params.set('pageSize', String(listPageSize));
        const res = await fetch(`/api/opportunities?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch opportunities');
        const payload = await res.json();
        const items = Array.isArray(payload) ? payload : (payload.items || []);
        setOpportunities(items);
        setListTotal(payload.total || items.length || 0);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    loadList();
  }, [debouncedSearch, sort.key, sort.dir, listPage, listPageSize]);

  // Detect admin for Autofill button visibility
  useEffect(() => {
    (async () => {
      try { setIsAdminUser(await isAdmin()); } catch { setIsAdminUser(false); }
    })();
  }, []);

  // Load users for salesperson dropdown (Owner + Employee by default)
  useEffect(() => {
    let aborted = false;
    async function loadUsers() {
      setLoadingUsers(true);
      setUserOptionsError('');
      try {
  const r = await fetch('/api/users-lookup?roles=OWNER,EMPLOYEE');
        const data = await r.json();
        if (!aborted && r.ok) {
          setUserOptions(Array.isArray(data) ? data : []);
        } else if (!aborted) {
          setUserOptions([]);
          setUserOptionsError(data?.error || 'Failed to load users');
        }
      } catch {
        if (!aborted) setUserOptionsError('Failed to load users');
      } finally {
        if (!aborted) setLoadingUsers(false);
      }
    }
    loadUsers();
    return () => { aborted = true; };
  }, []);

  // Handlers for form fields
  const handleChange = e => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
    v.schedule(name, value);
  };

  // Image selection handler
  const handleSelectImages = (filesList) => {
    const files = Array.from(filesList || []);
    const allowed = ['image/png','image/jpeg','image/jpg','image/webp'];
    const next = [];
    for (const f of files) {
      if (!allowed.includes(f.type)) { setImageError('Only PNG, JPG, or WEBP images allowed'); continue; }
      if (f.size > 5 * 1024 * 1024) { setImageError('Each file must be ≤ 5MB'); continue; }
      const url = URL.createObjectURL(f);
      next.push({ file: f, url, uploaded: false });
    }
    setSelectedImages(prev => [...prev, ...next]);
  };
  const removeSelectedImage = (idx) => {
    setSelectedImages(prev => {
      const copy = [...prev];
      const it = copy[idx];
      if (it && it.url) URL.revokeObjectURL(it.url);
      copy.splice(idx, 1);
      return copy;
    });
  };

  async function uploadImagesForOpportunity(opportunityId) {
    const pending = selectedImages.filter(it => !it.uploaded);
    if (!pending.length) return;
    try {
  const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      for (let i = 0; i < selectedImages.length; i++) {
        if (selectedImages[i]?.uploaded) continue;
        const { file } = selectedImages[i];
        const b64 = await new Promise((resolve, reject) => {
          const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => reject(new Error('Failed to read file')); fr.readAsDataURL(file);
        });
        const res = await fetch(`/api/opportunities/${encodeURIComponent(opportunityId)}/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
          body: JSON.stringify({ fileName: file.name, mimeType: file.type, dataBase64: b64 })
        });
        if (!res.ok) {
          // If server indicates feature not enabled, silently ignore
          if (res.status === 404 || res.status === 501) { continue; }
          let msg = `${res.status} ${res.statusText}`;
          try {
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
              const t = await res.json();
              msg = `${msg}${t?.error ? ': ' + t.error : t?.message ? ': ' + t.message : ''}`;
            } else {
              const txt = await res.text();
              if (txt) msg = `${msg}: ${txt.slice(0,200)}`;
            }
          } catch {}
          throw new Error(msg || 'Image upload failed');
        }
        // Mark this image as uploaded
        setSelectedImages(prev => {
          const cp = [...prev];
          if (cp[i]) cp[i] = { ...cp[i], uploaded: true };
          return cp;
        });
      }
    } catch (e) {
      setImageError(e.message);
    }
  }

  // Submit handler: POST or PUT to backend
  const handleSubmit = async e => {
    e.preventDefault();
    const isEdit = !!editId;
    const opportunity_id = isEdit ? editId : 'OPP-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    // Validate all before submit
    if (!v.validateAll()) return;
    // Determine if a reason is required for this stage change
    const currentOpp = opportunities.find(o => o.opportunity_id === opportunity_id);
    const fromStage = currentOpp ? currentOpp.stage : null;
    const toStage = form.stage;
    let reasonRequired = false;
    if (toStage === 'DISAGREED' || toStage === 'CANCELLED') reasonRequired = true;
    if ((fromStage === 'DISAGREED' || fromStage === 'CANCELLED') && toStage && toStage !== fromStage) reasonRequired = true;
    if (reasonRequired && !pendingReason.code) {
      setError('Reason code is required for this stage change.');
      return;
    }
    const payload = {
      opportunity_id,
      client_name: form.client_name,
      purpose: form.purpose,
      expected_monthly_volume_l: Number(form.expected_monthly_volume_l),
      proposed_price_per_litre: Number(form.proposed_price_per_litre),
      sector: form.sector || null,
      location_url: form.location_url || null,
      stage: form.stage,
      probability: form.stage === 'LEAD' ? 10 : form.stage === 'QUALIFIED' ? 40 : form.stage === 'NEGOTIATION' ? 70 : form.stage === 'AGREED' ? 100 : 0,
      notes: form.notes,
      salesperson: form.salesperson,
      assignment: form.assignment,
      spend: Number(form.spend),
      loss_reason: form.loss_reason,
      // Optionally include stage-change reason fields; backend will use when applicable
      ...(reasonRequired ? { reasonCode: pendingReason.code, reasonText: pendingReason.text } : {}),
    };
    try {
  const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      const auth = token ? { Authorization: 'Bearer ' + token } : {};
      let res, updatedOpp;
      if (isEdit) {
        res = await fetch(`/api/opportunities/${opportunity_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...auth },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to update opportunity');
        updatedOpp = await res.json();
        setOpportunities(ops => ops.map(o => o.opportunity_id === opportunity_id ? updatedOpp : o));
      } else {
        res = await fetch('/api/opportunities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to create opportunity');
        const newOpp = await res.json();
        // Upload any selected images for this new opportunity
        await uploadImagesForOpportunity(newOpp.opportunity_id);
        setOpportunities(ops => [...ops, newOpp]);
      }
      // For edit flow: upload images after successful update, then clear selection
      if (isEdit && selectedImages.length) {
        await uploadImagesForOpportunity(opportunity_id);
        // Clear previews and reset file input
        setSelectedImages(prev => { prev.forEach(p => p.url && URL.revokeObjectURL(p.url)); return []; });
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
      setForm({
        opportunity_id: '', client_name: '', purpose: '', expected_monthly_volume_l: '',
        proposed_price_per_litre: '', sector: '', location_url: '', stage: 'LEAD', notes: '', salesperson: '',
        assignment: 'CUSTOMER', contract_choice: '', loss_reason: '', spend: '',
      });
      setPendingReason({ code: '', text: '' });
      setEditId(null);
      setOriginalStage(null);
      // Do not clear selectedImages on edit; allow user to see uploaded items
      if (!isEdit) {
        setSelectedImages(prev => { prev.forEach(p => p.url && URL.revokeObjectURL(p.url)); return []; });
      }
    } catch (err) {
      setError(err.message);
    }
  };

  // Edit handler
  const handleEdit = (opp) => {
    setForm({
      opportunity_id: opp.opportunity_id,
      client_name: opp.client_name,
      purpose: opp.purpose,
      expected_monthly_volume_l: opp.expected_monthly_volume_l,
      proposed_price_per_litre: opp.proposed_price_per_litre,
      sector: opp.sector || '',
      location_url: opp.location_url || '',
      stage: opp.stage,
      notes: opp.notes,
      salesperson: opp.salesperson,
      assignment: opp.assignment,
      contract_choice: '',
      loss_reason: opp.loss_reason || '',
      spend: opp.spend,
    });
    setEditId(opp.opportunity_id);
    setOriginalStage(opp.stage || null);
    // Load expenses for this opportunity
    loadExpenses(opp.opportunity_id);
  };

  // Delete handler
  const handleDelete = async (opportunity_id) => {
    if (!window.confirm('Are you sure you want to delete this opportunity?')) return;
    try {
      const res = await fetch(`/api/opportunities/${opportunity_id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete opportunity');
      setOpportunities(ops => ops.filter(o => o.opportunity_id !== opportunity_id));
    } catch (err) {
      setError(err.message);
    }
  };

  function closeStageModal() {
    setStageModal({ open: false, toStage: '', reasonRequired: false, reasonCode: '', reasonText: '' });
  }
  // Confirm reason for stage that requires one; apply selection to form state
  function confirmReasonAndApply() {
    if (stageModal.reasonRequired && !stageModal.reasonCode) {
      setError('Reason code is required');
      return;
    }
    setPendingReason({ code: stageModal.reasonCode || '', text: stageModal.reasonText || '' });
    setForm(f => ({ ...f, stage: stageModal.toStage }));
    closeStageModal();
  }

  // Export CSV handler
  function exportCSV() {
    if (!opportunities.length) return;
    const headers = [
      'Opportunity ID',
      'Client Name',
      'Purpose',
      'Expected Monthly Volume (L)',
      'Proposed Price (₹/L)',
      'Stage',
      'Probability',
      'Spend',
      'Salesperson',
      'Assignment',
      'Notes',
      'Loss Reason'
    ];
    const rows = opportunities.map(o => [
      o.opportunity_id,
      o.client_name,
      o.purpose,
      o.expected_monthly_volume_l,
      o.proposed_price_per_litre,
      o.stage,
      o.probability,
      o.spend,
      o.salesperson,
      o.assignment,
      o.notes,
      o.loss_reason || ''
    ]);
    const csvContent = [
      ['Opportunity Table'],
      headers,
      ...rows
    ].map(r => Array.isArray(r) ? r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',') : r).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'opportunities.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Print/PDF handler
  function printTable() {
    const printContents = document.getElementById('opportunitiesTable').outerHTML;
    const win = window.open('', '', 'height=700,width=900');
    win.document.write('<html><head><title>Opportunities</title>');
    win.document.write('<style>table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left;}th{background:#f5f5f5;}</style>');
    win.document.write('</head><body>');
    win.document.write(printContents);
    win.document.write('</body></html>');
    win.document.close();
    win.print();
  }

  // --------------------
  // Expenses (ledger)
  // --------------------
  const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
  const totalSpend = expenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);

  async function loadExpenses(opportunityId) {
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/expenses`);
      if (!res.ok) throw new Error('Failed to load expenses');
      const data = await res.json();
      setExpenses(data);
      // Update the spend aggregate in the main table for this opportunity for UI consistency
      const sum = Array.isArray(data) ? data.reduce((acc, e) => acc + (Number(e.amount) || 0), 0) : 0;
      setOpportunities(ops => ops.map(o => o.opportunity_id === opportunityId ? { ...o, spend: sum } : o));
    } catch (e) {
      setError(e.message);
    }
  }

  function openAddExpense() {
    if (!editId) { setError('Open an opportunity in Edit to add expenses'); return; }
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth()+1).padStart(2,'0');
    const dd = String(today.getDate()).padStart(2,'0');
    setExpenseModal({ open: true, id: null, amount: '', at: `${yyyy}-${mm}-${dd}`, note: '' });
  }
  function openEditExpense(e) {
    setExpenseModal({ open: true, id: e.id, amount: String(e.amount ?? ''), at: (e.at ? String(e.at).slice(0,10) : ''), note: e.note || '' });
  }
  function closeExpenseModal() { setExpenseModal({ open: false, id: null, amount: '', at: '', note: '' }); }

  async function saveExpense() {
    if (!editId) { setError('No opportunity selected'); return; }
    const amt = Number(expenseModal.amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError('Amount must be a positive number'); return; }
    if (!expenseModal.at) { setError('Date is required'); return; }
    const payload = { amount: amt, at: expenseModal.at, note: expenseModal.note };
    try {
      const token = localStorage.getItem('authToken');
      const auth = token ? { Authorization: 'Bearer ' + token } : {};
      let res;
      if (expenseModal.id) {
        res = await fetch(`/api/expenses/${expenseModal.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(payload) });
      } else {
        res = await fetch(`/api/opportunities/${editId}/expenses`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(payload) });
      }
      if (!res.ok) {
        const t = await res.json().catch(() => ({}));
        throw new Error(t.error || 'Failed to save expense');
      }
      await loadExpenses(editId);
      closeExpenseModal();
    } catch (e) {
      alert(e.message);
    }
  }

  async function deleteExpense(id) {
    if (!window.confirm('Delete this expense entry?')) return;
    try {
      const token = localStorage.getItem('authToken');
      const auth = token ? { Authorization: 'Bearer ' + token } : {};
      const res = await fetch(`/api/expenses/${id}`, { method: 'DELETE', headers: { ...auth } });
      if (!res.ok) {
        const t = await res.json().catch(() => ({}));
        throw new Error(t.error || 'Failed to delete expense');
      }
      await loadExpenses(editId);
    } catch (e) {
      alert(e.message);
    }
  }

  const permsProvided = !!perms;
  const can = permsProvided ? {
    create: !!perms?.actions?.['Opportunities.create'],
    edit: !!perms?.actions?.['Opportunities.edit'],
    delete: !!perms?.actions?.['Opportunities.delete']
  } : { create: true, edit: true, delete: true };

  return (
    <div>
      {loading && <div style={{padding:'16px'}}>Loading opportunities...</div>}
      {error && <div style={{color:'red',padding:'8px'}}>{error}</div>}

      <div className="card" style={{position:'relative'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <h3 style={{margin:0}}>Create Opportunity</h3>
          <div style={{display:'flex', gap:8}}>
            {isAdminUser && (
              <button
                className="btn"
                type="button"
                title="Autofill (Admin only)"
                style={{background:'#111', color:'#fff'}}
                onClick={() => {
                  const seed = uniqueSeed('OPP');
                  const name = companyName(seed);
                  setForm(f => ({
                    ...f,
                    client_name: name,
                    purpose: purposeForClient(seed, name),
                    expected_monthly_volume_l: String(volumeRandom(4000, 3000)),
                    proposed_price_per_litre: String(priceRandom(92, 6)),
                    notes: `Autofill seed: ${seed}`,
                    assignment: Math.random() < 0.6 ? 'CUSTOMER' : 'CONTRACT',
                  }));
                }}
              >Autofill</button>
            )}
              <button
              className="btn"
              type="button"
              style={{background:'#eee', color:'#222'}}
              onClick={() => { setForm({
                opportunity_id: '', client_name: '', purpose: '', expected_monthly_volume_l: '',
                proposed_price_per_litre: '', sector: '', location_url: '', stage: 'LEAD', notes: '', salesperson: '',
                assignment: 'CUSTOMER', contract_choice: '', loss_reason: '', spend: '',
              }); setPendingReason({ code: '', text: '' }); setOriginalStage(null); }}
            >Clear</button>
          </div>
        </div>
  <form onSubmit={handleSubmit} className="grid cols-3">
          <div className="row">
            <label className="block">Assignment</label>
            <select name="assignment" value={form.assignment} onChange={handleChange}>
              <option value="CUSTOMER">Customer</option>
              <option value="CONTRACT">Contract</option>
            </select>
          </div>
          <div className="row">
            <label className="block">Client Name</label>
            <input name="client_name" value={form.client_name} onChange={handleChange} onBlur={() => v.onBlur('client_name')} placeholder="Enter Client Name" className={(v.touched.client_name && v.errors.client_name) ? 'input-error' : ''} />
          </div>
          <div className="row">
            <label className="block">Purpose</label>
            <input name="purpose" value={form.purpose} onChange={handleChange} onBlur={() => v.onBlur('purpose')} className={(v.touched.purpose && v.errors.purpose) ? 'input-error' : ''} />
          </div>
          <div className="row">
            <label className="block">Expected Monthly Volume (L)</label>
            <input name="expected_monthly_volume_l" type="number" inputMode="numeric" min="0" step="1" value={form.expected_monthly_volume_l} onChange={handleChange} onBlur={() => v.onBlur('expected_monthly_volume_l')} className={(v.touched.expected_monthly_volume_l && v.errors.expected_monthly_volume_l) ? 'input-error' : ''} />
            {v.touched.expected_monthly_volume_l && v.errors.expected_monthly_volume_l && <div className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{v.errors.expected_monthly_volume_l}</div>}
          </div>
          <div className="row">
            <label className="block">Proposed Price (₹/L)</label>
            <input name="proposed_price_per_litre" type="number" inputMode="decimal" min="0" step="0.01" value={form.proposed_price_per_litre} onChange={handleChange} onBlur={() => v.onBlur('proposed_price_per_litre')} className={(v.touched.proposed_price_per_litre && v.errors.proposed_price_per_litre) ? 'input-error' : ''} />
            {v.touched.proposed_price_per_litre && v.errors.proposed_price_per_litre && <div className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{v.errors.proposed_price_per_litre}</div>}
          </div>
          <div className="row">
            <label className="block">Sector</label>
            <select name="sector" value={form.sector} onChange={handleChange}>
              <option value="">Select sector</option>
              {['CONSTRUCTION','MINING','HOSPITAL & HEALTHCARE','COMMERCIAL','INSTITUTIONAL','LOGISTICS','INDUSTRIAL','RESIDENTIAL','AGRICULTURE','OTHER'].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="row">
            <label className="block">Location Link (Google Maps)</label>
            <input name="location_url" value={form.location_url} onChange={handleChange} onBlur={() => v.onBlur('location_url')} placeholder="https://maps.google.com/..." className={(v.touched.location_url && v.errors.location_url) ? 'input-error' : ''} />
            {v.touched.location_url && v.errors.location_url && <div className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{v.errors.location_url}</div>}
          </div>
          <div className="row">
            <label className="block">Salesperson</label>
            <select
              name="salesperson"
              value={form.salesperson}
              onChange={handleChange}
              onBlur={() => v.onBlur('salesperson')}
              required
              className={(v.touched.salesperson && v.errors.salesperson) ? 'input-error' : ''}
            >
              <option value="">Select salesperson</option>
              {userOptions.length === 0 && !loadingUsers && (
                <option value="" disabled>(No users found)</option>
              )}
              {/* If editing, keep showing current value even if not in userOptions */}
              {form.salesperson && !userOptions.some(u => (u.full_name || u.username || u.email) === form.salesperson) && (
                <option value={form.salesperson}>{form.salesperson} (current)</option>
              )}
              {userOptions.filter(u => u.role !== 'ADMIN').map(u => {
                const label = u.full_name || u.username || u.email;
                return (
                  <option key={u.id} value={label}>{label} ({u.role})</option>
                );
              })}
            </select>
            {loadingUsers && <div className="muted" style={{fontSize:12, marginTop:4}}>Loading users…</div>}
            {!loadingUsers && userOptionsError && <div style={{fontSize:12, color:'crimson', marginTop:4}}>{userOptionsError}</div>}
          </div>
          <div className="row">
            <label className="block">Notes</label>
            <input name="notes" value={form.notes} onChange={handleChange} />
          </div>
          <div className="row">
            <label className="block">Total Spend</label>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div style={{padding:'6px 10px',border:'1px solid #ccc',borderRadius:4,background:'#fafafa',minWidth:120}}>{inr.format(totalSpend)}</div>
              {editId && can.edit && (
                <button type="button" className="btn" style={{background:'#eee',color:'#222'}} onClick={openAddExpense}>Add Spend</button>
              )}
            </div>
          </div>
          <div className="row" style={{maxWidth: 520}}>
            <label className="block">Images</label>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={(e) => handleSelectImages(e.target.files)} style={{maxWidth:280}} />
              <button type="button" className="btn" style={{background:'#eee', color:'#222'}} onClick={() => editId ? uploadImagesForOpportunity(editId) : null} disabled={!editId || selectedImages.filter(it => !it.uploaded).length === 0 || !can.edit} title={editId ? (selectedImages.filter(it => !it.uploaded).length ? 'Upload pending images' : 'No pending images to upload') : 'Save first to get ID'}>
                Upload
              </button>
              <button type="button" className="btn" style={{background:'#fff', border:'1px solid #e5e7eb', color:'#111'}} onClick={() => { setSelectedImages(prev => { prev.forEach(p => p.url && URL.revokeObjectURL(p.url)); return []; }); if (fileInputRef.current) fileInputRef.current.value=''; }} disabled={selectedImages.length === 0}>
                Clear
              </button>
            </div>
            {imageError ? <div style={{color:'crimson', fontSize:12, marginTop:4}}>{imageError}</div> : null}
            {selectedImages.length > 0 && (
              <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop:8}}>
                {selectedImages.map((it, idx) => (
                  <div key={idx} style={{border:'1px solid #e5e7eb', borderRadius:8, padding:6}}>
                    <div style={{width:100, height:70, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', background:'#fafafa'}}>
                      <img src={it.url} alt={it.file?.name || 'image'} style={{maxWidth:'100%', maxHeight:'100%'}} />
                    </div>
                    <div style={{fontSize:12, marginTop:4, maxWidth:100, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}} title={it.file?.name}>{it.file?.name}</div>
                    {it.uploaded ? <div style={{fontSize:11, color:'#166534', background:'#ecfdf5', border:'1px solid #bbf7d0', padding:'2px 6px', borderRadius:999, display:'inline-block', marginTop:4}}>Uploaded</div> : null}
                    <button type="button" className="btn" style={{background:'#eee', color:'#222', marginTop:4}} onClick={() => removeSelectedImage(idx)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="row">
            <label className="block">Stage</label>
            <select name="stage" value={form.stage} onChange={async (e) => {
              const nextStage = e.target.value;
              const fromStage = form.stage || 'LEAD';
              if (nextStage === fromStage) return;
              // Reason policy: to DISAGREED/CANCELLED or reopen from DISAGREED/CANCELLED
              let reasonRequired = false;
              if (nextStage === 'DISAGREED' || nextStage === 'CANCELLED') reasonRequired = true;
              if ((fromStage === 'DISAGREED' || fromStage === 'CANCELLED') && nextStage !== fromStage) reasonRequired = true;
              if (reasonRequired) {
                setStageModal({ open: true, toStage: nextStage, reasonRequired: true, reasonCode: '', reasonText: '' });
              } else {
                setPendingReason({ code: '', text: '' });
                setForm(f => ({ ...f, stage: nextStage }));
              }
            }}>
              {editId && originalStage === 'AGREED' ? (
                <>
                  <option value="AGREED">AGREED</option>
                  <option value="CANCELLED">CANCELLED</option>
                </>
              ) : (
                <>
                  <option value="LEAD">LEAD</option>
                  <option value="QUALIFIED">QUALIFIED</option>
                  <option value="NEGOTIATION">NEGOTIATION</option>
                  <option value="AGREED">AGREED</option>
                  <option value="DISAGREED">DISAGREED</option>
                  <option value="CANCELLED">CANCELLED</option>
                </>
              )}
            </select>
          </div>
          {/* Loss Reason removed; stage reasons captured via modal when required */}
          <div style={{gridColumn:'1/-1',marginTop:8}}>
            <button className="btn" type="submit" disabled={editId ? (!can.edit || !v.canSubmit) : (!can.create || !v.canSubmit)}>{editId ? 'Update' : 'Create'}</button>
            {editId && (
              <button className="btn" type="button" style={{marginLeft:8}} onClick={() => { setEditId(null); setForm({opportunity_id: '', client_name: '', purpose: '', expected_monthly_volume_l: '', proposed_price_per_litre: '', sector: '', location_url: '', stage: 'LEAD', notes: '', salesperson: '', assignment: 'CUSTOMER', contract_choice: '', loss_reason: '', spend: '',}); setPendingReason({ code: '', text: '' }); setOriginalStage(null); setExpenses([]); }}>Cancel</button>
            )}
          </div>
        </form>

        {editId && (
          <div className="card" style={{marginTop:16}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <h4 style={{margin:0}}>Spend History</h4>
              <div>Total: <strong>{inr.format(totalSpend)}</strong></div>
            </div>
            <table style={{width:'100%',marginTop:8}}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount (₹)</th>
                  <th>Note</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 ? (
                  <tr><td colSpan={4} className="muted">No expenses</td></tr>
                ) : (
                  expenses.map(e => (
                    <tr key={e.id}>
                      <td>{String(e.at).slice(0,10)}</td>
                      <td>{inr.format(e.amount)}</td>
                      <td>{e.note}</td>
                      <td>
                        {can.edit && (
                          <button className="btn" style={{background:'#f1c40f',color:'#222',marginRight:8}} onClick={() => openEditExpense(e)}>Edit</button>
                        )}
                        {can.delete && (
                          <button className="btn" style={{background:'#e74c3c',color:'#fff'}} onClick={() => deleteExpense(e.id)}>Delete</button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{marginTop:32}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <h3 style={{margin:0}}>All Opportunities</h3>
          <div style={{display:'flex',gap:16,alignItems:'center'}}>
            <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={exportCSV}>Export CSV</button>
            <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={printTable}>Print / PDF</button>
          </div>
        </div>
  <div style={{display:'flex',justifyContent:'flex-start',alignItems:'center',gap:8,marginBottom:8, position:'relative'}}>
          <input
            type="text"
            placeholder="Search by Client Name or Opportunity ID"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{padding:'6px 10px',border:'1px solid #ccc',borderRadius:4,minWidth:220}}
          />
          <div style={{display:'inline-flex', alignItems:'center', position:'relative'}}>
            <button type="button" className="btn" style={{background:'#eee', color:'#222'}} onClick={() => { setStageFilterOpen(false); setSalesFilterOpen(false); setSectorFilterTemp(sectorFilterSelected.length ? [...sectorFilterSelected] : [...allSectors]); setSectorFilterSearch(''); setSectorFilterOpen(v => !v); }}>
              Sector Filter ▾ {sectorFilterSelected.length && sectorFilterSelected.length !== allSectors.length ? `(${sectorFilterSelected.length})` : ''}
            </button>
            {sectorFilterOpen && (
              <div style={{position:'absolute', top:'110%', left:0, zIndex:20, background:'#fff', border:'1px solid #e5e7eb', borderRadius:8, padding:8, width:260, boxShadow:'0 10px 25px rgba(0,0,0,0.15)'}} role="dialog" aria-label="Sector Filter">
                <div style={{fontWeight:600, marginBottom:6}}>Text Filters</div>
                <input
                  type="text"
                  placeholder="Search"
                  value={sectorFilterSearch}
                  onChange={e => setSectorFilterSearch(e.target.value)}
                  style={{width:'100%', padding:'6px 8px', border:'1px solid #ddd', borderRadius:4, marginBottom:8}}
                />
                <div style={{maxHeight:200, overflow:'auto', border:'1px solid #eee', borderRadius:6}}>
                  <label style={{display:'flex', alignItems:'center', gap:6, padding:'6px 8px', borderBottom:'1px solid #f3f4f6'}}>
                    <input
                      type="checkbox"
                      checked={sectorFilterTemp.length === allSectors.length}
                      onChange={(e) => {
                        setSectorFilterTemp(e.target.checked ? [...allSectors] : []);
                      }}
                    />
                    <span>(Select All)</span>
                  </label>
                  {allSectors.filter(s => s.toLowerCase().includes(sectorFilterSearch.toLowerCase())).map(opt => (
                    <label key={opt} style={{display:'flex', alignItems:'center', gap:6, padding:'6px 8px'}}>
                      <input
                        type="checkbox"
                        checked={sectorFilterTemp.includes(opt)}
                        onChange={(e) => {
                          setSectorFilterTemp(prev => e.target.checked ? [...prev, opt] : prev.filter(x => x !== opt));
                        }}
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
                <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:8}}>
                  <button className="btn" type="button" onClick={() => { setSectorFilterOpen(false); }}>Cancel</button>
                  <button className="btn" type="button" onClick={() => { setSectorFilterSelected([...sectorFilterTemp]); setSectorFilterOpen(false); }}>OK</button>
                </div>
              </div>
            )}
          </div>

          <div style={{display:'inline-flex', alignItems:'center', position:'relative'}}>
            <button type="button" className="btn" style={{background:'#eee', color:'#222'}} onClick={() => { setSectorFilterOpen(false); setSalesFilterOpen(false); setStageFilterTemp(stageFilterSelected.length ? [...stageFilterSelected] : [...allStages]); setStageFilterSearch(''); setStageFilterOpen(v => !v); }}>
              Stage Filter ▾ {stageFilterSelected.length && stageFilterSelected.length !== allStages.length ? `(${stageFilterSelected.length})` : ''}
            </button>
            {stageFilterOpen && (
              <div style={{position:'absolute', top:'110%', left:0, zIndex:20, background:'#fff', border:'1px solid #e5e7eb', borderRadius:8, padding:8, width:260, boxShadow:'0 10px 25px rgba(0,0,0,0.15)'}} role="dialog" aria-label="Stage Filter">
                <div style={{fontWeight:600, marginBottom:6}}>Text Filters</div>
                <input
                  type="text"
                  placeholder="Search"
                  value={stageFilterSearch}
                  onChange={e => setStageFilterSearch(e.target.value)}
                  style={{width:'100%', padding:'6px 8px', border:'1px solid #ddd', borderRadius:4, marginBottom:8}}
                />
                <div style={{maxHeight:200, overflow:'auto', border:'1px solid #eee', borderRadius:6}}>
                  <label style={{display:'flex', alignItems:'center', gap:6, padding:'6px 8px', borderBottom:'1px solid #f3f4f6'}}>
                    <input
                      type="checkbox"
                      checked={stageFilterTemp.length === allStages.length}
                      onChange={(e) => { setStageFilterTemp(e.target.checked ? [...allStages] : []); }}
                    />
                    <span>(Select All)</span>
                  </label>
                  {allStages.filter(s => s.toLowerCase().includes(stageFilterSearch.toLowerCase())).map(opt => (
                    <label key={opt} style={{display:'flex', alignItems:'center', gap:6, padding:'6px 8px'}}>
                      <input type="checkbox" checked={stageFilterTemp.includes(opt)} onChange={(e) => { setStageFilterTemp(prev => e.target.checked ? [...prev, opt] : prev.filter(x => x !== opt)); }} />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
                <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:8}}>
                  <button className="btn" type="button" onClick={() => { setStageFilterOpen(false); }}>Cancel</button>
                  <button className="btn" type="button" onClick={() => { setStageFilterSelected([...stageFilterTemp]); setStageFilterOpen(false); }}>OK</button>
                </div>
              </div>
            )}
          </div>

          <div style={{display:'inline-flex', alignItems:'center', position:'relative'}}>
            <button type="button" className="btn" style={{background:'#eee', color:'#222'}} onClick={() => { setSectorFilterOpen(false); setStageFilterOpen(false); setSalesFilterTemp(salesFilterSelected.length ? [...salesFilterSelected] : [...allSalespeople]); setSalesFilterSearch(''); setSalesFilterOpen(v => !v); }}>
              Salesperson Filter ▾ {salesFilterSelected.length && salesFilterSelected.length !== allSalespeople.length ? `(${salesFilterSelected.length})` : ''}
            </button>
            {salesFilterOpen && (
              <div style={{position:'absolute', top:'110%', left:0, zIndex:20, background:'#fff', border:'1px solid #e5e7eb', borderRadius:8, padding:8, width:260, boxShadow:'0 10px 25px rgba(0,0,0,0.15)'}} role="dialog" aria-label="Salesperson Filter">
                <div style={{fontWeight:600, marginBottom:6}}>Text Filters</div>
                <input
                  type="text"
                  placeholder="Search"
                  value={salesFilterSearch}
                  onChange={e => setSalesFilterSearch(e.target.value)}
                  style={{width:'100%', padding:'6px 8px', border:'1px solid #ddd', borderRadius:4, marginBottom:8}}
                />
                <div style={{maxHeight:200, overflow:'auto', border:'1px solid #eee', borderRadius:6}}>
                  <label style={{display:'flex', alignItems:'center', gap:6, padding:'6px 8px', borderBottom:'1px solid #f3f4f6'}}>
                    <input
                      type="checkbox"
                      checked={salesFilterTemp.length === allSalespeople.length}
                      onChange={(e) => { setSalesFilterTemp(e.target.checked ? [...allSalespeople] : []); }}
                    />
                    <span>(Select All)</span>
                  </label>
                  {allSalespeople.filter(s => s.toLowerCase().includes(salesFilterSearch.toLowerCase())).map(opt => (
                    <label key={opt} style={{display:'flex', alignItems:'center', gap:6, padding:'6px 8px'}}>
                      <input type="checkbox" checked={salesFilterTemp.includes(opt)} onChange={(e) => { setSalesFilterTemp(prev => e.target.checked ? [...prev, opt] : prev.filter(x => x !== opt)); }} />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
                <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:8}}>
                  <button className="btn" type="button" onClick={() => { setSalesFilterOpen(false); }}>Cancel</button>
                  <button className="btn" type="button" onClick={() => { setSalesFilterSelected([...salesFilterTemp]); setSalesFilterOpen(false); }}>OK</button>
                </div>
              </div>
            )}
          </div>

          <button type="button" className="btn" style={{background:'#fff', border:'1px solid #e5e7eb', color:'#111'}}
            onClick={() => {
              setSectorFilterSelected([]); setStageFilterSelected([]); setSalesFilterSelected([]);
              setSectorFilterSearch(''); setStageFilterSearch(''); setSalesFilterSearch('');
              setSectorFilterOpen(false); setStageFilterOpen(false); setSalesFilterOpen(false);
            }}
            title="Reset all filters"
          >Reset Filters</button>
        </div>
        <table id="opportunitiesTable" style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              {[
                { label: 'Client Name', key: 'client_name' },
                { label: 'Opportunity ID', key: 'opportunity_id' },
                { label: 'Purpose', key: 'purpose' },
                { label: 'Sector', key: 'sector' },
                { label: 'Expected Volume (L)', key: 'expected_monthly_volume_l', isNumber: true },
                { label: 'Proposed Price (₹/L)', key: 'proposed_price_per_litre', isNumber: true },
                { label: 'Stage', key: 'stage' },
                { label: 'Spend', key: 'spend', isNumber: true },
                { label: 'Salesperson', key: 'salesperson' },
                { label: 'Location', key: 'location_url' }
              ].map(col => (
                <th
                  key={col.key}
                  style={{ cursor:'pointer', padding:'8px 10px', textAlign:'left', verticalAlign:'middle', whiteSpace:'nowrap' }}
                  onClick={() => {
                  setSort(s => s.key === col.key ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: col.key, dir: 'asc' });
                }}
                >
                  <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                    {col.label}
                    <SortIcon dir={sort.key === col.key ? sort.dir : undefined} active={sort.key === col.key} />
                  </span>
                </th>
              ))}
              <th style={{ padding:'8px 10px', textAlign:'left', verticalAlign:'middle', whiteSpace:'nowrap' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const filtered = opportunities.filter(o => {
                const textMatch = o.client_name.toLowerCase().includes(search.toLowerCase()) || o.opportunity_id.toLowerCase().includes(search.toLowerCase());
                if (!textMatch) return false;
                const sec = o.sector || '—';
                const st = o.stage || '—';
                const sp = o.salesperson || '—';
                const secOk = (!sectorFilterSelected.length || sectorFilterSelected.length === allSectors.length) ? true : sectorFilterSelected.includes(sec);
                const stOk = (!stageFilterSelected.length || stageFilterSelected.length === allStages.length) ? true : stageFilterSelected.includes(st);
                const spOk = (!salesFilterSelected.length || salesFilterSelected.length === allSalespeople.length) ? true : salesFilterSelected.includes(sp);
                return secOk && stOk && spOk;
              });
              if (filtered.length === 0) return (<tr><td colSpan={9} className="muted">No opportunities</td></tr>);
              const sorted = [...filtered].sort((a,b) => {
                const key = sort.key;
                const dir = sort.dir === 'asc' ? 1 : -1;
                const va = a[key];
                const vb = b[key];
                const isNum = ['expected_monthly_volume_l','proposed_price_per_litre','spend'].includes(key);
                if (isNum) {
                  const na = Number(va) || 0; const nb = Number(vb) || 0;
                  return (na - nb) * dir;
                }
                const sa = String(va || '').toLowerCase();
                const sb = String(vb || '').toLowerCase();
                if (sa < sb) return -1 * dir;
                if (sa > sb) return 1 * dir;
                return 0;
              });
              return sorted.map(o => (
                <tr key={o.opportunity_id}>
                  <td style={{ padding:'8px 10px', verticalAlign:'middle' }}>
                    <span
                      title={o.assignment === 'CONTRACT' ? 'Contract' : 'Customer'}
                      aria-label={o.assignment === 'CONTRACT' ? 'Contract' : 'Customer'}
                      style={{
                        display:'inline-block',
                        width: o.assignment === 'CONTRACT' ? 23 : 18,
                        textAlign:'center',
                        marginRight:8,
                        fontSize: o.assignment === 'CONTRACT' ? 23 : 18,
                        lineHeight:1,
                        verticalAlign:'middle'
                      }}
                    >
                      {o.assignment === 'CONTRACT' ? '★' : '■'}
                    </span>
                    {o.client_name}
                  </td>
                  <td style={{ padding:'8px 10px', verticalAlign:'middle' }}>
                    <a
                      href="#"
                      onClick={(e) => { e.preventDefault(); setProfile({ open: true, opportunityId: o.opportunity_id }); }}
                      title="Open Client Profile"
                      style={{ color:'#2563eb', textDecoration:'underline', cursor:'pointer' }}
                    >
                      {o.opportunity_id}
                    </a>
                  </td>
                  <td style={{ padding:'8px 10px', verticalAlign:'middle' }}>{o.purpose}</td>
                  <td style={{ padding:'8px 10px', verticalAlign:'middle' }}>{o.sector || '—'}</td>
                  <td style={{ padding:'8px 10px', verticalAlign:'middle' }}>{o.expected_monthly_volume_l}</td>
                  <td style={{ padding:'8px 10px', verticalAlign:'middle' }}>{o.proposed_price_per_litre}</td>
                  <td style={{ padding:'8px 10px', verticalAlign:'middle' }}>{o.stage}</td>
                  <td style={{ padding:'8px 10px', verticalAlign:'middle' }}>{o.spend}</td>
                  <td style={{ padding:'8px 10px', verticalAlign:'middle' }}>{o.salesperson}</td>
                  <td style={{ padding:'8px 10px', verticalAlign:'middle' }}>
                    {o.location_url ? (
                      <a href={o.location_url} target="_blank" rel="noreferrer" title="Open in Google Maps" style={{display:'inline-flex',alignItems:'center'}}>
                        <MapPinIcon size={20} />
                      </a>
                    ) : '—'}
                  </td>
                  <td style={{ padding:'8px 10px', verticalAlign:'middle' }}>
                    {can.edit && (
                      <button className="btn" style={{background:'#f1c40f',color:'#222',marginRight:8}} onClick={() => handleEdit(o)}>Edit</button>
                    )}
                    {can.delete && (
                      <button className="btn" style={{background:'#e74c3c',color:'#fff'}} onClick={() => handleDelete(o.opportunity_id)}>Delete</button>
                    )}
                  </td>
                </tr>
              ));
            })()}
          </tbody>
        </table>
      </div>

      {profile.open && (
        <ClientProfileModal
          opportunityId={profile.opportunityId}
          onClose={() => setProfile({ open:false, opportunityId:'' })}
        />
      )}

      {stageModal.open && (
        <div className="overlay" style={{display:'block'}}>
          <div className="modal">
            <div className="modal-header">
              <div style={{fontWeight:600}}>Stage Change Reason</div>
              <button className="btn ghost" type="button" onClick={closeStageModal}>Close</button>
            </div>
            <div className="modal-body">
              {stageModal.reasonRequired && (
                <>
                  <div className="row">
                    <label className="block">Reason Code</label>
                    <select value={stageModal.reasonCode} onChange={e => setStageModal(s => ({...s, reasonCode: e.target.value}))}>
                      <option value="">Select reason</option>
                      {['client_cancelled','price_mismatch','competitor','budget_cut','internal_hold','duplicate','compliance_block','reopen','other'].map(rc => (
                        <option key={rc} value={rc}>{rc}</option>
                      ))}
                    </select>
                  </div>
                  <div className="row">
                    <label className="block">Reason (optional)</label>
                    <textarea rows={3} value={stageModal.reasonText} onChange={e => setStageModal(s => ({...s, reasonText: e.target.value}))} />
                  </div>
                </>
              )}
              <div className="row" style={{marginTop:8}}>
                <button className="btn" type="button" onClick={confirmReasonAndApply}>Confirm</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {expenseModal.open && (
        <div className="overlay" style={{display:'block'}}>
          <div className="modal" style={{maxWidth:520}}>
            <div className="modal-header">
              <div style={{fontWeight:600}}>{expenseModal.id ? 'Edit Expense' : 'Add Expense'}</div>
              <button className="btn ghost" type="button" onClick={closeExpenseModal}>Close</button>
            </div>
            <div className="modal-body">
              <div className="row">
                <label className="block">Amount (₹)</label>
                <input type="number" step="0.01" min="0.01" value={expenseModal.amount} onChange={e => setExpenseModal(m => ({...m, amount: e.target.value}))} />
              </div>
              <div className="row">
                <label className="block">Date</label>
                <input type="date" value={expenseModal.at} onChange={e => setExpenseModal(m => ({...m, at: e.target.value}))} />
              </div>
              <div className="row">
                <label className="block">Note</label>
                <textarea rows={3} value={expenseModal.note} onChange={e => setExpenseModal(m => ({...m, note: e.target.value}))} />
              </div>
              <div className="row" style={{marginTop:8}}>
                <button className="btn" type="button" onClick={saveExpense}>Save</button>
                <button className="btn ghost" type="button" style={{marginLeft:8}} onClick={closeExpenseModal}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Opportunities;