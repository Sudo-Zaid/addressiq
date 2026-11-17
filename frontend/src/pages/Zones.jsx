import { useEffect, useState } from 'react'
import { api } from '../api'
import MapView from '../components/MapView'
import { Toast } from '../components/ui'
import { PenTool, Check, X, Trash2, Users } from 'lucide-react'

const COLORS = ['#1F3864', '#3C8D5A', '#8E44AD', '#E8A33D', '#C0392B', '#0E7490']

export default function Zones() {
  const [zones, setZones] = useState([]); const [riders, setRiders] = useState([]); const [draw, setDraw] = useState(null); const [name, setName] = useState(''); const [toast, setToast] = useState(null)
  const say = (msg, kind) => { setToast({ msg, kind }); setTimeout(() => setToast(null), 2600) }
  const load = async () => { const [z, r] = await Promise.all([api.get('/api/zones'), api.get('/api/riders')]); setZones(z); setRiders(r) }
  useEffect(() => { load().catch(e => say(e.message, 'err')) }, [])
  async function save() { try { await api.post('/api/zones', { name: name || `Zone ${zones.length + 1}`, color: draw.color, polygon: draw.points }); setDraw(null); setName(''); await load(); say('Zone saved') } catch (e) { say(e.message, 'err') } }
  async function del(z) { if (!confirm(`Delete zone "${z.name}"?`)) return; await api.del(`/api/zones/${z.id}`); await load() }
  async function setZone(r, zid) { await api.post(`/api/riders/${r.id}/zone`, { zone_id: zid ? Number(zid) : null }); await load(); say(`${r.name} → ${zid ? zones.find(z => z.id === Number(zid))?.name : 'no zone'}`) }
  const pending = riders.filter(r => !r.zone_id)
  return <div className="grid xl:grid-cols-[1fr_400px] gap-5 xl:items-start">
    <div className="flex flex-col gap-3 min-w-0 xl:sticky xl:top-0">
      <div className="flex flex-wrap items-center gap-2">
        {!draw ? <button className="btn-primary" onClick={() => setDraw({ points: [], color: COLORS[zones.length % COLORS.length] })}><PenTool size={16} /> Draw a new zone</button> :
          <><span className="text-sm font-semibold text-bright">Click the map to add corners ({draw.points.length})</span>
            <input className="input w-56" placeholder="Zone name (e.g. Civil Lines)" value={name} onChange={e => setName(e.target.value)} />
            <button className="btn-green" onClick={save} disabled={draw.points.length < 3}><Check size={16} /> Save zone</button>
            <button className="btn-ghost" onClick={() => setDraw(null)}><X size={16} /> Cancel</button></>}
        <span className="ml-auto text-xs text-muted">An order is auto-assigned to the rider of the zone its pin falls in.</span>
      </div>
      <div className="card p-2 h-[420px] xl:h-[calc(100vh-10.5rem)] xl:min-h-[440px]"><MapView zones={zones} draw={draw} fit="zones" onClick={(p) => { if (draw) setDraw({ ...draw, points: [...draw.points, [p.lat, p.lon]] }) }} /></div>
    </div>
    <div className="grid grid-cols-1 gap-4 content-start min-w-0">
      <div className="card p-4"><h3 className="font-bold text-bright">Zones</h3>
        <ul className="mt-3 space-y-2">{zones.map(z => <li key={z.id} className="flex items-center gap-3 rounded-xl border border-line p-3 text-sm"><span className="w-3.5 h-3.5 rounded-full" style={{ background: z.color }} />
          <div className="min-w-0"><div className="font-semibold">{z.name}</div><div className="text-xs text-muted">{z.riders.length ? z.riders.map(r => r.name).join(', ') : <span className="text-red font-semibold">no rider</span>} · {z.open_orders} open orders</div></div>
          <button className="ml-auto text-muted hover:text-red" onClick={() => del(z)}><Trash2 size={16} /></button></li>)}</ul>
      </div>
      <div className="card p-4"><h3 className="font-bold text-bright flex items-center gap-2"><Users size={18} /> Riders {pending.length > 0 && <span className="chip-unres ml-auto">{pending.length} waiting for a zone</span>}</h3>
        <ul className="mt-3 space-y-2">{riders.map(r => <li key={r.id} className={'rounded-xl border p-3 text-sm ' + (!r.zone_id ? 'border-red/40 bg-red/5' : 'border-line')}>
          <div className="flex items-center gap-2"><span className="w-8 h-8 rounded-full bg-ice-2 grid place-items-center font-bold text-bright text-xs">{r.name[0]}</span><div><div className="font-semibold">{r.name}</div><div className="text-xs text-muted">@{r.username} · {r.phone || 'no phone'} · {r.open} open / {r.delivered} delivered</div></div></div>
          <select className="input mt-2 py-1.5 text-xs" value={r.zone_id || ''} onChange={e => setZone(r, e.target.value)}><option value="">— no zone (gets nothing) —</option>{zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></li>)}</ul>
      </div>
    </div>
    <Toast msg={toast?.msg} kind={toast?.kind} />
  </div>
}
