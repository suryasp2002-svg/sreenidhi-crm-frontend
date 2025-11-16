import React, { useEffect, useMemo, useRef, useState } from 'react';

function fmtDateInput(d) {
  const pad = n => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${y}-${m}-${day}`;
}

function formatTimeForInput(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch { return ''; }
}

export default function FuelOps() {
  const token = useMemo(() => {
    try { return localStorage.getItem('authToken'); } catch { return null; }
  }, []);
  const [units, setUnits] = useState([]);
  const [unitId, setUnitId] = useState('');
  const [drivers, setDrivers] = useState([]); // Initialize drivers state
  const [driverRowId, setDriverRowId] = useState('');
  const [datums, setDatums] = useState([]);
  const [loadDate, setLoadDate] = useState(() => fmtDateInput(new Date()));
  const [liters, setLiters] = useState('');
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const [purchaseTime, setPurchaseTime] = useState('');
  const [dailyDate, setDailyDate] = useState(() => fmtDateInput(new Date()));
  const [openKm, setOpenKm] = useState('');
  const [closeKm, setCloseKm] = useState(''); // Initialize closing kilometers state
  const [odoNote, setOdoNote] = useState('');
  const [postingOdo, setPostingOdo] = useState(false);
  const [stockSummary, setStockSummary] = useState({ items: [], generatedAt: null });
  const [stockLoading, setStockLoading] = useState(false);
  const stockInFlight = useRef(false);

  // Load trucks
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
    const r = await fetch('/api/fuel-ops/vehicles?type=TRUCK', { headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
        const data = await safeJson(r);
        if (!aborted) {
          setUnits(data || []);
          if (!unitId && data && data.length) setUnitId(String(data[0].id));
        }
      } catch {
        if (!aborted) setUnits([]);
      }
    })();
    return () => { aborted = true; };
  }, [token]);

  // Load drivers
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const r = await fetch('/api/fuel-ops/drivers', { headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
        const data = await safeJson(r);
        if (!r.ok) throw new Error((data && data.error) || 'Failed to load drivers');
        if (!aborted) {
          const arr = Array.isArray(data) ? data : [];
          setDrivers(arr);
          if (!driverRowId && arr && arr.length) setDriverRowId(String(arr[0].id));
        }
      } catch {
        if (!aborted) setDrivers([]);
      }
    })();
    return () => { aborted = true; };
  }, [token]);

  // Load datum storage units
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const r = await fetch('/api/fuel-ops/vehicles?type=DATUM', { headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
        const data = await safeJson(r);
        if (!aborted) setDatums(Array.isArray(data) ? data : []);
      } catch {
        if (!aborted) setDatums([]);
      }
    })();
    return () => { aborted = true; };
  }, [token]);

  // Load mini stock summary (and expose reload helper so children can trigger refresh)
  async function reloadStockSummary(manual = false) {
    if (stockInFlight.current) return null;
    stockInFlight.current = true;
    if (manual) setStockLoading(true);
    try {
      const r = await fetch('/api/fuel-ops/stock/summary', { headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data.error || 'Failed to load stock summary');
      setStockSummary(data);
      return data;
    } catch (e) {
      setStockSummary({ items: [], generatedAt: null });
      return null;
    } finally {
      stockInFlight.current = false;
      if (manual) setStockLoading(false);
    }
  }

  useEffect(() => {
    let aborted = false;
    (async () => {
      if (aborted) return;
      await reloadStockSummary();
    })();
    return () => { aborted = true; };
  }, [token]);

  // 45s polling for mini dashboard (auto-refresh)
  useEffect(() => {
    const id = setInterval(() => { reloadStockSummary(); }, 45000);
    return () => clearInterval(id);
  }, [token]);

  // Load existing daily odometer readings or suggestions
  useEffect(() => {
    let aborted = false;
    (async () => {
      if (!unitId || !dailyDate) return;
      const auth = token ? { Authorization: 'Bearer ' + token } : {};
      try {
        const r = await fetch(`/api/fuel-ops/day/odometer?truck_id=${unitId}&date=${dailyDate}`, { headers: { ...auth, Accept: 'application/json' } });
        const data = await safeJson(r);
        if (!aborted && data) {
          setOpenKm(String(data.opening_km));
          setCloseKm(String(data.closing_km));
          setOdoNote(data.note || '');
        } else if (!aborted) {
          const s = await fetch(`/api/fuel-ops/opening-suggestion/odometer?truck_id=${unitId}&date=${dailyDate}`, { headers: auth }).then(x=>x.json());
          setOpenKm(s.opening != null ? String(s.opening) : '');
          setCloseKm('');
          setOdoNote('');
        }
      } catch {}
    })();
    return () => { aborted = true; };
  }, [unitId, dailyDate, token]);

  // Preview lot code
  useEffect(() => {
    let aborted = false;
    (async () => {
      setPreview(null); setMessage(null);
      const uid = parseInt(unitId, 10);
      const l = parseInt(liters, 10);
      if (!uid || !loadDate || !l) return;
      try {
        const q = new URLSearchParams({ unit_id: String(uid), load_date: loadDate, loaded_liters: String(l) });
        const r = await fetch('/api/fuel-ops/lot-code?' + q.toString(), { headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
        if (!r.ok) {
          const err = await safeJson(r).catch(()=>({ error: 'Unable to preview' }));
          if (!aborted) setMessage(err.error || 'Unable to preview');
          return;
        }
        const data = await safeJson(r);
        if (!aborted) setPreview(data);
      } catch { if (!aborted) setMessage('Preview failed'); }
    })();
    return () => { aborted = true; };
  }, [unitId, loadDate, liters, token]);

  async function onCreateLot(e) {
    e.preventDefault(); setSubmitting(true); setMessage(null);
    try {
  // Send explicit load_time to backend (falls back to performed_time if omitted server-side)
  const body = { unit_id: parseInt(unitId, 10), load_date: loadDate, loaded_liters: parseInt(liters, 10), load_time: purchaseTime || undefined };
      const r = await fetch('/api/fuel-ops/lots', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
      const data = await safeJson(r);
      if (r.ok) {
        setMessage(`Created lot ${data.lot_code}`);
        setPreview({ lot_code: data.lot_code, seq_index: data.seq_index });
        setLiters('');
        setPurchaseTime('');
      } else {
        setMessage(data.error || 'Create failed');
      }
    } catch { setMessage('Create failed'); }
    finally { setSubmitting(false); }
  }

  return (
    <div style={{ padding: '24px 0' }}>
      <h2 style={{ margin: 0, fontSize: 20 }}>Fuel Ops</h2>
      <div style={{ marginTop: 16 }}>
        <SubTabs
          token={token}
          units={units}
          setUnits={setUnits}
          unitId={unitId}
          setUnitId={setUnitId}
          loadDate={loadDate}
          setLoadDate={setLoadDate}
          liters={liters}
          setLiters={setLiters}
          preview={preview}
          setPreview={setPreview}
          message={message}
          setMessage={setMessage}
          submitting={submitting}
          setSubmitting={setSubmitting}
          refreshStock={reloadStockSummary}
          purchaseTime={purchaseTime}
          setPurchaseTime={setPurchaseTime}
          readingsSection={<ReadingsSection
            token={token}
            units={units}
            unitId={unitId}
            setUnitId={setUnitId}
            drivers={drivers}
            driverRowId={driverRowId}
            setDriverRowId={setDriverRowId}
            dailyDate={dailyDate}
            setDailyDate={setDailyDate}
            openKm={openKm}
            setOpenKm={setOpenKm}
            closeKm={closeKm}
            setCloseKm={setCloseKm}
            odoNote={odoNote}
            setOdoNote={setOdoNote}
            postingOdo={postingOdo}
            setPostingOdo={setPostingOdo}
          />}
          drivers={drivers}
          setDrivers={setDrivers}
          onCreateLot={onCreateLot}
            datums={datums}
            setDatums={setDatums}
        />
      </div>

      {/* Mini stock indicator dashboard (right side fixed) */}
      <div style={{ position:'fixed', right: 16, top: 88, width: 340, maxHeight:'80vh', overflow:'auto', zIndex: 10 }}>
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>Mini stock indicators</div>
            <button className="btn ghost" onClick={() => reloadStockSummary(true)} disabled={stockLoading} style={{ padding:'4px 8px', fontSize:12 }}>
              {stockLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {(stockSummary.items||[]).length === 0 ? (
            <div style={{ color:'#6b7280', fontSize:12 }}>No data</div>
          ) : (
            <>
              <GroupList title="Tankers" items={(stockSummary.items||[]).filter(x=>x.unit_type==='TRUCK')} />
              <div style={{ height: 8 }} />
              <GroupList title="DATUM" items={(stockSummary.items||[]).filter(x=>x.unit_type==='DATUM')} />
            </>
          )}
          {stockSummary.generatedAt && (
            <div style={{ marginTop:8, color:'#9CA3AF', fontSize:11 }}>as of {new Date(stockSummary.generatedAt).toLocaleString()}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function GroupList({ title, items }) {
  if (!items || items.length === 0) return (
    <div>
      <div style={{ fontWeight:600, margin:'6px 0' }}>{title}</div>
      <div style={{ color:'#6b7280', fontSize:12 }}>—</div>
    </div>
  );
  return (
    <div>
      <div style={{ fontWeight:600, margin:'6px 0' }}>{title}</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:6 }}>
        {items.map(it => (
          <React.Fragment key={it.id}>
            <div style={{ display:'flex', flexDirection:'column' }}>
              <div style={{ fontSize:13, fontWeight:600 }}>{it.unit_code}{it.vehicle_number ? ` · ${it.vehicle_number}` : ''}</div>
              {/* Live meter = latest snapshot + all outbound (sales + transfers) since that snapshot.*/}
              <div style={{ fontSize:12, color:'#111' }}>
                Fuel meter: <b>{Number(it.meter_reading_liters||0)}</b> L
                {(() => {
                  try {
                    // For DATUM, show the latest meter snapshot date/time
                    if (it.unit_type === 'DATUM') {
                      const snapAt = it.latest_snapshot_at ? new Date(it.latest_snapshot_at) : null;
                      if (!snapAt) return null;
                      const dateStr = snapAt.toLocaleDateString([], { month:'short', day:'2-digit' });
                      const timeStr = snapAt.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
                      return (
                        <span style={{ marginLeft:6, color:'#6b7280' }}>
                          (latest snapshot at {dateStr} at {timeStr})
                        </span>
                      );
                    }
                    // For TRUCK, prefer last outbound (sale/transfer) if valid; otherwise fall back to snapshot
                    const outAt = it.last_outbound_at ? new Date(it.last_outbound_at) : null;
                    const isValidOutAt = outAt && outAt.getFullYear() > 2000; // guard against 1970 placeholder
                    if (isValidOutAt) {
                      const saleAt = it.last_sale_at ? new Date(it.last_sale_at) : null;
                      const isSale = saleAt && outAt.getTime() === saleAt.getTime();
                      const label = isSale ? 'sale' : 'transfer';
                      return (
                        <span style={{ marginLeft:6, color:'#6b7280' }}>
                          (latest {label} at {outAt.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })})
                        </span>
                      );
                    }
                    const snapAt = it.latest_snapshot_at ? new Date(it.latest_snapshot_at) : null;
                    if (snapAt) {
                      const dateStr = snapAt.toLocaleDateString([], { month:'short', day:'2-digit' });
                      const timeStr = snapAt.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
                      return (
                        <span style={{ marginLeft:6, color:'#6b7280' }}>
                          (latest snapshot at {dateStr} at {timeStr})
                        </span>
                      );
                    }
                    return null;
                  } catch { return null; }
                })()}
              </div>
              <div style={{ fontSize:11, color:'#6b7280' }}>
                Capacity: {it.capacity_liters} L
                {it.vehicle_number ? ` · Vehicle: ${it.vehicle_number}` : ''}
              </div>
              {it.lot_code_initial && (
                <div style={{ fontSize:11, color:'#6b7280' }}>Lot: {it.lot_code_initial}</div>
              )}
            </div>
            <div style={{ textAlign:'right', fontSize:12 }}>
              <div><span style={{ color:'#374151' }}>In-stock:</span> <b>{it.instock_liters}</b> L</div>
              <div><span style={{ color:'#374151' }}>Sale only:</span> <b>{it.sale_only_liters}</b> L</div>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function SubTabs({ token, units, setUnits, unitId, setUnitId, loadDate, setLoadDate, liters, setLiters, preview, setPreview, message, setMessage, submitting, setSubmitting, readingsSection, drivers, setDrivers, onCreateLot, datums, setDatums, refreshStock, purchaseTime, setPurchaseTime }) {
  const [tab, setTab] = useState('Readings');
  return (
    <div>
      <div style={{ display:'flex', gap: 8, marginBottom: 12 }}>
        {['Readings','Fuel Meter Checks','At Depot','Day Logs','Vehicles & Storage Info','Drivers','Purchase','Internal Transfers','Sales'].map(t => (
          <button key={t} className={tab===t?'nav-btn active':'nav-btn'} style={{marginRight:8,background:tab===t?'#111':'#f5f5f5',color:tab===t?'#fff':'#222',border:'none',borderRadius:20,padding:'6px 14px',cursor:'pointer'}} onClick={()=>setTab(t)}>{t}</button>
        ))}
      </div>
      {tab==='Readings' && (<>{readingsSection}</>)}
  {tab==='Fuel Meter Checks' && (<FuelMeterChecksSection token={token} units={[...(units||[]), ...(datums||[])]} />)}
      {tab==='At Depot' && (
        <AtDepotSection
          token={token}
          units={units}
          datums={datums}
          drivers={drivers}
          refreshStock={refreshStock}
        />
      )}
      {tab==='Day Logs' && (
        <DayLogsSection token={token} units={units} refreshStock={refreshStock} drivers={drivers} />
      )}
      {tab==='Vehicles & Storage Info' && (
        <>
          <h3 style={{ margin: '12px 0', fontSize: 16 }}>Create Vehicle</h3>
          <VehicleCreate
            token={token}
            onCreated={(v)=> {
              // Route created unit to the correct list
              if (v && v.unit_type === 'DATUM') setDatums(xs => [...xs, v]);
              else setUnits(xs => [...xs, v]);
            }}
          />
          <div className="card" style={{ padding: 16, marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Vehicles</div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr style={{ textAlign:'left' }}>
                    <th>Code</th><th>Vehicle No</th><th>Capacity (L)</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map(u => (
                    <VehicleRow key={u.id} token={token} unit={u} onUpdated={(nu)=> setUnits(xs=> xs.map(x=>x.id===nu.id? nu : x))} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
              <div className="card" style={{ padding: 16, marginTop: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>DATUMS and other storages</div>
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr style={{ textAlign:'left' }}>
                        <th>Code</th><th>Vehicle No</th><th>Capacity (L)</th><th>Status</th><th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datums.map(u => (
                        <VehicleRow key={u.id} token={token} unit={u} onUpdated={(nu)=> setDatums(xs=> xs.map(x=>x.id===nu.id? nu : x))} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
        </>
      )}
      {tab==='Drivers' && (
        <>
          <h3 style={{ margin: '12px 0', fontSize: 16 }}>Create Driver</h3>
          <DriverCreate token={token} onCreated={(d)=> setDrivers(ds=>[...ds, d])} />
          <DriversList token={token} drivers={drivers} setDrivers={setDrivers} />
        </>
      )}
      {tab==='Purchase' && (
        <>
          <h3 style={{ margin: '0 0 12px 0', fontSize: 16 }}>Lot purchase</h3>
          <PurchaseSection token={token} units={units} unitId={unitId} setUnitId={setUnitId} loadDate={loadDate} setLoadDate={setLoadDate} liters={liters} setLiters={setLiters} preview={preview} setPreview={setPreview} message={message} setMessage={setMessage} submitting={submitting} setSubmitting={setSubmitting} onCreateLot={onCreateLot} refreshStock={refreshStock} datums={datums} purchaseTime={purchaseTime} setPurchaseTime={setPurchaseTime} />
        </>
      )}
      {tab==='Internal Transfers' && (
        <>
          <h3 style={{ margin: '0 0 12px 0', fontSize: 16 }}>Internal transfers</h3>
          <InternalTransferSection token={token} units={units} datums={datums} drivers={drivers} refreshStock={refreshStock} />
        </>
      )}
      {tab==='Sales' && (
        <>
          <h3 style={{ margin: '0 0 12px 0', fontSize: 16 }}>Lot sale records</h3>
          <SaleSection token={token} units={units} datums={datums} drivers={drivers} refreshStock={refreshStock} />
        </>
      )}
    </div>
  );
}

function AtDepotSection({ token, units, datums, drivers, refreshStock }) {
  // Shared selections
  // Allow selecting both TRUCK and DATUM units here (include datums alongside units)
  const [truckId, setTruckId] = useState(() => {
    const first = (units && units[0]) || (datums && datums[0]);
    return first ? String(first.id) : '';
  });
  useEffect(() => {
    if (truckId) return;
    const first = (units && units[0]) || (datums && datums[0]);
    if (first) setTruckId(String(first.id));
  }, [units, datums]);
  const [theDate, setTheDate] = useState(() => fmtDateInput(new Date()));
  const [driverId, setDriverId] = useState(() => (drivers && drivers[0] ? String(drivers[0].id) : ''));
  useEffect(() => { if (!driverId && drivers && drivers[0]) setDriverId(String(drivers[0].id)); }, [drivers]);

  // Collapsible toggles
  const [openInfo, setOpenInfo] = useState(true);
  const [openOpening, setOpenOpening] = useState(true);
  const [openSales, setOpenSales] = useState(true);
  const [openClosing, setOpenClosing] = useState(true);

  // Opening fields (scaffold)
  const [openingLiters, setOpeningLiters] = useState('');
  const [openingAt, setOpeningAt] = useState('');
  const [openingMsg, setOpeningMsg] = useState('');
  const [openingSaved, setOpeningSaved] = useState(false);
  const [openingEditMode, setOpeningEditMode] = useState(false);
  const openingOrig = useRef({ liters: '', at: '' });

  // Sales/Transfers fields (scaffold)
  const [action, setAction] = useState('SALE'); // SALE | TO_TANKER | TO_DATUM
  const [saleVehicle, setSaleVehicle] = useState('');
  const [transferToUnit, setTransferToUnit] = useState('');
  const [volume, setVolume] = useState('');
  const [actionTime, setActionTime] = useState(''); // HH:mm
  const [opsMsg, setOpsMsg] = useState('');
  const [externalTanker, setExternalTanker] = useState('');
  const [testingToUnitId, setTestingToUnitId] = useState('');
  useEffect(()=>{ if (!testingToUnitId && truckId) setTestingToUnitId(String(truckId)); }, [truckId]);

  // Closing fields (scaffold)
  const [closingLiters, setClosingLiters] = useState('');
  const [closingAt, setClosingAt] = useState('');
  const [closingMsg, setClosingMsg] = useState('');
  const [closingSaved, setClosingSaved] = useState(false);
  const [closingEditMode, setClosingEditMode] = useState(false);
  const closingOrig = useRef({ liters: '', at: '' });
  const [savingOpening, setSavingOpening] = useState(false);
  const [savingOps, setSavingOps] = useState(false);
  const [savingClosing, setSavingClosing] = useState(false);
  // Operations list (either whole day or filtered to active trip window)
  const [dayOps, setDayOps] = useState({ loading: false, error: '', remaining_liters: null, totals: null, sales: [], transfers_out: [], transfers_in: [], loads: [] });
  // Trips state
  const [trips, setTrips] = useState([]); // list of trips for truck/date
  const [tripLoading, setTripLoading] = useState(false);
  const [creatingTrip, setCreatingTrip] = useState(false);
  const [activeTripNo, setActiveTripNo] = useState(null); // current selected trip number

  // Keep opening/closing fields in sync with selected trip whenever trips list changes
  useEffect(() => {
    if (activeTripNo == null) return;
    const tripRow = (trips || []).find(t => t.trip_no === activeTripNo);
    if (tripRow) {
      const oL = tripRow.opening_liters != null ? String(tripRow.opening_liters) : '';
      const oT = tripRow.opening_at ? (d=>`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`)(new Date(tripRow.opening_at)) : '';
      const cL = tripRow.closing_liters != null ? String(tripRow.closing_liters) : '';
      const cT = tripRow.closing_at ? (d=>`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`)(new Date(tripRow.closing_at)) : '';
      setOpeningLiters(oL); setOpeningAt(oT);
      setClosingLiters(cL); setClosingAt(cT);
      const openingIsSaved = (tripRow.opening_liters != null && Number(tripRow.opening_liters) !== 0) || (tripRow.opening_at != null);
      const closingIsSaved = (tripRow.closing_liters != null) && !(Number(tripRow.closing_liters) === 0 && !tripRow.closing_at);
      setOpeningSaved(!!openingIsSaved); setClosingSaved(!!closingIsSaved);
      openingOrig.current = { liters: oL, at: oT }; closingOrig.current = { liters: cL, at: cT };
      setOpeningEditMode(false); setClosingEditMode(false);
    }
  }, [trips, activeTripNo]);

  // Load existing day record or opening suggestion
  useEffect(() => {
    let aborted = false;
    (async () => {
      setOpeningMsg(''); setClosingMsg('');
      if (!truckId || !theDate) return;
      const auth = token ? { Authorization: 'Bearer ' + token } : {};
      try {
        // Always load trips first so we can derive opening/closing from selected trip
        try {
          setTripLoading(true);
          const tripsData = await fetch(`/api/fuel-ops/trips?truck_id=${truckId}&date=${theDate}`, { headers: { ...auth, Accept:'application/json' } }).then(safeJson);
          if (!aborted) {
            const arr = tripsData && tripsData.items ? tripsData.items : [];
            // Do not auto-create Trip 1; require explicit user action via + Trip button
            setTrips(arr);
            if (arr.length > 0 && activeTripNo == null) setActiveTripNo(1);
            if (arr.length === 0) setActiveTripNo(null);
          }
        } catch { if (!aborted) { setTrips([]); setActiveTripNo(null); } } finally { if (!aborted) setTripLoading(false); }

        // If a trip is active load trip-scoped operations window; else fallback to whole-day dispenser + ops
        if (activeTripNo != null) {
          const tripRow = (trips||[]).find(t => t.trip_no === activeTripNo);
          if (tripRow) {
            const oL = tripRow.opening_liters != null ? String(tripRow.opening_liters) : '';
            const oT = tripRow.opening_at ? (d=>`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`)(new Date(tripRow.opening_at)) : '';
            const cL = tripRow.closing_liters != null ? String(tripRow.closing_liters) : '';
            const cT = tripRow.closing_at ? (d=>`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`)(new Date(tripRow.closing_at)) : '';
            setOpeningLiters(oL); setOpeningAt(oT);
            setClosingLiters(cL); setClosingAt(cT);
            // Treat an auto-created trip (opening_liters defaults to 0 and no opening_at) as "unsaved"
            // Consider opening saved when a non-null opening_liters is present (even if 0) OR when opening_at exists.
            // Only treat as unsaved when opening_liters is null OR (opening_liters===0 AND no opening_at AND trip just auto-created).
            const openingIsSaved = (tripRow.opening_liters != null && Number(tripRow.opening_liters) !== 0) || (tripRow.opening_at != null);
            const closingIsSaved = (tripRow.closing_liters != null) && !(Number(tripRow.closing_liters) === 0 && !tripRow.closing_at);
            setOpeningSaved(!!openingIsSaved); setClosingSaved(!!closingIsSaved);
            openingOrig.current = { liters: oL, at: oT }; closingOrig.current = { liters: cL, at: cT };
            setOpeningEditMode(false); setClosingEditMode(false);
          } else {
            setOpeningLiters(''); setOpeningAt(''); setClosingLiters(''); setClosingAt('');
            setOpeningSaved(false); setClosingSaved(false);
            openingOrig.current = { liters:'', at:'' }; closingOrig.current = { liters:'', at:'' };
            setOpeningEditMode(false); setClosingEditMode(false);
          }
          // Load per-trip ops window
          try {
            setDayOps(prev => ({ ...prev, loading: true, error: '' }));
            const ops = await fetch(`/api/fuel-ops/ops/trip?truck_id=${truckId}&date=${theDate}&trip_no=${activeTripNo}`, { headers: { ...auth, Accept:'application/json' } }).then(safeJson);
            if (!aborted) setDayOps({ loading:false, error:'', remaining_liters: ops.remaining_liters ?? null, totals: ops.totals || null, sales: ops.sales||[], transfers_out: ops.transfers_out||[], transfers_in: ops.transfers_in||[], loads: ops.loads||[], testing: ops.testing||[] });
          } catch (e) {
            if (!aborted) setDayOps({ loading:false, error: String(e.message||e), remaining_liters:null, totals:null, sales:[], transfers_out:[], transfers_in:[], loads:[], testing:[] });
          }
        } else {
          // Day-level opening suggestion or existing reading
          const r = await fetch(`/api/fuel-ops/day/dispenser?truck_id=${truckId}&date=${theDate}`, { headers: { ...auth, Accept: 'application/json' } });
          const data = await safeJson(r);
          if (aborted) return;
          if (data && data.truck_id) {
            const oL = String(data.opening_liters ?? '');
            const oT = data.opening_at ? (d=>`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`)(new Date(data.opening_at)) : '';
            const cL = String(data.closing_liters ?? '');
            const cT = data.closing_at ? (d=>`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`)(new Date(data.closing_at)) : '';
            setOpeningLiters(oL); setOpeningAt(oT);
            setClosingLiters(cL); setClosingAt(cT);
            setOpeningSaved(oL !== ''); setClosingSaved(cL !== '');
            openingOrig.current = { liters: oL, at: oT }; closingOrig.current = { liters: cL, at: cT };
            setOpeningEditMode(false); setClosingEditMode(false);
          } else {
            // No existing day-level reading; do not auto-fill from AT-DEPOT suggestion anymore.
            setOpeningLiters(''); setOpeningAt(''); setClosingLiters(''); setClosingAt('');
            setOpeningSaved(false); setClosingSaved(false);
            openingOrig.current = { liters:'', at:'' }; closingOrig.current = { liters:'', at:'' };
            setOpeningEditMode(false); setClosingEditMode(false);
          }

          try {
            setDayOps(prev => ({ ...prev, loading: true, error: '' }));
            const ops = await fetch(`/api/fuel-ops/ops/day?truck_id=${truckId}&date=${theDate}`, { headers: { ...auth, Accept:'application/json' } }).then(safeJson);
            if (!aborted) setDayOps({ loading:false, error:'', remaining_liters: ops.remaining_liters ?? null, totals: ops.totals || null, sales: ops.sales||[], transfers_out: ops.transfers_out||[], transfers_in: ops.transfers_in||[], loads: ops.loads||[], testing: ops.testing||[] });
          } catch (e) {
            if (!aborted) setDayOps({ loading:false, error: String(e.message||e), remaining_liters:null, totals:null, sales:[], transfers_out:[], transfers_in:[], loads:[], testing:[] });
          }
        }
      } catch {
        if (!aborted) { setOpeningLiters(''); setOpeningAt(''); setClosingLiters(''); setClosingAt(''); }
      }
    })();
    return () => { aborted = true; };
  }, [truckId, theDate, token, activeTripNo]);

  // Actions wired to backend
  async function saveOpening() {
    if (!truckId || !theDate || openingLiters==='') return;
    setSavingOpening(true); setOpeningMsg('');
    try {
      const headers = { 'Content-Type':'application/json', Accept:'application/json', ...(token?{ Authorization:'Bearer '+token }: {}) };
      const drow = (Array.isArray(drivers)?drivers:[]).find(d => String(d.id)===String(driverId));
      if (activeTripNo != null) {
        // Patch existing trip opening OR create if missing by calling createTrip previously
        const tripRow = (trips||[]).find(t => t.trip_no === activeTripNo);
        if (!tripRow) throw new Error('Trip not found');
        const body = {
          opening_liters: Number(openingLiters),
          opening_at: openingAt ? `${theDate} ${openingAt}:00` : undefined,
          driver_name: drow ? drow.name : undefined,
          driver_code: drow ? drow.driver_id : undefined
        };
        const r = await fetch(`/api/fuel-ops/trips/${tripRow.id}`, { method:'PATCH', headers, body: JSON.stringify(body) });
        const data = await safeJson(r);
        if (!r.ok) throw new Error(data && data.error ? data.error : 'Failed to save trip opening');
        setOpeningMsg('Saved trip opening');
        setOpeningSaved(true);
        openingOrig.current = { liters: String(body.opening_liters ?? openingLiters), at: openingAt || '' };
        setOpeningEditMode(false);
        // Refresh trips list to ensure persisted opening displays on remount/switch
        try {
          const auth2 = token ? { Authorization:'Bearer '+token } : {};
          const tripsData = await fetch(`/api/fuel-ops/trips?truck_id=${truckId}&date=${theDate}`, { headers: { ...auth2, Accept:'application/json' } }).then(safeJson);
          const arr = tripsData && tripsData.items ? tripsData.items : [];
          setTrips(arr);
          // Re-derive current trip state from refreshed data
          const updatedTrip = arr.find(t => t.trip_no === activeTripNo);
          if (updatedTrip) {
            const oL = updatedTrip.opening_liters != null ? String(updatedTrip.opening_liters) : '';
            const oT = updatedTrip.opening_at ? (d=>`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`)(new Date(updatedTrip.opening_at)) : '';
            setOpeningLiters(oL); setOpeningAt(oT);
            openingOrig.current = { liters: oL, at: oT };
          }
        } catch {/* non-critical */}
      } else {
        // Day-level opening (legacy)
        const body = {
          truck_id: parseInt(truckId,10),
          date: theDate,
          opening_liters: Number(openingLiters),
          closing_liters: Number(openingLiters),
          opening_at: openingAt ? `${theDate} ${openingAt}:00` : undefined,
          closing_at: closingAt ? `${theDate} ${closingAt}:00` : undefined,
          driver_name: drow ? drow.name : undefined,
          driver_code: drow ? drow.driver_id : undefined
        };
        const r = await fetch('/api/fuel-ops/day/dispenser', { method:'POST', headers, body: JSON.stringify(body) });
        const data = await safeJson(r);
        if (!r.ok) throw new Error(data && data.error ? data.error : 'Failed to save opening');
        setOpeningMsg('Saved opening');
        setOpeningSaved(true);
        openingOrig.current = { liters: String(body.opening_liters ?? openingLiters), at: openingAt || '' };
        setOpeningEditMode(false);
      }
      // refresh ops list for current context
      try {
        const auth = token ? { Authorization: 'Bearer ' + token } : {};
        if (activeTripNo != null) {
          const ops = await fetch(`/api/fuel-ops/ops/trip?truck_id=${truckId}&date=${theDate}&trip_no=${activeTripNo}`, { headers: { ...auth, Accept:'application/json' } }).then(safeJson);
          setDayOps({ loading:false, error:'', remaining_liters: ops.remaining_liters ?? null, totals: ops.totals || null, sales: ops.sales||[], transfers_out: ops.transfers_out||[], transfers_in: ops.transfers_in||[], loads: ops.loads||[], testing: ops.testing||[] });
        } else {
          const ops = await fetch(`/api/fuel-ops/ops/day?truck_id=${truckId}&date=${theDate}`, { headers: { ...auth, Accept:'application/json' } }).then(safeJson);
          setDayOps({ loading:false, error:'', remaining_liters: ops.remaining_liters ?? null, totals: ops.totals || null, sales: ops.sales||[], transfers_out: ops.transfers_out||[], transfers_in: ops.transfers_in||[], loads: ops.loads||[], testing: ops.testing||[] });
        }
      } catch {}
    } catch (e) { setOpeningMsg(String(e.message||e)); }
    finally { setSavingOpening(false); }
  }

  async function createTrip() {
    if (!truckId || !theDate) return;
    setCreatingTrip(true);
    try {
      const headers = { 'Content-Type':'application/json', Accept:'application/json', ...(token?{ Authorization:'Bearer '+token }: {}) };
      // For a brand-new trip we do NOT carry over previous opening values
      const body = { truck_id: parseInt(truckId,10), date: theDate };
      const r = await fetch('/api/fuel-ops/trips', { method:'POST', headers, body: JSON.stringify(body) });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data.error || 'Failed to create trip');
      // reload trips
      try {
        const auth = token ? { Authorization: 'Bearer ' + token } : {};
        const tripsData = await fetch(`/api/fuel-ops/trips?truck_id=${truckId}&date=${theDate}`, { headers: { ...auth, Accept:'application/json' } }).then(safeJson);
        const arr = tripsData && tripsData.items ? tripsData.items : [];
        setTrips(arr);
        setActiveTripNo(data.trip_no);
        // Clear form fields for new trip set and mark readings as not yet saved
        setOpeningLiters(''); setOpeningAt(''); setClosingLiters(''); setClosingAt('');
        setOpeningSaved(false); setClosingSaved(false);
        setOpeningEditMode(false); setClosingEditMode(false);
        setSaleVehicle(''); setTransferToUnit(''); setVolume(''); setActionTime('');
        setDayOps({ loading:false, error:'', remaining_liters:null, totals:null, sales:[], transfers_out:[], transfers_in:[], loads:[], testing:[] });
      } catch {}
    } catch (e) { alert(String(e.message||e)); }
    finally { setCreatingTrip(false); }
  }

  async function saveSaleOrTransfer() {
    if (!truckId || !theDate || !volume) return;
    setSavingOps(true); setOpsMsg('');
    try {
      const headers = { 'Content-Type':'application/json', Accept:'application/json', ...(token?{ Authorization:'Bearer '+token }: {}) };
      // Derive a default time anchored to the current trip's opening time if user leaves time blank
      let effectiveTime = actionTime;
      if (!effectiveTime && activeTripNo != null) {
        const tripRow = (trips||[]).find(t => t.trip_no === activeTripNo);
        if (tripRow && tripRow.opening_at) {
          const d = new Date(tripRow.opening_at);
          effectiveTime = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        }
      }
      let endpoint = '/api/fuel-ops/lots/activity';
      let method = 'POST';
      let payload = null;
      // Find selected driver
      const drow = (Array.isArray(drivers)?drivers:[]).find(d => String(d.id)===String(driverId));
      if (action === 'SALE') {
        payload = {
          activity: 'TANKER_TO_VEHICLE',
          from_unit_id: parseInt(truckId,10),
          to_vehicle: saleVehicle,
          volume_liters: parseInt(volume,10),
          sale_date: theDate,
          performed_time: effectiveTime || undefined,
          trip: (activeTripNo != null ? parseInt(activeTripNo,10) : undefined),
          driver_id: drow ? parseInt(drow.id,10) : undefined,
          driver_name: drow ? drow.name : undefined
        };
      } else if (action === 'TO_TANKER') {
        payload = {
          activity: 'TANKER_TO_TANKER',
          from_unit_id: parseInt(truckId,10),
          to_unit_id: parseInt(transferToUnit,10),
          volume_liters: parseInt(volume,10),
          transfer_date: theDate,
          performed_time: effectiveTime || undefined,
          driver_id: drow ? parseInt(drow.id,10) : undefined,
          driver_name: drow ? drow.name : undefined
        };
      } else if (action === 'TO_DATUM') {
        payload = {
          activity: 'TANKER_TO_DATUM',
          from_unit_id: parseInt(truckId,10),
          to_unit_id: parseInt(transferToUnit,10),
          volume_liters: parseInt(volume,10),
          transfer_date: theDate,
          performed_time: effectiveTime || undefined,
          driver_id: drow ? parseInt(drow.id,10) : undefined,
          driver_name: drow ? drow.name : undefined
        };
      } else if (action === 'TESTING') {
        // Allow testing to be logged as net-zero (back to same tanker) OR as an internal transfer
        const toId = testingToUnitId ? parseInt(testingToUnitId,10) : null;
        const fromIdInt = parseInt(truckId,10);
          if (toId && toId !== fromIdInt) {
          // find unit to determine if DATUM or TRUCK
          const allUnits = [ ...(units||[]), ...(datums||[]) ];
          const dest = allUnits.find(u => Number(u.id) === Number(toId));
          const actType = dest && dest.unit_type === 'DATUM' ? 'TANKER_TO_DATUM' : 'TANKER_TO_TANKER';
          payload = {
            activity: actType,
            from_unit_id: fromIdInt,
            to_unit_id: toId,
            volume_liters: parseInt(volume,10),
            transfer_date: theDate,
            performed_time: effectiveTime || undefined,
            driver_id: drow ? parseInt(drow.id,10) : undefined,
            driver_name: drow ? drow.name : undefined
            , trip: (activeTripNo != null ? parseInt(activeTripNo,10) : undefined)
          };
        } else {
          // testing filled back to same tanker — record as TESTING activity (net-zero)
          // include to_vehicle label for clarity in the table
          const unitRow = (units||[]).find(u => String(u.id)===String(truckId));
          const toVehicleLabel = unitRow ? unitRow.unit_code : undefined;
          payload = {
            activity: 'TESTING',
            from_unit_id: parseInt(truckId,10),
            to_vehicle: toVehicleLabel,
            volume_liters: parseInt(volume,10),
            transfer_date: theDate,
            performed_time: effectiveTime || undefined,
            driver_id: drow ? parseInt(drow.id,10) : undefined,
            driver_name: drow ? drow.name : undefined
            , trip: (activeTripNo != null ? parseInt(activeTripNo,10) : undefined)
          };
        }
      }
      const r = await fetch(endpoint, { method, headers, body: JSON.stringify(payload) });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data && data.error ? data.error : 'Failed to save');
      setOpsMsg('Saved');
  setSaleVehicle(''); setTransferToUnit(''); setVolume(''); setActionTime('');
      try { if (typeof refreshStock==='function') await refreshStock(); } catch {}
      // refresh ops
      try {
        const auth = token ? { Authorization: 'Bearer ' + token } : {};
        if (activeTripNo != null) {
          const ops = await fetch(`/api/fuel-ops/ops/trip?truck_id=${truckId}&date=${theDate}&trip_no=${activeTripNo}`, { headers: { ...auth, Accept:'application/json' } }).then(safeJson);
          setDayOps({ loading:false, error:'', remaining_liters: ops.remaining_liters ?? null, totals: ops.totals || null, sales: ops.sales||[], transfers_out: ops.transfers_out||[], transfers_in: ops.transfers_in||[], loads: ops.loads||[], testing: ops.testing||[] });
        } else {
          const ops = await fetch(`/api/fuel-ops/ops/day?truck_id=${truckId}&date=${theDate}`, { headers: { ...auth, Accept:'application/json' } }).then(safeJson);
          setDayOps({ loading:false, error:'', remaining_liters: ops.remaining_liters ?? null, totals: ops.totals || null, sales: ops.sales||[], transfers_out: ops.transfers_out||[], transfers_in: ops.transfers_in||[], loads: ops.loads||[], testing: ops.testing||[] });
        }
      } catch {}
    } catch (e) { setOpsMsg(String(e.message||e)); }
    finally { setSavingOps(false); }
  }

  // (Removed LOADED-specific override helper — LOADED action removed from UI.)

  async function saveClosing() {
    if (!truckId || !theDate || closingLiters==='') return;
    setSavingClosing(true); setClosingMsg('');
    try {
      const headers = { 'Content-Type':'application/json', Accept:'application/json', ...(token?{ Authorization:'Bearer '+token }: {}) };
      if (activeTripNo != null) {
        const tripRow = (trips||[]).find(t => t.trip_no === activeTripNo);
        if (!tripRow) throw new Error('Trip not found');
        const body = { closing_liters: Number(closingLiters), closing_at: closingAt ? `${theDate} ${closingAt}:00` : undefined };
        const r = await fetch(`/api/fuel-ops/trips/${tripRow.id}`, { method:'PATCH', headers, body: JSON.stringify(body) });
        const data = await safeJson(r);
        if (!r.ok) throw new Error(data && data.error ? data.error : 'Failed to save trip closing');
        setClosingMsg('Saved trip closing');
        setClosingSaved(true);
        closingOrig.current = { liters: String(body.closing_liters ?? closingLiters), at: closingAt || '' };
        setClosingEditMode(false);
      } else {
        const body = { truck_id: parseInt(truckId,10), date: theDate, closing_liters: Number(closingLiters), closing_at: closingAt ? `${theDate} ${closingAt}:00` : undefined };
        const r = await fetch('/api/fuel-ops/day/dispenser', { method:'PATCH', headers, body: JSON.stringify(body) });
        const data = await safeJson(r);
        if (!r.ok) throw new Error(data && data.error ? data.error : 'Failed to save closing');
        setClosingMsg('Saved closing');
        setClosingSaved(true);
        closingOrig.current = { liters: String(body.closing_liters ?? closingLiters), at: closingAt || '' };
        setClosingEditMode(false);
      }
      // refresh ops context
      try {
        const auth = token ? { Authorization: 'Bearer ' + token } : {};
        if (activeTripNo != null) {
          const ops = await fetch(`/api/fuel-ops/ops/trip?truck_id=${truckId}&date=${theDate}&trip_no=${activeTripNo}`, { headers: { ...auth, Accept:'application/json' } }).then(safeJson);
          setDayOps({ loading:false, error:'', remaining_liters: ops.remaining_liters ?? null, totals: ops.totals || null, sales: ops.sales||[], transfers_out: ops.transfers_out||[], transfers_in: ops.transfers_in||[], loads: ops.loads||[], testing: ops.testing||[] });
        } else {
          const ops = await fetch(`/api/fuel-ops/ops/day?truck_id=${truckId}&date=${theDate}`, { headers: { ...auth, Accept:'application/json' } }).then(safeJson);
          setDayOps({ loading:false, error:'', remaining_liters: ops.remaining_liters ?? null, totals: ops.totals || null, sales: ops.sales||[], transfers_out: ops.transfers_out||[], transfers_in: ops.transfers_in||[], loads: ops.loads||[], testing: ops.testing||[] });
        }
      } catch {}
    } catch (e) { setClosingMsg(String(e.message||e)); }
    finally { setSavingClosing(false); }
  }

  return (
    <div>
      {/* Info */}
      <div className="card" style={{ padding: 16, maxWidth: 980 }}>
        <button className="btn ghost" onClick={()=>setOpenInfo(v=>!v)} style={{ float:'right', padding:'4px 8px', fontSize:12 }}>{openInfo?'Hide':'Show'}</button>
        <div style={{ fontWeight:600, marginBottom: 8 }}>Info</div>
        {openInfo && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap: 12 }}>
            <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
              Truck / Storage Unit
              <select value={truckId} onChange={e=>setTruckId(e.target.value)} style={{ padding:8 }}>
                {([...(units||[]), ...(datums||[])]).map(u => (
                  <option key={u.id} value={u.id}>{u.unit_code}{u.vehicle_number?` · ${u.vehicle_number}` : ''}{u.unit_type ? ` · ${u.unit_type}` : ''}</option>
                ))}
              </select>
            </label>
            <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
              Date
              <input type="date" value={theDate} onChange={e=>setTheDate(e.target.value)} style={{ padding:8 }} />
            </label>
            <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
              Driver
              <select value={driverId} onChange={e=>setDriverId(e.target.value)} style={{ padding:8 }}>
                {(Array.isArray(drivers)?drivers:[]).map(d => (<option key={d.id} value={d.id}>{d.driver_id} · {d.name}</option>))}
              </select>
            </label>
          </div>
        )}
        {/* Trips list and create */}
        <div style={{ marginTop:12 }}>
          <div style={{ fontSize:12, fontWeight:600, marginBottom:4 }}>Trips (today)</div>
          {tripLoading ? (<div style={{ fontSize:12, color:'#6b7280' }}>Loading trips…</div>) : (
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {(trips||[]).map(t => (
                  <button key={t.id} className="nav-btn" style={{background: activeTripNo===t.trip_no?'#1f2937':'#e5e7eb',color: activeTripNo===t.trip_no?'#fff':'#111',border:'none',borderRadius:16,padding:'4px 10px',fontSize:11,cursor:'pointer'}} onClick={()=>{
                    setActiveTripNo(t.trip_no);
                    // Reset action form fields when switching context
                    setSaleVehicle(''); setTransferToUnit(''); setVolume(''); setActionTime('');
                  }}>Trip {t.trip_no}</button>
                ))}
                <button className="nav-btn" style={{background:'#10b981',color:'#fff',border:'none',borderRadius:16,padding:'4px 10px',fontSize:11,cursor:'pointer'}} disabled={creatingTrip} onClick={async()=>{
                  const nextNo = (trips.length||0)+1;
                  const ok = window.confirm(`Create Trip ${nextNo} for this truck and date?`);
                  if (!ok) return;
                  await createTrip();
                }}>{creatingTrip? 'Creating…' : `+ Trip ${(trips.length||0)+1}`}</button>
              </div>
              {activeTripNo!=null && trips.length>0 && (
                <button className="nav-btn" style={{background:'#ef4444',color:'#fff',border:'none',borderRadius:16,padding:'4px 10px',fontSize:11,cursor:'pointer'}} onClick={async()=>{
                  try {
                    const trow = (trips||[]).find(t=>t.trip_no===activeTripNo);
                    if (!trow) return;
                    const ok = window.confirm(`Delete Trip ${trow.trip_no}? Only the last trip of the day can be deleted.`);
                    if (!ok) return;
                    const headers = { Accept:'application/json' };
                    const auth = token ? { Authorization:'Bearer '+token } : {};
                    const r = await fetch(`/api/fuel-ops/trips/${trow.id}`, { method:'DELETE', headers:{ ...headers, ...auth } });
                    const j = await safeJson(r);
                    if (!r.ok) { alert(j.error || 'Delete failed'); return; }
                    // Reload trips and reset selection to the new last trip (if any)
                    const auth2 = token ? { Authorization:'Bearer '+token } : {};
                    const tripsData = await fetch(`/api/fuel-ops/trips?truck_id=${truckId}&date=${theDate}`, { headers:{ ...auth2, Accept:'application/json' } }).then(safeJson);
                    const arr = tripsData && tripsData.items ? tripsData.items : [];
                    setTrips(arr);
                    if (arr.length) setActiveTripNo(arr[arr.length-1].trip_no); else setActiveTripNo(null);
                    // Clear forms and ops
                    setOpeningLiters(''); setOpeningAt(''); setClosingLiters(''); setClosingAt('');
                    setSaleVehicle(''); setTransferToUnit(''); setVolume(''); setActionTime('');
                    setDayOps({ loading:false, error:'', remaining_liters:null, totals:null, sales:[], transfers_out:[], transfers_in:[], loads:[], testing:[] });
                  } catch (e) { alert(String(e.message||e)); }
                }}>Delete Trip</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Opening */}
      <div className="card" style={{ padding: 16, marginTop: 12, maxWidth: 980 }}>
        <button className="btn ghost" onClick={()=>setOpenOpening(v=>!v)} style={{ float:'right', padding:'4px 8px', fontSize:12 }}>{openOpening?'Hide':'Show'}</button>
        <div style={{ fontWeight:600, marginBottom: 8 }}>Opening reading</div>
        {openOpening && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap: 12 }}>
            <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
              Opening (L)
              <input type="number" min={0} step={0.001} value={openingLiters} onChange={e=>setOpeningLiters(e.target.value)} style={{ padding:8 }} disabled={openingSaved && !openingEditMode} />
            </label>
            <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
              Time
              <input type="time" value={openingAt} onChange={e=>setOpeningAt(e.target.value)} style={{ padding:8 }} disabled={openingSaved && !openingEditMode} />
            </label>
            <div style={{ display:'flex', alignItems:'flex-end' }}>
              {!openingSaved && !openingEditMode && (
                <button className="btn" onClick={saveOpening} disabled={savingOpening || !truckId || !theDate || openingLiters===''}>{savingOpening? 'Saving…':'Save Opening'}</button>
              )}
              {openingSaved && !openingEditMode && (
                <div style={{ display:'flex', gap:8 }}>
                  <button className="btn" disabled>Saved</button>
                  <button className="btn ghost" onClick={()=>{ setOpeningEditMode(true); setOpeningMsg(''); }}>{'Edit'}</button>
                </div>
              )}
              {openingEditMode && (
                <div style={{ display:'flex', gap:8 }}>
                  <button className="btn" onClick={saveOpening} disabled={savingOpening || !truckId || !theDate || openingLiters===''}>{savingOpening? 'Saving…':'Submit Edit'}</button>
                  <button className="btn ghost" onClick={()=>{ setOpeningEditMode(false); setOpeningMsg(''); setOpeningLiters(openingOrig.current.liters); setOpeningAt(openingOrig.current.at); }}>{'Cancel'}</button>
                </div>
              )}
            </div>
            <div style={{ display:'flex', alignItems:'flex-end', color: openingMsg.startsWith('Saved')?'#065f46':'#b91c1c' }}>{openingMsg}</div>
          </div>
        )}
      </div>

      {/* Sales & Transfers */}
      <div className="card" style={{ padding: 16, marginTop: 12, maxWidth: 980 }}>
        <button className="btn ghost" onClick={()=>setOpenSales(v=>!v)} style={{ float:'right', padding:'4px 8px', fontSize:12 }}>{openSales?'Hide':'Show'}</button>
        <div style={{ fontWeight:600, marginBottom: 8 }}>Sales & Transfers</div>
        {openSales && (
          <div>
            {/* Remaining */}
            <div style={{ margin:'6px 0 12px 0', fontSize: 12, color:'#374151' }}>
              Remaining today: <b>{dayOps.remaining_liters == null ? '-' : dayOps.remaining_liters}</b> L
              {dayOps.totals && (
                <span style={{ marginLeft:8, color:'#6b7280' }}>
                  · Sold: {dayOps.totals.sales_liters} L · Xfer Out: {dayOps.totals.transfers_out_liters} L · Xfer In: {dayOps.totals.transfers_in_liters} L · Loaded: {dayOps.totals.loaded_liters} L · Testing: {dayOps.totals.testing_liters || 0} L
                </span>
              )}
            </div>
            {/* Loads list moved here (exclude from timeline) */}
            <div style={{ margin:'4px 0 12px 0' }}>
              <div style={{ fontSize:12, fontWeight:600, marginBottom:4 }}>Loads (today)</div>
              {(dayOps.loads||[]).length === 0 ? (
                <div style={{ fontSize:12, color:'#6b7280' }}>No loads</div>
              ) : (
                <div style={{ fontSize:12 }}>
                  {(dayOps.loads||[]).map(l => (
                    <div key={l.id} style={{ padding:'2px 0', borderBottom:'1px solid #eee' }}>
                      Lot {l.lot_code_initial} · {l.loaded_liters} L · Type {l.load_type||'-'} · {(() => {
                        const ts = l.load_time || l.created_at || l.load_date;
                        try { return ts ? new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '-'; } catch { return '-'; }
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Day operations list (chronological) */}
            <div style={{ marginTop:16 }}>
              <div style={{ fontWeight:600, marginBottom:8 }}>Today’s operations</div>
              {dayOps.loading ? (
                <div style={{ color:'#6b7280', fontSize:12 }}>Loading…</div>
              ) : dayOps.error ? (
                <div style={{ color:'#b91c1c' }}>{dayOps.error}</div>
              ) : (
                <Timeline
                  token={token}
                  dayOps={dayOps}
                  units={units}
                  datums={datums}
                  onChanged={async()=>{
                    try {
                      const auth = token ? { Authorization:'Bearer '+token } : {};
                      let ops;
                      if (activeTripNo != null) {
                        ops = await fetch(`/api/fuel-ops/ops/trip?truck_id=${truckId}&date=${theDate}&trip_no=${activeTripNo}`, { headers:{ ...auth, Accept:'application/json' } }).then(safeJson);
                      } else {
                        ops = await fetch(`/api/fuel-ops/ops/day?truck_id=${truckId}&date=${theDate}`, { headers:{ ...auth, Accept:'application/json' } }).then(safeJson);
                      }
                      setDayOps({ loading:false, error:'', remaining_liters: ops.remaining_liters ?? null, totals: ops.totals || null, sales: ops.sales||[], transfers_out: ops.transfers_out||[], transfers_in: ops.transfers_in||[], loads: ops.loads||[], testing: ops.testing||[] });
                      try { if (typeof refreshStock==='function') await refreshStock(); } catch {}
                    } catch {}
                  }}
                />
              )}
            </div>

            {/* Action forms moved to bottom */}
            <div style={{ marginTop:20, paddingTop:12, borderTop:'1px solid #eee' }}>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
                <button className={action==='SALE'?'nav-btn active':'nav-btn'} style={{background:action==='SALE'?'#1f2937':'#e5e7eb',color:action==='SALE'?'#fff':'#111',border:'none',borderRadius:18,padding:'6px 12px',cursor:'pointer', fontSize:12}} onClick={()=>setAction('SALE')}>+ Sale</button>
                <button className={action==='TO_TANKER'?'nav-btn active':'nav-btn'} style={{background:action==='TO_TANKER'?'#1f2937':'#e5e7eb',color:action==='TO_TANKER'?'#fff':'#111',border:'none',borderRadius:18,padding:'6px 12px',cursor:'pointer', fontSize:12}} onClick={()=>setAction('TO_TANKER')}>To tanker</button>
                <button className={action==='TO_DATUM'?'nav-btn active':'nav-btn'} style={{background:action==='TO_DATUM'?'#1f2937':'#e5e7eb',color:action==='TO_DATUM'?'#fff':'#111',border:'none',borderRadius:18,padding:'6px 12px',cursor:'pointer', fontSize:12}} onClick={()=>setAction('TO_DATUM')}>To datum</button>
                <button className={action==='TESTING'?'nav-btn active':'nav-btn'} style={{background:action==='TESTING'?'#1f2937':'#e5e7eb',color:action==='TESTING'?'#fff':'#111',border:'none',borderRadius:18,padding:'6px 12px',cursor:'pointer', fontSize:12}} onClick={()=>setAction('TESTING')}>Testing</button>
              </div>
              {/* Action forms */}
              {action==='SALE' && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:12 }}>
                  <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
                    To Vehicle
                    <input value={saleVehicle} onChange={e=>setSaleVehicle(e.target.value)} placeholder="e.g., AP09 AB 1234" style={{ padding:8 }} />
                  </label>
                  <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
                    Volume (L)
                    <input type="number" min={1} step={1} value={volume} onChange={e=>setVolume(e.target.value)} style={{ padding:8 }} />
                  </label>
                  <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
                    Time
                    <input type="time" value={actionTime} onChange={e=>setActionTime(e.target.value)} style={{ padding:8 }} />
                  </label>
                  <div style={{ display:'flex', alignItems:'flex-end' }}>
                    <button className="btn" onClick={saveSaleOrTransfer} disabled={savingOps || !truckId || !theDate || !saleVehicle || !volume || (dayOps.remaining_liters!=null && parseInt(volume,10)>parseInt(dayOps.remaining_liters,10))}>{savingOps? 'Saving…':'Save Sale'}</button>
                  </div>
                </div>
              )}
              {action==='TO_TANKER' && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:12 }}>
                  <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
                    To Tanker
                    <select value={transferToUnit} onChange={e=>setTransferToUnit(e.target.value)} style={{ padding:8 }}>
                      <option value="">Select</option>
                      {(units||[]).filter(u => String(u.id)!==String(truckId)).map(u => (<option key={u.id} value={u.id}>{u.unit_code}{u.vehicle_number?` · ${u.vehicle_number}`:''}</option>))}
                    </select>
                  </label>
                  <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
                    Volume (L)
                    <input type="number" min={1} step={1} value={volume} onChange={e=>setVolume(e.target.value)} style={{ padding:8 }} />
                  </label>
                  <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
                    Time
                    <input type="time" value={actionTime} onChange={e=>setActionTime(e.target.value)} style={{ padding:8 }} />
                  </label>
                  <div style={{ display:'flex', alignItems:'flex-end' }}>
                    <button className="btn" onClick={saveSaleOrTransfer} disabled={savingOps || !truckId || !theDate || !transferToUnit || !volume || (dayOps.remaining_liters!=null && parseInt(volume,10)>parseInt(dayOps.remaining_liters,10))}>{savingOps? 'Saving…':'Save Transfer'}</button>
                  </div>
                </div>
              )}
              {action==='TO_DATUM' && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:12 }}>
                  <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
                    To Datum
                    <select value={transferToUnit} onChange={e=>setTransferToUnit(e.target.value)} style={{ padding:8 }}>
                      <option value="">Select</option>
                      {(datums||[]).map(d => (<option key={d.id} value={d.id}>{d.unit_code}{d.vehicle_number?` · ${d.vehicle_number}`:''}</option>))}
                    </select>
                  </label>
                  <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
                    Volume (L)
                    <input type="number" min={1} step={1} value={volume} onChange={e=>setVolume(e.target.value)} style={{ padding:8 }} />
                  </label>
                  <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
                    Time
                    <input type="time" value={actionTime} onChange={e=>setActionTime(e.target.value)} style={{ padding:8 }} />
                  </label>
                  <div style={{ display:'flex', alignItems:'flex-end' }}>
                    <button className="btn" onClick={saveSaleOrTransfer} disabled={savingOps || !truckId || !theDate || !transferToUnit || !volume || (dayOps.remaining_liters!=null && parseInt(volume,10)>parseInt(dayOps.remaining_liters,10))}>{savingOps? 'Saving…':'Save Transfer'}</button>
                  </div>
                </div>
              )}
              {/* LOADED action removed */}
              {action==='TESTING' && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:12 }}>
                  <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
                    Testing filled back to
                    <select value={testingToUnitId} onChange={e=>setTestingToUnitId(e.target.value)} style={{ padding:8 }}>
                      {/* Prefer same tanker first */}
                      {( (units||[]).filter(u => String(u.id)===String(truckId)) ).map(u => (
                        <option key={`self-${u.id}`} value={u.id}>{u.unit_code}{u.vehicle_number?` · ${u.vehicle_number}`:''} (Same)</option>
                      ))}
                      {/* Other trucks */}
                      {(units||[]).filter(u => String(u.id)!==String(truckId)).map(u => (
                        <option key={`truck-${u.id}`} value={u.id}>{u.unit_code}{u.vehicle_number?` · ${u.vehicle_number}`:''}</option>
                      ))}
                      {/* Datums / storage units */}
                      {(datums||[]).map(d => (
                        <option key={`datum-${d.id}`} value={d.id}>{d.unit_code}{d.vehicle_number?` · ${d.vehicle_number}`:''} · DATUM</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
                    Volume (L)
                    <input type="number" min={1} step={1} value={volume} onChange={e=>setVolume(e.target.value)} style={{ padding:8 }} />
                  </label>
                  <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
                    Time
                    <input type="time" value={actionTime} onChange={e=>setActionTime(e.target.value)} style={{ padding:8 }} />
                  </label>
                  <div style={{ display:'flex', alignItems:'flex-end' }}>
                    <button className="btn" onClick={saveSaleOrTransfer} disabled={savingOps || !truckId || !theDate || !volume || (dayOps.remaining_liters!=null && parseInt(volume,10)>parseInt(dayOps.remaining_liters,10))}>{savingOps? 'Saving…':'Log Test'}</button>
                  </div>
                </div>
              )}
              {opsMsg && (<div style={{ marginTop:8, color: opsMsg.startsWith('Saved')?'#065f46':'#b91c1c' }}>{opsMsg}</div>)}
            </div>
          </div>
        )}
      </div>

      {/* Closing */}
      <div className="card" style={{ padding: 16, marginTop: 12, maxWidth: 980 }}>
        <button className="btn ghost" onClick={()=>setOpenClosing(v=>!v)} style={{ float:'right', padding:'4px 8px', fontSize:12 }}>{openClosing?'Hide':'Show'}</button>
        <div style={{ fontWeight:600, marginBottom: 8 }}>Closing reading</div>
        {openClosing && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap: 12 }}>
            <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
              Closing (L)
              <input type="number" min={0} step={0.001} value={closingLiters} onChange={e=>setClosingLiters(e.target.value)} style={{ padding:8 }} disabled={closingSaved && !closingEditMode} />
            </label>
            <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
              Time
              <input type="time" value={closingAt} onChange={e=>setClosingAt(e.target.value)} style={{ padding:8 }} disabled={closingSaved && !closingEditMode} />
            </label>
            <div style={{ display:'flex', alignItems:'flex-end' }}>
              {!closingSaved && !closingEditMode && (
                <button className="btn" onClick={async()=>{
                  const o = parseFloat(openingLiters);
                  const c = parseFloat(closingLiters);
                  if (!isNaN(o) && !isNaN(c) && c < o) { alert('Closing must be greater than or equal to opening'); return; }
                  await saveClosing();
                }} disabled={savingClosing || !truckId || !theDate || closingLiters===''}>{savingClosing? 'Saving…':'Save Closing'}</button>
              )}
              {closingSaved && !closingEditMode && (
                <div style={{ display:'flex', gap:8 }}>
                  <button className="btn" disabled>Saved</button>
                  <button className="btn ghost" onClick={()=>{ setClosingEditMode(true); setClosingMsg(''); }}>{'Edit'}</button>
                </div>
              )}
              {closingEditMode && (
                <div style={{ display:'flex', gap:8 }}>
                  <button className="btn" onClick={async()=>{
                    const o = parseFloat(openingLiters);
                    const c = parseFloat(closingLiters);
                    if (!isNaN(o) && !isNaN(c) && c < o) { alert('Closing must be greater than or equal to opening'); return; }
                    await saveClosing();
                  }} disabled={savingClosing || !truckId || !theDate || closingLiters===''}>{savingClosing? 'Saving…':'Submit Edit'}</button>
                  <button className="btn ghost" onClick={()=>{ setClosingEditMode(false); setClosingMsg(''); setClosingLiters(closingOrig.current.liters); setClosingAt(closingOrig.current.at); }}>{'Cancel'}</button>
                </div>
              )}
            </div>
            <div style={{ display:'flex', alignItems:'flex-end', color: closingMsg.startsWith('Saved')?'#065f46':'#b91c1c' }}>{closingMsg}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function DayLogsSection({ token, units, refreshStock, drivers }) {
  const [truckId, setTruckId] = useState(() => (units && units[0] ? String(units[0].id) : ''));
  useEffect(() => { if (!truckId && units && units[0]) setTruckId(String(units[0].id)); }, [units]);
  const [date, setDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
  const [openingLiters, setOpeningLiters] = useState('');
  const [openingTime, setOpeningTime] = useState('');
  const [closingLiters, setClosingLiters] = useState('');
  const [closingTime, setClosingTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [existing, setExisting] = useState(null);
  const [driverId, setDriverId] = useState(() => (drivers && drivers[0] ? String(drivers[0].id) : ''));
  const [listRows, setListRows] = useState([]);
  const [listMsg, setListMsg] = useState('');

  useEffect(() => {
    let aborted = false;
    (async () => {
      if (!truckId || !date) { setExisting(null); return; }
      setLoading(true); setMsg('');
      try {
        const auth = token ? { Authorization: 'Bearer ' + token } : {};
        const r = await fetch(`/api/fuel-ops/day/logs?truck_id=${truckId}&date=${date}`, { headers: { ...auth, Accept:'application/json' } });
        const data = await safeJson(r);
        if (!aborted) {
          if (data) {
            setExisting(data);
            setOpeningLiters(data.opening_liters != null ? String(data.opening_liters) : '');
            setOpeningTime(data.opening_at ? formatTimeForInput(data.opening_at) : '');
            setClosingLiters(data.closing_liters != null ? String(data.closing_liters) : '');
            setClosingTime(data.closing_at ? formatTimeForInput(data.closing_at) : '');
            setDriverId(data.driver_id ? String(data.driver_id) : (data.driver_code ? (drivers||[]).find(d=>d.driver_id===data.driver_code)?.id : (drivers&&drivers[0]?String(drivers[0].id):'')));
          } else {
            setExisting(null);
            setOpeningLiters(''); setOpeningTime(''); setClosingLiters(''); setClosingTime('');
          }
        }
      } catch (e) { if (!aborted) setMsg(String(e.message||e)); }
      finally { if (!aborted) setLoading(false); }
    })();
    return () => { aborted = true; };
  }, [truckId, date, token]);

  // Load list of recent day logs for the selected truck
  useEffect(() => {
    let aborted = false;
    (async () => {
      setListMsg('');
      try {
        if (!truckId) { setListRows([]); return; }
        const auth = token ? { Authorization: 'Bearer ' + token } : {};
        const url = `/api/fuel-ops/day/logs/list?truck_id=${truckId}&limit=200`;
        const r = await fetch(url, { headers: { ...auth, Accept:'application/json' } });
        const data = await safeJson(r).catch(() => null);
        if (aborted) return;
        if (!r.ok) {
          const err = data && data.error ? data.error : `status ${r.status}`;
          setListMsg(`Failed to load day logs: ${err}`);
          setListRows([]);
          return;
        }
        const items = Array.isArray(data && data.items ? data.items : data) ? (data.items || data) : [];
        // Attach unit_code for display (if units loaded)
        const enriched = (items || []).map(it => ({
          ...it,
          unit_code: (units || []).find(u => String(u.id) === String(it.truck_id))?.unit_code || null,
        }));
        setListRows(enriched);
      } catch (e) {
        if (!aborted) {
          setListMsg(String(e.message || e));
          setListRows([]);
        }
      }
    })();
    return () => { aborted = true; };
  }, [token, truckId, units]);

  async function submit() {
    if (!truckId || !date || openingLiters === '') return setMsg('Please fill required fields');
    setLoading(true); setMsg('');
    try {
      const headers = { 'Content-Type':'application/json', Accept:'application/json', ...(token?{ Authorization:'Bearer '+token }: {}) };
      const drv = (Array.isArray(drivers)?drivers:[]).find(d => String(d.id) === String(driverId));
      // Send opening_at/closing_at as full local date+time strings (YYYY-MM-DD HH:mm:00)
      const openingAtPayload = openingTime ? `${date} ${openingTime}:00` : undefined;
      const closingAtPayload = closingTime ? `${date} ${closingTime}:00` : undefined;
      const body = {
        truck_id: parseInt(truckId,10),
        date,
        opening_liters: parseInt(openingLiters,10),
        opening_at: openingAtPayload,
        closing_liters: closingLiters !== '' ? parseInt(closingLiters,10) : undefined,
        closing_at: closingAtPayload,
        driver_name: drv ? drv.name : undefined,
        driver_code: drv ? drv.driver_id : undefined,
        driver_id: drv ? parseInt(drv.id,10) : undefined
      };
      let r;
      if (existing && existing.id) {
        r = await fetch(`/api/fuel-ops/day/logs/${existing.id}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
      } else {
        r = await fetch('/api/fuel-ops/day/logs', { method: 'POST', headers, body: JSON.stringify(body) });
      }
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data && data.error ? data.error : 'Failed');
      setMsg('Saved');
      setExisting(data);
      // refresh list for the current truck
      try {
        const auth = token ? { Authorization: 'Bearer ' + token } : {};
        const rl = await fetch(`/api/fuel-ops/day/logs/list?truck_id=${truckId}&limit=200`, { headers: { ...auth, Accept:'application/json' } });
        const dl = await safeJson(rl);
        setListRows((dl && dl.items) ? dl.items : []);
      } catch {}
      try { if (typeof refreshStock === 'function') await refreshStock(); } catch {}
    } catch (e) { setMsg(String(e.message||e)); }
    finally { setLoading(false); }
  }

  const isActive = existing ? (existing.closing_liters == null) : true;

  function loadRowIntoForm(r) {
    try {
      setTruckId(String(r.truck_id));
      setDate(r.reading_date || date);
      setExisting(r);
      setOpeningLiters(r.opening_liters != null ? String(r.opening_liters) : '');
      setOpeningTime(r.opening_at ? formatTimeForInput(r.opening_at) : '');
      setClosingLiters(r.closing_liters != null ? String(r.closing_liters) : '');
      setClosingTime(r.closing_at ? formatTimeForInput(r.closing_at) : '');
      setDriverId(r.driver_id ? String(r.driver_id) : (r.driver_code ? (drivers||[]).find(d=>d.driver_id===r.driver_code)?.id : (drivers&&drivers[0]?String(drivers[0].id):'')));
      setMsg('');
    } catch (e) { /* ignore */ }
  }

  function cancelEdit() {
    if (existing) {
      setOpeningLiters(existing.opening_liters != null ? String(existing.opening_liters) : '');
      setOpeningTime(existing.opening_at ? formatTimeForInput(existing.opening_at) : '');
      setClosingLiters(existing.closing_liters != null ? String(existing.closing_liters) : '');
      setClosingTime(existing.closing_at ? formatTimeForInput(existing.closing_at) : '');
      setDriverId(existing.driver_id ? String(existing.driver_id) : (existing.driver_code ? (drivers||[]).find(d=>d.driver_id===existing.driver_code)?.id : (drivers&&drivers[0]?String(drivers[0].id):'')));
      setMsg('');
    } else {
      setOpeningLiters(''); setOpeningTime(''); setClosingLiters(''); setClosingTime(''); setMsg('');
    }
  }

  return (
    <>
    <div className="card" style={{ padding: 16, maxWidth: 900 }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12 }}>
        <label style={{ display:'flex', flexDirection:'column' }}>
          <span style={{ fontSize:12, color:'#374151' }}>Date</span>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} />
        </label>
        <label style={{ display:'flex', flexDirection:'column' }}>
          <span style={{ fontSize:12, color:'#374151' }}>Truck</span>
          <select value={truckId} onChange={e=>setTruckId(e.target.value)}>
            {(units||[]).map(u => (<option key={u.id} value={u.id}>{u.unit_code || u.vehicle_number || u.id}</option>))}
          </select>
        </label>
        <label style={{ display:'flex', flexDirection:'column' }}>
          <span style={{ fontSize:12, color:'#374151' }}>Driver</span>
          <select value={driverId} onChange={e=>setDriverId(e.target.value)}>
            <option value="">Select</option>
            {(Array.isArray(drivers)?drivers:[]).map(d => (<option key={d.id} value={d.id}>{d.driver_id} · {d.name}</option>))}
          </select>
        </label>
        <label style={{ display:'flex', flexDirection:'column' }}>
          <span style={{ fontSize:12, color:'#374151' }}>Opening reading (L)</span>
          <input type="number" value={openingLiters} onChange={e=>setOpeningLiters(e.target.value)} />
        </label>
        <label style={{ display:'flex', flexDirection:'column' }}>
          <span style={{ fontSize:12, color:'#374151' }}>Opening time</span>
          <input type="time" value={openingTime} onChange={e=>setOpeningTime(e.target.value)} />
        </label>
        <label style={{ display:'flex', flexDirection:'column' }}>
          <span style={{ fontSize:12, color:'#374151' }}>Closing reading (L)</span>
          <input type="number" value={closingLiters} onChange={e=>setClosingLiters(e.target.value)} />
        </label>
        <label style={{ display:'flex', flexDirection:'column' }}>
          <span style={{ fontSize:12, color:'#374151' }}>Closing time</span>
          <input type="time" value={closingTime} onChange={e=>setClosingTime(e.target.value)} />
        </label>
      </div>
      <div style={{ marginTop:12, display:'flex', alignItems:'center', gap:12 }}>
        <button className="btn" disabled={loading} onClick={submit}>{loading? 'Saving…' : (existing? 'Update' : 'Create')}</button>
        {existing && (<button className="btn ghost" onClick={cancelEdit}>Cancel</button>)}
        <div style={{ color: isActive ? '#065f46' : '#6b7280', fontWeight:600 }}>{existing ? (isActive ? 'Active' : 'Closed') : 'No record'}</div>
        <div style={{ color:'#b91c1c' }}>{msg}</div>
      </div>
    </div>
    {/* Recent records listing */}
    <div style={{ marginTop:16, maxWidth:900 }}>
      <div style={{ fontWeight:600, marginBottom:8 }}>Recent Day Logs</div>
      {listMsg && (<div style={{ marginBottom:8, color:'#b91c1c' }}>{listMsg}</div>)}
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ textAlign:'left' }}>
              <th>Date</th>
              <th>Truck</th>
              <th>Opening (L)</th>
              <th>Opening Time</th>
              <th>Closing (L)</th>
              <th>Closing Time</th>
              <th>Driver</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(listRows||[]).length === 0 ? (
              <tr><td colSpan={9} style={{ color:'#6b7280', padding:8 }}>No records</td></tr>
            ) : (
              (listRows||[]).map(r => (
                <tr key={r.id} style={{ cursor:'pointer' }} onClick={() => loadRowIntoForm(r)}>
                  <td>{r.reading_date ? new Date(r.reading_date).toLocaleDateString() : '-'}</td>
                  <td>{(units||[]).find(u=>String(u.id)===String(r.truck_id))?.unit_code || r.truck_id || '-'}</td>
                  <td>{r.opening_liters != null ? r.opening_liters : '-'}</td>
                  <td>{r.opening_at ? (new Date(r.opening_at)).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '-'}</td>
                  <td>{r.closing_liters != null ? r.closing_liters : '-'}</td>
                  <td>{r.closing_at ? (new Date(r.closing_at)).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '-'}</td>
                  <td>{r.driver_name || r.driver_code || '-'}</td>
                  <td>
                    {r.closing_liters == null ? (
                      <span style={{ background:'#d1fae5', color:'#065f46', padding:'4px 8px', borderRadius:12, fontSize:12, fontWeight:600 }}>Still active</span>
                    ) : (
                      <span style={{ background:'#e5e7eb', color:'#374151', padding:'4px 8px', borderRadius:12, fontSize:12 }}>Closed</span>
                    )}
                  </td>
                  <td>
                    <button className="btn ghost" onClick={(ev) => { ev.stopPropagation(); loadRowIntoForm(r); }}>Edit</button>
                    <button className="btn ghost" onClick={async (ev) => { ev.stopPropagation(); try {
                      // allow deleting a day log
                      if (!window.confirm('Delete this day log?')) return;
                      const auth = token ? { Authorization: 'Bearer ' + token } : {};
                      const res = await fetch(`/api/fuel-ops/day/logs/${r.id}`, { method: 'DELETE', headers: { ...auth, Accept:'application/json' } });
                      const jd = await safeJson(res);
                      if (!res.ok) { alert(jd.error || 'Delete failed'); return; }
                      // refresh list for current truck
                      const rl = await fetch(`/api/fuel-ops/day/logs/list?truck_id=${truckId}&limit=200`, { headers: { ...(token?{ Authorization: 'Bearer ' + token }:{}) , Accept:'application/json' } });
                      const dl = await safeJson(rl);
                      setListRows((dl && dl.items) ? dl.items : []);
                      if (existing && existing.id === r.id) { setExisting(null); setOpeningLiters(''); setOpeningTime(''); setClosingLiters(''); setClosingTime(''); }
                    } catch (e) { alert(String(e.message||e)); } }}>Delete</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
    </>
  );
}

function Timeline({ token, dayOps, units, datums, onChanged }) {
  const [editing, setEditing] = useState({ kind: null, id: null });
  const [form, setForm] = useState({ volume: '', toVehicle: '', toUnitId: '', time: '' });
  const list = useMemo(() => {
    const rows = [];
    // Loads intentionally excluded from timeline view (displayed separately above)
    (dayOps.sales||[]).forEach(r => rows.push({ id:r.id, kind:'SALE', ts:r.performed_at? new Date(r.performed_at) : (r.sale_date? new Date(r.sale_date) : null), data:r }));
    (dayOps.transfers_out||[]).forEach(r => {
      // Use transfer_date + transfer_time if available
      let ts = null;
      if (r.transfer_date && r.transfer_time) {
        ts = new Date(`${r.transfer_date}T${r.transfer_time}`);
      } else if (r.performed_at) {
        ts = new Date(r.performed_at);
      } else if (r.transfer_date) {
        ts = new Date(r.transfer_date);
      }
      rows.push({ id:r.id, kind:'XFER_OUT', ts, data:r });
    });
    (dayOps.transfers_in||[]).forEach(r => {
      let ts = null;
      if (r.transfer_date && r.transfer_time) {
        ts = new Date(`${r.transfer_date}T${r.transfer_time}`);
      } else if (r.performed_at) {
        ts = new Date(r.performed_at);
      } else if (r.transfer_date) {
        ts = new Date(r.transfer_date);
      }
      rows.push({ id:r.id, kind:'XFER_IN', ts, data:r });
    });
    (dayOps.testing||[]).forEach(r => rows.push({ id:r.id, kind:'TEST', ts:r.performed_at? new Date(r.performed_at) : null, data:r }));
    rows.sort((a,b) => (a.ts?.getTime()||0) - (b.ts?.getTime()||0));
    return rows;
  }, [dayOps]);

  async function del(kind, id) {
    const ok = window.confirm('Delete this record?');
    if (!ok) return;
    const headers = { Accept:'application/json' };
    const auth = localStorage.getItem('authToken');
    if (auth) headers.Authorization = 'Bearer ' + auth;
  let url;
  if (kind === 'TEST') {
    url = `/api/fuel-ops/transfers/testing/${id}`;
  } else if (kind === 'SALE') {
    url = `/api/fuel-ops/transfers/sales/${id}`;
  } else {
    url = `/api/fuel-ops/transfers/internal/${id}`;
  }
  const r = await fetch(url, { method:'DELETE', headers });
    const j = await safeJson(r);
    if (!r.ok) { alert(j.error || 'Delete failed'); return; }
    onChanged && onChanged();
  }

  async function saveEdit() {
    const { kind, id } = editing;
    const headers = { 'Content-Type':'application/json', Accept:'application/json' };
    const auth = localStorage.getItem('authToken');
    if (auth) headers.Authorization = 'Bearer ' + auth;
    if (kind === 'SALE') {
      const body = {};
      if (form.volume) body.sale_volume_liters = parseInt(form.volume,10);
      if (form.toVehicle) body.to_vehicle = form.toVehicle;
      if (form.time) body.performed_time = form.time; // HH:mm
      const r = await fetch(`/api/fuel-ops/transfers/sales/${id}`, { method:'PATCH', headers, body: JSON.stringify(body) });
      const j = await safeJson(r);
      if (!r.ok) { alert(j.error || 'Update failed'); return; }
    } else if (kind === 'XFER_OUT' || kind === 'XFER_IN') {
      const body = {};
      if (form.volume) body.transfer_volume_liters = parseInt(form.volume,10);
      if (form.time) body.performed_time = form.time; // HH:mm
      const r = await fetch(`/api/fuel-ops/transfers/internal/${id}`, { method:'PATCH', headers, body: JSON.stringify(body) });
      const j = await safeJson(r);
      if (!r.ok) { alert(j.error || 'Update failed'); return; }
    }
    else if (kind === 'TEST') {
      const body = {};
      if (form.volume) body.transfer_volume_liters = parseInt(form.volume,10);
      if (form.time) body.performed_time = form.time; // HH:mm
      const r = await fetch(`/api/fuel-ops/transfers/testing/${id}`, { method:'PATCH', headers, body: JSON.stringify(body) });
      const j = await safeJson(r);
      if (!r.ok) { alert(j.error || 'Update failed'); return; }
    }
    setEditing({ kind:null, id:null }); setForm({ volume:'', toVehicle:'', toUnitId:'', time:'' });
    onChanged && onChanged();
  }

  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead>
          <tr style={{ textAlign:'left' }}>
            <th>Time</th>
            <th>Type</th>
            <th>Details</th>
            <th>Volume (L)</th>
            <th style={{ width: 160 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {list.length===0 ? (
            <tr><td colSpan={5} style={{ color:'#6b7280', padding:8 }}>—</td></tr>
          ) : list.map(row => {
            // For internal transfers, prefer transfer_time string for display
            let t = '-';
            if (row.kind === 'XFER_OUT' || row.kind === 'XFER_IN') {
              const d = row.data;
              if (typeof d.transfer_time === 'string' && d.transfer_time) {
                // Parse transfer_time and display with am/pm
                const [hh, mm] = d.transfer_time.split(':');
                if (hh && mm) {
                  const date = new Date();
                  date.setHours(Number(hh));
                  date.setMinutes(Number(mm));
                  date.setSeconds(0);
                  t = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                } else {
                  t = d.transfer_time;
                }
              } else if (row.ts) {
                t = row.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
              }
            } else {
              t = row.ts ? row.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '-';
            }
            if (editing.id === row.id && editing.kind === row.kind) {
              return (
                <tr key={row.kind+'-'+row.id}>
                  <td>
                    <input type="time" value={form.time} onChange={e=>setForm(f=>({...f, time:e.target.value}))} style={{ padding:6 }} />
                  </td>
                  <td>{row.kind}</td>
                  <td>
                    {row.kind==='SALE' && (
                      <div style={{ display:'flex', gap:8 }}>
                        <input placeholder="To Vehicle" value={form.toVehicle} onChange={e=>setForm(f=>({...f, toVehicle:e.target.value}))} style={{ padding:6 }} />
                        <input type="number" placeholder="Volume" value={form.volume} onChange={e=>setForm(f=>({...f, volume:e.target.value}))} style={{ padding:6, width:120 }} />
                      </div>
                    )}
                    {(row.kind==='XFER_OUT' || row.kind==='XFER_IN') && (
                      <div style={{ display:'flex', gap:8 }}>
                        <input type="number" placeholder="Volume" value={form.volume} onChange={e=>setForm(f=>({...f, volume:e.target.value}))} style={{ padding:6, width:120 }} />
                      </div>
                    )}
                    {row.kind==='TEST' && (
                      <div style={{ display:'flex', gap:8 }}>
                        <input type="number" placeholder="Volume" value={form.volume} onChange={e=>setForm(f=>({...f, volume:e.target.value}))} style={{ padding:6, width:120 }} />
                      </div>
                    )}
                    {row.kind==='LOAD' && (<span>Editing loads not supported</span>)}
                  </td>
                  <td>-</td>
                  <td style={{ display:'flex', gap:8 }}>
                    <button className="btn" onClick={saveEdit}>Save</button>
                    <button className="btn ghost" onClick={()=>{ setEditing({ kind:null, id:null }); setForm({ volume:'', toVehicle:'', toUnitId:'', time:'' }); }}>Cancel</button>
                  </td>
                </tr>
              );
            }
            // non-editing row
            const d = row.data;
            let details = null;
            // Read volume from whichever shape the server returned (backwards compatibility)
            // prefer explicit *_liters names for sales/testing, and `transfer_volume` for internal transfers
            let volRaw = null;
            if (row.kind==='SALE') { details = (<span>Vehicle {d.to_vehicle}</span>); volRaw = d.sale_volume_liters ?? d.sale_volume; }
            if (row.kind==='XFER_OUT') { details = (<span>To {d.to_unit_code}</span>); volRaw = d.transfer_volume ?? d.transfer_volume_liters ?? d.volume_liters; }
            if (row.kind==='XFER_IN') { details = (<span>From {d.from_unit_code}</span>); volRaw = d.transfer_volume ?? d.transfer_volume_liters ?? d.volume_liters; }
            if (row.kind==='TEST') { details = (<span>{d.to_vehicle ? `Testing · ${d.to_vehicle}` : 'Testing'}</span>); volRaw = d.transfer_volume_liters ?? d.transfer_volume ?? d.testing_volume_liters ?? d.testing_volume; }
            const vol = (volRaw != null) ? volRaw : '—';
            return (
              <tr key={row.kind+'-'+row.id}>
                <td>{t}</td>
                <td>{row.kind}</td>
                <td>{details}</td>
                <td>{vol}</td>
                <td style={{ display:'flex', gap:8 }}>
                  {row.kind!=='LOAD' && (<>
                    <button className="btn ghost" onClick={()=>{ const hh = row.ts? String(row.ts.getHours()).padStart(2,'0') : ''; const mm = row.ts? String(row.ts.getMinutes()).padStart(2,'0') : ''; const timeVal = d.performed_at ? formatTimeForInput(d.performed_at) : ((hh&&mm)? `${hh}:${mm}` : ''); setEditing({ kind:row.kind, id:row.id }); setForm({ volume: volRaw != null ? String(volRaw) : '', toVehicle: d.to_vehicle || '', toUnitId: d.to_unit_id ? String(d.to_unit_id) : '', time: timeVal }); }}>Edit</button>
                    <button className="btn ghost" onClick={()=>del(row.kind, row.id)}>Delete</button>
                  </>)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
// Purchase (lot creation) section + list
function PurchaseSection({ token, units, unitId, setUnitId, loadDate, setLoadDate, liters, setLiters, preview, message, setMessage, submitting, onCreateLot, setPreview, refreshStock, datums, purchaseTime, setPurchaseTime }) {
  const [listLoading, setListLoading] = useState(false);
  const [lotsList, setLotsList] = useState([]);
  const [filterUnit, setFilterUnit] = useState('ALL');
  // For purchase display, restrict to trucks only
  const truckUnits = units;
  // Initialize filter default to ALL
  useEffect(() => { if (!filterUnit) setFilterUnit('ALL'); }, []);
  // Load list when filter or token changes
  useEffect(() => { (async () => { await reloadLots(); })(); }, [filterUnit, token]);
  async function reloadLots() {
    setListLoading(true);
    try {
      const base = '/api/fuel-ops/lots/list';
      const params = new URLSearchParams();
      params.set('load_type','PURCHASE');
      if (!filterUnit || filterUnit === 'ALL') {
        params.set('unit_type','TRUCK');
      } else {
        params.set('unit_id', String(filterUnit));
      }
      const url = `${base}?${params.toString()}`;
      const r = await fetch(url, { headers: { Accept:'application/json', ...(token?{ Authorization:'Bearer '+token }: {}) } });
      const data = await safeJson(r);
      setLotsList((data && data.items) ? data.items : []);
    } catch { setLotsList([]); } finally { setListLoading(false); }
  }
  // After create lot refresh list
  useEffect(() => { if (message && message.startsWith('Created')) { reloadLots(); try { if (typeof refreshStock==='function') refreshStock(); } catch {} } }, [message]);
  return (
    <div className="card" style={{ padding: 16, maxWidth: 900 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#374151' }}>
          Tanker / Storage
          <select value={unitId} onChange={e => setUnitId(e.target.value)} style={{ padding: 8 }}>
            {[...units, ...datums].map(u => (<option key={u.id} value={u.id}>{u.unit_type==='DATUM'?'DATUM':'Tanker'} · {u.unit_code}{u.vehicle_number?` · ${u.vehicle_number}`:''}</option>))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#374151' }}>
          Load date
          <input type="date" value={loadDate} onChange={e => setLoadDate(e.target.value)} style={{ padding: 8 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#374151' }}>
          Loaded liters
          <input type="number" min={1} step={1} value={liters} onChange={e => setLiters(e.target.value)} placeholder="e.g., 3400" style={{ padding: 8 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#374151' }}>
          Load time (optional)
          <input type="time" value={purchaseTime} onChange={e=> setPurchaseTime(e.target.value)} style={{ padding:8 }} />
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button className="btn" onClick={onCreateLot} disabled={submitting || !unitId || !loadDate || !liters}>{submitting ? 'Creating…' : 'Create Lot'}</button>
        </div>
      </div>
      {preview && (
        <div style={{ marginTop: 12, fontSize: 14 }}>
          Preview: <span style={{ fontWeight: 600 }}>{preview.lot_code}</span>
          {typeof preview.seq_index === 'number' && (<span style={{ color: '#6b7280' }}> · Seq #{preview.seq_index}</span>)}
        </div>
      )}
      {message && (<div style={{ marginTop: 12, color: message.startsWith('Created') ? '#065f46' : '#b91c1c' }}>{message}</div>)}
      <div style={{ marginTop: 12, color: '#6b7280', fontSize: 12 }}>Lot format: LOTDDMONYY[UnitCode][SeqLetters][Loaded]</div>
      <div style={{ marginTop:24, paddingTop:12, borderTop:'1px solid #eee' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <div style={{ fontWeight:600 }}>Recent lots</div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <select value={filterUnit} onChange={e=>setFilterUnit(e.target.value)} style={{ padding:6 }}>
              <option value="ALL">All</option>
              {(truckUnits||[]).map(u => (<option key={u.id} value={u.id}>{u.unit_code}</option>))}
            </select>
            <button className="btn ghost" disabled={listLoading} onClick={reloadLots} style={{ padding:'4px 10px', fontSize:12 }}>{listLoading? 'Loading…':'Refresh'}</button>
          </div>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ textAlign:'left' }}>
                <th>Lot Code</th>
                <th>Loaded (L)</th>
                <th>Used (L)</th>
                <th>Remaining (L)</th>
                <th>Stock Status</th>
                <th>Transferred To</th>
                <th>Load Type</th>
                <th>Load Date</th>
                <th>Load Time</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(lotsList||[]).length===0 ? (<tr><td colSpan={11} style={{ padding:8, color:'#6b7280' }}>No lots</td></tr>) : (
                lotsList.map(l => {
                  let remaining = '';
                  if (l.loaded_liters != null && l.used_liters != null) {
                    const raw = l.loaded_liters - l.used_liters;
                    remaining = l.stock_status === 'SOLD' ? 0 : raw;
                  }
                  const transferVolume = (l.stock_status === 'SOLD' && l.used_liters > l.loaded_liters) ? (l.used_liters - l.loaded_liters) : (l.transfer_volume_liters || 0);
                  const transferTo = l.transfer_to_unit_codes ? l.transfer_to_unit_codes : '-';
                  return (
                    <tr key={l.id || l.lot_code}>
                      <td>
                        <div>{l.lot_code_initial || l.lot_code}</div>
                        {filterUnit==='ALL' && (<div style={{ fontSize:11, color:'#6b7280' }}>{l.unit_code || ''}</div>)}
                      </td>
                      <td>{l.loaded_liters}</td>
                      <td>{l.used_liters}</td>
                      <td>{remaining}</td>
                      <td>{l.stock_status || '-'}</td>
                      <td>{transferTo}</td>
                      <td>{l.load_type || '-'}</td>
                      <td>{l.load_date ? new Date(l.load_date).toLocaleDateString() : '-'}</td>
                      <td>{l.load_time ? (()=>{ const d=new Date(l.load_time); return `${d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`; })() : (l.created_at ? (()=>{ const d=new Date(l.created_at); return `${d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`; })() : '-')}</td>
                      <td>{l.created_at ? new Date(l.created_at).toLocaleString() : '-'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function InternalTransferSection({ token, units, datums, drivers, refreshStock }) {
  const [activity, setActivity] = useState('TANKER_TO_TANKER');
  const [transferDate, setTransferDate] = useState(() => fmtDateInput(new Date()));
  const [transferTime, setTransferTime] = useState(''); // HH:mm
  const [fromUnit, setFromUnit] = useState('');
  const [toUnit, setToUnit] = useState('');
  const [vol, setVol] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  // Simple display list state
  const [listLoading, setListLoading] = useState(false);
  const [listRows, setListRows] = useState([]);
  // Full-form edit mode state
  const [editMode, setEditMode] = useState(false);
  const [editRowId, setEditRowId] = useState(null);
  // Driver selection
  const [driverId, setDriverId] = useState(() => (drivers && drivers[0] ? String(drivers[0].id) : ''));
  useEffect(() => { if (!driverId && drivers && drivers[0]) setDriverId(String(drivers[0].id)); }, [drivers]);
  // Sale window indicator for source tanker
  const [windowInfo, setWindowInfo] = useState({ status: 'unknown', opening_at: null, closing_at: null });
  useEffect(() => { setFromUnit(''); setToUnit(''); setMsg(null); }, [activity]);
  // Fetch opening/closing info for source tanker and date
  useEffect(() => {
    let aborted = false;
    (async () => {
      if (!fromUnit || !transferDate) { setWindowInfo({ status:'na', opening_at:null, closing_at:null }); return; }
      try {
        // Prefer the Day Logs table (dispenser_day_reading_logs) which is authoritative for opening readings
        try {
          const rLogs = await fetch(`/api/fuel-ops/day/logs?truck_id=${fromUnit}&date=${transferDate}`, { headers: { Accept:'application/json', ...(token?{ Authorization:'Bearer '+token }: {}) } });
          const logData = await safeJson(rLogs);
          if (aborted) return;
          if (logData && logData.opening_liters != null) {
            setWindowInfo({ status:'present', opening_at: logData.opening_at || null, closing_at: logData.closing_at || null });
            return;
          }
        } catch (e) {
          // non-fatal, continue to other checks
        }

        // Fallback: check legacy day dispenser readings
        try {
          const r = await fetch(`/api/fuel-ops/day/dispenser?truck_id=${fromUnit}&date=${transferDate}`, { headers: { Accept:'application/json', ...(token?{ Authorization:'Bearer '+token }: {}) } });
          const data = await safeJson(r);
          if (aborted) return;
          const hasOpening = !!(data && data.opening_liters != null);
          if (hasOpening) {
            setWindowInfo({ status:'present', opening_at: data.opening_at || null, closing_at: data.closing_at || null });
            return;
          }
        } catch (e) {
          // ignore and fallback to trip checks
        }

        // Final fallback: accept a trip opening (truck_dispenser_trips)
        try {
          const rt = await fetch(`/api/fuel-ops/trips?truck_id=${fromUnit}&date=${transferDate}`, { headers: { Accept:'application/json', ...(token?{ Authorization:'Bearer '+token }: {}) } });
          const trips = await safeJson(rt);
          if (aborted) return;
          const items = (trips && trips.items) ? trips.items : [];
          const hasTripOpening = items.some(t => t && (t.opening_at != null || t.opening_liters != null));
          if (hasTripOpening) setWindowInfo({ status:'present', opening_at: (items.find(t=>t.opening_at)?.opening_at)||null, closing_at: null });
          else setWindowInfo({ status:'missing', opening_at:null, closing_at:null });
        } catch {
          setWindowInfo({ status:'missing', opening_at:null, closing_at:null });
        }
      } catch {
        if (!aborted) setWindowInfo({ status:'error', opening_at:null, closing_at:null });
      }
    })();
    return () => { aborted = true; };
  }, [fromUnit, transferDate, token]);
  async function submitActivity() {
    setSaving(true); setMsg(null);
    try {
      const body = {
        activity,
        from_unit_id: parseInt(fromUnit,10),
        to_unit_id: parseInt(toUnit,10),
        volume_liters: parseInt(vol,10),
        driver_id: driverId ? parseInt(driverId,10) : undefined,
        transfer_date: transferDate,
        performed_time: transferTime || undefined
      };
      const r = await fetch('/api/fuel-ops/lots/activity', { method:'POST', headers:{ 'Content-Type':'application/json', Accept:'application/json', ...(token?{ Authorization:'Bearer '+token }: {}) }, body: JSON.stringify(body) });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data.error || 'Failed');
      setMsg(`Activity recorded. Lot ${data.lot.lot_code_initial} now used ${data.lot.used_liters}/${data.lot.loaded_liters}. ${data.lot.lot_code_by_transfer ? 'Code: '+data.lot.lot_code_by_transfer : ''}`);
      setFromUnit(''); setToUnit(''); setVol(''); setTransferTime(''); setDriverId(drivers && drivers[0] ? String(drivers[0].id) : '');
      try { if (typeof refreshStock==='function') refreshStock(); } catch {}
      // reload simple list to reflect new record
      try { await reloadSimpleTransfers(); } catch {}
    } catch(e){ setMsg(String(e.message||e)); } finally { setSaving(false); }
  }
  const allUnits = [...units, ...datums];
  // Load simple list on mount/token change
  useEffect(() => { reloadSimpleTransfers(); }, [token]);
  async function reloadSimpleTransfers() {
    setListLoading(true);
    try {
      const r = await fetch('/api/fuel-ops/transfers/internal/list?limit=100', { headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data && data.error ? data.error : 'Failed to load transfers');
      setListRows((data && data.items) ? data.items : []);
    } catch { setListRows([]); } finally { setListLoading(false); }
  }
  // Submit full edit via comprehensive server endpoint
  async function submitFullEdit() {
    if (!editMode || !editRowId) return;
    setSaving(true); setMsg(null);
    try {
      const headers = { 'Content-Type':'application/json', Accept:'application/json', ...(token?{ Authorization:'Bearer '+token }: {}) };
      const payload = {
        activity,
        from_unit_id: parseInt(fromUnit,10),
        to_unit_id: parseInt(toUnit,10),
        volume_liters: parseInt(vol,10),
        driver_id: driverId ? parseInt(driverId,10) : undefined,
        transfer_date: transferDate,
        performed_time: transferTime || undefined
      };
      const r = await fetch(`/api/fuel-ops/transfers/internal/${editRowId}/full`, { method:'PUT', headers, body: JSON.stringify(payload) });
      const j = await safeJson(r);
      if (!r.ok) throw new Error(j && j.error ? j.error : 'Failed to update transfer');
      setMsg('Edit saved');
      setEditMode(false); setEditRowId(null);
      setFromUnit(''); setToUnit(''); setVol(''); setTransferTime(''); setDriverId(drivers && drivers[0] ? String(drivers[0].id) : '');
      await reloadSimpleTransfers();
      try { if (typeof refreshStock==='function') await refreshStock(); } catch {}
    } catch (e) { setMsg(String(e.message||e)); }
    finally { setSaving(false); }
  }
  return (
    <div className="card" style={{ padding:16, maxWidth:1000 }}>
      {/* Row 1: Date, Time, Activity */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          Date
          <input type="date" value={transferDate} onChange={e=>setTransferDate(e.target.value)} style={{ padding:8 }} />
        </label>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          Time (optional)
          <input type="time" value={transferTime} onChange={e=>setTransferTime(e.target.value)} style={{ padding:8 }} />
        </label>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          Activity
          <select value={activity} onChange={e=>setActivity(e.target.value)} style={{ padding:8 }}>
            <option value="TANKER_TO_TANKER">Tanker to Tanker</option>
            <option value="TANKER_TO_DATUM">Tanker to Datum</option>
          </select>
        </label>
      </div>
      {/* Row 2: From Tanker, To Tanker/Datum */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:12 }}>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          From Tanker
          <select value={fromUnit} onChange={e=>setFromUnit(e.target.value)} style={{ padding:8 }}>
            <option value="">Select</option>
            {units.filter(u => !toUnit || String(u.id)!==String(toUnit)).map(u => (<option key={u.id} value={u.id}>{u.unit_code}{u.vehicle_number?` · ${u.vehicle_number}`:''}</option>))}
          </select>
          <span style={{ marginTop:6, fontSize:11, color: windowInfo.status==='present' ? '#065f46' : (windowInfo.status==='missing' ? '#b91c1c' : '#6b7280') }}>
            {windowInfo.status==='present' && 'Opening recorded'}
            {windowInfo.status==='missing' && (() => {
              const u = (units||[]).find(x => String(x.id) === String(fromUnit));
              const code = u ? u.unit_code : (fromUnit || '');
              const date = transferDate || '';
              return `No day log for the tanker "${code}" and date "${date}" is recorded.`;
            })()}
            {windowInfo.status==='na' && '—'}
            {windowInfo.status==='error' && 'Window check failed'}
          </span>
        </label>
        {activity==='TANKER_TO_TANKER' && (
          <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
            To Tanker
            <select value={toUnit} onChange={e=>setToUnit(e.target.value)} style={{ padding:8 }}>
              <option value="">Select</option>
              {units.filter(u => !fromUnit || String(u.id)!==String(fromUnit)).map(u => (<option key={u.id} value={u.id}>{u.unit_code}{u.vehicle_number?` · ${u.vehicle_number}`:''}</option>))}
            </select>
          </label>
        )}
        {activity==='TANKER_TO_DATUM' && (
          <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
            To Datum
            <select value={toUnit} onChange={e=>setToUnit(e.target.value)} style={{ padding:8 }}>
              <option value="">Select</option>
              {datums.map(d => (<option key={d.id} value={d.id}>{d.unit_code}{d.vehicle_number?` · ${d.vehicle_number}`:''}</option>))}
            </select>
          </label>
        )}
      </div>
      {/* Row 3: Volume, Driver */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:12 }}>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          Volume (L)
          <input type="number" min={1} step={1} value={vol} onChange={e=>setVol(e.target.value)} style={{ padding:8 }} />
        </label>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          Driver
          <select value={driverId} onChange={e=>setDriverId(e.target.value)} style={{ padding:8 }}>
            {(Array.isArray(drivers)?drivers:[]).map(d => (<option key={d.id} value={d.id}>{d.driver_id} · {d.name}</option>))}
          </select>
        </label>
      </div>
      <div style={{ marginTop:12 }}>
        {!editMode ? (
          <button className="btn" disabled={saving || !activity || !vol || !fromUnit || !toUnit || windowInfo.status!=='present'} onClick={async()=>{
            await submitActivity();
          }}>{saving? 'Saving…':'Save Activity'}</button>
        ) : (
          <span style={{ display:'inline-flex', gap:8 }}>
            <button className="btn" disabled={saving || !activity || !vol || !fromUnit || !toUnit} onClick={submitFullEdit}>{saving? 'Saving…' : 'Submit Edit'}</button>
            <button className="btn ghost" onClick={()=>{ setEditMode(false); setEditRowId(null); setMsg(null); setFromUnit(''); setToUnit(''); setVol(''); setTransferTime(''); setDriverId(drivers && drivers[0] ? String(drivers[0].id) : ''); }}>Cancel</button>
          </span>
        )}
        {msg && (<div style={{ marginTop:8, color: (msg.startsWith('Activity recorded') || msg.startsWith('Edit saved')) ? '#065f46' : '#b91c1c' }}>{msg}</div>)}
        <div style={{ marginTop:8, color:'#6b7280', fontSize:12 }}>Code by transfer format: [InitialLotCode]-[CumulativeUsed]</div>
      </div>
      {/* Simple internal transfers list */}
      <div style={{ marginTop:24, paddingTop:12, borderTop:'1px solid #eee' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <div style={{ fontWeight:600 }}>Internal transfer records</div>
          <button className="btn ghost" disabled={listLoading} onClick={reloadSimpleTransfers} style={{ padding:'4px 10px', fontSize:12 }}>{listLoading? 'Loading…':'Refresh'}</button>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ textAlign:'left' }}>
                <th>Date</th>
                <th>Performed At</th>
                <th>From Unit Code</th>
                <th>To Unit Code</th>
                <th>Transfer Volume (L)</th>
                <th>From Lot Code</th>
                <th>To Lot Code</th>
                <th>Transfer To Empty</th>
                <th>Driver Name</th>
                <th>Performed By</th>
                <th>Activity</th>
                <th style={{ width: 160 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(listRows||[]).length===0 ? (
                <tr><td colSpan={12} style={{ padding:8, color:'#6b7280' }}>{listLoading ? 'Loading…' : 'No records'}</td></tr>
              ) : (
                listRows.map(r => {
                  // Performed time can be provided either as a timestamp (performed_at)
                  // or as separate date/time fields (transfer_date + transfer_time).
                  const perfTime = r.performed_at ? new Date(r.performed_at) : null;
                  let hh = perfTime ? String(perfTime.getHours()).padStart(2,'0') : '';
                  let mm = perfTime ? String(perfTime.getMinutes()).padStart(2,'0') : '';
                  if (!perfTime && r && typeof r.transfer_time === 'string') {
                    const parts = r.transfer_time.split(':');
                    if (parts && parts.length >= 2) { hh = String(parts[0]).padStart(2,'0'); mm = String(parts[1]).padStart(2,'0'); }
                  }
                  const performedAtDisplay = (() => {
                    // Show time only (HH:mm). Prefer explicit transfer_time; else derive from performed_at
                    if (typeof r.transfer_time === 'string' && r.transfer_time) return r.transfer_time.slice(0,5);
                    if (r.performed_at) {
                      const d = new Date(r.performed_at);
                      return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                    }
                    if (hh && mm) return `${hh}:${mm}`;
                    return '-';
                  })();
                  return (
                    <tr key={r.id}>
                      <td>{r.transfer_date ? new Date(r.transfer_date).toLocaleDateString() : (r.performed_at ? new Date(r.performed_at).toLocaleDateString() : '-')}</td>
                      <td>{performedAtDisplay}</td>
                      <td>{r.from_unit_code}</td>
                      <td>{r.to_unit_code}</td>
                      <td>{r.transfer_volume != null ? r.transfer_volume : (r.transfer_volume_liters != null ? r.transfer_volume_liters : '')}</td>
                      <td>{r.from_lot_code_change || r.from_lot_code_after || '-'}</td>
                      <td>{r.to_lot_code_change || r.to_lot_code_after || '-'}</td>
                      <td>{r.transfer_to_empty ? 'Yes' : 'No'}</td>
                      <td>{r.driver_name || '-'}</td>
                      <td>{r.performed_by || '-'}</td>
                      <td>{r.activity || '-'}</td>
                      <td style={{ display:'flex', gap:8 }}>
                        <button className="btn ghost" onClick={()=>{
                          // Populate form for edit mode
                          setEditMode(true); setEditRowId(r.id); setMsg(null);
                          setActivity(r.activity || 'TANKER_TO_TANKER');
                          // Map by unit code to ids
                          const findByCode = (code, arr) => {
                            const row = (arr||[]).find(u => u.unit_code === code);
                            return row ? String(row.id) : '';
                          };
                          const fromId = findByCode(r.from_unit_code, units);
                          const toId = ((r.activity||'').toUpperCase() === 'TANKER_TO_TANKER')
                            ? findByCode(r.to_unit_code, units)
                            : findByCode(r.to_unit_code, datums);
                          setFromUnit(fromId);
                          setToUnit(toId);
                          setVol(String(r.transfer_volume_liters||''));
                          const d = r.transfer_date ? new Date(r.transfer_date) : (r.performed_at ? new Date(r.performed_at) : null);
                          setTransferDate(d ? fmtDateInput(d) : fmtDateInput(new Date()));
                          // Prefer explicit transfer_time; else fall back to time part of performed_at if present
                          if (typeof r.transfer_time === 'string' && r.transfer_time) {
                            const t = r.transfer_time.slice(0,5);
                            setTransferTime(t);
                          } else {
                            setTransferTime((hh && mm) ? `${hh}:${mm}` : '');
                          }
                          const drv = (Array.isArray(drivers)?drivers:[]).find(x => String(x.name) === String(r.driver_name||''));
                          setDriverId(drv ? String(drv.id) : (drivers && drivers[0] ? String(drivers[0].id) : ''));
                        }}>Edit</button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SaleSection({ token, units, datums, drivers, refreshStock }) {
  // Read-only: retain date/activity filters if needed for future expansion but remove creation controls
  const [saleDate, setSaleDate] = useState(() => fmtDateInput(new Date()));
  const [activity, setActivity] = useState('ALL'); // ALL | TANKER_TO_VEHICLE | DATUM_TO_VEHICLE
  const [msg] = useState('');
  // Simple sales list state
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesRows, setSalesRows] = useState([]);
  // Sale window indicator (day readings present?)
  const [windowInfo, setWindowInfo] = useState({ status: 'unknown', opening_at: null, closing_at: null });

  const sourceList = [...units, ...datums];
  useEffect(() => { reloadSalesList(); }, [token]);
  // Fetch sale window info when fromUnit and saleDate change (only for truck source)
  useEffect(() => {
    let aborted = false;
    (async () => { setWindowInfo({ status:'na', opening_at:null, closing_at:null }); })();
    return () => { aborted = true; };
  }, [saleDate, activity, token]);
  async function reloadSalesList() {
    setSalesLoading(true);
    try {
      const r = await fetch('/api/fuel-ops/transfers/sales/list?limit=100', { headers: { Accept:'application/json', ...(token?{ Authorization:'Bearer '+token }: {}) } });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data && data.error ? data.error : 'Failed to load sales');
      setSalesRows((data && data.items) ? data.items : []);
    } catch { setSalesRows([]); } finally { setSalesLoading(false); }
  }
  return (
    <div className="card" style={{ padding: 16, maxWidth: 900 }}>
      <div style={{ fontSize:12, color:'#374151', marginBottom:12 }}>
        Sales tab is read-only. Creation of sale records is disabled here per requirement. Use At Depot timeline for operational entries.
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          Filter Date (optional)
          <input type="date" value={saleDate} onChange={e=>setSaleDate(e.target.value)} style={{ padding:8 }} />
        </label>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          Filter Activity
          <select value={activity} onChange={e=>setActivity(e.target.value)} style={{ padding:8 }}>
            <option value="ALL">All</option>
            <option value="TANKER_TO_VEHICLE">Tanker to Vehicle</option>
            <option value="DATUM_TO_VEHICLE">Datum to Vehicle</option>
          </select>
        </label>
      </div>
      <div style={{ marginTop:24, paddingTop:12, borderTop:'1px solid #eee' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <div style={{ fontWeight:600 }}>Sales transfer records</div>
          <button className="btn ghost" disabled={salesLoading} onClick={reloadSalesList} style={{ padding:'4px 10px', fontSize:12 }}>{salesLoading? 'Loading…':'Refresh'}</button>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ textAlign:'left' }}>
                <th>Date</th>
                <th>From Unit Code</th>
                <th>To Vehicle</th>
                <th>Sale Volume (L)</th>
                <th>Lot Code After</th>
                <th>Driver Name</th>
                <th>Performed By</th>
                <th>Trip</th>
                <th>Performed At</th>
                <th>Activity</th>
              </tr>
            </thead>
            <tbody>
              {(salesRows||[]).length===0 ? (
                <tr><td colSpan={9} style={{ padding:8, color:'#6b7280' }}>{salesLoading ? 'Loading…' : 'No records'}</td></tr>
              ) : (
                salesRows
                  .filter(r => activity==='ALL' || r.activity===activity)
                  .filter(r => !saleDate || (r.sale_date && r.sale_date.slice(0,10)===saleDate) || (r.performed_at && r.performed_at.slice(0,10)===saleDate))
                  .map(r => (
                    <tr key={r.id}>
                      <td>{r.sale_date ? new Date(r.sale_date).toLocaleDateString() : (r.performed_at ? new Date(r.performed_at).toLocaleDateString() : '-')}</td>
                      <td>{r.from_unit_code}</td>
                      <td>{r.to_vehicle}</td>
                      <td>{r.sale_volume_liters}</td>
                      <td>{r.lot_code_after}</td>
                      <td>{r.driver_name || '-'}</td>
                      <td>{r.performed_by || '-'}</td>
                      <td>{r.trip != null ? r.trip : '-'}</td>
                      <td>{r.performed_at ? new Date(r.performed_at).toLocaleString() : '-'}</td>
                      <td>{r.activity || '-'}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ReadingsSection({ token, units, unitId, setUnitId, drivers, driverRowId, setDriverRowId, dailyDate, setDailyDate, openKm, setOpenKm, closeKm, setCloseKm, odoNote, setOdoNote, postingOdo, setPostingOdo }) {
  // Only odometer reading remains; dispenser form removed.
  const [hasOdoRecord, setHasOdoRecord] = useState(false);
  const [openingTime, setOpeningTime] = useState('');
  const [closingTime, setClosingTime] = useState('');
  const [list, setList] = useState([]);
  const [listLoading, setListLoading] = useState(false);

  // Check existing odometer record for selected truck/date to enable Edit
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        setHasOdoRecord(false);
        if (!unitId || !dailyDate) return;
        const auth = token ? { Authorization: 'Bearer ' + token } : {};
        const r = await fetch(`/api/fuel-ops/day/odometer?truck_id=${unitId}&date=${dailyDate}`, { headers: { Accept:'application/json', ...auth } });
        const data = await safeJson(r);
        if (!aborted && data && data.truck_id) {
          setHasOdoRecord(true);
          try {
            const ot = data.opening_at ? new Date(data.opening_at) : null;
            const ct = data.closing_at ? new Date(data.closing_at) : null;
            setOpeningTime(ot ? String(ot.getHours()).padStart(2,'0')+':'+String(ot.getMinutes()).padStart(2,'0') : '');
            setClosingTime(ct ? String(ct.getHours()).padStart(2,'0')+':'+String(ct.getMinutes()).padStart(2,'0') : '');
          } catch {}
        } else if (!aborted) {
          setOpeningTime(''); setClosingTime('');
        }
        // load recent list
        setListLoading(true);
        try {
          const lr = await fetch(`/api/fuel-ops/day/odometer/list?truck_id=${unitId}&limit=90`, { headers: { Accept:'application/json', ...auth } });
          const lj = await safeJson(lr);
          if (!aborted) setList((lj && lj.items) ? lj.items : []);
        } catch { if (!aborted) setList([]); } finally { if (!aborted) setListLoading(false); }
      } catch {}
    })();
    return () => { aborted = true; };
  }, [unitId, dailyDate, token]);
  return (
    <div className="card" style={{ padding: 16, maxWidth: 720 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#374151' }}>
          Select Truck
          <select value={unitId} onChange={e=>setUnitId(e.target.value)} style={{ padding: 8 }}>
            {units.map(u => (<option key={u.id} value={u.id}>{u.unit_code}{u.vehicle_number?` · ${u.vehicle_number}`:''}</option>))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#374151' }}>
          Date
          <input type="date" value={dailyDate} onChange={e=>setDailyDate(e.target.value)} style={{ padding: 8 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#374151', gridColumn: '1 / 2' }}>
          Driver
          <select value={driverRowId} onChange={e=>setDriverRowId(e.target.value)} style={{ padding: 8 }}>
            {(Array.isArray(drivers) ? drivers : []).map(d => (<option key={d.id} value={d.id}>{d.driver_id} · {d.name}</option>))}
          </select>
        </label>
      </div>

      <div style={{ marginTop: 18, paddingTop: 12, borderTop: '1px solid #eee' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Odometer reading</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#374151' }}>
            Opening Reading (km)
            <input type="number" step="0.1" min={0} value={openKm} onChange={e=>setOpenKm(e.target.value)} placeholder="auto from yesterday or enter first time" style={{ padding: 8 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#374151' }}>
            Opening Time (optional)
            <input type="time" value={openingTime} onChange={e=>setOpeningTime(e.target.value)} style={{ padding: 8 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#374151' }}>
            Closing Reading (km)
            <input type="number" step="0.1" min={0} value={closeKm} onChange={e=>setCloseKm(e.target.value)} placeholder="required" style={{ padding: 8 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#374151' }}>
            Closing Time (optional)
            <input type="time" value={closingTime} onChange={e=>setClosingTime(e.target.value)} style={{ padding: 8 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#374151' }}>
            Note
            <input value={odoNote} onChange={e=>setOdoNote(e.target.value)} placeholder="optional" style={{ padding: 8 }} />
          </label>
          <div style={{ display:'flex', gap:12 }}>
            <button className="btn" disabled={postingOdo || !unitId || !dailyDate || openKm==='' || closeKm===''} onClick={async()=>{
              setPostingOdo(true);
              try {
                const headers = { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) };
                const drow = drivers.find(d => String(d.id) === String(driverRowId));
                const odoBody = { truck_id: parseInt(unitId,10), date: dailyDate, opening_km: Number(openKm), closing_km: Number(closeKm), note: odoNote || undefined, driver_name: drow ? drow.name : undefined, driver_code: drow ? drow.driver_id : undefined };
                if (openingTime) odoBody.opening_time = openingTime;
                if (closingTime) odoBody.closing_time = closingTime;
                const r2 = await fetch('/api/fuel-ops/day/odometer', { method: 'POST', headers, body: JSON.stringify(odoBody) });
                const j2 = await safeJson(r2);
                if (!r2.ok) throw new Error(j2.error || 'Failed to save odometer reading');
                alert('Truck odometer reading saved');
              } catch (e) { alert(e.message); }
              finally { setPostingOdo(false); }
            }}>Save Odometer Reading</button>
            <button className="btn ghost" disabled={!hasOdoRecord || postingOdo || !unitId || !dailyDate || openKm==='' || closeKm===''} onClick={async()=>{
              setPostingOdo(true);
              try {
                const headers = { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) };
                const drow = drivers.find(d => String(d.id) === String(driverRowId));
                const odoBody = { truck_id: parseInt(unitId,10), date: dailyDate, opening_km: Number(openKm), closing_km: Number(closeKm), note: odoNote || undefined, driver_name: drow ? drow.name : undefined, driver_code: drow ? drow.driver_id : undefined };
                if (openingTime) odoBody.opening_time = openingTime;
                if (closingTime) odoBody.closing_time = closingTime;
                const r2 = await fetch('/api/fuel-ops/day/odometer', { method: 'PATCH', headers, body: JSON.stringify(odoBody) });
                const j2 = await safeJson(r2);
                if (!r2.ok) throw new Error(j2.error || 'Failed to update odometer reading');
                alert('Truck odometer reading updated');
              } catch (e) { alert(e.message); }
              finally { setPostingOdo(false); }
            }}>Edit</button>
          </div>
        </div>
      </div>

      {/* Dispenser day records removed */}

      {/* List of odometer day readings */}
      <div style={{ marginTop:18, paddingTop:12, borderTop:'1px solid #eee' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <div style={{ fontWeight:600 }}>Recent odometer day readings</div>
          <button className="btn ghost" disabled={listLoading} onClick={async()=>{
            setListLoading(true);
            try {
              const auth = token ? { Authorization: 'Bearer ' + token } : {};
              const lr = await fetch(`/api/fuel-ops/day/odometer/list?truck_id=${unitId}&limit=90`, { headers: { Accept:'application/json', ...auth } });
              const lj = await safeJson(lr);
              setList((lj && lj.items) ? lj.items : []);
            } catch { setList([]); } finally { setListLoading(false); }
          }} style={{ padding:'4px 10px', fontSize:12 }}>{listLoading? 'Loading…' : 'Refresh'}</button>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ textAlign:'left' }}>
                <th>Date</th>
                <th>Opening (km)</th>
                <th>Closing (km)</th>
                <th>Opening Time</th>
                <th>Closing Time</th>
                <th>Driver</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(list||[]).length===0 ? (
                <tr><td colSpan={7} style={{ padding:8, color:'#6b7280' }}>{listLoading? 'Loading…' : 'No records'}</td></tr>
              ) : (
                list.map(row => (
                  <tr key={row.id}>
                    <td>{row.reading_date ? new Date(row.reading_date).toLocaleDateString() : '-'}</td>
                    <td>{row.opening_km}</td>
                    <td>{row.closing_km}</td>
                    <td>{row.opening_at ? new Date(row.opening_at).toLocaleTimeString() : '-'}</td>
                    <td>{row.closing_at ? new Date(row.closing_at).toLocaleTimeString() : '-'}</td>
                    <td>{row.driver_name || '-'}</td>
                    <td style={{ display:'flex', gap:8 }}>
                      <button className="btn ghost" onClick={()=>{
                        setDailyDate(row.reading_date ? row.reading_date.slice(0,10) : '');
                        setOpenKm(String(row.opening_km));
                        setCloseKm(String(row.closing_km));
                        try {
                          const ot = row.opening_at ? new Date(row.opening_at) : null;
                          const ct = row.closing_at ? new Date(row.closing_at) : null;
                          setOpeningTime(ot ? String(ot.getHours()).padStart(2,'0')+':'+String(ot.getMinutes()).padStart(2,'0') : '');
                          setClosingTime(ct ? String(ct.getHours()).padStart(2,'0')+':'+String(ct.getMinutes()).padStart(2,'0') : '');
                        } catch {}
                      }}>Edit</button>
                      <button className="btn ghost" onClick={async()=>{
                        if (!window.confirm('Delete this record?')) return;
                        const auth = token ? { Authorization: 'Bearer ' + token } : {};
                        const r = await fetch(`/api/fuel-ops/day/odometer?id=${row.id}`, { method:'DELETE', headers: { Accept:'application/json', ...auth } });
                        const j = await safeJson(r);
                        if (!r.ok) { alert(j && j.error ? j.error : 'Delete failed'); return; }
                        setList(xs => xs.filter(x => x.id !== row.id));
                      }}>Delete</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Meter checks moved to dedicated Fuel Meter Checks tab */}
    </div>
  );
}

function FuelMeterChecksSection({ token, units }) {
  return (
    <div className="card" style={{ padding:16, maxWidth: 900 }}>
      {/* Quick meter snapshot */}
      <div style={{ marginTop: 4, paddingTop: 4 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Quick meter snapshot</div>
        <SnapshotCapture token={token} units={units} />
      </div>
      {/* Daily reconciliation */}
      <div style={{ marginTop: 24, paddingTop: 12, borderTop:'1px solid #eee' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Daily reconciliation</div>
        <DailyReconcile token={token} units={units} />
      </div>
      {/* Off-hours monitor */}
      <div style={{ marginTop: 24, paddingTop: 12, borderTop:'1px solid #eee' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Off-hours monitor</div>
        <OffHoursCard token={token} units={units} />
      </div>
    </div>
  );
}

function SnapshotCapture({ token, units }) {
  const [truckId, setTruckId] = useState('');
  const [reading, setReading] = useState('');
  const [when, setWhen] = useState('');
  const [posting, setPosting] = useState(false);
  return (
    <div className="card" style={{ padding: 12, maxWidth: 720 }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap: 8 }}>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          Truck / Datum
          <select value={truckId} onChange={e=>setTruckId(e.target.value)} style={{ padding: 8 }}>
            <option value="">Select</option>
            {(units||[]).filter(u=>u.unit_type==='TRUCK' || u.unit_type==='DATUM').map(u => (
              <option key={u.id} value={u.id}>{u.unit_code}{u.vehicle_number?` · ${u.vehicle_number}`:''}{u.unit_type==='DATUM'? ' (DATUM)':''}</option>
            ))}
          </select>
        </label>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          Meter Reading (L)
          <input type="number" min={0} step={0.001} value={reading} onChange={e=>setReading(e.target.value)} style={{ padding:8 }} />
        </label>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          Time
          <input type="datetime-local" value={when} onChange={e=>setWhen(e.target.value)} style={{ padding:8 }} />
        </label>
        <div style={{ display:'flex', alignItems:'flex-end' }}>
          <button className="btn" disabled={posting || !truckId || !reading} onClick={async()=>{
            setPosting(true);
            try {
              const body = { truck_id: parseInt(truckId,10), reading_liters: Number(reading) };
              if (when) body.reading_at = when.replace('T',' ') + ':00';
              const r = await fetch('/api/fuel-ops/meter-snapshots', { method:'POST', headers:{ 'Content-Type':'application/json', Accept:'application/json', ...(token?{ Authorization:'Bearer '+token }: {}) }, body: JSON.stringify(body) });
              const data = await safeJson(r);
              if (!r.ok) throw new Error(data.error || 'Failed to save snapshot');
              alert('Snapshot saved');
              setTruckId(''); setReading(''); setWhen('');
            } catch (e) { alert(String(e.message||e)); } finally { setPosting(false); }
          }}>{posting? 'Saving…':'Save Snapshot'}</button>
        </div>
      </div>
    </div>
  );
}

function OffHoursCard({ token, units }) {
  const [truckId, setTruckId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tolerance, setTolerance] = useState('2');
  const [loading, setLoading] = useState(false);
  const [row, setRow] = useState(null);
  const [error, setError] = useState('');
  async function run() {
    setLoading(true); setError(''); setRow(null);
    try {
      if (!truckId || !from || !to) throw new Error('Select truck, from, and to');
      const r = await fetch(`/api/fuel-ops/offhours?truck_id=${truckId}&from=${encodeURIComponent(from.replace('T',' ') + ':00')}&to=${encodeURIComponent(to.replace('T',' ') + ':00')}`, { headers:{ Accept:'application/json', ...(token?{ Authorization:'Bearer '+token }: {}) } });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data.error || 'Failed to compute');
      setRow(data);
    } catch (e) { setError(String(e.message||e)); } finally { setLoading(false); }
  }
  return (
    <div className="card" style={{ padding:12, maxWidth: 880 }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 120px auto', gap:8 }}>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          Truck / Datum
          <select value={truckId} onChange={e=>setTruckId(e.target.value)} style={{ padding:8 }}>
            <option value="">Select</option>
            {(units||[]).filter(u=>u.unit_type==='TRUCK' || u.unit_type==='DATUM').map(u => (
              <option key={u.id} value={u.id}>{u.unit_code}{u.vehicle_number?` · ${u.vehicle_number}`:''}{u.unit_type==='DATUM'? ' (DATUM)':''}</option>
            ))}
          </select>
        </label>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          From
          <input type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)} style={{ padding:8 }} />
        </label>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          To
          <input type="datetime-local" value={to} onChange={e=>setTo(e.target.value)} style={{ padding:8 }} />
        </label>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          Tolerance (L)
          <input type="number" min={0} step={0.1} value={tolerance} onChange={e=>setTolerance(e.target.value)} style={{ padding:8 }} />
        </label>
        <div style={{ display:'flex', alignItems:'flex-end' }}>
          <button className="btn" disabled={loading} onClick={run}>{loading? 'Checking…':'Check'}</button>
        </div>
      </div>
      {error && (<div style={{ marginTop:8, color:'#b91c1c' }}>{error}</div>)}
      {row && (
        <div style={{ marginTop: 12, fontSize: 13 }}>
          <div>Meter Δ: <b>{row.meter_delta == null ? '-' : row.meter_delta}</b></div>
          <div>Sales: <b>{row.sales}</b> · Transfers Out: <b>{row.transfers_out}</b> · Transfers In: <b>{row.transfers_in}</b></div>
          <div>Expected Δ: <b>{row.expected_delta}</b></div>
          <div>Residual: <b style={{ color: row.residual != null && Math.abs(row.residual) > Number(tolerance||0) ? '#b91c1c' : '#065f46' }}>{row.residual == null ? '-' : row.residual}</b></div>
        </div>
      )}
    </div>
  );
}

function DailyReconcile({ token, units }) {
  const [truckId, setTruckId] = useState('');
  const [date, setDate] = useState(() => fmtDateInput(new Date()));
  const [loading, setLoading] = useState(false);
  const [row, setRow] = useState(null);
  const [tolerance, setTolerance] = useState('2');
  return (
    <div className="card" style={{ padding:12, maxWidth: 720 }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 120px 1fr auto', gap: 8 }}>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          Truck / Datum
          <select value={truckId} onChange={e=>setTruckId(e.target.value)} style={{ padding:8 }}>
            <option value="">Select</option>
            {(units||[]).filter(u=>u.unit_type==='TRUCK' || u.unit_type==='DATUM').map(u => (
              <option key={u.id} value={u.id}>{u.unit_code}{u.vehicle_number?` · ${u.vehicle_number}`:''}{u.unit_type==='DATUM'? ' (DATUM)':''}</option>
            ))}
          </select>
        </label>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          Date
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{ padding:8 }} />
        </label>
        <label style={{ display:'flex', flexDirection:'column', fontSize:12, color:'#374151' }}>
          Tolerance (L)
          <input type="number" min={0} step={0.1} value={tolerance} onChange={e=>setTolerance(e.target.value)} style={{ padding:8 }} />
        </label>
        <div style={{ display:'flex', alignItems:'flex-end' }}>
          <button className="btn" disabled={loading || !truckId || !date} onClick={async()=>{
            setLoading(true);
            try {
              const r = await fetch(`/api/fuel-ops/reconcile/daily?truck_id=${truckId}&date=${date}`, { headers:{ Accept:'application/json', ...(token?{ Authorization:'Bearer '+token }: {}) } });
              const data = await safeJson(r);
              if (!r.ok) throw new Error(data.error || 'Failed to reconcile');
              setRow(data);
            } catch (e) { alert(String(e.message||e)); } finally { setLoading(false); }
          }}>{loading? 'Checking…':'Reconcile'}</button>
        </div>
      </div>
      {row && (
        <div style={{ marginTop: 12, fontSize: 13 }}>
          <div>Opening: <b>{row.opening}</b> at {row.opening_at}</div>
          <div>Closing: <b>{row.closing}</b> at {row.closing_at}</div>
          <div>Sales: <b>{row.sales}</b> · Transfers Out: <b>{row.transfers_out}</b> · Transfers In: <b>{row.transfers_in}</b> · Testing: <b>{row.testing_used_liters}</b></div>
          <div>Meter ΔM: <b>{row.delta_meter}</b> · Expected ΔE: <b>{row.delta_expected}</b> · Difference: <b style={{ color: Math.abs(row.delta_difference) > Number(tolerance||0) ? '#b91c1c' : '#065f46' }}>{row.delta_difference}</b></div>
        </div>
      )}
    </div>
  );
}

function VehicleCreate({ token, onCreated }) {
  const [type, setType] = useState('TRUCK');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [code, setCode] = useState('');
  const [capacity, setCapacity] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      const r = await fetch('/api/fuel-ops/storage-units', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ unit_type: type, unit_code: code, capacity_liters: parseInt(capacity,10), vehicle_number: vehicleNumber }) });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data.error || 'Failed to create vehicle');
      onCreated && onCreated(data);
      setVehicleNumber(''); setCode(''); setCapacity('');
    } catch (e) { alert(e.message); } finally { setSaving(false); }
  }
  return (
    <div className="card" style={{ padding: 16, maxWidth: 800 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr auto', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#374151' }}>
          Type
          <select value={type} onChange={e=>setType(e.target.value)} style={{ padding: 8 }}>
            <option value="TRUCK">Vehicle</option>
            <option value="DATUM">DATUM</option>
            <option value="STORAGE">Other Storage</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#374151' }}>
          Vehicle No.
          <input value={vehicleNumber} onChange={e=>setVehicleNumber(e.target.value)} placeholder="e.g., AP09 AB 1234" style={{ padding: 8 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#374151' }}>
          Vehicle Code
          <input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="e.g., 4T1" style={{ padding: 8 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#374151' }}>
          Capacity (L)
          <input type="number" min={1} step={1} value={capacity} onChange={e=>setCapacity(e.target.value)} placeholder="e.g., 4000" style={{ padding: 8 }} />
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button className="btn" disabled={saving || !code || !capacity} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function VehicleRow({ token, unit, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ vehicle_number: unit.vehicle_number || '', unit_code: unit.unit_code || '', capacity_liters: unit.capacity_liters || '', active: !!unit.active });
  async function save() {
    try {
      const r = await fetch(`/api/fuel-ops/storage-units/${unit.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(form) });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data.error || 'Failed to update');
      onUpdated && onUpdated(data); setEditing(false);
    } catch (e) { alert(e.message); }
  }
  if (!editing) return (
    <tr>
      <td>{unit.unit_code}</td>
      <td>{unit.vehicle_number || unit.vehicle_no || '-'}</td>
      <td>{unit.capacity_liters}</td>
      <td>{unit.active? 'Active':'Inactive'}</td>
      <td><button className="btn" onClick={()=>setEditing(true)}>Edit</button></td>
    </tr>
  );
  return (
    <tr>
      <td><input value={form.unit_code} onChange={e=>setForm({...form, unit_code:e.target.value})} style={{width:'100%',padding:6}} /></td>
      <td><input value={form.vehicle_number} onChange={e=>setForm({...form, vehicle_number:e.target.value})} style={{width:'100%',padding:6}} /></td>
      <td><input type="number" min={1} step={1} value={form.capacity_liters} onChange={e=>setForm({...form, capacity_liters:e.target.value})} style={{width:'100%',padding:6}} /></td>
      <td>
        <select value={form.active? '1':'0'} onChange={e=>setForm({...form, active: e.target.value==='1'})} style={{padding:6}}>
          <option value="1">Active</option>
          <option value="0">Inactive</option>
        </select>
      </td>
      <td style={{display:'flex',gap:8}}>
        <button className="btn" onClick={save}>Save</button>
        <button className="btn ghost" onClick={()=>{ setEditing(false); setForm({ vehicle_number: unit.vehicle_number || '', unit_code: unit.unit_code || '', capacity_liters: unit.capacity_liters || '', active: !!unit.active }); }}>Cancel</button>
      </td>
    </tr>
  );
}

function DriverCreate({ token, onCreated }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      const r = await fetch('/api/fuel-ops/drivers', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ name, phone, driver_id: code }) });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data.error || 'Failed to create driver');
      onCreated && onCreated(data);
      setName(''); setPhone(''); setCode('');
    } catch (e) { alert(e.message); } finally { setSaving(false); }
  }
  return (
    <div className="card" style={{ padding: 16, maxWidth: 800 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12 }}>
        <input placeholder="Driver name" value={name} onChange={e=>setName(e.target.value)} style={{ padding: 8 }} />
        <input placeholder="Phone" value={phone} onChange={e=>setPhone(e.target.value)} style={{ padding: 8 }} />
        <input placeholder="Driver ID" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} style={{ padding: 8 }} />
        <button className="btn" disabled={saving || !name || !code} onClick={save}>{saving? 'Saving…':'Save'}</button>
      </div>
    </div>
  );
}

function DriversList({ token, drivers, setDrivers }) {
  return (
    <div className="card" style={{ padding: 16, marginTop: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Drivers</div>
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ textAlign:'left' }}>
              <th>Driver ID</th><th>Name</th><th>Phone</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map(d => (<DriverRow key={d.id} token={token} row={d} onUpdated={(nd)=> setDrivers(xs => xs.map(x => x.id===nd.id? nd : x))} />))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DriverRow({ token, row, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: row.name || '', phone: row.phone || '', driver_id: row.driver_id || '', active: !!row.active });
  async function save() {
    try {
      const r = await fetch(`/api/fuel-ops/drivers/${row.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(form) });
      const data = await safeJson(r);
      if (!r.ok) throw new Error(data.error || 'Failed to update driver');
      onUpdated && onUpdated(data); setEditing(false);
    } catch (e) { alert(e.message); }
  }
  if (!editing) return (
    <tr>
      <td>{row.driver_id}</td><td>{row.name}</td><td>{row.phone||'-'}</td><td>{row.active? 'Active':'Inactive'}</td>
      <td><button className="btn" onClick={()=>setEditing(true)}>Edit</button></td>
    </tr>
  );
  return (
    <tr>
      <td><input value={form.driver_id} onChange={e=>setForm({...form, driver_id:e.target.value})} style={{width:'100%',padding:6}} /></td>
      <td><input value={form.name} onChange={e=>setForm({...form, name:e.target.value})} style={{width:'100%',padding:6}} /></td>
      <td><input value={form.phone} onChange={e=>setForm({...form, phone:e.target.value})} style={{width:'100%',padding:6}} /></td>
      <td>
        <select value={form.active? '1':'0'} onChange={e=>setForm({...form, active: e.target.value==='1'})} style={{padding:6}}>
          <option value="1">Active</option>
          <option value="0">Inactive</option>
        </select>
      </td>
      <td style={{display:'flex',gap:8}}>
        <button className="btn" onClick={save}>Save</button>
        <button className="btn ghost" onClick={()=>{ setEditing(false); setForm({ name: row.name || '', phone: row.phone || '', driver_id: row.driver_id || '', active: !!row.active }); }}>Cancel</button>
      </td>
    </tr>
  );
}

// Helper: robust JSON parsing with nice HTML error surface
async function safeJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text || 'null');
  } catch {
    throw new Error(text && text.trim().startsWith('<') ? `Unexpected HTML from server (status ${response.status}). Check API server/proxy.` : (text || `HTTP ${response.status}`));
  }
}
