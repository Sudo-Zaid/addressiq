import { flagOf } from './api'

// How an order is drawn on the map — the colour is always its flag:
//   Found (green) / Two options (navy): a pin; its accuracy circle shows when the order is selected
//   Area only (yellow):                 a pin plus a yellow circle around the area, always visible
//   Call first (red):                   nothing was found, so only a reference is drawn — a red dashed circle around the
//                                       city the address names (result.hint), with the order's pin inside it
export const AREA_FILL = '#F5B800'
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function orderMarkers(orders, { sel = null, override = {} } = {}) {
  let calls = 0
  return orders.map(o => {
    const f = flagOf(o.flag), selected = sel === o.id
    const hint = o.lat == null ? o.result?.hint : null
    if (o.lat == null && !hint) return null
    const head = `<b>${esc(o.customer_name)}</b><br/>${esc(o.address_text)}<br/><span style="color:${f.color};font-weight:700">${f.label}</span>`
    let k
    if (hint) {
      // every call-first order of one city shares the city circle; the pins sit on a small ring so each one can be clicked
      const n = calls++, a = n * 2.4, d = n ? 0.3 * hint.radius_m : 0
      k = { lat: hint.lat + (d * Math.cos(a)) / 110540, lon: hint.lon + (d * Math.sin(a)) / (111320 * Math.cos(hint.lat * Math.PI / 180)),
        radius: hint.radius_m, rlat: hint.lat, rlon: hint.lon, dashed: true,
        html: `${head} · not on the map<br/>The red circle is only the city (${esc(hint.name)}${hint.assumed ? ', assumed' : ''}).` }
    } else {
      const area = o.flag === 'AREA-ONLY'
      k = { lat: o.lat, lon: o.lon, radius: selected || area ? o.radius_m : 0, fill: area ? AREA_FILL : undefined, html: `${head} · within ${Math.round(o.radius_m || 0)} m` }
    }
    return { id: String(o.id), color: f.color, selected, alternatives: selected ? (o.result?.alternatives || []) : [], ...k, ...(override[o.id] || {}) }
  }).filter(Boolean)
}
