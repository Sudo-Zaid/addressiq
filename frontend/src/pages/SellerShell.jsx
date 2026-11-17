import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { LayoutDashboard, Package, Map, Brain, ClipboardList, LogOut, Menu, Building2, Sparkles, Sun, Moon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, auth, theme } from '../api'
import { Logo } from '../components/ui'

// onNavy: the button sits on a navy bar (rider header), so it is a plain light icon instead of a white button
export function ThemeToggle({ onNavy = false }) {
  const [t, setT] = useState(theme.get())
  return <button onClick={() => setT(theme.toggle())} title={t === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'} className={onNavy ? 'text-white/70 hover:text-white p-1.5' : 'btn-ghost'}>{t === 'dark' ? <Sun size={onNavy ? 18 : 16} /> : <Moon size={onNavy ? 18 : 16} />}</button>
}

const SELLER_NAV = [
  { to: '/app/demo', icon: Sparkles, label: 'Live demo' },
  { to: '/app', end: true, icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/app/orders', icon: Package, label: 'Orders' },
  { to: '/app/zones', icon: Map, label: 'Zones & riders' },
  { to: '/app/learning', icon: Brain, label: 'Learning store' },
  { to: '/app/collect', icon: ClipboardList, label: 'Collect data' },
]
const ADMIN_NAV = [
  { to: '/app/orgs', icon: Building2, label: 'Organizations' },
  { to: '/app/demo', icon: Sparkles, label: 'Live demo' },
  { to: '/app', end: true, icon: LayoutDashboard, label: 'Platform overview' },
  { to: '/app/learning', icon: Brain, label: 'Learning store' },
  { to: '/app/collect', icon: ClipboardList, label: 'Collect data' },
]
export default function SellerShell() {
  const nav = useNavigate(); const u = auth.user(); const [open, setOpen] = useState(false); const loc = useLocation(); const [ok, setOk] = useState(false)
  // verify the session ONCE before any child page fires its own calls, so a stale token can never scatter 401s
  // Only a real "not signed in" answer (401/403) sends the user to login; a server restart or network blip just retries.
  useEffect(() => {
    let live = true, t
    const check = () => api.get('/api/me').then(() => live && setOk(true)).catch((e) => {
      if (!live) return
      if (e.status === 401 || e.status === 403) { auth.clear(); nav('/login', { replace: true }) } else t = setTimeout(check, 1500)
    })
    check()
    return () => { live = false; clearTimeout(t) }
  }, [nav])
  const NAV = u?.role === 'admin' ? ADMIN_NAV : SELLER_NAV
  const title = NAV.find(n => n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to))?.label || ''
  if (!ok) return <div className="h-full grid place-items-center"><span className="inline-block w-6 h-6 border-2 border-navy/20 border-t-navy dark:border-white/25 dark:border-t-white rounded-full animate-spin" /></div>
  return <div className="h-full flex">
    <aside className={'fixed lg:static z-40 inset-y-0 left-0 w-64 bg-navy text-white flex flex-col p-4 transition-transform ' + (open ? '' : '-translate-x-full lg:translate-x-0')}>
      <div className="px-2 py-2"><Logo light /></div>
      {u?.org_name && <div className="mt-3 mx-1 rounded-xl bg-white/10 px-3 py-2 text-xs"><div className="text-white/60">Organization</div><div className="font-bold truncate">{u.org_name}</div></div>}
      {u?.role === 'admin' && <div className="mt-3 mx-1 rounded-xl bg-amber/20 px-3 py-2 text-xs font-bold text-amber">Platform admin</div>}
      <nav className="mt-5 flex flex-col gap-1">{NAV.map(n => <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}><n.icon size={18} />{n.label}</NavLink>)}</nav>
      <div className="mt-auto rounded-xl bg-white/10 p-3 text-sm"><div className="font-bold">{u?.name}</div><div className="text-white/60 text-xs">{u?.role} · {u?.username}</div>
        <button onClick={() => { auth.clear(); nav('/login') }} className="mt-3 flex items-center gap-2 text-white/80 hover:text-white text-xs font-semibold"><LogOut size={14} /> Sign out</button></div>
    </aside>
    {open && <div className="fixed inset-0 bg-black/30 z-30 lg:hidden" onClick={() => setOpen(false)} />}
    <main className="flex-1 min-w-0 flex flex-col">
      <header className="h-14 flex items-center gap-3 px-4 lg:px-6 border-b border-line bg-white/70 backdrop-blur dark:bg-[#070D1C]/60 dark:backdrop-blur-xl sticky top-0 z-20">
        <button className="lg:hidden text-bright" onClick={() => setOpen(true)}><Menu /></button>
        <h1 className="font-extrabold text-bright text-lg">{title}</h1>
        <div className="ml-auto flex items-center gap-3"><span className="text-xs text-muted hidden sm:block">Jhelum · Dina · OpenStreetMap data · no paid API</span><ThemeToggle /></div>
      </header>
      <div className="flex-1 min-h-0 p-4 lg:p-6 overflow-auto"><Outlet /></div>
    </main>
  </div>
}
