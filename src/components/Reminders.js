import React, { useEffect, useMemo, useRef, useState } from 'react';
import useValidation from '../utils/useValidation';
import { isValidEmail, isValidIndianPhoneLoose, normalizeIndianPhone } from '../utils/validators';
import { isAdmin } from '../utils/auth';
import { uniqueSeed, fakePerson, fakeEmail, fakePhone, futureDate, timePlusMinutes } from '../utils/autofill';

// Simple date helpers assuming local timezone
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23,59,59,999); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0=Sun ... 6=Sat
  const offset = (day === 0 ? 6 : day - 1); // make Monday start
  x.setDate(x.getDate() - offset);
  return x;
}
function endOfWeek(d) { const x = startOfWeek(d); x.setDate(x.getDate() + 6); x.setHours(23,59,59,999); return x; }
function startOfMonth(d) { const x = startOfDay(d); x.setDate(1); return x; }
function endOfMonth(d) { const x = startOfMonth(d); x.setMonth(x.getMonth()+1); x.setDate(0); x.setHours(23,59,59,999); return x; }

// Custom ranges for panels
// Week range: the Monday-Sunday week that contains "tomorrow" (so on Sunday, it shows next week)
function nextWeeksRangeFromToday() {
  const today = new Date();
  const tomorrow = addDays(today, 1);
  const from = startOfWeek(tomorrow);
  const to = endOfWeek(tomorrow);
  return { from, to };
}
// Month range: the 3 weeks following that week (rolling window), i.e., [weekEnd+1 .. weekEnd+21]
function threeWeeksAfterNextWeek() {
  const wk = nextWeeksRangeFromToday();
  const from = startOfDay(addDays(wk.to, 1));
  const to = endOfDay(addDays(wk.to, 21));
  return { from, to };
}

// Format a Date as local-time SQL timestamp (YYYY-MM-DD HH:mm:ss)
function fmtSqlTsLocal(d) {
  const x = new Date(d);
  const pad = n => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())} ${pad(x.getHours())}:${pad(x.getMinutes())}:${pad(x.getSeconds())}`;
}
// Ensure consistent local parsing for either ISO or "YYYY-MM-DD HH:mm:ss" strings
function asDate(v) {
  if (v instanceof Date) return v;
  const s = String(v || '');
  if (!s) return new Date(NaN);
  // If explicit timezone (Z or +hh:mm), let Date parse it (UTC aware)
  if (/Z|[+-]\d{2}:\d{2}$/.test(s)) return new Date(s);
  // Parse local SQL or ISO without TZ as LOCAL time
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, Y, Mo, Da, H, Mi, S] = m;
    return new Date(+Y, +Mo - 1, +Da, +H, +Mi, +(S || 0), 0);
  }
  // Fallback
  return new Date(s);
}

const scopes = {
  today: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }),
  tomorrow: () => ({ from: startOfDay(addDays(new Date(), 1)), to: endOfDay(addDays(new Date(), 1)) }),
  // For range mode, redefine semantics to meet product needs:
  // - week: next Monday..Sunday (week of tomorrow)
  // - month: next 3 weeks after that (rolling window)
  week: () => nextWeeksRangeFromToday(),
  month: () => threeWeeksAfterNextWeek(),
};

export default function Reminders({ perms }) {
  // panelMode = pairs (left,right): (today,tomorrow) or (week,month)
  const [panelMode, setPanelMode] = useState('day'); // 'day' | 'range'
  const [showCreate, setShowCreate] = useState(false);
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'employee' | 'assigned'
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [empLoading, setEmpLoading] = useState(false);
  const [empError, setEmpError] = useState('');
  const [empMeetings, setEmpMeetings] = useState([]);
  const [empReminders, setEmpReminders] = useState([]);
  const [myRole, setMyRole] = useState(null);
  const [myUserId, setMyUserId] = useState(null);
  // Employee-scoped live pools to mirror main view panels
  const [empLiveCalls, setEmpLiveCalls] = useState([]);
  const [empLiveEmails, setEmpLiveEmails] = useState([]);
  const [empLiveMeetings, setEmpLiveMeetings] = useState([]);
  const [empTodayCompletedMeetings, setEmpTodayCompletedMeetings] = useState([]);
  // AbortControllers to enforce latest-request-wins
  const liveCtrlRef = useRef(null);
  const empCtrlRef = useRef(null);
  const histCtrlRef = useRef(null);

  // Load current user role for gating Employee Overview
  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const res = await fetch('/api/auth/me', { headers: token ? { 'Authorization': `Bearer ${token}` } : undefined });
        if (res.ok) {
          const me = await res.json();
          window.__currentUser = me;
          setMyRole(me.role || null);
          setMyUserId(me.id || null);
        }
      } catch (e) { /* ignore */ }
    })();
  }, []);

  // When switching to Employee or Assigned tab, load users and set default selection
  useEffect(() => {
    if (activeTab !== 'employee' && activeTab !== 'assigned') return;
    let cancelled = false;
    (async () => {
      try {
        if (!users || users.length === 0) {
          // Load user list
          // Employee Overview: only OWNER,EMPLOYEE selectable (server allowlist too)
          // Assigned To: ADMIN may see ADMIN as well; OWNER/EMPLOYEE see OWNER,EMPLOYEE
          const roles = (activeTab === 'employee') ? 'OWNER,EMPLOYEE' : ((myRole === 'ADMIN') ? 'OWNER,EMPLOYEE,ADMIN' : 'OWNER,EMPLOYEE');
          const token = localStorage.getItem('authToken') || localStorage.getItem('token');
          const resUsers = await fetch(`/api/users-lookup?roles=${encodeURIComponent(roles)}`, { headers: token ? { 'Authorization': `Bearer ${token}` } : undefined });
          const arr = resUsers.ok ? (await resUsers.json()) : [];
          // Exclude ADMINs from Employee Overview for both OWNER and ADMIN (server disallows ADMIN in userId filter)
          const filtered = (activeTab === 'employee')
            ? (Array.isArray(arr) ? arr.filter(u => u.role !== 'ADMIN') : [])
            : ((myRole === 'OWNER') ? (Array.isArray(arr) ? arr.filter(u => u.role !== 'ADMIN') : []) : (Array.isArray(arr) ? arr : []));
          if (!cancelled) setUsers(filtered);
          try {
            // Build quick lookup for usernames by id for nicer chips
            const idx = Object.create(null);
            (filtered || []).forEach(u => { idx[u.id] = { username: u.username, email: u.email, full_name: u.full_name }; });
            window.__userIndex = idx;
          } catch {}
          // Default selection:
          // - Assigned tab: default to Everyone for all roles
          // - Employee tab: ADMIN/OWNER -> Everyone; EMPLOYEE -> self if present
          const meToken = localStorage.getItem('authToken') || localStorage.getItem('token');
          const meRes = await fetch('/api/auth/me', { headers: meToken ? { 'Authorization': `Bearer ${meToken}` } : undefined });
          if (meRes.ok) {
            const me = await meRes.json();
            window.__currentUser = me;
            if (!selectedUserId) {
              const roleUpper = String(me.role).toUpperCase();
              if (activeTab === 'assigned') {
                // Always start at Everyone in Assigned To view
                setSelectedUserId('');
              } else {
                // Employee Overview default
                if (roleUpper === 'ADMIN' || roleUpper === 'OWNER') {
                  setSelectedUserId(''); // Everyone
                } else {
                  const found = (filtered || []).find(u => u.id === me.id);
                  if (found) setSelectedUserId(me.id);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error(e);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, myRole]);

  // Align History defaults with Assigned To view: include PENDING by default when on Assigned tab
  useEffect(() => {
    // Only flip on entering the Assigned tab to avoid overriding user-made changes elsewhere
    if (activeTab === 'assigned' && !historyStatusFilter.PENDING) {
      setHistoryStatusFilter(f => ({ ...f, PENDING: true }));
    }
  }, [activeTab]);

  // Detect admin for Autofill visibility
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ok = await isAdmin();
        if (!cancelled) setIsAdminUser(!!ok);
      } catch {
        if (!cancelled) setIsAdminUser(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const leftScope = useMemo(() => panelMode === 'day' ? 'today' : 'week', [panelMode]);
  const rightScope = useMemo(() => panelMode === 'day' ? 'tomorrow' : 'month', [panelMode]);

  // No placeholder data: only real API data is used

  function filterByScope(items, scopeKey) {
      const { from, to } = scopes[scopeKey]();
      const todayStart = startOfDay(new Date());
      return items.filter(it => {
        const t = asDate(it.when);
        const inRange = (t >= from && t <= to);
        // For Today panels, also include overdue PENDING reminders (CALL/EMAIL) regardless of date
        if (scopeKey === 'today') {
          const kind = String(it.kind || '').toUpperCase();
          const status = String(it.status || '').toUpperCase();
          const isReminder = (kind === 'CALL' || kind === 'EMAIL');
          const isOverduePending = (isReminder && status === 'PENDING' && t < todayStart);
          return inRange || isOverduePending;
        }
        return inRange;
      });
  }

  // Live data state for calls/emails
  const [loading, setLoading] = useState(false);
  const [liveCalls, setLiveCalls] = useState([]);
  const [liveEmails, setLiveEmails] = useState([]);
  const [liveMeetings, setLiveMeetings] = useState([]);
  const [todayCompletedMeetings, setTodayCompletedMeetings] = useState([]);
  // Summary counts for Delayed/Today/Tomorrow buckets
  const [summaryBuckets, setSummaryBuckets] = useState(null);
  const [overviewTotals, setOverviewTotals] = useState(null);
  const [empOverviewTotals, setEmpOverviewTotals] = useState(null);
  // Bulk email selection (Today & Tomorrow only)
  const [selectionKind, setSelectionKind] = useState(null); // 'CALL' | 'EMAIL' | null
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showBulkMail, setShowBulkMail] = useState(false);
  // History (recent calls/emails)
  const [historyRawItems, setHistoryRawItems] = useState([]);
  const [historyDays, setHistoryDays] = useState(30); // selectable: 7/14/30/90
  const [historyKindFilter, setHistoryKindFilter] = useState({ CALL: true, EMAIL: true });
  const [historyStatusFilter, setHistoryStatusFilter] = useState({ PENDING: false, DONE: true, SENT: true, FAILED: true });
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  // Admin-only Autofill support
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [prefillReminder, setPrefillReminder] = useState(null);

  // Fetch helper by scope
  function scopeRange(scopeKey) { return scopes[scopeKey](); }
  async function fetchReminders(type, from, to, forUserId, signal, opts = {}) {
    const params = new URLSearchParams();
    params.set('type', type);
    params.set('dateFrom', fmtSqlTsLocal(from));
    params.set('dateTo', fmtSqlTsLocal(to));
    if (forUserId) params.set('userId', forUserId);
    if (opts.assignedToUserId) params.set('assignedToUserId', opts.assignedToUserId);
    if (opts.createdBySelf) params.set('createdBy', 'self');
    if (opts.statusList && Array.isArray(opts.statusList) && opts.statusList.length) params.set('status', opts.statusList.join(','));
  const token = localStorage.getItem('authToken') || localStorage.getItem('token');
    const res = await fetch(`/api/reminders?${params.toString()}`, {
      signal,
      headers: token ? { 'Authorization': `Bearer ${token}` } : undefined
    });
    if (!res.ok) throw new Error('Failed to load reminders');
    const data = await res.json();
    return data.items || [];
  }

  async function fetchMeetings(from, to, statuses = 'SCHEDULED,RESCHEDULED', forUserId, signal, opts = {}) {
    const params = new URLSearchParams();
    params.set('status', statuses);
    params.set('dateFrom', fmtSqlTsLocal(from));
    params.set('dateTo', fmtSqlTsLocal(to));
    params.set('sort', 'starts_at_asc');
    if (forUserId) params.set('userId', forUserId);
    if (opts.assignedToUserId) params.set('assignedToUserId', opts.assignedToUserId);
  const token = localStorage.getItem('authToken') || localStorage.getItem('token');
    const res = await fetch(`/api/meetings?${params.toString()}`, {
      signal,
      headers: token ? { 'Authorization': `Bearer ${token}` } : undefined
    });
    if (!res.ok) throw new Error('Failed to load meetings');
    const data = await res.json();
    return data.items || [];
  }

  async function loadLive() {
    try {
      // Abort any in-flight request for live data
      if (liveCtrlRef.current) {
        try { liveCtrlRef.current.abort(); } catch {}
      }
      const ctrl = new AbortController();
      liveCtrlRef.current = ctrl;
      setLoading(true);
      const { from: lf, to: lt } = scopeRange(leftScope);
      const { from: rf, to: rt } = scopeRange(rightScope);
      const overdueFrom = startOfDay(addDays(new Date(), -180));
      const overdueTo = endOfDay(addDays(new Date(), -1));
      // Always scope My Overview to assignedToUserId = selfId
      const selfId = (window.__currentUser && window.__currentUser.id) || myUserId;
      const assignedToSelfOpts = (activeTab === 'overview' && selfId) ? { assignedToUserId: selfId } : {};
      const forUserId = null; // never use userId scoping for My Overview
      const wantCreatedBy = (myRole === 'OWNER' || myRole === 'ADMIN');
      const [
        // Assigned-to-self in-scope
        leftCalls, rightCalls, leftEmails, rightEmails,
        // Created-by-self in-scope (OWNER/ADMIN)
        leftCallsBy, rightCallsBy, leftEmailsBy, rightEmailsBy,
        // Overdue pending (assigned-to-self)
        overdueCalls, overdueEmails,
        // Overdue pending (created-by-self)
        overdueCallsBy, overdueEmailsBy,
        // Meetings pools
        leftMeetings, rightMeetings, leftCompletedToday
      ] = await Promise.all([
        fetchReminders('CALL', lf, lt, forUserId, ctrl.signal, assignedToSelfOpts),
        fetchReminders('CALL', rf, rt, forUserId, ctrl.signal, assignedToSelfOpts),
        fetchReminders('EMAIL', lf, lt, forUserId, ctrl.signal, assignedToSelfOpts),
        fetchReminders('EMAIL', rf, rt, forUserId, ctrl.signal, assignedToSelfOpts),
        // createdBy=self (only for OWNER/ADMIN)
        wantCreatedBy ? fetchReminders('CALL', lf, lt, forUserId, ctrl.signal, { createdBySelf: true }) : Promise.resolve([]),
        wantCreatedBy ? fetchReminders('CALL', rf, rt, forUserId, ctrl.signal, { createdBySelf: true }) : Promise.resolve([]),
        wantCreatedBy ? fetchReminders('EMAIL', lf, lt, forUserId, ctrl.signal, { createdBySelf: true }) : Promise.resolve([]),
        wantCreatedBy ? fetchReminders('EMAIL', rf, rt, forUserId, ctrl.signal, { createdBySelf: true }) : Promise.resolve([]),
        // overdue PENDING (assigned-to-self)
        fetchReminders('CALL', overdueFrom, overdueTo, forUserId, ctrl.signal, { ...assignedToSelfOpts, statusList: ['PENDING'] }),
        fetchReminders('EMAIL', overdueFrom, overdueTo, forUserId, ctrl.signal, { ...assignedToSelfOpts, statusList: ['PENDING'] }),
        // overdue PENDING (created-by-self for OWNER/ADMIN)
        wantCreatedBy ? fetchReminders('CALL', overdueFrom, overdueTo, forUserId, ctrl.signal, { createdBySelf: true, statusList: ['PENDING'] }) : Promise.resolve([]),
        wantCreatedBy ? fetchReminders('EMAIL', overdueFrom, overdueTo, forUserId, ctrl.signal, { createdBySelf: true, statusList: ['PENDING'] }) : Promise.resolve([]),
        // meetings
        fetchMeetings(lf, lt, 'SCHEDULED,RESCHEDULED', forUserId, ctrl.signal, assignedToSelfOpts),
        fetchMeetings(rf, rt, 'SCHEDULED,RESCHEDULED', forUserId, ctrl.signal, assignedToSelfOpts),
        panelMode === 'day' && leftScope === 'today' ? fetchMeetings(lf, lt, 'COMPLETED', forUserId, ctrl.signal, assignedToSelfOpts) : Promise.resolve([]),
      ]);
      // Merge unique by id keeping all in range; UI panels will still filter by scope
      if (liveCtrlRef.current === ctrl) {
  const callsMap = new Map();
  [...leftCalls, ...rightCalls, ...leftCallsBy, ...rightCallsBy, ...overdueCalls, ...overdueCallsBy].forEach(r => callsMap.set(r.id, r));
  const emailsMap = new Map();
  [...leftEmails, ...rightEmails, ...leftEmailsBy, ...rightEmailsBy, ...overdueEmails, ...overdueEmailsBy].forEach(r => emailsMap.set(r.id, r));
        const meetingsMap = new Map();
        // Merge only scheduled/rescheduled for both scopes into the live pool
        [...leftMeetings, ...rightMeetings].forEach(m => meetingsMap.set(m.id, m));
        setLiveCalls(Array.from(callsMap.values()));
        setLiveEmails(Array.from(emailsMap.values()));
        setLiveMeetings(Array.from(meetingsMap.values()));
        // Keep today's COMPLETED meetings separate to avoid cross-panel pollution/flicker
        setTodayCompletedMeetings(Array.isArray(leftCompletedToday) ? leftCompletedToday : []);
      }
    } catch (e) {
      if (e && (e.name === 'AbortError' || e.code === 20)) return; // ignore aborts
      console.error(e);
    } finally {
      if (liveCtrlRef.current && liveCtrlRef.current.signal && liveCtrlRef.current.aborted) {
        // a newer request is in-flight; don't toggle loading
      } else {
        setLoading(false);
      }
    }
  }
  // Assigned To tab loader: created_by=self AND assignedToUserId=selected
  const [asLoading, setAsLoading] = useState(false);
  const [asError, setAsError] = useState('');
  const [asCalls, setAsCalls] = useState([]);
  const [asEmails, setAsEmails] = useState([]);
  const [asMeetings, setAsMeetings] = useState([]);
  async function loadAssignedTo() {
    try {
      setAsLoading(true); setAsError('');
      const { from: lf, to: lt } = scopeRange(leftScope);
      const { from: rf, to: rt } = scopeRange(rightScope);
      const overdueFrom = startOfDay(addDays(new Date(), -180));
      const overdueTo = endOfDay(addDays(new Date(), -1));
      const selfId = (window.__currentUser && window.__currentUser.id) || myUserId;
      // Filtering rules:
      // - OWNER/ADMIN: always drop createdBy=self restriction for Assigned To view (both Everyone and specific assignee)
      // - EMPLOYEE: keep createdBy=self restriction
      const isOwnerAdminLocal = (myRole === 'OWNER' || myRole === 'ADMIN');
      const asgn = selectedUserId ? `&assignedToUserId=${encodeURIComponent(selectedUserId)}` : '';
      const createdByParam = isOwnerAdminLocal ? '' : '&createdBy=self';
      const [lc, rc, le, re, lm, rm, lcOver, leOver] = await Promise.all([
        fetch(`/api/reminders?type=CALL&dateFrom=${encodeURIComponent(fmtSqlTsLocal(lf))}&dateTo=${encodeURIComponent(fmtSqlTsLocal(lt))}${createdByParam}${asgn}`, { headers: tokenHeader() }).then(r=>r.json()).then(d=>d.items||[]),
        fetch(`/api/reminders?type=CALL&dateFrom=${encodeURIComponent(fmtSqlTsLocal(rf))}&dateTo=${encodeURIComponent(fmtSqlTsLocal(rt))}${createdByParam}${asgn}`, { headers: tokenHeader() }).then(r=>r.json()).then(d=>d.items||[]),
        fetch(`/api/reminders?type=EMAIL&dateFrom=${encodeURIComponent(fmtSqlTsLocal(lf))}&dateTo=${encodeURIComponent(fmtSqlTsLocal(lt))}${createdByParam}${asgn}`, { headers: tokenHeader() }).then(r=>r.json()).then(d=>d.items||[]),
        fetch(`/api/reminders?type=EMAIL&dateFrom=${encodeURIComponent(fmtSqlTsLocal(rf))}&dateTo=${encodeURIComponent(fmtSqlTsLocal(rt))}${createdByParam}${asgn}`, { headers: tokenHeader() }).then(r=>r.json()).then(d=>d.items||[]),
        fetch(`/api/meetings?status=SCHEDULED,RESCHEDULED&dateFrom=${encodeURIComponent(fmtSqlTsLocal(lf))}&dateTo=${encodeURIComponent(fmtSqlTsLocal(lt))}${createdByParam}${asgn}&sort=starts_at_asc`, { headers: tokenHeader() }).then(r=>r.json()).then(d=>d.items||[]),
        fetch(`/api/meetings?status=SCHEDULED,RESCHEDULED&dateFrom=${encodeURIComponent(fmtSqlTsLocal(rf))}&dateTo=${encodeURIComponent(fmtSqlTsLocal(rt))}${createdByParam}${asgn}&sort=starts_at_asc`, { headers: tokenHeader() }).then(r=>r.json()).then(d=>d.items||[]),
        // Overdue pending for assigned tab as well
        fetch(`/api/reminders?type=CALL&status=PENDING&dateFrom=${encodeURIComponent(fmtSqlTsLocal(overdueFrom))}&dateTo=${encodeURIComponent(fmtSqlTsLocal(overdueTo))}${createdByParam}${asgn}`, { headers: tokenHeader() }).then(r=>r.json()).then(d=>d.items||[]),
        fetch(`/api/reminders?type=EMAIL&status=PENDING&dateFrom=${encodeURIComponent(fmtSqlTsLocal(overdueFrom))}&dateTo=${encodeURIComponent(fmtSqlTsLocal(overdueTo))}${createdByParam}${asgn}`, { headers: tokenHeader() }).then(r=>r.json()).then(d=>d.items||[]),
      ]);
      const callsMap = new Map(); [...lc, ...rc, ...lcOver].forEach(r=>callsMap.set(r.id, r));
      const emailsMap = new Map(); [...le, ...re, ...leOver].forEach(r=>emailsMap.set(r.id, r));
      const meetingsMap = new Map(); [...lm, ...rm].forEach(m=>meetingsMap.set(m.id, m));
      setAsCalls(Array.from(callsMap.values()));
      setAsEmails(Array.from(emailsMap.values()));
  setAsMeetings(Array.from(meetingsMap.values()));
  // Do not load summary for Assigned To to avoid flicker/blink and extra requests
    } catch (e) {
      setAsError(e.message || String(e));
    } finally { setAsLoading(false); }
  }
  useEffect(() => { if (activeTab === 'assigned') loadAssignedTo(); }, [activeTab, selectedUserId, leftScope, rightScope]);

  function tokenHeader() {
    const token = localStorage.getItem('authToken') || localStorage.getItem('token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  // Feature flags to disable heavy totals sections
  const SHOW_OVERVIEW_TOTALS = false;
  const SHOW_EMPLOYEE_TOTALS = false;
  useEffect(() => {
    if (activeTab !== 'overview') return;
    // Wait until self id is known to avoid loading mixed data for all roles
    if (!myUserId) return;
    loadLive();
    loadSummary();
    if (SHOW_OVERVIEW_TOTALS) {
      loadOverviewTotals();
    }
  }, [activeTab, leftScope, rightScope, myRole, myUserId]);

  // Load overview extended totals for My Overview (day/range headers)
  async function loadOverviewTotals() {
    if (activeTab !== 'overview') { setOverviewTotals(null); return; }
    try {
      // Simple client-side cache to avoid frequent refetches when toggling scopes
      if (!window.__overviewTotalsCache) {
        window.__overviewTotalsCache = { ts: 0, data: null };
      }
      const cache = window.__overviewTotalsCache;
      if (cache && cache.data && (Date.now() - cache.ts < 10000)) {
        setOverviewTotals(cache.data);
        return;
      }
      const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      let res = await fetch('/api/reminders/summary/overview-extended', { headers: token ? { 'Authorization': `Bearer ${token}` } : undefined });
      if (!res.ok) {
        // Fallback to legacy overview summary to avoid blank UI
        const res2 = await fetch('/api/reminders/summary/overview', { headers: token ? { 'Authorization': `Bearer ${token}` } : undefined });
        if (!res2.ok) throw new Error('Failed to load overview totals');
        const legacy = await res2.json();
        const buckets = legacy && legacy.buckets ? legacy.buckets : {};
        const sumStatus = (bucket, status) => {
          const b = buckets && buckets[bucket] ? buckets[bucket] : {};
          const c = (b.CALL && b.CALL[status] ? b.CALL[status] : 0) + (b.EMAIL && b.EMAIL[status] ? b.EMAIL[status] : 0);
          return Number(c) || 0;
        };
        const overdue = sumStatus('delayed','PENDING');
        const today = {
          overdue,
          pending: sumStatus('today','PENDING'),
          done: sumStatus('today','DONE'),
          sent: sumStatus('today','SENT'),
          failed: sumStatus('today','FAILED')
        };
        const tomorrow = {
          overdue: 0,
          pending: sumStatus('tomorrow','PENDING'),
          done: sumStatus('tomorrow','DONE'),
          sent: sumStatus('tomorrow','SENT'),
          failed: sumStatus('tomorrow','FAILED')
        };
        const total = {
          overdue,
          pending: today.pending + tomorrow.pending,
          done: today.done + tomorrow.done,
          sent: today.sent + tomorrow.sent,
          failed: today.failed + tomorrow.failed
        };
        const data = { total, today, tomorrow, week: { overdue:0,pending:0,done:0,sent:0,failed:0 }, month: { overdue:0,pending:0,done:0,sent:0,failed:0 }, generatedAt: new Date().toISOString() };
        setOverviewTotals(data);
        try { window.__overviewTotalsCache = { ts: Date.now(), data }; } catch {}
        return;
      }
      const data = await res.json();
      setOverviewTotals(data);
      try { window.__overviewTotalsCache = { ts: Date.now(), data }; } catch {}
    } catch (e) {
      setOverviewTotals(null);
    }
  }

  // Load extended totals for Employee Overview (selected employee or Everyone)
  async function loadEmployeeOverviewTotals() {
    if (activeTab !== 'employee') { setEmpOverviewTotals(null); return; }
    try {
      const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      const qs = new URLSearchParams();
      if (selectedUserId) qs.set('userId', selectedUserId);
      const res = await fetch(`/api/reminders/summary/employee-extended${qs.toString() ? ('?' + qs.toString()) : ''}`, { headers: token ? { 'Authorization': `Bearer ${token}` } : undefined });
      if (!res.ok) throw new Error('Failed to load employee overview totals');
      const data = await res.json();
      setEmpOverviewTotals(data);
    } catch (e) {
      setEmpOverviewTotals(null);
    }
  }

  // Trigger employee totals load when Employee tab active and selection changes
  useEffect(() => {
    if (activeTab === 'employee') {
      if (SHOW_EMPLOYEE_TOTALS) {
        loadEmployeeOverviewTotals();
      }
    }
  }, [activeTab, selectedUserId, myRole]);

  // Load summary counts for current context
  async function loadSummary() {
    try {
      const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      let url = '';
      if (activeTab === 'overview') {
        url = '/api/reminders/summary/overview';
      } else if (activeTab === 'assigned') {
        const qs = new URLSearchParams();
        if (selectedUserId) qs.set('assignedToUserId', selectedUserId);
        url = `/api/reminders/summary/assigned${qs.toString() ? ('?' + qs.toString()) : ''}`;
      } else if (activeTab === 'employee' && (myRole === 'OWNER' || myRole === 'ADMIN')) {
        const qs = new URLSearchParams();
        if (selectedUserId) qs.set('userId', selectedUserId);
        url = `/api/reminders/summary/overview${qs.toString() ? ('?' + qs.toString()) : ''}`;
      } else {
        setSummaryBuckets(null);
        return;
      }
      const res = await fetch(url, { headers: token ? { 'Authorization': `Bearer ${token}` } : undefined });
      if (!res.ok) throw new Error('Failed to load summary');
      const data = await res.json();
      setSummaryBuckets(data && data.buckets ? data.buckets : null);
    } catch (e) {
      setSummaryBuckets(null);
    }
  }

  // Helper to resolve counts
  function getCount(bucket, type, status) {
    if (!summaryBuckets || !summaryBuckets[bucket]) return 0;
    const t = summaryBuckets[bucket][type];
    if (!t) return 0;
    const v = t[status];
    return typeof v === 'number' ? v : 0;
  }

  // Small summary bar UI
  function SummaryBar({ title }) {
    if (!summaryBuckets) return null;
    const cell = (label, bucketKey, type) => (
      <div style={{display:'flex',flexDirection:'column',gap:6}}>
        <div style={{fontSize:11, color:'#6b7280'}}>{label}</div>
        <div style={{display:'flex', gap:6, alignItems:'center', flexWrap:'wrap'}}>
          <span style={{padding:'3px 8px', borderRadius:999, fontSize:11, fontWeight:800, background:'#eef2ff', color:'#3730a3', border:'1px solid #c7d2fe'}}>
            {type} Pending: {getCount(bucketKey, type, 'PENDING')}
          </span>
          <span style={{padding:'3px 8px', borderRadius:999, fontSize:11, background:'#ecfdf5', color:'#065f46', border:'1px solid #a7f3d0'}}>
            Done/Sent: {getCount(bucketKey, type, 'DONE') + getCount(bucketKey, type, 'SENT')}
          </span>
          <span style={{padding:'3px 8px', borderRadius:999, fontSize:11, background:'#fef2f2', color:'#991b1b', border:'1px solid #fecaca'}}>
            Failed: {getCount(bucketKey, type, 'FAILED')}
          </span>
        </div>
      </div>
    );
    return (
      <div style={{border:'1px solid #e5e7eb', borderRadius:12, background:'#fff', padding:12, margin:'4px 0 12px'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8}}>
          <div style={{fontWeight:700}}>{title}</div>
          <div style={{fontSize:12, color:'#6b7280'}}>Buckets: Delayed · Today · Tomorrow</div>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12}}>
          <div>
            <div style={{fontWeight:700, marginBottom:6}}>Calls</div>
            <div style={{display:'grid', gridTemplateColumns:'1fr', gap:8}}>
              {cell('Delayed', 'delayed', 'CALL')}
              {cell('Today', 'today', 'CALL')}
              {cell('Tomorrow', 'tomorrow', 'CALL')}
            </div>
          </div>
          <div>
            <div style={{fontWeight:700, marginBottom:6}}>Emails</div>
            <div style={{display:'grid', gridTemplateColumns:'1fr', gap:8}}>
              {cell('Delayed', 'delayed', 'EMAIL')}
              {cell('Today', 'today', 'EMAIL')}
              {cell('Tomorrow', 'tomorrow', 'EMAIL')}
            </div>
          </div>
          <div style={{fontSize:12, color:'#6b7280'}}>
            <div>Counts auto-refresh with the panels.</div>
          </div>
        </div>
      </div>
    );
  }

  // Overview counters for Day and Range modes
  function TotalsBar() {
    if (!overviewTotals) {
      return (
        <div style={{border:'1px solid #e5e7eb', borderRadius:12, background:'#fff', padding:12, margin:'4px 0 12px', color:'#6b7280', fontSize:12}}>
          Loading totals…
        </div>
      );
    }
    const groupCard = (label, group, opts = {}) => {
      const showOverduePill = opts.showOverduePill === true;
      const showBigOverdue = opts.showBigOverdue === true;
      const fullHeight = opts.fullHeight === true;
      return (
        <div style={{border:'1px solid #e5e7eb', borderRadius:12, background:'#fff', padding:10, height: fullHeight ? '100%' : undefined, display: fullHeight ? 'flex' : undefined, flexDirection: fullHeight ? 'column' : undefined}}>
          {/* Header row: title on left, big overdue box on right (when enabled) */}
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10, gap:8}}>
            <div style={{fontWeight:700}}>{label}</div>
            {showBigOverdue && (
              <div style={{
                border:'2px solid #fca5a5', background:'#fef2f2', color:'#991b1b',
                borderRadius:12, padding:'8px 12px', fontWeight:800,
                display:'inline-flex', alignItems:'center', gap:8, fontSize:16, whiteSpace:'nowrap'
              }}>
                Overdue: {group.overdue || 0}
              </div>
            )}
          </div>
          {/* Chips row */}
          <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
            {showOverduePill && (
              <span style={{padding:'3px 8px', borderRadius:999, fontSize:11, background:'#fef2f2', color:'#991b1b', border:'1px solid #fecaca'}}>Overdue: {group.overdue||0}</span>
            )}
            <span style={{padding:'3px 8px', borderRadius:999, fontSize:11, background:'#eef2ff', color:'#3730a3', border:'1px solid #c7d2fe'}}>Pending: {Math.max(0, (group.pending||0))}</span>
            <span style={{padding:'3px 8px', borderRadius:999, fontSize:11, background:'#ecfdf5', color:'#065f46', border:'1px solid #a7f3d0'}}>Done: {group.done||0}</span>
            <span style={{padding:'3px 8px', borderRadius:999, fontSize:11, background:'#ecfdf5', color:'#065f46', border:'1px solid #a7f3d0'}}>Sent: {group.sent||0}</span>
            <span style={{padding:'3px 8px', borderRadius:999, fontSize:11, background:'#fef2f2', color:'#991b1b', border:'1px solid #fecaca'}}>Failed: {group.failed||0}</span>
          </div>
        </div>
      );
    };
    return (
      <div style={{display:'grid', gridTemplateColumns:'1fr', gap:12, margin:'4px 0 12px'}}>
        {/* Full-width total */}
        <div>{groupCard('Total', overviewTotals.total || {}, { showOverduePill: true })}</div>
        {/* Row aligning with Today (left) and Tomorrow (right) panels */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, alignItems:'stretch'}}>
          <div style={{height:'100%'}}>{groupCard('Today', overviewTotals.today || {}, { showBigOverdue: true, fullHeight: true })}</div>
          <div style={{height:'100%'}}>{groupCard('Tomorrow', overviewTotals.tomorrow || {}, { fullHeight: true })}</div>
        </div>
        {/* Row aligning with This Week (left) and This Month (right) panels */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
          <div>{groupCard('This Week', overviewTotals.week || {}, { })}</div>
          <div>{groupCard('This Month', overviewTotals.month || {}, { })}</div>
        </div>
      </div>
    );
  }

  // Employee-scoped loader mirroring main view
  async function loadEmployeeLive() {
    try {
      if (empCtrlRef.current) {
        try { empCtrlRef.current.abort(); } catch {}
      }
      const ctrl = new AbortController();
      empCtrlRef.current = ctrl;
      setEmpLoading(true);
      const { from: lf, to: lt } = scopeRange(leftScope);
      const { from: rf, to: rt } = scopeRange(rightScope);
      const overdueFrom = startOfDay(addDays(new Date(), -180));
      const overdueTo = endOfDay(addDays(new Date(), -1));
      const everyoneAll = (!selectedUserId && (myRole === 'OWNER' || myRole === 'ADMIN'));
      const forUser = everyoneAll ? null : selectedUserId;
      const [
        leftCalls, rightCalls, leftEmails, rightEmails,
        overdueCalls, overdueEmails,
        leftMeetings, rightMeetings, leftCompletedToday
      ] = await Promise.all([
        fetchReminders('CALL', lf, lt, forUser, ctrl.signal),
        fetchReminders('CALL', rf, rt, forUser, ctrl.signal),
        fetchReminders('EMAIL', lf, lt, forUser, ctrl.signal),
        fetchReminders('EMAIL', rf, rt, forUser, ctrl.signal),
        // overdue PENDING for the selected user or Everyone
        fetchReminders('CALL', overdueFrom, overdueTo, forUser, ctrl.signal, { statusList: ['PENDING'] }),
        fetchReminders('EMAIL', overdueFrom, overdueTo, forUser, ctrl.signal, { statusList: ['PENDING'] }),
        fetchMeetings(lf, lt, 'SCHEDULED,RESCHEDULED', forUser, ctrl.signal),
        fetchMeetings(rf, rt, 'SCHEDULED,RESCHEDULED', forUser, ctrl.signal),
        panelMode === 'day' && leftScope === 'today' ? fetchMeetings(lf, lt, 'COMPLETED', forUser, ctrl.signal) : Promise.resolve([]),
      ]);
      if (empCtrlRef.current === ctrl) {
  const callsMap = new Map();
  [...leftCalls, ...rightCalls, ...overdueCalls].forEach(r => callsMap.set(r.id, r));
  const emailsMap = new Map();
  [...leftEmails, ...rightEmails, ...overdueEmails].forEach(r => emailsMap.set(r.id, r));
        const meetingsMap = new Map();
        [...leftMeetings, ...rightMeetings].forEach(m => meetingsMap.set(m.id, m));
        setEmpLiveCalls(Array.from(callsMap.values()));
        setEmpLiveEmails(Array.from(emailsMap.values()));
        setEmpLiveMeetings(Array.from(meetingsMap.values()));
        setEmpTodayCompletedMeetings(Array.isArray(leftCompletedToday) ? leftCompletedToday : []);
      }
    } catch (e) {
      if (e && (e.name === 'AbortError' || e.code === 20)) return;
      console.error(e);
      setEmpError(e.message || String(e));
    } finally {
      if (empCtrlRef.current && empCtrlRef.current.signal && empCtrlRef.current.aborted) {
        // newer request; keep loading state controlled by it
      } else {
        setEmpLoading(false);
      }
    }
  }

  // Reload employee view when selection or scopes change
  useEffect(() => {
    if (activeTab === 'employee') {
      loadEmployeeLive();
    }
  }, [activeTab, selectedUserId, leftScope, rightScope, panelMode, myRole]);

  // Load recent history for CALL/EMAIL based on selected days
  async function loadHistory(forUserId, opts = {}) {
    try {
      if (histCtrlRef.current) {
        try { histCtrlRef.current.abort(); } catch {}
      }
      const ctrl = new AbortController();
      histCtrlRef.current = ctrl;
  const now = new Date();
  const from = startOfDay(addDays(now, -historyDays));
  // If any terminal status (DONE/SENT/FAILED) is selected, include equal days into the future
  const enabledStatuses = Object.entries(historyStatusFilter).filter(([,v]) => v).map(([k]) => k);
  const includesTerminal = enabledStatuses.some(s => s === 'DONE' || s === 'SENT' || s === 'FAILED');
  const to = includesTerminal ? endOfDay(addDays(now, historyDays)) : endOfDay(now);
      // Build kind/status selections for server-side filtering
      const enabledKinds = Object.entries(historyKindFilter).filter(([,v]) => v).map(([k]) => k);
  // enabledStatuses already computed above
      // If no kinds selected, clear history quickly
      if (!enabledKinds.length) { setHistoryRawItems([]); return; }
      const reqOpts = { ...opts, statusList: enabledStatuses };
      const promises = [];
      if (enabledKinds.includes('CALL')) promises.push(fetchReminders('CALL', from, to, forUserId || null, ctrl.signal, reqOpts));
      else promises.push(Promise.resolve([]));
      if (enabledKinds.includes('EMAIL')) promises.push(fetchReminders('EMAIL', from, to, forUserId || null, ctrl.signal, reqOpts));
      else promises.push(Promise.resolve([]));
      const [calls, emails] = await Promise.all(promises);
      if (histCtrlRef.current === ctrl) {
        const all = [...calls, ...emails].map(toItem).sort((a,b) => asDate(b.when) - asDate(a.when));
        setHistoryRawItems(all);
      }
    } catch (e) {
      if (e && (e.name === 'AbortError' || e.code === 20)) return;
      console.error(e);
    }
  }

  // Reload history when days change, and also when active tab/user changes
  useEffect(() => {
    const selfId = (window.__currentUser && window.__currentUser.id) || myUserId;
    if (activeTab === 'assigned') {
      const everyoneAll = (!selectedUserId && (myRole === 'OWNER' || myRole === 'ADMIN'));
      if (selectedUserId) {
        // OWNER/ADMIN: history for selected assignee across all creators
        // EMPLOYEE: restrict to createdBy=self
        if (myRole === 'OWNER' || myRole === 'ADMIN') {
          loadHistory(null, { assignedToUserId: selectedUserId });
        } else {
          loadHistory(null, { createdBySelf: true, assignedToUserId: selectedUserId });
        }
      } else if (everyoneAll) {
        // OWNER/ADMIN with Everyone: history across all creators and assignees
        loadHistory(null);
      } else {
        // EMPLOYEE (or non-admin) Everyone: keep created-by-self scope
        loadHistory(null, { createdBySelf: true });
      }
    } else if (activeTab === 'employee' && (myRole === 'OWNER' || myRole === 'ADMIN')) {
      if (selectedUserId) {
        // History of the selected employee
        loadHistory(selectedUserId);
      } else {
        // Everyone: history across all users
        loadHistory(null);
      }
    } else {
      // My Overview
      // Employees: History should reflect reminders assigned to self
      if (myRole === 'EMPLOYEE') {
        loadHistory(selfId || null);
      } else {
        // Owner/Admin My Overview: keep self history (assigned to self)
        const forUserId = (myRole === 'OWNER' || myRole === 'ADMIN') ? (selfId || null) : null;
        loadHistory(forUserId);
      }
    }
  }, [historyDays, historyKindFilter, historyStatusFilter, activeTab, selectedUserId, myRole, myUserId]);

  // Derived filtered and paginated items
  const historyFiltered = React.useMemo(() => {
    const kinds = Object.entries(historyKindFilter).filter(([,v]) => v).map(([k]) => k);
    const statuses = Object.entries(historyStatusFilter).filter(([,v]) => v).map(([k]) => k);
    const hasKindFilter = kinds.length > 0;
    const hasStatusFilter = statuses.length > 0;
    const list = historyRawItems.filter(it => {
      const k = String(it.kind || '').toUpperCase();
      const s = String(it.status || '').toUpperCase();
      if (hasKindFilter && !kinds.includes(k)) return false;
      if (hasStatusFilter && !statuses.includes(s)) return false;
      return true;
    });
    return list;
  }, [historyRawItems, historyKindFilter, historyStatusFilter]);

  const historyTotalPages = Math.max(1, Math.ceil(historyFiltered.length / historyPageSize));
  const historyPageClamped = Math.min(Math.max(1, historyPage), historyTotalPages);
  const historyPaged = React.useMemo(() => {
    const start = (historyPageClamped - 1) * historyPageSize;
    return historyFiltered.slice(start, start + historyPageSize);
  }, [historyFiltered, historyPageClamped, historyPageSize]);

  // Reset page when filters change
  useEffect(() => { setHistoryPage(1); }, [historyKindFilter, historyStatusFilter]);

  // Cleanup any in-flight requests on unmount
  useEffect(() => {
    return () => {
      try { if (liveCtrlRef.current) liveCtrlRef.current.abort(); } catch {}
      try { if (empCtrlRef.current) empCtrlRef.current.abort(); } catch {}
      try { if (histCtrlRef.current) histCtrlRef.current.abort(); } catch {}
    };
  }, []);

  async function markReminderDone(id) {
    try {
  const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      await fetch(`/api/reminders/${id}`, { method:'PATCH', headers:{ 'Content-Type':'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }, body: JSON.stringify({ status: 'DONE' }) });
      const selfId = (window.__currentUser && window.__currentUser.id) || myUserId;
      if (activeTab === 'employee' && (myRole === 'OWNER' || myRole === 'ADMIN')) {
        await Promise.all([loadEmployeeLive(), selectedUserId ? loadHistory(selectedUserId) : loadHistory(null)]);
      } else if (activeTab === 'assigned' && selectedUserId) {
        if (myRole === 'OWNER' || myRole === 'ADMIN') {
          await Promise.all([loadAssignedTo(), loadHistory(null, { assignedToUserId: selectedUserId })]);
        } else {
          await Promise.all([loadAssignedTo(), loadHistory(null, { createdBySelf: true, assignedToUserId: selectedUserId })]);
        }
      } else if (activeTab === 'assigned' && !selectedUserId) {
        const everyoneAll = (myRole === 'OWNER' || myRole === 'ADMIN');
        await Promise.all([loadAssignedTo(), everyoneAll ? loadHistory(null) : loadHistory(null, { createdBySelf: true })]);
      } else {
        // My Overview: employees -> assigned to self; owner/admin -> assigned to self
        await Promise.all([loadLive(), loadHistory(selfId)]);
      }
    } catch (e) { console.error(e); }
  }

  async function markEmailSent(id) {
    try {
  const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      await fetch(`/api/reminders/${id}`, { method:'PATCH', headers:{ 'Content-Type':'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }, body: JSON.stringify({ status: 'SENT' }) });
      const selfId = (window.__currentUser && window.__currentUser.id) || myUserId;
      if (activeTab === 'employee' && (myRole === 'OWNER' || myRole === 'ADMIN')) {
        await Promise.all([loadEmployeeLive(), selectedUserId ? loadHistory(selectedUserId) : loadHistory(null)]);
      } else if (activeTab === 'assigned' && selectedUserId) {
        if (myRole === 'OWNER' || myRole === 'ADMIN') {
          await Promise.all([loadAssignedTo(), loadHistory(null, { assignedToUserId: selectedUserId })]);
        } else {
          await Promise.all([loadAssignedTo(), loadHistory(null, { createdBySelf: true, assignedToUserId: selectedUserId })]);
        }
      } else if (activeTab === 'assigned' && !selectedUserId) {
        const everyoneAll = (myRole === 'OWNER' || myRole === 'ADMIN');
        await Promise.all([loadAssignedTo(), everyoneAll ? loadHistory(null) : loadHistory(null, { createdBySelf: true })]);
      } else {
        await Promise.all([loadLive(), loadHistory(selfId)]);
      }
    } catch (e) { console.error(e); }
  }

  async function markReminderFailed(id) {
    try {
  const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      await fetch(`/api/reminders/${id}`, { method:'PATCH', headers:{ 'Content-Type':'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }, body: JSON.stringify({ status: 'FAILED' }) });
      const selfId = (window.__currentUser && window.__currentUser.id) || myUserId;
      if (activeTab === 'employee' && (myRole === 'OWNER' || myRole === 'ADMIN')) {
        await Promise.all([loadEmployeeLive(), selectedUserId ? loadHistory(selectedUserId) : loadHistory(null)]);
      } else if (activeTab === 'assigned' && selectedUserId) {
        if (myRole === 'OWNER' || myRole === 'ADMIN') {
          await Promise.all([loadAssignedTo(), loadHistory(null, { assignedToUserId: selectedUserId })]);
        } else {
          await Promise.all([loadAssignedTo(), loadHistory(null, { createdBySelf: true, assignedToUserId: selectedUserId })]);
        }
      } else if (activeTab === 'assigned' && !selectedUserId) {
        const everyoneAll = (myRole === 'OWNER' || myRole === 'ADMIN');
        await Promise.all([loadAssignedTo(), everyoneAll ? loadHistory(null) : loadHistory(null, { createdBySelf: true })]);
      } else {
        await Promise.all([loadLive(), loadHistory(selfId)]);
      }
    } catch (e) { console.error(e); }
  }

  async function revertReminderToPending(id) {
    try {
      const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      await fetch(`/api/reminders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify({ status: 'PENDING' })
      });
      const selfId = (window.__currentUser && window.__currentUser.id) || myUserId;
      // Reuse same refresh semantics as other status updates
      if (activeTab === 'employee' && (myRole === 'OWNER' || myRole === 'ADMIN')) {
        await Promise.all([loadEmployeeLive(), selectedUserId ? loadHistory(selectedUserId) : loadHistory(null)]);
      } else if (activeTab === 'assigned' && selectedUserId) {
        if (myRole === 'OWNER' || myRole === 'ADMIN') {
          await Promise.all([loadAssignedTo(), loadHistory(null, { assignedToUserId: selectedUserId })]);
        } else {
          await Promise.all([loadAssignedTo(), loadHistory(null, { createdBySelf: true, assignedToUserId: selectedUserId })]);
        }
      } else if (activeTab === 'assigned' && !selectedUserId) {
        const everyoneAll = (myRole === 'OWNER' || myRole === 'ADMIN');
        await Promise.all([loadAssignedTo(), everyoneAll ? loadHistory(null) : loadHistory(null, { createdBySelf: true })]);
      } else {
        await Promise.all([loadLive(), loadHistory(selfId)]);
      }
    } catch (e) { console.error(e); }
  }

  const [editRem, setEditRem] = useState(null);
  function openEdit(item) { setEditRem(item); }
  function closeEdit() { setEditRem(null); }

  // Permissions:
  // - Employee Overview is read-only regardless of role
  // - Owner/Admin always have full actions in My Overview
  // - Otherwise, fall back to perms prop or defaults
  const isOwnerAdmin = myRole === 'OWNER' || myRole === 'ADMIN';
  const can = (() => {
    if (activeTab === 'employee') return { create: false, edit: false, delete: false };
    if (isOwnerAdmin) return { create: true, edit: true, delete: true };
    if (perms) return { create: !!perms?.actions?.['Reminders.create'], edit: !!perms?.actions?.['Reminders.edit'], delete: !!perms?.actions?.['Reminders.delete'] };
    return { create: true, edit: true, delete: true };
  })();
  return (
    <div style={{padding:'16px 0'}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:12,gap:12,flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <div style={{fontWeight:700, fontSize:18}}>Reminders</div>
          <div style={{display:'inline-flex', gap:8, marginLeft:8}}>
            <button
              onClick={() => setActiveTab('overview')}
              className="btn"
              style={{ padding:'6px 12px', borderRadius:999, border:'1px solid #d1d5db', background: activeTab==='overview' ? '#111' : '#fff', color: activeTab==='overview' ? '#fff' : '#111', fontWeight:700 }}
            >My Overview</button>
            {/* Employee Overview visible only for OWNER/ADMIN */}
            {(myRole === 'OWNER' || myRole === 'ADMIN') && (
              <button
                onClick={() => setActiveTab('employee')}
                className="btn"
                style={{ padding:'6px 12px', borderRadius:999, border:'1px solid #d1d5db', background: activeTab==='employee' ? '#111' : '#fff', color: activeTab==='employee' ? '#fff' : '#111', fontWeight:700 }}
              >Employee Overview</button>
            )}
            {/* Assigned To tab visible for EMPLOYEE, OWNER, ADMIN */}
            {(myRole === 'EMPLOYEE' || myRole === 'OWNER' || myRole === 'ADMIN') && (
              <button
                onClick={() => setActiveTab('assigned')}
                className="btn"
                style={{ padding:'6px 12px', borderRadius:999, border:'1px solid #d1d5db', background: activeTab==='assigned' ? '#111' : '#fff', color: activeTab==='assigned' ? '#fff' : '#111', fontWeight:700 }}
              >Assigned To</button>
            )}
          </div>
          {can.create && (
            <div style={{display:'inline-flex', gap:8, flexWrap:'wrap'}}>
              <button
                onClick={() => { setShowCreate(true); }}
                className="btn"
                style={{padding:'8px 14px', borderRadius:6, background:'#111', color:'#fff', border:'1px solid #111', fontWeight:600, minWidth:160}}
              >+ Create Reminder</button>
            </div>
          )}
        </div>
        <div>
          <span style={{marginRight:8, color:'#6b7280'}}>View</span>
          <button
            onClick={() => setPanelMode('day')}
            className="btn"
            style={{
              marginRight:6, padding:'8px 14px', borderRadius:16, border:'1px solid #d1d5db',
              background: panelMode==='day' ? '#111' : '#fff', color: panelMode==='day' ? '#fff' : '#111', fontWeight:600
            }}
          >Today & Tomorrow</button>
          <button
            onClick={() => setPanelMode('range')}
            className="btn"
            style={{
              padding:'8px 14px', borderRadius:16, border:'1px solid #d1d5db',
              background: panelMode==='range' ? '#111' : '#fff', color: panelMode==='range' ? '#fff' : '#111', fontWeight:600
            }}
          >This Week & Month</button>
        </div>
      </div>

      {activeTab === 'overview' && (
        <>
      {/* Totals for My Overview (disabled via flag) */}
      {SHOW_OVERVIEW_TOTALS && <TotalsBar />}
      {/* Meetings row */}
      <Section title="Meetings">
        <TwoPanels
          leftTitle={panelMode==='day' ? "Today's meetings" : 'This Week meetings'}
          rightTitle={panelMode==='day' ? "Tomorrow's meetings" : 'This Month meetings'}
          leftItems={filterByScope((() => {
            const base = (liveMeetings.length ? liveMeetings.map(toMeetingItem) : []);
            // Inject today's COMPLETED only into the left panel when viewing Today
            if (panelMode==='day' && leftScope==='today' && todayCompletedMeetings && todayCompletedMeetings.length) {
              const extra = todayCompletedMeetings.map(toMeetingItem);
              const uniq = new Map();
              [...base, ...extra].forEach(x => uniq.set(x.id, x));
              return Array.from(uniq.values());
            }
            return base;
          })(), leftScope)}
          rightItems={filterByScope((liveMeetings.length ? liveMeetings.map(toMeetingItem) : []), rightScope)}
          leftScope={leftScope}
          rightScope={rightScope}
          meetingLayout={'employee-my-overview'}
        />
      </Section>

      {/* Calls row */}
      <Section title="Calls">
        {panelMode==='day' && (
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'4px 4px 8px',gap:8}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <label style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12}}>
                <input type="checkbox" checked={selectionKind==='CALL'} onChange={e=>{ setSelectedIds(new Set()); setSelectionKind(e.target.checked ? 'CALL' : null); }} />
                Select calls
              </label>
              {selectionKind==='CALL' && selectedIds.size>0 && (
                <span style={{fontSize:12,color:'#6b7280'}}>Selected: {selectedIds.size}</span>
              )}
            </div>
            <div>
              <button
                type="button"
                disabled={!(selectionKind==='CALL' && selectedIds.size>0)}
                onClick={()=> setShowBulkMail(true)}
                className="btn"
                style={{border:'1px solid #e5e7eb',background:'#fff',color:'#111',borderRadius:6,padding:'6px 10px',fontWeight:600}}
              >Email selected</button>
            </div>
          </div>
        )}
        <TwoPanels
          leftTitle={panelMode==='day' ? "Today's calls" : 'This Week calls'}
          rightTitle={panelMode==='day' ? "Tomorrow's calls" : 'This Month calls'}
          leftItems={filterByScope(liveCalls.length ? liveCalls.map(toItem) : [], leftScope)}
          rightItems={filterByScope(liveCalls.length ? liveCalls.map(toItem) : [], rightScope)}
          leftScope={leftScope}
          rightScope={rightScope}
          onMarkDone={can.edit ? markReminderDone : undefined}
          onMarkFailed={can.edit ? markReminderFailed : undefined}
          meetingLayout={'employee-my-overview'}
          selectionEnabled={panelMode==='day' && selectionKind==='CALL'}
          selectedIds={selectedIds}
          onToggleSelect={(id) => setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
          selectableKinds={['CALL']}
        />
      </Section>

      {/* Emails row */}
      <Section title="Emails">
        {panelMode==='day' && (
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'4px 4px 8px',gap:8}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <label style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12}}>
                <input type="checkbox" checked={selectionKind==='EMAIL'} onChange={e=>{ setSelectedIds(new Set()); setSelectionKind(e.target.checked ? 'EMAIL' : null); }} />
                Select emails
              </label>
              {selectionKind==='EMAIL' && selectedIds.size>0 && (
                <span style={{fontSize:12,color:'#6b7280'}}>Selected: {selectedIds.size}</span>
              )}
            </div>
            <div>
              <button
                type="button"
                disabled={!(selectionKind==='EMAIL' && selectedIds.size>0)}
                onClick={()=> setShowBulkMail(true)}
                className="btn"
                style={{border:'1px solid #e5e7eb',background:'#fff',color:'#111',borderRadius:6,padding:'6px 10px',fontWeight:600}}
              >Email selected</button>
            </div>
          </div>
        )}
        <TwoPanels
          leftTitle={panelMode==='day' ? "Today's emails" : 'This Week emails'}
          rightTitle={panelMode==='day' ? "Tomorrow's emails" : 'This Month emails'}
          leftItems={filterByScope(liveEmails.length ? liveEmails.map(toItem) : [], leftScope)}
          rightItems={filterByScope(liveEmails.length ? liveEmails.map(toItem) : [], rightScope)}
          leftScope={leftScope}
          rightScope={rightScope}
          onMarkDone={can.edit ? markEmailSent : undefined}
          onMarkFailed={can.edit ? markReminderFailed : undefined}
          meetingLayout={'employee-my-overview'}
          selectionEnabled={panelMode==='day' && selectionKind==='EMAIL'}
          selectedIds={selectedIds}
          onToggleSelect={(id) => setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
          selectableKinds={['EMAIL']}
        />
      </Section>
        </>
      )}

      {activeTab === 'employee' && (myRole === 'OWNER' || myRole === 'ADMIN') && (
        <Section title="Employee Reminders Overview">
          <div style={{border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden', background:'#fff'}}>
            <div style={{padding:'10px 12px', borderBottom:'1px solid #e5e7eb', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap'}}>
              <div style={{display:'flex', alignItems:'center', gap:10}}>
                <span style={{fontSize:12, color:'#6b7280'}}>Employee</span>
                <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} style={{padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:6, minWidth:220}}>
                  <option value="">Everyone</option>
                  {myUserId && (
                    <option value={myUserId}>Myself - {(window.__currentUser && window.__currentUser.username) || 'me'} ({myRole || 'USER'})</option>
                  )}
                  {[...users]
                    .filter(u => u && u.id !== myUserId)
                    .sort((a,b) => {
                      const rank = r => (r==='ADMIN'?0 : r==='EMPLOYEE'?1 : r==='OWNER'?2 : 3);
                      const rr = rank(a.role) - rank(b.role);
                      if (rr !== 0) return rr;
                      const ua = String(a.username||'').toLowerCase();
                      const ub = String(b.username||'').toLowerCase();
                      if (ua < ub) return -1; if (ua > ub) return 1; return 0;
                    })
                    .map(u => {
                      const label = u.username || u.id;
                      return <option key={u.id} value={u.id}>{label} ({u.role})</option>;
                    })}
                </select>
              </div>
              <div style={{display:'flex', alignItems:'center', gap:10}}>
                <span style={{fontSize:12, color:'#6b7280'}}>Range</span>
                {/* Simple presets: from today to future; could add a To date if needed */}
                <span style={{fontSize:12}}>From today onward</span>
                <button
                  className="btn"
                  type="button"
                  title="Reload"
                  aria-label="Reload"
                  onClick={() => loadEmployeeLive()}
                  style={{
                    padding:'6px 10px',
                    border:'1px solid #d1d5db',
                    background:'#fff',
                    borderRadius:6,
                    display:'inline-flex',
                    alignItems:'center',
                    justifyContent:'center',
                    width:34,
                    height:28
                  }}
                >
                  {empLoading ? (
                    <span style={{fontSize:14}}>⏳</span>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="23 4 23 10 17 10"></polyline>
                      <path d="M20.49 15a9 9 0 1 1 2.13-9"></path>
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div style={{padding:12}}>
              {/* Employee Totals (disabled via flag) */}
              {SHOW_EMPLOYEE_TOTALS && (() => {
                const totals = empOverviewTotals;
                if (!totals) {
                  return (
                    <div style={{border:'1px solid #e5e7eb', borderRadius:12, background:'#fff', padding:12, margin:'4px 0 12px', color:'#6b7280', fontSize:12}}>
                      Loading totals…
                    </div>
                  );
                }
                const card = (label, group, opts = {}) => {
                  const showOverduePill = opts.showOverduePill === true;
                  const showBigOverdue = opts.showBigOverdue === true;
                  const fullHeight = opts.fullHeight === true;
                  return (
                    <div style={{border:'1px solid #e5e7eb', borderRadius:12, background:'#fff', padding:10, height: fullHeight ? '100%' : undefined, display: fullHeight ? 'flex' : undefined, flexDirection: fullHeight ? 'column' : undefined}}>
                      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10, gap:8}}>
                        <div style={{fontWeight:700}}>{label}</div>
                        {showBigOverdue && (
                          <div style={{ border:'2px solid #fca5a5', background:'#fef2f2', color:'#991b1b', borderRadius:12, padding:'8px 12px', fontWeight:800, display:'inline-flex', alignItems:'center', gap:8, fontSize:16, whiteSpace:'nowrap' }}>
                            Overdue: {group.overdue || 0}
                          </div>
                        )}
                      </div>
                      <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                        {showOverduePill && (
                          <span style={{padding:'3px 8px', borderRadius:999, fontSize:11, background:'#fef2f2', color:'#991b1b', border:'1px solid #fecaca'}}>Overdue: {group.overdue||0}</span>
                        )}
                        <span style={{padding:'3px 8px', borderRadius:999, fontSize:11, background:'#eef2ff', color:'#3730a3', border:'1px solid #c7d2fe'}}>Pending: {Math.max(0, (group.pending||0))}</span>
                        <span style={{padding:'3px 8px', borderRadius:999, fontSize:11, background:'#ecfdf5', color:'#065f46', border:'1px solid #a7f3d0'}}>Done: {group.done||0}</span>
                        <span style={{padding:'3px 8px', borderRadius:999, fontSize:11, background:'#ecfdf5', color:'#065f46', border:'1px solid #a7f3d0'}}>Sent: {group.sent||0}</span>
                        <span style={{padding:'3px 8px', borderRadius:999, fontSize:11, background:'#fef2f2', color:'#991b1b', border:'1px solid #fecaca'}}>Failed: {group.failed||0}</span>
                      </div>
                    </div>
                  );
                };
                return (
                  <div style={{display:'grid', gridTemplateColumns:'1fr', gap:12, margin:'4px 0 12px'}}>
                    <div>{card('Total', totals.total || {}, { showOverduePill: true })}</div>
                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, alignItems:'stretch'}}>
                      <div style={{height:'100%'}}>{card('Today', totals.today || {}, { showBigOverdue: true, fullHeight: true })}</div>
                      <div style={{height:'100%'}}>{card('Tomorrow', totals.tomorrow || {}, { fullHeight: true })}</div>
                    </div>
                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
                      <div>{card('This Week', totals.week || {}, {})}</div>
                      <div>{card('This Month', totals.month || {}, {})}</div>
                    </div>
                  </div>
                );
              })()}
              {empError && <div style={{color:'#b91c1c', marginBottom:8}}>{empError}</div>}
              {(
                <>
                  {/* Meetings row (employee-scoped) */}
                  <Section title="Meetings">
                    <TwoPanels
                      leftTitle={panelMode==='day' ? "Today's meetings" : 'This Week meetings'}
                      rightTitle={panelMode==='day' ? "Tomorrow's meetings" : 'This Month meetings'}
                      leftItems={filterByScope((() => {
                        const base = (empLiveMeetings.length ? empLiveMeetings.map(toMeetingItem) : []);
                        if (panelMode==='day' && leftScope==='today' && empTodayCompletedMeetings && empTodayCompletedMeetings.length) {
                          const extra = empTodayCompletedMeetings.map(toMeetingItem);
                          const uniq = new Map();
                          [...base, ...extra].forEach(x => uniq.set(x.id, x));
                          return Array.from(uniq.values());
                        }
                        return base;
                      })(), leftScope)}
                      rightItems={filterByScope((empLiveMeetings.length ? empLiveMeetings.map(toMeetingItem) : []), rightScope)}
                      leftScope={leftScope}
                      rightScope={rightScope}
                      meetingLayout={'employee-my-overview'}
                    />
                  </Section>
                  {/* Calls row (employee-scoped) */}
                  <Section title="Calls">
                    <TwoPanels
                      leftTitle={panelMode==='day' ? "Today's calls" : 'This Week calls'}
                      rightTitle={panelMode==='day' ? "Tomorrow's calls" : 'This Month calls'}
                      leftItems={filterByScope(empLiveCalls.length ? empLiveCalls.map(toItem) : [], leftScope)}
                      rightItems={filterByScope(empLiveCalls.length ? empLiveCalls.map(toItem) : [], rightScope)}
                      leftScope={leftScope}
                      rightScope={rightScope}
                      meetingLayout={'employee-my-overview'}
                    />
                  </Section>
                  {/* Emails row (employee-scoped) */}
                  <Section title="Emails">
                    <TwoPanels
                      leftTitle={panelMode==='day' ? "Today's emails" : 'This Week emails'}
                      rightTitle={panelMode==='day' ? "Tomorrow's emails" : 'This Month emails'}
                      leftItems={filterByScope(empLiveEmails.length ? empLiveEmails.map(toItem) : [], leftScope)}
                      rightItems={filterByScope(empLiveEmails.length ? empLiveEmails.map(toItem) : [], rightScope)}
                      leftScope={leftScope}
                      rightScope={rightScope}
                      meetingLayout={'employee-my-overview'}
                    />
                  </Section>
                </>
              )}
            </div>
          </div>
        </Section>
      )}

      {activeTab === 'assigned' && (
        <Section title="Assigned To">
          <div style={{border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden', background:'#fff'}}>
            <div style={{padding:'10px 12px', borderBottom:'1px solid #e5e7eb', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap'}}>
              <div style={{display:'flex', alignItems:'center', gap:10}}>
                <span style={{fontSize:12, color:'#6b7280'}}>Assignee</span>
                <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} style={{padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:6, minWidth:260}}>
                  <option value="">Everyone (all assignees)</option>
                  {myUserId && (
                    <option value={myUserId}>Myself - {(window.__currentUser && window.__currentUser.username) || 'me'} ({myRole || 'USER'})</option>
                  )}
                  {[...users]
                    .filter(u => u && u.id !== myUserId)
                    .sort((a,b) => {
                      const rank = r => (r==='ADMIN'?0 : r==='EMPLOYEE'?1 : r==='OWNER'?2 : 3);
                      const rr = rank(a.role) - rank(b.role);
                      if (rr !== 0) return rr;
                      const ua = String(a.username||'').toLowerCase();
                      const ub = String(b.username||'').toLowerCase();
                      if (ua < ub) return -1; if (ua > ub) return 1; return 0;
                    })
                    .map(u => {
                      const label = u.username || u.id;
                      return <option key={u.id} value={u.id}>{label} ({u.role})</option>;
                    })}
                </select>
              </div>
              <div style={{display:'flex', alignItems:'center', gap:10}}>
                <span style={{fontSize:12, color:'#6b7280'}}>Range</span>
                <span style={{fontSize:12}}>From today onward</span>
                <button
                  className="btn"
                  type="button"
                  title="Reload"
                  aria-label="Reload"
                  onClick={() => loadAssignedTo()}
                  style={{
                    padding:'6px 10px',
                    border:'1px solid #d1d5db',
                    background:'#fff',
                    borderRadius:6,
                    display:'inline-flex',
                    alignItems:'center',
                    justifyContent:'center',
                    width:34,
                    height:28
                  }}
                >
                  {asLoading ? (
                    <span style={{fontSize:14}}>⏳</span>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="23 4 23 10 17 10"></polyline>
                      <path d="M20.49 15a9 9 0 1 1 2.13-9"></path>
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div style={{padding:12}}>
              {asError && <div style={{color:'#b91c1c', marginBottom:8}}>{asError}</div>}
              {(
                <>
                  <Section title="Meetings">
                    <TwoPanels
                      leftTitle={panelMode==='day' ? "Today's meetings" : 'This Week meetings'}
                      rightTitle={panelMode==='day' ? "Tomorrow's meetings" : 'This Month meetings'}
                      leftItems={filterByScope(asMeetings.map(toMeetingItem), leftScope)}
                      rightItems={filterByScope(asMeetings.map(toMeetingItem), rightScope)}
                      leftScope={leftScope}
                      rightScope={rightScope}
                      meetingLayout={'assigned-to-overview'}
                    />
                  </Section>
                  <Section title="Calls">
                    <TwoPanels
                      leftTitle={panelMode==='day' ? "Today's calls" : 'This Week calls'}
                      rightTitle={panelMode==='day' ? "Tomorrow's calls" : 'This Month calls'}
                      leftItems={filterByScope(asCalls.map(toItem), leftScope)}
                      rightItems={filterByScope(asCalls.map(toItem), rightScope)}
                      leftScope={leftScope}
                      rightScope={rightScope}
                      onEdit={openEdit}
                      onMarkDone={markReminderDone}
                      onMarkFailed={markReminderFailed}
                      meetingLayout={'assigned-to-overview'}
                    />
                  </Section>
                  <Section title="Emails">
                    <TwoPanels
                      leftTitle={panelMode==='day' ? "Today's emails" : 'This Week emails'}
                      rightTitle={panelMode==='day' ? "Tomorrow's emails" : 'This Month emails'}
                      leftItems={filterByScope(asEmails.map(toItem), leftScope)}
                      rightItems={filterByScope(asEmails.map(toItem), rightScope)}
                      leftScope={leftScope}
                      rightScope={rightScope}
                      onEdit={openEdit}
                      onMarkDone={markEmailSent}
                      onMarkFailed={markReminderFailed}
                      meetingLayout={'assigned-to-overview'}
                    />
                  </Section>
                </>
              )}
            </div>
          </div>
        </Section>
      )}

      {can.create && showCreate && (
        <CreateReminderModal isAdmin={isAdminUser} prefill={prefillReminder} onClose={() => {
          setShowCreate(false);
          setPrefillReminder(null);
          if (activeTab === 'employee') {
            loadEmployeeLive();
            if (myRole === 'OWNER' || myRole === 'ADMIN') {
              if (selectedUserId) loadHistory(selectedUserId); else loadHistory(null);
            } else {
              const selfId = (window.__currentUser && window.__currentUser.id) || myUserId;
              loadHistory(selfId);
            }
          } else if (activeTab === 'assigned') {
            loadAssignedTo();
            if (selectedUserId) {
              if (myRole === 'OWNER' || myRole === 'ADMIN') {
                loadHistory(null, { assignedToUserId: selectedUserId });
              } else {
                loadHistory(null, { createdBySelf: true, assignedToUserId: selectedUserId });
              }
            } else {
              const everyoneAll = (myRole === 'OWNER' || myRole === 'ADMIN');
              if (everyoneAll) loadHistory(null); else loadHistory(null, { createdBySelf: true });
            }
          } else {
            const selfId = (myUserId || (window.__currentUser && window.__currentUser.id)) || null;
            loadLive();
            loadHistory(selfId);
          }
        }} />)
      }
      {showBulkMail && (
        <BulkRemindersModal
          onClose={async (didSend) => {
            setShowBulkMail(false);
            setSelectionKind(null);
            setSelectedIds(new Set());
            if (didSend) {
              // refresh
              await loadLive();
            }
          }}
          selectedIds={Array.from(selectedIds)}
          // Provide access to current items so modal can mark statuses after send
          resolveItemsById={(ids) => {
            const map = new Map();
            [...(liveCalls||[]).map(toItem), ...(liveEmails||[]).map(toItem)].forEach(it => map.set(it.id, it));
            return ids.map(id => map.get(id)).filter(Boolean);
          }}
        />
      )}
      {can.edit && editRem && (
        <EditReminderModal item={editRem} onClose={() => {
          closeEdit();
          if (activeTab === 'employee') {
            loadEmployeeLive();
            if (myRole === 'OWNER' || myRole === 'ADMIN') {
              if (selectedUserId) loadHistory(selectedUserId); else loadHistory(null);
            } else {
              const selfId = (window.__currentUser && window.__currentUser.id) || myUserId;
              loadHistory(selfId);
            }
          } else if (activeTab === 'assigned') {
            loadAssignedTo();
            if (selectedUserId) {
              if (myRole === 'OWNER' || myRole === 'ADMIN') {
                loadHistory(null, { assignedToUserId: selectedUserId });
              } else {
                loadHistory(null, { createdBySelf: true, assignedToUserId: selectedUserId });
              }
            } else {
              const everyoneAll = (myRole === 'OWNER' || myRole === 'ADMIN');
              if (everyoneAll) loadHistory(null); else loadHistory(null, { createdBySelf: true });
            }
          } else {
            const selfId = (myUserId || (window.__currentUser && window.__currentUser.id)) || null;
            loadLive();
            loadHistory(selfId);
          }
        }} />
      )}

      {/* History section below Emails */}
      <Section title="History (Calls & Emails)">
        <div style={{border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden', background:'#fff'}}>
          <div style={{padding:'10px 12px', borderBottom:'1px solid #e5e7eb', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8}}>
            <div style={{fontWeight:700}}>Recent activity</div>
            <div style={{display:'flex', alignItems:'center', gap:12}}>
              <div style={{fontSize:12, color:'#6b7280'}}>Range</div>
              <select value={historyDays} onChange={e => setHistoryDays(Number(e.target.value))} style={{padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:6}}>
                {[7,14,30,90].map(n => <option key={n} value={n}>Last {n} days</option>)}
              </select>
              <div style={{fontSize:12, color:'#6b7280'}}>Type</div>
              {['CALL','EMAIL'].map(k => (
                <label key={k} style={{display:'inline-flex', alignItems:'center', gap:6, fontSize:12}}>
                  <input type="checkbox" checked={!!historyKindFilter[k]} onChange={e => setHistoryKindFilter(f => ({ ...f, [k]: e.target.checked }))} />
                  {k}
                </label>
              ))}
              <div style={{fontSize:12, color:'#6b7280'}}>Status</div>
              {['PENDING','DONE','SENT','FAILED'].map(s => (
                <label key={s} style={{display:'inline-flex', alignItems:'center', gap:6, fontSize:12}}>
                  <input type="checkbox" checked={!!historyStatusFilter[s]} onChange={e => setHistoryStatusFilter(f => ({ ...f, [s]: e.target.checked }))} />
                  {s}
                </label>
              ))}
              <div style={{fontSize:12, color:'#6b7280'}}>Page</div>
              <select value={historyPageSize} onChange={e => { setHistoryPageSize(Number(e.target.value)); setHistoryPage(1); }} style={{padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:6}}>
                {[10,20,50].map(n => <option key={n} value={n}>{n}/page</option>)}
              </select>
              <div style={{display:'inline-flex', gap:6, alignItems:'center'}}>
                <button
                  type="button"
                  className="btn"
                  disabled={historyPageClamped === 1}
                  style={{
                    background: historyPageClamped === 1 ? '#f5f5f5' : '#eee',
                    color: historyPageClamped === 1 ? '#9ca3af' : '#222',
                    cursor: historyPageClamped === 1 ? 'not-allowed' : 'pointer'
                  }}
                  onClick={() => setHistoryPage(p => Math.max(1, p-1))}
                >
                  Prev
                </button>
                <div style={{fontSize:12, color:'#6b7280'}}>{historyPageClamped} / {historyTotalPages}</div>
                <button
                  type="button"
                  className="btn"
                  disabled={historyPageClamped === historyTotalPages}
                  style={{
                    background: historyPageClamped === historyTotalPages ? '#f5f5f5' : '#eee',
                    color: historyPageClamped === historyTotalPages ? '#9ca3af' : '#222',
                    cursor: historyPageClamped === historyTotalPages ? 'not-allowed' : 'pointer'
                  }}
                  onClick={() => setHistoryPage(p => Math.min(historyTotalPages, p+1))}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
          <div>
            {historyFiltered.length === 0 && (
              <div style={{padding:16, color:'#6b7280'}}>No recent calls or emails</div>
            )}
            {historyPaged.map(it => (
              <div key={`h-${it.id}`} style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid #eef2f7'}}>
                <div>
                  <div style={{fontWeight:600}}>
                    <Tooltip content={renderReminderTooltip(it)} delayShow={400} delayHide={120}>
                      <span style={{cursor:'help'}}>{it.title}</span>
                    </Tooltip>
                  </div>
                  <div style={{fontSize:12, color:'#6b7280'}}>
                    {(() => {
                      const f = fmtDateAndTime(it.when);
                      return (
                        <>
                          <span style={{fontWeight:700, color:'#111'}}>{f.dateText}</span>
                          <span style={{margin:'0 4px'}}>,</span>
                          <span style={{fontWeight:800, color:'#111', background:'#eef2ff', padding:'1px 6px', borderRadius:6}}>{f.timeText}</span>
                          {it.who ? <span> · {it.who}</span> : null}
                        </>
                      );
                    })()}
                  </div>
                </div>
                <div style={{display:'flex', alignItems:'center', gap:8}}>
                  {/* Assigned To chip for clarity */}
                  {(() => {
                    const isYou = it.assigned_to_user_id && myUserId && String(it.assigned_to_user_id) === String(myUserId);
                    const label = isYou ? 'You' : (it.assigned_to || '');
                    return label ? (
                      <span title="Assignee" style={{padding:'3px 8px', borderRadius:999, fontSize:11, fontWeight:800, background:'#eef2ff', color:'#3730a3', border:'1px solid #c7d2fe'}}>
                        Assigned To {label}
                      </span>
                    ) : null;
                  })()}
                  {/* Type pill */}
                  <span style={{padding:'3px 8px', borderRadius:999, fontSize:11, fontWeight:700, background:'#f3f4f6', color:'#374151'}}>{it.kind}</span>
                  <span style={badgeStyle(it.status)} className="badge">{chipIcon(it.kind, it.status)} {it.status}</span>
                  {(['EMAIL','CALL'].includes(String(it.kind).toUpperCase())) && it.emails_sent_attempts>0 ? (
                    <span title={`Total send attempts recorded`} style={{padding:'3px 8px', borderRadius:999, fontSize:11, fontWeight:700, background:'#f0f9ff', color:'#075985', border:'1px solid #bae6fd'}}>
                      Sent: {it.emails_sent_attempts}
                    </span>
                  ) : null}
                  {(() => {
                    const terminal = it.status === 'DONE' || it.status === 'SENT' || it.status === 'FAILED';
                    const isMyOverview = activeTab === 'overview';
                    const isAssignedToMe = it.assigned_to_user_id && myUserId && String(it.assigned_to_user_id) === String(myUserId);
                    if (terminal && isMyOverview && isAssignedToMe) {
                      return (
                        <button
                          type="button"
                          className="btn"
                          title="Revert to PENDING"
                          onClick={() => {
                            if (window.confirm('Revert this reminder back to PENDING?')) {
                              revertReminderToPending(it.id);
                            }
                          }}
                          style={{border:'1px solid #e5e7eb', background:'#fff', color:'#111', borderRadius:999, padding:'3px 8px', fontSize:11}}
                        >
                          ↺ Revert
                        </button>
                      );
                    }
                    return null;
                  })()}
                </div>
              </div>
            ))}
            {historyFiltered.length > 0 && (
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 12px', fontSize:12, color:'#6b7280'}}>
                <div>Total: {historyFiltered.length}</div>
                <div>Showing {(historyPageClamped-1)*historyPageSize + 1} - {Math.min(historyPageClamped*historyPageSize, historyFiltered.length)}</div>
              </div>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{marginBottom:16}}>
      <div style={{fontWeight:700, margin:'8px 4px'}}>{title}</div>
      {children}
    </div>
  );
}

function TwoPanels({ leftTitle, rightTitle, leftItems, rightItems, leftScope, rightScope, onMarkDone, onMarkFailed, onEdit, meetingLayout, selectionEnabled, selectedIds, onToggleSelect, selectableKinds }) {
  return (
    <div className="two-panels">
      <Panel title={leftTitle} scopeKey={leftScope} items={leftItems} onMarkDone={onMarkDone} onMarkFailed={onMarkFailed} onEdit={onEdit} meetingLayout={meetingLayout} selectionEnabled={selectionEnabled} selectedIds={selectedIds} onToggleSelect={onToggleSelect} selectableKinds={selectableKinds} />
      <Panel title={rightTitle} scopeKey={rightScope} items={rightItems} onMarkDone={onMarkDone} onMarkFailed={onMarkFailed} onEdit={onEdit} meetingLayout={meetingLayout} selectionEnabled={selectionEnabled} selectedIds={selectedIds} onToggleSelect={onToggleSelect} selectableKinds={selectableKinds} />
    </div>
  );
}

function Panel({ title, scopeKey, items, onMarkDone, onMarkFailed, onEdit, meetingLayout, selectionEnabled, selectedIds, onToggleSelect, selectableKinds }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    // refresh every 30s so countdown badges update
    const id = setInterval(() => forceTick(x => x + 1), 30000);
    return () => clearInterval(id);
  }, []);
  const { from, to } = scopes[scopeKey]();
  const rangeText = scopeKey === 'today' || scopeKey === 'tomorrow'
    ? fmtDay(from)
    : `${fmtDay(from)} - ${fmtDay(to)}`;
  const isMonthScope = scopeKey === 'month';
  const monthName = (d) => new Date(d).toLocaleDateString(undefined, { month: 'long' });
  const nextMonthChip = (when) => {
    if (!isMonthScope) return null;
    const now = new Date();
    const w = asDate(when);
    if (w.getMonth() !== now.getMonth() || w.getFullYear() !== now.getFullYear()) {
      const lab = monthName(w);
      return (
        <span title={`Falls in ${lab}`} style={{padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:800, background:'#fffbeb', color:'#92400e', border:'1px solid #fde68a'}}>
          Next month — {lab}
        </span>
      );
    }
    return null;
  };
  const empMyOverviewLayout = meetingLayout === 'employee-my-overview';
  const assignedOverviewLayout = meetingLayout === 'assigned-to-overview';

  // Sort so active tasks appear first and completed (or terminal) statuses sink to the bottom.
  const sortedItems = useMemo(() => {
    const priority = (it) => {
      const st = String(it.status || '').toUpperCase();
      const k = String(it.kind || '').toUpperCase();
      if (k === 'MEETING') {
        // Active first
        return (st === 'SCHEDULED' || st === 'RESCHEDULED') ? 0 : 1;
      }
      // Reminders: PENDING first; DONE/SENT/FAILED later
      return st === 'PENDING' ? 0 : 1;
    };
    const copy = items.slice();
    copy.sort((a, b) => {
      const pa = priority(a);
      const pb = priority(b);
      if (pa !== pb) return pa - pb;
      const ta = asDate(a.when).getTime();
      const tb = asDate(b.when).getTime();
      if (ta !== tb) return ta - tb;
      // stable fallback by id
      return String(a.id).localeCompare(String(b.id));
    });
    return copy;
  }, [items]);

  return (
    <div style={{border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden', background:'#fff'}}>
      <div style={{padding:'10px 12px', borderBottom:'1px solid #e5e7eb', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <div style={{fontWeight:700, textTransform:'capitalize'}}>{title}</div>
        <div style={{fontSize:12, color:'#6b7280'}}>{rangeText}</div>
      </div>
      <div>
        {sortedItems.length === 0 && (
          <div style={{padding:16, color:'#6b7280'}}>No items</div>
        )}
        {sortedItems.map(it => (
          <div key={it.id} style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid #eef2f7', gap:10}}>
            {selectionEnabled && (scopeKey==='today' || scopeKey==='tomorrow') && (!selectableKinds || selectableKinds.includes(String(it.kind).toUpperCase())) ? (
              <input
                type="checkbox"
                checked={!!(selectedIds && selectedIds.has(it.id))}
                onChange={() => onToggleSelect && onToggleSelect(it.id)}
                style={{marginRight:4}}
                aria-label={`Select ${it.title}`}
              />
            ) : null}
            {/* Left content area: media-row for Employee My Overview meetings; default for others */}
            {(empMyOverviewLayout || assignedOverviewLayout) && it.kind === 'MEETING' ? (
              <div style={{flex:1, minWidth:0}}>
                {(() => {
                  const f = fmtDateAndTime(it.when);
                  const whenDate = asDate(it.when);
                  const now = new Date();
                  const isPast = whenDate < now;
                  const badgeTimer = isPast
                    ? { border:'1px solid #fecaca', background:'#fef2f2', color:'#991b1b' }
                    : { border:'1px solid #e5e7eb', background:'#fff', color:'#374151' };
                  const by = it.created_by_username || it.created_by_name || '';
                  const toUser = it.assignee || it.assigned_to || '';
                  const gridCols = assignedOverviewLayout ? '140px 1fr 240px' : '140px 1fr 200px';
                  return (
                    <div style={{display:'grid', gridTemplateColumns:gridCols, gap:12, alignItems:'stretch'}}>
                      {/* Left: date + time on one line, then countdown */}
                      <div style={{display:'flex', flexDirection:'column', gap:6, paddingRight:12, borderRight:'2px solid #d1d5db', height:'100%', justifyContent:'center'}}>
                        <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                          <span style={{fontWeight:700, color:'#111', fontSize:12}}>{f.dateText}</span>
                          <span style={{fontWeight:700, color:'#111', background:'#eef2ff', padding:'1px 6px', borderRadius:6, fontSize:12}}>{f.timeText}</span>
                          {nextMonthChip(it.when)}
                        </div>
                        <div title={whenDate.toLocaleString()} style={{...badgeTimer, padding:'2px 8px', borderRadius:999, fontSize:11, width:'fit-content'}}>
                          ⏱ {timeLeftLabel(it.when)}
                        </div>
                      </div>
                      {/* Middle: client name and subject */}
                      <div style={{minWidth:0, paddingRight:12, borderRight:'2px solid #d1d5db', height:'100%', display:'flex', flexDirection:'column', justifyContent:'center'}}>
                        <div style={{fontSize:12, color:'#6b7280', marginBottom:4}}>
                          Client name: {it.client_name ? (
                            <span style={{color:'#111', fontWeight:700}}>&quot;{it.client_name}&quot;</span>
                          ) : (
                            <span style={{color:'#9ca3af'}}>&quot;-&quot;</span>
                          )}
                        </div>
                        <div style={{fontWeight:600, whiteSpace:'nowrap', textOverflow:'ellipsis', overflow:'hidden'}}>
                          <span style={{fontSize:12, color:'#6b7280', fontWeight:500, marginRight:6}}>subject:</span>
                          <span title={it.title}>{it.title}</span>
                        </div>
                      </div>
                      {/* Right: assigned chip and status */}
                      <div style={{display:'flex', flexDirection:'column', gap:6, alignItems:'flex-end'}}>
                        {(() => {
                          const label = assignedOverviewLayout ? (it.assigned_to_username || toUser) : by;
                          return label;
                        })() ? (
                          <div style={{whiteSpace:'nowrap'}}>
                            <span style={{fontSize:12, color:'#6b7280', marginRight:6}}>{assignedOverviewLayout ? 'Assigned to' : 'Assigned by'}</span>
                            <span style={{padding:'2px 8px', borderRadius:999, fontSize:12, fontWeight:800, background:'#ecfeff', color:'#155e75', border:'1px solid #a5f3fc'}}>@{assignedOverviewLayout ? (it.assigned_to_username || toUser) : by}</span>
                          </div>
                        ) : null}
                        <span style={badgeStyle(it.status)} className="badge">{chipIcon(it.kind, it.status)} {it.status}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (empMyOverviewLayout || assignedOverviewLayout) && (it.kind === 'CALL' || it.kind === 'EMAIL') ? (
              <div style={{flex:1, minWidth:0}}>
                {(() => {
                  const f = fmtDateAndTime(it.when);
                  const whenDate = asDate(it.when);
                  const now = new Date();
                  const isPast = whenDate < now;
                  const badgeTimer = isPast
                    ? { border:'1px solid #fecaca', background:'#fef2f2', color:'#991b1b' }
                    : { border:'1px solid #bbf7d0', background:'#ecfdf5', color:'#166534' };
                  const by = it.created_by_username || it.created_by_name || '';
                  const isEmail = String(it.kind).toUpperCase() === 'EMAIL';
                  const personOrEmail = isEmail ? (it.receiver_email || it.who || '-') : (it.person_name || it.who || '-');
                  const toUser = it.assigned_to || '';
                  const gridCols = assignedOverviewLayout ? '140px 1fr 240px' : '140px 1fr 200px';
                  return (
                    <div style={{display:'grid', gridTemplateColumns:gridCols, gap:12, alignItems:'stretch'}}>
                      {/* Left: date + time line, then countdown */}
                      <div style={{display:'flex', flexDirection:'column', gap:6, paddingRight:12, borderRight:'2px solid #d1d5db', height:'100%', justifyContent:'center'}}>
                        <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                          <span style={{fontWeight:700, color:'#111', fontSize:12}}>{f.dateText}</span>
                          <span style={{fontWeight:700, color:'#111', background:'#eef2ff', padding:'1px 6px', borderRadius:6, fontSize:12}}>{f.timeText}</span>
                          {nextMonthChip(it.when)}
                        </div>
                        <div title={whenDate.toLocaleString()} style={{...badgeTimer, padding:'2px 8px', borderRadius:999, fontSize:11, width:'fit-content'}}>
                          ⏱ {(() => { const info = dueLeftInfo(it.when); return info.state === 'past' ? `Overdue by ${info.hm}` : `Starts in ${info.hm}`; })()}
                        </div>
                      </div>
                      {/* Middle: client (only if present), then person/email, then subject */}
                      <div style={{minWidth:0, paddingRight:12, borderRight:'2px solid #d1d5db', height:'100%', display:'flex', flexDirection:'column', justifyContent:'center', gap:2}}>
                        {it.client_name ? (
                          <div style={{fontSize:12, color:'#6b7280'}}>Client name: <span style={{color:'#111', fontWeight:700}}>&quot;{it.client_name}&quot;</span></div>
                        ) : null}
                        <div style={{fontSize:12, color:'#6b7280'}}>
                          {isEmail ? 'email:' : 'person name:'} <span style={{color:'#111', fontWeight:600, fontFamily: isEmail ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' : 'inherit'}}>{personOrEmail}</span>
                        </div>
                        <div style={{fontWeight:600, whiteSpace:'nowrap', textOverflow:'ellipsis', overflow:'hidden'}}>
                          <span style={{fontSize:12, color:'#6b7280', fontWeight:500, marginRight:6}}>subject:</span>
                          <span title={it.title}>{it.title}</span>
                        </div>
                      </div>
                      {/* Right: 3-line stack: 1) Assigned (by/to)  2) Status + Edit  3) Done/Sent + Failed */}
                      <div style={{display:'flex', flexDirection:'column', gap:6, alignItems:'flex-end', justifyContent:'center'}}>
                        {/* Line 1: Assigned chip */}
                        {(() => {
                          const label = assignedOverviewLayout ? (it.assigned_to_username || toUser) : by;
                          return label;
                        })() ? (
                          <div style={{display:'flex', alignItems:'center', gap:8, whiteSpace:'nowrap'}}>
                            <span style={{fontSize:12, color:'#6b7280'}}>{assignedOverviewLayout ? 'Assigned to' : 'Assigned by'}</span>
                            <span style={{padding:'2px 8px', borderRadius:999, fontSize:12, fontWeight:800, background:'#ecfeff', color:'#155e75', border:'1px solid #a5f3fc'}}>@{assignedOverviewLayout ? (it.assigned_to_username || toUser) : by}</span>
                          </div>
                        ) : null}
                        {/* Line 2: Status + Edit */}
                        <div style={{display:'flex', alignItems:'center', gap:8}}>
                          <span style={badgeStyle(it.status)} className="badge">{chipIcon(it.kind, it.status)} {it.status}</span>
                          {(['EMAIL','CALL'].includes(String(it.kind).toUpperCase())) && it.emails_sent_attempts>0 ? (
                            <span title={`Total send attempts recorded`} style={{padding:'3px 8px', borderRadius:999, fontSize:11, fontWeight:700, background:'#f0f9ff', color:'#075985', border:'1px solid #bae6fd'}}>
                              Sent: {it.emails_sent_attempts}
                            </span>
                          ) : null}
                          {onEdit && (
                            <button className="btn" type="button" title="Edit"
                              onClick={() => onEdit(it)}
                              style={{border:'1px solid #e5e7eb', background:'#fff', color:'#111', borderRadius:999, padding:'3px 8px', fontSize:11}}>
                              ✎ Edit
                            </button>
                          )}
                        </div>
                        {/* Line 3: Done/Sent + Failed (only when not terminal) */}
                        {it.status !== 'DONE' && it.status !== 'FAILED' && it.status !== 'SENT' && (
                          <div style={{display:'flex', alignItems:'center', gap:8}}>
                            {onMarkDone && (
                              <button className="btn" type="button" title={isEmail ? 'Mark sent' : 'Mark done'} onClick={() => onMarkDone(it.id)}
                                style={{border:'1px solid #e5e7eb', background:'#fff', color:'#111', borderRadius:999, padding:'3px 8px', fontSize:11}}>
                                {isEmail ? '✓ Sent' : '✓ Done'}
                              </button>
                            )}
                            {onMarkFailed && (
                              <button className="btn" type="button" title="Mark failed" onClick={() => onMarkFailed(it.id)}
                                style={{border:'1px solid #e5e7eb', background:'#fff', color:'#991b1b', borderRadius:999, padding:'3px 8px', fontSize:11}}>
                                ✕ Failed
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontWeight:600, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                  {it.kind === 'MEETING' && (<MeetingIcon it={it} />)}
                  {(it.kind === 'CALL' || it.kind === 'EMAIL') ? (
                    <Tooltip content={renderReminderTooltip(it)} delayShow={400} delayHide={120}>
                      <span style={{cursor:'help'}}>{it.title}</span>
                    </Tooltip>
                  ) : (
                    <span>{it.title}</span>
                  )}
                  {it.kind === 'MEETING' && it.client_name ? (
                    <span
                      title="Client"
                      style={{
                        display:'inline-block',
                        padding:'2px 8px',
                        borderRadius:999,
                        fontSize:11,
                        fontWeight:800,
                        background:'#fff7ed', // warm highlight
                        color:'#7c2d12',
                        border:'1px solid #fed7aa'
                      }}
                    >
                      {it.client_name}
                    </span>
                  ) : null}
                </div>
                <div style={{fontSize:12, color:'#6b7280', display:'flex', alignItems:'center', flexWrap:'wrap', gap:6}}>
                  {(() => {
                    const f = fmtDateAndTime(it.when);
                    return (
                      <>
                        <span style={{fontWeight:700, color:'#111'}}>{f.dateText}</span>
                        <span style={{fontWeight:800, color:'#111', background:'#eef2ff', padding:'1px 6px', borderRadius:6}}>{f.timeText}</span>
                        {nextMonthChip(it.when)}
                        {it.kind === 'MEETING' ? (
                          <>
                            {/* Default meeting layout (non-employee overview) */}
                            {it.assignee ? (
                              <span title="Assigned To" style={{padding:'1px 6px', borderRadius:999, fontSize:11, fontWeight:700, background:'#eef2ff', color:'#3730a3', border:'1px solid #c7d2fe'}}>
                                {it.assignee}
                              </span>
                            ) : null}
                            {(() => {
                              const hasIds = it.created_by_user_id && it.assigned_to_user_id;
                              const idsDiffer = hasIds && String(it.created_by_user_id) !== String(it.assigned_to_user_id);
                              const labelsDiffer = !hasIds && it.created_by_name && it.assignee && String(it.created_by_name) !== String(it.assignee);
                              return (idsDiffer || labelsDiffer) && (it.created_by_username || it.created_by_name);
                            })() ? (
                              <span title="Assigned by" style={{padding:'1px 6px', borderRadius:999, fontSize:11, fontWeight:800, background:'#ecfeff', color:'#155e75', border:'1px solid #a5f3fc'}}>
                                Assigned by {it.created_by_username || it.created_by_name}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <>
                            {it.who ? <span>{it.who}</span> : null}
                            {(() => {
                              const hasIds = it.created_by_user_id && it.assigned_to_user_id;
                              const idsDiffer = hasIds && String(it.created_by_user_id) !== String(it.assigned_to_user_id);
                              const label = it.created_by_username || it.created_by_name;
                              const labelsDiffer = !hasIds && label && it.assigned_to && String(label) !== String(it.assigned_to);
                              return (idsDiffer || labelsDiffer) && label;
                            })() ? (
                              <span title="Assigned by" style={{padding:'1px 6px', borderRadius:999, fontSize:11, fontWeight:800, background:'#ecfeff', color:'#155e75', border:'1px solid #a5f3fc'}}>
                                Assigned by {it.created_by_username || it.created_by_name}
                              </span>
                            ) : null}
                          </>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
            {(() => {
              if ((empMyOverviewLayout || assignedOverviewLayout) && (it.kind === 'MEETING' || it.kind === 'CALL' || it.kind === 'EMAIL')) return null; // countdown/status/buttons rendered within the custom grid
              const now = new Date();
              const whenDate = asDate(it.when);
              const isFuture = whenDate > now;
              const isPast = whenDate < now;
              const isTodayScope = scopeKey === 'today';
              const isTomorrowScope = scopeKey === 'tomorrow';
              const isMeeting = it.kind === 'MEETING';
              const isReminder = it.kind === 'CALL' || it.kind === 'EMAIL';
              const isSched = it.status === 'SCHEDULED' || it.status === 'RESCHEDULED';

              // Show logic
              // Show meeting timers for all scopes when status is active (SCHEDULED/RESCHEDULED)
              const showMeetingTimer = isMeeting && isSched;
              const showReminderTimer = isTodayScope && isReminder && it.status === 'PENDING';
              const showTimer = showMeetingTimer || showReminderTimer;

              // Style logic (red when past)
              let badgeStyleTimer;
              if (isReminder) {
                badgeStyleTimer = isPast
                  ? { border:'1px solid #fecaca', background:'#fef2f2', color:'#991b1b' }
                  : { border:'1px solid #bbf7d0', background:'#ecfdf5', color:'#166534' };
              } else {
                badgeStyleTimer = isPast
                  ? { border:'1px solid #fecaca', background:'#fef2f2', color:'#991b1b' }
                  : { border:'1px solid #e5e7eb', background:'#fff', color:'#374151' };
              }

              const meetingLabel = timeLeftLabel(it.when);
              const remInfo = dueLeftInfo(it.when);

              return (
                <div style={{display:'flex', alignItems:'flex-end', gap:6, flexDirection:'column'}}>
                  {showTimer && (
                    <div title={whenDate.toLocaleString()} style={{...badgeStyleTimer, padding:'2px 6px', borderRadius:999, fontSize:11}}>
                      ⏱ {isMeeting ? (
                        meetingLabel
                      ) : (
                        remInfo.state === 'past' ? (
                          <>Overdue by <span style={{fontWeight:700}}>{remInfo.hm}</span></>
                        ) : (
                          <>Starts in <span style={{fontWeight:800, color:'#166534'}}>{remInfo.hm}</span></>
                        )
                      )}
                    </div>
                  )}
                  <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', justifyContent:'flex-end'}}>
                    <span style={badgeStyle(it.status)} className="badge">{chipIcon(it.kind, it.status)} {it.status}</span>
                    {(['EMAIL','CALL'].includes(String(it.kind).toUpperCase())) && it.emails_sent_attempts>0 ? (
                      <span title={`Total send attempts recorded`} style={{padding:'3px 8px', borderRadius:999, fontSize:11, fontWeight:700, background:'#f0f9ff', color:'#075985', border:'1px solid #bae6fd'}}>
                        Sent: {it.emails_sent_attempts}
                      </span>
                    ) : null}
                    {it && (it.kind === 'CALL' || it.kind === 'EMAIL') && (
                      <>
                        {onEdit && (
                          <button className="btn" type="button" title="Edit"
                            onClick={() => onEdit(it)}
                            style={{border:'1px solid #e5e7eb', background:'#fff', color:'#111', borderRadius:999, padding:'3px 8px', fontSize:11}}>
                            ✎ Edit
                          </button>
                        )}
                        {it.status !== 'DONE' && it.status !== 'FAILED' && it.status !== 'SENT' && (
                          <>
                            {onMarkDone && (
                              <button className="btn" type="button" title={it.kind==='EMAIL' ? 'Mark sent' : 'Mark done'} onClick={() => onMarkDone(it.id)}
                                style={{border:'1px solid #e5e7eb', background:'#fff', color:'#111', borderRadius:999, padding:'3px 8px', fontSize:11}}>
                                {it.kind==='EMAIL' ? '✓ Sent' : '✓ Done'}
                              </button>
                            )}
                            {onMarkFailed && (
                              <button className="btn" type="button" title="Mark failed" onClick={() => onMarkFailed(it.id)}
                                style={{border:'1px solid #e5e7eb', background:'#fff', color:'#991b1b', borderRadius:999, padding:'3px 8px', fontSize:11}}>
                                ✕ Failed
                              </button>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}

function badgeStyle(status) {
  const base = { padding:'3px 8px', borderRadius:999, fontSize:11, fontWeight:700 };
  const styles = {
    PENDING: { background:'#f3f4f6', color:'#374151' },
    SENT: { background:'#dcfce7', color:'#166534' },
    DONE: { background:'#dcfce7', color:'#166534' },
    FAILED: { background:'#fee2e2', color:'#991b1b' },
    // Meeting statuses
    SCHEDULED: { background:'#e0e7ff', color:'#3730a3' },
    RESCHEDULED: { background:'#ede9fe', color:'#5b21b6' },
    COMPLETED: { background:'#dcfce7', color:'#166534' },
    CANCELLED: { background:'#fee2e2', color:'#991b1b' },
    NO_SHOW: { background:'#fde68a', color:'#92400e' },
  };
  const style = styles[status] || styles.PENDING;
  return { ...base, ...style };
}

// Resolve meeting icon (contract vs customer). Falls back to customer if unknown.
function meetingIconPath(it) {
  if (!it) return '/assets/customer.png';
  const isContract = !!(it.contract_id || it.contract_name || (it.profile_type && /contract/i.test(it.profile_type)));
  return isContract ? '/assets/contract.png' : '/assets/customer.png';
}

// miniBadgeStyle removed; using main status chip for all

// Map reminder row to UI item shape used by Panel
// IMPORTANT: include full fields so Edit modal can prefill correctly
function toItem(r) {
  const userIdx = (typeof window !== 'undefined' && window.__userIndex) || {};
  const byId = r.assigned_to_user_id && userIdx[r.assigned_to_user_id];
  const assignedUserName = r.assigned_to_username || (byId && (byId.username || (byId.email ? byId.email.split('@')[0] : byId.full_name))) || '';
  return {
    id: r.id,
    title: r.title || (r.type + ' reminder'),
    when: r.due_ts,
    who: r.receiver_email || r.person_name || '-',
    status: r.status,
    kind: r.type,
  emails_sent_attempts: Number(r.emails_sent_attempts || 0),
    // extra fields for edit prefill
    type: r.type,
    person_name: r.person_name || '',
    phone: r.phone || '',
    receiver_email: r.receiver_email || '',
    notes: r.notes || '',
    opportunity_id: r.opportunity_id || '',
    client_name: r.client_name || '',
    assigned_to: r.assigned_to || '',
    assigned_to_user_id: r.assigned_to_user_id || null,
    assigned_to_username: assignedUserName,
    created_by_user_id: r.created_by_user_id || null,
    created_by_username: r.created_by_username || '',
    created_by_name: r.created_by_full_name || r.created_by_username || r.created_by_email || r.created_by || '',
  };
}

function toMeetingItem(m) {
  const userIdx = (typeof window !== 'undefined' && window.__userIndex) || {};
  const byId = m.assigned_to_user_id && userIdx[m.assigned_to_user_id];
  const assignedUserName = m.assigned_to_username || (byId && (byId.username || (byId.email ? byId.email.split('@')[0] : byId.full_name))) || '';
  return {
    id: m.id,
    title: m.subject || 'Meeting',
    when: m.starts_at || m.when_ts,
    status: m.status,
    kind: 'MEETING',
    client_name: m.client_name || '',
    assignee: m.assigned_to || '',
    assigned_to_username: assignedUserName,
    assigned_to_user_id: m.assigned_to_user_id || null,
    created_by_user_id: m.created_by_user_id || null,
    created_by_name: m.created_by_full_name || m.created_by_username || m.created_by_email || m.created_by || '',
    created_by_username: m.created_by_username || '',
    // Potential contract-related fields (if backend supplies them)
    contract_id: m.contract_id || null,
    contract_name: m.contract_name || '',
    profile_type: m.profile_type || m.type || '',
  };
}

// Inline SVG fallbacks (match Opportunities style)
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

function MeetingIcon({ it }) {
  const [stage, setStage] = React.useState('png'); // png -> svg -> inline
  const isContract = !!(it && (it.contract_id || it.contract_name || (it.profile_type && /contract/i.test(it.profile_type))));
  const svgSrc = isContract ? '/assets/icons/contract.svg' : '/assets/icons/customer.svg';
  if (stage === 'inline') return isContract ? <ContractIcon size={20} /> : <CustomerIcon size={20} />;
  return (
    stage === 'png' ? (
      <img
        src={meetingIconPath(it)}
        alt={isContract ? 'Contract' : 'Customer'}
        width={20}
        height={20}
        style={{borderRadius:4, objectFit:'cover'}}
        onError={() => setStage('svg')}
      />
    ) : (
      <img
        src={svgSrc}
        alt={isContract ? 'Contract' : 'Customer'}
        width={20}
        height={20}
        style={{borderRadius:4, objectFit:'cover'}}
        onError={() => setStage('inline')}
      />
    )
  );
}

function chipIcon(kind, status) {
  const st = String(status || '').toUpperCase();
  const k = String(kind || '').toUpperCase();
  if (st === 'COMPLETED' || st === 'DONE') return '✓';
  if (st === 'SENT') {
    if (k === 'EMAIL') return '✉';
    if (k === 'CALL') return '☎';
  }
  return '';
}

// Modal to create a new CALL or EMAIL reminder
function CreateReminderModal({ onClose, prefill, isAdmin }) {
  const [type, setType] = useState('CALL');
  const [title, setTitle] = useState('');
  const [personName, setPersonName] = useState('');
  const [phone, setPhone] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [recipient, setRecipient] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Assign To: visible for all roles (exclude ADMIN from list via lookup)
  const [assignUsers, setAssignUsers] = useState([]);
  const [assignUserId, setAssignUserId] = useState('');
  const [myRole, setMyRole] = useState(null);
  const [myUserId, setMyUserId] = useState(null);
  const [myUsername, setMyUsername] = useState('');
  // Client link (optional): choose an existing opportunity for this reminder
  const [clients, setClients] = useState([]);
  const [selectedOppId, setSelectedOppId] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [clientActiveIndex, setClientActiveIndex] = useState(-1); // -1 = none
  const listRef = useRef(null);
  const selectedClientLabel = useMemo(() => {
    if (!selectedOppId) return '';
    const m = clients.find(c => c.opportunity_id === selectedOppId);
    return m ? `${m.client_name} — ${m.opportunity_id}` : selectedOppId;
  }, [clients, selectedOppId]);

  // Live validation for create modal
  const v = useValidation({ type, title, personName, phone, dueDate, dueTime, recipient }, {
    dueDate: { required: true },
    dueTime: { required: true },
    phone: { validate: (val) => (String(type).toUpperCase() === 'CALL') ? (!val || !val.trim() ? 'Phone number is required for CALL reminders' : (isValidIndianPhoneLoose(val.trim()) ? '' : 'Enter a valid Indian mobile number')) : '' },
    recipient: { validate: (val) => (String(type).toUpperCase() === 'EMAIL') ? (!val || !val.trim() ? 'Recipient email is required for EMAIL reminders' : (isValidEmail(val.trim()) ? '' : 'Please enter a valid email address')) : '' },
  }, { debounceMs: 150 });

  useEffect(() => {
    // Fetch current user and then selectable users; ensure ADMINs are included for admin
    (async () => {
      let meLocal = null;
      try {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const res = await fetch('/api/auth/me', { headers: token ? { 'Authorization': `Bearer ${token}` } : undefined });
        if (res.ok) {
          const me = await res.json();
          meLocal = me;
          setMyRole(me.role || null);
          setMyUserId(me.id || null);
          setMyUsername(me.username || '');
        }
      } catch (_) {}
      try {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const roleStr = String(meLocal?.role || myRole || '').toUpperCase();
        const rolesParam = (roleStr === 'ADMIN') ? 'OWNER,EMPLOYEE,ADMIN' : 'OWNER,EMPLOYEE';
        const r = await fetch(`/api/users-lookup?roles=${rolesParam}`, { headers: token ? { 'Authorization': `Bearer ${token}` } : undefined });
        if (r.ok) {
          let list = await r.json();
          list = Array.isArray(list) ? list : [];
          // Exclude self to avoid duplication with explicit "Myself" option
          const selfId = meLocal?.id || myUserId;
          if (selfId) list = list.filter(u => u.id !== selfId);
          // Sort by role priority (ADMIN, EMPLOYEE, OWNER) then username
          const roleRank = (r) => (r === 'ADMIN' ? 0 : r === 'EMPLOYEE' ? 1 : r === 'OWNER' ? 2 : 3);
          list.sort((a,b) => {
            const rr = roleRank(a.role) - roleRank(b.role);
            if (rr !== 0) return rr;
            const ua = String(a.username || '').toLowerCase();
            const ub = String(b.username || '').toLowerCase();
            if (ua < ub) return -1; if (ua > ub) return 1; return 0;
          });
          setAssignUsers(list);
        }
      } catch (_) {}
      try {
        // Load initial clients (opportunities) for dropdown
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const r = await fetch('/api/clients-lookup?limit=50', { headers: token ? { 'Authorization': `Bearer ${token}` } : undefined });
        if (r.ok) {
          const list = await r.json();
          setClients(Array.isArray(list) ? list : []);
        }
      } catch (_) { /* ignore */ }
    })();
  }, []);

  // Debounced fetch for combobox search
  useEffect(() => {
    let t = null;
    const run = async () => {
      try {
        setClientsLoading(true);
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const url = clientQuery && clientQuery.trim().length
          ? `/api/clients-lookup?q=${encodeURIComponent(clientQuery)}&limit=50`
          : '/api/clients-lookup?limit=50';
        const r = await fetch(url, { headers: token ? { 'Authorization': `Bearer ${token}` } : undefined });
        if (r.ok) {
          const list = await r.json();
          setClients(Array.isArray(list) ? list : []);
        }
      } catch (_) { /* ignore */ }
      finally { setClientsLoading(false); }
    };
    t = setTimeout(run, 250);
    return () => { if (t) clearTimeout(t); };
  }, [clientQuery]);

  useEffect(() => {
    if (!prefill) return;
    setType(prefill.type || 'CALL');
    setTitle(prefill.title || '');
    setPersonName(prefill.personName || '');
    setPhone(prefill.phone || '');
    setRecipient(prefill.recipient || '');
    setDueDate(prefill.dueDate || '');
    setDueTime(prefill.dueTime || '');
    setNotes(prefill.notes || '');
  }, [prefill]);

  function combineDateTime(d, t) {
    if (!d || !t) return null;
    return new Date(`${d}T${t}:00`);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!v.validateAll()) return;
    const due = combineDateTime(dueDate, dueTime);
    const payload = {
      id: Math.random().toString(36).slice(2,10).toUpperCase(),
      type,
      title: title.trim() || (type === 'CALL' ? `Call ${personName}` : `Email ${personName}`).trim(),
      // send as local SQL timestamp to avoid timezone shifts server-side
      due_ts: fmtSqlTsLocal(due),
      receiver_email: recipient.trim() || null,
      person_name: personName.trim() || null,
  phone: normalizeIndianPhone(phone.trim()) || null,
      notes: notes.trim() || null,
      opportunity_id: selectedOppId || null,
      meeting_id: null,
      status: 'PENDING'
    };
    // Assignment semantics:
    // - If a user is selected in dropdown, assign the reminder to that user (assignedToUserId)
    // - Do NOT override createdByUserId; let the backend use the actual creator (current user)
    // - If "Myself" is selected (empty value), set assignedToUserId to current user
    if (assignUserId) {
      payload.assignedToUserId = assignUserId;
    } else if (myUserId) {
      payload.assignedToUserId = myUserId;
    }
    try {
      setBusy(true);
      // Backend endpoint to be implemented: POST /api/reminders
  const token = localStorage.getItem('authToken') || localStorage.getItem('token');
  const res = await fetch('/api/reminders', { method:'POST', headers:{ 'Content-Type':'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('Failed to create reminder');
      onClose();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.3)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50}}>
      <div style={{background:'#fff', borderRadius:12, width:'min(640px, 92vw)', padding:16, boxShadow:'0 10px 30px rgba(0,0,0,0.2)'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10}}>
          <div style={{fontWeight:700, fontSize:18}}>Create Reminder</div>
          <button onClick={onClose} className="btn" style={{border:'1px solid #e5e7eb', background:'#fff', color:'#111', borderRadius:6, padding:'6px 10px'}}>Close</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-grid-2">
            <div>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Type</label>
              <select value={type} onChange={e=>setType(e.target.value)} style={inputStyle()}>
                <option value="CALL">CALL</option>
                <option value="EMAIL">EMAIL</option>
              </select>
            </div>
            <div>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Title (optional)</label>
              <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Auto-filled if left blank" style={inputStyle()} />
            </div>
            <div>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Client (optional)</label>
              <div style={{position:'relative'}}>
                <input
                  placeholder="Search client or Opportunity ID"
                  value={clientQuery || selectedClientLabel}
                  onChange={e=>{ setClientQuery(e.target.value); setClientOpen(true); setClientActiveIndex(-1); }}
                  onFocus={()=> { setClientOpen(true); }}
                  onBlur={()=> setTimeout(()=> setClientOpen(false), 120)}
                  onKeyDown={(e) => {
                    if (!clientOpen && ['ArrowDown','ArrowUp','Enter'].includes(e.key)) {
                      setClientOpen(true);
                      return;
                    }
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      const max = (clients || []).length; // includes None as virtual item at index -1 handling below
                      // 0..max-1 are real items; we treat -1 as None
                      setClientActiveIndex((idx) => {
                        const next = idx + 1;
                        return next >= max ? max - 1 : next;
                      });
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setClientActiveIndex((idx) => {
                        const next = idx - 1;
                        return next < -1 ? -1 : next;
                      });
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      if (clientActiveIndex === -1) {
                        setSelectedOppId('');
                        setClientQuery('');
                        setClientOpen(false);
                      } else if (clients[clientActiveIndex]) {
                        const c = clients[clientActiveIndex];
                        setSelectedOppId(c.opportunity_id);
                        setClientQuery(`${c.client_name} — ${c.opportunity_id}`);
                        setClientOpen(false);
                      }
                    } else if (e.key === 'Escape' || e.key === 'Esc') {
                      e.preventDefault();
                      setClientOpen(false);
                    }
                  }}
                  style={{...inputStyle(), paddingRight:36}}
                  role="combobox"
                  aria-expanded={clientOpen}
                  aria-autocomplete="list"
                  aria-controls="client-combobox-list"
                  aria-haspopup="listbox"
                  aria-activedescendant={clientActiveIndex >= 0 ? `client-opt-${clientActiveIndex}` : undefined}
                />
                {(clientQuery || selectedOppId) && (
                  <button
                    type="button"
                    onMouseDown={e=>e.preventDefault()}
                    onClick={()=> { setSelectedOppId(''); setClientQuery(''); }}
                    aria-label="Clear client"
                    style={{position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', border:'1px solid #e5e7eb', background:'#fff', borderRadius:999, width:22, height:22, display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:12, color:'#6b7280'}}
                  >×</button>
                )}
                {/* Dropdown list overlay (single-field combobox) */}
                {clientOpen && (
                  <div
                    id="client-combobox-list"
                    ref={listRef}
                    role="listbox"
                    style={{position:'absolute', top:'calc(100% + 4px)', left:0, right:0, maxHeight:240, overflowY:'auto', background:'#fff', border:'1px solid #e5e7eb', borderRadius:8, zIndex:20, boxShadow:'0 8px 20px rgba(0,0,0,0.12)'}}
                  >
                    <div
                      role="option"
                      aria-selected={clientActiveIndex === -1}
                      id="client-opt--1"
                      onMouseDown={e=>e.preventDefault()}
                      onMouseEnter={()=> setClientActiveIndex(-1)}
                      onClick={() => { setSelectedOppId(''); setClientQuery(''); setClientOpen(false); }}
                      style={{padding:'8px 10px', cursor:'pointer', background: clientActiveIndex === -1 ? '#f3f4f6' : '#fff'}}
                    >
                      None (no client)
                    </div>
                    {clientsLoading && (
                      <div style={{padding:'8px 10px', color:'#6b7280'}}>Loading…</div>
                    )}
                    {!clientsLoading && clients.map((c, i) => {
                      const selected = selectedOppId === c.opportunity_id;
                      const active = clientActiveIndex === i;
                      return (
                        <div
                          key={c.opportunity_id}
                          role="option"
                          id={`client-opt-${i}`}
                          aria-selected={active}
                          onMouseDown={e=>e.preventDefault()}
                          onMouseEnter={()=> setClientActiveIndex(i)}
                          onClick={() => { setSelectedOppId(c.opportunity_id); setClientQuery(`${c.client_name} — ${c.opportunity_id}`); setClientOpen(false); }}
                          style={{padding:'8px 10px', cursor:'pointer', background: active ? '#eef2ff' : '#fff', display:'flex', justifyContent:'space-between'}}
                          title={c.opportunity_id}
                        >
                          <span style={{fontWeight:700}}>{c.client_name}</span>
                          <span style={{marginLeft:6, fontSize:12, color: selected ? '#111' : '#6b7280'}}>{c.opportunity_id}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div style={{fontSize:11, color:'#9ca3af', marginTop:4}}>Selecting a client links this reminder to that opportunity. Leave as "None" for standalone.</div>
            </div>
            <div>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Person Name</label>
              <input value={personName} onChange={e=>setPersonName(e.target.value)} placeholder="e.g., Mr. Ravi" style={inputStyle()} />
            </div>
            {type === 'CALL' && (
              <div>
                <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Phone Number</label>
                <input value={phone} onChange={e=>{ setPhone(e.target.value); v.schedule('phone', e.target.value); }} onBlur={()=>v.onBlur('phone')} placeholder="e.g., 9876543210" style={{...inputStyle(), ...(v.touched.phone && v.errors.phone ? { borderColor:'crimson' } : {})}} />
                {v.touched.phone && v.errors.phone && <div className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{v.errors.phone}</div>}
              </div>
            )}
            {type === 'EMAIL' && (
              <div>
                <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Recipient Email</label>
                <input type="email" value={recipient} onChange={e=>{ setRecipient(e.target.value); v.schedule('recipient', e.target.value); }} onBlur={()=>v.onBlur('recipient')} placeholder="user@example.com" style={{...inputStyle(), ...(v.touched.recipient && v.errors.recipient ? { borderColor:'crimson' } : {})}} />
                {v.touched.recipient && v.errors.recipient && <div className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{v.errors.recipient}</div>}
              </div>
            )}
            <div>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Due Date</label>
              <input type="date" value={dueDate} onChange={e=>{ setDueDate(e.target.value); v.schedule('dueDate', e.target.value); }} onBlur={()=>v.onBlur('dueDate')} style={{...inputStyle(), ...(v.touched.dueDate && v.errors.dueDate ? { borderColor:'crimson' } : {})}} />
              {v.touched.dueDate && v.errors.dueDate && <div className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{v.errors.dueDate}</div>}
            </div>
            <div>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Due Time</label>
              <input type="time" value={dueTime} onChange={e=>{ setDueTime(e.target.value); v.schedule('dueTime', e.target.value); }} onBlur={()=>v.onBlur('dueTime')} style={{...inputStyle(), ...(v.touched.dueTime && v.errors.dueTime ? { borderColor:'crimson' } : {})}} />
              {v.touched.dueTime && v.errors.dueTime && <div className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{v.errors.dueTime}</div>}
            </div>
            <div>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Assign To</label>
              <select value={assignUserId} onChange={e=>setAssignUserId(e.target.value)} style={inputStyle()}>
                  {myUserId ? (
                    <option value="">Myself - {myUsername || 'me'} ({myRole || 'USER'})</option>
                  ) : (
                    <option value="">Myself</option>
                  )}
                {assignUsers.map(u => {
                  const label = u.username || u.id;
                  return <option key={u.id} value={u.id}>{label} ({u.role})</option>;
                })}
              </select>
            </div>
            <div>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Notes</label>
              <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={3} style={{...inputStyle(), resize:'vertical'}} placeholder="Topics and points to discuss" />
            </div>
          </div>
          {error && <div style={{color:'#b91c1c', marginTop:8}}>{error}</div>}
          <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:16}}>
            <button type="button" onClick={onClose} className="btn" style={{border:'1px solid #e5e7eb', background:'#fff', color:'#111', borderRadius:6, padding:'8px 14px'}}>Cancel</button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  const seed = uniqueSeed('REM');
                  const isEmailType = Math.random() < 0.5;
                  const pre = {
                    type: isEmailType ? 'EMAIL' : 'CALL',
                    title: `${isEmailType ? 'Email' : 'Call'} ${seed}`,
                    personName: fakePerson(seed),
                    phone: isEmailType ? '' : fakePhone(seed),
                    recipient: isEmailType ? fakeEmail(seed) : '',
                    dueDate: futureDate(1),
                    dueTime: timePlusMinutes(45),
                    notes: `Autofill seed: ${seed}`,
                  };
                  setType(pre.type);
                  setTitle(pre.title);
                  setPersonName(pre.personName);
                  setPhone(pre.phone);
                  setRecipient(pre.recipient);
                  setDueDate(pre.dueDate);
                  setDueTime(pre.dueTime);
                  setNotes(pre.notes);
                }}
                className="btn"
                title="Autofill (Admin only)"
                style={{background:'#f3f4f6', color:'#111', border:'1px solid #d1d5db', borderRadius:6, padding:'8px 14px', fontWeight:700}}
              >Autofill</button>
            )}
            <button disabled={busy || !v.canSubmit} type="submit" className="btn" style={{background:'#111', color:'#fff', border:'1px solid #111', borderRadius:6, padding:'8px 14px', fontWeight:700}}>
              {busy ? 'Creating…' : 'Create Reminder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function inputStyle() {
  return { width:'100%', padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:6 };
}

// Bootstrapping helpers for Employee Overview
async function fetchUsersForOverview() {
  try {
    const params = new URLSearchParams();
    params.set('roles', 'OWNER,EMPLOYEE');
    const token = localStorage.getItem('authToken') || localStorage.getItem('token');
    const res = await fetch(`/api/users-lookup?${params.toString()}`, { headers: token ? { 'Authorization': `Bearer ${token}` } : undefined });
    if (!res.ok) throw new Error('Failed to load users');
    return await res.json();
  } catch (e) { console.error(e); return []; }
}

// Removed external hook; logic is in-component now

// end employee-scoped helpers


// Format "13/Oct" and time like "12:15 pm"
function fmtDateAndTime(d) {
  const x = asDate(d);
  const dateText = x.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }).replace(/\./g, '');
  const timeText = x.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return { dateText, timeText };
}
function fmtDateTime(d) { const f = fmtDateAndTime(d); return `${f.dateText}, ${f.timeText}`; }
function fmtDay(d) { const x = new Date(d); return x.toLocaleDateString(undefined, { weekday:'short', day:'2-digit', month:'short' }); }

function formatDhm(diffMs) {
  const abs = Math.abs(diffMs);
  const d = Math.floor(abs / 86400000);
  const remD = abs % 86400000;
  const h = Math.floor(remD / 3600000);
  const m = Math.floor((remD % 3600000) / 60000);
  const mm = String(m).padStart(2, '0');
  return `${d}d-${h}hr-${mm}m`;
}

function timeLeftLabel(when) {
  const t = asDate(when);
  const now = new Date();
  const diff = t.getTime() - now.getTime();
  const past = diff < 0;
  const label = formatDhm(diff);
  return past ? `Started ${label} ago` : `Starts in ${label}`;
}

function dueLeftInfo(when) {
  const t = asDate(when);
  const now = new Date();
  const diff = t.getTime() - now.getTime();
  const hm = formatDhm(diff);
  return { state: diff < 0 ? 'past' : (diff === 0 ? 'now' : 'future'), hm };
}

// Styled tooltip with delay
function Tooltip({ children, content, delayShow = 300, delayHide = 150, maxWidth = 360, placement = 'auto' }) {
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [side, setSide] = useState('bottom');
  const wrapRef = useRef(null);
  const tipRef = useRef(null);
  const showT = useRef(null);
  const hideT = useRef(null);

  const onEnter = () => {
    if (hideT.current) clearTimeout(hideT.current);
    showT.current = setTimeout(() => {
      setReady(false);
      setVisible(true);
    }, delayShow);
  };
  const onLeave = () => {
    if (showT.current) clearTimeout(showT.current);
    hideT.current = setTimeout(() => setVisible(false), delayHide);
  };

  useEffect(() => () => {
    if (showT.current) clearTimeout(showT.current);
    if (hideT.current) clearTimeout(hideT.current);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const el = wrapRef.current;
    const tip = tipRef.current;
    if (!el || !tip) return;

    const position = () => {
      const r = el.getBoundingClientRect();
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 8;

      const canBottom = r.bottom + margin + h <= vh;
      const canTop = r.top - margin - h >= 0;
      const canRight = r.right + margin + w <= vw;
      const canLeft = r.left - margin - w >= 0;

      let finalSide = 'bottom';
      if (placement !== 'auto') {
        finalSide = placement;
      } else {
        if (canBottom) finalSide = 'bottom';
        else if (canTop) finalSide = 'top';
        else if (canRight) finalSide = 'right';
        else if (canLeft) finalSide = 'left';
        else finalSide = 'bottom';
      }

      let top = 0, left = 0;
      if (finalSide === 'bottom' || finalSide === 'top') {
        // Eye-friendly: align to trigger's left with slight offset
        const idealLeft = r.left;
        left = Math.min(Math.max(idealLeft, margin), vw - w - margin);
        top = finalSide === 'bottom' ? (r.bottom + margin) : (r.top - h - margin);
      } else if (finalSide === 'right') {
        left = r.right + margin;
        top = Math.min(Math.max(r.top + (r.height - h) / 2, margin), vh - h - margin);
      } else { // left
        left = r.left - w - margin;
        top = Math.min(Math.max(r.top + (r.height - h) / 2, margin), vh - h - margin);
      }

      setSide(finalSide);
      setPos({ top, left });
      setReady(true);
    };

    // Initial position on next frame for accurate sizes
    setReady(false);
    requestAnimationFrame(position);

    // Reposition on resize/scroll while visible
    const onScroll = () => position();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [visible, placement]);

  const bg = '#ffffff';
  const fg = '#111827';
  const border = '#e5e7eb';
  const shadow = '0 10px 30px rgba(0,0,0,0.18)';

  const arrowStyle = (() => {
    const base = { position: 'absolute', width: 10, height: 10, background: bg, transform: 'rotate(45deg)', borderLeft: `1px solid ${border}`, borderTop: `1px solid ${border}` };
    if (side === 'bottom') return { ...base, top: -5, left: '50%', marginLeft: -5 };
    if (side === 'top') return { ...base, bottom: -5, left: '50%', marginLeft: -5 };
    if (side === 'right') return { ...base, left: -5, top: '50%', marginTop: -5 };
    return { ...base, right: -5, top: '50%', marginTop: -5 };
  })();

  return (
    <span ref={wrapRef} onMouseEnter={onEnter} onMouseLeave={onLeave} onFocus={onEnter} onBlur={onLeave} style={{ position: 'relative', display: 'inline-block' }}>
      {children}
      {visible && (
        <div ref={tipRef} style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 1600, background: bg, color: fg, padding: '12px 14px', borderRadius: 12, boxShadow: shadow, maxWidth, width: 'max-content', whiteSpace: 'normal', border: `1px solid ${border}`, visibility: ready ? 'visible' : 'hidden', opacity: ready ? 1 : 0, transform: ready ? 'translateY(0) scale(1)' : (side === 'top' ? 'translateY(-4px) scale(0.98)' : 'translateY(4px) scale(0.98)'), transition: 'opacity 120ms ease, transform 120ms ease' }}>
          <div style={arrowStyle} />
          {content}
        </div>
      )}
    </span>
  );
}

function renderReminderTooltip(it) {
  const k = String(it.kind || '').toUpperCase();
  const labelStyle = { color: '#9CA3AF', marginRight: 6 };
  const lineStyle = { marginTop: 6, fontSize: 14 };
  return (
    <div style={{ fontSize: 14, lineHeight: 1.45, maxWidth: 360 }}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>{it.title}</div>
      <div style={lineStyle}><span style={labelStyle}>Person</span><span style={{ fontWeight: 600 }}>{it.person_name || '-'}</span></div>
      {k === 'CALL' ? (
        <div style={lineStyle}><span style={labelStyle}>Phone</span><span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>{it.phone || '-'}</span></div>
      ) : (
        <div style={lineStyle}><span style={labelStyle}>Email</span><span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>{it.receiver_email || '-'}</span></div>
      )}
      {it.notes ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...labelStyle, display: 'block' }}>Notes</div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{String(it.notes)}</div>
        </div>
      ) : null}
    </div>
  );
}

function EditReminderModal({ item, onClose }) {
  const isEmail = String(item.kind || item.type).toUpperCase() === 'EMAIL';
  const [title, setTitle] = useState(item.title || '');
  const [personName, setPersonName] = useState(item.person_name || '');
  const [phone, setPhone] = useState(item.phone || '');
  const [recipient, setRecipient] = useState(item.receiver_email || '');
  const [notes, setNotes] = useState(item.notes || '');
  const [status, setStatus] = useState((item.status || 'PENDING').toUpperCase());
  const d = item.when ? asDate(item.when) : null;
  const initialDate = d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : '';
  const initialTime = d ? `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '';
  const [dueDate, setDueDate] = useState(initialDate);
  const [dueTime, setDueTime] = useState(initialTime);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const vEdit = useValidation({ phone, recipient, dueDate, dueTime }, {
    dueDate: { required: true },
    dueTime: { required: true },
    phone: { validate: (val) => (!isEmail) ? (!val || !val.trim() ? 'Phone number is required for CALL' : (isValidIndianPhoneLoose(val.trim()) ? '' : 'Enter a valid Indian mobile number')) : '' },
    recipient: { validate: (val) => (isEmail) ? (!val || !val.trim() ? 'Recipient email is required for EMAIL' : (isValidEmail(val.trim()) ? '' : 'Please enter a valid email address')) : '' },
  }, { debounceMs: 150 });

  // Client selector (same as Create)
  const [clients, setClients] = useState([]);
  const [clientQuery, setClientQuery] = useState(item.client_name ? `${item.client_name} — ${item.opportunity_id || ''}`.trim() : '');
  const [selectedOppId, setSelectedOppId] = useState(item.opportunity_id || '');
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [clientActiveIndex, setClientActiveIndex] = useState(-1);
  const listRef = useRef(null);

  // Assign To (same semantics as Create; ADMIN list excludes ADMIN users via users-lookup)
  const [assignUsers, setAssignUsers] = useState([]);
  const [assignUserId, setAssignUserId] = useState(item.assigned_to_user_id || '');

  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const r1 = await fetch('/api/users-lookup?roles=OWNER,EMPLOYEE', { headers: token ? { 'Authorization': `Bearer ${token}` } : undefined });
        if (r1.ok) setAssignUsers(await r1.json());
        const r2 = await fetch('/api/clients-lookup?limit=50', { headers: token ? { 'Authorization': `Bearer ${token}` } : undefined });
        if (r2.ok) setClients(await r2.json());
      } catch (_) {}
    })();
  }, []);

  // Debounced client search
  useEffect(() => {
    let t = null;
    const run = async () => {
      try {
        setClientsLoading(true);
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        const url = clientQuery && clientQuery.trim().length
          ? `/api/clients-lookup?q=${encodeURIComponent(clientQuery)}&limit=50`
          : '/api/clients-lookup?limit=50';
        const r = await fetch(url, { headers: token ? { 'Authorization': `Bearer ${token}` } : undefined });
        if (r.ok) setClients(await r.json());
      } catch (_) {}
      finally { setClientsLoading(false); }
    };
    t = setTimeout(run, 250);
    return () => { if (t) clearTimeout(t); };
  }, [clientQuery]);

  function combineDateTime(d, t) {
    if (!d || !t) return null;
    return new Date(`${d}T${t}:00`);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    if (!vEdit.validateAll()) return;
    const due = combineDateTime(dueDate, dueTime);
    const payload = {
      title: title.trim() || null,
      // send as local SQL timestamp to avoid timezone conversions
      due_ts: fmtSqlTsLocal(due),
      notes: notes.trim() || null,
      receiver_email: isEmail ? recipient.trim() : undefined,
      person_name: personName.trim() || null,
  phone: !isEmail ? normalizeIndianPhone(phone.trim()) : undefined,
      status
    };
    // Include reassignment only when a specific user is chosen
    if (assignUserId && String(assignUserId).trim().length) {
      payload.assignedToUserId = assignUserId;
    }
    // Update opportunity link if changed
    // Note: backend PUT currently does not accept opportunity_id change; keeping for future if needed
    try {
      setBusy(true);
  const token = localStorage.getItem('authToken') || localStorage.getItem('token');
  const res = await fetch(`/api/reminders/${item.id}`, { method:'PUT', headers:{ 'Content-Type':'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const t = await res.json().catch(()=>({}));
        throw new Error(t.error || 'Failed to save reminder');
      }
      onClose();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.3)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50}}>
      <div style={{background:'#fff', borderRadius:12, width:'min(640px, 92vw)', padding:16, boxShadow:'0 10px 30px rgba(0,0,0,0.2)'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10}}>
          <div style={{fontWeight:700, fontSize:18}}>Edit Reminder</div>
          <button onClick={onClose} className="btn" style={{border:'1px solid #e5e7eb', background:'#fff', color:'#111', borderRadius:6, padding:'6px 10px'}}>Close</button>
        </div>
        <form onSubmit={handleSave}>
          <div className="form-grid-2">
            <div>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Type</label>
              <input value={isEmail ? 'EMAIL' : 'CALL'} readOnly style={{...inputStyle(), background:'#f9fafb'}} />
            </div>
            <div>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Title (optional)</label>
              <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Auto-filled if left blank" style={inputStyle()} />
            </div>
            {/* Client (optional) - single-field combobox */}
            <div>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Client (optional)</label>
              <div style={{position:'relative'}}>
                <input
                  placeholder="Search client or Opportunity ID"
                  value={clientQuery}
                  onChange={e=>{ setClientQuery(e.target.value); setClientOpen(true); setClientActiveIndex(-1); }}
                  onFocus={()=> { setClientOpen(true); }}
                  onBlur={()=> setTimeout(()=> setClientOpen(false), 120)}
                  onKeyDown={(e) => {
                    if (!clientOpen && ['ArrowDown','ArrowUp','Enter'].includes(e.key)) {
                      setClientOpen(true);
                      return;
                    }
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      const max = (clients || []).length;
                      setClientActiveIndex((idx) => {
                        const next = idx + 1;
                        return next >= max ? max - 1 : next;
                      });
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setClientActiveIndex((idx) => {
                        const next = idx - 1;
                        return next < -1 ? -1 : next;
                      });
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      if (clientActiveIndex === -1) {
                        setSelectedOppId('');
                        setClientQuery('');
                        setClientOpen(false);
                      } else if (clients[clientActiveIndex]) {
                        const c = clients[clientActiveIndex];
                        setSelectedOppId(c.opportunity_id);
                        setClientQuery(`${c.client_name} — ${c.opportunity_id}`);
                        setClientOpen(false);
                      }
                    } else if (e.key === 'Escape' || e.key === 'Esc') {
                      e.preventDefault();
                      setClientOpen(false);
                    }
                  }}
                  style={{...inputStyle(), paddingRight:36}}
                  role="combobox"
                  aria-expanded={clientOpen}
                  aria-autocomplete="list"
                  aria-controls="client-combobox-list-edit"
                  aria-haspopup="listbox"
                  aria-activedescendant={clientActiveIndex >= 0 ? `client-edit-opt-${clientActiveIndex}` : undefined}
                />
                {(clientQuery || selectedOppId) && (
                  <button
                    type="button"
                    onMouseDown={e=>e.preventDefault()}
                    onClick={()=> { setSelectedOppId(''); setClientQuery(''); }}
                    aria-label="Clear client"
                    style={{position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', border:'1px solid #e5e7eb', background:'#fff', borderRadius:999, width:22, height:22, display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:12, color:'#6b7280'}}
                  >×</button>
                )}
                {clientOpen && (
                  <div
                    id="client-combobox-list-edit"
                    ref={listRef}
                    role="listbox"
                    style={{position:'absolute', top:'calc(100% + 4px)', left:0, right:0, maxHeight:240, overflowY:'auto', background:'#fff', border:'1px solid #e5e7eb', borderRadius:8, zIndex:20, boxShadow:'0 8px 20px rgba(0,0,0,0.12)'}}
                  >
                    <div
                      role="option"
                      aria-selected={clientActiveIndex === -1}
                      id="client-edit-opt--1"
                      onMouseDown={e=>e.preventDefault()}
                      onMouseEnter={()=> setClientActiveIndex(-1)}
                      onClick={() => { setSelectedOppId(''); setClientQuery(''); setClientOpen(false); }}
                      style={{padding:'8px 10px', cursor:'pointer', background: clientActiveIndex === -1 ? '#f3f4f6' : '#fff'}}
                    >
                      None (no client)
                    </div>
                    {clientsLoading && (
                      <div style={{padding:'8px 10px', color:'#6b7280'}}>Loading…</div>
                    )}
                    {!clientsLoading && clients.map((c, i) => {
                      const active = clientActiveIndex === i;
                      return (
                        <div
                          key={c.opportunity_id}
                          role="option"
                          id={`client-edit-opt-${i}`}
                          aria-selected={active}
                          onMouseDown={e=>e.preventDefault()}
                          onMouseEnter={()=> setClientActiveIndex(i)}
                          onClick={() => { setSelectedOppId(c.opportunity_id); setClientQuery(`${c.client_name} — ${c.opportunity_id}`); setClientOpen(false); }}
                          style={{padding:'8px 10px', cursor:'pointer', background: active ? '#eef2ff' : '#fff', display:'flex', justifyContent:'space-between'}}
                          title={c.opportunity_id}
                        >
                          <span style={{fontWeight:700}}>{c.client_name}</span>
                          <span style={{marginLeft:6, fontSize:12, color:'#6b7280'}}>{c.opportunity_id}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div style={{fontSize:11, color:'#9ca3af', marginTop:4}}>Selecting a client links this reminder to that opportunity. Leave as "None" for standalone.</div>
            </div>
            <div>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Person Name</label>
              <input value={personName} onChange={e=>setPersonName(e.target.value)} placeholder="e.g., Mr. Ravi" style={inputStyle()} />
            </div>
            {!isEmail && (
              <div>
                <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Phone Number</label>
                <input value={phone} onChange={e=>{ setPhone(e.target.value); vEdit.schedule('phone', e.target.value); }} onBlur={()=>vEdit.onBlur('phone')} placeholder="e.g., 9876543210" style={{...inputStyle(), ...(vEdit.touched.phone && vEdit.errors.phone ? { borderColor:'crimson' } : {})}} />
                {vEdit.touched.phone && vEdit.errors.phone && <div className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{vEdit.errors.phone}</div>}
              </div>
            )}
            {isEmail && (
              <div>
                <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Recipient Email</label>
                <input type="email" value={recipient} onChange={e=>{ setRecipient(e.target.value); vEdit.schedule('recipient', e.target.value); }} onBlur={()=>vEdit.onBlur('recipient')} placeholder="user@example.com" style={{...inputStyle(), ...(vEdit.touched.recipient && vEdit.errors.recipient ? { borderColor:'crimson' } : {})}} />
                {vEdit.touched.recipient && vEdit.errors.recipient && <div className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{vEdit.errors.recipient}</div>}
              </div>
            )}
            <div>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Due Date</label>
              <input type="date" value={dueDate} onChange={e=>{ setDueDate(e.target.value); vEdit.schedule('dueDate', e.target.value); }} onBlur={()=>vEdit.onBlur('dueDate')} style={{...inputStyle(), ...(vEdit.touched.dueDate && vEdit.errors.dueDate ? { borderColor:'crimson' } : {})}} />
              {vEdit.touched.dueDate && vEdit.errors.dueDate && <div className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{vEdit.errors.dueDate}</div>}
            </div>
            <div>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Due Time</label>
              <input type="time" value={dueTime} onChange={e=>{ setDueTime(e.target.value); vEdit.schedule('dueTime', e.target.value); }} onBlur={()=>vEdit.onBlur('dueTime')} style={{...inputStyle(), ...(vEdit.touched.dueTime && vEdit.errors.dueTime ? { borderColor:'crimson' } : {})}} />
              {vEdit.touched.dueTime && vEdit.errors.dueTime && <div className="muted" style={{color:'crimson', fontSize:12, marginTop:4}}>{vEdit.errors.dueTime}</div>}
            </div>
            <div>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Assign To</label>
              <select value={assignUserId || ''} onChange={e=>setAssignUserId(e.target.value)} style={inputStyle()}>
                <option value="">Unchanged (current)</option>
                {assignUsers.map(u => {
                  const label = u.full_name || u.username || u.email || u.id;
                  return <option key={u.id} value={u.id}>{label} ({u.role})</option>;
                })}
              </select>
              <div style={{fontSize:11, color:'#9ca3af', marginTop:4}}>Leave as "Unchanged" to keep the current assignee.</div>
            </div>
            <div>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Status</label>
              <select value={status} onChange={e=>setStatus(e.target.value)} style={inputStyle()}>
                <option value="PENDING">PENDING</option>
                {isEmail ? (
                  <>
                    <option value="SENT">SENT</option>
                    <option value="FAILED">FAILED</option>
                  </>
                ) : (
                  <>
                    <option value="DONE">DONE</option>
                    <option value="FAILED">FAILED</option>
                  </>
                )}
              </select>
            </div>
            <div>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Notes</label>
              <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={3} style={{...inputStyle(), resize:'vertical'}} placeholder="Topics and points to discuss" />
            </div>
          </div>
          {error && <div style={{color:'#b91c1c', marginTop:8}}>{error}</div>}
          <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:16}}>
            <button type="button" onClick={onClose} className="btn" style={{border:'1px solid #e5e7eb', background:'#fff', color:'#111', borderRadius:6, padding:'8px 14px'}}>Cancel</button>
            <button disabled={busy || !vEdit.canSubmit} type="submit" className="btn" style={{background:'#111', color:'#fff', border:'1px solid #111', borderRadius:6, padding:'8px 14px', fontWeight:700}}>
              {busy ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BulkRemindersModal({ selectedIds, resolveItemsById, onClose }) {
  const [includeClientEmails, setIncludeClientEmails] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const [toText, setToText] = useState('');
  const [ccText, setCcText] = useState('');

  async function fetchPreview(withClients) {
    setError('');
    try {
      const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      const res = await fetch('/api/email/preview/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify({ reminderIds: selectedIds, includeClientEmails: !!withClients })
      });
      if (!res.ok) {
        const t = await res.json().catch(()=>({}));
        throw new Error(t.error || 'Preview failed');
      }
      const data = await res.json();
      setSubject(data.subject || 'Follow-ups');
      setHtml(data.html || '');
      if (!toText) {
        const sug = Array.isArray(data.suggestedTo) ? data.suggestedTo : [];
        setToText(sug.join(', '));
      }
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  useEffect(() => { fetchPreview(includeClientEmails); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { fetchPreview(includeClientEmails); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [includeClientEmails]);

  function parseList(s) {
    if (!s) return [];
    return String(s).split(',').map(x => x.trim()).filter(Boolean);
  }

  async function handleSend() {
    setBusy(true); setError('');
    try {
      const to = parseList(toText);
      const cc = parseList(ccText);
      if (!to.length) throw new Error('Please provide at least one recipient in To');
      const token = localStorage.getItem('authToken') || localStorage.getItem('token');
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify({ to, cc, subject, html, remindersIds: selectedIds })
      });
      if (!res.ok) {
        const t = await res.json().catch(()=>({}));
        throw new Error(t.error || 'Send failed');
      }
      // Mark EMAIL reminders as SENT
      try {
        const items = resolveItemsById ? resolveItemsById(selectedIds) : [];
        const token2 = localStorage.getItem('authToken') || localStorage.getItem('token');
        await Promise.all(items
          .filter(it => String(it.kind).toUpperCase() === 'EMAIL')
          .map(it => fetch(`/api/reminders/${it.id}`, { method:'PATCH', headers:{ 'Content-Type':'application/json', ...(token2 ? { 'Authorization': `Bearer ${token2}` } : {}) }, body: JSON.stringify({ status: 'SENT' }) }))
        );
      } catch {}
      onClose(true);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:70}}>
      <div style={{background:'#fff', borderRadius:12, width:'min(960px, 94vw)', maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 10px 30px rgba(0,0,0,0.2)'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid #e5e7eb'}}>
          <div style={{fontWeight:800, fontSize:18}}>Email Selected Reminders</div>
          <button onClick={()=>onClose(false)} className="btn" style={{border:'1px solid #e5e7eb', background:'#fff', color:'#111', borderRadius:6, padding:'6px 10px'}}>Close</button>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'320px 1fr', gap:0, minHeight:360}}>
          <div style={{padding:14, borderRight:'1px solid #e5e7eb'}}>
            <div style={{marginBottom:10}}>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Subject</label>
              <input value={subject} onChange={e=>setSubject(e.target.value)} style={{width:'100%', padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:6}} />
            </div>
            <div style={{marginBottom:10}}>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>To</label>
              <textarea value={toText} onChange={e=>setToText(e.target.value)} rows={3} placeholder="comma-separated emails" style={{width:'100%', padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:6, resize:'vertical'}} />
            </div>
            <div style={{marginBottom:10}}>
              <label style={{display:'block', fontSize:12, color:'#6b7280'}}>Cc (optional)</label>
              <textarea value={ccText} onChange={e=>setCcText(e.target.value)} rows={2} placeholder="comma-separated emails" style={{width:'100%', padding:'8px 10px', border:'1px solid #d1d5db', borderRadius:6, resize:'vertical'}} />
            </div>
            <label style={{display:'inline-flex', alignItems:'center', gap:8, fontSize:12}}>
              <input type="checkbox" checked={includeClientEmails} onChange={e=>setIncludeClientEmails(e.target.checked)} />
              Include client emails (where available)
            </label>
            {error && <div style={{color:'#b91c1c', marginTop:10}}>{error}</div>}
            <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:16}}>
              <button type="button" onClick={()=>onClose(false)} className="btn" style={{border:'1px solid #e5e7eb', background:'#fff', color:'#111', borderRadius:6, padding:'8px 14px'}}>Cancel</button>
              <button type="button" disabled={busy} onClick={handleSend} className="btn" style={{background:'#111', color:'#fff', border:'1px solid #111', borderRadius:6, padding:'8px 14px', fontWeight:700}}>{busy ? 'Sending…' : 'Send Email'}</button>
            </div>
          </div>
          <div style={{padding:0, background:'#f9fafb'}}>
            <div style={{padding:'10px 12px', fontSize:12, color:'#6b7280', borderBottom:'1px solid #e5e7eb'}}>Preview</div>
            <div style={{padding:0, overflow:'auto', maxHeight:'calc(90vh - 140px)'}}>
              <div dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

