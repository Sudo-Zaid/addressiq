import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'

// keyless raster basemaps — Esri dark/light gray canvas (no API key, reliable)
const raster = (urls, attr) => ({ version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: { b: { type: 'raster', tiles: urls, tileSize: 256, attribution: attr } }, layers: [{ id: 'b', type: 'raster', source: 'b' }] })
const DARK = raster(['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'], '© Esri · © OpenStreetMap contributors')
const LIGHT = raster(['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'], '© Esri · © OpenStreetMap contributors')
const OSM = raster(['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], '© OpenStreetMap contributors')
export const isLight = () => document.documentElement.classList.contains('light')
export const mapStyle = () => (isLight() ? LIGHT : DARK)
export const JHELUM = [73.7194, 32.9247]

function circle([lon, lat], r, n = 48) {
  const out = []
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n
    out.push([lon + (r * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (r * Math.sin(a)) / 110540])
  }
  return out
}

/**
 * markers: [{id, lat, lon, color, radius, label, html, selected, draggable, alternatives:[{lat,lon,name}]}]
 * zones:   [{id, name, color, polygon:[[lat,lon],...]}]
 * draw:    {points:[[lat,lon]], color} | null  (zone drawing in progress)
 * onClick(lngLat), onMarkerClick(id), onMarkerDrag(id, {lat,lon}), fit: 'markers'|'zones'|null, me:{lat,lon}
 */
export default function MapView({ markers = [], zones = [], bands = [], draw = null, onClick, onMarkerClick, onMarkerDrag, fit = 'markers', me = null, className = '', center = JHELUM, zoom = 12.5 }) {
  const el = useRef(null), map = useRef(null), mk = useRef({}), ready = useRef(false), cb = useRef({})
  cb.current = { onClick, onMarkerClick, onMarkerDrag }

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current, style: mapStyle(), center, zoom, attributionControl: { compact: true } })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    const addLayers = () => {
      for (const id of ['zones', 'radius', 'draw', 'alt', 'band']) if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'band-fill', type: 'fill', source: 'band', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 } })
      m.addLayer({ id: 'band-line', type: 'line', source: 'band', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [2, 2] } })
      m.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 } })
      m.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [3, 2] } })
      m.addLayer({ id: 'zones-label', type: 'symbol', source: 'zones', layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#0B1322', 'text-halo-width': 1.6 } })
      m.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'sel'], 0.28, 0.16] } })
      m.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 } })
      m.addLayer({ id: 'alt-line', type: 'line', source: 'alt', paint: { 'line-color': '#2E4A8B', 'line-width': 2, 'line-dasharray': [2, 2] } })
      m.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.2 } })
      m.addLayer({ id: 'draw-line', type: 'line', source: 'draw', paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 } })
      m.addLayer({ id: 'draw-pts', type: 'circle', source: 'draw', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2.5 } })
      ready.current = true
      m.fire('aiq-ready')
    }
    m.on('load', addLayers)
    m.on('click', (e) => cb.current.onClick && cb.current.onClick({ lat: e.lngLat.lat, lon: e.lngLat.lng }))
    map.current = m
    // re-apply the basemap (and re-add our layers) when the user flips the light/dark theme
    const onTheme = () => { ready.current = false; m.setStyle(mapStyle()); m.once('styledata', addLayers) }
    window.addEventListener('aiq-theme', onTheme)
    // the container can change size after the map was created (mobile layout, sidebar, keyboard): keep the canvas in sync
    const ro = new ResizeObserver(() => { try { m.resize() } catch { /* map removed */ } })
    ro.observe(el.current)
    const t = setTimeout(() => { try { m.resize() } catch { /* ignore */ } }, 300)
    return () => { clearTimeout(t); ro.disconnect(); window.removeEventListener('aiq-theme', onTheme); m.remove(); map.current = null; ready.current = false }
  }, [])

  // zones + draw
  useEffect(() => {
    const m = map.current; if (!m) return
    const apply = () => {
      m.getSource('zones').setData({ type: 'FeatureCollection', features: zones.filter(z => z.polygon?.length >= 3).map(z => ({
        type: 'Feature', properties: { name: z.name, color: z.color || '#1F3864' },
        geometry: { type: 'Polygon', coordinates: [[...z.polygon.map(p => [p[1], p[0]]), [z.polygon[0][1], z.polygon[0][0]]]] } })) })
      const f = []
      if (draw?.points?.length) {
        const c = draw.color || '#1F3864'
        draw.points.forEach(p => f.push({ type: 'Feature', properties: { color: c }, geometry: { type: 'Point', coordinates: [p[1], p[0]] } }))
        if (draw.points.length >= 2) f.push({ type: 'Feature', properties: { color: c }, geometry: { type: 'LineString', coordinates: draw.points.map(p => [p[1], p[0]]) } })
        if (draw.points.length >= 3) f.push({ type: 'Feature', properties: { color: c }, geometry: { type: 'Polygon', coordinates: [[...draw.points.map(p => [p[1], p[0]]), [draw.points[0][1], draw.points[0][0]]]] } })
      }
      m.getSource('draw').setData({ type: 'FeatureCollection', features: f })
      if (fit === 'zones' && zones.length) {
        m.resize()
        const b = new maplibregl.LngLatBounds(); zones.forEach(z => z.polygon.forEach(p => b.extend([p[1], p[0]]))); m.fitBounds(b, { padding: 40, maxZoom: 14, duration: 600 })
      }
    }
    ready.current ? apply() : m.once('aiq-ready', apply)
  }, [zones, draw, fit])

  // relation bands (annulus: dmin..dmax around a landmark)
  useEffect(() => {
    const m = map.current; if (!m) return
    const apply = () => {
      const bf = (bands || []).filter(b => b && b.lat != null).map(b => {
        const rings = [circle([b.lon, b.lat], b.dmax)]
        if (b.dmin > 10) rings.push(circle([b.lon, b.lat], b.dmin).reverse())
        return { type: 'Feature', properties: { color: b.color || '#E8A33D' }, geometry: { type: 'Polygon', coordinates: rings } }
      })
      m.getSource('band').setData({ type: 'FeatureCollection', features: bf })
    }
    ready.current ? apply() : m.once('aiq-ready', apply)
  }, [bands])

  // markers + radius circles
  useEffect(() => {
    const m = map.current; if (!m) return
    const apply = () => {
      const keep = new Set()
      const rf = [], af = []
      markers.forEach(k => {
        if (k.lat == null || k.lon == null) return
        keep.add(k.id)
        const color = k.color || '#1F3864'
        if (k.radius) rf.push({ type: 'Feature', properties: { color, sel: !!k.selected }, geometry: { type: 'Polygon', coordinates: [circle([k.lon, k.lat], k.radius)] } })
        ;(k.alternatives || []).forEach(a => af.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[k.lon, k.lat], [a.lon, a.lat]] } }))
        let mr = mk.current[k.id]
        if (!mr) {
          const d = document.createElement('div'); d.className = 'marker-pin'
          mr = new maplibregl.Marker({ element: d, anchor: 'bottom', draggable: !!k.draggable }).setLngLat([k.lon, k.lat]).addTo(m)
          d.addEventListener('click', (ev) => { ev.stopPropagation(); cb.current.onMarkerClick && cb.current.onMarkerClick(k.id) })
          mr.on('dragend', () => { const p = mr.getLngLat(); cb.current.onMarkerDrag && cb.current.onMarkerDrag(k.id, { lat: p.lat, lon: p.lng }) })
          mk.current[k.id] = mr
        }
        const d = mr.getElement(); d.style.background = color; d.style.opacity = k.dim ? '0.45' : '1'
        d.className = 'marker-pin' + (k.selected ? ' sel' : '') + (k.pulse ? ' pulse' : '')
        if (!mr.getLngLat() || Math.abs(mr.getLngLat().lat - k.lat) > 1e-9 || Math.abs(mr.getLngLat().lng - k.lon) > 1e-9) mr.setLngLat([k.lon, k.lat])
        mr.setDraggable(!!k.draggable)
        if (k.html) { if (!mr.getPopup()) mr.setPopup(new maplibregl.Popup({ offset: 28, closeButton: false })); mr.getPopup().setHTML(k.html) }
        ;(k.alternatives || []).forEach((a, i) => {
          const id = k.id + '_alt' + i; keep.add(id)
          let am = mk.current[id]
          if (!am) { const d2 = document.createElement('div'); d2.className = 'marker-pin'; d2.style.opacity = '0.75'; am = new maplibregl.Marker({ element: d2, anchor: 'bottom' }).setLngLat([a.lon, a.lat]).addTo(m); mk.current[id] = am }
          am.getElement().style.background = '#2E4A8B'; am.setLngLat([a.lon, a.lat])
          if (!am.getPopup()) am.setPopup(new maplibregl.Popup({ offset: 28, closeButton: false }).setHTML('<b>Alternative:</b> ' + a.name))
        })
      })
      Object.keys(mk.current).forEach(id => { if (!keep.has(id)) { mk.current[id].remove(); delete mk.current[id] } })
      m.getSource('radius').setData({ type: 'FeatureCollection', features: rf })
      m.getSource('alt').setData({ type: 'FeatureCollection', features: af })
      if (me) {
        let mm = mk.current.__me
        if (!mm) { const d = document.createElement('div'); d.className = 'marker-pin me'; mm = new maplibregl.Marker({ element: d, anchor: 'center' }).addTo(m); mk.current.__me = mm }
        mm.setLngLat([me.lon, me.lat]); keep.add('__me')
      }
      const pts = markers.filter(k => k.lat != null)
      if (fit === 'markers' && pts.length) {
        m.resize()
        const b = new maplibregl.LngLatBounds(); pts.forEach(k => { b.extend([k.lon, k.lat]); (k.alternatives || []).forEach(a => b.extend([a.lon, a.lat])) })
        if (me) b.extend([me.lon, me.lat])
        m.fitBounds(b, { padding: 60, maxZoom: pts.length === 1 ? 16 : 14.5, duration: 600 })
      } else if (fit === 'selected') {
        const s = pts.find(k => k.selected); if (s) m.easeTo({ center: [s.lon, s.lat], zoom: Math.max(m.getZoom(), 15), duration: 500 })
      }
    }
    ready.current ? apply() : m.once('aiq-ready', apply)
  }, [markers, fit, me])

  return <div ref={el} className={'w-full h-full min-h-[300px] rounded-2xl overflow-hidden ' + className} />
}
