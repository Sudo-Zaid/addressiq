import { useState } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'
import { flagOf, copyText, mapsUrl } from '../api'

const LEVEL = { PREMISE: 'Exact door', STREET: 'Street level', LANDMARK: 'Landmark level', COLONY: 'Area level' }
const point = (lat, lon) => lat.toFixed(6) + ', ' + lon.toFixed(6)

// The numbers behind an order's pin: how big the circle is, where its centre is, and what that centre really is.
// "Found" only means the place is on the map; it is "confirmed" once a delivery (or the dispatcher) has placed it.
export default function OrderFacts({ o }) {
  const [copied, setCopied] = useState('')
  const copy = async (text) => { if (await copyText(text)) { setCopied(text); setTimeout(() => setCopied(''), 1600) } }
  const coords = (lat, lon) => { const t = point(lat, lon); return <button type="button" className="chip-code" onClick={() => copy(t)} title="Latitude, longitude — click to copy">{t} {copied === t ? <Check size={12} /> : <Copy size={12} />}</button> }
  const check = (lat, lon) => <a className="font-semibold text-sky whitespace-nowrap" href={mapsUrl(lat, lon)} target="_blank" rel="noreferrer">Check on Google Maps <ExternalLink size={11} className="inline -mt-0.5" /></a>

  const hint = o.result?.hint
  if (o.lat == null) return <div className="mt-3 rounded-xl bg-red/10 px-3 py-2 text-xs font-semibold text-red">
    No pin, so no radius and no coordinates: this address is not on the map.{hint && ` The red circle is only the city (${hint.name}, ${(hint.radius_m / 1000).toFixed(1)} km).`}</div>

  const m = o.result?.matched || {}, n = m.premise_observations
  const place = m.landmark?.name || m.street?.name || m.area?.name
  const what = n ? `Confirmed by ${n} earlier deliver${n === 1 ? 'y' : 'ies'} to this exact address.`
    : o.corrected ? 'Confirmed: the dispatcher placed this pin by hand.'
    : o.flag === 'AREA-ONLY' ? `The pin is the centre of ${place || 'the area'}; the door can be anywhere in the yellow circle.`
    : `The pin is ${place ? place + ' on OpenStreetMap' : 'the matched place on OpenStreetMap'}, not the door itself. Found on the map, not confirmed by a delivery yet.`
  return <div className="mt-3">
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={flagOf(o.flag).cls} title="The door can be this far from the pin, in any direction">Radius {Math.round(o.radius_m || 0)} m</span>
      {coords(o.lat, o.lon)}
    </div>
    <div className="mt-1.5 text-[11px] leading-snug text-muted">{LEVEL[o.granularity] || o.granularity} · {what} {check(o.lat, o.lon)}</div>
    {o.status === 'delivered' && o.delivered_lat != null && <>
      <div className="mt-2 flex flex-wrap items-center gap-1.5"><span className="chip-found">Delivered here</span>{coords(o.delivered_lat, o.delivered_lon)}</div>
      <div className="mt-1.5 text-[11px] leading-snug text-muted">Where the rider pressed Delivered{o.delivered_acc != null ? ` (phone GPS ± ${Math.round(o.delivered_acc)} m)` : ' (no GPS reading, so this is the pin position)'}. {check(o.delivered_lat, o.delivered_lon)}</div></>}
  </div>
}
