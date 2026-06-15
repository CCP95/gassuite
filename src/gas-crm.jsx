import { useState, useEffect } from "react";
import {
  Home, Building2, User, Users, Target, Wrench, Search, Settings, Bell,
  HelpCircle, LayoutGrid, Plus, ChevronDown, ChevronRight, Phone, Mail,
  Globe, MapPin, Calendar, Clock, CheckCircle2, Circle, Star, X, ArrowLeft,
  Pencil, PhoneCall, PoundSterling, FileText, Send, Briefcase, StickyNote,
} from "lucide-react";

/* ------------------------------ constants ----------------------------- */
const OWNERS = ["Alex Carter", "Nadia Khan", "Joe Brennan"];
const ACCOUNT_TYPES = ["Domestic customer", "Landlord / Agent", "Commercial"];
const RATINGS = ["Hot", "Warm", "Cold"];
const OPP_STAGES = ["Qualification", "Needs analysis", "Proposal", "Negotiation", "Closed won", "Closed lost"];
const WO_TYPES = ["Repair", "Service", "Installation"];
const WO_SKILLS = ["Boilers", "Central heating", "Gas fires", "Cookers & hobs", "Commercial", "Power flushing", "Landlord certs"];
const WO_STATUS = ["New", "Unscheduled", "Scheduled", "In progress", "Completed", "Cancelled"];
const BRIDGE_KEY = "gas-bridge-workorders-v2";
const PRIORITIES = ["Emergency", "High", "Routine"];
const ACTIVITY_TYPES = ["Call", "Email", "Task", "Note"];

const OBJ = {
  home: { label: "Home", icon: Home, color: "#1b5297" },
  accounts: { label: "Accounts", singular: "Account", icon: Building2, color: "#e8730f" },
  contacts: { label: "Contacts", singular: "Contact", icon: User, color: "#7c53e8" },
  opportunities: { label: "Opportunities", singular: "Opportunity", icon: Target, color: "#d9a31e" },
  workorders: { label: "Work Orders", singular: "Work Order", icon: Wrench, color: "#0d9488" },
};
const NAV = ["home", "accounts", "contacts", "opportunities", "workorders"];

/* -------------------------------- utils -------------------------------- */
const todayISO = () => new Date().toISOString().slice(0, 10);
const relDate = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const gbp = (n) => "£" + Number(n || 0).toLocaleString("en-GB");
const seqId = (prefix, arr, pad = 5) => prefix + "-" + String(arr.length + 1).padStart(pad, "0");
// Work order numbers: 11 digits — "18" + a random 9-digit suffix (e.g. 18493027815)
const nextWoNumber = (arr) => {
  const existing = new Set(arr.map((w) => w.id));
  let n;
  do {
    n = "18" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
  } while (existing.has(n));
  return n;
};

/* -------------------------------- seed --------------------------------- */
function seed() {
  return { accounts: [], contacts: [], opportunities: [], workorders: [], activities: [] };
}

/* ------------------------------ small UI ------------------------------- */
function Tile({ object, size = 28 }) {
  const o = OBJ[object];
  const Icon = o.icon;
  const box = size + 12;
  return (
    <span className="inline-flex items-center justify-center rounded-md" style={{ background: o.color, width: box, height: box }}>
      <Icon size={size * 0.62} className="text-white" />
    </span>
  );
}
function Pill({ className, children }) {
  return <span className={"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium " + className}>{children}</span>;
}
const inputCls = "w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>{children}</label>;
}
function Modal({ title, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className="mt-12 w-full max-w-xl rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between rounded-t-lg px-5 py-3" style={{ background: "#1b5297" }}>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-blue-100 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white"><X size={18} /></button>
        </div>
        <div className="space-y-3 px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

const stageClass = (s) => s === "Closed won" ? "bg-emerald-100 text-emerald-700" : s === "Closed lost" ? "bg-slate-200 text-slate-500" : "bg-blue-100 text-blue-700";
const woStatusClass = (s) => ({
  New: "bg-slate-100 text-slate-600", Unscheduled: "bg-rose-100 text-rose-700", Scheduled: "bg-blue-100 text-blue-700",
  "In progress": "bg-amber-100 text-amber-800", Completed: "bg-emerald-100 text-emerald-700", Cancelled: "bg-slate-200 text-slate-400",
}[s]);
const prioClass = (p) => ({ Emergency: "bg-rose-100 text-rose-700", High: "bg-amber-100 text-amber-800", Routine: "bg-slate-100 text-slate-600" }[p]);
const ratingClass = (r) => ({ Hot: "bg-rose-100 text-rose-700", Warm: "bg-amber-100 text-amber-800", Cold: "bg-sky-100 text-sky-700" }[r]);

/* ================================== App ================================= */
export default function App() {
  const [data, setData] = useState(seed());
  const [loaded, setLoaded] = useState(false);
  const [route, setRoute] = useState({ object: "home", id: null });
  const [recordTab, setRecordTab] = useState("related");
  const [q, setQ] = useState("");
  const [globalQ, setGlobalQ] = useState("");
  const [modal, setModal] = useState(null);
  const [draft, setDraft] = useState({});
  const [toast, setToast] = useState("");
  const STORE_KEY = "gas-crm-v2";

  const { accounts, contacts, opportunities, workorders, activities } = data;

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        if (typeof window !== "undefined" && window.storage) {
          const r = await window.storage.get(STORE_KEY);
          if (on && r && r.value) setData(JSON.parse(r.value));
        }
      } catch (e) { /* nothing stored yet */ }
      if (on) setLoaded(true);
    })();
    return () => { on = false; };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    (async () => { try { if (window.storage) await window.storage.set(STORE_KEY, JSON.stringify(data)); } catch (e) {} })();
  }, [data, loaded]);

  // publish CRM work orders to the shared bridge (preserving dispatch's fields)
  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        if (!window.storage) return;
        const r = await window.storage.get(BRIDGE_KEY).catch(() => null);
        const existing = r && r.value ? JSON.parse(r.value) : [];
        const byWo = Object.fromEntries(existing.map((b) => [b.wo, b]));
        workorders.forEach((w) => {
          const a = accounts.find((x) => x.id === w.accountId);
          const prev = byWo[w.id] || {};
          byWo[w.id] = {
            ...prev,
            wo: w.id, account: a?.name || "—", postcode: a?.postcode || "", accountType: a?.type || "Domestic",
            address: a?.address || "", phone: a?.phone || "",
            type: w.type, skill: w.skill || "Boilers", priority: w.priority,
            requestedDate: w.requestedDate, requestedTime: w.requestedTime, durationMin: w.durationMin,
            description: w.description, subject: w.subject, crmStatus: w.status,
          };
        });
        await window.storage.set(BRIDGE_KEY, JSON.stringify(Object.values(byWo)));
      } catch (e) {}
    })();
  }, [workorders, loaded]);

  // read scheduling status back from dispatch once loaded
  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        if (!window.storage) return;
        const r = await window.storage.get(BRIDGE_KEY).catch(() => null);
        if (!r || !r.value) return;
        const byWo = Object.fromEntries(JSON.parse(r.value).map((b) => [b.wo, b]));
        const map = { Unassigned: "Unscheduled", Assigned: "Scheduled", "En route": "Scheduled", "In progress": "In progress", Completed: "Completed", Cancelled: "Cancelled" };
        setData((d) => ({
          ...d,
          workorders: d.workorders.map((w) => {
            const b = byWo[w.id];
            const ds = b && b.dispatchStatus && map[b.dispatchStatus];
            return ds && ds !== w.status ? { ...w, status: ds } : w;
          }),
        }));
      } catch (e) {}
    })();
  }, [loaded]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 3200); };
  const go = (object) => { setRoute({ object, id: null }); setQ(""); };
  const open = (object, id) => { setRoute({ object, id }); setRecordTab("related"); };

  /* lookups */
  const acc = (id) => accounts.find((a) => a.id === id);
  const con = (id) => contacts.find((c) => c.id === id);
  const accName = (id) => acc(id)?.name || "—";
  const conName = (id) => con(id)?.name || "—";

  /* ------------------------------ create / edit --------------------------- */
  const setF = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const defaults = {
    accounts: { name: "", type: ACCOUNT_TYPES[0], industry: "", phone: "", website: "", address: "", postcode: "", owner: OWNERS[0], rating: "Warm" },
    contacts: { accountId: accounts[0]?.id || "", name: "", title: "", email: "", phone: "" },
    opportunities: { accountId: accounts[0]?.id || "", name: "", stage: OPP_STAGES[0], amount: 0, closeDate: relDate(30) },
    workorders: { accountId: accounts[0]?.id || "", contactId: null, subject: "", type: "Repair", skill: "Boilers", priority: "Routine", status: "Unscheduled", requestedDate: relDate(0), requestedTime: "09:00", durationMin: 60, description: "" },
    activity: { type: "Task", subject: "", date: todayISO(), done: false },
  };
  const openCreate = (object, preset = {}) => { setDraft({ ...defaults[object], ...preset }); setModal(object); };
  const openEdit = (object, row) => { setDraft({ ...row, _editId: row.id }); setModal(object); };
  const raiseBooking = (accountId) => openCreate("workorders", { accountId, status: "Unscheduled", _lock: true });
  const openActivity = (type) => { setDraft({ ...defaults.activity, type }); setModal("activity"); };

  const idPrefix = { accounts: "ACC", contacts: "CON", opportunities: "OPP", workorders: "WO" };
  const saveRecord = (object) => {
    const { _editId, _lock, ...rest } = draft;
    setData((d) => {
      const arr = d[object];
      if (_editId) return { ...d, [object]: arr.map((r) => (r.id === _editId ? { ...r, ...rest } : r)) };
      const rec = { ...rest, id: object === "workorders" ? nextWoNumber(arr) : seqId(idPrefix[object], arr) };
      if (object === "opportunities") rec.amount = Number(rec.amount) || 0;
      if (object === "workorders") rec.durationMin = Number(rec.durationMin) || 60;
      return { ...d, [object]: [rec, ...arr] };
    });
    setModal(null);
    if (object === "workorders" && !_editId) { flash("Work order created — queued as Unscheduled for dispatch."); open("workorders", null); }
    else flash(`${OBJ[object]?.singular || "Record"} saved.`);
  };
  const saveActivity = () => {
    const rec = { ...draft, id: "ACT-" + Math.random().toString(36).slice(2, 7), recordId: route.id };
    setData((d) => ({ ...d, activities: [rec, ...d.activities] }));
    setModal(null);
  };
  const toggleActivity = (id) => setData((d) => ({ ...d, activities: d.activities.map((a) => (a.id === id ? { ...a, done: !a.done } : a)) }));
  const setWOStatus = (id, status) => setData((d) => ({ ...d, workorders: d.workorders.map((w) => (w.id === id ? { ...w, status } : w)) }));

  /* ================================ HOME ================================= */
  function renderHome() {
    const openWO = workorders.filter((w) => !["Completed", "Cancelled"].includes(w.status));
    const unsched = workorders.filter((w) => w.status === "Unscheduled");
    const openOpps = opportunities.filter((o) => !o.stage.startsWith("Closed"));
    const pipeline = openOpps.reduce((s, o) => s + (o.amount || 0), 0);
    const tasks = activities.filter((a) => a.type === "Task" && !a.done);
    const byStage = OPP_STAGES.filter((s) => !s.startsWith("Closed")).map((s) => ({ s, v: openOpps.filter((o) => o.stage === s).reduce((x, o) => x + o.amount, 0) }));
    const maxStage = Math.max(1, ...byStage.map((x) => x.v));
    const kpis = [
      { label: "Open work orders", value: openWO.length, color: "#0d9488" },
      { label: "Unscheduled (to dispatch)", value: unsched.length, color: "#e11d48" },
      { label: "Open opportunities", value: openOpps.length, color: "#d9a31e" },
      { label: "Pipeline value", value: gbp(pipeline), color: "#1b5297" },
    ];
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-2xl font-semibold" style={{ color: k.color }}>{k.value}</div>
              <div className="text-xs text-slate-500">{k.label}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2"><Tile object="workorders" size={20} /><h3 className="text-sm font-semibold text-slate-700">Unscheduled work — ready for dispatch</h3></div>
              <Pill className="bg-rose-100 text-rose-700">{unsched.length}</Pill>
            </div>
            <div className="divide-y divide-slate-100">
              {unsched.length === 0 && <p className="px-4 py-6 text-sm text-slate-400">Nothing waiting. New work orders appear here until dispatched.</p>}
              {unsched.map((w) => (
                <button key={w.id} onClick={() => open("workorders", w.id)} className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-blue-700">{w.subject}</div>
                    <div className="font-mono text-xs text-slate-400">{w.id} · {accName(w.accountId)} · {fmtDate(w.requestedDate)} {w.requestedTime}</div>
                  </div>
                  <div className="flex items-center gap-2"><Pill className={prioClass(w.priority)}>{w.priority}</Pill><Pill className={woStatusClass(w.status)}>{w.status}</Pill></div>
                </button>
              ))}
            </div>
            <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">These sync to the Dispatch schedule board's Unscheduled queue.</div>
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3"><h3 className="text-sm font-semibold text-slate-700">Pipeline by stage</h3></div>
              <div className="space-y-2 p-4">
                {byStage.map((x) => (
                  <div key={x.s}>
                    <div className="mb-0.5 flex justify-between text-xs text-slate-500"><span>{x.s}</span><span className="font-medium text-slate-700">{gbp(x.v)}</span></div>
                    <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: (x.v / maxStage) * 100 + "%", background: "#1b5297" }} /></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3"><h3 className="text-sm font-semibold text-slate-700">My open tasks</h3></div>
              <div className="divide-y divide-slate-100">
                {tasks.length === 0 && <p className="px-4 py-4 text-xs text-slate-400">No open tasks.</p>}
                {tasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 px-4 py-2.5">
                    <button onClick={() => toggleActivity(t.id)} className="text-slate-300 hover:text-emerald-500"><Circle size={15} /></button>
                    <div className="min-w-0 flex-1"><div className="truncate text-sm text-slate-700">{t.subject}</div><div className="text-xs text-slate-400">Due {fmtDate(t.date)}</div></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* =============================== LIST VIEW ============================= */
  function columnsFor(object) {
    if (object === "accounts") return [
      { label: "Account Name", link: true, get: (r) => r.name },
      { label: "Type", get: (r) => r.type },
      { label: "Phone", get: (r) => r.phone },
      { label: "Postcode", get: (r) => r.postcode },
      { label: "Owner", get: (r) => r.owner },
      { label: "Rating", get: (r) => <Pill className={ratingClass(r.rating)}>{r.rating}</Pill> },
    ];
    if (object === "contacts") return [
      { label: "Name", link: true, get: (r) => r.name },
      { label: "Title", get: (r) => r.title },
      { label: "Account", get: (r) => accName(r.accountId) },
      { label: "Phone", get: (r) => r.phone },
      { label: "Email", get: (r) => r.email },
    ];
    if (object === "opportunities") return [
      { label: "Opportunity", link: true, get: (r) => r.name },
      { label: "Account", get: (r) => accName(r.accountId) },
      { label: "Stage", get: (r) => <Pill className={stageClass(r.stage)}>{r.stage}</Pill> },
      { label: "Amount", get: (r) => gbp(r.amount) },
      { label: "Close Date", get: (r) => fmtDate(r.closeDate) },
    ];
    return [
      { label: "Work Order", link: true, get: (r) => r.id },
      { label: "Subject", get: (r) => r.subject },
      { label: "Account", get: (r) => accName(r.accountId) },
      { label: "Type", get: (r) => r.type },
      { label: "Priority", get: (r) => <Pill className={prioClass(r.priority)}>{r.priority}</Pill> },
      { label: "Status", get: (r) => <Pill className={woStatusClass(r.status)}>{r.status}</Pill> },
    ];
  }
  function renderList(object) {
    const cols = columnsFor(object);
    const term = q.trim().toLowerCase();
    const rows = data[object].filter((r) => !term || JSON.stringify(r).toLowerCase().includes(term));
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <Tile object={object} />
            <div>
              <div className="flex items-center gap-1 text-xs text-slate-400">All {OBJ[object].label} <ChevronDown size={12} /></div>
              <div className="text-lg font-semibold text-slate-800">{OBJ[object].label}</div>
            </div>
            <span className="ml-2 self-center text-xs text-slate-400">{rows.length} item{rows.length === 1 ? "" : "s"}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${OBJ[object].label.toLowerCase()}`} className="rounded border border-slate-300 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button onClick={() => openCreate(object)} className="flex items-center gap-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"><Plus size={15} /> New</button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>{cols.map((c) => <th key={c.label} className="px-4 py-2 font-medium">{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-blue-50">
                  {cols.map((c, i) => (
                    <td key={i} className="px-4 py-2.5 text-slate-600">
                      {c.link ? <button onClick={() => open(object, r.id)} className="font-medium text-blue-700 hover:underline focus:outline-none">{c.get(r)}</button> : c.get(r)}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={cols.length} className="px-4 py-6 text-center text-slate-400">No records.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /* ============================== RECORD PAGE ============================ */
  function recordConfig(object, r) {
    if (object === "accounts") {
      const cs = contacts.filter((c) => c.accountId === r.id);
      const os = opportunities.filter((o) => o.accountId === r.id);
      const ws = workorders.filter((w) => w.accountId === r.id);
      return {
        title: r.name, subtitle: r.type,
        highlights: [["Type", r.type], ["Phone", r.phone], ["Owner", r.owner], ["Rating", r.rating]],
        actions: [
          { label: "Raise booking", icon: Briefcase, primary: true, onClick: () => raiseBooking(r.id) },
          { label: "New contact", icon: Plus, onClick: () => openCreate("contacts", { accountId: r.id, _lock: true }) },
          { label: "Edit", icon: Pencil, onClick: () => openEdit("accounts", r) },
        ],
        details: [
          ["Account name", r.name], ["Type", r.type], ["Industry", r.industry], ["Phone", r.phone],
          ["Website", r.website || "—"], ["Billing address", `${r.address}, ${r.postcode}`], ["Owner", r.owner], ["Rating", r.rating],
        ],
        related: [
          { object: "contacts", title: "Contacts", rows: cs, line: (c) => [c.name, c.title] },
          { object: "opportunities", title: "Opportunities", rows: os, line: (o) => [o.name, `${o.stage} · ${gbp(o.amount)}`] },
          { object: "workorders", title: "Work Orders", rows: ws, line: (w) => [w.subject, `${w.status} · ${fmtDate(w.requestedDate)}`] },
        ],
      };
    }
    if (object === "contacts") {
      const ws = workorders.filter((w) => w.contactId === r.id);
      return {
        title: r.name, subtitle: r.title,
        highlights: [["Account", accName(r.accountId)], ["Title", r.title], ["Phone", r.phone], ["Email", r.email]],
        actions: [{ label: "Edit", icon: Pencil, onClick: () => openEdit("contacts", r) }],
        details: [["Name", r.name], ["Title", r.title], ["Account", accName(r.accountId)], ["Phone", r.phone], ["Email", r.email]],
        related: [{ object: "workorders", title: "Related Work Orders", rows: ws, line: (w) => [w.subject, w.status] }],
      };
    }
    if (object === "opportunities") {
      return {
        title: r.name, subtitle: accName(r.accountId),
        highlights: [["Stage", r.stage], ["Amount", gbp(r.amount)], ["Close", fmtDate(r.closeDate)], ["Account", accName(r.accountId)]],
        actions: [{ label: "Edit", icon: Pencil, onClick: () => openEdit("opportunities", r) }],
        details: [["Opportunity", r.name], ["Account", accName(r.accountId)], ["Stage", r.stage], ["Amount", gbp(r.amount)], ["Close date", fmtDate(r.closeDate)]],
        related: [],
        stagePath: true,
      };
    }
    // work order
    return {
      title: r.subject, subtitle: `${r.id} · ${accName(r.accountId)}`,
      highlights: [["Status", r.status], ["Type", r.type], ["Priority", r.priority], ["Requested", `${fmtDate(r.requestedDate)} ${r.requestedTime}`]],
      actions: [
        { label: "Edit", icon: Pencil, onClick: () => openEdit("workorders", r) },
        ...(r.status === "Unscheduled" ? [{ label: "Mark Scheduled", icon: Send, primary: true, onClick: () => { setWOStatus(r.id, "Scheduled"); flash("Marked Scheduled."); } }] : []),
        ...(r.status === "Scheduled" ? [{ label: "Start job", icon: Clock, onClick: () => setWOStatus(r.id, "In progress") }] : []),
        ...(r.status === "In progress" ? [{ label: "Complete", icon: CheckCircle2, primary: true, onClick: () => setWOStatus(r.id, "Completed") }] : []),
        ...(!["Completed", "Cancelled"].includes(r.status) ? [{ label: "Cancel work order", icon: X, danger: true, onClick: () => { setWOStatus(r.id, "Cancelled"); flash("Work order cancelled."); } }] : []),
      ],
      details: [
        ["Subject", r.subject], ["Account", accName(r.accountId)], ["Contact", conName(r.contactId)], ["Type", r.type], ["Trade", r.skill || "—"],
        ["Priority", r.priority], ["Status", r.status], ["Requested date", fmtDate(r.requestedDate)], ["Requested time", r.requestedTime],
        ["Duration", r.durationMin + " min"], ["Description", r.description || "—"],
      ],
      related: [],
    };
  }

  function renderRecord(object, id) {
    const r = data[object].find((x) => x.id === id);
    if (!r) return <button onClick={() => go(object)} className="text-sm font-medium text-blue-700">← Back</button>;
    const cfg = recordConfig(object, r);
    const acts = activities.filter((a) => a.recordId === id);
    return (
      <div className="space-y-3">
        <button onClick={() => go(object)} className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"><ArrowLeft size={14} /> {OBJ[object].label}</button>

        {/* highlights panel */}
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="flex items-start gap-3">
              <Tile object={object} size={34} />
              <div>
                <div className="text-xs text-slate-400">{OBJ[object].singular}</div>
                <h2 className="text-lg font-semibold text-slate-800">{cfg.title}</h2>
                <div className="text-xs text-slate-500">{cfg.subtitle}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {cfg.actions.map((a) => (
                <button key={a.label} onClick={a.onClick}
                  className={"flex items-center gap-1 rounded px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 " + (a.primary ? "bg-blue-600 text-white hover:bg-blue-700" : a.danger ? "border border-rose-300 text-rose-600 hover:bg-rose-50" : "border border-slate-300 text-slate-700 hover:bg-slate-50")}>
                  <a.icon size={14} /> {a.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px border-t border-slate-200 bg-slate-200 sm:grid-cols-4">
            {cfg.highlights.map(([k, v]) => (
              <div key={k} className="bg-white px-4 py-2">
                <div className="text-xs text-slate-400">{k}</div>
                <div className="truncate text-sm font-medium text-slate-700">{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* opportunity stage path */}
        {cfg.stagePath && (
          <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
            {OPP_STAGES.map((s) => (
              <span key={s} className={"rounded px-2.5 py-1 text-xs font-medium " + (s === r.stage ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500")}>{s}</span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* main: tabs */}
          <div className="lg:col-span-2">
            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex gap-1 border-b border-slate-200 px-2">
                {["related", "details"].map((t) => (
                  <button key={t} onClick={() => setRecordTab(t)}
                    className={"px-4 py-2.5 text-sm font-medium capitalize focus:outline-none " + (recordTab === t ? "border-b-2 border-blue-600 text-blue-700" : "text-slate-500 hover:text-slate-700")}>{t}</button>
                ))}
              </div>
              {recordTab === "details" && (
                <div className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
                  {cfg.details.map(([k, v]) => (
                    <div key={k} className="border-b border-slate-100 pb-2">
                      <div className="text-xs text-slate-400">{k}</div>
                      <div className="text-sm text-slate-700">{v}</div>
                    </div>
                  ))}
                </div>
              )}
              {recordTab === "related" && (
                <div className="space-y-3 p-4">
                  {cfg.related.length === 0 && <p className="text-sm text-slate-400">No related lists for this record.</p>}
                  {cfg.related.map((rel) => (
                    <div key={rel.title} className="rounded-md border border-slate-200">
                      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                        <div className="flex items-center gap-2"><Tile object={rel.object} size={16} /><span className="text-sm font-semibold text-slate-700">{rel.title} ({rel.rows.length})</span></div>
                        {rel.object === "workorders" && object === "accounts" && (
                          <button onClick={() => raiseBooking(r.id)} className="text-xs font-medium text-blue-700 hover:underline">New</button>
                        )}
                        {rel.object === "contacts" && (
                          <button onClick={() => openCreate("contacts", { accountId: r.id, _lock: true })} className="text-xs font-medium text-blue-700 hover:underline">New</button>
                        )}
                      </div>
                      <div className="divide-y divide-slate-100">
                        {rel.rows.map((row) => {
                          const [a, b] = rel.line(row);
                          return (
                            <button key={row.id} onClick={() => open(rel.object, row.id)} className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50">
                              <span className="truncate text-sm text-blue-700">{a}</span>
                              <span className="ml-3 shrink-0 text-xs text-slate-400">{b}</span>
                            </button>
                          );
                        })}
                        {rel.rows.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">None.</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* activity timeline */}
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3"><h3 className="text-sm font-semibold text-slate-700">Activity</h3></div>
            <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-4 py-2.5">
              {[["Call", PhoneCall], ["Email", Mail], ["Task", CheckCircle2], ["Note", StickyNote]].map(([t, Ic]) => (
                <button key={t} onClick={() => openActivity(t)} className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"><Ic size={12} /> {t}</button>
              ))}
            </div>
            <div className="space-y-3 p-4">
              {acts.length === 0 && <p className="text-xs text-slate-400">No activity logged yet. Use the buttons above.</p>}
              {acts.map((a) => (
                <div key={a.id} className="flex gap-2">
                  <button onClick={() => a.type === "Task" && toggleActivity(a.id)} className={"mt-0.5 shrink-0 " + (a.done ? "text-emerald-500" : "text-slate-300")}>
                    {a.done ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                  </button>
                  <div className="min-w-0">
                    <div className="text-sm text-slate-700">{a.subject}</div>
                    <div className="text-xs text-slate-400">{a.type} · {fmtDate(a.date)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ================================ MODALS =============================== */
  function renderModal() {
    if (!modal) return null;
    const cancel = <button onClick={() => setModal(null)} className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>;
    const save = (fn, label) => <button onClick={fn} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">{label}</button>;
    const editing = !!draft._editId;
    const titleFor = (o) => (editing ? "Edit " : "New ") + OBJ[o].singular;

    if (modal === "accounts") return (
      <Modal title={titleFor("accounts")} onClose={() => setModal(null)} footer={<>{cancel}{save(() => saveRecord("accounts"), "Save")}</>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Account name"><input className={inputCls} value={draft.name} onChange={(e) => setF("name", e.target.value)} /></Field>
          <Field label="Type"><select className={inputCls} value={draft.type} onChange={(e) => setF("type", e.target.value)}>{ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Industry"><input className={inputCls} value={draft.industry} onChange={(e) => setF("industry", e.target.value)} /></Field>
          <Field label="Phone"><input className={inputCls} value={draft.phone} onChange={(e) => setF("phone", e.target.value)} /></Field>
        </div>
        <Field label="Address"><input className={inputCls} value={draft.address} onChange={(e) => setF("address", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Postcode"><input className={inputCls} value={draft.postcode} onChange={(e) => setF("postcode", e.target.value)} /></Field>
          <Field label="Website"><input className={inputCls} value={draft.website} onChange={(e) => setF("website", e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner"><select className={inputCls} value={draft.owner} onChange={(e) => setF("owner", e.target.value)}>{OWNERS.map((o) => <option key={o}>{o}</option>)}</select></Field>
          <Field label="Rating"><select className={inputCls} value={draft.rating} onChange={(e) => setF("rating", e.target.value)}>{RATINGS.map((o) => <option key={o}>{o}</option>)}</select></Field>
        </div>
      </Modal>
    );

    if (modal === "contacts") return (
      <Modal title={titleFor("contacts")} onClose={() => setModal(null)} footer={<>{cancel}{save(() => saveRecord("contacts"), "Save")}</>}>
        <Field label="Account">
          {draft._lock ? <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700">{accName(draft.accountId)}</div>
            : <select className={inputCls} value={draft.accountId} onChange={(e) => setF("accountId", e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input className={inputCls} value={draft.name} onChange={(e) => setF("name", e.target.value)} /></Field>
          <Field label="Title"><input className={inputCls} value={draft.title} onChange={(e) => setF("title", e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><input className={inputCls} value={draft.phone} onChange={(e) => setF("phone", e.target.value)} /></Field>
          <Field label="Email"><input className={inputCls} value={draft.email} onChange={(e) => setF("email", e.target.value)} /></Field>
        </div>
      </Modal>
    );

    if (modal === "opportunities") return (
      <Modal title={titleFor("opportunities")} onClose={() => setModal(null)} footer={<>{cancel}{save(() => saveRecord("opportunities"), "Save")}</>}>
        <Field label="Opportunity name"><input className={inputCls} value={draft.name} onChange={(e) => setF("name", e.target.value)} /></Field>
        <Field label="Account"><select className={inputCls} value={draft.accountId} onChange={(e) => setF("accountId", e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Stage"><select className={inputCls} value={draft.stage} onChange={(e) => setF("stage", e.target.value)}>{OPP_STAGES.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Amount (£)"><input type="number" className={inputCls} value={draft.amount} onChange={(e) => setF("amount", e.target.value)} /></Field>
          <Field label="Close date"><input type="date" className={inputCls} value={draft.closeDate} onChange={(e) => setF("closeDate", e.target.value)} /></Field>
        </div>
      </Modal>
    );

    if (modal === "workorders") return (
      <Modal title={titleFor("workorders")} onClose={() => setModal(null)} footer={<>{cancel}{save(() => saveRecord("workorders"), editing ? "Save" : "Raise booking")}</>}>
        <Field label="Account">
          {draft._lock ? <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700">{accName(draft.accountId)}</div>
            : <select className={inputCls} value={draft.accountId} onChange={(e) => setF("accountId", e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
        </Field>
        <Field label="Subject"><input className={inputCls} value={draft.subject} onChange={(e) => setF("subject", e.target.value)} placeholder="e.g. No hot water — boiler repair" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><select className={inputCls} value={draft.type} onChange={(e) => setF("type", e.target.value)}>{WO_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Trade"><select className={inputCls} value={draft.skill} onChange={(e) => setF("skill", e.target.value)}>{WO_SKILLS.map((s) => <option key={s}>{s}</option>)}</select></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority"><select className={inputCls} value={draft.priority} onChange={(e) => setF("priority", e.target.value)}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Status"><select className={inputCls} value={draft.status} onChange={(e) => setF("status", e.target.value)}>{WO_STATUS.map((s) => <option key={s}>{s}</option>)}</select></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Requested date"><input type="date" className={inputCls} value={draft.requestedDate} onChange={(e) => setF("requestedDate", e.target.value)} /></Field>
          <Field label="Requested time"><input type="time" className={inputCls} value={draft.requestedTime} onChange={(e) => setF("requestedTime", e.target.value)} /></Field>
          <Field label="Duration (min)"><input type="number" step="15" className={inputCls} value={draft.durationMin} onChange={(e) => setF("durationMin", e.target.value)} /></Field>
        </div>
        <Field label="Description"><textarea rows={2} className={inputCls} value={draft.description} onChange={(e) => setF("description", e.target.value)} /></Field>
        {!editing && <p className="text-xs text-slate-500">Saving with status <span className="font-medium text-rose-600">Unscheduled</span> queues this for the dispatch board.</p>}
      </Modal>
    );

    if (modal === "activity") return (
      <Modal title={`Log ${draft.type}`} onClose={() => setModal(null)} footer={<>{cancel}{save(saveActivity, "Save")}</>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><select className={inputCls} value={draft.type} onChange={(e) => setF("type", e.target.value)}>{ACTIVITY_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Date"><input type="date" className={inputCls} value={draft.date} onChange={(e) => setF("date", e.target.value)} /></Field>
        </div>
        <Field label="Subject"><input className={inputCls} value={draft.subject} onChange={(e) => setF("subject", e.target.value)} /></Field>
      </Modal>
    );
    return null;
  }

  /* ================================ SHELL ================================ */
  const globalResults = globalQ.trim().length > 1
    ? NAV.filter((o) => o !== "home").flatMap((o) => data[o]
        .filter((r) => JSON.stringify(r).toLowerCase().includes(globalQ.toLowerCase()))
        .slice(0, 4).map((r) => ({ o, r })))
    : [];

  return (
    <div className="min-h-screen font-sans text-slate-800" style={{ background: "#f3f2f2" }}>
      {/* global header */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2">
        <button className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label="App launcher"><LayoutGrid size={18} /></button>
        <div className="relative flex-1 max-w-xl">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-slate-400" />
          <input value={globalQ} onChange={(e) => setGlobalQ(e.target.value)} placeholder="Search Salesforce" className="w-full rounded-md border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {globalResults.length > 0 && (
            <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
              {globalResults.map(({ o, r }, i) => (
                <button key={i} onClick={() => { open(o, r.id); setGlobalQ(""); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <Tile object={o} size={14} /><span className="truncate text-slate-700">{r.name || r.subject || r.id}</span>
                  <span className="ml-auto text-xs text-slate-400">{OBJ[o].singular}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 text-slate-500">
          <button className="rounded p-1.5 hover:bg-slate-100"><HelpCircle size={18} /></button>
          <button className="rounded p-1.5 hover:bg-slate-100"><Settings size={18} /></button>
          <button className="rounded p-1.5 hover:bg-slate-100"><Bell size={18} /></button>
          <span className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">AC</span>
        </div>
      </div>

      {/* themed app nav */}
      <div style={{ background: "#1b5297" }} className="px-3">
        <div className="flex flex-wrap items-center gap-1 py-1.5">
          <div className="mr-3 flex items-center gap-2 rounded bg-white/10 px-2 py-1.5">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-white/90"><Wrench size={14} style={{ color: "#1b5297" }} /></span>
            <span className="text-sm font-semibold text-white">Gas Service CRM</span>
            <ChevronDown size={13} className="text-blue-200" />
          </div>
          {NAV.map((o) => (
            <button key={o} onClick={() => go(o)}
              className={"rounded-t px-3 py-2 text-sm font-medium focus:outline-none " + (route.object === o ? "bg-white text-slate-800" : "text-white hover:bg-white/10")}>
              {OBJ[o].label}
            </button>
          ))}
        </div>
      </div>

      <main className="mx-auto max-w-7xl p-4">
        {route.object === "home" && renderHome()}
        {route.object !== "home" && (route.id ? renderRecord(route.object, route.id) : renderList(route.object))}
      </main>

      {renderModal()}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg">
          <CheckCircle2 size={16} className="text-emerald-400" />{toast}
        </div>
      )}
    </div>
  );
}
