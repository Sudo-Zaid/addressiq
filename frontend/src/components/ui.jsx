import { flagOf } from '../api'
import { MapPin } from 'lucide-react'

export function Chip({ flag }) { const f = flagOf(flag); return <span className={f.cls}><span className="w-1.5 h-1.5 rounded-full" style={{ background: f.color }} />{f.label}</span> }
export function StatusChip({ s }) {
  const map = { assigned: ['chip-amb', 'Assigned'], unassigned: ['chip-grey', 'Unassigned'], needs_call: ['chip-unres', 'Needs call'], delivered: ['chip-found', 'Delivered'], out: ['chip-area', 'On the way'] }
  const [cls, label] = map[s] || ['chip-grey', s]; return <span className={cls}>{label}</span>
}
export function Logo({ light = false, size = 'md' }) {
  const sz = size === 'lg' ? 'text-2xl' : 'text-lg'
  return <div className={'flex items-center gap-2 font-extrabold tracking-tight ' + sz + (light ? ' text-white' : ' text-navy')}>
    <span className={'grid place-items-center rounded-xl ' + (light ? 'bg-white/15' : 'bg-navy') + ' w-9 h-9'}><MapPin size={20} className={light ? 'text-amber' : 'text-amber'} /></span>
    Address<span className="text-amber">IQ</span>
  </div>
}
export function Empty({ icon: Icon, title, text, action }) {
  return <div className="flex flex-col items-center justify-center text-center py-14 px-6 gap-3">
    {Icon && <div className="w-14 h-14 rounded-2xl bg-ice-2 grid place-items-center text-navy"><Icon size={26} /></div>}
    <div className="font-bold text-navy">{title}</div>{text && <div className="text-sm text-muted max-w-md">{text}</div>}{action}
  </div>
}
export function Spinner() { return <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> }
export function Toast({ msg, kind = 'ok' }) {
  if (!msg) return null
  return <div className={'fixed bottom-5 left-1/2 -translate-x-1/2 z-50 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-card ' + (kind === 'err' ? 'bg-red text-white' : 'bg-navy text-white')}>{msg}</div>
}
