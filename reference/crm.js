function editContract(id) {
  var x = null, i;
  for (i = 0; i < DB.contracts.length; i++) {
    if (DB.contracts[i].id === id) { x = DB.contracts[i]; break; }
  }
  if (!x) { toast('Contract not found'); return; }
  window.__conForm = {
    id: x.id,
    customer_id: x.customer_id || '',
    quoted_price_per_litre: x.quoted_price_per_litre || '',
    start_date: x.start_date || '',
    payment_terms: x.payment_terms || 'Net 15',
    primary_contact: x.primary_contact || '',
    phone: x.phone || '',
    alt_phone: x.alt_phone || '',
    email: x.email || '',
    gstin: x.gstin || ''
  };
  TAB = 'contracts';
  render();
}
/* =========================
   Sreenidhi CRM â€” v16R2 (ES5)
   Part 1/4: Core utils & data
   ========================= */

// ---- LocalStorage Key ----
var LS_KEY = 'sreenidhi_crm_web_v16r2';

// ---- Small helpers ----
function nowISO(){ return new Date().toISOString(); }
function id6(){ return Math.random().toString(36).slice(2,8).toUpperCase(); }
function ensureNum(v){ var n=Number(v); return isFinite(n)?n:0; }
function esc(s){ return String(s||'').replace(/[&<>\"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]; }); }

// Currency formatter (â‚¹)
var INR = new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0});

// Probability per stage
function stageProb(s){
  var m={ LEAD:10, QUALIFIED:40, NEGOTIATION:70, AGREED:100, DISAGREED:0 };
  return (m.hasOwnProperty(s)? m[s] : 0);
}

// ---- Toast UI ----
function toast(m){
  var el=document.getElementById('toast');
  if(!el) return;
  el.textContent=m;
  el.style.display='block';
  clearTimeout(window.__t);
  window.__t=setTimeout(function(){el.style.display='none'}, 2000);
}

// ---- Save/Load DB ----
function saveDB(db){ try{ localStorage.setItem(LS_KEY, JSON.stringify(db)); }catch(e){ console.error('saveDB', e); } }
function loadDB(){
  try{
    var raw = localStorage.getItem(LS_KEY);
    if(raw){ return JSON.parse(raw); }
  }catch(e){ console.error('loadDB', e); }
  return seed(); // default demo data
}

// ---- Demo Seed ----
function seed(){
  var customers = [
    { id:'MEDH01', legal_name:'Medha Engineering Pvt Ltd', gstin:'37ABCDE1234F1Z5',
      primary_contact:'Rakesh Rao', phone:'+91 9876511111', email:'rakesh@medha.co.in', created_at:nowISO() },
    { id:'RENW02', legal_name:'RenewSys India', gstin:'27ABCDE9999L1Z1',
      primary_contact:'S. Iyer', phone:'+91 9898922222', email:'si@renewsys.in', created_at:nowISO() }
  ];

  var opportunities = [
    { id:'OPP-'+id6(), customer_id:'MEDH01', title:'HSD Monthly Supply',
      expected_monthly_volume_l:45000, proposed_price_per_litre:96.5,
      stage:'NEGOTIATION', probability:70, notes:'30d credit', salesperson:'Anita' },

    { id:'OPP-'+id6(), customer_id:'RENW02', title:'MS Daily Runs',
      expected_monthly_volume_l:20000, proposed_price_per_litre:102.0,
      stage:'AGREED', probability:100, notes:'PO pending', salesperson:'Rahul' }
  ];

  var statusHistory = [
    { opportunity_id: opportunities[1].id, stage:'AGREED', reason:'', at: nowISO() }
  ];

  var expenses = []; // {opportunity_id, amount, at, note}
  var contracts = [
    { id:'CON-'+id6(), customer_id:'RENW02', quoted_price_per_litre:101.5,
      start_date: nowISO().slice(0,10), payment_terms:'Net 15',
      primary_contact:'S. Iyer', phone:'+91 9898922222', email:'si@renewsys.in', gstin:'27ABCDE9999L1Z1' }
  ];
  var meetings = [];   // {id, customer_id, subject, when_ts, location, notes, status}
  var reminders = [];  // {id, customer_id, title, due_ts, notes, status}

  var db = {
    customers: customers,
    opportunities: opportunities,
    statusHistory: statusHistory,
    expenses: expenses,
    contracts: contracts,
    meetings: meetings,
    reminders: reminders
  };
  saveDB(db);
  return db;
}

// ---- DB in-memory state ----
var DB = loadDB();

// ---- Global UI state ----

var TAB = 'dashboard';
var PROFILE = null;

// ---- Global setField helper ----
function setField(formKey, field, value) {
  if (typeof window[formKey] !== 'object' || window[formKey] === null) return;
  window[formKey][field] = value;
}

// ---- Derived maps/helpers ----
function spendByOpp(){
  var m = new Map();
  DB.expenses.forEach(function(e){
    m.set(e.opportunity_id, (m.get(e.opportunity_id)||0) + ensureNum(e.amount));
  });
  return m;
}
function contractsByCustomer(){
  var m = new Map();
  DB.contracts.forEach(function(c){ m.set(c.customer_id, c); });
  return m;
}

// ---- Validators (Phone, GSTIN, Email) ----
function formatPhone(raw, ccHint){
  var cleaned = String(raw||'').replace(/[^0-9+ ]/g,'');
  if(!cleaned) return { formatted:'', ccLen:0 };
  if(cleaned.charAt(0) !== '+'){ cleaned = '+' + cleaned.replace(/^\++/, ''); }
  cleaned = '+' + cleaned.slice(1).replace(/\+/g,'');
  var rest = cleaned.slice(1);
  var digits = rest.replace(/[^0-9]/g,'');
  if(!digits){ return { formatted:'+', ccLen:0 }; }
  var parts = rest.split(/\s+/).filter(Boolean);
  var ccDigits = '';
  var localDigits = '';
  if(parts.length > 1){
    ccDigits = parts[0].replace(/[^0-9]/g,'');
    localDigits = parts.slice(1).join('').replace(/[^0-9]/g,'');
  } else if(parts.length === 1){
    if(rest.indexOf(' ') !== -1){
      ccDigits = parts[0].replace(/[^0-9]/g,'');
    } else {
      var hint = (ccHint && ccHint>=1 && ccHint<=4)? ccHint : 0;
      if(!hint){
        if(digits.length <= 4){
          hint = digits.length;
        } else {
          hint = 2;
        }
      }
      ccDigits = digits.slice(0, hint);
      localDigits = digits.slice(hint);
    }
  }
  if(!localDigits){
    var remainder = digits.slice(ccDigits.length);
    localDigits = remainder;
  }
  ccDigits = ccDigits.replace(/[^0-9]/g,'').slice(0,4);
  localDigits = localDigits.replace(/[^0-9]/g,'').slice(0,10);
  var formatted = '+' + ccDigits;
  if(localDigits.length){ formatted += ' ' + localDigits; }
  formatted = formatted.trim();
  return { formatted:formatted, ccLen:ccDigits.length };
}
function normalizePhone(raw){
  return formatPhone(raw, 0).formatted;
}
function phoneInput(formKey, el, fieldName){
  if(typeof fieldName === 'undefined'){ fieldName = 'phone'; }
  // Only allow +, then 2 digits (country), then 10 digits (mobile), always with a space
  var v = el.value.replace(/[^\d+]/g, '');
  if (v[0] !== '+') v = '+' + v.replace(/^\+/, '');
  var m = v.match(/^(\+\d{0,2})(\d{0,10})/);
  if (m) {
    v = m[1];
    if ((m[2] || '').length > 0) v += ' ' + m[2];
  }
  el.value = v;
  setField(formKey, fieldName, v);
}
function updateEmailStatus(statusId, value){
  if(!statusId) return;
  var node = document.getElementById(statusId);
  if(!node) return;
  if(!value){
    node.textContent = '';
    node.removeAttribute('data-state');
    return;
  }
  if(validEmail(value)){
    node.textContent = 'Email looks valid';
    node.setAttribute('data-state','ok');
  } else {
    node.textContent = 'Invalid email format';
    node.setAttribute('data-state','error');
  }
}
function emailInput(formKey, el, statusId){
  var value = String(el.value||'').trim();
  if(el.value !== value){ el.value = value; }
  setField(formKey,'email', value);
  updateEmailStatus(statusId, value);
}
function gstInput(el){
  el.value = el.value.toUpperCase().replace(/[^0-9A-Z]/g,'').slice(0,15);
}
function validGST(g){
  // 15-char GSTIN: 2 digits + 5 letters + 4 digits + 1 letter + 1 alnum (1-9/A-Z) + 'Z' + 1 alnum
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g);
}
function validIntlPhone(v){
  if(!v) return false;
  return /^\+[0-9]{1,4}\s[0-9]{10}$/.test(String(v).trim());
}
function validEmail(e){ return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }

// ----- Navigation -----
var NAVS = [
  ["dashboard","Dashboard"],
  ["customers","Customers"],
  ["opportunities","Opportunities"],
  ["contracts","Contracts"],
  ["meetings","Meetings"],
  ["reminders","Reminders"],
  ["reports","Reports"],
  ["settings","Settings"]
];

function tabLabel(tab){
  for(var i=0;i<NAVS.length;i++){ if(NAVS[i][0]===tab) return NAVS[i][1]; }
  return tab || 'App';
}


function renderNav(){
  var nav = document.getElementById('nav');
  if(!nav) return;
  nav.innerHTML = '';
  for(var i=0;i<NAVS.length;i++){
    (function(pair){
      var k = pair[0], label = pair[1];
      var b = document.createElement('button');
      b.textContent = label;
      b.className = (TAB===k ? 'active' : '');
      b.onclick = function(){ TAB = k; render(); };
      nav.appendChild(b);
    })(NAVS[i]);
  }
}

// ----- Small HTML helpers -----
function card(title, right){
  if(typeof right === 'undefined') right = '';
  return "<div class='card'><div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:12px'><h3>"+title+"</h3>"+right+"</div>";
}
function endcard(){ return "</div>"; }
function row(label, control){ return '<div class="row"><label class="block">'+label+'</label>'+control+'</div>'; }
function btn(label, cls, attrs){
  if(typeof cls === 'undefined' || !cls) cls = 'btn';
  if(typeof attrs === 'undefined') attrs = '';
  return "<button class='"+cls+"' "+attrs+">"+label+"</button>";
}
function linkBtn(label, onclickJS){
  // ensure we don't break attributes
  var safe = String(onclickJS||'').replace(/"/g,'&quot;');
  return '<button class="link" onclick="'+safe+'">'+label+'</button>';
}

// ----- Export helpers (CSV + Print/PDF) -----
function exportBtns(tableId, filenameBase){
  return btn('Export CSV','btn ghost', "onclick=\"exportFullData('"+filenameBase+"')\"") +
         ' ' +
         btn('Print / PDF','btn ghost', "onclick=\"printFullData('"+filenameBase+"')\"");
}

// --- Export full data helpers ---
function exportFullData(type){
  var rows = [];
  if(type==='opportunities'){
    rows.push(['Opportunity ID','Title','Stage','Customer/Contract','Customer Name','GSTIN','Primary Contact','Phone','Alt Phone','Email','Proposed Price','Spend']);
    for(var i=0;i<DB.opportunities.length;i++){
      var o = DB.opportunities[i];
      var cust = null, contract = null;
      if(o.assignment==='CUSTOMER'){
        cust = DB.customers.find(function(c){ return c.id===o.customer_id; });
      } else if(o.assignment==='CONTRACT'){
        contract = DB.contracts.find(function(cn){ return cn.id===o.contract_id; });
        if(contract) cust = DB.customers.find(function(c){ return c.id===contract.customer_id; });
      }
      rows.push([
        o.id,
        o.title,
        o.stage,
        o.assignment==='CONTRACT' ? (o.contract_id||'') : (o.customer_id||''),
        cust ? cust.legal_name : '',
        cust ? cust.gstin : '',
        cust ? cust.primary_contact : '',
        cust ? cust.phone : '',
        cust ? cust.alt_phone : '',
        cust ? cust.email : '',
        o.proposed_price_per_litre,
        o.spend || 0
      ]);
    }
  } else if(type==='customers'){
    rows.push(['Customer ID','Name','GSTIN','Primary Contact','Phone','Alt Phone','Email']);
    for(var i=0;i<DB.customers.length;i++){
      var c = DB.customers[i];
      rows.push([
        c.id,
        c.legal_name,
        c.gstin,
        c.primary_contact,
        c.phone,
        c.alt_phone,
        c.email
      ]);
    }
  } else if(type==='contracts'){
    rows.push(['Contract ID','Customer ID','Customer Name','Quoted Price','Start Date','Payment Terms','Primary Contact','Phone','Alt Phone','Email','GSTIN']);
    for(var i=0;i<DB.contracts.length;i++){
      var cn = DB.contracts[i];
      var cust = DB.customers.find(function(c){ return c.id===cn.customer_id; });
      rows.push([
        cn.id,
        cn.customer_id,
        cust ? cust.legal_name : '',
        cn.quoted_price_per_litre,
        cn.start_date,
        cn.payment_terms,
        cn.primary_contact,
        cn.phone,
        cn.alt_phone,
        cn.email,
        cn.gstin
      ]);
    }
  } else if(type==='meetings'){
    rows.push(['Meeting ID','Customer ID','Customer Name','Subject','When','Location','Notes','Status']);
    for(var i=0;i<DB.meetings.length;i++){
      var m = DB.meetings[i];
      var cust = DB.customers.find(function(c){ return c.id===m.customer_id; });
      rows.push([
        m.id,
        m.customer_id,
        cust ? cust.legal_name : '',
        m.subject,
        m.when_ts,
        m.location,
        m.notes,
        m.status
      ]);
    }
  } else if(type==='reminders'){
    rows.push(['Reminder ID','Customer ID','Customer Name','Title','Due','Notes','Status']);
    for(var i=0;i<DB.reminders.length;i++){
      var r = DB.reminders[i];
      var cust = DB.customers.find(function(c){ return c.id===r.customer_id; });
      rows.push([
        r.id,
        r.customer_id,
        cust ? cust.legal_name : '',
        r.title,
        r.due_ts,
        r.notes,
        r.status
      ]);
    }
  } else if(type==='pipeline'){
    rows.push(['Opportunity ID','Title','Stage','Customer ID','Customer Name','GSTIN','Primary Contact','Phone','Alt Phone','Email','Proposed Price','Spend']);
    for(var i=0;i<DB.opportunities.length;i++){
      var o = DB.opportunities[i];
      if(o.stage==='AGREED') continue;
      var cust = DB.customers.find(function(c){ return c.id===o.customer_id; });
      rows.push([
        o.id,
        o.title,
        o.stage,
        o.customer_id,
        cust ? cust.legal_name : '',
        cust ? cust.gstin : '',
        cust ? cust.primary_contact : '',
        cust ? cust.phone : '',
        cust ? cust.alt_phone : '',
        cust ? cust.email : '',
        o.proposed_price_per_litre,
        o.spend || 0
      ]);
    }
  } else if(type==='upcoming_meetings'){
    rows.push(['Meeting ID','Customer ID','Customer Name','Subject','When','Location','Notes','Status','Phone','Email']);
    var now = new Date();
    for(var i=0;i<DB.meetings.length;i++){
      var m = DB.meetings[i];
      if(m.status==='SCHEDULED' && new Date(m.when_ts)>=now){
        var cust = DB.customers.find(function(c){ return c.id===m.customer_id; });
        rows.push([
          m.id,
          m.customer_id,
          cust ? cust.legal_name : '',
          m.subject,
          m.when_ts,
          m.location,
          m.notes,
          m.status,
          cust ? cust.phone : '',
          cust ? cust.email : ''
        ]);
      }
    }
  } else if(type==='pending_reminders'){
    rows.push(['Reminder ID','Customer ID','Customer Name','Title','Due','Notes','Status','Phone','Email']);
    for(var i=0;i<DB.reminders.length;i++){
      var r = DB.reminders[i];
      if(r.status==='PENDING'){
        var cust = DB.customers.find(function(c){ return c.id===r.customer_id; });
        rows.push([
          r.id,
          r.customer_id,
          cust ? cust.legal_name : '',
          r.title,
          r.due_ts,
          r.notes,
          r.status,
          cust ? cust.phone : '',
          cust ? cust.email : ''
        ]);
      }
    }
  } else if(type==='reports_spend'){
    rows.push(['Opportunity ID','Customer ID','Customer Name','GSTIN','Primary Contact','Phone','Alt Phone','Email','Stage','Total Spend']);
    for(var i=0;i<DB.opportunities.length;i++){
      var o = DB.opportunities[i];
      var cust = DB.customers.find(function(c){ return c.id===o.customer_id; });
      rows.push([
        o.id,
        o.customer_id,
        cust ? cust.legal_name : '',
        cust ? cust.gstin : '',
        cust ? cust.primary_contact : '',
        cust ? cust.phone : '',
        cust ? cust.alt_phone : '',
        cust ? cust.email : '',
        o.stage,
        o.spend || 0
      ]);
    }
  } else if(type==='spend_by_date'){
    rows.push(['Date','Customer ID','Customer Name','GSTIN','Primary Contact','Phone','Alt Phone','Email','Total Spend']);
    var spendCid = window.__repSpendCid || '';
    var cust = DB.customers.find(function(c){ return c.id===spendCid; });
    var sbo = spendByOpp();
    var oppIds = DB.opportunities.filter(function(o){ return o.customer_id===spendCid; }).map(function(o){ return o.id; });
    var map = new Map();
    for(var i=0;i<DB.expenses.length;i++){
      var e = DB.expenses[i];
      if(oppIds.indexOf(e.opportunity_id)>-1){
        var d = (e.at||'').slice(0,10);
        map.set(d, (map.get(d)||0) + ensureNum(e.amount));
      }
    }
    map.forEach(function(val,key){
      rows.push([
        key,
        spendCid,
        cust ? cust.legal_name : '',
        cust ? cust.gstin : '',
        cust ? cust.primary_contact : '',
        cust ? cust.phone : '',
        cust ? cust.alt_phone : '',
        cust ? cust.email : '',
        val
      ]);
    });
  } else if(type==='loss_reasons'){
    rows.push(['When','Opportunity ID','Opportunity Title','Customer ID','Customer Name','GSTIN','Primary Contact','Phone','Alt Phone','Email','Reason','Spend']);
    var sbo = spendByOpp();
    var latestLoss = new Map();
    for(var i=0;i<DB.statusHistory.length;i++){
      var h = DB.statusHistory[i];
      if(h.stage==='DISAGREED' && h.reason){
        var prev = latestLoss.get(h.opportunity_id);
        if(!prev || new Date(h.at) > new Date(prev.at)){ latestLoss.set(h.opportunity_id, h); }
      }
    }
    latestLoss.forEach(function(loss,oppId){
      var o=null, j;
      for(j=0;j<DB.opportunities.length;j++){ if(DB.opportunities[j].id===oppId){ o=DB.opportunities[j]; break; } }
      var cust = o ? DB.customers.find(function(c){ return c.id===o.customer_id; }) : null;
      rows.push([
        loss.at,
        oppId,
        o ? o.title : '',
        o ? o.customer_id : '',
        cust ? cust.legal_name : '',
        cust ? cust.gstin : '',
        cust ? cust.primary_contact : '',
        cust ? cust.phone : '',
        cust ? cust.alt_phone : '',
        cust ? cust.email : '',
        loss.reason,
        sbo.get(oppId)||0
      ]);
    });
  } else if(type==='contractsTable'){
    // fallback: export visible table
    var table = document.getElementById(type);
    if(table){
      var csv = tableToCSV(table);
      var blob = new Blob([csv],{type:'text/csv'});
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = type+'.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
      return;
    }
  }
  var csv = rows.map(function(r){ return r.map(function(x){ return '"'+String(x||'').replace(/"/g,'""')+'"'; }).join(','); }).join('\r\n');
  var blob = new Blob([csv],{type:'text/csv'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = type+'_full.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
}
function printFullData(type){
  var win = window.open('', '', 'width=900,height=700');
  var html = '<html><head><title>Print '+type+'</title></head><body>';
  html += '<h2>'+type.charAt(0).toUpperCase()+type.slice(1)+' (Full Data)</h2>';
  html += '<table border=1 cellpadding=6 cellspacing=0 style="border-collapse:collapse;font-size:14px;">';
  if(type==='opportunities'){
    html += '<tr><th>Opportunity ID</th><th>Title</th><th>Stage</th><th>Customer/Contract</th><th>Customer Name</th><th>GSTIN</th><th>Primary Contact</th><th>Phone</th><th>Alt Phone</th><th>Email</th><th>Proposed Price</th><th>Spend</th></tr>';
    for(var i=0;i<DB.opportunities.length;i++){
      var o = DB.opportunities[i];
      var cust = null, contract = null;
      if(o.assignment==='CUSTOMER'){
        cust = DB.customers.find(function(c){ return c.id===o.customer_id; });
      } else if(o.assignment==='CONTRACT'){
        contract = DB.contracts.find(function(cn){ return cn.id===o.contract_id; });
        if(contract) cust = DB.customers.find(function(c){ return c.id===contract.customer_id; });
      }
      html += '<tr>'
        +'<td>'+esc(o.id)+'</td>'
        +'<td>'+esc(o.title)+'</td>'
        +'<td>'+esc(o.stage)+'</td>'
        +'<td>'+(o.assignment==='CONTRACT' ? esc(o.contract_id||'') : esc(o.customer_id||''))+'</td>'
        +'<td>'+(cust?esc(cust.legal_name):'')+'</td>'
        +'<td>'+(cust?esc(cust.gstin):'')+'</td>'
        +'<td>'+(cust?esc(cust.primary_contact):'')+'</td>'
        +'<td>'+(cust?esc(cust.phone):'')+'</td>'
        +'<td>'+(cust?esc(cust.alt_phone):'')+'</td>'
        +'<td>'+(cust?esc(cust.email):'')+'</td>'
        +'<td>'+esc(o.proposed_price_per_litre)+'</td>'
        +'<td>'+esc(o.spend||'0')+'</td>'
        +'</tr>';
    }
  } else if(type==='customers'){
    html += '<tr><th>Customer ID</th><th>Name</th><th>GSTIN</th><th>Primary Contact</th><th>Phone</th><th>Alt Phone</th><th>Email</th></tr>';
    for(var i=0;i<DB.customers.length;i++){
      var c = DB.customers[i];
      html += '<tr>'
        +'<td>'+esc(c.id)+'</td>'
        +'<td>'+esc(c.legal_name)+'</td>'
        +'<td>'+esc(c.gstin)+'</td>'
        +'<td>'+esc(c.primary_contact)+'</td>'
        +'<td>'+esc(c.phone)+'</td>'
        +'<td>'+esc(c.alt_phone)+'</td>'
        +'<td>'+esc(c.email)+'</td>'
        +'</tr>';
    }
  } else if(type==='contracts'){
    html += '<tr><th>Contract ID</th><th>Customer ID</th><th>Customer Name</th><th>Quoted Price</th><th>Start Date</th><th>Payment Terms</th><th>Primary Contact</th><th>Phone</th><th>Alt Phone</th><th>Email</th><th>GSTIN</th></tr>';
    for(var i=0;i<DB.contracts.length;i++){
      var cn = DB.contracts[i];
      var cust = DB.customers.find(function(c){ return c.id===cn.customer_id; });
      html += '<tr>'
        +'<td>'+esc(cn.id)+'</td>'
        +'<td>'+esc(cn.customer_id)+'</td>'
        +'<td>'+(cust?esc(cust.legal_name):'')+'</td>'
        +'<td>'+esc(cn.quoted_price_per_litre)+'</td>'
        +'<td>'+esc(cn.start_date)+'</td>'
        +'<td>'+esc(cn.payment_terms)+'</td>'
        +'<td>'+esc(cn.primary_contact)+'</td>'
        +'<td>'+esc(cn.phone)+'</td>'
        +'<td>'+esc(cn.alt_phone)+'</td>'
        +'<td>'+esc(cn.email)+'</td>'
        +'<td>'+esc(cn.gstin)+'</td>'
        +'</tr>';
    }
  } else if(type==='meetings'){
    html += '<tr><th>Meeting ID</th><th>Customer ID</th><th>Customer Name</th><th>Subject</th><th>When</th><th>Location</th><th>Notes</th><th>Status</th></tr>';
    for(var i=0;i<DB.meetings.length;i++){
      var m = DB.meetings[i];
      var cust = DB.customers.find(function(c){ return c.id===m.customer_id; });
      html += '<tr>'
        +'<td>'+esc(m.id)+'</td>'
        +'<td>'+esc(m.customer_id)+'</td>'
        +'<td>'+(cust?esc(cust.legal_name):'')+'</td>'
        +'<td>'+esc(m.subject)+'</td>'
        +'<td>'+esc(m.when_ts)+'</td>'
        +'<td>'+esc(m.location)+'</td>'
        +'<td>'+esc(m.notes)+'</td>'
        +'<td>'+esc(m.status)+'</td>'
        +'</tr>';
    }
  } else if(type==='reminders'){
    html += '<tr><th>Reminder ID</th><th>Customer ID</th><th>Customer Name</th><th>Title</th><th>Due</th><th>Notes</th><th>Status</th></tr>';
    for(var i=0;i<DB.reminders.length;i++){
      var r = DB.reminders[i];
      var cust = DB.customers.find(function(c){ return c.id===r.customer_id; });
      html += '<tr>'
        +'<td>'+esc(r.id)+'</td>'
        +'<td>'+esc(r.customer_id)+'</td>'
        +'<td>'+(cust?esc(cust.legal_name):'')+'</td>'
        +'<td>'+esc(r.title)+'</td>'
        +'<td>'+esc(r.due_ts)+'</td>'
        +'<td>'+esc(r.notes)+'</td>'
        +'<td>'+esc(r.status)+'</td>'
        +'</tr>';
    }
  } else if(type==='pipeline'){
    html += '<tr><th>Opportunity ID</th><th>Title</th><th>Stage</th><th>Customer ID</th><th>Customer Name</th><th>GSTIN</th><th>Primary Contact</th><th>Phone</th><th>Alt Phone</th><th>Email</th><th>Proposed Price</th><th>Spend</th></tr>';
    for(var i=0;i<DB.opportunities.length;i++){
      var o = DB.opportunities[i];
      if(o.stage==='AGREED') continue;
      var cust = DB.customers.find(function(c){ return c.id===o.customer_id; });
      html += '<tr>'
        +'<td>'+esc(o.id)+'</td>'
        +'<td>'+esc(o.title)+'</td>'
        +'<td>'+esc(o.stage)+'</td>'
        +'<td>'+esc(o.customer_id)+'</td>'
        +'<td>'+(cust?esc(cust.legal_name):'')+'</td>'
        +'<td>'+(cust?esc(cust.gstin):'')+'</td>'
        +'<td>'+(cust?esc(cust.primary_contact):'')+'</td>'
        +'<td>'+(cust?esc(cust.phone):'')+'</td>'
        +'<td>'+(cust?esc(cust.alt_phone):'')+'</td>'
        +'<td>'+(cust?esc(cust.email):'')+'</td>'
        +'<td>'+esc(o.proposed_price_per_litre)+'</td>'
        +'<td>'+esc(o.spend||'0')+'</td>'
        +'</tr>';
    }
  } else if(type==='upcoming_meetings'){
    html += '<tr><th>Meeting ID</th><th>Customer ID</th><th>Customer Name</th><th>Subject</th><th>When</th><th>Location</th><th>Notes</th><th>Status</th><th>Phone</th><th>Email</th></tr>';
    var now = new Date();
    for(var i=0;i<DB.meetings.length;i++){
      var m = DB.meetings[i];
      if(m.status==='SCHEDULED' && new Date(m.when_ts)>=now){
        var cust = DB.customers.find(function(c){ return c.id===m.customer_id; });
        html += '<tr>'
          +'<td>'+esc(m.id)+'</td>'
          +'<td>'+esc(m.customer_id)+'</td>'
          +'<td>'+(cust?esc(cust.legal_name):'')+'</td>'
          +'<td>'+esc(m.subject)+'</td>'
          +'<td>'+esc(m.when_ts)+'</td>'
          +'<td>'+esc(m.location)+'</td>'
          +'<td>'+esc(m.notes)+'</td>'
          +'<td>'+esc(m.status)+'</td>'
          +'<td>'+(cust?esc(cust.phone):'')+'</td>'
          +'<td>'+(cust?esc(cust.email):'')+'</td>'
          +'</tr>';
      }
    }
  } else if(type==='pending_reminders'){
    html += '<tr><th>Reminder ID</th><th>Customer ID</th><th>Customer Name</th><th>Title</th><th>Due</th><th>Notes</th><th>Status</th><th>Phone</th><th>Email</th></tr>';
    for(var i=0;i<DB.reminders.length;i++){
      var r = DB.reminders[i];
      if(r.status==='PENDING'){
        var cust = DB.customers.find(function(c){ return c.id===r.customer_id; });
        html += '<tr>'
          +'<td>'+esc(r.id)+'</td>'
          +'<td>'+esc(r.customer_id)+'</td>'
          +'<td>'+(cust?esc(cust.legal_name):'')+'</td>'
          +'<td>'+esc(r.title)+'</td>'
          +'<td>'+esc(r.due_ts)+'</td>'
          +'<td>'+esc(r.notes)+'</td>'
          +'<td>'+esc(r.status)+'</td>'
          +'<td>'+(cust?esc(cust.phone):'')+'</td>'
          +'<td>'+(cust?esc(cust.email):'')+'</td>'
          +'</tr>';
      }
    }
  } else if(type==='reports_spend'){
    html += '<tr><th>Opportunity ID</th><th>Customer ID</th><th>Customer Name</th><th>GSTIN</th><th>Primary Contact</th><th>Phone</th><th>Alt Phone</th><th>Email</th><th>Stage</th><th>Total Spend</th></tr>';
    for(var i=0;i<DB.opportunities.length;i++){
      var o = DB.opportunities[i];
      var cust = DB.customers.find(function(c){ return c.id===o.customer_id; });
      html += '<tr>'
        +'<td>'+esc(o.id)+'</td>'
        +'<td>'+esc(o.customer_id)+'</td>'
        +'<td>'+(cust?esc(cust.legal_name):'')+'</td>'  
        +'<td>'+(cust?esc(cust.gstin):'')+'</td>'
        +'<td>'+(cust?esc(cust.primary_contact):'')+'</td>'
        +'<td>'+(cust?esc(cust.phone):'')+'</td>'
        +'<td>'+(cust?esc(cust.alt_phone):'')+'</td>'
        +'<td>'+(cust?esc(cust.email):'')+'</td>'
        +'<td>'+esc(o.stage)+'</td>'
        +'<td>'+esc(o.spend||'0')+'</td>'
        +'</tr>';
    }
  } else if(type==='spend_by_date'){
    html += '<tr><th>Date</th><th>Customer ID</th><th>Customer Name</th><th>GSTIN</th><th>Primary Contact</th><th>Phone</th><th>Alt Phone</th><th>Email</th><th>Total Spend</th></tr>';
    var spendCid = window.__repSpendCid || '';
    var cust = DB.customers.find(function(c){ return c.id===spendCid; });
    var sbo = spendByOpp();
    var oppIds = DB.opportunities.filter(function(o){ return o.customer_id===spendCid; }).map(function(o){ return o.id; });
    var map = new Map();
    for(var i=0;i<DB.expenses.length;i++){
      var e = DB.expenses[i];
      if(oppIds.indexOf(e.opportunity_id)>-1){
        var d = (e.at||'').slice(0,10);
        map.set(d, (map.get(d)||0) + ensureNum(e.amount));
      }
    }
    map.forEach(function(val,key){
      html += '<tr>'
        +'<td>'+esc(key)+'</td>'
        +'<td>'+esc(spendCid)+'</td>'
        +'<td>'+(cust?esc(cust.legal_name):'')+'</td>'
        +'<td>'+(cust?esc(cust.gstin):'')+'</td>'
        +'<td>'+(cust?esc(cust.primary_contact):'')+'</td>'
        +'<td>'+(cust?esc(cust.phone):'')+'</td>'
        +'<td>'+(cust?esc(cust.alt_phone):'')+'</td>'
        +'<td>'+(cust?esc(cust.email):'')+'</td>'
        +'<td>'+esc(val)+'</td>'
        +'</tr>';
    });
  } else if(type==='loss_reasons'){
    html += '<tr><th>When</th><th>Opportunity ID</th><th>Opportunity Title</th><th>Customer ID</th><th>Customer Name</th><th>GSTIN</th><th>Primary Contact</th><th>Phone</th><th>Alt Phone</th><th>Email</th><th>Reason</th><th>Spend</th></tr>';
    var sbo = spendByOpp();
    var latestLoss = new Map();
    for(var i=0;i<DB.statusHistory.length;i++){
      var h = DB.statusHistory[i];
      if(h.stage==='DISAGREED' && h.reason){
        var prev = latestLoss.get(h.opportunity_id);
        if(!prev || new Date(h.at) > new Date(prev.at)){ latestLoss.set(h.opportunity_id, h); }
      }
    }
    latestLoss.forEach(function(loss,oppId){
      var o=null, j;
      for(j=0;j<DB.opportunities.length;j++){ if(DB.opportunities[j].id===oppId){ o=DB.opportunities[j]; break; } }
      var cust = o ? DB.customers.find(function(c){ return c.id===o.customer_id; }) : null;
      html += '<tr>'
        +'<td>'+esc(loss.at)+'</td>'
        +'<td>'+esc(oppId)+'</td>'
        +'<td>'+(o?esc(o.title):'')+'</td>'
        +'<td>'+(o?esc(o.customer_id):'')+'</td>'
        +'<td>'+(cust?esc(cust.legal_name):'')+'</td>'
        +'<td>'+(cust?esc(cust.gstin):'')+'</td>'
        +'<td>'+(cust?esc(cust.primary_contact):'')+'</td>'
        +'<td>'+(cust?esc(cust.phone):'')+'</td>'
        +'<td>'+(cust?esc(cust.alt_phone):'')+'</td>'
        +'<td>'+(cust?esc(cust.email):'')+'</td>'
        +'<td>'+esc(loss.reason)+'</td>'
        +'<td>'+esc(sbo.get(oppId)||'0')+'</td>'
        +'</tr>';
    });
  } else if(type==='contractsTable'){
    // fallback: print visible table
    var table = document.getElementById(type);
    if(table){
      var win2 = window.open('', '', 'width=900,height=700');
      win2.document.write('<html><head><title>Print '+type+'</title></head><body>'+table.outerHTML+'</body></html>');
      win2.document.close();
      win2.focus();
      win2.print();
      win2.close();
      return;
    }
  }
  html += '</table></body></html>';
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
  win.close();
}
function pdfFullData(type){
  // For simplicity, just print the full data (user can save as PDF from print dialog)
  printFullData(type);
}

function tableToCSV(table){
  var rows = Array.prototype.slice.call(table.querySelectorAll('tr'));
  var NL = '\n';
  return rows.map(function(r){
    var cells = Array.prototype.slice.call(r.querySelectorAll('th,td'));
    return cells.map(function(c){
      var t = (c.textContent||'').trim();
      var needsQuotes = t.indexOf(',')>-1 || t.indexOf('\n')>-1 || t.indexOf('"')>-1;
      if(needsQuotes){ t = '"' + t.split('"').join('""') + '"'; }
      return t;
    }).join(',');
  }).join(NL);
}

function downloadCSV(tableId, filename){
  var table = document.getElementById(tableId);
  if(!table){ toast('Table not found'); return; }
  var csv = tableToCSV(table);
  var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function printTable(tableId, title){
  var table = document.getElementById(tableId);
  if(!table){ toast('Table not found'); return; }
  var w = window.open('', '_blank');
  var doc = w.document;
  doc.write("<!doctype html><html><head><meta charset='utf-8'><title>"+title+"</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:16px} table{width:100%;border-collapse:collapse;font-size:14px} th,td{border:1px solid #ddd;padding:6px} th{background:#f3f4f6;text-align:left} h1{font-size:18px;margin:0 0 12px}</style></head><body><h1>"+title+"</h1></body></html>");
  doc.close();
  var clone = table.cloneNode(true);
  clone.removeAttribute('id');
  doc.body.appendChild(clone);
  w.focus();
  w.print();
}

// ----- Quick actions for meetings/reminders -----
function markMeetingDone(id){
  var i = -1;
  for(var k=0;k<DB.meetings.length;k++){ if(DB.meetings[k].id===id){ i=k; break; } }
  if(i>-1){
    DB.meetings[i].status='COMPLETED';
    saveDB(DB);
    toast('Meeting marked done');
    render();
  }
}

function markReminderDone(id){
  var i = -1;
  for(var k=0;k<DB.reminders.length;k++){ if(DB.reminders[k].id===id){ i=k; break; } }
  if(i>-1){
    DB.reminders[i].status='DONE';
    saveDB(DB);
    toast('Reminder marked done');
    render();
  }
}

// ----- Profile Modal -----
function openProfile(customerId){
  // Try customer first
  var c = DB.customers.find(function(cust){ return cust.id === customerId; });
  if (c) {
    // Show customer profile as before
    var ops=[], cons=[], meets=[], rems=[];
    for(var i=0;i<DB.opportunities.length;i++){
      var o = DB.opportunities[i];
      if(o.assignment==='CUSTOMER' && o.customer_id===customerId && o.stage==='AGREED'){
        ops.push(o);
      }
      if(o.assignment==='CONTRACT' && o.stage==='AGREED'){
        for(var j=0;j<DB.contracts.length;j++){
          if(DB.contracts[j].customer_id===customerId && o.contract_id===DB.contracts[j].id){
            ops.push(o);
          }
        }
      }
    }
    for(i=0;i<DB.contracts.length;i++){ if(DB.contracts[i].customer_id===customerId){ cons.push(DB.contracts[i]); } }
    for(i=0;i<DB.meetings.length;i++){ if(DB.meetings[i].customer_id===customerId){ meets.push(DB.meetings[i]); } }
    for(i=0;i<DB.reminders.length;i++){ if(DB.reminders[i].customer_id===customerId){ rems.push(DB.reminders[i]); } }
    var spendMap = spendByOpp();
    var salesSet = {};
    for(i=0;i<ops.length;i++){ if(ops[i].salesperson){ salesSet[ops[i].salesperson]=1; } }
    var salesPeople = Object.keys(salesSet).join(', ') || '—';
    var html = '';
    html += '<div class="grid cols-2">';
    html += card('Details');
    html += '<div style="font-size:14px;line-height:1.8">'
      + '<div><b>Name:</b> '+esc(c.legal_name||'')+'</div>'
      + '<div><b>GSTIN:</b> '+esc(c.gstin||'—')+'</div>'
      + '<div><b>Contact:</b> '+esc(c.primary_contact||'—')+'</div>'
      + '<div><b>Phone:</b> '+esc(c.phone||'—')+(c.alt_phone? ' / '+esc(c.alt_phone):'')+'</div>'
      + '<div><b>Email:</b> '+esc(c.email||'—')+'</div>'
      + '<div><b>Salespersons:</b> '+esc(salesPeople)+'</div>'
      + '</div>';
    html += endcard();
    html += card('Contracts');
    if(cons.length){
      html += '<ul style="font-size:14px;line-height:1.8">';
      for(i=0;i<cons.length;i++){
        html += '<li>Quoted ₹/L: '+esc(cons[i].quoted_price_per_litre)+' (Start '+esc(cons[i].start_date||'')+')</li>';
      }
      html += '</ul>';
    } else {
      html += '<ul><li>No contracts</li></ul>';
    }
    html += endcard();
    html += '</div>'; // end grid
    html += card('Opportunities');
    html += '<table><thead><tr><th>Title</th><th>Stage</th><th>₹/L</th><th>Spend</th></tr></thead><tbody>';
    for(i=0;i<ops.length;i++){
      var o = ops[i];
      html += '<tr><td>'+esc(o.title)+' <span class="muted mono">('+o.id+')</span></td><td>'+esc(o.stage)+'</td><td>'+esc(o.proposed_price_per_litre)+'</td><td>'+INR.format(spendMap.get(o.id)||0)+'</td></tr>';
    }
    if(!ops.length){ html += '<tr><td colspan="4" class="muted">No opportunities</td></tr>'; }
    html += '</tbody></table>';
    html += endcard();
    html += '<div class="grid cols-2">';
    html += card('Meetings');
    if(meets.length){
      html += '<ul style="font-size:14px;line-height:1.8">';
      for(i=0;i<meets.length;i++){
        html += '<li>'+new Date(meets[i].when_ts).toLocaleString()+' — '+esc(meets[i].subject)+' ['+esc(meets[i].status)+']</li>';
      }
      html += '</ul>';
    } else { html += '<ul><li>No meetings</li></ul>'; }
    html += endcard();
    html += card('Reminders');
    if(rems.length){
      html += '<ul style="font-size:14px;line-height:1.8">';
      for(i=0;i<rems.length;i++){
        html += '<li>'+new Date(rems[i].due_ts).toLocaleString()+' — '+esc(rems[i].title)+' ['+esc(rems[i].status)+']</li>';
      }
      html += '</ul>';
    } else { html += '<ul><li>No reminders</li></ul>'; }
    html += endcard();
    html += '</div>'; // end grid
    var titleEl = document.getElementById('profileTitle');
    if(titleEl) titleEl.textContent = 'Customer Profile — ' + customerId;
    var bodyEl = document.getElementById('profileBody');
    if(bodyEl) bodyEl.innerHTML = html;
    var overlay = document.getElementById('profileOverlay');
    if(overlay) overlay.style.display='flex';
    return;
  }
  // Try contract profile
  var contract = DB.contracts.find(function(con){ return con.id === customerId; });
  if (contract) {
    // Show contract profile
    var html = '';
    html += card('Contract Details');
    html += '<div style="font-size:14px;line-height:1.8">'
      + '<div><b>Contract ID:</b> '+esc(contract.id)+'</div>'
      + '<div><b>Customer ID:</b> '+esc(contract.customer_id)+'</div>'
      + '<div><b>Quoted Price (₹/L):</b> '+esc(contract.quoted_price_per_litre)+'</div>'
      + '<div><b>Start Date:</b> '+esc(contract.start_date||'')+'</div>'
      + '<div><b>Payment Terms:</b> '+esc(contract.payment_terms||'')+'</div>'
      + '<div><b>Primary Contact:</b> '+esc(contract.primary_contact||'')+'</div>'
      + '<div><b>Phone:</b> '+esc(contract.phone||'')+'</div>'
      + '<div><b>Email:</b> '+esc(contract.email||'')+'</div>'
      + '<div><b>GSTIN:</b> '+esc(contract.gstin||'')+'</div>'
      + '</div>';
    html += endcard();
    // Related opportunities
    var opps = DB.opportunities.filter(function(o){ return o.assignment==='CONTRACT' && o.contract_id===contract.id; });
    html += card('Opportunities');
    html += '<table><thead><tr><th>Title</th><th>Stage</th><th>₹/L</th><th>Spend</th></tr></thead><tbody>';
    var spendMap = spendByOpp();
    for(var i=0;i<opps.length;i++){
      var o = opps[i];
      html += '<tr><td>'+esc(o.title)+' <span class="muted mono">('+o.id+')</span></td><td>'+esc(o.stage)+'</td><td>'+esc(o.proposed_price_per_litre)+'</td><td>'+INR.format(spendMap.get(o.id)||0)+'</td></tr>';
    }
    if(!opps.length){ html += '<tr><td colspan="4" class="muted">No opportunities</td></tr>'; }
    html += '</tbody></table>';
    html += endcard();
    var titleEl = document.getElementById('profileTitle');
    if(titleEl) titleEl.textContent = 'Contract Profile — ' + contract.id;
    var bodyEl = document.getElementById('profileBody');
    if(bodyEl) bodyEl.innerHTML = html;
    var overlay = document.getElementById('profileOverlay');
    if(overlay) overlay.style.display='flex';
    return;
  }
  toast('Profile not found');
}

function closeProfile(){
  PROFILE = null;
  var overlay = document.getElementById('profileOverlay');
  if(overlay) overlay.style.display='none';
}
/* =========================
   Part 3/4: Sections & CRUD
   ========================= */

// ---------- Shared edit buffers (forms) ----------
window.__custForm = null;
window.__oppForm  = null;
window.__conForm  = null;
window.__mtgForm  = null;
window.__remForm  = null;

// ---------- Customers ----------
function editCustomer(id){
  var x=null, i;
  for(i=0;i<DB.customers.length;i++){ if(DB.customers[i].id===id){ x=DB.customers[i]; break; } }
  if(!x){ toast('Customer not found'); return; }
  window.__custForm = JSON.parse(JSON.stringify(x));
  if(!window.__custForm.hasOwnProperty('alt_phone')){ window.__custForm.alt_phone = ''; }
  TAB='customers'; render();
}
function newCustomer(){
  window.__custForm = { id:'', legal_name:'', gstin:'', primary_contact:'', phone:'', alt_phone:'', email:'' };
  TAB='customers'; render();
}
function deleteCustomer(id){
  if(!confirm('Delete customer?')) return;
  var out=[], i, found=false;
  for(i=0;i<DB.customers.length;i++){
    if(DB.customers[i].id===id){ found=true; continue; }
    out.push(DB.customers[i]);
  }
  DB.customers = out;
  saveDB(DB);
  toast('Customer deleted');
  render();
}
function sectionCustomers(){
  var f = window.__custForm || { id:'', legal_name:'', gstin:'', primary_contact:'', phone:'', alt_phone:'', email:'' };

  function submit(){
    if(!f.legal_name || !f.legal_name.trim()){ toast('Legal name required'); return; }

    function cleanPhoneField(raw, label, key){
      var trimmed = (raw||'').trim();
      if(!trimmed){
        f[key] = '';
        return '';
      }
      var formatted = normalizePhone(trimmed);
      f[key] = formatted;
      if(!validIntlPhone(formatted)){ toast(label+' must include country code and 10-digit number'); return null; }
      return formatted;
    }

    var phoneClean = cleanPhoneField(f.phone, 'Phone', 'phone');
    if(phoneClean===null) return;
    var altPhoneClean = cleanPhoneField(f.alt_phone, 'Alternative phone', 'alt_phone');
    if(altPhoneClean===null) return;
    if(f.gstin){
      if(f.gstin.length!==15 || !validGST(f.gstin)){ toast('Invalid GSTIN (15 chars, proper format)'); return; }
    }
    var emailValue = (f.email||'').trim();
    f.email = emailValue;
    if(emailValue && !validEmail(emailValue)){ toast('Invalid email format'); return; }
    var i=-1;
    for(var k=0;k<DB.customers.length;k++){ if(DB.customers[k].id===f.id){ i=k; break; } }
    if(i!==-1){
      DB.customers[i].legal_name = f.legal_name;
      DB.customers[i].gstin = f.gstin||'';
      DB.customers[i].primary_contact = f.primary_contact||'';
      DB.customers[i].phone = phoneClean || '';
      DB.customers[i].alt_phone = altPhoneClean || '';
      DB.customers[i].email = f.email||'';
      toast('Customer updated');
    } else {
      var nid = id6();
      DB.customers.push({
        id:nid, created_at:nowISO(),
        legal_name:f.legal_name, gstin:f.gstin||'',
        primary_contact:f.primary_contact||'', phone: phoneClean || '', alt_phone: altPhoneClean || '', email:f.email||''
      });
      toast('Customer created (ID '+nid+')');
    }
    saveDB(DB);
    window.__custForm = { id:'', legal_name:'', gstin:'', primary_contact:'', phone:'', alt_phone:'', email:'' };
    render();
  }

  window.__custSubmit = submit;

  var html = '';
  html += card(f.id?('Edit Customer ('+esc(f.id)+')'):'Create Customer', btn('New','btn ghost','onclick="newCustomer()"'));
  var search = (window.__customerSearch||'').trim();
  html += "<div class='grid cols-3'>";

  html += row('Legal Name',
    "<input value='"+esc(f.legal_name)+"' oninput=\"setField('__custForm','legal_name',this.value)\" />");

  html += row('GSTIN',
    "<input maxlength='15' value='"+esc(f.gstin)+"' oninput=\"gstInput(this); setField('__custForm','gstin',this.value)\" />");

  html += row('Primary Contact',
    "<input value='"+esc(f.primary_contact)+"' oninput=\"setField('__custForm','primary_contact',this.value)\" />");

  html += row('Phone',
    "<input value='"+esc(f.phone)+"' placeholder='e.g. +91 9876543210' oninput=\"phoneInput('__custForm',this)\" />");
  html += row('Alternative Phone',
    "<input value='"+esc(f.alt_phone)+"' placeholder='e.g. +91 9876543210' oninput=\"phoneInput('__custForm',this,'alt_phone')\" />");

  var emailValue = (f.email||'').trim();
  f.email = emailValue;
  var emailStatusAttr = '';
  var emailStatusText = '';
  if(emailValue){
    if(validEmail(emailValue)){
      emailStatusAttr = " data-state='ok'";
      emailStatusText = 'Email looks valid';
    } else {
      emailStatusAttr = " data-state='error'";
      emailStatusText = 'Invalid email format';
    }
  }

  html += row('Email',
    "<input value='"+esc(emailValue)+"' oninput=\"emailInput('__custForm',this,'custEmailHint')\" />"
    + "<div id='custEmailHint' class='input-hint'"+emailStatusAttr+">"+esc(emailStatusText)+"</div>");

  html += "</div><div style='margin-top:8px'>"+btn(f.id?'Update':'Create','btn','onclick="__custSubmit()"')+"</div>"+endcard();

  // Table
  html += card('All Customers',
    "<input id='customerSearch' type='text' maxlength='20' placeholder='Search Customers' style='width:220px;padding:5px;font-size:15px;margin-left:12px;' oninput='window.__customerSearch=this.value.toLowerCase(); window.filterCustomersTable();' value='"+(window.__customerSearch||"")+"' /> " +
    exportBtns('customersTable','customers')
  );
// --- Customers table filter function ---
window.filterCustomersTable = function(){
  var search = (window.__customerSearch||'').trim();
  var table = document.getElementById('customersTable');
  if(!table) return;
  var rows = table.getElementsByTagName('tr');
  for(var i=1;i<rows.length;i++){
    var txt = rows[i].textContent.toLowerCase();
    rows[i].style.display = (!search || txt.indexOf(search) !== -1) ? '' : 'none';
  }
};
  html += "<table id='customersTable'><thead><tr><th>ID</th><th>Name</th><th>GSTIN</th><th>Contact</th><th></th></tr></thead><tbody>";
  var i;
  for(i=0;i<DB.customers.length;i++){
    var c = DB.customers[i];
    // Only show customers with at least one AGREED opportunity
    var hasAgreedOpp = DB.opportunities.some(function(o){ return o.assignment==='CUSTOMER' && o.customer_id===c.id && o.stage==='AGREED'; });
    if(!hasAgreedOpp) continue;
    var match = !search ||
      (c.id && c.id.toLowerCase().includes(search)) ||
      (c.legal_name && c.legal_name.toLowerCase().includes(search)) ||
      DB.contracts.some(function(con){ return con.customer_id===c.id && con.id.toLowerCase().includes(search); });
    if(!match) continue;
    html += "<tr>"
      + "<td class='mono'>"+esc(c.id)+"</td>"
      + "<td>"+linkBtn(esc(c.legal_name),"openProfile('"+c.id+"')")+"</td>"
      + "<td>"+esc(c.gstin||'')+"</td>"
      + "<td>"+esc(c.primary_contact||'')+(c.phone?(" ("+esc(c.phone)+")"):'')+"</td>"
      + "<td style='text-align:right'>"+linkBtn('Edit',"editCustomer('"+c.id+"')")+" &nbsp; "+linkBtn('Delete',"deleteCustomer('"+c.id+"')")+"</td>"
      + "</tr>";
  }
  if(!DB.customers.length){ html += "<tr><td colspan='5' class='muted'>No customers yet</td></tr>"; }
  html += "</tbody></table>";
  html += endcard();

  return html;
}

// ---------- Opportunities ----------
function ensureCustomerByInput(input){
  var t = (input||'').trim();
  if(!t) throw new Error('Customer required');

  // If matches existing ID
  var i;
  for(i=0;i<DB.customers.length;i++){ if(DB.customers[i].id===t){ return DB.customers[i].id; } }

  // If typed a name, create a new customer
  var newId = id6();
  DB.customers.push({ id:newId, legal_name:t, gstin:'', primary_contact:'', phone:'', alt_phone:'', email:'', created_at:nowISO() });
  saveDB(DB);
  return newId;
}
function editOpportunity(id){
  var x=null,i;
  for(i=0;i<DB.opportunities.length;i++){ if(DB.opportunities[i].id===id){ x=DB.opportunities[i]; break; } }
  if(!x){ toast('Opportunity not found'); return; }
  window.__oppForm = {
    id: x.id,
    customer_input: (x.assignment === 'CONTRACT' ? x.contract_id : x.customer_id),
    contract_id: x.contract_id || '',
    title: x.title,
    expected_monthly_volume_l: x.expected_monthly_volume_l,
    proposed_price_per_litre: x.proposed_price_per_litre,
    stage: x.stage,
    notes: x.notes || '',
    salesperson: x.salesperson || '',
    assignment: x.assignment || 'CUSTOMER',
    contract_choice: '',
    loss_reason: '',
    spend: x.spend || ''
  };
  TAB='opportunities'; render();
}
function newOpportunity(){
  window.__oppForm = {
    id:'', customer_input:'', contract_id:'', title:'', expected_monthly_volume_l:'',
    proposed_price_per_litre:'', stage:'LEAD', notes:'', salesperson:'',
    assignment:'CUSTOMER', contract_choice:'', loss_reason:''
  };
  TAB='opportunities'; render();
}
function deleteOpportunity(id){
  if(!confirm('Delete opportunity?')) return;
  fetch('/api/opportunities/' + id, { method: 'DELETE' })
    .then(res => res.json())
    .then(data => {
      window.__opportunitiesLoaded = false;
      toast('Opportunity deleted');
      render();
    });
}
function sectionOpportunities(){
  var f = window.__oppForm || {
    id:'', customer_input:'', title:'', expected_monthly_volume_l:'',
    proposed_price_per_litre:'', stage:'LEAD', notes:'', salesperson:'',
    assignment:'CUSTOMER', contract_choice:'', loss_reason:''
  };

  function submit(){
    try{
      var payload = {
        title: f.title,
        expected_monthly_volume_l: ensureNum(f.expected_monthly_volume_l),
        proposed_price_per_litre: ensureNum(f.proposed_price_per_litre),
        stage: f.stage,
        probability: stageProb(f.stage),
        notes: f.notes||'',
        salesperson: f.salesperson||''
      };
      if(f.assignment==='CONTRACT') {
        // Always auto-generate contract id for new opportunity
        var contractId = f.id ? f.customer_input : ('CON-' + id6());
        var contract = DB.contracts.find(function(c){ return c.id === contractId; });
        if(!contract && !f.id) {
          // Auto-create contract only for new opportunity, using form data
          var newContract = {
            id: contractId,
            customer_id: ensureCustomerByInput(f.customer_input),
            quoted_price_per_litre: f.proposed_price_per_litre || 0,
            start_date: nowISO().slice(0,10),
            payment_terms: 'Net 15',
            primary_contact: f.salesperson || '',
            phone: '',
            alt_phone: '',
            email: '',
            gstin: ''
          };
          DB.contracts.push(newContract);
          contract = newContract;
          saveDB(DB);
        }
        payload.contract_id = contractId;
        if('customer_id' in payload) delete payload.customer_id;
      } else {
        // Always auto-generate customer id for new opportunity
        payload.customer_id = ensureCustomerByInput(f.customer_input);
        payload.contract_id = null;
      }

      var oppId = f.id;
      if(f.id){
        // Update
        fetch('/api/opportunities/' + f.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(data => {
          window.__opportunitiesLoaded = false;
          toast('Opportunity updated');
          window.__oppForm = {
            id:'', customer_input:'', title:'', expected_monthly_volume_l:'',
            proposed_price_per_litre:'', stage:'LEAD', notes:'', salesperson:'',
            assignment:'CUSTOMER', contract_choice:'', loss_reason:'', spend:''
          };
          render();
        });
      } else {
        // Create
        fetch('/api/opportunities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(data => {
          window.__opportunitiesLoaded = false;
          toast('Opportunity created');
          window.__oppForm = {
            id:'', customer_input:'', title:'', expected_monthly_volume_l:'',
            proposed_price_per_litre:'', stage:'LEAD', notes:'', salesperson:'',
            assignment:'CUSTOMER', contract_choice:'', loss_reason:'', spend:''
          };
          render();
        });
      }
    }catch(e){
      toast(e.message||String(e));
    }
  }

  window.__oppSubmit = submit;

  var sbo = spendByOpp();
  var cbc = contractsByCustomer();

  var html = '';
  html += card(f.id?('Edit Opportunity ('+esc(f.id)+')'):'Create Opportunity', btn('Clear','btn ghost','onclick="clearOpportunityForm()"'));
  html += "<div class='grid cols-3'>";
  html += row('Assignment', "<select onchange=\"setField('__oppForm','assignment',this.value)\"><option value='CUSTOMER'"+(f.assignment==='CUSTOMER'?" selected":"")+">Customer</option><option value='CONTRACT'"+(f.assignment==='CONTRACT'?" selected":"")+">Contract</option></select>");
  html += row('Customer/Contract', "<input value='"+esc(f.customer_input)+"' placeholder='Paste Customer or Contract ID' oninput=\"setField('__oppForm','customer_input',this.value)\" />");
  html += row('Title', "<input value='"+esc(f.title)+"' oninput=\"setField('__oppForm','title',this.value)\" />");
  html += row('Expected Monthly Volume (L)', "<input type='number' value='"+esc(f.expected_monthly_volume_l)+"' oninput=\"setField('__oppForm','expected_monthly_volume_l',this.value)\" />");
  html += row('Proposed Price (₹/L)', "<input type='number' value='"+esc(f.proposed_price_per_litre)+"' oninput=\"setField('__oppForm','proposed_price_per_litre',this.value)\" />");
  html += row('Spend', "<input type='number' value='"+esc(f.spend)+"' oninput=\"setField('__oppForm','spend',this.value)\" />");
  html += row('Salesperson', "<input value='"+esc(f.salesperson)+"' oninput=\"setField('__oppForm','salesperson',this.value)\" />");
  html += row('Notes', "<input value='"+esc(f.notes)+"' oninput=\"setField('__oppForm','notes',this.value)\" />");
  html += row('Stage', "<select onchange=\"setField('__oppForm','stage',this.value)\"><option value='LEAD'"+(f.stage==='LEAD'?" selected":"")+">LEAD</option><option value='QUALIFIED'"+(f.stage==='QUALIFIED'?" selected":"")+">QUALIFIED</option><option value='NEGOTIATION'"+(f.stage==='NEGOTIATION'?" selected":"")+">NEGOTIATION</option><option value='AGREED'"+(f.stage==='AGREED'?" selected":"")+">AGREED</option><option value='DISAGREED'"+(f.stage==='DISAGREED'?" selected":"")+">DISAGREED</option></select>");
  if(f.stage==='DISAGREED'){
    html += row('Loss Reason', "<input value='"+esc(f.loss_reason)+"' oninput=\"setField('__oppForm','loss_reason',this.value)\" />");
  }
  html += "</div><div style='margin-top:8px'>"+btn(f.id?'Update':'Create','btn','onclick="__oppSubmit()"')+"</div>"+endcard();

  // Opportunity Table
  html += card('All Opportunities',
    "<input id='opportunitySearch' type='text' maxlength='20' placeholder='Search Opportunities' style='width:220px;padding:5px;font-size:15px;margin-left:12px;' oninput='window.__opportunitySearch=this.value.toLowerCase(); window.filterOpportunitiesTable();' value='"+(window.__opportunitySearch||"")+"' /> " +
    exportBtns('opportunitiesTable','opportunities')
  );
// --- Opportunities table filter function ---
window.filterOpportunitiesTable = function(){
  var search = (window.__opportunitySearch||'').trim();
  var table = document.getElementById('opportunitiesTable');
  if(!table) return;
  var rows = table.getElementsByTagName('tr');
  for(var i=1;i<rows.length;i++){
    var txt = rows[i].textContent.toLowerCase();
    rows[i].style.display = (!search || txt.indexOf(search) !== -1) ? '' : 'none';
  }
};
  html += "<table id='opportunitiesTable'><thead><tr><th>Title</th><th>Customer/Contract</th><th>Stage</th><th>Salesperson</th><th>Spend</th><th></th></tr></thead><tbody>";
  var opps = window.__opportunities || [];
  if (!window.__opportunitiesLoaded) {
    fetch('/api/opportunities')
      .then(res => res.json())
      .then(data => {
        window.__opportunities = data;
        window.__opportunitiesLoaded = true;
        render();
      });
  }
  for(var i=0;i<opps.length;i++){
    var o = opps[i];
    html += "<tr>"
      + "<td>"+esc(o.title)+"</td>"
      + "<td>"+linkBtn(o.customer_id||o.contract_id||'', (o.customer_id ? "openProfile('"+o.customer_id+"')" : (o.contract_id ? "openProfile('"+o.contract_id+"')" : ''))) + "</td>"
      + "<td>"+esc(o.stage)+"</td>"
      + "<td>"+esc(o.salesperson)+"</td>"
      + "<td>"+esc(o.spend||'')+"</td>"
      + "<td style='text-align:right'>"+linkBtn('Edit',"editOpportunity('"+o.id+"')")+" &nbsp; "+linkBtn('Delete',"deleteOpportunity('"+o.id+"')")+"</td>"
      + "</tr>";
  }
  if(!opps.length){ html += "<tr><td colspan='6' class='muted'>No opportunities</td></tr>"; }
  html += "</tbody></table>";
  html += endcard();
  window.clearOpportunityForm = function(){
    window.__oppForm = {
      id:'', customer_input:'', title:'', expected_monthly_volume_l:'',
      proposed_price_per_litre:'', stage:'LEAD', notes:'', salesperson:'',
      assignment:'CUSTOMER', contract_choice:'', loss_reason:'', spend:''
    };
    render();
  };

  function submit(){
    try{
      // If all fields are empty, do nothing
  var allEmpty = !f.customer_input && !f.title && !f.expected_monthly_volume_l && !f.proposed_price_per_litre && !f.salesperson && !f.notes && !f.spend && !f.assignment && !f.stage;
  if(allEmpty){ toast('Please enter opportunity details.'); return; }

      // If customer_input is empty, auto-generate a new customer or contract ID
      if(!f.customer_input || !f.customer_input.trim()){
        if(f.assignment==='CUSTOMER'){
          f.customer_input = 'CUST-' + id6();
        } else if(f.assignment==='CONTRACT'){
          f.customer_input = 'CON-' + id6();
        }
      }
      // Ensure all entered fields are used in new profile
      // ...existing code...

      var payload = {
        title: f.title,
        expected_monthly_volume_l: ensureNum(f.expected_monthly_volume_l),
        proposed_price_per_litre: ensureNum(f.proposed_price_per_litre),
        stage: f.stage,
        probability: stageProb(f.stage),
        notes: f.notes||'',
        salesperson: f.salesperson||''
      };
      if(f.assignment==='CONTRACT') {
        // Always auto-generate contract id for new opportunity
        var contractId = f.id ? f.customer_input : ('CON-' + id6());
        var contract = DB.contracts.find(function(c){ return c.id === contractId; });
        if(!contract && !f.id) {
          // Auto-create contract only for new opportunity, using form data
          var newContract = {
            id: contractId,
            customer_id: ensureCustomerByInput(f.customer_input),
            quoted_price_per_litre: f.proposed_price_per_litre || 0,
            start_date: nowISO().slice(0,10),
            payment_terms: 'Net 15',
            primary_contact: f.salesperson || '',
            phone: '',
            alt_phone: '',
            email: '',
            gstin: ''
          };
          DB.contracts.push(newContract);
          contract = newContract;
          saveDB(DB);
        }
        payload.contract_id = contractId;
        if('customer_id' in payload) delete payload.customer_id;
      } else {
        // Always auto-generate customer id for new opportunity
        payload.customer_id = ensureCustomerByInput(f.customer_input);
        payload.contract_id = null;
      }

      var oppId = f.id;
      if(f.id){
        var idx=-1; for(var k=0;k<DB.opportunities.length;k++){ if(DB.opportunities[k].id===f.id){ idx=k; break; } }
        if(idx===-1) throw new Error('Opportunity not found');
        for(var k2 in payload){ DB.opportunities[idx][k2]=payload[k2]; }
        DB.opportunities[idx].assignment = f.assignment;
        DB.opportunities[idx].contract_id = payload.contract_id;
        if(f.assignment==='CONTRACT') {
          if('customer_id' in DB.opportunities[idx]) delete DB.opportunities[idx].customer_id;
        } else {
          DB.opportunities[idx].customer_id = payload.customer_id;
        }
        // --- Spend logic ---
        var spendVal = ensureNum(f.spend);
        var found = false;
        for(var i=0;i<DB.expenses.length;i++){
          if(DB.expenses[i].opportunity_id===DB.opportunities[idx].id){
            DB.expenses[i].amount = spendVal;
            found = true;
            break;
          }
        }
        if(!found && spendVal>0){
          DB.expenses.push({opportunity_id:DB.opportunities[idx].id, amount:spendVal, at:nowISO(), note:'Opportunity spend'});
        }
        DB.opportunities[idx].spend = spendVal;
        // --- End spend logic ---
        toast('Opportunity updated');
      } else {
        oppId = 'OPP-'+id6();
        var p2 = {}; for(var kk in payload){ p2[kk]=payload[kk]; }
        p2.id = oppId;
        p2.assignment = f.assignment;
        p2.contract_id = payload.contract_id;
        if(f.assignment==='CONTRACT') {
          if('customer_id' in p2) delete p2.customer_id;
        } else {
          p2.customer_id = payload.customer_id;
        }
        // --- Spend logic ---
        var spendVal = ensureNum(f.spend);
        if(spendVal>0){
          DB.expenses.push({opportunity_id:p2.id, amount:spendVal, at:nowISO(), note:'Opportunity spend'});
        }
        p2.spend = spendVal;
        // --- End spend logic ---
        DB.opportunities.push(p2);
        toast('Opportunity created');
      }

      if(f.stage==='DISAGREED' && f.loss_reason && f.loss_reason.trim()){
        DB.statusHistory.push({ opportunity_id:oppId, stage:'DISAGREED', reason:f.loss_reason.trim(), at:nowISO() });
      }
      if(f.stage==='AGREED'){
        DB.statusHistory.push({ opportunity_id:oppId, stage:'AGREED', reason:'', at:nowISO() });
      }

      saveDB(DB);
      // Do not clear form after create, only after clear button
      render();
    }catch(e){
      toast(e.message||String(e));
    }
  }
  // render();
  return html;
}
function sectionContracts(){
  var f = window.__conForm || { id:'', customer_id:'', quoted_price_per_litre:'', start_date:'', payment_terms:'Net 15',
    primary_contact:'', phone:'', alt_phone:'', email:'', gstin:'' };

  function submit(){
    try{
      var sel = document.getElementById('reminderCustomerSelect');
      if(sel) {
        f.customer_id = sel.value;
        if(window.__remForm) window.__remForm.customer_id = sel.value;
      }
      toast('DEBUG: customer_id='+f.customer_id+' | __remForm.customer_id='+(window.__remForm?window.__remForm.customer_id:''));
      var sel2 = document.getElementById('reminderCustomerSelect');
      if(sel2) {
        f.customer_id = sel2.value;
        if(window.__remForm) window.__remForm.customer_id = sel2.value;
      }
  if(!f.customer_id || !f.customer_id.trim()){ toast('Customer ID required'); return; }
  var custId = f.customer_id.trim();
  var validCustomer = DB.customers.some(function(c){ return c.id === custId; });
  if(!validCustomer){ toast('Customer ID not found'); return; }

    var phoneClean = '';
    var phoneRaw = (f.phone||'').trim();
    if(phoneRaw){
      phoneClean = normalizePhone(phoneRaw);
      f.phone = phoneClean;
      if(!validIntlPhone(phoneClean)){ toast('Phone must include country code and 10-digit number'); return; }
    } else {
      f.phone = '';
    }
      if(f.gstin && (f.gstin.length!==15 || !validGST(f.gstin))){ toast('Invalid GSTIN'); return; }
      var emailValue = (f.email||'').trim();
      f.email = emailValue;
      if(emailValue && !validEmail(emailValue)){ toast('Invalid email'); return; }
      // Accept either customer_id or contract_id for validation
      var custId = f.customer_id.trim();
      var validCustomer = DB.customers.some(function(c){ return c.id === custId; });
      var validContract = DB.contracts.some(function(c){ return c.id === custId; });
      if(!validCustomer && !validContract){ toast('Customer or Contract ID not found'); return; }

      var payload = {
        customer_id: custId,
        quoted_price_per_litre: ensureNum(f.quoted_price_per_litre),
        start_date: f.start_date||'',
        payment_terms: f.payment_terms||'Net 15',
        primary_contact: f.primary_contact||'',
        phone: phoneClean || '',
        email: f.email||'',
        gstin: f.gstin||''
      };

      if(f.id){
        var idx=-1; for(i=0;i<DB.contracts.length;i++){ if(DB.contracts[i].id===f.id){ idx=i; break; } }
        if(idx===-1){ toast('Contract not found'); return; }
        for(var k in payload){ DB.contracts[idx][k]=payload[k]; }
        toast('Contract updated');
      } else {
        var nid='CON-'+id6();
        payload.id = nid;
        DB.contracts.push(payload);
        toast('Contract created ('+nid+')');
      }
      saveDB(DB);
      window.__conForm = { id:'', customer_id:'', quoted_price_per_litre:'', start_date:'', payment_terms:'Net 15',
        primary_contact:'', phone:'', alt_phone:'', email:'', gstin:'' };
      render();
    }catch(e){ toast(e.message||String(e)); }
  }

  window.__conSubmit = submit;

  var html = '';
  html += card(f.id?('Edit Contract ('+esc(f.id)+')'):'Create Contract', btn('New','btn ghost','onclick="newContract()"'));
  html += "<div class='grid cols-3'>";

  html += row('Customer ID',
    "<input value='"+esc(f.customer_id)+"' placeholder='Paste existing Customer ID' oninput=\"setField('__conForm','customer_id',this.value)\" />");

  html += row('Quoted Price (â‚¹/L)',
    "<input type='number' value='"+esc(f.quoted_price_per_litre)+"' oninput=\"setField('__conForm','quoted_price_per_litre',this.value)\" />");

  html += row('Start Date',
    "<input type='date' value='"+esc(f.start_date)+"' oninput=\"setField('__conForm','start_date',this.value)\" />");

  html += row('Payment Terms',
    "<input value='"+esc(f.payment_terms)+"' oninput=\"setField('__conForm','payment_terms',this.value)\" />");

  html += row('Primary Contact',
    "<input value='"+esc(f.primary_contact)+"' oninput=\"setField('__conForm','primary_contact',this.value)\" />");

  html += row('Phone',
    "<input value='"+esc(f.phone)+"' placeholder='e.g. +91 9876543210' oninput=\"phoneInput('__conForm',this)\" />");

  var emailValue = (f.email||'').trim();
  f.email = emailValue;
  var emailStatusAttr = '';
  var emailStatusText = '';
  if(emailValue){
    if(validEmail(emailValue)){
      emailStatusAttr = " data-state='ok'";
      emailStatusText = 'Email looks valid';
    } else {
      emailStatusAttr = " data-state='error'";
      emailStatusText = 'Invalid email format';
    }
  }

  html += row('Email',
    "<input value='"+esc(emailValue)+"' oninput=\"emailInput('__conForm',this,'conEmailHint')\" />"
    + "<div id='conEmailHint' class='input-hint'"+emailStatusAttr+">"+esc(emailStatusText)+"</div>");

  html += row('GSTIN',
    "<input maxlength='15' value='"+esc(f.gstin)+"' oninput=\"gstInput(this); setField('__conForm','gstin',this.value)\" />");

  html += "</div><div style='margin-top:8px'>"+btn(f.id?'Update':'Create','btn','onclick="__conSubmit()"')+"</div>"+endcard();

  // List
  html += card('All Contracts',
    "<input id='contractSearch' type='text' maxlength='20' placeholder='Search Contracts' style='width:220px;padding:5px;font-size:15px;margin-left:12px;' oninput='window.__contractSearch=this.value.toLowerCase(); window.filterContractsTable();' value='"+(window.__contractSearch||"")+"' /> " +
    exportBtns('contractsTable','contracts')
  );
// --- Contracts table filter function ---
window.filterContractsTable = function(){
  var search = (window.__contractSearch||'').trim();
  var table = document.getElementById('contractsTable');
  if(!table) return;
  var rows = table.getElementsByTagName('tr');
  for(var i=1;i<rows.length;i++){
    var txt = rows[i].textContent.toLowerCase();
    rows[i].style.display = (!search || txt.indexOf(search) !== -1) ? '' : 'none';
  }
};
  html += "<table id='contractsTable'><thead><tr><th>Customer</th><th>Quoted â‚¹/L</th><th>Start</th><th>Contact</th><th>Opportunities</th><th></th></tr></thead><tbody>";
  var i;
  for(i=0;i<DB.contracts.length;i++){
    var contract = DB.contracts[i];
    var relatedOpps = DB.opportunities.filter(function(o){ return o.assignment==='CONTRACT' && o.contract_id===contract.id && o.stage==='AGREED'; });
    // Only show contracts with at least one AGREED opportunity
    if(relatedOpps.length === 0) continue;
    var oppTitles = relatedOpps.map(function(o){ return esc(o.title); }).join(', ');
    var custObj = DB.customers.find(function(cust){ return cust.id === contract.customer_id; });
    var custName = custObj ? custObj.legal_name : contract.customer_id;
    html += "<tr>"
      + "<td>"+linkBtn(custName,"openProfile('"+contract.customer_id+"')")+"</td>"
      + "<td>"+esc(contract.quoted_price_per_litre)+"</td>"
      + "<td>"+esc(contract.start_date||'')+"</td>"
      + "<td>"+esc(contract.primary_contact||'')+(contract.phone?(' ('+esc(contract.phone)+')'):'')+"</td>"
      + "<td>"+oppTitles+"</td>"
      + "<td style='text-align:right'>"+linkBtn('Edit',"editContract('"+contract.id+"')")+" &nbsp; "+linkBtn('Delete',"deleteContract('"+contract.id+"')")+"</td>"
      + "</tr>";
  }
  if(!DB.contracts.length){ html += "<tr><td colspan='6' class='muted'>No contracts</td></tr>"; }
  html += "</tbody></table>";
  html += endcard();

  return html;
}

// ---------- Meetings ----------
function editMeeting(id){
  var x=null,i;
  for(i=0;i<DB.meetings.length;i++){ if(DB.meetings[i].id===id){ x=DB.meetings[i]; break; } }
  if(!x){ toast('Meeting not found'); return; }
  window.__mtgForm = JSON.parse(JSON.stringify(x));
  TAB='meetings'; render();
}
function newMeeting(){
  window.__mtgForm = { id:'', customer_id:'', subject:'', when_ts:'', location:'', notes:'', status:'SCHEDULED' };
  TAB='meetings'; render();
}
function deleteMeeting(id){
  if(!confirm('Delete meeting?')) return;
  var out=[], i;
  for(i=0;i<DB.meetings.length;i++){ if(DB.meetings[i].id!==id) out.push(DB.meetings[i]); }
  DB.meetings = out;
  saveDB(DB);
  toast('Meeting deleted');
  render();
}
function sectionMeetings(){
  var f = window.__mtgForm || { id:'', customer_id:'', subject:'', when_ts:'', location:'', notes:'', status:'SCHEDULED' };

  function submit(){
    try{
    // Always get the latest value from the dropdown
    var sel = document.getElementById('meetingCustomerSelect');
    if(sel) f.customer_id = sel.value;
    // Ensure all entered values are used
    f.subject = document.querySelector("input[oninput*=subject]").value;
    f.when_ts = document.querySelector("input[type='datetime-local'][oninput*=when_ts]").value;
    f.location = document.querySelector("input[oninput*=location]").value;
    f.notes = document.querySelector("input[oninput*=notes]").value;
    var statusSel = document.querySelector("select[onchange*=status]");
    if(statusSel) f.status = statusSel.value;
    if(!f.customer_id || !f.customer_id.trim()){ toast('Customer ID required'); return; }
      var have=false,i; for(i=0;i<DB.customers.length;i++){ if(DB.customers[i].id===f.customer_id.trim()){ have=true; break; } }
      if(!have){ toast('Customer ID not found'); return; }
      if(!f.customer_id || !f.customer_id.trim()){ toast('Customer/Contract ID required'); return; }
      var have=false,i;
      // Accept either customer_id or contract_id
      for(i=0;i<DB.customers.length;i++){ if(DB.customers[i].id===f.customer_id.trim()){ have=true; break; } }
      if(!have){
        for(i=0;i<DB.contracts.length;i++){ if(DB.contracts[i].id===f.customer_id.trim()){ have=true; break; } }
      }
      if(!have){ toast('Customer or Contract ID not found'); return; }

      var p = {
        customer_id: f.customer_id.trim(),
        subject: f.subject||'',
        when_ts: f.when_ts||'',
        location: f.location||'',
        notes: f.notes||'',
        status: f.status||'SCHEDULED'
      };

      if(f.id){
        var idx=-1; for(i=0;i<DB.meetings.length;i++){ if(DB.meetings[i].id===f.id){ idx=i; break; } }
        if(idx===-1){ toast('Meeting not found'); return; }
        for(var k in p){ DB.meetings[idx][k]=p[k]; }
        toast('Meeting updated');
      } else {
        p.id = 'MTG-'+id6();
        DB.meetings.push(p);
        toast('Meeting created');
      }
      saveDB(DB);
      window.__mtgForm = { id:'', customer_id:'', subject:'', when_ts:'', location:'', notes:'', status:'SCHEDULED' };
      render();
    }catch(e){ toast(e.message||String(e)); }
  }
  window.__mtgSubmit = submit;

  var html = '';

  html += card(f.id?('Edit Meeting ('+esc(f.id)+')'):'Create Meeting', btn('New','btn ghost','onclick="newMeeting()"'));
  html += "<div class='grid cols-3'>";

  // Customer ID dropdown + manual input
  var custOpts = DB.customers.map(function(c){
    return "<option value='" + esc(c.id) + "'>" + esc(c.id) + " - " + esc(c.legal_name) + "</option>";
  }).join('');
  html += row('Customer ID',
    "<select id='meetingCustomerSelect' onchange=\"setField('__mtgForm','customer_id',this.value); window.__mtgForm.customer_id=this.value;\" style='width:100%'><option value=''>-- Select Customer --</option>"+custOpts+"</select>");
  setTimeout(function(){
    var sel = document.getElementById('meetingCustomerSelect');
    if(sel && window.__mtgForm && window.__mtgForm.customer_id) sel.value = window.__mtgForm.customer_id;
    // Always sync form state after render
    if(sel) sel.onchange = function(){
      setField('__mtgForm','customer_id',this.value);
      if(window.__mtgForm) window.__mtgForm.customer_id=this.value;
    };
  }, 0);

  html += row('Subject',
    "<input value='"+esc(f.subject)+"' oninput=\"setField('__mtgForm','subject',this.value)\" />");

  html += row('When',
    "<input type='datetime-local' value='"+esc(f.when_ts)+"' oninput=\"setField('__mtgForm','when_ts',this.value)\" />");

  html += row('Location',
    "<input value='"+esc(f.location)+"' oninput=\"setField('__mtgForm','location',this.value)\" />");

  html += row('Notes',
    "<input value='"+esc(f.notes)+"' oninput=\"setField('__mtgForm','notes',this.value)\" />");

  html += row('Status',
    "<select onchange=\"setField('__mtgForm','status',this.value)\"><option>SCHEDULED</option><option>COMPLETED</option><option>CANCELLED</option></select>");

  html += "</div><div style='margin-top:8px'>"+btn(f.id?'Update':'Create','btn','onclick="__mtgSubmit()"')+"</div>"+endcard();

  // Table
  html += card('All Meetings',
    "<input id='meetingsSearch' type='text' maxlength='20' placeholder='Search Meetings' style='width:220px;padding:5px;font-size:15px;margin-left:12px;' oninput='window.__meetingsSearch=this.value.toLowerCase(); window.filterMeetingsTable();' value='"+(window.__meetingsSearch||"")+"' /> " +
    exportBtns('meetingsTable','meetings')
  );
// --- Meetings table filter function ---
window.filterMeetingsTable = function(){
  var search = (window.__meetingsSearch||'').trim();
  var table = document.getElementById('meetingsTable');
  if(!table) return;
  var rows = table.getElementsByTagName('tr');
  for(var i=1;i<rows.length;i++){
    var txt = rows[i].textContent.toLowerCase();
    rows[i].style.display = (!search || txt.indexOf(search) !== -1) ? '' : 'none';
  }
};
  html += "<table id='meetingsTable'><thead><tr><th>When</th><th>Customer</th><th>Subject</th><th>Status</th><th></th></tr></thead><tbody>";
  var i;
  for(i=0;i<DB.meetings.length;i++){
    var m = DB.meetings[i];
    var overdue = (m.status==='SCHEDULED' && new Date(m.when_ts) < new Date());
    var st = overdue? "<span class='pill' style='background:#fee2e2;color:#991b1b'>EXPIRED</span>" : esc(m.status);
    var doneBtn = (m.status!=='COMPLETED' && m.status!=='CANCELLED') ? ' '+linkBtn('Mark done',"markMeetingDone('"+m.id+"')") : '';
    html += "<tr>"
      + "<td>"+new Date(m.when_ts).toLocaleString()+"</td>"
      + "<td>"+linkBtn(m.customer_id,"openProfile('"+m.customer_id+"')")+"</td>"
      + "<td>"+esc(m.subject)+"</td>"
      + "<td>"+st+"</td>"
      + "<td style='text-align:right'>"+linkBtn('Edit',"editMeeting('"+m.id+"')")+" &nbsp; "+linkBtn('Delete',"deleteMeeting('"+m.id+"')")+doneBtn+"</td>"
      + "</tr>";
  }
  if(!DB.meetings.length){ html += "<tr><td colspan='5' class='muted'>No meetings</td></tr>"; }
  html += "</tbody></table>";
  html += endcard();

  return html;
}

// ---------- Reminders ----------
function editReminder(id){
  var x=null,i;
  for(i=0;i<DB.reminders.length;i++){ if(DB.reminders[i].id===id){ x=DB.reminders[i]; break; } }
  if(!x){ toast('Reminder not found'); return; }
  window.__remForm = JSON.parse(JSON.stringify(x));
  TAB='reminders'; render();
}
function newReminder(){
  window.__remForm = { id:'', customer_id:'', title:'', due_ts:'', notes:'', status:'PENDING' };
  TAB='reminders'; render();
}
function deleteReminder(id){
  if(!confirm('Delete reminder?')) return;
  var out=[], i;
  for(i=0;i<DB.reminders.length;i++){ if(DB.reminders[i].id!==id) out.push(DB.reminders[i]); }
  DB.reminders = out;
  saveDB(DB);
  toast('Reminder deleted');
  render();
}
function sectionReminders(){
  var f = window.__remForm || { id:'', customer_id:'', title:'', due_ts:'', notes:'', status:'PENDING' };

  function submit(){
    try{
  // Always get the latest value from the dropdown
  var sel = document.getElementById('reminderCustomerSelect');
  if(sel) f.customer_id = sel.value;
  // Ensure all entered values are used
  f.title = document.querySelector("input[oninput*=title]").value;
  f.due_ts = document.querySelector("input[type='datetime-local'][oninput*=due_ts]").value;
  f.notes = document.querySelector("input[oninput*=notes]").value;
  var statusSel = document.querySelector("select[onchange*=status]");
  if(statusSel) f.status = statusSel.value;
      if(!f.customer_id || !f.customer_id.trim()){ toast('Customer ID required'); return; }
      var have=false,i; for(i=0;i<DB.customers.length;i++){ if(DB.customers[i].id===f.customer_id.trim()){ have=true; break; } }
      if(!have){ toast('Customer ID not found'); return; }

      var p = {
        customer_id: f.customer_id.trim(),
        title: f.title||'',
        due_ts: f.due_ts||'',
        notes: f.notes||'',
        status: f.status||'PENDING'
      };

      if(f.id){
        var idx=-1; for(i=0;i<DB.reminders.length;i++){ if(DB.reminders[i].id===f.id){ idx=i; break; } }
        if(idx===-1){ toast('Reminder not found'); return; }
        for(var k in p){ DB.reminders[idx][k]=p[k]; }
        toast('Reminder updated');
      } else {
        p.id='REM-'+id6();
        DB.reminders.push(p);
        toast('Reminder created');
      }
      saveDB(DB);
      window.__remForm = { id:'', customer_id:'', title:'', due_ts:'', notes:'', status:'PENDING' };
      render();
    }catch(e){ toast(e.message||String(e)); }
  }
  window.__remSubmit = submit;
  var html = '';

  html += card(f.id?('Edit Reminder ('+esc(f.id)+')'):'Create Reminder', btn('New','btn ghost','onclick="newReminder()"'));
  html += "<div class='grid cols-3'>";

  // Customer ID dropdown + manual input
  var custOpts = DB.customers.map(function(c){
    return "<option value='" + esc(c.id) + "'>" + esc(c.id) + " - " + esc(c.legal_name) + "</option>";
  }).join('');
  html += row('Customer ID',
    "<select id='reminderCustomerSelect' onchange=\"setField('__remForm','customer_id',this.value); window.__remForm.customer_id=this.value;\" style='width:100%'><option value=''>-- Select Customer --</option>"+custOpts+"</select>");
  setTimeout(function(){
    var sel = document.getElementById('reminderCustomerSelect');
    if(sel && window.__remForm && window.__remForm.customer_id) sel.value = window.__remForm.customer_id;
    // Always sync form state after render
    if(sel) sel.onchange = function(){
      setField('__remForm','customer_id',this.value);
      if(window.__remForm) window.__remForm.customer_id=this.value;
    };
  }, 0);

  html += row('Title',
    "<input value='"+esc(f.title)+"' oninput=\"setField('__remForm','title',this.value)\" />");

  html += row('Due',
    "<input type='datetime-local' value='"+esc(f.due_ts)+"' oninput=\"setField('__remForm','due_ts',this.value)\" />");

  html += row('Notes',
    "<input value='"+esc(f.notes)+"' oninput=\"setField('__remForm','notes',this.value)\" />");

  html += row('Status',
    "<select onchange=\"setField('__remForm','status',this.value)\"><option>PENDING</option><option>DONE</option><option>CANCELLED</option></select>");

  html += "</div><div style='margin-top:8px'>"+btn(f.id?'Update':'Create','btn','onclick="__remSubmit()"')+"</div>"+endcard();

  // Table
  html += card('All Reminders',
    "<input id='remindersSearch' type='text' maxlength='20' placeholder='Search Reminders' style='width:220px;padding:5px;font-size:15px;margin-left:12px;' oninput='window.__remindersSearch=this.value.toLowerCase(); window.filterRemindersTable();' value='"+(window.__remindersSearch||"")+"' /> " +
    exportBtns('remindersTable','reminders')
  );
// --- Reminders table filter function ---
window.filterRemindersTable = function(){
  var search = (window.__remindersSearch||'').trim();
  var table = document.getElementById('remindersTable');
  if(!table) return;
  var rows = table.getElementsByTagName('tr');
  for(var i=1;i<rows.length;i++){
    var txt = rows[i].textContent.toLowerCase();
    rows[i].style.display = (!search || txt.indexOf(search) !== -1) ? '' : 'none';
  }
};
  html += "<table id='remindersTable'><thead><tr><th>Due</th><th>Customer</th><th>Title</th><th>Status</th><th></th></tr></thead><tbody>";
  var i;
  for(i=0;i<DB.reminders.length;i++){
    var r = DB.reminders[i];
    var overdue = (r.status==='PENDING' && new Date(r.due_ts) < new Date());
    var st = overdue? "<span class='pill' style='background:#fee2e2;color:#991b1b'>OVERDUE</span>" : esc(r.status);
    var doneBtn = (r.status!=='DONE' && r.status!=='CANCELLED') ? ' '+linkBtn('Mark done',"markReminderDone('"+r.id+"')") : '';
    html += "<tr>"
      + "<td>"+new Date(r.due_ts).toLocaleString()+"</td>"
      + "<td>"+linkBtn(r.customer_id,"openProfile('"+r.customer_id+"')")+"</td>"
      + "<td>"+esc(r.title)+"</td>"
      + "<td>"+st+"</td>"
      + "<td style='text-align:right'>"+linkBtn('Edit',"editReminder('"+r.id+"')")+" &nbsp; "+linkBtn('Delete',"deleteReminder('"+r.id+"')")+doneBtn+"</td>"
      + "</tr>";
  }
  if(!DB.reminders.length){ html += "<tr><td colspan='5' class='muted'>No reminders</td></tr>"; }
  html += "</tbody></table>";
  html += endcard();

  return html;
}

// ---------- Reports ----------
window.__repFilterCid = '';
window.__repSpendCid  = '';

function sectionReports(){
  var filterCid = window.__repFilterCid || '';
  var spendCid  = window.__repSpendCid  || '';

  var sbo = spendByOpp();

  // Spend per opportunity (optionally filtered by Customer ID)
  var spendRows = [];
  var i;
  for(i=0;i<DB.opportunities.length;i++){
    var o=DB.opportunities[i];
    spendRows.push({
      opportunity_id: o.id,
      customer_id: o.customer_id,
      stage: o.stage,
      total_spend: sbo.get(o.id)||0
    });
  }
  if(filterCid && filterCid.trim()){
    var out=[]; for(i=0;i<spendRows.length;i++){ if(spendRows[i].customer_id===filterCid.trim()) out.push(spendRows[i]); }
    spendRows = out;
  }

  // Spend by date for a single customer ID
  var oppIds = [];
  for(i=0;i<DB.opportunities.length;i++){ if(DB.opportunities[i].customer_id===(spendCid||'').trim()){ oppIds.push(DB.opportunities[i].id); } }
  var map = new Map();
  for(i=0;i<DB.expenses.length;i++){
    var e = DB.expenses[i];
    if(oppIds.indexOf(e.opportunity_id)>-1){
      var d = (e.at||'').slice(0,10);
      map.set(d, (map.get(d)||0) + ensureNum(e.amount));
    }
  }
  var rows = []; map.forEach(function(val,key){ rows.push({date:key, amount:val}); });
  rows.sort(function(a,b){ return a.date<b.date ? -1 : (a.date>b.date ? 1 : 0); });
  var total = 0; for(i=0;i<rows.length;i++){ total += rows[i].amount; }

  var html='';
  // Spend per opportunity
  html += card('Pre-sales Spend (filter by Customer ID)', exportBtns('reportsSpendTable','reports_spend'));
  html += row('Customer ID (optional)', "<input value='"+esc(filterCid)+"' placeholder='e.g., MEDH01' oninput=\"window.__repFilterCid=this.value; render();\" />");
  html += "<table id='reportsSpendTable'><thead><tr><th>Opportunity</th><th>Customer</th><th>Stage</th><th>Total Spend</th></tr></thead><tbody>";
  for(i=0;i<spendRows.length;i++){
    var r = spendRows[i];
    html += "<tr><td>"+esc(r.opportunity_id)+"</td><td>"+linkBtn(r.customer_id,"openProfile('"+r.customer_id+"')")+"</td><td>"+esc(r.stage)+"</td><td>"+INR.format(r.total_spend)+"</td></tr>";
  }
  if(!spendRows.length){ html += "<tr><td colspan='4' class='muted'>No spend records</td></tr>"; }
  html += "</tbody></table>";
  html += endcard();

  // Spend by date
  html += card('Customer Spend by Date', exportBtns('reportsSpendByDateTable','spend_by_date'));
  html += "<div style='display:flex;align-items:end;gap:12px'>"
       + row('Customer ID', "<input value='"+esc(spendCid)+"' placeholder='e.g., MEDH01' oninput=\"window.__repSpendCid=this.value; render();\" />")
       + "<div class='muted'>Total: <b>"+INR.format(total)+"</b></div>"
       + "</div>";
  html += "<table id='reportsSpendByDateTable'><thead><tr><th>Date</th><th>Amount</th></tr></thead><tbody>";
  for(i=0;i<rows.length;i++){
    html += "<tr><td>"+esc(rows[i].date)+"</td><td>"+INR.format(rows[i].amount)+"</td></tr>";
  }
  if(!rows.length){ html += "<tr><td colspan='2' class='muted'>No spend for that customer</td></tr>"; }
  html += "</tbody></table>";
  html += endcard();

  // Loss reasons
  var latestLoss = new Map();
  for(i=0;i<DB.statusHistory.length;i++){
    var h = DB.statusHistory[i];
    if(h.stage==='DISAGREED' && h.reason){
      var prev = latestLoss.get(h.opportunity_id);
      if(!prev || new Date(h.at) > new Date(prev.at)){ latestLoss.set(h.opportunity_id, h); }
    }
  }
  var lossRows = [];
  latestLoss.forEach(function(loss,oppId){
    var o=null, j;
    for(j=0;j<DB.opportunities.length;j++){ if(DB.opportunities[j].id===oppId){ o=DB.opportunities[j]; break; } }
    lossRows.push({
      opportunity_id: oppId,
      customer_id: (o && o.customer_id) || '',
      opportunity_title: (o && o.title) || '',
      at: loss.at,
      reason: loss.reason,
      total_spend: sbo.get(oppId)||0
    });
  });
  lossRows.sort(function(a,b){ return new Date(b.at)-new Date(a.at); });

  html += card('Loss Reasons (with Company Spend)', exportBtns('lossReasonsTable','loss_reasons'));
  html += "<table id='lossReasonsTable'><thead><tr><th>When</th><th>Opportunity</th><th>Customer</th><th>Reason</th><th>Spend</th></tr></thead><tbody>";
  for(i=0;i<lossRows.length;i++){
    var lr = lossRows[i];
    html += "<tr>"
         + "<td>"+new Date(lr.at).toLocaleString()+"</td>"
         + "<td>"+esc(lr.opportunity_title)+" <span class='muted mono'>("+lr.opportunity_id+")</span></td>"
         + "<td>"+linkBtn(lr.customer_id,"openProfile('"+lr.customer_id+"')")+"</td>"
         + "<td>"+esc(lr.reason)+"</td>"
         + "<td>"+INR.format(lr.total_spend)+"</td>"
         + "</tr>";
  }
  if(!lossRows.length){ html += "<tr><td colspan='5' class='muted'>No loss reasons recorded</td></tr>"; }
  html += "</tbody></table>";
  html += endcard();

  return html;
}

// ---------- Dashboard ----------
function sectionDashboard(){
  // tiles
  var openOpps=0, disag=0, agreed=0, i;
  for(i=0;i<DB.opportunities.length;i++){
    var st = DB.opportunities[i].stage;
    if(st==='DISAGREED') disag++;
    else if(st==='AGREED') agreed++;
    else openOpps++;
  }
  var quotedAvg=0, count=0;
  for(i=0;i<DB.opportunities.length;i++){
    var v = ensureNum(DB.opportunities[i].proposed_price_per_litre);
    if(v){ quotedAvg+=v; count++; }
  }
  quotedAvg = count? Math.round(quotedAvg/count) : 0;

  var spendSum = 0;
  var sbo = spendByOpp();
  sbo.forEach(function(v){ spendSum += v; });

  var html='';
  // Dashboard search box
  // Only show customers/contracts with at least one AGREED opportunity
  var agreedCustomerIds = new Set();
  var agreedContractIds = new Set();
  for(i=0;i<DB.opportunities.length;i++){
    var o = DB.opportunities[i];
    if(o.stage==='AGREED'){
      if(o.assignment==='CUSTOMER' && o.customer_id) agreedCustomerIds.add(o.customer_id);
      if(o.assignment==='CONTRACT' && o.contract_id) agreedContractIds.add(o.contract_id);
    }
  }
  html += "<div class='grid cols-3'>"
       + card('Customer Profiles')+"<div style='font-size:28px;font-weight:700'>"+agreedCustomerIds.size+"</div>"+endcard()
       + card('Contract Profiles')+"<div style='font-size:28px;font-weight:700'>"+agreedContractIds.size+"</div>"+endcard()
       + card('Open Opportunities')+"<div style='font-size:28px;font-weight:700'>"+openOpps+"</div>"+endcard()
       + card('Disagreed')+"<div style='font-size:28px;font-weight:700'>"+disag+"</div>"+endcard()
       + card('Agreed')+"<div style='font-size:28px;font-weight:700'>"+agreed+"</div>"+endcard()
       + card('Avg Quoted Price (â‚¹/L)')+"<div style='font-size:28px;font-weight:700'>"+quotedAvg+"</div>"+endcard()
       + card('Pre-sales Spend (sum)')+"<div style='font-size:28px;font-weight:700'>"+INR.format(spendSum)+"</div>"+endcard()
       + "</div>";

  // Pipeline table with search box beside title, export buttons right
  html += "<div class='card' style='padding:16px;margin-bottom:32px;'>";
  html += "<div style='display:flex;align-items:center;justify-content:space-between;'>";
  html += "<div style='display:flex;align-items:center;gap:12px;'>";
  html += "<span style='font-weight:600;font-size:20px;'>Pipeline</span>";
  html += "<input id='pipelineSearch' type='text' maxlength='20' placeholder='Search Pipeline' style='width:200px;padding:5px;font-size:15px;margin-left:8px;' oninput='window.__pipelineSearch=this.value.toLowerCase(); filterPipelineTable();' value='"+(window.__pipelineSearch||"")+"' />";
  html += "</div>";
  html += "<div>"+exportBtns('pipelineTable','pipeline')+"</div>";
  html += "</div>";
  html += "</div>";
  html += "<div style='height:18px'></div>";
  var pipelineSearch = (window.__pipelineSearch||'').trim();
  html += "<table id='pipelineTable' style='background:#fff'><thead><tr><th>Opportunity</th><th>Customer</th><th>Stage</th><th>â‚¹/L</th><th>Spend</th></tr></thead><tbody>";
  var shown = 0;
  for(i=0;i<DB.opportunities.length;i++){
    var o = DB.opportunities[i];
    if(o.stage==='AGREED') continue;
    var customer = DB.customers.find(function(c){ return c.id===o.customer_id; });
    var contract = DB.contracts.find(function(c){ return c.id===o.contract_id; });
    var legalName = customer ? customer.legal_name : (contract ? contract.customer_id : '');
    var match = !pipelineSearch ||
      (o.customer_id && o.customer_id.toLowerCase().includes(pipelineSearch)) ||
      (o.contract_id && o.contract_id.toLowerCase().includes(pipelineSearch)) ||
      (legalName && legalName.toLowerCase().includes(pipelineSearch));
    if(!match) continue;
    html += "<tr>"
         + "<td>"+esc(o.title)+"</td>"
         + "<td>"+linkBtn(o.customer_id,"openProfile('"+o.customer_id+"')")+"</td>"
         + "<td>"+esc(o.stage)+"</td>"
         + "<td>"+esc(o.proposed_price_per_litre)+"</td>"
         + "<td>"+INR.format(sbo.get(o.id)||0)+"</td>"
         + "</tr>";
    shown++;
  }
  if(!shown){ html += "<tr><td colspan='5' class='muted'>No opportunities</td></tr>"; }
  html += "</tbody></table>";
  html += endcard();

  // Upcoming meetings with search box beside title, export buttons right
  var now = new Date();
  html += "<div class='card' style='background:#fff;padding:16px;margin-bottom:32px;'>";
  html += "<div style='display:flex;align-items:center;justify-content:space-between;'>";
  html += "<div style='display:flex;align-items:center;gap:12px;'>";
  html += "<span style='font-weight:600;font-size:20px;'>Upcoming Meetings</span>";
  html += "<input id='meetingsSearch' type='text' maxlength='20' placeholder='Search Meetings' style='width:200px;padding:5px;font-size:15px;margin-left:8px;' oninput='window.__meetingsSearch=this.value.toLowerCase(); filterMeetingsTable();' value='"+(window.__meetingsSearch||"")+"' />";
  html += "</div>";
  html += "<div>"+exportBtns('dashMeetingsTable','upcoming_meetings')+"</div>";
  html += "</div>";
  html += "</div>";
  html += "<div style='height:18px'></div>";
  var meetingsSearch = (window.__meetingsSearch||'').trim();
  var up = [];
  for(i=0;i<DB.meetings.length;i++){
    if(DB.meetings[i].status==='SCHEDULED' && new Date(DB.meetings[i].when_ts)>=now){
      var m = DB.meetings[i];
      var customer = DB.customers.find(function(c){ return c.id===m.customer_id; });
      var contract = DB.contracts.find(function(c){ return c.id===m.customer_id; });
      var legalName = customer ? customer.legal_name : (contract ? contract.customer_id : '');
      var match = !meetingsSearch ||
        (m.customer_id && m.customer_id.toLowerCase().includes(meetingsSearch)) ||
        (legalName && legalName.toLowerCase().includes(meetingsSearch)) ||
        (m.contract_id && m.contract_id.toLowerCase().includes(meetingsSearch));
      if(match) up.push(m);
    }
  }
  up.sort(function(a,b){ return new Date(a.when_ts)-new Date(b.when_ts); });
  if(up.length>10) up = up.slice(0,10);

  html += "<table id='dashMeetingsTable' style='background:#fff'><thead><tr><th>When</th><th>Customer</th><th>Subject</th><th>Action</th></tr></thead><tbody>";
  if(up.length){
    for(i=0;i<up.length;i++){
      html += "<tr><td>"+new Date(up[i].when_ts).toLocaleString()+"</td><td>"+linkBtn(up[i].customer_id,"openProfile('"+up[i].customer_id+"')")+"</td><td>"+esc(up[i].subject)+"</td><td>"+linkBtn('Mark done',"markMeetingDone('"+up[i].id+"')")+"</td></tr>";
    }
  } else {
    html += "<tr><td colspan='4' class='muted'>No upcoming meetings</td></tr>";
  }
  html += "</tbody></table>";
  html += endcard();

  // Pending reminders with search box beside title, export buttons right
  html += "<div class='card' style='background:#fff;padding:16px;margin-bottom:32px;'>";
  html += "<div style='display:flex;align-items:center;justify-content:space-between;'>";
  html += "<div style='display:flex;align-items:center;gap:12px;'>";
  html += "<span style='font-weight:600;font-size:20px;'>Pending Reminders</span>";
  html += "<input id='remindersSearch' type='text' maxlength='20' placeholder='Search Reminders' style='width:200px;padding:5px;font-size:15px;margin-left:8px;' oninput='window.__remindersSearch=this.value.toLowerCase(); filterRemindersTable();' value='"+(window.__remindersSearch||"")+"' />";
// --- Dashboard table filter functions ---
window.filterPipelineTable = function(){
  var search = (window.__pipelineSearch||'').trim();
  var table = document.getElementById('pipelineTable');
  if(!table) return;
  var rows = table.getElementsByTagName('tr');
  for(var i=1;i<rows.length;i++){
    var txt = rows[i].textContent.toLowerCase();
    rows[i].style.display = (!search || txt.indexOf(search) !== -1) ? '' : 'none';
  }
};

window.filterMeetingsTable = function(){
  var search = (window.__meetingsSearch||'').trim();
  var table = document.getElementById('dashMeetingsTable');
  if(!table) return;
  var rows = table.getElementsByTagName('tr');
  for(var i=1;i<rows.length;i++){
    var txt = rows[i].textContent.toLowerCase();
    rows[i].style.display = (!search || txt.indexOf(search) !== -1) ? '' : 'none';
  }
};

window.filterRemindersTable = function(){
  var search = (window.__remindersSearch||'').trim();
  var table = document.getElementById('dashRemindersTable');
  if(!table) return;
  var rows = table.getElementsByTagName('tr');
  for(var i=1;i<rows.length;i++){
    var txt = rows[i].textContent.toLowerCase();
    rows[i].style.display = (!search || txt.indexOf(search) !== -1) ? '' : 'none';
  }
};
  html += "</div>";
  html += "<div>"+exportBtns('dashRemindersTable','pending_reminders')+"</div>";
  html += "</div>";
  html += "</div>";
  html += "<div style='height:18px'></div>";
  var remindersSearch = (window.__remindersSearch||'').trim();
  var pend = [];
  for(i=0;i<DB.reminders.length;i++){
    if(DB.reminders[i].status==='PENDING'){
      var r = DB.reminders[i];
      var customer = DB.customers.find(function(c){ return c.id===r.customer_id; });
      var contract = DB.contracts.find(function(c){ return c.id===r.customer_id; });
      var legalName = customer ? customer.legal_name : (contract ? contract.customer_id : '');
      var match = !remindersSearch ||
        (r.customer_id && r.customer_id.toLowerCase().includes(remindersSearch)) ||
        (legalName && legalName.toLowerCase().includes(remindersSearch)) ||
        (r.contract_id && r.contract_id.toLowerCase().includes(remindersSearch));
      if(match) pend.push(r);
    }
  }
  pend.sort(function(a,b){ return new Date(a.due_ts)-new Date(b.due_ts); });
  if(pend.length>10) pend = pend.slice(0,10);

  html += "<table id='dashRemindersTable' style='background:#fff'><thead><tr><th>Due</th><th>Customer</th><th>Title</th><th>Status</th><th>Action</th></tr></thead><tbody>";
  if(pend.length){
    for(i=0;i<pend.length;i++){
      var overdue = new Date(pend[i].due_ts) < now;
      var st = overdue? "<span class='pill' style='background:#fee2e2;color:#991b1b'>OVERDUE</span>" : "<span class='pill'>PENDING</span>";
      html += "<tr><td>"+new Date(pend[i].due_ts).toLocaleString()+"</td><td>"+linkBtn(pend[i].customer_id,"openProfile('"+pend[i].customer_id+"')")+"</td><td>"+esc(pend[i].title)+"</td><td>"+st+"</td><td>"+linkBtn('Mark done',"markReminderDone('"+pend[i].id+"')")+"</td></tr>";
    }
  } else {
    html += "<tr><td colspan='5' class='muted'>No pending reminders</td></tr>";
  }
  html += "</tbody></table>";
  html += endcard();

  return html;
}

// ---------- Settings ----------
function sectionSettings(){
  var html='';
  html += card('Settings');
  html += "<div class='grid cols-2'>";
  html += btn('Seed Clean Demo','btn',"onclick='DB=seed(); render();'")+" <span class='muted'>(reset with demo data)</span>";
  html += btn('Clear All Data','btn',"onclick=\"localStorage.removeItem('"+LS_KEY+"'); DB={customers:[],opportunities:[],statusHistory:[],expenses:[],contracts:[],meetings:[],reminders:[]}; saveDB(DB); render();\"")+" <span class='muted'>(start fresh)</span>";
  html += "</div>";
  html += endcard();
  return html;
}
/* =========================
   Part 4/4: Renderer, tests, boot
   ========================= */

// Main renderer
function render(){
  try{
    renderNav();
    var main = document.getElementById('main');
    if(!main) return;

    var html='';
    if(TAB==='dashboard')      html = sectionDashboard();
    else if(TAB==='customers') html = sectionCustomers();
    else if(TAB==='opportunities') html = sectionOpportunities();
    else if(TAB==='contracts') html = sectionContracts();
    else if(TAB==='meetings')  html = sectionMeetings();
    else if(TAB==='reminders') html = sectionReminders();
    else if(TAB==='reports')   html = sectionReports();
    else if(TAB==='settings')  html = sectionSettings();

    main.innerHTML = html;
    try{ if(document && document.body){ document.body.setAttribute('data-js','rendered'); } }catch(_err){}
  }catch(e){
    console.error(e);
    var main2 = document.getElementById('main');
    if(main2){
      main2.innerHTML = "<div class='card'><h3>Runtime error</h3><div class='muted'>Please share this message:</div><pre class='mono'>"
        + esc((e && (e.stack||e.message)) || String(e))
        + "</pre></div>";
    }
    toast('Runtime error: '+(e && (e.message||String(e))));
  }
}

// Small self-tests (sanity)
(function(){
  function ok(name,cond){ try{ console.log((cond?'âœ…':'âŒ')+' '+name); }catch(_e){} }
  ok('id6 length 6', id6().length===6);
  ok('phone intl valid', validIntlPhone('+91 9876543210'));
  ok('phone intl invalid', !validIntlPhone('+91 123456789'));
  ok('GSTIN sample', validGST('37ABCDE1234F1Z5'));
  ok('email sample', validEmail('a@b.co'));
})();

// Boot
document.addEventListener('DOMContentLoaded', function(){
  try { render(); } catch(e){ console.error('initial render error', e); }
});

// Global guards
window.addEventListener('error', function(ev){
  try{ console.error('window.error', ev.error||ev.message); }catch(_e){}
  var section = tabLabel(TAB);
  var msg = (ev && ev.error && (ev.error.message || ev.error)) || ev.message || 'Unknown script error';
  toast(section+' module error: '+msg);
});
window.addEventListener('unhandledrejection', function(ev){
  try{ console.error('unhandledrejection', ev.reason); }catch(_e){}
  var section = tabLabel(TAB);
  var reason = (ev && ev.reason && (ev.reason.message || ev.reason)) || '';
  var details = reason ? ('Unhandled promise: '+reason) : 'Unhandled promise error';
  toast(section+' module error: '+details);
});






logout