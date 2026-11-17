import { useEffect, useRef, useState } from 'react'
import { api, flagOf, fmtMoney } from '../api'
import { orderMarkers } from '../orderPins'
import MapView from '../components/MapView'
import { Chip, StatusChip, Empty, Toast, Spinner } from '../components/ui'
import { Upload, Plus, Trash2, Crosshair, MapPinned, Check, X, FileDown, Package } from 'lucide-react'

export default function Orders() {
  const [orders, setOrders] = useState([]); const [zones, setZones] = useState([]); const [riders, setRiders] = useState([]); const [sel, setSel] = useState(null)
  const [adding, setAdding] = useState(false); const [form, setForm] = useState({ customer_name: '', phone: '', address_text: '', amount: '' }); const [busy, setBusy] = useState(false)
  const [fixing, setFixing] = useState(null); const [fixPos, setFixPos] = useState(null); const [toast, setToast] = useState(null); const file = useRef(); const [focus, setFocus] = useState(0)
  const say = (msg, kind) => { setToast({ msg, kind }); setTimeout(() => setToast(null), 2600) }
  const load = async () => { const [o, z, r] = await Promise.all([api.get('/api/orders'), api.get('/api/zones'), api.get('/api/riders')]); setOrders(o); setZones(z); setRiders(r) }
  useEffect(() => { load().catch(e => say(e.message, 'err')); const t = setInterval(() => { if (!fixing) load().catch(() => {}) }, 10000); return () => clearInterval(t) }, [fixing])
  const cur = orders.find(o => o.id === sel)

  async function upload(f) { if (!f) return; setBusy(true); try { const r = await api.upload('/api/orders/upload', f); say(`${r.created} orders added, geocoded and assigned`); await load() } catch (e) { say(e.message, 'err') } finally { setBusy(false); file.current.value = '' } }
  async function add(e) { e.preventDefault(); setBusy(true); try { const o = await api.post('/api/orders', { ...form, amount: Number(form.amount || 0) }); setForm({ customer_name: '', phone: '', address_text: '', amount: '' }); setAdding(false); await load(); setSel(o.id); say(`${flagOf(o.flag).label}: ${o.explanation}`) } catch (e) { say(e.message, 'err') } finally { setBusy(false) } }
  async function assign(o, rid) { try { await api.post(`/api/orders/${o.id}/assign`, { rider_id: rid ? Number(rid) : null }); await load() } catch (e) { say(e.message, 'err') } }
  async function saveFix() { try { await api.post(`/api/orders/${fixing}/correct`, fixPos); setFixing(null); setFixPos(null); await load(); say('Pin saved — this address is now learned') } catch (e) { say(e.message, 'err') } }
  async function clearAll() { if (!confirm('Delete all orders?')) return; await api.del('/api/orders'); setSel(null); await load() }

  // the order being fixed becomes a blue pin the dispatcher can drag; it has no circle while it is being moved
  const markers = orderMarkers(orders, { sel, override: fixing && fixPos ? { [fixing]: { ...fixPos, color: '#2563eb', radius: 0, rlat: undefined, rlon: undefined, alternatives: [], draggable: true, pulse: true } } : {} })
  const pick = (id) => { setSel(id); setFocus(f => f + 1) }      // clicking the same order again frames it again
  // xl: one fixed-height row, so the table scrolls inside its card and the map always fits the screen
  return <div className="grid xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_460px] xl:grid-rows-[minmax(0,1fr)] gap-5 xl:h-full xl:min-h-[560px]">
    <div className="flex flex-col gap-4 min-w-0 xl:min-h-0">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={file} type="file" accept=".csv" className="hidden" onChange={e => upload(e.target.files[0])} />
        <button className="btn-primary" onClick={() => file.current.click()} disabled={busy}>{busy ? <Spinner /> : <Upload size={16} />} Upload CSV</button>
        <button className="btn-ghost" onClick={() => setAdding(a => !a)}><Plus size={16} /> Add one address</button>
        <a className="btn-ghost" href="/sample_orders.csv" download><FileDown size={16} /> Sample CSV</a>
        <div className="ml-auto flex items-center gap-2"><span className="text-xs text-muted">{orders.length} orders</span>{orders.length > 0 && <button className="btn-ghost text-red" onClick={clearAll}><Trash2 size={16} /> Clear</button>}</div>
      </div>
      {adding && <form onSubmit={add} autoComplete="off" className="card p-4 grid md:grid-cols-[1fr_1fr_2fr_120px_auto] gap-3 items-end">
        <div><label className="label">Customer</label><input className="input" value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} required /></div>
        <div><label className="label">Phone</label><input className="input" inputMode="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
        <div><label className="label">Address (as the customer wrote it)</label><input className="input" value={form.address_text} onChange={e => setForm({ ...form, address_text: e.target.value })} placeholder='e.g. "Makan 7, Pak Uk Hospital ke samne, Jhelum"' required /></div>
        <div><label className="label">COD (Rs)</label><input className="input" inputMode="numeric" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
        <button className="btn-primary w-full md:w-auto py-3" disabled={busy}>{busy ? <Spinner /> : <><MapPinned size={16} /> Find on map &amp; assign</>}</button>
      </form>}
      <div className="card overflow-auto flex-1 min-h-[300px] max-h-[70vh] xl:max-h-none">
        {orders.length === 0 ? <Empty icon={Package} title="No orders yet" text="Upload the sample CSV (15 real Jhelum & Dina addresses) or add one address." /> :
        <table className="table"><thead><tr><th>Customer</th><th>Address</th><th>Result</th><th>Zone</th><th>Rider</th><th>Status</th><th></th></tr></thead>
          <tbody>{orders.map(o => <tr key={o.id} className={sel === o.id ? 'sel cursor-pointer' : 'cursor-pointer hover:bg-ice/60'} onClick={() => pick(o.id)}>
            <td><div className="font-semibold">{o.customer_name}</div><div className="text-xs text-muted">{o.phone} · {fmtMoney(o.amount)}</div></td>
            <td className="max-w-[260px]"><div className="truncate" title={o.address_text}>{o.address_text}</div></td>
            <td><Chip flag={o.flag} />{o.lat != null && <div className="text-[11px] text-muted mt-1">{o.granularity} · {Math.round(o.radius_m)} m</div>}</td>
            <td className="text-xs">{o.zone_name ? <span className="font-semibold" style={{ color: o.zone_color }}>{o.zone_name}</span> : <span className="text-muted">—</span>}</td>
            <td onClick={e => e.stopPropagation()}><select className="input py-1.5 text-xs min-w-[150px]" value={o.rider_id || ''} onChange={e => assign(o, e.target.value)} disabled={o.status === 'delivered' || o.lat == null}><option value="">— unassigned —</option>{riders.map(r => <option key={r.id} value={r.id}>{r.name}{r.zone_name ? ` (${r.zone_name})` : ''}</option>)}</select></td>
            <td><StatusChip s={o.status} /></td>
            <td onClick={e => e.stopPropagation()}>{o.status !== 'delivered' && (fixing === o.id ?
              <div className="flex gap-1"><button className="btn-green px-2 py-1.5" onClick={saveFix} disabled={!fixPos} title="Save pin"><Check size={14} /></button><button className="btn-ghost px-2 py-1.5" onClick={() => { setFixing(null); setFixPos(null) }}><X size={14} /></button></div> :
              <button className="btn-ghost px-2 py-1.5" title="Fix the pin by dragging it" onClick={() => { const h = o.result?.hint; setSel(o.id); setFixing(o.id); setFixPos(o.lat != null ? { lat: o.lat, lon: o.lon } : (h ? { lat: h.lat, lon: h.lon } : { lat: 32.9247, lon: 73.7194 })) }}><Crosshair size={14} /></button>)}</td>
          </tr>)}</tbody></table>}
      </div>
    </div>
    <div className="flex flex-col gap-4 min-w-0 xl:min-h-0 xl:overflow-auto">
      <div className="card p-2 h-[360px] xl:h-auto xl:flex-1 xl:min-h-[300px]"><MapView markers={markers} zones={zones} onMarkerClick={(id) => pick(Number(id))} onMarkerDrag={(id, p) => { if (Number(id) === fixing) setFixPos(p) }} onClick={(p) => { if (fixing) setFixPos(p) }} fit={fixing ? null : (sel ? 'selected' : 'markers')} focusKey={focus} /></div>
      {fixing && <div className="card p-3 text-sm bg-blue-50 border-blue-200"><b>Fix pin:</b> drag the blue pin (or click the map) to where the customer actually is, then press ✓. The address is saved to the learning store.</div>}
      {cur && <div className="card p-4 text-sm">
        <div className="flex items-start gap-2"><MapPinned size={18} className="text-bright mt-0.5" /><div className="min-w-0"><div className="font-bold text-bright">{cur.customer_name}</div><div className="text-muted">{cur.address_text}</div></div><div className="ml-auto"><Chip flag={cur.flag} /></div></div>
        <p className="mt-3">{cur.explanation}</p>
        {cur.result?.matched && Object.keys(cur.result.matched).length > 0 && <div className="mt-3 grid gap-1 text-xs">
          {cur.result.matched.landmark && <div><span className="label inline mr-2">Landmark</span>{cur.result.matched.landmark.name}{cur.result.matched.landmark.relation && <span className="text-muted"> · "{cur.result.matched.landmark.relation}"</span>}</div>}
          {cur.result.matched.street && <div><span className="label inline mr-2">Street</span>{cur.result.matched.street.name}</div>}
          {cur.result.matched.area && <div><span className="label inline mr-2">Area</span>{cur.result.matched.area.name}</div>}
          {cur.result.matched.premise_observations && <div><span className="label inline mr-2">Learned</span>from {cur.result.matched.premise_observations} earlier deliveries</div>}
        </div>}
        {cur.result?.not_found?.length > 0 && <div className="mt-2 text-xs text-red">Not on the map: {cur.result.not_found.join(', ')}</div>}
        {cur.result?.candidates?.length > 1 && <details className="mt-3"><summary className="text-xs font-semibold text-bright cursor-pointer">Other candidates ({cur.result.candidates.length - 1})</summary>
          <ul className="mt-1 text-xs text-muted">{cur.result.candidates.slice(1, 5).map((c, i) => <li key={i}>{c.name} <span className="opacity-70">({c.category}) score {c.score}</span></li>)}</ul></details>}
      </div>}
    </div>
    <Toast msg={toast?.msg} kind={toast?.kind} />
  </div>
}
