import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, flagOf, fmtMoney, timeAgo } from '../api'
import MapView from '../components/MapView'
import { Chip, StatusChip, Empty } from '../components/ui'
import { Package, Upload } from 'lucide-react'

export default function Dashboard() {
  const [stats, setStats] = useState(null); const [orders, setOrders] = useState([]); const [zones, setZones] = useState([]); const [riders, setRiders] = useState([]); const [sel, setSel] = useState(null)
  useEffect(() => {
    const load = () => Promise.all([api.get('/api/stats'), api.get('/api/orders'), api.get('/api/zones'), api.get('/api/riders')]).then(([s, o, z, r]) => { setStats(s); setOrders(o); setZones(z); setRiders(r) }).catch(console.error)
    load(); const t = setInterval(load, 10000); return () => clearInterval(t)   // live: new orders / deliveries appear without a reload
  }, [])
  const markers = orders.filter(o => o.lat != null).map(o => ({ id: String(o.id), lat: o.lat, lon: o.lon, color: flagOf(o.flag).color, radius: sel === o.id ? o.radius_m : 0, selected: sel === o.id,
    html: `<b>${o.customer_name}</b><br/>${o.address_text}<br/><span style="color:${flagOf(o.flag).color};font-weight:700">${flagOf(o.flag).label}</span> · ${Math.round(o.radius_m || 0)} m` }))
  const K = ({ v, l, c }) => <div className="kpi"><div className="v" style={{ color: c }}>{v ?? '–'}</div><div className="l">{l}</div></div>
  return <div className="grid gap-5">
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <K v={stats?.orders} l="Orders" /><K v={stats?.found} l="Found" c="#3C8D5A" /><K v={stats?.area_only} l="Area only" c="#b4731a" /><K v={stats?.ambiguous} l="Two options" c="#2E4A8B" /><K v={stats?.unresolved} l="Call first" c="#C0392B" /><K v={stats?.delivered} l="Delivered" />
    </div>
    <div className="grid xl:grid-cols-[1fr_360px] gap-5 xl:min-h-[560px]">
      <div className="card p-2 h-[420px] xl:h-auto xl:min-h-[460px]"><MapView markers={markers} zones={zones} onMarkerClick={(id) => setSel(Number(id))} fit={sel ? 'selected' : 'markers'} /></div>
      <div className="grid gap-5 content-start">
        <div className="card p-4">
          <div className="flex items-center justify-between"><h3 className="font-bold text-bright">Latest orders</h3><Link to="/app/orders" className="text-xs font-semibold text-sky">All orders →</Link></div>
          {orders.length === 0 ? <Empty icon={Package} title="No orders yet" text="Upload the sample CSV to see pins, colours and auto-assignment." action={<Link to="/app/orders" className="btn-primary mt-2"><Upload size={16} />Upload orders</Link>} /> :
            <ul className="mt-3 divide-y divide-line/60">{orders.slice(0, 8).map(o => <li key={o.id} onClick={() => setSel(o.id)} className={'py-2.5 cursor-pointer -mx-2 px-2 rounded-lg hover:bg-ice ' + (sel === o.id ? 'bg-ice' : '')}>
              <div className="flex items-center gap-2"><span className="font-semibold text-sm truncate">{o.customer_name}</span><span className="ml-auto text-xs text-muted">{fmtMoney(o.amount)}</span></div>
              <div className="text-xs text-muted truncate">{o.address_text}</div>
              <div className="mt-1 flex items-center gap-2"><Chip flag={o.flag} /><StatusChip s={o.status} />{o.rider_name && <span className="text-xs text-muted">→ {o.rider_name}</span>}<span className="ml-auto text-[11px] text-muted">{timeAgo(o.created_at)}</span></div></li>)}</ul>}
        </div>
        <div className="card p-4"><h3 className="font-bold text-bright">Riders</h3>
          <ul className="mt-3 space-y-2">{riders.map(r => <li key={r.id} className="flex items-center gap-3 text-sm"><span className="w-8 h-8 rounded-full bg-ice-2 grid place-items-center font-bold text-bright text-xs">{r.name[0]}</span>
            <div className="min-w-0"><div className="font-semibold truncate">{r.name}</div><div className="text-xs text-muted">{r.zone_name || <span className="text-red font-semibold">no zone yet</span>}</div></div>
            <div className="ml-auto text-right text-xs"><div className="font-bold text-bright">{r.open} open</div><div className="text-muted">{r.delivered} done</div></div></li>)}</ul>
        </div>
      </div>
    </div>
  </div>
}
