// Small fetch wrapper: JSON in/out, bearer token from localStorage, errors as Error(message).
const TOKEN = 'aiq_token', USER = 'aiq_user'

export const auth = {
  token: () => localStorage.getItem(TOKEN),
  user: () => { try { return JSON.parse(localStorage.getItem(USER) || 'null') } catch { return null } },
  set: (token, user) => { localStorage.setItem(TOKEN, token); localStorage.setItem(USER, JSON.stringify(user)) },
  clear: () => { localStorage.removeItem(TOKEN); localStorage.removeItem(USER) },
}

async function call(method, path, body, isForm = false) {
  const headers = {}
  const t = auth.token(); if (t) headers.Authorization = 'Bearer ' + t
  if (body && !isForm) headers['Content-Type'] = 'application/json'
  const r = await fetch(path, { method, headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined })
  let data = null
  try { data = await r.json() } catch { /* empty */ }
  if (!r.ok) {
    if (r.status === 401) auth.clear()
    throw new Error((data && (data.detail || data.message)) || ('HTTP ' + r.status))
  }
  return data
}

export const api = {
  get: (p) => call('GET', p),
  post: (p, b) => call('POST', p, b),
  del: (p) => call('DELETE', p),
  upload: (p, file) => { const fd = new FormData(); fd.append('file', file); return call('POST', p, fd, true) },
}

export const FLAG = {
  'FOUND': { cls: 'chip-found', label: 'Found', color: '#3C8D5A', hint: 'Go straight there' },
  'AREA-ONLY': { cls: 'chip-area', label: 'Area only', color: '#E8A33D', hint: 'Go to the area, then ask' },
  'AMBIGUOUS': { cls: 'chip-amb', label: 'Two options', color: '#2E4A8B', hint: 'Confirm with the customer' },
  'UNRESOLVED': { cls: 'chip-unres', label: 'Call first', color: '#C0392B', hint: 'Not on the map — call before dispatch' },
}
export const flagOf = (f) => FLAG[f] || { cls: 'chip-grey', label: f || '—', color: '#5A6B85', hint: '' }

export const fmtMoney = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-PK')
export const navUrl = (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`
export const timeAgo = (ts) => {
  if (!ts) return ''
  const s = Math.max(0, Date.now() / 1000 - ts)
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return Math.floor(s / 86400) + ' d ago'
}
