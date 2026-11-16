import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { LayoutDashboard, Package, Map, Brain, ClipboardList, LogOut, Menu } from 'lucide-react'
import { useState } from 'react'
import { auth } from '../api'
import { Logo } from '../components/ui'

const NAV = [
  { to: '/app', end: true, icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/app/orders', icon: Package, label: 'Orders' },
  { to: '/app/zones', icon: Map, label: 'Zones & riders' },
  { to: '/app/learning', icon: Brain, label: 'Learning store' },
  { to: '/app/collect', icon: ClipboardList, label: 'Collect data' },
]
export default function SellerShell() {
  const nav = useNavigate(); const u = auth.user(); const [open, setOpen] = useState(false); const loc = useLocation()
  const title = NAV.find(n => n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to))?.label || ''
  return <div className="h-full flex">
    <aside className={'fixed lg:static z-40 inset-y-0 left-0 w-64 bg-navy text-white flex flex-col p-4 transition-transform ' + (open ? '' : '-translate-x-full lg:translate-x-0')}>
      <div className="px-2 py-2"><Logo light /></div>
      <nav className="mt-6 flex flex-col gap-1">{NAV.map(n => <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}><n.icon size={18} />{n.label}</NavLink>)}</nav>
      <div className="mt-auto rounded-xl bg-white/10 p-3 text-sm"><div className="font-bold">{u?.name}</div><div className="text-white/60 text-xs">{u?.role} · {u?.username}</div>
        <button onClick={() => { auth.clear(); nav('/login') }} className="mt-3 flex items-center gap-2 text-white/80 hover:text-white text-xs font-semibold"><LogOut size={14} /> Sign out</button></div>
    </aside>
    {open && <div className="fixed inset-0 bg-black/30 z-30 lg:hidden" onClick={() => setOpen(false)} />}
    <main className="flex-1 min-w-0 flex flex-col">
      <header className="h-14 flex items-center gap-3 px-4 lg:px-6 border-b border-line bg-white/70 backdrop-blur sticky top-0 z-20">
        <button className="lg:hidden text-navy" onClick={() => setOpen(true)}><Menu /></button>
        <h1 className="font-extrabold text-navy text-lg">{title}</h1>
        <div className="ml-auto text-xs text-muted hidden sm:block">Jhelum · Dina · OpenStreetMap data · no paid API</div>
      </header>
      <div className="flex-1 min-h-0 p-4 lg:p-6 overflow-auto"><Outlet /></div>
    </main>
  </div>
}
