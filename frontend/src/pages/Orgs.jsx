import { useEffect, useState } from 'react'
import { api } from '../api'
import { Toast, Spinner } from '../components/ui'
import { Building2, Plus, Power, Copy, Users, Bike, Map, Package, Brain, Trash2 } from 'lucide-react'

const TYPES = [['courier', 'Courier company'], ['restaurant', 'Restaurant / food'], ['shop', 'Online shop'], ['other', 'Other']]

export default function Orgs() {
  const [orgs, setOrgs] = useState([]); const [stats, setStats] = useState(null); const [adding, setAdding] = useState(false); const [busy, setBusy] = useState(false); const [toast, setToast] = useState(null)
  const [f, setF] = useState({ name: '', type: 'courier', contact: '', seller_username: '', seller_password: '', seller_name: '' })
  const say = (msg, kind) => { setToast({ msg, kind }); setTimeout(() => setToast(null), 2800) }
  const load = () => Promise.all([api.get('/api/admin/orgs'), api.get('/api/stats')]).then(([o, s]) => { setOrgs(o); setStats(s) }).catch(e => say(e.message, 'err'))
  useEffect(() => { load() }, [])
  async function add(e) { e.preventDefault(); setBusy(true); try { await api.post('/api/admin/orgs', f); setF({ name: '', type: 'courier', contact: '', seller_username: '', seller_password: '', seller_name: '' }); setAdding(false); await load(); say('Organization created — give them the seller login and the rider join code') } catch (ex) { say(ex.message, 'err') } finally { setBusy(false) } }
  async function toggle(o) { try { await api.post(`/api/admin/orgs/${o.id}/active`, { active: !o.active }); await load(); say(o.active ? `${o.name} disabled — their logins stop working` : `${o.name} enabled`) } catch (ex) { say(ex.message, 'err') } }
  async function remove(o) {
    if (!confirm(`Delete "${o.name}" permanently?\n\nThis removes its ${o.sellers.length} dispatcher login(s), ${o.riders} rider(s), ${o.zones} zone(s) and ${o.stats.orders} order(s). Shared learning-store points are kept.\n\nTip: use Disable if you may need it again.`)) return
    try { await api.del(`/api/admin/orgs/${o.id}`); await load(); say(`${o.name} deleted`) } catch (ex) { say(ex.message, 'err') }
  }
  const copy = (t) => { navigator.clipboard?.writeText(t); say('Copied: ' + t) }
  const pct = (s) => s.orders ? Math.round(100 * s.found / s.orders) : 0
  const K = ({ v, l }) => <div className="kpi"><div className="v">{v ?? '–'}</div><div className="l">{l}</div></div>
  return <div className="grid gap-5">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3"><K v={stats?.organizations} l="Active organizations" /><K v={stats?.orders} l="Orders (all)" /><K v={stats?.delivered} l="Delivered (all)" /><K v={stats?.premises_learned} l="Addresses learned (shared)" /></div>
    <div className="card p-4 text-sm flex items-start gap-3"><Brain className="text-bright shrink-0 mt-0.5" size={18} /><div><b className="text-bright">One map, many organizations.</b> Each organization has its own logins, zones, riders and orders — nobody sees another company's data. The learning store is <b>shared</b>: a delivery confirmed by Leopard Courier makes the same address exact for Chaaye Khaana tomorrow. It holds only address text and a GPS point, never a name or phone.</div></div>
    <div className="flex items-center gap-2"><h3 className="font-bold text-bright text-lg">Organizations</h3><button className="btn-primary ml-auto" onClick={() => setAdding(a => !a)}><Plus size={16} /> Add organization</button></div>
    {adding && <form onSubmit={add} className="card p-4 grid md:grid-cols-3 gap-3 items-end">
      <div><label className="label">Organization name</label><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required placeholder="e.g. TCS Jhelum" /></div>
      <div><label className="label">Type</label><select className="input" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <div><label className="label">Contact (optional)</label><input className="input" value={f.contact} onChange={e => setF({ ...f, contact: e.target.value })} placeholder="email or phone" /></div>
      <div><label className="label">Dispatcher login — username</label><input className="input" value={f.seller_username} onChange={e => setF({ ...f, seller_username: e.target.value })} required autoCapitalize="none" /></div>
      <div><label className="label">Dispatcher login — password</label><input className="input" value={f.seller_password} onChange={e => setF({ ...f, seller_password: e.target.value })} required minLength={6} /></div>
      <button className="btn-primary py-3" disabled={busy}>{busy ? <Spinner /> : 'Create organization'}</button>
    </form>}
    <div className="grid lg:grid-cols-2 gap-4">{orgs.map(o => <div key={o.id} className={'card p-4 ' + (o.active ? '' : 'opacity-60')}>
      <div className="flex items-start gap-3">
        <span className={'w-11 h-11 rounded-xl grid place-items-center shrink-0 ' + (o.active ? 'bg-navy text-amber' : 'bg-ice-2 text-muted')}><Building2 size={22} /></span>
        <div className="min-w-0 flex-1"><div className="font-extrabold text-bright truncate">{o.name}</div><div className="text-xs text-muted capitalize">{o.type}{o.contact && ` · ${o.contact}`}</div></div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => toggle(o)} className={'btn px-3 py-1.5 text-xs ' + (o.active ? 'bg-green/12 text-green' : 'bg-red/12 text-red')}><Power size={14} /> {o.active ? 'Active' : 'Disabled'}</button>
          <button onClick={() => remove(o)} title="Delete organization" className="btn px-2.5 py-1.5 text-xs bg-white border border-line text-muted hover:text-red hover:border-red/40 dark:bg-white/5"><Trash2 size={14} /></button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
        <div className="rounded-xl bg-ice p-2"><div className="font-extrabold text-bright">{o.stats.orders}</div><div className="text-[10px] uppercase font-semibold text-muted">orders</div></div>
        <div className="rounded-xl bg-ice p-2"><div className="font-extrabold text-green">{pct(o.stats)}%</div><div className="text-[10px] uppercase font-semibold text-muted">found</div></div>
        <div className="rounded-xl bg-ice p-2"><div className="font-extrabold text-bright">{o.riders}</div><div className="text-[10px] uppercase font-semibold text-muted">riders</div></div>
        <div className="rounded-xl bg-ice p-2"><div className="font-extrabold text-bright">{o.zones}</div><div className="text-[10px] uppercase font-semibold text-muted">zones</div></div>
      </div>
      <div className="mt-3 text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
        <span><Users size={12} className="inline mr-1" />Dispatcher: {o.sellers.map(s => <b key={s.id} className="text-ink">{s.username}</b>).reduce((a, b) => a === null ? [b] : [...a, ', ', b], null) || '—'}</span>
        <span><Bike size={12} className="inline mr-1" />Rider join code: <b className="text-ink">{o.join_code}</b> <button className="text-sky font-semibold" onClick={() => copy(o.join_code)}><Copy size={12} className="inline" /></button></span>
        <span><Package size={12} className="inline mr-1" />{o.stats.delivered} delivered · <Map size={12} className="inline mx-1" />{o.contributed} confirmations shared</span>
      </div>
    </div>)}</div>
    <Toast msg={toast?.msg} kind={toast?.kind} />
  </div>
}
