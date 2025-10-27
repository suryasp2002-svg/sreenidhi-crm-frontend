import './App.css';
import Opportunities from './components/Opportunities';
import Customer from './components/Customer';
import Contracts from './components/Contracts';
import History from './components/History';
import Meetings from './components/Meetings';
import Reminders from './components/Reminders';
import Targets from './components/Targets';
import Login from './components/Login';
import EmployeeControl from './components/EmployeeControl';
import Profile from './components/Profile';
import { useState, useEffect, useMemo, useRef } from 'react';

function App() {
  const [tab, setTab] = useState(() => {
    try {
      const t = localStorage.getItem('crm:lastTab');
      return t || 'Opportunities';
    } catch { return 'Opportunities'; }
  });
  const [permissions, setPermissions] = useState(null); // { tabs, actions }
  const [user, setUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const idleTimerRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const IDLE_LIMIT_MS = 10 * 60 * 1000; // 10 minutes

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    if (!token) { setLoadingUser(false); return; }
    fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token }})
      .then(r => r.json())
      .then(data => {
        if (data && data.id) setUser(data);
      })
      .catch(()=>{})
      .finally(()=> setLoadingUser(false));
  }, []);

  // Load permissions for current user when applicable
  useEffect(() => {
    let aborted = false;
    async function loadPerm() {
      if (!user) return;
      if (user.role === 'EMPLOYEE' || user.role === 'OWNER') {
        const token = localStorage.getItem('authToken');
        try {
          const r = await fetch(`/api/users/${user.id}/permissions`, { headers: { Authorization: 'Bearer '+token }});
          if (r.ok) {
            const data = await r.json();
            if (!aborted) setPermissions({ tabs: data.tabs || {}, actions: data.actions || {} });
          } else if (!aborted) {
            setPermissions({ tabs: {}, actions: {} });
          }
        } catch {
          if (!aborted) setPermissions({ tabs: {}, actions: {} });
        }
      } else {
        setPermissions(null);
      }
    }
    loadPerm();
    return () => { aborted = true; };
  }, [user?.id, user?.role]);

  // Persist last selected tab
  useEffect(() => {
    try { localStorage.setItem('crm:lastTab', tab); } catch {}
  }, [tab]);

  // Compute visible tabs based on user role and permissions
  const visibleTabs = useMemo(() => {
    const baseTabs = [
      { key: 'Profile', label: 'Profile' },
      { key: 'Dashboard', label: 'Dashboard' },
      { key: 'Customers', label: 'Customers' },
      { key: 'Opportunities', label: 'Opportunities' },
      { key: 'Contracts', label: 'Contracts' },
      { key: 'History', label: 'History' },
      { key: 'Meetings', label: 'Meetings' },
      { key: 'Reminders', label: 'Reminders' },
      { key: 'Targets', label: 'Targets' },
    ];
    if (user && (user.role === 'OWNER' || user.role === 'ADMIN')) {
      baseTabs.push({ key: 'EmployeeControl', label: user.role === 'ADMIN' ? 'User Control' : 'Employee Control' });
    }
    if (user && (user.role === 'EMPLOYEE' || user.role === 'OWNER') && permissions) {
      const tabKeys = Object.keys(permissions.tabs || {});
      if (tabKeys.length > 0) {
        return baseTabs.filter(t => t.key === 'EmployeeControl' || t.key === 'Profile' || permissions.tabs[t.key]);
      }
    }
    return baseTabs;
  }, [user, permissions]);

  // Ensure current tab is allowed; if not, switch to first visible and persist
  useEffect(() => {
    if (!visibleTabs.find(t => t.key === tab) && visibleTabs.length) {
      setTab(visibleTabs[0].key);
    }
  }, [visibleTabs, tab]);

  // Idle auto-logout after 10 minutes without interaction
  useEffect(() => {
    if (!user) return;
    const onActivity = () => { lastActivityRef.current = Date.now(); };
    const events = ['mousemove','keydown','click','scroll','touchstart','visibilitychange'];
    events.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }));
    idleTimerRef.current = setInterval(() => {
      const now = Date.now();
      if (now - lastActivityRef.current > IDLE_LIMIT_MS) {
        logout(true);
      }
    }, 30000); // check every 30s
    return () => {
      events.forEach(ev => window.removeEventListener(ev, onActivity));
      if (idleTimerRef.current) { clearInterval(idleTimerRef.current); idleTimerRef.current = null; }
    };
  }, [user]);

  function logout(isAuto=false) {
    localStorage.removeItem('authToken');
    try { localStorage.removeItem('crm:lastTab'); } catch {}
    setUser(null);
    if (isAuto) {
      try {
        // Optional: a toast or alert can be shown here, keeping minimal side effects
        console.log('Logged out due to inactivity');
      } catch {}
    }
  }
  if (loadingUser) {
    return <div style={{padding:'60px', textAlign:'center', color:'#555'}}>Loading...</div>;
  }

  if (!user) {
    return <Login onAuthed={(u)=> setUser(u)} />;
  }

  return (
    <>
      <header>
        <div className="wrap" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px'}}>
          <div style={{fontWeight:700,fontSize:'20px'}}>Sreenidhi CRM</div>
          <nav className="nav" id="nav" style={{display:'flex', alignItems:'center', gap:8}}>
            {visibleTabs.map(t => (
              <button
                key={t.key}
                className={tab === t.key ? 'nav-btn active' : 'nav-btn'}
                style={{marginRight:8,background:tab===t.key?'#111':'#f5f5f5',color:tab===t.key?'#fff':'#222',border:'none',borderRadius:20,padding:'8px 18px',fontWeight:500,cursor:'pointer'}}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
            <div style={{marginLeft:16, fontSize:12, color:'#555'}}>{user.email} ({user.role})</div>
            <button onClick={logout} style={{marginLeft:8, background:'#f43f5e', color:'#fff', border:'none', borderRadius:20, padding:'6px 14px', cursor:'pointer'}}>Logout</button>
          </nav>
        </div>
      </header>
      <main className="wrap" id="main">
  {tab === 'Opportunities' && <Opportunities perms={(user?.role === 'EMPLOYEE' || user?.role === 'OWNER') ? permissions : null} />}
  {tab === 'Customers' && <Customer perms={(user?.role === 'EMPLOYEE' || user?.role === 'OWNER') ? permissions : null} />}
  {tab === 'Contracts' && <Contracts perms={(user?.role === 'EMPLOYEE' || user?.role === 'OWNER') ? permissions : null} />}
  {tab === 'History' && <History />}
  {tab === 'Meetings' && <Meetings perms={(user?.role === 'EMPLOYEE' || user?.role === 'OWNER') ? permissions : null} />}
  {tab === 'Reminders' && <Reminders perms={(user?.role === 'EMPLOYEE' || user?.role === 'OWNER') ? permissions : null} />}
  {tab === 'Targets' && <Targets perms={(user?.role === 'EMPLOYEE' || user?.role === 'OWNER') ? permissions : null} />}
  {tab === 'Profile' && (
    <Profile token={localStorage.getItem('authToken')} />
  )}
  {tab === 'EmployeeControl' && (user?.role === 'OWNER' || user?.role === 'ADMIN') && (
    <EmployeeControl token={localStorage.getItem('authToken')} currentUserRole={user.role} currentUserId={user.id} />
  )}
        {tab === 'Dashboard' && (
          <div style={{padding:'32px 0',textAlign:'center',color:'#6b7280',fontSize:'18px'}}>
            Welcome to Sreenidhi CRM!<br />
            This is the new React-powered UI.<br />
            {/* Replace this with CRM dashboard/tabs soon */}
          </div>
        )}
      </main>
      <div id="toast" className="toast" style={{display:'none'}}></div>
      {/* Profile Modal */}
      <div id="profileOverlay" className="overlay" style={{display:'none'}}>
        <div className="modal">
          <div className="modal-header">
            <div id="profileTitle" style={{fontWeight:600}}>Customer Profile</div>
            <button className="btn ghost" /*onClick={closeProfile}*/>Close</button>
          </div>
          <div className="modal-body" id="profileBody"></div>
        </div>
      </div>
    </>
  );
}

export default App;