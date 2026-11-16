import { Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { LogOut } from 'lucide-react'
import { api, auth } from '../api'
import { Logo } from '../components/ui'

export default function RiderShell() {
  const nav = useNavigate(); const [me, setMe] = useState(auth.user())
  useEffect(() => { api.get('/api/me').then(setMe).catch(() => {}) }, [])
  return <div className="min-h-full bg-ice max-w-md mx-auto flex flex-col shadow-2xl">
    <header className="bg-navy text-white px-4 pt-5 pb-4 rounded-b-3xl">
      <div className="flex items-center justify-between"><Logo light /><button onClick={() => { auth.clear(); nav('/login') }} className="text-white/70 hover:text-white"><LogOut size={18} /></button></div>
      <div className="mt-4 flex items-center gap-3"><span className="w-11 h-11 rounded-full bg-white/15 grid place-items-center font-extrabold text-amber">{me?.name?.[0]}</span>
        <div><div className="font-bold leading-tight">{me?.name}</div><div className="text-xs text-white/70">{me?.org_name && <span>{me.org_name} · </span>}{me?.zone_name ? `Area: ${me.zone_name}` : 'No area assigned yet — ask the dispatcher'}</div></div></div>
    </header>
    <div className="flex-1 p-4"><Outlet context={{ me }} /></div>
  </div>
}
