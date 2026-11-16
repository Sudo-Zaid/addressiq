import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api, flagOf, fmtMoney, navUrl } from '../api'
import MapView from '../components/MapView'
import { Chip, Spinner, Toast } from '../components/ui'
import { ArrowLeft, Navigation, PhoneCall, CheckCircle2, MapPin } from 'lucide-react'

export default function RiderOrder() {
  const { id } = useParams(); const [o, setO] = useState(null); const [me, setMe] = useState(null); const [busy, setBusy] = useState(false); const [toast, setToast] = useState(null)
  const say = (msg, kind) => { setToast({ msg, kind }); setTimeout(() => setToast(null), 3200) }
  useEffect(() => { api.get('/api/orders').then(l => setO(l.find(x => x.id === Number(id)))).catch(console.error) }, [id])
  if (!o) return <div className="text-center text-muted py-10">Loading…</div>
  const f = flagOf(o.flag); const canNav = o.lat != null && o.flag !== 'UNRESOLVED'
  function deliver() {
    setBusy(true)
    const post = async (lat, lon, acc) => { try { const r = await api.post(`/api/orders/${o.id}/delivered`, { lat, lon, accuracy: acc }); setO(r); say(acc != null ? `Delivered · GPS ±${Math.round(acc)} m saved — this address is now learned` : 'Delivered · pin location saved') } catch (e) { say(e.message, 'err') } finally { setBusy(false) } }
    if (!navigator.geolocation) return post(o.lat, o.lon, null)
    navigator.geolocation.getCurrentPosition(p => { setMe({ lat: p.coords.latitude, lon: p.coords.longitude }); post(p.coords.latitude, p.coords.longitude, p.coords.accuracy) },
      () => { say('GPS not available here (needs HTTPS on phones) — saving the pin location instead', 'err'); post(o.lat ?? 32.9247, o.lon ?? 73.7194, null) }, { enableHighAccuracy: true, timeout: 12000 })
  }
  return <div className="space-y-4">
    <Link to="/rider" className="inline-flex items-center gap-1 text-sm font-semibold text-navy"><ArrowLeft size={16} /> My stops</Link>
    <div className="card p-4"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="font-extrabold text-lg text-navy">{o.customer_name}</div><div className="text-sm text-muted">{o.address_text}</div></div><div className="text-right"><div className="font-extrabold text-navy">{fmtMoney(o.amount)}</div><div className="text-[11px] text-muted">cash on delivery</div></div></div>
      <div className="mt-3 flex items-center gap-2 flex-wrap"><Chip flag={o.flag} /><span className="text-xs text-muted">{f.hint}{o.lat != null && ` · within ${Math.round(o.radius_m)} m`}</span></div></div>
    <div className="card p-1.5 h-[300px]"><MapView markers={o.lat != null ? [{ id: 'o', lat: o.lat, lon: o.lon, color: f.color, radius: o.radius_m, selected: true, alternatives: o.result?.alternatives || [] }] : []} me={me} zoom={14} /></div>
    <div className="card p-4 text-sm"><div className="flex items-start gap-2"><MapPin size={16} className="text-navy mt-0.5 shrink-0" /><span>{o.explanation}</span></div>
      {o.result?.matched?.landmark && <div className="mt-2 text-xs text-muted">Landmark: <b className="text-ink">{o.result.matched.landmark.name}</b>{o.result.matched.landmark.relation && ` · "${o.result.matched.landmark.relation}"`}</div>}
      {o.result?.alternatives?.length > 0 && <div className="mt-2 text-xs text-muted">Other option: <b className="text-ink">{o.result.alternatives[0].name}</b> (dashed line on the map)</div>}</div>
    {o.status === 'delivered' ? <div className="card p-4 bg-green/10 border-green/30 flex items-center gap-3 text-green font-bold"><CheckCircle2 /> Delivered{o.delivered_acc != null && <span className="text-xs font-semibold ml-auto">GPS ±{Math.round(o.delivered_acc)} m saved</span>}</div> :
      <div className="grid grid-cols-2 gap-3">
        {o.phone ? <a className="btn-ghost py-3" href={`tel:${o.phone}`}><PhoneCall size={18} /> Call {o.flag === 'UNRESOLVED' ? 'first' : ''}</a> : <span />}
        <a className={'btn-primary py-3 ' + (canNav ? '' : 'opacity-40 pointer-events-none')} href={canNav ? navUrl(o.lat, o.lon) : '#'} target="_blank" rel="noreferrer"><Navigation size={18} /> Navigate</a>
        <button className="btn-green py-4 col-span-2 text-base" onClick={deliver} disabled={busy}>{busy ? <Spinner /> : <><CheckCircle2 size={20} /> Delivered here</>}</button>
        {!canNav && <div className="col-span-2 text-xs text-red font-semibold text-center">Navigation is off for this order — the address could not be placed. Call the customer, then the shop can fix the pin.</div>}
      </div>}
    <Toast msg={toast?.msg} kind={toast?.kind} />
  </div>
}
