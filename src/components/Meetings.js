import React, { useEffect, useMemo, useRef, useState } from 'react';
import useValidation from '../utils/useValidation';
import { isAdmin } from '../utils/auth';
import { uniqueSeed, futureDate, timePlusMinutes } from '../utils/autofill';

// Simple currency/date helpers
function fmtDateTime(dt) {
  if (!dt) return '';
  try {
    const d = new Date(dt);
    if (isNaN(d.getTime())) return String(dt);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return String(dt);
  }
}

// Consistent local date parsing like Reminders
function asDate(v) {
  if (v instanceof Date) return v;
  const s = String(v || '');
  if (!s) return new Date(NaN);
  if (/Z|[+-]\d{2}:\d{2}$/.test(s)) return new Date(s);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, Y, Mo, Da, H, Mi, S] = m;
    return new Date(+Y, +Mo - 1, +Da, +H, +Mi, +(S || 0), 0);
  }
  return new Date(s);
}

function formatDhm(diffMs) {
  const abs = Math.abs(diffMs);
  const d = Math.floor(abs / 86400000);
  const remD = abs % 86400000;
  const h = Math.floor(remD / 3600000);
  const m = Math.floor((remD % 3600000) / 60000);
  const mm = String(m).padStart(2, '0');
  return `${d}d-${h}hr-${mm}m`;
}

function dueLeftInfo(when) {
  const t = asDate(when);
  const now = new Date();
  const diff = t.getTime() - now.getTime();
  const hm = formatDhm(diff);
  return { state: diff < 0 ? 'past' : (diff === 0 ? 'now' : 'future'), hm };
}

function buildStartsAt(dateStr, timeStr) {
  if (!dateStr || !timeStr) return '';
  return `${dateStr} ${timeStr}:00`;
}

const STATUS_LIST = ['SCHEDULED','COMPLETED','CANCELLED','NO_SHOW','RESCHEDULED'];

export default function Meetings({ perms }) {
  // Filters and paging
  const [q, setQ] = useState('');
  // Default: show all statuses
  const [status, setStatus] = useState([...STATUS_LIST]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [assignedToUserIdFilter, setAssignedToUserIdFilter] = useState('');
  // Assigned To filter combobox (for EMPLOYEE search)
  const [assignedOpen, setAssignedOpen] = useState(false);
  const [assignedOpts, setAssignedOpts] = useState([]);
  const [assignedLoading, setAssignedLoading] = useState(false);
  const [assignedError, setAssignedError] = useState('');
  const [assignedActiveIndex, setAssignedActiveIndex] = useState(-1);
  // Keep active option in view when navigating with keyboard
  useEffect(() => {
    if (!assignedOpen) return;
    if (assignedActiveIndex < 0) return;
    const el = document.getElementById(`assigned-opt-${assignedActiveIndex}`);
    if (el && el.scrollIntoView) {
      try { el.scrollIntoView({ block: 'nearest' }); } catch {}
    }
  }, [assignedActiveIndex, assignedOpen]);
  const [sort, setSort] = useState('starts_at_desc');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Data
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusModal, setStatusModal] = useState({ open: false, toStatus: '', note: '', meetingId: '' });
  const [statusSelectValue, setStatusSelectValue] = useState('');
  const [pendingStatus, setPendingStatus] = useState({ toStatus: '', note: '' });
  // Email preview/send modal state
  const [emailModal, setEmailModal] = useState({ open: false, to: '', cc: '', subject: '', html: '', meetingId: '', loading: false, error: '', sent: false, clientEmail: '', includeClient: true });
  // AbortController for list fetching (latest-request-wins)
  const listCtrlRef = useRef(null);

  // Authenticated user (for role-aware UI)
  const [currentUser, setCurrentUser] = useState(null); // { id, email, username, full_name, role }
  const [isAdminUser, setIsAdminUser] = useState(false);
  useEffect(() => {
    const token = localStorage.getItem('authToken') || localStorage.getItem('token');
    if (!token) return;
    fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
      .then(r => r.ok ? r.json() : null)
      .then(u => {
        if (u && u.id) setCurrentUser(u);
      })
      .catch(()=>{});
    (async () => { try { setIsAdminUser(await isAdmin()); } catch { setIsAdminUser(false); } })();
  }, []);

  // Form state
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({
    id: '',
    customer_id: '',
    opportunity_id: '',
    contract_id: '',
    subject: '',
    date: '',
    time: '',
    location: '',
    meeting_link: '',
    person_name: '',
    contact_phone: '',
    notes: '',
    status: 'SCHEDULED',
    assigned_to: '',
    assigned_to_user_id: '',
    created_by: ''
  });
  const v = useValidation(form, {
    opportunity_id: { required: true },
    subject: { required: true },
    date: { required: true },
    time: { required: true },
    person_name: { required: true },
  }, { debounceMs: 150 });

  // Assignee options for OWNER (and ADMIN if needed later)
  const [assigneeOptions, setAssigneeOptions] = useState([]);
  const [assigneeLoading, setAssigneeLoading] = useState(false);
  const [assigneeError, setAssigneeError] = useState('');

  useEffect(() => {
    // Prepare Assigned To options and defaults for all roles (EMPLOYEE/OWNER/ADMIN)
    if (!currentUser) return;
    let aborted = false;
    async function loadAssignees() {
      setAssigneeLoading(true); setAssigneeError('');
      try {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const auth = token ? { Authorization: 'Bearer ' + token } : {};
        const rolesParam = currentUser.role === 'ADMIN' ? 'OWNER,EMPLOYEE,ADMIN' : 'OWNER,EMPLOYEE';
        const r = await fetch(`/api/users-lookup?roles=${rolesParam}`, { headers: auth });
        const data = await r.json();
        if (aborted) return;
        if (!r.ok) throw new Error(data?.error || 'Failed to load users');
        let list = (Array.isArray(data) ? data : []);
        // For non-admin roles, only OWNER/EMPLOYEE should be visible
        if (currentUser.role !== 'ADMIN') {
          list = list.filter(u => (u.role === 'OWNER' || u.role === 'EMPLOYEE'));
        }
        // Exclude self to avoid duplication with explicit "Myself" option
        if (currentUser?.id) {
          list = list.filter(u => u.id !== currentUser.id);
        }
        // Sort by role priority (ADMIN, EMPLOYEE, OWNER) then by username
        const roleRank = (r) => (r === 'ADMIN' ? 0 : r === 'EMPLOYEE' ? 1 : r === 'OWNER' ? 2 : 3);
        list.sort((a,b) => {
          const rr = roleRank(a.role) - roleRank(b.role);
          if (rr !== 0) return rr;
          const ua = String(a.username || '').toLowerCase();
          const ub = String(b.username || '').toLowerCase();
          if (ua < ub) return -1; if (ua > ub) return 1; return 0;
        });
        setAssigneeOptions(list);
        // Default to self when creating (not editing) if not already set
        setForm(f => {
          if (!f.assigned_to_user_id && !aborted && !editId && currentUser?.id) {
            return { ...f, assigned_to_user_id: currentUser.id, assigned_to: currentUser.username || '' };
          }
          return f;
        });
      } catch (e) {
        if (!aborted) setAssigneeError(String(e.message || e));
      } finally {
        if (!aborted) setAssigneeLoading(false);
      }
    }
    loadAssignees();
    return () => { aborted = true; };
  }, [currentUser, editId]);

  // Search users for Assigned To filter (EMPLOYEE view uses combobox)
  async function searchUsers(qstr) {
    setAssignedLoading(true); setAssignedError('');
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('authToken');
      const auth = token ? { 'Authorization': `Bearer ${token}` } : {};
      const url = qstr && qstr.trim().length
        ? `/api/users-lookup?roles=OWNER,EMPLOYEE&q=${encodeURIComponent(qstr)}&limit=20`
        : `/api/users-lookup?roles=OWNER,EMPLOYEE&limit=20`;
      const r = await fetch(url, { headers: auth });
      const data = await r.json().catch(() => []);
      if (!r.ok) throw new Error(data?.error || 'Failed to load users');
      setAssignedOpts(Array.isArray(data) ? data : []);
    } catch (e) {
      setAssignedError(String(e.message || e));
      setAssignedOpts([]);
    } finally {
      setAssignedLoading(false);
    }
  }

  useEffect(() => {
    if (!assignedOpen) return;
    const qstr = (assignedTo || '').trim();
    const t = setTimeout(() => searchUsers(qstr), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedTo, assignedOpen]);

  // Client lookup state
  const [clientQuery, setClientQuery] = useState('');
  const [clientOptions, setClientOptions] = useState([]);
  const [clientOpen, setClientOpen] = useState(false);
  const [clientLoading, setClientLoading] = useState(false);

  async function searchClients(qstr) {
    setClientLoading(true);
    try {
      const res = await fetch(`/api/clients-lookup?q=${encodeURIComponent(qstr)}&limit=20`);
      if (!res.ok) throw new Error('Failed to search clients');
      const data = await res.json();
      setClientOptions(Array.isArray(data) ? data : []);
    } catch (e) {
      // swallow errors to not interrupt typing UX
    } finally {
      setClientLoading(false);
    }
  }

  useEffect(() => {
    if (!clientOpen) return;
    const qstr = clientQuery.trim();
    const t = setTimeout(() => searchClients(qstr), 200);
    return () => clearTimeout(t);
  }, [clientQuery, clientOpen]);

  function chooseClient(opt) {
    setClientOpen(false);
    const label = `${opt.client_name} — ${opt.opportunity_id}` + (opt.contract_id ? ` • ${opt.contract_id}` : '');
    setClientQuery(label);
    // Populate IDs based on entity type
    if (opt.entity_type === 'CONTRACT') {
      setForm(f => ({
        ...f,
        customer_id: opt.customer_id || f.customer_id, // best-effort backfill
        opportunity_id: opt.opportunity_id,
        contract_id: opt.contract_id || ''
      }));
    } else {
      setForm(f => ({
        ...f,
        customer_id: opt.customer_id,
        opportunity_id: opt.opportunity_id,
        contract_id: opt.contract_id || ''
      }));
    }
  }

  function resetForm() {
    setEditId(null);
    setForm({ id: '', customer_id: '', opportunity_id: '', contract_id: '', subject: '', date: '', time: '', location: '', meeting_link: '', person_name: '', contact_phone: '', notes: '', status: 'SCHEDULED', assigned_to: '', assigned_to_user_id: '', created_by: '' });
    setStatusSelectValue('');
    setPendingStatus({ toStatus: '', note: '' });
    // Re-apply default for employee
    if (currentUser && currentUser.role === 'EMPLOYEE') {
      const label = currentUser.full_name || currentUser.username || currentUser.email || '';
      setForm(f => ({ ...f, assigned_to: label, assigned_to_user_id: currentUser.id }));
    }
  }

  async function fetchMeetings() {
    setLoading(true);
    setError('');
    // Cancel any in-flight request
    if (listCtrlRef.current) {
      try { listCtrlRef.current.abort(); } catch {}
    }
    const ctrl = new AbortController();
    listCtrlRef.current = ctrl;
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status && status.length) params.set('status', status.join(','));
    if (dateFrom) params.set('dateFrom', `${dateFrom} 00:00:00`);
    if (dateTo) params.set('dateTo', `${dateTo} 23:59:59`);
    if (assignedToUserIdFilter) {
      params.set('assignedToUserId', assignedToUserIdFilter);
    } else if (assignedTo) {
      params.set('assignedTo', assignedTo);
    }
  // Single unified search covers client name, subject, location, and IDs
  if (sort === 'starts_at_asc') params.set('sort', 'starts_at_asc');
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('authToken');
      const auth = token ? { 'Authorization': `Bearer ${token}` } : {};
      const res = await fetch(`/api/meetings?${params.toString()}`, { headers: auth, signal: ctrl.signal });
      if (!res.ok) throw new Error('Failed to load meetings');
      const data = await res.json();
      if (listCtrlRef.current === ctrl) {
        setItems(Array.isArray(data.items) ? data.items : []);
      }
    } catch (e) {
      if (e && (e.name === 'AbortError' || e.code === 20)) return;
      setError(e.message || String(e));
    } finally {
      if (listCtrlRef.current && listCtrlRef.current.signal && listCtrlRef.current.aborted) {
        // newer request is active; don't flip loading here
      } else {
        setLoading(false);
      }
    }
  }

  useEffect(() => { fetchMeetings(); /* eslint-disable-next-line */ }, [page, sort]);

  // Dynamically apply filters with a short debounce
  useEffect(() => {
    const t = setTimeout(() => {
      if (page !== 1) {
        setPage(1);
      } else {
        fetchMeetings();
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, dateFrom, dateTo, assignedTo, assignedToUserIdFilter, status]);

  // Abort pending list request on unmount
  useEffect(() => () => {
    try { if (listCtrlRef.current) listCtrlRef.current.abort(); } catch {}
  }, []);

  // Filters auto-apply; no manual Apply button needed

  function toggleStatus(s) {
    setStatus(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  async function saveMeeting(e) {
    e.preventDefault();
    setError('');
    const token = localStorage.getItem('authToken');
    const auth = token ? { Authorization: 'Bearer ' + token } : {};
    const starts_at = buildStartsAt(form.date, form.time);
    if (!v.validateAll()) return;
    const payload = {
      id: form.id || undefined,
      customer_id: form.customer_id || undefined,
      opportunity_id: form.opportunity_id || undefined,
      contract_id: form.contract_id || undefined,
      subject: form.subject.trim(),
      starts_at,
      location: form.location || undefined,
      meeting_link: form.meeting_link || undefined,
      person_name: form.person_name || undefined,
      contact_phone: form.contact_phone || undefined,
      // status/notes handled separately for status transitions
      assigned_to: form.assigned_to || undefined,
      assignedToUserId: form.assigned_to_user_id || undefined,
      created_by: form.created_by || undefined
    };
    try {
      let res;
      if (editId) {
        // First save base details (no status transition yet)
        res = await fetch(`/api/meetings/${editId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(payload) });
        if (!res.ok) {
          const t = await res.json().catch(() => ({}));
          throw new Error(t.error || 'Failed to save meeting');
        }
        // If a status change was staged, apply it now
        if (pendingStatus.toStatus) {
          const to = pendingStatus.toStatus;
          const note = (pendingStatus.note || '').trim();
          if (!note) {
            setError('Outcome/Reason is required for status change');
            return;
          }
          if (to === 'CANCELLED') {
            const r = await fetch(`/api/meetings/${editId}/cancel`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ reason: note, performed_by: 'user' }) });
            if (!r.ok) throw new Error('Failed to cancel meeting');
          } else if (to === 'COMPLETED') {
            const r = await fetch(`/api/meetings/${editId}/complete`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ performed_by: 'user', outcome: note }) });
            if (!r.ok) throw new Error('Failed to complete meeting');
          } else if (to === 'NO_SHOW' || to === 'RESCHEDULED') {
            const cur = items.find(m => m.id === editId);
            const prefix = to === 'NO_SHOW' ? 'No-Show' : 'Rescheduled';
            const newNotes = note ? `${cur?.notes ? cur.notes + '\n' : ''}${prefix}: ${note}` : cur?.notes;
            const r = await fetch(`/api/meetings/${editId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ status: to, notes: newNotes, outcomeNotes: note }) });
            if (!r.ok) throw new Error('Failed to update status');
          }
        }
      } else {
        // Create always starts as SCHEDULED
        const createPayload = { ...payload, status: 'SCHEDULED' };
        if (!createPayload.assignedToUserId && currentUser && currentUser.id) {
          createPayload.assignedToUserId = currentUser.id;
        }
        res = await fetch('/api/meetings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(createPayload) });
      }
      if (!res.ok) {
        const t = await res.json().catch(() => ({}));
        throw new Error(t.error || 'Failed to save meeting');
      }
      // Refresh and clear staged status
      await fetchMeetings();
      setPendingStatus({ toStatus: '', note: '' });
      resetForm();
    } catch (e2) {
      setError(String(e2.message || e2));
    }
  }

  function onEdit(m) {
    // Split starts_at into date/time
    let date = '', time = '';
    if (m.starts_at) {
      const d = new Date(m.starts_at);
      if (!isNaN(d.getTime())) {
        date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      }
    }
    setEditId(m.id);
    setForm({
      id: m.id,
      customer_id: m.customer_id || '',
      opportunity_id: m.opportunity_id || '',
      contract_id: m.contract_id || '',
      subject: m.subject || '',
      date, time,
      location: m.location || '',
      meeting_link: m.meeting_link || '',
      person_name: m.person_name || '',
      contact_phone: m.contact_phone || '',
      notes: m.notes || '',
      status: m.status || 'SCHEDULED',
      assigned_to: (m.assigned_to_full_name || m.assigned_to_username || m.assigned_to_email || m.assigned_to || ''),
      assigned_to_user_id: m.assigned_to_user_id || '',
      created_by: m.created_by || ''
    });
    setClientQuery(`${m.client_name || ''}${m.client_name ? ' — ' : ''}${m.opportunity_id || ''}`);
    setStatusSelectValue('');
    setPendingStatus({ toStatus: '', note: '' });
  }

  // completeMeeting and deleteMeeting quick-actions removed; use status modal via Edit flow

  function exportCSV() {
    if (!items.length) return;
    const headers = ['Opportunity ID','Client Name','Subject','Date & Time','Location','Assigned To','Status'];
    const rows = items.map(m => [m.opportunity_id || '', m.client_name || '', m.subject || '', fmtDateTime(m.starts_at || m.when_ts), m.location || '', m.assigned_to || '', m.status || '']);
    const csv = [headers, ...rows].map(r => r.map(x => `"${String(x ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'meetings.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function printTable() {
    const html = document.getElementById('meetingsTable')?.outerHTML || '';
    const win = window.open('', '', 'height=700,width=900');
    win.document.write('<html><head><title>Meetings</title><style>table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left;}th{background:#f5f5f5;} .brand{display:flex;align-items:center;gap:10px;margin:8px 0 12px;} .brand img{border-radius:50%;object-fit:cover}</style></head><body>');
    win.document.write('<div class="brand"><img src="/assets/branding/logo.png" alt="Logo" width="36" height="36"/><div style="font-weight:800">Sreenidhi CRM — Meetings</div></div>');
    win.document.write(html);
    win.document.write('</body></html>');
    win.document.close();
    win.print();
  }

  // Open email preview modal for a meeting
  async function openEmailModal(meeting) {
    const token = localStorage.getItem('token') || localStorage.getItem('authToken');
    const auth = token ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  setEmailModal({ open: true, to: '', cc: '', subject: '', html: '', meetingId: meeting.id, loading: true, error: '', sent: false, clientEmail: '', includeClient: true });
    try {
  const r = await fetch('/api/email/preview/meeting', { method: 'POST', headers: auth, body: JSON.stringify({ meetingId: meeting.id }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Failed to build email preview');
      const assigneeEmail = meeting.assigned_to_email || '';
      const defaultTo = assigneeEmail || ((currentUser && currentUser.email) ? currentUser.email : '');
      setEmailModal({ open: true, to: defaultTo, cc: '', subject: data.subject || `Meeting: ${meeting.client_name || ''}`, html: data.html || '', meetingId: meeting.id, loading: false, error: '', sent: false, clientEmail: data.clientEmail || '', includeClient: !!(data.clientEmail) });
    } catch (e) {
      setEmailModal({ open: true, to: '', cc: '', subject: '', html: '', meetingId: meeting.id, loading: false, error: String(e.message || e), sent: false });
    }
  }

  async function sendEmailFromModal() {
    const token = localStorage.getItem('token') || localStorage.getItem('authToken');
    const auth = token ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
    let toList = (emailModal.to || '').split(',').map(s => s.trim()).filter(Boolean);
    const ccList = (emailModal.cc || '').split(',').map(s => s.trim()).filter(Boolean);
    // Optionally include client email
    if (emailModal.includeClient && emailModal.clientEmail) {
      const exists = toList.some(x => x.toLowerCase() === emailModal.clientEmail.toLowerCase());
      if (!exists) toList = [...toList, emailModal.clientEmail];
    }
    if (!toList.length) {
      setEmailModal(mod => ({ ...mod, error: 'Please add at least one recipient in To' }));
      return;
    }
    setEmailModal(mod => ({ ...mod, loading: true, error: '' }));
    try {
      const r = await fetch('/api/email/send', { method: 'POST', headers: auth, body: JSON.stringify({ to: toList, cc: ccList, subject: emailModal.subject || 'Meeting', html: emailModal.html || '<p>(no content)</p>', meetingId: emailModal.meetingId }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || 'Failed to send email');
  setEmailModal({ open: false, to: '', cc: '', subject: '', html: '', meetingId: '', loading: false, error: '', sent: true });
  // Refresh list to reflect updated emails sent count
  try { await fetchMeetings(); } catch {}
    } catch (e) {
      setEmailModal(mod => ({ ...mod, loading: false, error: String(e.message || e) }));
    }
  }

  async function sendTestEmailToMe() {
    if (!currentUser || !currentUser.email) return;
    const token = localStorage.getItem('token') || localStorage.getItem('authToken');
    const auth = token ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
    try {
      const now = new Date();
      const r = await fetch('/api/email/send', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          to: [currentUser.email],
          subject: `Test Email – CRM (${now.toLocaleString()})`,
          html: `<div style="font-family:Segoe UI,Arial,sans-serif;padding:16px"><h3>CRM Test Email</h3><p>This is a test email to verify SMTP deliverability.</p><p>Time: ${now.toLocaleString()}</p></div>`
        })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || 'Failed to send test email');
      alert('Test email sent. Please check your inbox (and spam folder).');
    } catch (e) {
      alert('Test email failed: ' + (e.message || e));
    }
  }

  const statusFilterLabel = useMemo(() => (
    STATUS_LIST.map(s => (
      <label key={s} style={{marginRight:12, userSelect:'none'}}>
        <input type="checkbox" checked={status.includes(s)} onChange={() => toggleStatus(s)} /> {s}
      </label>
    ))
  ), [status]);

  function onStatusChangeSelect(val) {
    if (!editId) return; // creation path won't offer other statuses
    if (!val || val === form.status) return;
    // Open modal to collect a note
    setStatusModal({ open: true, toStatus: val, note: '', meetingId: '' });
  }

  async function confirmStatusChange() {
    const to = statusModal.toStatus;
    const note = statusModal.note || '';
    if (!note.trim()) {
      // Require a note for all status changes
      return;
    }
    const token = localStorage.getItem('authToken') || localStorage.getItem('token');
    const auth = token ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
    // If a quick-action meetingId is present, apply immediately via API
    if (statusModal.meetingId) {
      const targetId = statusModal.meetingId;
      try {
        if (to === 'CANCELLED') {
          const r = await fetch(`/api/meetings/${targetId}/cancel`, { method: 'PATCH', headers: auth, body: JSON.stringify({ reason: note, performed_by: 'user' }) });
          if (!r.ok) throw new Error('Failed to cancel meeting');
        } else if (to === 'COMPLETED') {
          const r = await fetch(`/api/meetings/${targetId}/complete`, { method: 'PATCH', headers: auth, body: JSON.stringify({ performed_by: 'user', outcome: note }) });
          if (!r.ok) throw new Error('Failed to complete meeting');
        } else if (to === 'NO_SHOW' || to === 'RESCHEDULED') {
          const cur = items.find(m => m.id === targetId);
          const prefix = to === 'NO_SHOW' ? 'No-Show' : 'Rescheduled';
          const newNotes = note ? `${cur?.notes ? cur.notes + '\n' : ''}${prefix}: ${note}` : cur?.notes;
          const r = await fetch(`/api/meetings/${targetId}`, { method: 'PUT', headers: auth, body: JSON.stringify({ status: to, notes: newNotes, outcomeNotes: note }) });
          if (!r.ok) throw new Error('Failed to update status');
        }
        // Close modal and refresh list
        setStatusModal({ open: false, toStatus: '', note: '', meetingId: '' });
        await fetchMeetings();
      } catch (e) {
        alert(String(e.message || e));
        setStatusModal({ open: false, toStatus: '', note: '', meetingId: '' });
      }
      return;
    }
    // Else, in-edit flow: stage the change and apply on Save
    setStatusModal({ open: false, toStatus: '', note: '', meetingId: '' });
    if (!editId) return;
    setPendingStatus({ toStatus: to, note });
    setForm(f => ({ ...f, status: to }));
    setStatusSelectValue(to);
  }

  const can = perms ? { create: !!perms?.actions?.['Meetings.create'], edit: !!perms?.actions?.['Meetings.edit'], delete: !!perms?.actions?.['Meetings.delete'] } : { create: true, edit: true, delete: true };
  
  // Assignment markers (consistent with Opportunities)
  const CustomerIcon = ({ size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="#111" opacity="0.08" />
      <circle cx="12" cy="10" r="3.3" fill="#111" />
      <path d="M5.5 18.4c1.7-3 4-4.4 6.5-4.4s4.8 1.4 6.5 4.4" fill="none" stroke="#111" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
  const ContractIcon = ({ size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <rect x="5" y="3" width="11" height="18" rx="2" ry="2" fill="#111" opacity="0.08" stroke="#111" />
      <path d="M8 7h6M8 10h6M8 13h4" stroke="#111" strokeWidth="2" strokeLinecap="round" />
      <path d="M14.5 15.5l3.8 3.8-2.8.7.7-2.8-1.7-1.7z" fill="#111" />
    </svg>
  );
  return (
    <div>
      {error && <div style={{color:'red',padding:'8px'}}>{error}</div>}
      <div className="card">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <h3 style={{margin:0}}>{editId ? 'Edit Meeting' : 'Create Meeting'}</h3>
          <div style={{display:'flex', gap:8}}>
            {isAdminUser && !editId && (
              <button
                className="btn"
                type="button"
                title="Autofill (Admin only)"
                style={{background:'#111', color:'#fff'}}
                onClick={() => {
                  const seed = uniqueSeed('MEET');
                  setForm(f => ({
                    ...f,
                    subject: `Discussion – ${seed}`,
                    date: futureDate(1),
                    time: timePlusMinutes(60),
                    location: 'Client Office',
                  }));
                }}
              >Autofill</button>
            )}
            <button className="btn" type="button" style={{background:'#eee', color:'#222'}} onClick={resetForm}>Clear</button>
          </div>
        </div>
  <form className="grid cols-3" onSubmit={saveMeeting}>
          <div className="row" style={{position:'relative', gridColumn:'1 / -1'}}>
            <label className="block">Client (name — opportunity)</label>
            <input
              value={clientQuery}
              onChange={e => { setClientQuery(e.target.value); setClientOpen(true); }}
              onFocus={() => setClientOpen(true)}
              placeholder="type to search clients"
            />
            {clientOpen && (
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:'1px solid #ddd',borderRadius:4,maxHeight:240,overflowY:'auto',zIndex:10}}>
                {clientLoading ? (
                  <div style={{padding:8}}>Searching…</div>
                ) : clientOptions.length === 0 ? (
                  <div style={{padding:8}} className="muted">No matches</div>
                ) : clientOptions.map(opt => (
                  <div key={`${opt.entity_type}-${opt.opportunity_id}-${opt.contract_id || opt.customer_id}`} style={{padding:'8px 10px',cursor:'pointer',display:'flex',gap:10,alignItems:'center'}} onMouseDown={() => chooseClient(opt)}>
                    <span title={opt.contract_id ? 'Contract' : 'Customer'} aria-label={opt.contract_id ? 'Contract' : 'Customer'} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:36}}>
                      {opt.contract_id ? <ContractIcon size={32} /> : <CustomerIcon size={32} />}
                    </span>
                    <div>
                      <div style={{fontWeight:600}}>{opt.client_name}</div>
                      <div className="muted" style={{fontSize:12}}>Opportunity: {opt.opportunity_id}{opt.contract_id ? ` • Contract: ${opt.contract_id}` : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
            <div className="row">
            <label className="block">Opportunity ID</label>
            <input value={form.opportunity_id} readOnly placeholder="auto-filled" className={(v.touched.opportunity_id && v.errors.opportunity_id) ? 'input-error' : ''} onBlur={() => v.onBlur('opportunity_id')} />
            {v.touched.opportunity_id && v.errors.opportunity_id && <div className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{v.errors.opportunity_id}</div>}
          </div>
          <div className="row">
            <label className="block">Customer ID</label>
            <input value={form.customer_id} readOnly placeholder="auto-filled" />
          </div>
          <div className="row">
            <label className="block">Contract ID</label>
            <input value={form.contract_id} readOnly placeholder="auto (if active)" />
          </div>
          <div className="row">
            <label className="block">Subject</label>
            <input value={form.subject} onChange={e => { const v2=e.target.value; setForm(f => ({...f, subject: v2})); }} onBlur={()=>v.onBlur('subject')} placeholder="Meeting subject" className={(v.touched.subject && v.errors.subject) ? 'input-error' : ''} />
            {v.touched.subject && v.errors.subject && <div className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{v.errors.subject}</div>}
          </div>
          <div className="row">
            <label className="block">Date</label>
            <input type="date" value={form.date} onChange={e => { const v2=e.target.value; setForm(f => ({...f, date: v2})); }} onBlur={()=>v.onBlur('date')} className={(v.touched.date && v.errors.date) ? 'input-error' : ''} />
            {v.touched.date && v.errors.date && <div className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{v.errors.date}</div>}
          </div>
          <div className="row">
            <label className="block">Time</label>
            <input type="time" value={form.time} onChange={e => { const v2=e.target.value; setForm(f => ({...f, time: v2})); }} onBlur={()=>v.onBlur('time')} className={(v.touched.time && v.errors.time) ? 'input-error' : ''} />
            {v.touched.time && v.errors.time && <div className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{v.errors.time}</div>}
          </div>
          <div className="row">
            <label className="block">Location</label>
            <input value={form.location} onChange={e => setForm(f => ({...f, location: e.target.value}))} />
          </div>
          <div className="row">
            <label className="block">Meeting person</label>
            <input value={form.person_name} onChange={e => { const v2=e.target.value; setForm(f => ({...f, person_name: v2})); }} onBlur={()=>v.onBlur('person_name')} placeholder="Person you'll meet" className={(v.touched.person_name && v.errors.person_name) ? 'input-error' : ''} />
            {v.touched.person_name && v.errors.person_name && <div className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{v.errors.person_name}</div>}
          </div>
          <div className="row">
            <label className="block">Contact number (optional)</label>
            <input value={form.contact_phone} onChange={e => setForm(f => ({...f, contact_phone: e.target.value}))} placeholder="+91XXXXXXXXXX or 10-digit" />
          </div>
          <div className="row">
            <label className="block">Assigned To</label>
            {currentUser ? (
              <select
                value={form.assigned_to_user_id}
                onChange={e => {
                  const uid = e.target.value;
                  const u = assigneeOptions.find(x => x.id === uid) || (currentUser && String(currentUser.id) === String(uid) ? currentUser : null);
                  const label = u ? (u.username || '') : (currentUser?.username || '');
                  setForm(f => ({ ...f, assigned_to_user_id: uid, assigned_to: label }));
                }}
              >
                {currentUser && <option value={currentUser.id}>Myself - {currentUser.username} ({currentUser.role})</option>}
                {assigneeLoading && <option value="" disabled>Loading…</option>}
                {assigneeError && <option value="" disabled>{assigneeError}</option>}
                {assigneeOptions.map(u => {
                  const label = u.username || '';
                  return <option key={u.id} value={u.id}>{label} ({u.role})</option>;
                })}
              </select>
            ) : (
              <input value={form.assigned_to} onChange={e => setForm(f => ({...f, assigned_to: e.target.value}))} placeholder="assignee" />
            )}
          </div>
          <div className="row">
            <label className="block">Meeting Link (optional)</label>
            <input value={form.meeting_link} onChange={e => setForm(f => ({ ...f, meeting_link: e.target.value }))} placeholder="https://..." />
          </div>
          <div className="row">
            <label className="block">Status {editId ? (<span className="muted" style={{marginLeft:8,fontWeight:400}}>(Current: {form.status})</span>) : null}</label>
            {editId ? (
              <select
                value={statusSelectValue}
                onChange={e => {
                  const v = e.target.value;
                  setStatusSelectValue(v);
                  if (v) {
                    onStatusChangeSelect(v);
                  }
                }}
              >
                <option value="">Select status</option>
                {['COMPLETED','CANCELLED','NO_SHOW','RESCHEDULED'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <select value={''} disabled>
                <option value="">SCHEDULED</option>
              </select>
            )}
          </div>
          <div style={{gridColumn:'1/-1',marginTop:8}}>
            <button className="btn" type="submit" disabled={editId ? (!can.edit || !v.canSubmit) : (!can.create || !v.canSubmit)}>{editId ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </div>

      <div className="card" style={{marginTop:24}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <h3 style={{margin:0}}>Meetings</h3>
          <div style={{display:'flex',gap:12}}>
            <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={exportCSV}>Export CSV</button>
            <button className="btn" type="button" style={{background:'#eee',color:'#222'}} onClick={printTable}>Print / PDF</button>
            <button className="btn" type="button" style={{background:'#111',color:'#fff'}} onClick={sendTestEmailToMe} disabled={!currentUser || !currentUser.email} title={(!currentUser||!currentUser.email)?'Login or set email in profile':''}>Send test to me</button>
          </div>
        </div>
        <div className="grid cols-4" style={{marginBottom:8, alignItems:'end'}}>
          <div style={{display:'flex', flexDirection:'column', gridColumn:'1 / span 2'}}>
            <label className="block">Search</label>
            <input placeholder="Client name, subject, location, or any ID (meeting/customer/opportunity/contract)" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <div style={{display:'flex', flexDirection:'column'}}>
            <label className="block">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div style={{display:'flex', flexDirection:'column'}}>
            <label className="block">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          <div style={{display:'flex', flexDirection:'column'}}>
            <label className="block">Assigned To</label>
            {true ? (
              <div style={{position:'relative'}}>
                <input
                  value={assignedTo}
                  onChange={e => {
                    setAssignedTo(e.target.value);
                    setAssignedOpen(true);
                    // when user types, clear specific-id filter to switch to text mode until a new selection
                    if (assignedToUserIdFilter) setAssignedToUserIdFilter('');
                  }}
                  onFocus={() => setAssignedOpen(true)}
                  onBlur={() => setTimeout(() => setAssignedOpen(false), 120)}
                  onKeyDown={(e) => {
                    if (!assignedOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                      setAssignedOpen(true);
                      setAssignedActiveIndex(0);
                      e.preventDefault();
                      return;
                    }
                    if (!assignedOpen) return;
                    const max = (assignedOpts || []).length;
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setAssignedActiveIndex(idx => {
                        const next = idx + 1;
                        return next >= max ? (max - 1) : next < 0 ? 0 : next;
                      });
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setAssignedActiveIndex(idx => {
                        const next = idx - 1;
                        return next < 0 ? 0 : next;
                      });
                    } else if (e.key === 'Enter') {
                      if (max > 0) {
                        e.preventDefault();
                        const i = assignedActiveIndex >= 0 ? assignedActiveIndex : 0;
                        const u = assignedOpts[i];
                        if (u) {
                          const label = u.username || u.id;
                          setAssignedTo(label);
                          setAssignedToUserIdFilter(u.id);
                          setAssignedOpen(false);
                        }
                      }
                    } else if (e.key === 'Escape' || e.key === 'Esc') {
                      e.preventDefault();
                      setAssignedOpen(false);
                    }
                  }}
                  placeholder="type a username"
                  aria-autocomplete="list"
                  aria-expanded={assignedOpen}
                  aria-controls="assigned-combobox-list"
                  role="combobox"
                  style={{padding:'6px 8px'}}
                />
                {(assignedTo || assignedToUserIdFilter) && (
                  <button
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { setAssignedTo(''); setAssignedToUserIdFilter(''); }}
                    aria-label="Clear assignee filter"
                    style={{position:'absolute', right:6, top:'50%', transform:'translateY(-50%)', border:'1px solid #e5e7eb', background:'#fff', borderRadius:999, width:20, height:20, display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:12, color:'#6b7280'}}
                  >×</button>
                )}
                {assignedOpen && (
                  <div id="assigned-combobox-list" role="listbox" style={{position:'absolute', top:'calc(100% + 4px)', left:0, right:0, background:'#fff', border:'1px solid #e5e7eb', borderRadius:8, maxHeight:200, overflowY:'auto', zIndex:20, boxShadow:'0 10px 24px rgba(0,0,0,0.14)'}}>
                    {/* Synthetic quick options for clarity */}
                    <div
                      key="everyone"
                      role="option"
                      aria-selected={false}
                      style={{padding:'6px 10px', cursor:'pointer', background:'#fff', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:13, borderBottom:'1px solid #f3f4f6'}}
                      onMouseDown={() => {
                        setAssignedTo('');
                        setAssignedToUserIdFilter('');
                        setAssignedOpen(false);
                      }}
                      title="Everyone (all assignees)"
                    >
                      <span style={{fontWeight:600}}>Everyone (all assignees)</span>
                      <span className="muted" style={{fontSize:11, color:'#6b7280'}}>clear</span>
                    </div>
                    {currentUser && (
                      <div
                        key="myself"
                        role="option"
                        aria-selected={false}
                        style={{padding:'6px 10px', cursor:'pointer', background:'#fff', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:13, borderBottom:'1px solid #f3f4f6'}}
                        onMouseDown={() => {
                          const label = currentUser.username || currentUser.id;
                          setAssignedTo(label);
                          setAssignedToUserIdFilter(currentUser.id);
                          setAssignedOpen(false);
                        }}
                        title={`Myself - ${(currentUser.username||'me')} (${currentUser.role||'USER'})`}
                      >
                        <span style={{fontWeight:600}}>Myself - {currentUser.username || 'me'} ({currentUser.role || 'USER'})</span>
                        <span className="muted" style={{fontSize:11, color:'#6b7280'}}>me</span>
                      </div>
                    )}
                    {assignedLoading ? (
                      <div style={{padding:'8px 10px', fontSize:12}}>Searching…</div>
                    ) : assignedError ? (
                      <div style={{padding:'8px 10px', color:'#b91c1c', fontSize:12}}>{assignedError}</div>
                    ) : (assignedOpts || []).length === 0 ? (
                      <div style={{padding:'8px 10px', fontSize:12}} className="muted">No matches</div>
                    ) : (
                      assignedOpts
                        .filter(u => !currentUser || u.id !== currentUser.id) // avoid duplicating the synthetic "Myself"
                        .map((u, i) => {
                        const label = u.username || u.id;
                        return (
                          <div
                            key={u.id}
                            id={`assigned-opt-${i}`}
                            role="option"
                            aria-selected={assignedActiveIndex === i}
                            style={{padding:'6px 10px', cursor:'pointer', background: assignedActiveIndex === i ? '#eef2ff' : '#fff', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:13}}
                            onMouseEnter={() => setAssignedActiveIndex(i)}
                            onMouseDown={() => {
                              setAssignedTo(label);
                              setAssignedToUserIdFilter(u.id);
                              setAssignedOpen(false);
                            }}
                            title={`${label} (${u.role})`}
                          >
                            <span style={{fontWeight:600}}>{label}</span>
                            <span className="muted" style={{fontSize:11, color:'#6b7280'}}>{u.role}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>
          <div style={{gridColumn:'1/-1', display:'flex', alignItems:'center', gap:12, overflowX:'auto', whiteSpace:'nowrap', paddingTop:4}}>
            <label className="block" style={{margin:0}}>Status</label>
            <div style={{display:'flex', gap:12}}>{statusFilterLabel}</div>
          </div>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <button className="btn" type="button" style={{background:'#eee',color:'#222',marginRight:8}} onClick={() => setSort(s => s==='starts_at_desc' ? 'starts_at_asc' : 'starts_at_desc')}>
              Sort: {sort==='starts_at_desc' ? 'Starts At ▼' : 'Starts At ▲'}
            </button>
          </div>
          <div>
            <button className="btn" type="button" style={{background:'#eee',color:'#222',marginRight:8}} onClick={() => setPage(p => Math.max(1, p-1))}>Prev</button>
            <span className="muted">Page {page}</span>
            <button className="btn" type="button" style={{background:'#eee',color:'#222',marginLeft:8}} onClick={() => setPage(p => p+1)}>Next</button>
          </div>
        </div>
        <table id="meetingsTable" style={{marginTop:8}}>
          <thead>
            <tr>
              <th>Client Name</th>
              <th>Meeting ID</th>
              <th>Subject</th>
              <th>Date & Time</th>
              <th>Location</th>
              <th>Assigned To</th>
              <th>⏱ Time</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8}>Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="muted">No meetings</td></tr>
            ) : items.map(m => (
              <tr key={m.id}>
                <td>
                  <span title={m.contract_id ? 'Contract' : 'Customer'} aria-label={m.contract_id ? 'Contract' : 'Customer'} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:36,marginRight:8,verticalAlign:'middle'}}>
                    {m.contract_id ? <ContractIcon size={32} /> : <CustomerIcon size={32} />}
                  </span>
                  {m.client_name || ''}
                </td>
                <td>{m.id || ''}</td>
                <td>{m.subject}</td>
                <td>{fmtDateTime(m.starts_at || m.when_ts)}</td>
                <td>{m.location || ''}</td>
                <td>{m.assigned_to || ''}</td>
                <td>
                  {(() => {
                    const info = dueLeftInfo(m.starts_at || m.when_ts);
                    const past = info.state === 'past';
                    const style = past
                      ? { border:'1px solid #fecaca', background:'#fef2f2', color:'#991b1b', borderRadius:999, padding:'2px 6px', fontSize:11, fontWeight:700 }
                      : { border:'1px solid #bbf7d0', background:'#ecfdf5', color:'#166534', borderRadius:999, padding:'2px 6px', fontSize:11, fontWeight:700 };
                    return (
                      <span title={(m.starts_at || m.when_ts) ? new Date(m.starts_at || m.when_ts).toLocaleString() : ''} style={style}>
                        {past ? `Overdue by ${info.hm}` : `Starts in ${info.hm}`}
                      </span>
                    );
                  })()}
                </td>
                <td>{m.status}</td>
                <td>
                  <button className="btn" style={{background:'#f1c40f',color:'#222',marginRight:8, opacity: can.edit?1:0.5}} onClick={() => onEdit(m)} disabled={!can.edit}>Edit</button>
                  {m.status !== 'COMPLETED' && can.edit && (
                    <button className="btn" style={{background:'#2ecc71',color:'#fff',marginRight:8}} onClick={() => {
                      setStatusModal({ open: true, toStatus: 'COMPLETED', note: '', meetingId: m.id });
                    }}>Complete</button>
                  )}
                  <button className="btn" style={{background:'#2563eb',color:'#fff', marginRight:8}} onClick={() => openEmailModal(m)}>Email invite</button>
                  <span className="muted" title="Number of email invites sent for this meeting" style={{fontSize:12}}>
                    {`Sent: ${Number.isFinite(Number(m.emails_sent_count)) ? Number(m.emails_sent_count) : 0}`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {statusModal.open && (
        <div className="overlay" style={{display:'block'}}>
          <div className="modal" style={{maxWidth:640}}>
            <div className="modal-header">
              <div style={{fontWeight:600}}>Update Status</div>
              <button className="btn ghost" type="button" onClick={() => setStatusModal({ open:false, toStatus:'', note:'', meetingId: '' })}>Close</button>
            </div>
            <div className="modal-body">
              <div className="row">
                <label className="block">New Status</label>
                <input value={statusModal.toStatus} readOnly />
              </div>
              <div className="row">
                <label className="block">Outcome / Reason (required)</label>
                <textarea rows={3} value={statusModal.note} onChange={e => setStatusModal(s => ({...s, note: e.target.value}))} />
                {!statusModal.note.trim() && (
                  <div className="muted" style={{color:'red', fontSize:12, marginTop:4}}>This field is required.</div>
                )}
              </div>
              <div className="row" style={{marginTop:8}}>
                <button className="btn" type="button" onClick={confirmStatusChange} disabled={!statusModal.note.trim()}>Confirm</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {emailModal.open && (
        <div className="overlay" style={{display:'block'}}>
          <div className="modal" style={{maxWidth:840}}>
            <div className="modal-header">
              <div style={{fontWeight:600}}>Preview & Send Email</div>
              <button className="btn ghost" type="button" onClick={() => setEmailModal({ open:false, to:'', cc:'', subject:'', html:'', meetingId:'', loading:false, error:'', sent:false })}>Close</button>
            </div>
            <div className="modal-body">
              {emailModal.error && (
                <div style={{color:'#b91c1c', marginBottom:8}}>{emailModal.error}</div>
              )}
              <div className="grid cols-2">
                <div className="row">
                  <label className="block">To (comma-separated)</label>
                  <input value={emailModal.to} onChange={e => setEmailModal(mod => ({ ...mod, to: e.target.value }))} placeholder="client@example.com, user@example.com" />
                </div>
                <div className="row">
                  <label className="block">Cc (optional)</label>
                  <input value={emailModal.cc} onChange={e => setEmailModal(mod => ({ ...mod, cc: e.target.value }))} placeholder="cc1@example.com" />
                </div>
                <div className="row" style={{gridColumn:'1/-1'}}>
                  <label className="block">Client email (suggested)</label>
                  <div style={{display:'flex', gap:8, alignItems:'center'}}>
                    <input value={emailModal.clientEmail} onChange={e => setEmailModal(mod => ({ ...mod, clientEmail: e.target.value }))} placeholder="client@company.com" style={{flex:1}} />
                    <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
                      <input type="checkbox" checked={!!emailModal.includeClient} onChange={e => setEmailModal(mod => ({ ...mod, includeClient: !!e.target.checked }))} /> Include in To
                    </label>
                  </div>
                </div>
                <div className="row" style={{gridColumn:'1/-1'}}>
                  <label className="block">Subject</label>
                  <input value={emailModal.subject} onChange={e => setEmailModal(mod => ({ ...mod, subject: e.target.value }))} />
                </div>
                <div className="row" style={{gridColumn:'1/-1'}}>
                  <label className="block">Preview</label>
                  <div style={{border:'1px solid #e5e7eb', borderRadius:6, padding:0, maxHeight:360, overflow:'auto', background:'#fafafa'}}>
                    {emailModal.loading ? (
                      <div style={{padding:12}}>Loading preview…</div>
                    ) : (
                      <div dangerouslySetInnerHTML={{ __html: emailModal.html || '<div style=\"padding:12\">No content</div>' }} />
                    )}
                  </div>
                </div>
                <div className="row" style={{gridColumn:'1/-1', display:'flex', gap:8}}>
                  <button className="btn" type="button" disabled={emailModal.loading} onClick={sendEmailFromModal} style={{background:'#2563eb', color:'#fff'}}>Send</button>
                  <button className="btn" type="button" disabled={emailModal.loading} onClick={() => setEmailModal({ open:false, to:'', cc:'', subject:'', html:'', meetingId:'', loading:false, error:'', sent:false })} style={{background:'#eee', color:'#111'}}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
