import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { supabase } from './supabaseClient.js'
import Dispatch from './dispatch-system.jsx'
import CRM from './gas-crm.jsx'

/* ------------------------------------------------------------------ *
 *  window.storage — now backed by a shared Supabase table.
 *  Both apps call window.storage; we don't touch their code.
 *  Every signed-in user reads/writes the same rows = shared data.
 * ------------------------------------------------------------------ */
const TABLE = 'app_storage'
window.storage = {
  async get(key) {
    try {
      const { data, error } = await supabase.from(TABLE).select('value').eq('key', key).maybeSingle()
      if (error || !data) return null
      return { key, value: data.value }
    } catch { return null }
  },
  async set(key, value) {
    try { await supabase.from(TABLE).upsert({ key, value, updated_at: new Date().toISOString() }) } catch {}
    return { key, value }
  },
  async delete(key) {
    try { await supabase.from(TABLE).delete().eq('key', key) } catch {}
    return { key, deleted: true }
  },
  async list(prefix = '') {
    try {
      const { data } = await supabase.from(TABLE).select('key').like('key', prefix + '%')
      return { keys: (data || []).map((r) => r.key) }
    } catch { return { keys: [] } }
  },
}

const REDIRECT = `${window.location.origin}${import.meta.env.BASE_URL}`

/* --- inline styles --- */
const S = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', fontFamily: 'ui-sans-serif, system-ui, sans-serif', padding: 16 },
  card: { width: '100%', maxWidth: 400, background: '#fff', borderRadius: 14, boxShadow: '0 10px 40px rgba(0,0,0,.08)', overflow: 'hidden' },
  head: { background: '#1b5297', padding: '22px 24px', color: '#fff' },
  body: { padding: 24 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', margin: '12px 0 4px' },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14, outline: 'none' },
  btn: { width: '100%', marginTop: 18, padding: '11px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnDisabled: { opacity: .6, cursor: 'default' },
  link: { background: 'none', border: 'none', color: '#2563eb', fontWeight: 600, cursor: 'pointer', fontSize: 13, padding: 0 },
  err: { background: '#fee2e2', color: '#b91c1c', fontSize: 13, padding: '8px 10px', borderRadius: 8, marginTop: 12 },
  ok: { background: '#dcfce7', color: '#15803d', fontSize: 13, padding: '8px 10px', borderRadius: 8, marginTop: 12 },
  note: { marginTop: 16, border: '1px dashed #94a3b8', borderRadius: 8, padding: 12, background: '#f8fafc', fontSize: 13, color: '#475569' },
}

function Auth() {
  const [screen, setScreen] = useState('login') // login | signup | sent
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = () => { setErr(''); setOk(''); setPassword(''); setConfirm('') }

  const doSignup = async () => {
    setErr('')
    if (!name.trim() || !email.trim() || !password) return setErr('Please fill in every field.')
    if (password.length < 6) return setErr('Password must be at least 6 characters.')
    if (password !== confirm) return setErr('Passwords do not match.')
    setBusy(true)
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { name: name.trim() }, emailRedirectTo: REDIRECT },
    })
    setBusy(false)
    if (error) return setErr(error.message)
    setScreen('sent')
  }

  const doLogin = async () => {
    setErr('')
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) {
      if (/confirm/i.test(error.message)) return setErr('Please confirm your email first — check your inbox for the verification link.')
      return setErr('Incorrect email or password.')
    }
  }

  const resend = async () => {
    setErr(''); setOk('')
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: REDIRECT } })
    if (error) setErr(error.message); else setOk('Verification email sent again.')
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
              <button style={{ ...S.btn, ...(busy ? S.btnDisabled : {}) }} disabled={busy} onClick={doLogin}>{busy ? 'Signing in…' : 'Sign in'}</button>
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
              <button style={{ ...S.btn, ...(busy ? S.btnDisabled : {}) }} disabled={busy} onClick={doSignup}>{busy ? 'Creating…' : 'Create account'}</button>
              <p style={{ marginTop: 16, fontSize: 13, color: '#64748b' }}>
                Already registered? <button style={S.link} onClick={() => { reset(); setScreen('login') }}>Sign in</button>
              </p>
            </>
          )}

          {screen === 'sent' && (
            <>
              <h2 style={{ margin: '0 0 4px', fontSize: 18, color: '#0f172a' }}>Check your email</h2>
              <div style={S.note}>
                We've sent a verification link to <b>{email}</b>. Click it to activate your account, then come back and sign in.
                <br /><br />It can take a minute, and may land in your spam folder.
              </div>
              {err && <div style={S.err}>{err}</div>}
              {ok && <div style={S.ok}>{ok}</div>}
              <button style={S.btn} onClick={() => { reset(); setScreen('login') }}>Back to sign in</button>
              <p style={{ marginTop: 16, fontSize: 13, color: '#64748b' }}>
                Didn't get it? <button style={S.link} onClick={resend}>Resend link</button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Suite({ user }) {
  const [app, setApp] = useState('dispatch')
  const name = user.user_metadata?.name || user.email
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
          <span style={{ color: '#cbd5e1', fontSize: 13 }}>{name}</span>
          <button onClick={() => supabase.auth.signOut()}
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
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!ready) return null
  return session ? <Suite user={session.user} /> : <Auth />
}

createRoot(document.getElementById('root')).render(
  <StrictMode><Root /></StrictMode>
)
