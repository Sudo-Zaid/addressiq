import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api, auth } from '../api'
import { Logo, Spinner } from '../components/ui'

export default function Register() {
  const nav = useNavigate(); const [f, setF] = useState({ name: '', phone: '', username: '', password: '', org_code: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  async function go(e) {
    e.preventDefault(); setBusy(true); setErr('')
    try { const r = await api.post('/api/auth/register', f); auth.set(r.token, r.user); nav('/rider') } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  return <div className="min-h-full flex items-center justify-center p-6">
    <form onSubmit={go} className="card w-full max-w-sm p-7">
      <Logo /><h2 className="text-2xl font-extrabold text-bright mt-5">Rider sign-up</h2><p className="text-sm text-muted mt-1">Enter the join code your company's dispatcher gave you. After sign-up they assign you an area and orders appear in your app automatically.</p>
      <div className="mt-6 space-y-4">
        <div><label className="label">Company join code</label><input className="input uppercase tracking-wider" value={f.org_code} onChange={set('org_code')} placeholder="e.g. ZAI-1234" required /></div>
        <div><label className="label">Full name</label><input className="input" value={f.name} onChange={set('name')} required /></div>
        <div><label className="label">Phone</label><input className="input" inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="03xx-xxxxxxx" /></div>
        <div><label className="label">Username</label><input className="input" value={f.username} onChange={set('username')} required autoCapitalize="none" /></div>
        <div><label className="label">Password</label><input className="input" type="password" value={f.password} onChange={set('password')} required minLength={6} /></div>
        {err && <div className="text-sm text-red font-semibold">{err}</div>}
        <button className="btn-primary w-full py-3" disabled={busy}>{busy ? <Spinner /> : 'Create account'}</button>
      </div>
      <p className="mt-5 text-sm text-muted">Already registered? <Link to="/login" className="text-bright font-semibold">Sign in</Link></p>
    </form>
  </div>
}
