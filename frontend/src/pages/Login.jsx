import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api, auth } from '../api'
import { Logo, Spinner } from '../components/ui'
import { MapPin, Store, Bike, Shield, Truck } from 'lucide-react'

const DEMO = [{ u: 'admin', p: 'admin123', label: 'Platform admin', icon: Shield }, { u: 'seller', p: 'seller123', label: 'Dispatcher — Zaid Traders', icon: Store },
  { u: 'leopard', p: 'leopard123', label: 'Dispatcher — Leopard Courier', icon: Truck }, { u: 'ahmed', p: 'rider123', label: 'Rider — Ahmed (Jhelum City)', icon: Bike }]

export default function Login() {
  const nav = useNavigate(); const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function go(e, uu = u, pp = p) {
    e?.preventDefault(); setBusy(true); setErr('')
    try { const r = await api.post('/api/auth/login', { username: uu, password: pp }); auth.set(r.token, r.user); nav(r.user.role === 'rider' ? '/rider' : (r.user.role === 'admin' ? '/app/orgs' : '/app')) }
    catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  return <div className="min-h-full grid lg:grid-cols-2">
    <div className="hidden lg:flex flex-col justify-between bg-navy text-white p-12 relative overflow-hidden">
      <div className="absolute -right-24 -bottom-24 w-[420px] h-[420px] rounded-full bg-navy-2" /><div className="absolute -right-6 -bottom-6 w-[260px] h-[260px] rounded-full bg-navy-3/70" />
      <div className="absolute right-[88px] bottom-[88px] w-10 h-10 rounded-full bg-amber shadow-lg" />
      <Logo light size="lg" />
      <div className="relative">
        <h1 className="text-4xl font-extrabold leading-tight">Find any Pakistani address on the map —<br /><span className="text-amber">even "masjid ke peeche".</span></h1>
        <p className="mt-4 text-white/75 max-w-md">Paste the day's orders. Every address becomes a pin, a radius you can trust and a colour that tells the rider what to do. Every delivery teaches the system.</p>
        <div className="mt-8 flex gap-6 text-sm text-white/70"><div><div className="text-2xl font-extrabold text-white">431</div>landmarks</div><div><div className="text-2xl font-extrabold text-white">406</div>streets</div><div><div className="text-2xl font-extrabold text-white">223</div>areas · Jhelum + Dina</div></div>
      </div>
      <div className="text-xs text-white/50">Final Year Project · FCIT, University of the Punjab, Jhelum Campus</div>
    </div>
    <div className="flex items-center justify-center p-6">
      <form onSubmit={go} className="w-full max-w-sm">
        <div className="lg:hidden mb-8"><Logo size="lg" /></div>
        <h2 className="text-2xl font-extrabold text-navy">Sign in</h2><p className="text-sm text-muted mt-1">Seller dashboard or rider app — same login.</p>
        <div className="mt-6 space-y-4">
          <div><label className="label">Username</label><input className="input" value={u} onChange={e => setU(e.target.value)} autoFocus autoCapitalize="none" /></div>
          <div><label className="label">Password</label><input className="input" type="password" value={p} onChange={e => setP(e.target.value)} /></div>
          {err && <div className="text-sm text-red font-semibold">{err}</div>}
          <button className="btn-primary w-full py-3" disabled={busy}>{busy ? <Spinner /> : 'Sign in'}</button>
        </div>
        <div className="mt-8"><div className="label">Demo accounts</div>
          <div className="grid gap-2">{DEMO.map(d => <button type="button" key={d.u} onClick={(e) => go(e, d.u, d.p)} className="btn-ghost justify-start"><d.icon size={16} className="text-navy-3" />{d.label}<span className="ml-auto text-xs text-muted">{d.u} / {d.p}</span></button>)}</div>
        </div>
        <p className="mt-6 text-sm text-muted">New rider? <Link to="/register" className="text-navy font-semibold">Create an account</Link> · <Link to="/collect" className="text-navy font-semibold">Volunteer: add an address</Link></p>
      </form>
    </div>
  </div>
}
