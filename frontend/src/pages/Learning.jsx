import { useEffect, useState } from 'react'
import { api, timeAgo } from '../api'
import MapView from '../components/MapView'
import { Empty } from '../components/ui'
import { Brain } from 'lucide-react'

export default function Learning() {
  const [obs, setObs] = useState([]); const [stats, setStats] = useState(null)
  useEffect(() => { Promise.all([api.get('/api/learning'), api.get('/api/stats')]).then(([o, s]) => { setObs(o); setStats(s) }).catch(console.error) }, [])
  const markers = obs.map(o => ({ id: 'o' + o.id, lat: o.lat, lon: o.lon, color: o.trusted ? '#3C8D5A' : '#E8A33D', radius: Math.max(15, o.accuracy || 25), html: `<b>${o.address_text}</b><br/>${o.source} · ±${Math.round(o.accuracy || 0)} m` }))
  const K = ({ v, l }) => <div className="kpi"><div className="v">{v ?? '–'}</div><div className="l">{l}</div></div>
  return <div className="grid gap-5">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3"><K v={stats?.observations} l="Confirmed deliveries" /><K v={stats?.premises_learned} l="Addresses learned" /><K v={stats?.collection} l="Volunteer records" /><K v={stats ? `${stats.gazetteer.landmarks + stats.gazetteer.streets + stats.gazetteer.areas}` : null} l="Map places (OSM)" /></div>
    <div className="card p-4 text-sm"><b className="text-navy">How learning works.</b> When a rider taps <b>Delivered here</b> (or the seller fixes a pin), the address text and the GPS point are saved — never a name or phone. The next order to the <b>same address</b> gets the exact door (radius 25 m). Confirmed points also help <b>neighbours</b>: a new address in the same street scores higher near confirmed pins, even if the street is missing from the map. A point is trusted only when the phone's GPS accuracy is 25 m or better.</div>
    <div className="grid xl:grid-cols-[1fr_440px] gap-5 min-h-[480px]">
      <div className="card p-2 min-h-[420px]"><MapView markers={markers} /></div>
      <div className="card overflow-auto">{obs.length === 0 ? <Empty icon={Brain} title="Nothing learned yet" text="Deliver an order from the rider app, or fix a pin in Orders, and it will appear here." /> :
        <table className="table"><thead><tr><th>Address</th><th>Source</th><th>GPS ±</th><th>When</th></tr></thead><tbody>{obs.map(o => <tr key={o.id}><td className="max-w-[220px]"><div className="truncate" title={o.address_text}>{o.address_text}</div>{o.rider_name && <div className="text-xs text-muted">{o.rider_name}</div>}</td><td className="text-xs">{o.source.replace('_', ' ')}{o.trusted ? <span className="chip-found ml-1">trusted</span> : ''}</td><td className="text-xs">{o.accuracy != null ? Math.round(o.accuracy) + ' m' : '—'}</td><td className="text-xs text-muted">{timeAgo(o.created_at)}</td></tr>)}</tbody></table>}</div>
    </div>
  </div>
}
