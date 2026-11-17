import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import './index.css'
import { auth, theme } from './api'

theme.apply(theme.get())   // restore the saved light/dark choice before the first render
import Login from './pages/Login'
import Register from './pages/Register'
import SellerShell from './pages/SellerShell'
import Dashboard from './pages/Dashboard'
import Orders from './pages/Orders'
import Zones from './pages/Zones'
import Learning from './pages/Learning'
import Collect from './pages/Collect'
import RiderShell from './pages/RiderShell'
import RiderHome from './pages/RiderHome'
import RiderOrder from './pages/RiderOrder'
import Orgs from './pages/Orgs'
import Demo from './pages/Demo'

function Home() {
  const u = auth.user()
  if (!u) return <Navigate to="/login" replace />
  return <Navigate to={u.role === 'rider' ? '/rider' : (u.role === 'admin' ? '/app/orgs' : '/app')} replace />
}
function Guard({ roles, children }) {
  const u = auth.user()
  if (!u || !auth.token()) return <Navigate to="/login" replace />
  if (roles && !roles.includes(u.role)) return <Navigate to="/" replace />
  return children
}

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  { path: '/collect', element: <Collect standalone /> },
  { path: '/app', element: <Guard roles={['seller', 'admin']}><SellerShell /></Guard>, children: [
    { index: true, element: <Dashboard /> }, { path: 'orders', element: <Orders /> }, { path: 'zones', element: <Zones /> },
    { path: 'learning', element: <Learning /> }, { path: 'collect', element: <Collect /> },
    { path: 'demo', element: <Demo /> },
    { path: 'orgs', element: <Guard roles={['admin']}><Orgs /></Guard> } ] },
  { path: '/rider', element: <Guard roles={['rider']}><RiderShell /></Guard>, children: [
    { index: true, element: <RiderHome /> }, { path: ':id', element: <RiderOrder /> } ] },
  { path: '*', element: <Navigate to="/" replace /> },
])

ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><RouterProvider router={router} /></React.StrictMode>)
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {})
