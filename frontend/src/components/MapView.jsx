import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'

// Basemap = OpenFreeMap vector tiles: OpenStreetMap data, no API key, street and landmark names at every zoom.
// "liberty" is the normal map, "dark" goes with the dark theme. If OpenFreeMap cannot be reached the map
// falls back to plain OpenStreetMap raster tiles, so it is never blank.
const OFM = 'https://tiles.openfreemap.org'
const GLYPHS = OFM + '/fonts/{fontstack}/{range}.pbf'
const isDark = () => document.documentElement.classList.contains('dark')
const styleUrl = () => `${OFM}/styles/${isDark() ? 'dark' : 'liberty'}`
const FALLBACK = {
  version: 8, glyphs: GLYPHS,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}
// Satellite photo (free Esri World Imagery, no key). Real tiles exist up to zoom 18 over Jhelum/Dina; beyond that MapLibre stretches them.
const SAT = { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }
// label text: the Latin-script name; a place that only has an Urdu-script name gets no label rather than an Urdu one
const NAME_EN = ['case', ['has', 'name:latin'], ['get', 'name:latin'], ['has', 'name:nonlatin'], '', ['coalesce', ['get', 'name_en'], ['get', 'name']]]
// the stock "dark" style is nearly black on black; these retint it to the app's navy so roads, water and names can be read
const NIGHT = [
  ['background', 'background-color', '#0B1424'], ['water', 'fill-color', '#14305C'], ['waterway', 'line-color', '#14305C'],
  ['landuse_residential', 'fill-color', '#101D33'], ['landcover_wood', 'fill-color', '#0F2A2C'], ['landuse_park', 'fill-color', '#11322D'],
  ['building', 'fill-color', '#17273F'], ['building', 'fill-outline-color', '#223656'],
  ['highway_path', 'line-color', '#263753'], ['highway_minor', 'line-color', '#30425F'],
  ['highway_major_casing', 'line-color', '#0B1424'], ['highway_major_inner', 'line-color', '#465B85'], ['highway_major_subtle', 'line-color', '#465B85'],
  ['highway_motorway_casing', 'line-color', '#0B1424'], ['highway_motorway_inner', 'line-color', '#7388B6'], ['highway_motorway_subtle', 'line-color', '#7388B6'],
  ['railway', 'line-color', '#384962'], ['railway_minor', 'line-color', '#384962'], ['railway_transit', 'line-color', '#384962'],
]
const BASEMAP = 'aiq_basemap'
const savedSat = () => { try { return localStorage.getItem(BASEMAP) === 'sat' } catch { return false } }
export const JHELUM = [73.7194, 32.9247]

const fc = (features) => ({ type: 'FeatureCollection', features })
function circle([lon, lat], r, n = 48) {
  const out = []
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n
    out.push([lon + (r * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (r * Math.sin(a)) / 110540])
  }
  return out
}
const ring = (pts) => [[...pts.map(p => [p[1], p[0]]), [pts[0][1], pts[0][0]]]]
const drawn = (zones) => (zones || []).filter(z => z.polygon?.length >= 3)
const zoneFeatures = (zones) => drawn(zones).map(z => ({
  type: 'Feature', properties: { color: z.color || '#1F3864' }, geometry: { type: 'Polygon', coordinates: ring(z.polygon) } }))
// one name per zone, at its middle (a label on the polygon itself is repeated in every map tile the zone touches)
const zoneLabels = (zones) => drawn(zones).map(z => ({
  type: 'Feature', properties: { name: z.name, color: z.color || '#1F3864' },
  geometry: { type: 'Point', coordinates: [z.polygon.reduce((s, p) => s + p[1], 0) / z.polygon.length, z.polygon.reduce((s, p) => s + p[0], 0) / z.polygon.length] } }))
function drawFeatures(draw) {
  const f = []
  if (!draw?.points?.length) return f
  const c = draw.color || '#1F3864'
  draw.points.forEach(p => f.push({ type: 'Feature', properties: { color: c }, geometry: { type: 'Point', coordinates: [p[1], p[0]] } }))
  if (draw.points.length >= 2) f.push({ type: 'Feature', properties: { color: c }, geometry: { type: 'LineString', coordinates: draw.points.map(p => [p[1], p[0]]) } })
  if (draw.points.length >= 3) f.push({ type: 'Feature', properties: { color: c }, geometry: { type: 'Polygon', coordinates: ring(draw.points) } })
  return f
}
// relation band = annulus dmin..dmax around a landmark
const bandFeatures = (bands) => (bands || []).filter(b => b && b.lat != null).map(b => {
  const rings = [circle([b.lon, b.lat], b.dmax)]
  if (b.dmin > 10) rings.push(circle([b.lon, b.lat], b.dmin).reverse())
  return { type: 'Feature', properties: { color: b.color || '#E8A33D' }, geometry: { type: 'Polygon', coordinates: rings } }
})
const placed = (markers) => (markers || []).filter(k => k.lat != null && k.lon != null)
const centre = (k) => [k.rlon ?? k.lon, k.rlat ?? k.lat]          // a circle can sit somewhere else than its pin (shared city circle)
function radiusFeatures(markers) {
  const seen = new Map()
  for (const k of placed(markers)) {
    if (!k.radius) continue
    const c = centre(k), key = [c[0].toFixed(6), c[1].toFixed(6), Math.round(k.radius), k.color, !!k.dashed].join('|')
    const had = seen.get(key)
    if (had) { if (k.selected) had.properties.sel = true; continue }   // orders that share one circle draw it once
    seen.set(key, { type: 'Feature', properties: { color: k.fill || k.color || '#1F3864', line: k.color || '#1F3864', sel: !!k.selected, dashed: !!k.dashed },
      geometry: { type: 'Polygon', coordinates: [circle(c, k.radius)] } })
  }
  return [...seen.values()]
}
const altFeatures = (markers) => placed(markers).flatMap(k => (k.alternatives || []).map(a => ({
  type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[k.lon, k.lat], [a.lon, a.lat]] } })))

/**
 * markers: [{id, lat, lon, color, radius, html, selected, draggable, pulse, dim, alternatives:[{lat,lon,name}],
 *            fill (circle fill colour), dashed (reference circle, not an exact spot), rlat/rlon (circle centre when it is not the pin)}]
 * zones:   [{id, name, color, polygon:[[lat,lon],...]}]
 * bands:   [{lat, lon, dmin, dmax, color}]
 * draw:    {points:[[lat,lon]], color} | null  (zone drawing in progress)
 * fit:     'markers' | 'zones' | 'selected' | null — the camera moves only when what it frames really changes, never on a plain data refresh
 * focusKey: change it to frame the selected marker again (the user clicked the same order twice)
 * onClick(lngLat), onMarkerClick(id), onMarkerDrag(id, {lat,lon}), me:{lat,lon}
 */
export default function MapView({ markers = [], zones = [], bands = [], draw = null, onClick, onMarkerClick, onMarkerDrag, fit = 'markers', focusKey = 0, me = null, className = '', center = JHELUM, zoom = 12.5 }) {
  const el = useRef(null), map = useRef(null), mk = useRef({}), ready = useRef(false), cb = useRef({}), cur = useRef({}), framed = useRef({})
  cb.current = { onClick, onMarkerClick, onMarkerDrag }
  cur.current = { markers, zones, bands, draw }
  const setData = (id, features) => { const s = map.current?.getSource(id); if (s) s.setData(fc(features)) }

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current, style: styleUrl(), center, zoom, attributionControl: { compact: true } })
    let dead = false, fellBack = false, tilesOk = false, timer = null, sat = savedSat(), baseVis = new Map()

    // --- Map / Satellite switch -------------------------------------------------------------------------
    // Satellite hides the drawn map (land, water, roads) and shows the photo instead; every name label stays on top.
    const applySat = () => {
      if (!m.getLayer('sat')) return
      m.setLayoutProperty('sat', 'visibility', sat ? 'visible' : 'none')
      baseVis.forEach((v, id) => { if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', sat ? 'none' : v) })
    }
    const box = document.createElement('div'); box.className = 'maplibregl-ctrl aiq-basemap'
    const paint = () => box.querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'sat') === sat))
    for (const [v, label] of [['map', 'Map'], ['sat', 'Satellite']]) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.v = v; b.textContent = label
      b.addEventListener('click', () => { sat = v === 'sat'; try { localStorage.setItem(BASEMAP, v) } catch { /* ignore */ } paint(); if (ready.current) applySat() })
      box.appendChild(b)
    }
    paint()
    m.addControl({ onAdd: () => box, onRemove: () => box.remove() }, 'top-left')
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    m.addControl(new maplibregl.FullscreenControl(), 'top-right')
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left')

    // --- our own layers: added again after every basemap (re)load ------------------------------------------
    const addLayers = () => {
      const base = m.getStyle().layers || []
      // English names only: the stock style prints every name twice (Latin + Urdu script)
      for (const l of base) if (l.type === 'symbol' && JSON.stringify(l.layout?.['text-field'] ?? '').includes('nonlatin')) m.setLayoutProperty(l.id, 'text-field', NAME_EN)
      if (isDark()) {
        for (const [id, prop, value] of NIGHT) if (m.getLayer(id)) m.setPaintProperty(id, prop, value)
        for (const l of base) if (l.type === 'symbol' && l.layout?.['text-field']) {
          m.setPaintProperty(l.id, 'text-color', l.id.startsWith('water') ? '#7C9BD6' : l.id.startsWith('highway') ? '#9FB1D3' : '#D3DEF3')
          m.setPaintProperty(l.id, 'text-halo-color', '#0B1424'); m.setPaintProperty(l.id, 'text-halo-width', 1.2)
        }
      }
      baseVis = new Map(base.filter(l => l.type !== 'symbol').map(l => [l.id, l.layout?.visibility || 'visible']))
      if (!m.getSource('sat')) m.addSource('sat', SAT)
      if (!m.getLayer('sat')) m.addLayer({ id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } }, base.find(l => l.type === 'symbol')?.id)
      for (const id of ['zones', 'zone-labels', 'radius', 'draw', 'alt', 'band']) if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: fc([]) })
      const dark = isDark(), sel = ['==', ['get', 'sel'], true], dashed = ['==', ['get', 'dashed'], true]
      const add = (layer) => { if (!m.getLayer(layer.id)) m.addLayer(layer) }
      add({ id: 'band-fill', type: 'fill', source: 'band', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 } })
      add({ id: 'band-line', type: 'line', source: 'band', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [2, 2] } })
      add({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.1 } })
      add({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-dasharray': [3, 2] } })
      // accuracy circles. A dashed circle is only a reference area (the city of a "call first" order), so it is drawn much lighter.
      add({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', dashed, ['case', sel, 0.14, 0.07], sel, 0.34, 0.24] } })
      add({ id: 'radius-line', type: 'line', source: 'radius', filter: ['!', dashed], paint: { 'line-color': ['get', 'line'], 'line-width': ['case', sel, 3, 2] } })
      add({ id: 'radius-dash', type: 'line', source: 'radius', filter: dashed, paint: { 'line-color': ['get', 'line'], 'line-width': ['case', sel, 3, 2], 'line-dasharray': [3, 2] } })
      add({ id: 'alt-line', type: 'line', source: 'alt', paint: { 'line-color': dark ? '#86B6FF' : '#2E4A8B', 'line-width': 2, 'line-dasharray': [2, 2] } })
      add({ id: 'draw-fill', type: 'fill', source: 'draw', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.2 } })
      add({ id: 'draw-line', type: 'line', source: 'draw', paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 } })
      add({ id: 'draw-pts', type: 'circle', source: 'draw', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2.5 } })
      add({ id: 'zones-label', type: 'symbol', source: 'zone-labels', layout: { 'text-field': ['get', 'name'], 'text-size': 13, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
        paint: { 'text-color': dark ? '#FFFFFF' : ['get', 'color'], 'text-halo-color': dark ? '#0B1322' : '#FFFFFF', 'text-halo-width': 2 } })
      applySat()
    }
    // put the current data back (a new basemap starts with empty sources) without moving the camera
    const pushData = () => {
      const c = cur.current
      setData('zones', zoneFeatures(c.zones)); setData('zone-labels', zoneLabels(c.zones)); setData('draw', drawFeatures(c.draw)); setData('band', bandFeatures(c.bands))
      setData('radius', radiusFeatures(c.markers)); setData('alt', altFeatures(c.markers))
    }
    m.on('style.load', () => { if (dead) return; addLayers(); ready.current = true; pushData(); m.fire('aiq-ready') })
    // the credit line starts folded behind its (i) button, so it does not cover a small map
    m.once('load', () => { const a = el.current?.querySelector('.maplibregl-ctrl-attrib'); if (a) { a.classList.remove('maplibregl-compact-show'); a.removeAttribute('open') } })

    // --- never a blank map: fall back to OpenStreetMap raster tiles if the vector basemap does not arrive ----
    const fallback = () => { if (dead || fellBack || tilesOk) return; fellBack = true; ready.current = false; m.setStyle(FALLBACK, { diff: false }) }
    const watch = () => { clearTimeout(timer); timer = setTimeout(fallback, 12000) }
    m.on('sourcedata', (e) => { if (e.sourceId === 'openmaptiles' && e.tile) tilesOk = true })
    m.on('error', (e) => { if (/openfreemap\.org\/(styles|planet)|failed to fetch|networkerror|load failed/i.test(String(e?.error?.message || ''))) fallback() })
    watch()

    m.on('click', (e) => cb.current.onClick && cb.current.onClick({ lat: e.lngLat.lat, lon: e.lngLat.lng }))
    map.current = m
    // light/dark button: swap the basemap, keep the camera, pins and shapes
    const onTheme = () => { if (dead) return; ready.current = false; fellBack = false; tilesOk = false; m.setStyle(styleUrl(), { diff: false }); watch() }
    window.addEventListener('aiq-theme', onTheme)
    // the container can change size after the map was created (mobile layout, sidebar, keyboard): keep the canvas in sync
    const ro = new ResizeObserver(() => { try { m.resize() } catch { /* map removed */ } })
    ro.observe(el.current)
    const t = setTimeout(() => { try { m.resize() } catch { /* ignore */ } }, 300)
    return () => { dead = true; clearTimeout(t); clearTimeout(timer); ro.disconnect(); window.removeEventListener('aiq-theme', onTheme); m.remove(); map.current = null; ready.current = false; mk.current = {}; framed.current = {} }
  }, [])

  // zones + draw
  useEffect(() => {
    const m = map.current; if (!m) return
    const apply = () => {
      setData('zones', zoneFeatures(zones)); setData('zone-labels', zoneLabels(zones)); setData('draw', drawFeatures(draw))
      const zs = drawn(zones), sig = zs.map(z => z.id + ':' + z.polygon.length).join(',')
      if (fit === 'zones' && zs.length && sig !== framed.current.zones) {
        framed.current.zones = sig; m.resize()
        const b = new maplibregl.LngLatBounds(); zs.forEach(z => z.polygon.forEach(p => b.extend([p[1], p[0]]))); m.fitBounds(b, { padding: 40, maxZoom: 14, duration: 600 })
      }
    }
    ready.current ? apply() : m.once('aiq-ready', apply)
  }, [zones, draw, fit])

  // relation bands
  useEffect(() => {
    const m = map.current; if (!m) return
    const apply = () => setData('band', bandFeatures(bands))
    ready.current ? apply() : m.once('aiq-ready', apply)
  }, [bands])

  // markers + accuracy circles
  useEffect(() => {
    const m = map.current; if (!m) return
    // A pin is a wrapper that MapLibre positions (its classes must never be overwritten) with the coloured teardrop inside.
    const pin = (id, lngLat, draggable) => {
      const box = document.createElement('div'); box.className = 'aiq-pin'
      box.appendChild(document.createElement('div')).className = 'marker-pin'
      const mr = new maplibregl.Marker({ element: box, anchor: 'bottom', draggable }).setLngLat(lngLat).addTo(m)
      mk.current[id] = mr; return mr
    }
    const apply = () => {
      const keep = new Set()
      placed(markers).forEach(k => {
        keep.add(k.id)
        const color = k.color || '#1F3864'
        let mr = mk.current[k.id]
        if (!mr) {
          mr = pin(k.id, [k.lon, k.lat], !!k.draggable)
          mr.getElement().addEventListener('click', (ev) => { ev.stopPropagation(); cb.current.onMarkerClick && cb.current.onMarkerClick(k.id) })
          mr.on('dragend', () => { const p = mr.getLngLat(); cb.current.onMarkerDrag && cb.current.onMarkerDrag(k.id, { lat: p.lat, lon: p.lng }) })
        }
        const d = mr.getElement().firstChild; d.style.background = color; d.style.color = color; d.style.opacity = k.dim ? '0.45' : '1'
        d.className = 'marker-pin' + (k.selected ? ' sel' : '') + (k.pulse ? ' pulse' : '')
        mr.getElement().style.zIndex = k.selected ? '3' : ''
        const at = mr.getLngLat(); if (Math.abs(at.lat - k.lat) > 1e-9 || Math.abs(at.lng - k.lon) > 1e-9) mr.setLngLat([k.lon, k.lat])
        mr.setDraggable(!!k.draggable)
        if (k.html) { if (!mr.getPopup()) mr.setPopup(new maplibregl.Popup({ offset: 34, closeButton: false })); mr.getPopup().setHTML(k.html) }
        ;(k.alternatives || []).forEach((a, i) => {
          const id = k.id + '_alt' + i; keep.add(id)
          const am = mk.current[id] || pin(id, [a.lon, a.lat], false)
          const d2 = am.getElement().firstChild; d2.style.background = '#2E4A8B'; d2.style.color = '#2E4A8B'; d2.style.opacity = '0.8'; am.setLngLat([a.lon, a.lat])
          if (!am.getPopup()) am.setPopup(new maplibregl.Popup({ offset: 34, closeButton: false }).setHTML('<b>Alternative:</b> ' + a.name))
        })
      })
      if (me) {
        let mm = mk.current.__me
        if (!mm) { const d = document.createElement('div'); d.className = 'aiq-me'; mm = new maplibregl.Marker({ element: d, anchor: 'center' }).setLngLat([me.lon, me.lat]).addTo(m); mk.current.__me = mm }
        mm.setLngLat([me.lon, me.lat]); keep.add('__me')
      }
      Object.keys(mk.current).forEach(id => { if (!keep.has(id)) { mk.current[id].remove(); delete mk.current[id] } })
      setData('radius', radiusFeatures(markers)); setData('alt', altFeatures(markers))

      // camera: frame all pins, or the selected one with its circle — but only when that really changed
      const pts = placed(markers), spot = (k) => k.id + ':' + k.lat.toFixed(5) + ',' + k.lon.toFixed(5)
      if (fit === 'markers' && pts.length) {
        const sig = pts.map(spot).join('|') + (me ? '|me' : '')
        if (sig === framed.current.markers) return
        framed.current.markers = sig; m.resize()
        const b = new maplibregl.LngLatBounds()
        pts.forEach(k => { b.extend([k.lon, k.lat]); if (k.radius) circle(centre(k), k.radius, 8).forEach(p => b.extend(p)); (k.alternatives || []).forEach(a => b.extend([a.lon, a.lat])) })
        if (me) b.extend([me.lon, me.lat])
        m.fitBounds(b, { padding: 60, maxZoom: pts.length === 1 ? 16 : 14.5, duration: 600 })
      } else if (fit === 'selected') {
        const s = pts.find(k => k.selected); if (!s) return
        const sig = spot(s) + ':' + (s.radius || 0) + ':' + focusKey
        if (sig === framed.current.selected) return
        framed.current.selected = sig; framed.current.markers = null; m.resize()
        if (s.radius) {
          const b = new maplibregl.LngLatBounds([s.lon, s.lat], [s.lon, s.lat]); circle(centre(s), s.radius, 16).forEach(p => b.extend(p))
          m.fitBounds(b, { padding: 70, maxZoom: 17, duration: 600 })
        } else m.easeTo({ center: [s.lon, s.lat], zoom: Math.max(m.getZoom(), 15), duration: 500 })
      }
    }
    ready.current ? apply() : m.once('aiq-ready', apply)
  }, [markers, fit, me, focusKey])

  return <div ref={el} className={'w-full h-full min-h-[300px] rounded-2xl overflow-hidden ' + className} />
}
