import { useRef, useState } from 'react'
import { api, flagOf } from '../api'
import MapView from '../components/MapView'
import { Chip, Spinner } from '../components/ui'
import { Sparkles, Mic, MicOff, Play, RotateCcw, FileText, Tags, MapIcon, Compass, Gavel, Brain, Check } from 'lucide-react'

const PRESETS = [
  'House 14, Gali 3, Masjid Ghousia ke peeche, Machine Mohalla No.1, Jhelum',
  'Makan 7, Pak Uk Hospital ke samne, Jhelum',
  'قریشی مارکیٹ کے ساتھ، جہلم',
  'A Block, Citi Housing, Jhelum',
  'Rohtas Gate ke pass, Dina',
  'near the big plaza, Jhelum',
]
const STEPS = [
  { icon: FileText, title: 'Reads the address', sub: 'cleans spelling, keeps the original' },
  { icon: Tags, title: 'Understands the words', sub: 'house · street · landmark · relation · area' },
  { icon: MapIcon, title: 'Searches the open map', sub: 'every matching place becomes a candidate' },
  { icon: Compass, title: 'Applies the relation', sub: '"ke peeche" becomes a band on the map' },
  { icon: Gavel, title: 'Decides & explains', sub: 'best spot, honest radius, plain-word flag' },
]

export default function Demo() {
  const [text, setText] = useState(PRESETS[0])
  const [busy, setBusy] = useState(false); const [step, setStep] = useState(0); const [r, setR] = useState(null)
  const [markers, setMarkers] = useState([]); const [bands, setBands] = useState([]); const [typed, setTyped] = useState('')
  const [mic, setMic] = useState(false); const [memory, setMemory] = useState(false); const [err, setErr] = useState('')
  const timers = useRef([]); const recRef = useRef(null)
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  const at = (ms, fn) => timers.current.push(setTimeout(fn, ms))

  const dist = (a, b) => { const dx = (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180), dy = (a.lat - b.lat) * 110540; return Math.hypot(dx, dy) }
  function candidateMarkers(res, opts = {}) {
    let list = (res.candidates || []).slice(0, 6)
    if (opts.near) list = list.filter(c => dist(c, opts.near) <= 2500)   // keep the camera tight on the chosen spot
    return list.map((c, i) => ({ id: 'c' + i, lat: c.lat, lon: c.lon, color: '#5A6B85', pulse: !!opts.pulse, dim: !!opts.dim,
      html: `<b>${c.name}</b><br/>score ${c.score}` }))
  }
  function play(res) {
    clearTimers(); setErr(''); setR(res); setStep(0); setMarkers([]); setBands([]); setTyped(''); setMemory(false)
    const f = flagOf(res.flag)
    if (res.source === 'learning_store') {        // the magic "it remembered" moment
      at(400, () => setStep(1)); at(1100, () => setStep(2))
      at(1800, () => { setStep(5); setMemory(true); setMarkers([{ id: 'win', lat: res.lat, lon: res.lon, color: '#3C8D5A', radius: res.radius_m, selected: true, pulse: true }]); typeOut(res.explanation) })
      return
    }
    at(400, () => setStep(1))
    at(1400, () => setStep(2))
    at(2400, () => { setStep(3); setMarkers(candidateMarkers(res, { pulse: true })) })
    at(3600, () => {
      setStep(4)
      if (res.band) {
        setBands([{ ...res.band, color: '#E8A33D' }])
        setMarkers([{ id: 'lm', lat: res.band.lat, lon: res.band.lon, color: '#1F3864', selected: true, html: `<b>${res.band.landmark_name}</b>` },
                    ...candidateMarkers(res, { dim: true, near: res.band }).filter(m => Math.abs(m.lat - res.band.lat) > 1e-9 || Math.abs(m.lon - res.band.lon) > 1e-9)])
      }
    })
    at(res.band ? 5200 : 4600, () => {
      setStep(5)
      const win = res.lat != null ? [{ id: 'win', lat: res.lat, lon: res.lon, color: f.color, radius: res.radius_m, selected: true, alternatives: res.alternatives || [] }] : []
      setMarkers([...win, ...candidateMarkers(res, { dim: true, near: res.lat != null ? res : undefined })])
      typeOut(res.explanation)
    })
  }
  function typeOut(s) {
    let i = 0; const id = setInterval(() => { i += 2; setTyped(s.slice(0, i)); if (i >= s.length) clearInterval(id) }, 18)
    timers.current.push(id)
  }
  async function run(t = text) {
    if (!t.trim() || busy) return
    setBusy(true)
    try { const res = await api.post('/api/geocode', { text: t }); play(res) } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  function listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setErr('Voice needs Chrome (and localhost or HTTPS)'); return }
    if (mic) { recRef.current?.stop(); return }
    const rec = new SR(); recRef.current = rec
    rec.lang = 'ur-PK'; rec.interimResults = true; rec.continuous = false
    rec.onresult = (e) => { const t = [...e.results].map(x => x[0].transcript).join(' '); setText(t); if (e.results[e.results.length - 1].isFinal) run(t) }
    rec.onend = () => setMic(false); rec.onerror = () => { setMic(false); setErr('Mic not available here — voice works on localhost / HTTPS in Chrome') }
    setMic(true); setErr(''); rec.start()
  }
  const p = r?.parts
  const chips = p ? [
    p.house && ['house ' + p.house, '#1F3864'],
    ...(p.streets || []).map(s => [s.text, '#0E7490']),
    ...(p.landmarks || []).map(l => [l.text + (l.relation ? ` · "${l.relation}"` : ''), '#8E44AD']),
    ...(p.blocks || []).map(b => ['block ' + b, '#0E7490']),
    ...(p.areas || []).map(a => [a, '#b4731a']),
    p.city && [p.city, '#3C8D5A'],
  ].filter(Boolean) : []

  return <div className="grid xl:grid-cols-[440px_1fr] gap-5 h-full min-h-[600px]">
    <div className="flex flex-col gap-4 min-w-0">
      <div className="card p-4">
        <div className="flex items-center gap-2 text-navy font-extrabold"><Sparkles size={18} className="text-amber" /> Watch it think</div>
        <p className="text-xs text-muted mt-1">Type an address the way people say it — or press the mic and <b>speak it in Urdu</b>.</p>
        <div className="mt-3 flex gap-2">
          <input className="input" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} placeholder='e.g. "Jamia Masjid ke peeche, Islampura"' />
          <button className={mic ? 'btn-danger px-3' : 'btn-amber px-3'} onClick={listen} title="Speak the address (Urdu)">{mic ? <MicOff size={18} /> : <Mic size={18} />}</button>
          <button className="btn-primary px-4" onClick={() => run()} disabled={busy}>{busy ? <Spinner /> : <Play size={18} />}</button>
        </div>
        {mic && <div className="mt-2 text-xs font-bold text-red animate-pulse">● Listening… speak the address</div>}
        {err && <div className="mt-2 text-xs font-semibold text-red">{err}</div>}
        <div className="mt-3 flex flex-wrap gap-1.5">{PRESETS.map(s => <button key={s} onClick={() => { setText(s); run(s) }} className="text-[11px] rounded-full border border-line bg-ice px-2.5 py-1 hover:border-navy-3 text-ink max-w-full truncate" style={{ maxWidth: '100%' }}>{s.length > 46 ? s.slice(0, 46) + '…' : s}</button>)}</div>
      </div>
      <div className="card p-4 flex-1">
        <ol className="space-y-1">{STEPS.map((s, i) => {
          const n = i + 1, on = step >= n, cur = step === n
          return <li key={i} className={'flex items-start gap-3 rounded-xl px-3 py-2.5 transition ' + (cur ? 'bg-navy text-white shadow-card' : on ? 'bg-ice' : 'opacity-45')}>
            <span className={'mt-0.5 w-7 h-7 rounded-full grid place-items-center shrink-0 ' + (cur ? 'bg-amber text-navy' : on ? 'bg-green text-white' : 'bg-ice-2 text-muted')}>{on && !cur ? <Check size={15} /> : <s.icon size={15} />}</span>
            <div className="min-w-0"><div className={'text-sm font-bold ' + (cur ? '' : 'text-navy')}>{s.title}</div>
              <div className={'text-xs ' + (cur ? 'text-white/75' : 'text-muted')}>{s.sub}</div>
              {n === 1 && on && r && <div className="mt-1.5 text-xs font-mono rounded-lg bg-white/90 text-ink px-2 py-1.5 border border-line">{(p?.segments || []).join('  ·  ')}</div>}
              {n === 2 && on && chips.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{chips.map(([t, c], j) => <span key={j} className="text-[11px] font-bold rounded-full px-2 py-0.5 text-white" style={{ background: c }}>{t}</span>)}</div>}
              {n === 3 && on && r && <div className={'mt-1 text-xs ' + (cur ? 'text-white/85' : 'text-muted')}>{memory ? 'skipped — answered straight from delivery memory' : (r.candidates?.length ? `${r.candidates.length} candidate place(s) found` : 'nothing matched on the map')}{!memory && r.matched?.area && ` · area: ${r.matched.area.name}`}</div>}
              {n === 4 && on && r && <div className={'mt-1 text-xs ' + (cur ? 'text-white/85' : 'text-muted')}>{memory ? 'skipped — the exact door is already known' : (r.band ? `"${r.band.relation}" → ${r.band.dmin}–${r.band.dmax} m ${r.band.word} ${r.band.landmark_name}` : 'no relation word in this address')}</div>}
            </div></li>
        })}</ol>
        {step >= 5 && r && <div className={'mt-3 rounded-xl border p-3 ' + (memory ? 'border-amber bg-amber/10' : 'border-line bg-ice')}>
          <div className="flex items-center gap-2 flex-wrap">{memory && <span className="chip bg-amber text-navy"><Brain size={12} /> Memory</span>}<Chip flag={r.flag} />{r.lat != null && <span className="text-xs text-muted">{r.granularity} · within {Math.round(r.radius_m)} m</span>}</div>
          <p className="mt-2 text-sm min-h-[40px]">{typed}<span className="animate-pulse">▌</span></p>
          {r.not_found?.length > 0 && <div className="text-xs text-red mt-1">Not on the map: {r.not_found.join(', ')}</div>}
          <div className="mt-2 flex gap-2"><button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => play(r)}><RotateCcw size={13} /> Replay</button>
            {!memory && r.flag === 'FOUND' && <span className="text-[11px] text-muted self-center">Tip: deliver this order once, run it again — watch the Memory step appear.</span>}</div>
        </div>}
      </div>
    </div>
    <div className="card p-2 h-[420px] xl:h-auto xl:min-h-[560px]"><MapView markers={markers} bands={bands} fit="markers" zoom={13} /></div>
  </div>
}
