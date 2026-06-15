import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Dispatch from './dispatch-system.jsx'
import CRM from './gas-crm.jsx'

/* ------------------------------------------------------------------ *
 *  window.storage shim — backs the apps' persistence with localStorage
 * ------------------------------------------------------------------ */
if (!window.storage) {
  window.storage = {
    async get(key) { const v = localStorage.getItem(key); return v === null ? null : { key, value: v } },
    async set(key, value) { localStorage.setItem(key, value); return { key, value } },
    async delete(key) { localStorage.removeItem(key); return { key, deleted: true } },
    async list(prefix = '') { return { keys: Object.keys(localStorage).filter(k => k.startsWith(prefix)) } },
  }
}

/* ------------------------------------------------------------------ *
 *  DEMO AUTH  (front-end simulation — NOT real security)
 *  - users + session live in localStorage
 *  - "verification email" is shown on screen because there is no server
 *  - swap this layer for Supabase / Firebase / your own API for real auth
 * ------------------------------------------------------------------ */
const USERS_KEY = 'gas-auth-users'
const SESSION_KEY = 'gas-auth-session'

const loadUsers = () => { try { return JSON.parse(localStorage.getItem(USERS_KEY)) || [] } catch { return [] } }
const saveUsers = (u) => localStorage.setItem(USERS_KEY, JSON.stringify(u))
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return String(h) }
const code6 = () => String(Math.floor(100000 + Math.random() * 900000))

/* --- inline styles --- */
const S = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', fontFamily: 'ui-sans-serif, system-ui, sans-serif', padding: 16 },
  card: { width: '100%', maxWidth: 400, background: '#fff', borderRadius: 14, boxShadow: '0 10px 40px rgba(0,0,0,.08)', overflow: 'hidden' },
  head: { background: '#1b5297', padding: '22px 24px', color: '#fff' },
  body: { padding: 24 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', margin: '12px 0 4px' },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14, outline: 'none' },
  btn: { width: '100%', marginTop: 18, padding: '11px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  link: { background: 'none', border: 'none', color: '#2563eb', fontWeight: 600, cursor: 'pointer', fontSize: 13, padding: 0 },
  err: { background: '#fee2e2', color: '#b91c1c', fontSize: 13, padding: '8px 10px', borderRadius: 8, marginTop: 12 },
  ok: { background: '#dcfce7', color: '#15803d', fontSize: 13, padding: '8px 10px', borderRadius: 8, marginTop: 12 },
  mail: { marginTop: 16, border: '1px dashed #94a3b8', borderRadius: 8, padding: 12, background: '#f8fafc' },
}

function Auth({ onSignedIn }) {
  const [screen, setScreen] = useState('login') // login | signup | verify
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [pending, setPending] = useState(null)     // user awaiting verification
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  const reset = () => { setErr(''); setOk(''); setPassword(''); setConfirm(''); setCodeInput('') }

  const doSignup = () => {
    setErr('')
    if (!name.trim() || !email.trim() || !password) return setErr('Please fill in every field.')
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter a valid email address.')
    if (password.length < 6) return setErr('Password must be at least 6 characters.')
    if (password !== confirm) return setErr('Passwords do not match.')
    const users = loadUsers()
    if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) return setErr('An account with that email already exists.')
    const user = { name: name.trim(), email: email.trim(), passHash: hash(password), verified: false, code: code6() }
    saveUsers([...users, user])
    setPending(user)
    reset()
    setScreen('verify')
  }

  const doVerify = () => {
    setErr('')
    const users = loadUsers()
    const u = users.find((x) => x.email.toLowerCase() === pending.email.toLowerCase())
    if (!u) return setErr('Account not found.')
    if (codeInput.trim() !== u.code) return setErr('That code is not correct.')
    u.verified = true
    saveUsers(users)
    reset()
    setScreen('login')
    setOk('Email verified — your account is active. Please sign in.')
  }

  const resend = () => {
    const users = loadUsers()
    const u = users.find((x) => x.email.toLowerCase() === pending.email.toLowerCase())
    if (!u) return
    u.code = code6()
    saveUsers(users)
    setPending({ ...u })
    setOk('A new code has been sent.')
  }

  const doLogin = () => {
    setErr('')
    const users = loadUsers()
    const u = users.find((x) => x.email.toLowerCase() === email.toLowerCase())
    if (!u || u.passHash !== hash(password)) return setErr('Incorrect email or password.')
    if (!u.verified) { setPending(u); setScreen('verify'); setErr(''); setOk('Please verify your email to activate the account.'); return }
    localStorage.setItem(SESSION_KEY, JSON.stringify({ email: u.email, name: u.name }))
    onSignedIn({ email: u.email, name: u.name })
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.head}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Gas Service Suite</div>
          <div style={{ fontSize: 13, opacity: .8 }}>Dispatch &amp; CRM</div>
        </div>
        <div style={S.body}>
          {screen === 'login' && (
            <>
              <h2 style={{ margin: '0 0 4px', fontSize: 18, color: '#0f172a' }}>Sign in</h2>
              <label style={S.label}>Email</label>
              <input style={S.input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.co.uk" />
              <label style={S.label}>Password</label>
              <input style={S.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doLogin()} />
              {err && <div style={S.err}>{err}</div>}
              {ok && <div style={S.ok}>{ok}</div>}
              <button style={S.btn} onClick={doLogin}>Sign in</button>
              <p style={{ marginTop: 16, fontSize: 13, color: '#64748b' }}>
                No account? <button style={S.link} onClick={() => { reset(); setScreen('signup') }}>Create one</button>
              </p>
            </>
          )}

          {screen === 'signup' && (
            <>
              <h2 style={{ margin: '0 0 4px', fontSize: 18, color: '#0f172a' }}>Create account</h2>
              <label style={S.label}>Full name</label>
              <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} />
              <label style={S.label}>Email</label>
              <input style={S.input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.co.uk" />
              <label style={S.label}>Password</label>
              <input style={S.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <label style={S.label}>Confirm password</label>
              <input style={S.input} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              {err && <div style={S.err}>{err}</div>}
              <button style={S.btn} onClick={doSignup}>Create account</button>
              <p style={{ marginTop: 16, fontSize: 13, color: '#64748b' }}>
                Already registered? <button style={S.link} onClick={() => { reset(); setScreen('login') }}>Sign in</button>
              </p>
            </>
          )}

          {screen === 'verify' && pending && (
            <>
              <h2 style={{ margin: '0 0 4px', fontSize: 18, color: '#0f172a' }}>Verify your email</h2>
              <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
                We sent a 6-digit verification code to <b>{pending.email}</b>. Enter it below to activate your account.
              </p>
              <div style={S.mail}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: .5 }}>Demo email — no mail server</div>
                <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>Your verification code is:</div>
                <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 4, color: '#1b5297', marginTop: 2 }}>{pending.code}</div>
              </div>
              <label style={S.label}>Verification code</label>
              <input style={S.input} value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="000000" onKeyDown={(e) => e.key === 'Enter' && doVerify()} />
              {err && <div style={S.err}>{err}</div>}
              {ok && <div style={S.ok}>{ok}</div>}
              <button style={S.btn} onClick={doVerify}>Verify &amp; activate</button>
              <p style={{ marginTop: 16, fontSize: 13, color: '#64748b' }}>
                Didn't get it? <button style={S.link} onClick={resend}>Resend code</button>
                {'  ·  '}
                <button style={S.link} onClick={() => { reset(); setScreen('login') }}>Back to sign in</button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Authed shell: app switcher + sign out
 * ------------------------------------------------------------------ */
function Suite({ user, onSignOut }) {
  const [app, setApp] = useState('dispatch')
  const tab = (id, label) => (
    <button onClick={() => setApp(id)}
      style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
        background: app === id ? '#2563eb' : 'transparent', color: app === id ? '#fff' : '#94a3b8' }}>{label}</button>
  )
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#0f172a' }}>
        {tab('dispatch', 'Dispatch system')}
        {tab('crm', 'CRM')}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#cbd5e1', fontSize: 13 }}>{user.name || user.email}</span>
          <button onClick={onSignOut}
            style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
      </div>
      {app === 'dispatch' ? <Dispatch /> : <CRM />}
    </div>
  )
}

function Root() {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(SESSION_KEY)); if (s && s.email) setUser(s) } catch {}
    setReady(true)
  }, [])

  const signOut = () => { localStorage.removeItem(SESSION_KEY); setUser(null) }

  if (!ready) return null
  return user
    ? <Suite user={user} onSignOut={signOut} />
    : <Auth onSignedIn={setUser} />
}

createRoot(document.getElementById('root')).render(
  <StrictMode><Root /></StrictMode>
)
