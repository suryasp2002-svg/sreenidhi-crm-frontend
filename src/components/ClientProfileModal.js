import React, { useEffect, useState } from 'react';

export default function ClientProfileModal({ opportunityId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  // Owners should also see assignee/creator chips in Meetings/Reminders
  const [canSeeAssignee, setCanSeeAssignee] = useState(false);
  const [images, setImages] = useState([]);
  const [imgError, setImgError] = useState('');
  const [imgLoading, setImgLoading] = useState(false);

  const MapPinIcon = ({ size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <path d="M12 22s7-7.58 7-12a7 7 0 1 0-14 0c0 4.42 7 12 7 12z" fill="#EA4335"/>
      <circle cx="12" cy="10" r="3.2" fill="#FFFFFF"/>
    </svg>
  );

  useEffect(() => {
    let aborted = false;
    async function load() {
      try {
        setLoading(true); setError('');
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const res = await fetch(`/api/client-profile/${encodeURIComponent(opportunityId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined
        });
        if (!res.ok) {
          let t = null;
          try { t = await res.json(); } catch {}
          const msg = (t && (t.error || t.message)) || `${res.status} ${res.statusText}`;
          throw new Error(msg || 'Failed to load client profile');
        }
        const body = await res.json();
        if (!aborted) setData(body);
      } catch (e) {
        if (!aborted) setError(e.message || String(e));
      } finally {
        if (!aborted) setLoading(false);
      }
    }
    load();
    return () => { aborted = true; };
  }, [opportunityId]);

  // Load images
  useEffect(() => {
    let aborted = false;
    async function loadImages() {
      try {
        setImgLoading(true); setImgError('');
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const res = await fetch(`/api/opportunities/${encodeURIComponent(opportunityId)}/images`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
        if (!res.ok) {
          // If images feature not enabled, do not surface error to the user
          if (res.status === 404 || res.status === 501) { setImages([]); return; }
          throw new Error('Failed to load images');
        }
        const list = await res.json();
        if (!aborted) setImages(Array.isArray(list) ? list : []);
      } catch (e) {
        // Swallow errors when images feature isn't available
        if (!aborted) setImgError('');
      } finally { if (!aborted) setImgLoading(false); }
    }
    if (opportunityId) loadImages();
    return () => { aborted = true; };
  }, [opportunityId]);

  async function uploadImage(file) {
    try {
      setImgError('');
      if (!file) return;
      if (!/^image\//.test(file.type)) { setImgError('Only image files allowed'); return; }
      if (file.size > 5 * 1024 * 1024) { setImgError('File too large (max 5MB)'); return; }
      const b64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(new Error('Failed to read file'));
        fr.readAsDataURL(file);
      });
      const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      const res = await fetch(`/api/opportunities/${encodeURIComponent(opportunityId)}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type, dataBase64: b64 })
      });
      if (!res.ok) {
        const t = await res.json().catch(() => ({}));
        if (res.status === 501) { setImgError(''); return; }
        throw new Error(t.error || 'Upload failed');
      }
      // reload list
      const list = await (await fetch(`/api/opportunities/${encodeURIComponent(opportunityId)}/images`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })).json();
      setImages(Array.isArray(list) ? list : []);
    } catch (e) {
      setImgError(e.message || String(e));
    }
  }

  async function deleteImage(imageId) {
    if (!window.confirm('Delete this image?')) return;
    try {
      const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      const res = await fetch(`/api/opportunities/${encodeURIComponent(opportunityId)}/images/${encodeURIComponent(imageId)}`, {
        method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : undefined
      });
      if (!res.ok) throw new Error('Failed to delete');
      setImages(imgs => imgs.filter(i => i.id !== imageId));
    } catch (e) { setImgError(e.message || String(e)); }
  }

  // Fetch current user to determine role
  useEffect(() => {
    let aborted = false;
    async function loadMe() {
      try {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        if (!token) return;
        const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const me = await res.json();
        if (!aborted) {
          const role = String(me.role || '').toUpperCase();
          setIsAdmin(role === 'ADMIN'); // keep admin-only debug badges in header
          setCanSeeAssignee(role === 'ADMIN' || role === 'OWNER');
        }
      } catch {}
    }
    loadMe();
    return () => { aborted = true; };
  }, []);

  // Helpers
  const formatNumber = (val) => {
    if (val === null || val === undefined || val === '') return '—';
    const n = typeof val === 'number' ? val : Number(val);
    if (!Number.isFinite(n)) return String(val);
    // Use Indian numbering format which matches rupee style
    return n.toLocaleString('en-IN');
  };

  const formatDate = (d) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString(); } catch { return String(d); }
  };

  const Section = ({ title, children }) => (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ fontWeight: 700, margin: '8px 4px' }}>{title}</div>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#fff', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );

  const Row = ({ label, value }) => (
    <div style={{display:'flex', gap:8, margin:'6px 0'}}>
      <div style={{minWidth:140, color:'#6b7280'}}>{label}</div>
      <div style={{fontWeight:600}}>{value ?? '—'}</div>
    </div>
  );

  const derivePanelKind = (rp) => {
    if (!rp) return 'CUSTOMER';
    // Prefer actual data presence over label to avoid mislabeling
    if (rp.customer) return 'CUSTOMER';
    if (rp.contract) return 'CONTRACT';
    return rp.kind || 'CUSTOMER';
  };
  const normalizeAssignment = (val) => {
    if (!val) return '—';
    const v = String(val).trim().toUpperCase();
    if (v === 'CUSTOMER' || v === 'CONTRACT') return v;
    return '—';
  };

  return (
    <div
      className="overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div
        className="modal"
        style={{
          maxWidth: 1100,
          width: 'min(1100px, 96vw)',
          maxHeight: '85vh',
          overflowY: 'auto',
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Client Profile"
      >
        <div className="modal-header" style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:12, borderBottom:'1px solid #e5e7eb'}}>
          <div style={{fontWeight:800, display:'flex', alignItems:'center', gap:8}}>
            <span>Client Profile — {opportunityId}</span>
            {isAdmin && !loading && !error && data ? (
              <span style={{display:'inline-flex', alignItems:'center', gap:6}}>
                <span title="Assignment" style={{fontSize:12, padding:'2px 6px', borderRadius:999, background:'#eef2ff', color:'#3730a3', border:'1px solid #c7d2fe'}}>{normalizeAssignment(data.opportunity?.assignment)}</span>
                <span title="Resolved Panel" style={{fontSize:12, padding:'2px 6px', borderRadius:999, background:'#f0fdf4', color:'#166534', border:'1px solid #bbf7d0'}}>{derivePanelKind(data.rightPanel)}</span>
              </span>
            ) : null}
          </div>
          <button className="btn ghost" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body" style={{padding:12}}>
          {loading && <div className="muted">Loading…</div>}
          {error && <div style={{color:'#b91c1c'}}>{error}</div>}
          {!loading && !error && data && (
            <div>
              <div className="grid cols-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'stretch' }}>
                <Section title="Details">
                  <Row label="Name" value={data.details?.client_name} />
                  <Row label="Primary Contact" value={data.details?.primary_contact} />
                  <Row label="Phone" value={data.details?.phone} />
                  <Row label="Email" value={data.details?.email} />
                  <Row label="Salesperson" value={data.details?.salesperson} />
                  <Row label="Sector" value={data.opportunity?.sector || '—'} />
                  <div style={{display:'flex', gap:8, margin:'6px 0'}}>
                    <div style={{minWidth:140, color:'#6b7280'}}>Location</div>
                    <div style={{fontWeight:600}}>
                      {data.opportunity?.location_url ? (
                        <a href={data.opportunity.location_url} target="_blank" rel="noreferrer" title="Open in Google Maps" style={{display:'inline-flex',alignItems:'center'}}>
                          <MapPinIcon size={20} />
                        </a>
                      ) : '—'}
                    </div>
                  </div>
                </Section>
                <Section title={derivePanelKind(data.rightPanel) === 'CUSTOMER' ? 'Customer' : 'Contracts'}>
                  {derivePanelKind(data.rightPanel) === 'CUSTOMER' ? (
                    data.rightPanel?.customer ? (
                      <div>
                        <Row label="Customer ID" value={data.rightPanel.customer.customer_id} />
                        {data.rightPanel.customer.gstin ? (
                          <Row label="GST" value={data.rightPanel.customer.gstin} />
                        ) : null}
                        <Row label="Expected Monthly Volume (L)" value={formatNumber(data.rightPanel.customer.expected_monthly_volume_l)} />
                        <Row label="Status" value={data.rightPanel.customer.customer_status || '—'} />
                      </div>
                    ) : (
                      <div className="muted">No customer</div>
                    )
                  ) : (
                    data.rightPanel?.contract ? (
                      <div>
                        <Row label="Contract ID" value={data.rightPanel.contract.contract_id} />
                        <Row label="GST" value={data.rightPanel.contract.gstin || '—'} />
                        <Row label="Start Date" value={formatDate(data.rightPanel.contract.start_date)} />
                        <Row label="End Date" value={formatDate(data.rightPanel.contract.end_date)} />
                        <Row label="Credit" value={data.rightPanel.contract.credit_period ?? '—'} />
                        <Row label="Status" value={data.rightPanel.contract.contract_status || '—'} />
                      </div>
                    ) : (
                      <div className="muted">No contracts</div>
                    )
                  )}
                </Section>
              </div>

              <Section title="Opportunities">
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%', borderCollapse:'collapse'}}>
                    <thead>
                      <tr>
                        <th style={{textAlign:'left', padding:'8px'}}>Purpose</th>
                        <th style={{textAlign:'left', padding:'8px'}}>Stage</th>
                        <th style={{textAlign:'left', padding:'8px'}}>₹/L</th>
                        <th style={{textAlign:'left', padding:'8px'}}>Spend</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{padding:'8px'}}>{data.opportunity?.purpose || '—'}</td>
                        <td style={{padding:'8px'}}>{data.opportunity?.stage || '—'}</td>
                        <td style={{padding:'8px'}}>{data.opportunity?.proposed_price_per_litre ?? '—'}</td>
                        <td style={{padding:'8px'}}>{data.opportunity?.spend ?? 0}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Section>

              <Section title="Images">
                <div>
                  <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
                    <input type="file" accept="image/*" onChange={e => uploadImage(e.target.files && e.target.files[0])} />
                    {imgLoading ? <span className="muted">Loading…</span> : null}
                    {imgError ? <span style={{color:'crimson'}}>{imgError}</span> : null}
                  </div>
                  {images.length === 0 ? (
                    <div className="muted">No images</div>
                  ) : (
                    <div style={{display:'flex', flexWrap:'wrap', gap:12}}>
                      {images.map(img => (
                        <div key={img.id} style={{border:'1px solid #e5e7eb', borderRadius:8, padding:8}}>
                          <div style={{width:160, height:120, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', background:'#fafafa'}}>
                            <img src={`/api/opportunities/${encodeURIComponent(opportunityId)}/images/${encodeURIComponent(img.id)}`} alt={img.file_name || 'image'} style={{maxWidth:'100%', maxHeight:'100%'}} />
                          </div>
                          <div style={{fontSize:12, marginTop:6}}>{img.file_name || '(unnamed)'} · {(img.file_size_bytes/1024).toFixed(0)} KB</div>
                          <div style={{marginTop:6}}>
                            <a className="btn" href={`/api/opportunities/${encodeURIComponent(opportunityId)}/images/${encodeURIComponent(img.id)}`} target="_blank" rel="noreferrer" style={{background:'#eee', color:'#222', marginRight:6}}>Open</a>
                            <button className="btn" style={{background:'#e74c3c', color:'#fff'}} onClick={() => deleteImage(img.id)}>Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Section>

              <div className="grid cols-2" style={{gap:16}}>
                <Section title={<span style={{display:'inline-flex', alignItems:'center', gap:8}}>
                  <span>Meetings</span>
                  <span style={{fontSize:12, padding:'2px 8px', borderRadius:999, background:'#f5f3ff', color:'#6d28d9', border:'1px solid #ddd6fe'}}>Upcoming 7 days</span>
                </span>}>
                  {(!data.meetings || data.meetings.length === 0) ? (
                    <div className="muted">No meetings</div>
                  ) : (
                    <ul style={{margin:0, paddingLeft:18}}>
                      {data.meetings.map(m => (
                        <li key={m.id} style={{margin:'6px 0'}}>
                          <span style={{fontWeight:600}}>{m.subject || 'Meeting'}</span>
                          <span className="muted"> — {new Date(m.starts_at).toLocaleString()}</span>
                          {m.location ? <span className="muted"> · {m.location}</span> : null}
                          <span className="muted"> · {m.status}</span>
                          {(canSeeAssignee) && (
                            <>
                              {m.assigned_to ? <span title="Assigned To" style={{marginLeft:6, fontSize:12, padding:'1px 6px', borderRadius:999, background:'#eef2ff', color:'#3730a3', border:'1px solid #c7d2fe'}}>{m.assigned_to}</span> : null}
                              {m.created_by && m.created_by !== m.assigned_to ? <span title="Created By" style={{marginLeft:6, fontSize:12, padding:'1px 6px', borderRadius:999, background:'#ecfdf5', color:'#166534', border:'1px solid #bbf7d0'}}>{m.created_by}</span> : null}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
                <Section title={<span style={{display:'inline-flex', alignItems:'center', gap:8}}>
                  <span>Reminders</span>
                  <span style={{fontSize:12, padding:'2px 8px', borderRadius:999, background:'#f5f3ff', color:'#6d28d9', border:'1px solid #ddd6fe'}}>Upcoming 7 days</span>
                </span>}>
                  {(!data.reminders || data.reminders.length === 0) ? (
                    <div className="muted">No reminders</div>
                  ) : (
                    <ul style={{margin:0, paddingLeft:18}}>
                      {data.reminders.map(r => (
                        <li key={r.id} style={{margin:'6px 0'}}>
                          <span style={{fontWeight:600}}>{r.title || (r.type + ' reminder')}</span>
                          <span className="muted"> — {new Date(r.due_ts).toLocaleString()}</span>
                          <span className="muted"> · {r.type}</span>
                          <span className="muted"> · {r.status}</span>
                          {(canSeeAssignee) && (
                            <>
                              {r.created_by ? <span title="Created By" style={{marginLeft:6, fontSize:12, padding:'1px 6px', borderRadius:999, background:'#ecfdf5', color:'#166534', border:'1px solid #bbf7d0'}}>{r.created_by}</span> : null}
                              {/* If reminder is linked to a meeting, show its assignee for Owner/Admin */}
                              {r.assigned_to ? <span title="Assigned To" style={{marginLeft:6, fontSize:12, padding:'1px 6px', borderRadius:999, background:'#eef2ff', color:'#3730a3', border:'1px solid #c7d2fe'}}>{r.assigned_to}</span> : null}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
