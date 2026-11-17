import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, flagOf, fmtMoney } from '../api'
import { Chip, Empty } from '../components/ui'
import { ChevronRight, PackageOpen, CheckCircle2 } from 'lucide-react'

const TAB_ON = 'bg-navy text-white dark:bg-navy-2 dark:ring-1 dark:ring-sky/30'
const TAB_OFF = 'bg-white border border-line text-navy dark:bg-white/5 dark:text-bright'

export default function RiderHome() {
  const [orders, setOrders] = useState([]); const [tab, setTab] = useState('todo')
  useEffect(() => {
    const load = () => api.get('/api/orders').then(setOrders).catch(console.error)
    load(); const t = setInterval(load, 8000); return () => clearInterval(t)   // new orders assigned by the shop show up by themselves
  }, [])
  const todo = orders.filter(o => o.status !== 'delivered'), done = orders.filter(o => o.status === 'delivered')
  const list = tab === 'todo' ? todo : done
  return <div>
    <div className="flex gap-2 mb-4"><button onClick={() => setTab('todo')} className={'btn flex-1 ' + (tab === 'todo' ? TAB_ON : TAB_OFF)}>My stops ({todo.length})</button><button onClick={() => setTab('done')} className={'btn flex-1 ' + (tab === 'done' ? TAB_ON : TAB_OFF)}>Delivered ({done.length})</button></div>
    {list.length === 0 ? <div className="card"><Empty icon={tab === 'todo' ? PackageOpen : CheckCircle2} title={tab === 'todo' ? 'No stops right now' : 'Nothing delivered yet'} text={tab === 'todo' ? 'When the shop assigns orders in your area they appear here automatically.' : ''} /></div> :
      <ul className="space-y-3">{list.map((o, i) => <li key={o.id}><Link to={`/rider/${o.id}`} className="card p-4 flex items-center gap-3 active:scale-[.99] transition">
        <span className="w-9 h-9 rounded-full grid place-items-center font-extrabold text-white text-sm" style={{ background: flagOf(o.flag).color }}>{i + 1}</span>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-bold truncate">{o.customer_name}</span><span className="text-xs font-bold text-bright ml-auto">{fmtMoney(o.amount)}</span></div>
          <div className="text-xs text-muted truncate">{o.address_text}</div><div className="mt-1.5"><Chip flag={o.flag} /></div></div>
        <ChevronRight className="text-muted" size={18} /></Link></li>)}</ul>}
  </div>
}
