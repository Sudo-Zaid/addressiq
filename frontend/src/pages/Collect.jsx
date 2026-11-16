import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import MapView, { JHELUM } from '../components/MapView'
import { Logo, Spinner, Toast } from '../components/ui'
import { LocateFixed, Send } from 'lucide-react'

function hav(a, b) { const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180, s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)) }

export default function Collect({ standalone = false }) {
  const [f, setF] = useState({ address_text: '', premise_type: 'home', city: 'Jhelum', consent_project: true, consent_public: false })
  const [gps, setGps] = useState(null); const [pin, setPin] = useState(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState(null); const [toast, setToast] = useState(null)
  const say = (msg, kind) => { setToast({ msg, kind }); setTimeout(() => setToast(null), 3000) }
  function locate() {
    if (!navigator.geolocation) return say('No GPS in this browser', 'err')
    navigator.geolocation.getCurrentPosition(p => { const g = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; setGps(g); setPin({ lat: g.lat, lon: g.lon }) },
      e => say(e.code === 1 ? 'Location permission denied' : 'GPS needs HTTPS on phones — on this laptop demo, click the map to place the pin', 'err'), { enableHighAccuracy: true, timeout: 12000 })
  }
  const drag = gps && pin ? hav(gps, pin) : 0
  async function submit(e) {
    e.preventDefault(); if (!pin) return say('Capture GPS or click the map first', 'err'); setBusy(true)
    try { const r = await api.post('/api/collect', { ...f, lat: pin.lat, lon: pin.lon, accuracy: gps?.acc ?? null, drag_m: drag }); setDone(r) } catch (ex) { say(ex.message, 'err') } finally { setBusy(false) }
  }
  const body = done ? <div className="card p-8 text-center"><div className="text-5xl">✅</div><h2 className="text-xl font-extrabold text-navy mt-3">Saved — thank you!</h2><p className="text-sm text-muted mt-1">Record code <b className="text-navy">{done.record_code}</b> · status <b>{done.status}</b>{done.status !== 'AUTO' && ' (the team will verify it)'}</p>
    <button className="btn-primary mt-5" onClick={() => { setDone(null); setGps(null); setPin(null); setF({ ...f, address_text: '' }) }}>Add another address</button></div> :
    <form onSubmit={submit} className="grid lg:grid-cols-2 gap-5">
      <div className="card p-5 space-y-4">
        <div><label className="label">Address — exactly as you would tell a rider</label><textarea className="input min-h-[90px]" value={f.address_text} onChange={e => setF({ ...f, address_text: e.target.value })} placeholder='e.g. "Gali 3, Jamia Masjid ke peeche, Islampura"' required /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Place type</label><select className="input" value={f.premise_type} onChange={e => setF({ ...f, premise_type: e.target.value })}><option value="home">Home</option><option value="shop">Shop</option><option value="office">Office</option><option value="public">Public building</option></select></div>
          <div><label className="label">Town</label><select className="input" value={f.city} onChange={e => setF({ ...f, city: e.target.value })}><option>Jhelum</option><option>Dina</option></select></div>
        </div>
        <div className="rounded-xl bg-ice p-3 text-sm space-y-2">
          <label className="flex gap-2 items-start"><input type="checkbox" checked={f.consent_project} onChange={e => setF({ ...f, consent_project: e.target.checked })} required /><span><b>Project use</b> (required): the team and supervisor may use this record for training and evaluation. Stored encrypted; no name or phone is saved.</span></label>
          <label className="flex gap-2 items-start"><input type="checkbox" checked={f.consent_public} onChange={e => setF({ ...f, consent_public: e.target.checked })} /><span><b>Public release</b> (optional): shops exact; homes coarsened to a 100 m grid with house numbers removed.</span></label>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" className="btn-amber" onClick={locate}><LocateFixed size={16} /> Capture GPS at the gate</button>
          {gps && <span className="text-xs text-muted">±{Math.round(gps.acc)} m {gps.acc <= 25 ? <b className="text-green">good</b> : <b className="text-red">weak — move outdoors</b>}{drag > 0 && ` · pin moved ${Math.round(drag)} m`}</span>}
        </div>
        <button className="btn-primary w-full py-3" disabled={busy || !pin}>{busy ? <Spinner /> : <><Send size={16} /> Save record</>}</button>
      </div>
      <div className="card p-2 h-[380px] lg:h-auto lg:min-h-[380px]"><MapView markers={pin ? [{ id: 'p', lat: pin.lat, lon: pin.lon, color: '#1F3864', draggable: true, radius: gps?.acc || 0 }] : []} center={JHELUM} zoom={13} fit={pin ? 'markers' : null} onClick={(p) => setPin(p)} onMarkerDrag={(_, p) => setPin(p)} /></div>
    </form>
  if (!standalone) return <div className="grid gap-4"><div className="text-sm text-muted">Volunteer data-collection form (module M1). Stand at the gate or shop front, type the address the way people say it, capture GPS, save. Shareable link: <Link to="/collect" className="text-navy font-semibold">/collect</Link></div>{body}<Toast msg={toast?.msg} kind={toast?.kind} /></div>
  return <div className="min-h-full p-4 lg:p-8 max-w-5xl mx-auto"><div className="flex items-center justify-between mb-5"><Logo /><Link to="/login" className="text-sm font-semibold text-navy">Sign in</Link></div>
    <h1 className="text-2xl font-extrabold text-navy">Help us map Jhelum's addresses</h1><p className="text-sm text-muted mt-1 mb-5">One minute: type the address the way you would tell a rider, press "Capture GPS" while standing at the gate, save.</p>{body}<Toast msg={toast?.msg} kind={toast?.kind} /></div>
}
