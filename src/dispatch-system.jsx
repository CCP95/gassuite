import { useState, useEffect, useRef } from "react";
import {
  Flame, LayoutDashboard, ClipboardList, Wrench, Users, FileCheck2,
  Plus, X, MapPin, Phone, Clock, AlertTriangle, CheckCircle2,
  CircleDot, ArrowRight, ShieldCheck, RotateCw, Search, Calendar,
  CalendarRange, ChevronLeft, ChevronRight, GripVertical, Minus,
  Building2, ArrowLeft, UserPlus, Mail, Briefcase, ChevronDown, Circle,
} from "lucide-react";

/* ----------------------------- constants ----------------------------- */
const SKILLS = [
  "Boilers", "Central heating", "Gas fires", "Cookers & hobs",
  "Commercial", "Power flushing", "Landlord certs",
];
const PRIORITIES = ["Emergency", "High", "Routine"];
const JOB_STATUSES = ["Unassigned", "Assigned", "En route", "In progress", "Completed"];
const CUSTOMER_TYPES = ["Domestic", "Landlord", "Commercial"];
const CERT_TYPES = ["CP12 — Landlord Gas Safety", "Domestic service record", "Commercial CP42"];
const ENG_STATUS = ["Available", "On job", "Off shift"];

/* ------------------------------- utils -------------------------------- */
const uid = (p) => p + "-" + Math.random().toString(36).slice(2, 8);
// Work order number from the CRM: 11 digits — "18" + a random 9-digit suffix
const woNumber = () => "18" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
const DAY = 86400000;
const relDate = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);
const addMonths = (iso, m) => {
  const dt = new Date(iso);
  dt.setMonth(dt.getMonth() + m);
  return dt.toISOString().slice(0, 10);
};
const daysUntil = (iso) => Math.ceil((Date.parse(iso) - Date.now()) / DAY);
const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const isToday = (iso) => iso === new Date().toISOString().slice(0, 10);
const certStatus = (expiry) => {
  const d = daysUntil(expiry);
  if (d < 0) return "Expired";
  if (d <= 30) return "Expiring";
  return "Valid";
};

/* ---------------------- schedule board geometry ---------------------- */
const WIN_START = 7;          // board starts 07:00
const WIN_END = 19;           // board ends 19:00
const PX_HR = 64;             // pixels per hour
const TRACK_W = (WIN_END - WIN_START) * PX_HR;
const RESOURCE_W = 176;       // width of the engineer name column
const ROW_H = 60;             // height of each engineer row
const HOURS = Array.from({ length: WIN_END - WIN_START + 1 }, (_, i) => WIN_START + i);
const timeToMin = (t) => { const [h, m] = (t || "07:00").split(":").map(Number); return h * 60 + m; };
const minToTime = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
const snap15 = (m) => Math.round(m / 15) * 15;
const jobDuration = (j) => j.durationMin || (j.type === "Service" ? 90 : 60);

/* -------------------- travel estimation (London) --------------------- */
// Approximate coordinates for specific outward codes seen in the data,
// with a prefix-based fallback so any London postcode resolves to something.
const OUTWARD = {
  NW7: { lat: 51.611, lng: -0.238 }, NW1: { lat: 51.535, lng: -0.143 },
  N1: { lat: 51.538, lng: -0.099 }, N2: { lat: 51.589, lng: -0.166 },
  SW11: { lat: 51.464, lng: -0.166 }, E8: { lat: 51.545, lng: -0.060 },
  SE1: { lat: 51.501, lng: -0.090 }, SE23: { lat: 51.441, lng: -0.052 },
};
const PREFIX = {
  EC: { lat: 51.517, lng: -0.090 }, WC: { lat: 51.516, lng: -0.120 },
  NW: { lat: 51.547, lng: -0.196 }, SE: { lat: 51.470, lng: -0.050 },
  SW: { lat: 51.463, lng: -0.166 }, N: { lat: 51.565, lng: -0.110 },
  E: { lat: 51.535, lng: -0.030 }, W: { lat: 51.510, lng: -0.215 },
  S: { lat: 51.450, lng: -0.120 },
};
const ENG_AREA = {
  "North London": { lat: 51.565, lng: -0.110 }, "East London": { lat: 51.535, lng: -0.030 },
  "South London": { lat: 51.462, lng: -0.110 }, "West London": { lat: 51.510, lng: -0.215 },
  "Central": { lat: 51.515, lng: -0.118 },
};
const pcCoord = (pc) => {
  if (!pc) return PREFIX.WC;
  const out = pc.trim().toUpperCase().split(/\s+/)[0];
  if (OUTWARD[out]) return OUTWARD[out];
  const alpha = (out.match(/^[A-Z]+/) || [""])[0];
  return PREFIX[alpha] || PREFIX[alpha.slice(0, 1)] || PREFIX.WC;
};
const areaCoord = (area) => ENG_AREA[area] || PREFIX.WC;
const distKm = (a, b) => {
  if (!a || !b) return 5;
  const R = 6371, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const travelMin = (a, b) => Math.max(10, Math.round((distKm(a, b) / 22) * 60)); // ~22 km/h urban avg

// Pure scheduler: returns a new jobs array plus counts. Greedy insertion
// heuristic — priority order, skill match, earliest feasible slot allowing
// travel between consecutive jobs, with a light load-balancing penalty.
function planSchedule(d, day) {
  const onShift = d.engineers.filter((e) => e.status !== "Off shift");
  const plan = {};
  onShift.forEach((e) => {
    plan[e.id] = d.jobs
      .filter((j) => j.engineerId === e.id && j.date === day && j.status !== "Cancelled")
      .map((j) => {
        const c = d.customers.find((x) => x.id === j.customerId);
        const start = timeToMin(j.time);
        return { start, end: start + jobDuration(j), coord: pcCoord(c?.postcode) };
      })
      .sort((a, b) => a.start - b.start);
  });
  const rank = { Emergency: 0, High: 1, Routine: 2 };
  const queue = d.jobs
    .filter((j) => j.status === "Unassigned")
    .sort((a, b) => (rank[a.priority] - rank[b.priority]) || (timeToMin(a.time) - timeToMin(b.time)));

  const assignments = {};
  let assigned = 0, unplaceable = 0;

  for (const job of queue) {
    const c = d.customers.find((x) => x.id === job.customerId);
    const loc = pcCoord(c?.postcode);
    const dur = jobDuration(job);
    const reqRaw = timeToMin(job.time);
    const req = Math.max(WIN_START * 60, Math.min(reqRaw, WIN_END * 60 - dur));
    let best = null;

    for (const e of onShift) {
      if (!e.skills.includes(job.skill)) continue;
      const bookings = plan[e.id];
      const load = bookings.length;
      let prevEnd = WIN_START * 60, prevCoord = areaCoord(e.area);
      for (let i = 0; i <= bookings.length; i++) {
        const next = bookings[i];
        const earliest = prevEnd + travelMin(prevCoord, loc);
        const desired = Math.max(earliest, req);
        const latestStart = next ? next.start - travelMin(loc, next.coord) - dur : WIN_END * 60 - dur;
        if (desired <= latestStart && desired + dur <= WIN_END * 60) {
          const added = travelMin(prevCoord, loc) + (next ? travelMin(loc, next.coord) - travelMin(prevCoord, next.coord) : 0);
          const score = added + 2 * load;
          if (!best || score < best.score || (score === best.score && desired < best.start)) {
            best = { engId: e.id, start: desired, score };
          }
        }
        if (next) { prevEnd = next.end; prevCoord = next.coord; }
      }
    }

    if (best) {
      assignments[job.id] = best;
      plan[best.engId] = [...plan[best.engId], { start: best.start, end: best.start + dur, coord: loc }].sort((a, b) => a.start - b.start);
      assigned++;
    } else unplaceable++;
  }

  const jobs = d.jobs.map((j) =>
    assignments[j.id]
      ? { ...j, engineerId: assignments[j.id].engId, time: minToTime(assignments[j.id].start), date: day, status: "Assigned" }
      : j);
  return { jobs, assigned, unplaceable };
}

/* ------------------------------- seed --------------------------------- */
function seed() {
  return { engineers: [], customers: [], jobs: [], certs: [] };
}

/* --------------------------- color helpers ---------------------------- */
const priorityClass = (p) =>
  ({ Emergency: "bg-rose-100 text-rose-700 border-rose-200",
     High: "bg-amber-100 text-amber-800 border-amber-200",
     Routine: "bg-slate-100 text-slate-600 border-slate-200" }[p]);
const statusClass = (s) =>
  ({ Unassigned: "bg-slate-100 text-slate-600",
     Assigned: "bg-blue-100 text-blue-700",
     "En route": "bg-indigo-100 text-indigo-700",
     "In progress": "bg-amber-100 text-amber-800",
     Completed: "bg-emerald-100 text-emerald-700" }[s]);
const engStatusClass = (s) =>
  ({ Available: "bg-emerald-100 text-emerald-700",
     "On job": "bg-amber-100 text-amber-800",
     "Off shift": "bg-slate-100 text-slate-500" }[s]);
const certClass = (s) =>
  ({ Valid: "bg-emerald-100 text-emerald-700 border-emerald-200",
     Expiring: "bg-amber-100 text-amber-800 border-amber-200",
     Expired: "bg-rose-100 text-rose-700 border-rose-200" }[s]);
const blockClass = (s) =>
  ({ Assigned: "bg-blue-50 border-blue-400 text-blue-900",
     "En route": "bg-indigo-50 border-indigo-400 text-indigo-900",
     "In progress": "bg-amber-50 border-amber-400 text-amber-900",
     Completed: "bg-emerald-50 border-emerald-400 text-emerald-900" }[s] || "bg-slate-50 border-slate-400 text-slate-700");

/* ------------------------- CRM <-> dispatch bridge -------------------- */
// Shared key both apps read/write (works when run together locally; the two
// apps share the same browser localStorage). Sandboxed previews run isolated.
const BRIDGE_KEY = "gas-bridge-workorders-v2";
const sysStatus = (s) => ({
  Unassigned: "Open - Unscheduled",
  Assigned: "Open - Scheduled",
  "En route": "Open - Scheduled",
  "In progress": "Open - In Progress",
  Completed: "Closed - Completed",
  Cancelled: "Canceled",
}[s] || "Open - Unscheduled");
const sysStatusClass = (s) => {
  const v = sysStatus(s);
  if (v === "Open - Unscheduled") return "bg-amber-100 text-amber-800";
  if (v === "Open - Scheduled") return "bg-blue-100 text-blue-700";
  if (v === "Open - In Progress") return "bg-indigo-100 text-indigo-700";
  if (v === "Canceled") return "bg-slate-200 text-slate-500";
  return "bg-emerald-100 text-emerald-700";
};

/* ----------------------------- small UI ------------------------------- */
function Badge({ className, children }) {
  return <span className={"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium " + className}>{children}</span>;
}
function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
const inputCls = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500";

function Modal({ title, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 overflow-y-auto">
      <div className="mt-10 w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------- App ---------------------------------- */
export default function App({ currentUser }) {
  const userName = currentUser || "You";
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState(seed());
  const [loaded, setLoaded] = useState(false);
  const [modal, setModal] = useState(null);
  const [draft, setDraft] = useState({});
  const [jobSearch, setJobSearch] = useState("");
  const [jobDateFilter, setJobDateFilter] = useState("all");
  const [certFilter, setCertFilter] = useState("All");
  const [scheduleDate, setScheduleDate] = useState(relDate(0));
  const [bookingId, setBookingId] = useState(null);
  const [autoOn, setAutoOn] = useState(false);
  const [lastRun, setLastRun] = useState(null);
  const [accountId, setAccountId] = useState(null);
  const [accSearch, setAccSearch] = useState("");
  const [woSearch, setWoSearch] = useState("");
  const [engSearch, setEngSearch] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [woRecordId, setWoRecordId] = useState(null);
  const [woTab, setWoTab] = useState("general");
  const [toast, setToast] = useState("");
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 3200); };

  const { engineers, customers, jobs, certs } = data;
  const STORE_KEY = "flueline-dispatch-v2";

  // load
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (typeof window !== "undefined" && window.storage) {
          const res = await window.storage.get(STORE_KEY);
          if (active && res && res.value) setData(JSON.parse(res.value));
        }
      } catch (e) { /* no saved data yet */ }
      if (active) setLoaded(true);
    })();
    return () => { active = false; };
  }, []);

  // save
  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        if (typeof window !== "undefined" && window.storage) {
          await window.storage.set(STORE_KEY, JSON.stringify(data));
        }
      } catch (e) { /* storage unavailable in this preview */ }
    })();
  }, [data, loaded]);

  // keep latest data/day available to the interval callback
  const dataRef = useRef(data);
  const dayRef = useRef(scheduleDate);
  useEffect(() => { dataRef.current = data; });
  useEffect(() => { dayRef.current = scheduleDate; });

  const runAuto = () => {
    const res = planSchedule(dataRef.current, dayRef.current);
    setData((prev) => ({ ...prev, jobs: res.jobs }));
    setLastRun({ at: new Date(), assigned: res.assigned, unplaceable: res.unplaceable });
  };

  // run on enable, then every 5 minutes while enabled
  useEffect(() => {
    if (!autoOn) return;
    runAuto();
    const id = setInterval(runAuto, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [autoOn]);

  /* lookups */
  const custName = (id) => customers.find((c) => c.id === id)?.name || "—";
  const cust = (id) => customers.find((c) => c.id === id);
  const eng = (id) => engineers.find((e) => e.id === id);

  /* mutations */
  const update = (patch) => setData((d) => ({ ...d, ...patch }));

  const assignEngineer = (jobId, engId) =>
    setData((d) => ({
      ...d,
      jobs: d.jobs.map((j) =>
        j.id === jobId ? { ...j, engineerId: engId || null, status: engId && j.status === "Unassigned" ? "Assigned" : (!engId ? "Unassigned" : j.status) } : j),
    }));

  const advanceStatus = (jobId) =>
    setData((d) => ({
      ...d,
      jobs: d.jobs.map((j) => {
        if (j.id !== jobId) return j;
        const i = JOB_STATUSES.indexOf(j.status);
        return i < JOB_STATUSES.length - 1 ? { ...j, status: JOB_STATUSES[i + 1] } : j;
      }),
    }));

  const toggleAvailability = (engId) =>
    setData((d) => ({
      ...d,
      engineers: d.engineers.map((e) =>
        e.id === engId ? { ...e, status: e.status === "Available" ? "Off shift" : "Available" } : e),
    }));

  const renewCert = (certId) =>
    setData((d) => ({
      ...d,
      certs: d.certs.map((c) => (c.id === certId ? { ...c, issued: new Date().toISOString().slice(0, 10) } : c)),
    }));

  const scheduleJob = (jobId, engId, time) =>
    setData((d) => ({
      ...d,
      jobs: d.jobs.map((j) =>
        j.id === jobId
          ? { ...j, engineerId: engId, time, date: scheduleDate, status: (j.status === "Unassigned" || j.status === "Completed") ? "Assigned" : j.status }
          : j),
    }));

  const unscheduleJob = (jobId) =>
    setData((d) => ({
      ...d,
      jobs: d.jobs.map((j) => (j.id === jobId ? { ...j, engineerId: null, status: "Unassigned" } : j)),
    }));

  const cancelJob = (jobId) =>
    setData((d) => ({
      ...d,
      jobs: d.jobs.map((j) => (j.id === jobId ? { ...j, status: "Cancelled" } : j)),
    }));

  const addComment = (jobId, text) => {
    const t = text.trim();
    if (!t) return;
    setData((d) => ({
      ...d,
      jobs: d.jobs.map((j) =>
        j.id === jobId ? { ...j, comments: [...(j.comments || []), { author: userName, text: t, at: new Date().toISOString() }] } : j),
    }));
    setCommentDraft("");
  };

  const changeDuration = (jobId, delta) =>
    setData((d) => ({
      ...d,
      jobs: d.jobs.map((j) => (j.id === jobId ? { ...j, durationMin: Math.max(15, jobDuration(j) + delta) } : j)),
    }));

  const addContact = (custId, contact) =>
    setData((d) => ({
      ...d,
      customers: d.customers.map((c) => (c.id === custId ? { ...c, contacts: [...(c.contacts || []), contact] } : c)),
    }));

  const raiseBooking = (custId) => {
    setDraft({ customerId: custId, type: "Repair", skill: "Boilers", priority: "Routine", date: relDate(0), time: "09:00", durationMin: 60, notes: "", _lockCustomer: true });
    setModal("job");
  };

  /* ---- bridge: import bookings from the CRM into Unscheduled work ---- */
  const importFromCRM = async () => {
    try {
      if (typeof window === "undefined" || !window.storage) return 0;
      const r = await window.storage.get(BRIDGE_KEY).catch(() => null);
      if (!r || !r.value) return 0;
      const bridge = JSON.parse(r.value);
      let added = 0;
      setData((d) => {
        const custs = [...d.customers];
        const have = new Set(d.jobs.map((j) => j.wo).filter(Boolean));
        const cancelled = new Set(bridge.filter((b) => b.crmStatus === "Cancelled").map((b) => b.wo));
        const newJobs = [];
        bridge.forEach((b) => {
          if (!b.wo || have.has(b.wo) || b.dispatchStatus) return;
          if (!["New", "Unscheduled"].includes(b.crmStatus)) return;
          let c = custs.find((x) => x.name === b.account);
          if (!c) {
            c = { id: uid("CUS"), name: b.account || "CRM customer", type: b.accountType?.startsWith("Land") ? "Landlord" : b.accountType?.startsWith("Comm") ? "Commercial" : "Domestic", address: b.address || "—", postcode: b.postcode || "", phone: b.phone || "", contacts: [] };
            custs.push(c);
          }
          newJobs.push({
            id: uid("JOB"), wo: b.wo, customerId: c.id,
            type: b.type === "Service" ? "Service" : "Repair",
            skill: b.skill || "Boilers", priority: b.priority || "Routine",
            date: b.requestedDate || relDate(0), time: b.requestedTime || "09:00",
            durationMin: b.durationMin || 60, engineerId: null, status: "Unassigned",
            notes: b.description || "", source: "CRM",
          });
          have.add(b.wo);
        });
        // reflect CRM cancellations onto existing jobs
        const reconciled = d.jobs.map((j) => (j.wo && cancelled.has(j.wo) && j.status !== "Cancelled" ? { ...j, status: "Cancelled" } : j));
        added = newJobs.length;
        const changed = added > 0 || reconciled.some((j, i) => j !== d.jobs[i]);
        if (!changed) return d;
        return { ...d, customers: custs, jobs: [...newJobs, ...reconciled] };
      });
      return added;
    } catch (e) { return 0; }
  };
  const syncFromCRM = async () => { const n = await importFromCRM(); flash(n ? `Imported ${n} booking${n === 1 ? "" : "s"} from the CRM.` : "No new CRM bookings to import."); };

  // pull CRM bookings once data has loaded
  useEffect(() => { if (loaded) importFromCRM(); }, [loaded]);

  // close any open work-order record when leaving the Work Orders tab
  useEffect(() => { if (tab !== "workorders") setWoRecordId(null); }, [tab]);

  // write scheduling status back to the bridge so the CRM reflects it
  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        if (!window.storage) return;
        const r = await window.storage.get(BRIDGE_KEY).catch(() => null);
        if (!r || !r.value) return;
        const bridge = JSON.parse(r.value);
        const byWo = Object.fromEntries(bridge.map((b) => [b.wo, b]));
        let changed = false;
        jobs.forEach((j) => {
          const b = j.wo && byWo[j.wo];
          if (!b) return;
          const sched = j.engineerId ? { engineer: eng(j.engineerId)?.name, date: j.date, time: j.time } : null;
          if (b.dispatchStatus !== j.status || JSON.stringify(b.scheduledFor || null) !== JSON.stringify(sched)) {
            b.dispatchStatus = j.status; b.scheduledFor = sched; changed = true;
          }
        });
        if (changed) await window.storage.set(BRIDGE_KEY, JSON.stringify(Object.values(byWo)));
      } catch (e) {}
    })();
  }, [jobs, loaded]);


  /* ----------------------------- forms ----------------------------- */
  const openModal = (type) => {
    const defaults = {
      job: { customerId: customers[0]?.id || "", type: "Repair", skill: "Boilers", priority: "Routine", date: relDate(0), time: "09:00", durationMin: 60, notes: "" },
      engineer: { name: "", gasSafe: "", phone: "", area: "North London", status: "Available", skills: [] },
      customer: { name: "", type: "Domestic", address: "", postcode: "", phone: "" },
      cert: { customerId: customers[0]?.id || "", engineerId: engineers[0]?.id || "", type: CERT_TYPES[0], issued: relDate(0), appliances: 1 },
      contact: { name: "", role: "", phone: "", email: "" },
    };
    setDraft(defaults[type]);
    setModal(type);
  };
  const setF = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const saveJob = () => {
    const { _lockCustomer, ...rest } = draft;
    update({ jobs: [{ ...rest, id: "JOB-" + Math.floor(3051 + Math.random() * 900), wo: woNumber(), engineerId: null, status: "Unassigned" }, ...jobs] });
    setModal(null);
    flash("Job raised — added to Unscheduled work on the schedule board.");
  };
  const saveEngineer = () => {
    update({ engineers: [...engineers, { ...draft, id: uid("ENG") }] });
    setModal(null);
  };
  const saveCustomer = () => {
    const c = { ...draft, id: uid("CUS"), contacts: [{ name: draft.name, role: draft.type === "Domestic" ? "Homeowner" : "Primary contact", phone: draft.phone, email: "" }] };
    update({ customers: [...customers, c] });
    setModal(null);
    flash("Account created.");
  };
  const saveContact = () => {
    addContact(accountId, { name: draft.name, role: draft.role, phone: draft.phone, email: draft.email });
    setModal(null);
  };
  const saveCert = () => {
    update({ certs: [{ ...draft, appliances: Number(draft.appliances) || 1, id: "CP-" + Math.floor(7718 + Math.random() * 900) }, ...certs] });
    setModal(null);
  };

  /* --------------------------- derived ---------------------------- */
  const todaysJobs = jobs.filter((j) => isToday(j.date));
  const unassigned = jobs.filter((j) => j.status === "Unassigned");
  const available = engineers.filter((e) => e.status === "Available");
  const certsExpiring = certs.filter((c) => certStatus(addMonths(c.issued, 12)) === "Expiring");
  const certsExpired = certs.filter((c) => certStatus(addMonths(c.issued, 12)) === "Expired");

  /* =============================== VIEWS =============================== */
  function renderDashboard() {
    const stats = [
      { label: "Jobs today", value: todaysJobs.length, icon: ClipboardList, tone: "text-blue-600 bg-blue-50" },
      { label: "Unassigned", value: unassigned.length, icon: AlertTriangle, tone: "text-rose-600 bg-rose-50" },
      { label: "Engineers available", value: available.length, icon: Wrench, tone: "text-emerald-600 bg-emerald-50" },
      { label: "Certs expiring ≤30d", value: certsExpiring.length, icon: FileCheck2, tone: "text-amber-600 bg-amber-50" },
      { label: "Certs expired", value: certsExpired.length, icon: ShieldCheck, tone: "text-rose-600 bg-rose-50" },
    ];
    const schedule = [...todaysJobs].sort((a, b) => a.time.localeCompare(b.time));
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className={"mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md " + s.tone}>
                <s.icon size={18} />
              </div>
              <div className="text-2xl font-semibold text-slate-800">{s.value}</div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
              <Calendar size={16} className="text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-700">Today's schedule</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {schedule.length === 0 && <p className="px-4 py-6 text-sm text-slate-400">No jobs booked for today. Add one from the Dispatch board.</p>}
              {schedule.map((j) => (
                <div key={j.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-12 shrink-0 font-mono text-sm font-semibold text-slate-700">{j.time}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">{custName(j.customerId)} · {j.type}</div>
                    <div className="truncate text-xs text-slate-500">{cust(j.customerId)?.address}, {cust(j.customerId)?.postcode}</div>
                  </div>
                  <Badge className={priorityClass(j.priority)}>{j.priority}</Badge>
                  <Badge className={statusClass(j.status)}>{j.status}</Badge>
                  <div className="hidden w-32 shrink-0 truncate text-right text-xs text-slate-500 sm:block">
                    {j.engineerId ? eng(j.engineerId)?.name : <span className="text-rose-500">Unassigned</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
              <AlertTriangle size={16} className="text-amber-500" />
              <h3 className="text-sm font-semibold text-slate-700">Certificate alerts</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {[...certsExpired, ...certsExpiring].length === 0 && <p className="px-4 py-6 text-sm text-slate-400">All certificates are in date.</p>}
              {[...certsExpired, ...certsExpiring].map((c) => {
                const exp = addMonths(c.issued, 12);
                const st = certStatus(exp);
                const d = daysUntil(exp);
                return (
                  <div key={c.id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-800">{custName(c.customerId)}</span>
                      <Badge className={certClass(st)}>{st}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      <span className="font-mono">{c.id}</span> · {st === "Expired" ? `${Math.abs(d)} days overdue` : `due in ${d} days`} ({fmtDate(exp)})
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function JobCard({ j }) {
    const c = cust(j.customerId);
    const suited = engineers.filter((e) => e.skills.includes(j.skill));
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-xs font-semibold text-slate-500">{j.id}</span>
          <Badge className={priorityClass(j.priority)}>{j.priority}</Badge>
        </div>
        <div className="text-sm font-semibold text-slate-800">{c?.name}</div>
        <div className="mt-1 flex items-start gap-1 text-xs text-slate-500">
          <MapPin size={13} className="mt-0.5 shrink-0" /><span>{c?.address}, {c?.postcode}</span>
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1"><Clock size={13} />{j.time}</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{j.type} · {j.skill}</span>
        </div>
        {j.notes && <p className="mt-2 text-xs text-slate-500">{j.notes}</p>}

        <div className="mt-3 border-t border-slate-100 pt-2">
          <span className="mb-1 block text-xs font-medium text-slate-500">Engineer</span>
          <select
            value={j.engineerId || ""}
            onChange={(e) => assignEngineer(j.id, e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— Unassigned —</option>
            {engineers.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}{e.skills.includes(j.skill) ? " ✓" : ""}{e.status !== "Available" && e.id !== j.engineerId ? ` (${e.status})` : ""}
              </option>
            ))}
          </select>
          {suited.length > 0 && (
            <p className="mt-1 text-xs text-slate-400">✓ marks engineers skilled in {j.skill}</p>
          )}
        </div>

        {j.status !== "Completed" && (
          <button
            onClick={() => advanceStatus(j.id)}
            className="mt-2 flex w-full items-center justify-center gap-1 rounded-md bg-slate-800 px-2 py-1.5 text-xs font-medium text-white hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Advance to {JOB_STATUSES[JOB_STATUSES.indexOf(j.status) + 1]} <ArrowRight size={13} />
          </button>
        )}
      </div>
    );
  }

  function renderDispatch() {
    let filtered = jobs;
    if (jobDateFilter === "today") filtered = filtered.filter((j) => isToday(j.date));
    if (jobSearch.trim()) {
      const q = jobSearch.toLowerCase();
      filtered = filtered.filter((j) =>
        custName(j.customerId).toLowerCase().includes(q) ||
        j.id.toLowerCase().includes(q) ||
        (cust(j.customerId)?.postcode || "").toLowerCase().includes(q));
    }
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" />
            <input
              value={jobSearch}
              onChange={(e) => setJobSearch(e.target.value)}
              placeholder="Search customer, job ref or postcode"
              className="w-full rounded-md border border-slate-300 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select value={jobDateFilter} onChange={(e) => setJobDateFilter(e.target.value)} className={inputCls + " w-auto"}>
            <option value="all">All dates</option>
            <option value="today">Today only</option>
          </select>
          <button onClick={() => openModal("job")} className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <Plus size={16} /> New job
          </button>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-2">
          {JOB_STATUSES.map((status) => {
            const col = filtered.filter((j) => j.status === status);
            return (
              <div key={status} className="w-72 shrink-0">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-sm font-semibold text-slate-700">{status}</span>
                  <span className="rounded-full bg-slate-200 px-2 text-xs text-slate-600">{col.length}</span>
                </div>
                <div className="space-y-2 rounded-lg bg-slate-100 p-2">
                  {col.map((j) => <JobCard key={j.id} j={j} />)}
                  {col.length === 0 && <p className="px-1 py-3 text-center text-xs text-slate-400">Nothing here</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderSchedule() {
    const shiftDay = (n) => setScheduleDate(new Date(Date.parse(scheduleDate) + n * DAY).toISOString().slice(0, 10));
    const unscheduled = jobs.filter((j) => j.status === "Unassigned");

    const onDropRow = (engId) => (ev) => {
      ev.preventDefault();
      const id = ev.dataTransfer.getData("text/plain");
      if (!id) return;
      const rect = ev.currentTarget.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      let min = snap15((x / PX_HR) * 60 + WIN_START * 60);
      min = Math.max(WIN_START * 60, Math.min(WIN_END * 60 - 15, min));
      scheduleJob(id, engId, minToTime(min));
    };

    return (
      <div className="space-y-4">
        {/* toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button onClick={() => shiftDay(-1)} className="rounded-md border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"><ChevronLeft size={16} /></button>
            <button onClick={() => setScheduleDate(relDate(0))} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500">Today</button>
            <button onClick={() => shiftDay(1)} className="rounded-md border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"><ChevronRight size={16} /></button>
            <span className="ml-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <CalendarRange size={16} className="text-slate-400" />
              {new Date(scheduleDate).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            {["Assigned", "En route", "In progress", "Completed"].map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={"inline-block h-3 w-3 rounded-sm border " + blockClass(s)} />{s}
              </span>
            ))}
          </div>
        </div>

        {/* auto-scheduler */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAutoOn((v) => !v)}
              role="switch"
              aria-checked={autoOn}
              aria-label="Toggle auto-scheduler"
              className={"relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 " + (autoOn ? "bg-blue-600" : "bg-slate-300")}
            >
              <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all " + (autoOn ? "left-5" : "left-0.5")} />
            </button>
            <div>
              <div className="text-sm font-medium text-slate-800">Auto-scheduler {autoOn && <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">running</span>}</div>
              <div className="text-xs text-slate-500">Books unscheduled work every 5 minutes around travel time and existing jobs.</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastRun && (
              <span className="text-xs text-slate-500">
                Last run {lastRun.at.toLocaleTimeString("en-GB")} · <span className="font-medium text-emerald-600">{lastRun.assigned} booked</span>
                {lastRun.unplaceable > 0 && <span className="font-medium text-rose-500"> · {lastRun.unplaceable} couldn't be placed</span>}
              </span>
            )}
            <button onClick={runAuto} className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <RotateCw size={15} /> Run now
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {/* board */}
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <div style={{ width: RESOURCE_W + TRACK_W }}>
              {/* time header */}
              <div className="flex border-b border-slate-200 bg-slate-50">
                <div style={{ width: RESOURCE_W }} className="shrink-0 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Engineer</div>
                <div className="relative" style={{ width: TRACK_W, height: 30 }}>
                  {HOURS.map((h) => (
                    <div key={h} className="absolute top-0 h-full border-l border-slate-200 pl-1 text-xs text-slate-400" style={{ left: (h - WIN_START) * PX_HR }}>
                      {String(h).padStart(2, "0")}:00
                    </div>
                  ))}
                </div>
              </div>
              {/* engineer rows */}
              {engineers.map((r) => {
                const bookings = jobs.filter((j) => j.engineerId === r.id && j.date === scheduleDate && j.status !== "Cancelled");
                const off = r.status === "Off shift";
                return (
                  <div key={r.id} className="flex border-b border-slate-100 last:border-0">
                    <div style={{ width: RESOURCE_W }} className={"shrink-0 px-3 py-2 " + (off ? "opacity-50" : "")}>
                      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                        <CircleDot size={11} className={r.status === "Available" ? "text-emerald-500" : r.status === "On job" ? "text-amber-500" : "text-slate-300"} />
                        {r.name}
                      </div>
                      <div className="truncate text-xs text-slate-400">{r.area} · {bookings.length} job{bookings.length === 1 ? "" : "s"}</div>
                    </div>
                    <div
                      className={"relative border-l border-slate-200 " + (off ? "bg-slate-50" : "")}
                      style={{ width: TRACK_W, height: ROW_H }}
                      onDragOver={(ev) => ev.preventDefault()}
                      onDrop={onDropRow(r.id)}
                    >
                      {HOURS.slice(1).map((h) => (
                        <div key={h} className="absolute top-0 h-full border-l border-slate-100" style={{ left: (h - WIN_START) * PX_HR }} />
                      ))}
                      {bookings.map((j) => {
                        const start = timeToMin(j.time);
                        const dur = jobDuration(j);
                        const left = Math.max(0, ((start - WIN_START * 60) / 60) * PX_HR);
                        const width = Math.max(34, (dur / 60) * PX_HR - 2);
                        return (
                          <button
                            key={j.id}
                            draggable
                            onDragStart={(ev) => ev.dataTransfer.setData("text/plain", j.id)}
                            onClick={() => setBookingId(j.id)}
                            className={"absolute top-1 overflow-hidden rounded-md border-l-4 px-2 py-1 text-left shadow-sm hover:shadow focus:outline-none focus:ring-2 focus:ring-blue-500 " + blockClass(j.status)}
                            style={{ left, width, height: ROW_H - 8 }}
                          >
                            <div className="truncate text-xs font-semibold">{custName(j.customerId)}</div>
                            <div className="truncate text-xs opacity-80">{j.time} · {j.type} ({dur}m)</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* unscheduled drawer (below the board, like D365) */}
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-700">Unscheduled work</h3>
                <span className="rounded-full bg-rose-100 px-2 text-xs text-rose-700">{unscheduled.length}</span>
              </div>
              <span className="text-xs text-slate-400">Drag a job onto an engineer's row to book it.</span>
            </div>
            <div className="flex gap-2 overflow-x-auto p-3">
              {unscheduled.length === 0 && <p className="w-full py-4 text-center text-xs text-slate-400">Everything is scheduled.</p>}
              {unscheduled.map((j) => (
                <div
                  key={j.id}
                  draggable
                  onDragStart={(ev) => ev.dataTransfer.setData("text/plain", j.id)}
                  className="w-60 shrink-0 cursor-grab rounded-md border border-slate-200 bg-slate-50 p-2 active:cursor-grabbing"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex min-w-0 items-center gap-1 text-xs font-medium text-slate-700"><GripVertical size={12} className="shrink-0 text-slate-300" /><span className="truncate">{custName(j.customerId)}</span></span>
                    <Badge className={priorityClass(j.priority)}>{j.priority}</Badge>
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-slate-400">WO {j.wo || "—"}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{j.type} · {j.skill} · {jobDuration(j)}m</div>
                  <div className="truncate text-xs text-slate-400">{cust(j.customerId)?.postcode} · req. {fmtDate(j.date)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderBookingModal() {
    if (!bookingId) return null;
    const j = jobs.find((x) => x.id === bookingId);
    if (!j) return null;
    const i = JOB_STATUSES.indexOf(j.status);
    return (
      <Modal
        title={`WO ${j.wo || j.id} · ${custName(j.customerId)}`}
        onClose={() => { setBookingId(null); setCommentDraft(""); }}
        footer={
          <>
            <button onClick={() => { unscheduleJob(j.id); setBookingId(null); setCommentDraft(""); }} className="rounded-md border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-400">Unschedule</button>
            <button onClick={() => { setBookingId(null); setCommentDraft(""); }} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">Done</button>
          </>
        }
      >
        <div className="space-y-1 text-sm text-slate-600">
          <div className="flex items-center gap-2"><MapPin size={14} className="text-slate-400" />{cust(j.customerId)?.address}, {cust(j.customerId)?.postcode}</div>
          <div className="flex items-center gap-2"><Wrench size={14} className="text-slate-400" />{eng(j.engineerId)?.name || "Unassigned"} · {j.type} · {j.skill}</div>
          <div className="flex items-center gap-2"><Clock size={14} className="text-slate-400" />{j.time} on {fmtDate(j.date)}</div>
        </div>
        {j.notes && <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-500">{j.notes}</p>}

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-xs font-medium text-slate-500">Duration</span>
          <div className="flex items-center gap-2">
            <button onClick={() => changeDuration(j.id, -15)} className="rounded-md border border-slate-300 p-1 text-slate-500 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"><Minus size={14} /></button>
            <span className="w-16 text-center text-sm font-medium text-slate-700">{jobDuration(j)} min</span>
            <button onClick={() => changeDuration(j.id, 15)} className="rounded-md border border-slate-300 p-1 text-slate-500 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"><Plus size={14} /></button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">Status</span>
          <div className="flex items-center gap-2">
            <Badge className={statusClass(j.status)}>{j.status}</Badge>
            {i < JOB_STATUSES.length - 1 && (
              <button onClick={() => advanceStatus(j.id)} className="flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                {JOB_STATUSES[i + 1]} <ArrowRight size={12} />
              </button>
            )}
          </div>
        </div>

        {/* job notes */}
        <div className="border-t border-slate-100 pt-3">
          <span className="mb-2 block text-xs font-medium text-slate-500">Job notes</span>
          <div className="mb-2 max-h-44 space-y-2 overflow-y-auto">
            {(j.comments || []).length === 0 && <p className="text-xs text-slate-400">No notes yet.</p>}
            {(j.comments || []).map((c, idx) => (
              <div key={idx} className="rounded-md bg-slate-50 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">{c.author}</span>
                  <span className="text-xs text-slate-400">{fmtDateTime(c.at)}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">{c.text}</p>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-2">
            <textarea
              rows={2}
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              placeholder="Add a note…"
              className="flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => addComment(j.id, commentDraft)}
              disabled={!commentDraft.trim()}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              Add
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">Posting as {userName}</p>
        </div>
      </Modal>
    );
  }

  function renderWorkOrders() {
    const term = woSearch.trim().toLowerCase();
    const list = jobs.filter((j) =>
      !term || (j.wo || "").includes(term) || custName(j.customerId).toLowerCase().includes(term) ||
      (cust(j.customerId)?.postcode || "").toLowerCase().includes(term) || j.skill.toLowerCase().includes(term));
    const active = list.filter((j) => j.status !== "Completed");
    const rows = [...active, ...list.filter((j) => j.status === "Completed")];
    return (
      <div className="space-y-3">
        {/* command bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-t-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <button onClick={() => openModal("job")} className="flex items-center gap-1 rounded px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"><Plus size={15} /> New</button>
          <button onClick={syncFromCRM} className="flex items-center gap-1 rounded px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"><RotateCw size={15} /> Refresh from CRM</button>
          <div className="relative ml-auto">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" />
            <input value={woSearch} onChange={(e) => setWoSearch(e.target.value)} placeholder="Filter by keyword" className="rounded border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <Briefcase size={18} className="text-teal-600" />
              <h3 className="text-lg font-semibold text-slate-800">Active Work Orders</h3>
              <ChevronDown size={15} className="text-slate-400" />
            </div>
            <span className="text-xs text-slate-400">1-{rows.length} of {rows.length}</span>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-3 py-2"></th>
                <th className="px-3 py-2 font-medium">Work Order Number</th>
                <th className="px-3 py-2 font-medium">Customer Account</th>
                <th className="px-3 py-2 font-medium">Postal Code</th>
                <th className="px-3 py-2 font-medium">System Status</th>
                <th className="px-3 py-2 font-medium">Work Order Type</th>
                <th className="px-3 py-2 font-medium">Trade</th>
                <th className="px-3 py-2 font-medium">Priority</th>
                <th className="px-3 py-2 font-medium">Resource</th>
                <th className="px-3 py-2 font-medium">Time Promised</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((j) => (
                <tr key={j.id} className="hover:bg-blue-50">
                  <td className="px-3 py-2.5 text-slate-300"><Circle size={13} /></td>
                  <td className="px-3 py-2.5"><button onClick={() => { setWoRecordId(j.id); setWoTab("general"); setCommentDraft(""); }} className="font-mono text-blue-700 hover:underline focus:outline-none">{j.wo || j.id}</button></td>
                  <td className="px-3 py-2.5 text-slate-700">{custName(j.customerId)}</td>
                  <td className="px-3 py-2.5 text-slate-600">{cust(j.customerId)?.postcode || "—"}</td>
                  <td className="px-3 py-2.5"><Badge className={sysStatusClass(j.status)}>{sysStatus(j.status)}</Badge></td>
                  <td className="px-3 py-2.5 text-slate-600">Gas {j.type}</td>
                  <td className="px-3 py-2.5 text-slate-600">{j.skill}</td>
                  <td className="px-3 py-2.5"><Badge className={priorityClass(j.priority)}>{j.priority}</Badge></td>
                  <td className="px-3 py-2.5 text-slate-600">{j.engineerId ? eng(j.engineerId)?.name : <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2.5 text-slate-600">{fmtDate(j.date)} {j.time}</td>
                  <td className="px-3 py-2.5 text-right">
                    {!["Completed", "Cancelled"].includes(j.status) && (
                      <button onClick={() => { cancelJob(j.id); flash("Work order cancelled."); }} className="text-xs font-medium text-rose-600 hover:underline focus:outline-none">Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={11} className="px-4 py-6 text-center text-slate-400">No work orders.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400">Work orders raised in the CRM appear here as <span className="font-medium text-amber-700">Open - Unscheduled</span> and on the schedule board's Unscheduled work. Use Refresh from CRM to pull the latest.</p>
      </div>
    );
  }

  function renderWorkOrderRecord() {
    const j = jobs.find((x) => x.id === woRecordId);
    if (!j) return <button onClick={() => setWoRecordId(null)} className="text-sm font-medium text-blue-700">← Back to Work Orders</button>;
    const c = cust(j.customerId);
    const engr = eng(j.engineerId);
    const dur = jobDuration(j);
    const stages = ["Work Order", "Schedule Work Order", "Close Work Order"];
    const stageIdx = j.status === "Completed" ? 2 : j.status === "Unassigned" ? 0 : 1;
    const closed = ["Completed", "Cancelled"].includes(j.status);
    const F = (label, value) => (
      <div className="border-b border-slate-100 py-1.5">
        <div className="text-xs text-slate-400">{label}</div>
        <div className="text-sm text-slate-700">{value || "—"}</div>
      </div>
    );
    const tabBtn = (id, label) => (
      <button key={id} onClick={() => setWoTab(id)} className={"whitespace-nowrap px-3 py-2.5 text-sm font-medium focus:outline-none " + (woTab === id ? "border-b-2 border-blue-600 text-blue-700" : "text-slate-500 hover:text-slate-700")}>{label}</button>
    );
    return (
      <div className="space-y-3">
        {/* command bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-t-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <button onClick={() => setWoRecordId(null)} className="flex items-center gap-1 rounded px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"><ArrowLeft size={15} /> Work Orders</button>
          {!closed && <button onClick={() => advanceStatus(j.id)} className="flex items-center gap-1 rounded px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"><ArrowRight size={15} /> Advance status</button>}
          {!closed && <button onClick={() => { cancelJob(j.id); flash("Work order cancelled."); }} className="flex items-center gap-1 rounded px-2.5 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50"><X size={15} /> Cancel</button>}
        </div>

        {/* header */}
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <Briefcase size={22} className="text-teal-600" />
              <div>
                <div className="font-mono text-lg font-semibold text-slate-800">{j.wo || j.id}</div>
                <div className="text-xs text-slate-500">Work Order · {custName(j.customerId)}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-5 text-left">
              <div><div className="text-xs text-slate-400">System Status</div><Badge className={sysStatusClass(j.status)}>{sysStatus(j.status)}</Badge></div>
              <div><div className="text-xs text-slate-400">Engineer</div><div className="text-sm font-medium text-slate-700">{engr?.name || "—"}</div></div>
              <div><div className="text-xs text-slate-400">Promised</div><div className="text-sm font-medium text-slate-700">{fmtDate(j.date)} {j.time}</div></div>
            </div>
          </div>
          {/* stage path */}
          <div className="mt-4 flex items-center gap-2 overflow-x-auto">
            {stages.map((s, idx) => (
              <div key={s} className="flex shrink-0 items-center gap-2">
                <span className={"flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium " + (idx === stageIdx ? "bg-blue-600 text-white" : idx < stageIdx ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500")}>
                  {idx < stageIdx ? <CheckCircle2 size={12} /> : <CircleDot size={12} />}{s}
                </span>
                {idx < stages.length - 1 && <ChevronRight size={14} className="text-slate-300" />}
              </div>
            ))}
            {j.status === "Cancelled" && <Badge className="bg-slate-200 text-slate-500">Canceled</Badge>}
          </div>
        </div>

        {/* tabs */}
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2">
            {tabBtn("general", "General")}
            {tabBtn("status", "Status Details")}
            {tabBtn("notes", "Job Comments")}
            {tabBtn("location", "Location")}
          </div>

          {woTab === "general" && (
            <div className="grid grid-cols-1 gap-6 p-4 lg:grid-cols-3">
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Key details</h4>
                {F("Work Order Number", j.wo || j.id)}
                {F("Customer Account", custName(j.customerId))}
                {F("Work Order Type", `Gas ${j.type}`)}
                {F("Trade", j.skill)}
                {F("Priority", j.priority)}
                {F("Engineer", engr?.name)}
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Customer details</h4>
                {F("Name", c?.name)}
                {F("Address", c?.address)}
                {F("Postcode", c?.postcode)}
                {F("Phone", c?.phone)}
                {F("Type", c?.type)}
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Appointment slot</h4>
                {F("Date", fmtDate(j.date))}
                {F("Time", j.time)}
                {F("Duration", dur + " min")}
                {F("Description", j.notes)}
              </div>
            </div>
          )}

          {woTab === "status" && (
            <div className="grid grid-cols-1 gap-6 p-4 lg:grid-cols-2">
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Status</h4>
                {F("System Status", sysStatus(j.status))}
                {F("Internal Status", j.status)}
                {F("Source", j.source === "CRM" ? "CRM booking" : "Created in dispatch")}
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Scheduling</h4>
                {F("Engineer", engr?.name)}
                {F("Territory", engr?.area)}
                {F("Scheduled date", fmtDate(j.date))}
                {F("Scheduled time", j.time)}
              </div>
            </div>
          )}

          {woTab === "notes" && (
            <div className="p-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Job comments</h4>
              <div className="flex items-start gap-2">
                <textarea rows={2} value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder="Enter a note…" className="flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button onClick={() => addComment(j.id, commentDraft)} disabled={!commentDraft.trim()} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50">Add note</button>
              </div>
              <p className="mt-1 mb-4 text-xs text-slate-400">Posting as {userName}</p>
              <div className="space-y-2">
                {(j.comments || []).length === 0 && <p className="text-sm text-slate-400">No notes yet. Add the first one above.</p>}
                {[...(j.comments || [])].reverse().map((cm, idx) => (
                  <div key={idx} className="rounded-md border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-700">{cm.author}</span>
                      <span className="text-xs text-slate-400">{fmtDateTime(cm.at)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{cm.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {woTab === "location" && (
            <div className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Location</h4>
              <div className="max-w-md">
                {F("Address", c?.address)}
                {F("Postcode", c?.postcode)}
                {F("Scheduling territory", engr?.area || "—")}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderEngineers() {
    const term = engSearch.trim().toLowerCase();
    const rows = engineers.filter((e) =>
      !term || e.name.toLowerCase().includes(term) || (e.gasSafe || "").includes(term) ||
      (e.area || "").toLowerCase().includes(term) || e.skills.join(" ").toLowerCase().includes(term));
    return (
      <div className="space-y-3">
        {/* command bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-t-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <button onClick={() => openModal("engineer")} className="flex items-center gap-1 rounded px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"><Plus size={15} /> New</button>
          <button onClick={() => setEngSearch("")} className="flex items-center gap-1 rounded px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"><RotateCw size={15} /> Refresh</button>
          <div className="relative ml-auto">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" />
            <input value={engSearch} onChange={(e) => setEngSearch(e.target.value)} placeholder="Filter by keyword" className="rounded border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <Wrench size={18} className="text-blue-600" />
              <h3 className="text-lg font-semibold text-slate-800">Active Bookable Resources</h3>
              <ChevronDown size={15} className="text-slate-400" />
            </div>
            <span className="text-xs text-slate-400">Rows: {rows.length}</span>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-3 py-2"></th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">In Day Territory</th>
                <th className="px-3 py-2 font-medium">Gas Safe No.</th>
                <th className="px-3 py-2 font-medium">Mobile Phone</th>
                <th className="px-3 py-2 font-medium">Trades</th>
                <th className="px-3 py-2 font-medium">Primary Business Area</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Active Jobs</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((e) => {
                const activeJobs = jobs.filter((j) => j.engineerId === e.id && j.status !== "Completed").length;
                return (
                  <tr key={e.id} className="hover:bg-blue-50">
                    <td className="px-3 py-2.5 text-slate-300"><Circle size={13} /></td>
                    <td className="px-3 py-2.5 font-medium text-slate-800">{e.name}</td>
                    <td className="px-3 py-2.5 text-slate-600">{e.area}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{e.gasSafe}</td>
                    <td className="px-3 py-2.5 text-slate-600">{e.phone}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {e.skills.map((s) => <span key={s} className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">{s}</span>)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">Gas</td>
                    <td className="px-3 py-2.5"><Badge className={engStatusClass(e.status)}><CircleDot size={11} />{e.status}</Badge></td>
                    <td className="px-3 py-2.5 text-slate-600">{activeJobs}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={() => toggleAvailability(e.id)} className="text-xs font-medium text-blue-600 hover:underline focus:outline-none">
                        {e.status === "Available" ? "Set off shift" : "Set available"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={10} className="px-4 py-6 text-center text-slate-400">No engineers yet. Use New to add one.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderAccounts() {
    if (accountId) return renderAccountDetail();
    const q = accSearch.trim().toLowerCase();
    const list = customers.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.postcode || "").toLowerCase().includes(q));
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" />
            <input value={accSearch} onChange={(e) => setAccSearch(e.target.value)} placeholder="Search accounts by name or postcode" className="w-full rounded-md border border-slate-300 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={() => openModal("customer")} className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <Plus size={16} /> New account
          </button>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Primary contact</th>
                <th className="px-4 py-2 font-medium">Postcode</th>
                <th className="px-4 py-2 font-medium">Open jobs</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((c) => {
                const openJobs = jobs.filter((j) => j.customerId === c.id && j.status !== "Completed").length;
                return (
                  <tr key={c.id} onClick={() => setAccountId(c.id)} className="cursor-pointer hover:bg-blue-50">
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">{c.name}</div>
                      <div className="font-mono text-xs text-slate-400">{c.id}</div>
                    </td>
                    <td className="px-4 py-2"><Badge className="bg-slate-100 text-slate-600">{c.type}</Badge></td>
                    <td className="px-4 py-2 text-slate-600">{c.contacts?.[0]?.name || "—"}</td>
                    <td className="px-4 py-2 text-slate-600">{c.postcode}</td>
                    <td className="px-4 py-2 text-slate-600">{openJobs}</td>
                    <td className="px-4 py-2 text-right text-slate-300"><ChevronRight size={16} /></td>
                  </tr>
                );
              })}
              {list.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">No accounts match your search.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderAccountDetail() {
    const a = customers.find((c) => c.id === accountId);
    if (!a) return <button onClick={() => setAccountId(null)} className="text-sm font-medium text-blue-600 hover:underline">← Back to accounts</button>;
    const aJobs = jobs.filter((j) => j.customerId === a.id);
    const openJobs = aJobs.filter((j) => j.status !== "Completed");
    const history = aJobs.filter((j) => j.status === "Completed");
    const aCerts = certs.filter((c) => c.customerId === a.id).map((c) => ({ ...c, expiry: addMonths(c.issued, 12), st: certStatus(addMonths(c.issued, 12)) }));
    const stat = (label, value) => (
      <div className="text-center">
        <div className="text-xl font-semibold text-slate-800">{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    );
    return (
      <div className="space-y-4">
        <button onClick={() => setAccountId(null)} className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 focus:outline-none">
          <ArrowLeft size={15} /> All accounts
        </button>

        {/* highlights */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Building2 size={22} /></div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-800">{a.name}</h2>
                  <Badge className="bg-slate-100 text-slate-600">{a.type}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><MapPin size={12} />{a.address}, {a.postcode}</span>
                  <span className="flex items-center gap-1"><Phone size={12} />{a.phone}</span>
                  <span className="font-mono text-slate-400">{a.id}</span>
                </div>
              </div>
            </div>
            <button onClick={() => raiseBooking(a.id)} className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <Briefcase size={15} /> Raise job booking
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4 sm:grid-cols-4">
            {stat("Open jobs", openJobs.length)}
            {stat("Completed", history.length)}
            {stat("Valid certs", aCerts.filter((c) => c.st === "Valid").length)}
            {stat("Certs due/overdue", aCerts.filter((c) => c.st !== "Valid").length)}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* contacts */}
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-700">Contacts</h3>
              <button onClick={() => openModal("contact")} className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline focus:outline-none"><UserPlus size={13} /> Add</button>
            </div>
            <div className="divide-y divide-slate-100">
              {(a.contacts || []).map((ct, i) => (
                <div key={i} className="px-4 py-3">
                  <div className="text-sm font-medium text-slate-800">{ct.name}</div>
                  <div className="text-xs text-slate-500">{ct.role}</div>
                  <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                    {ct.phone && <div className="flex items-center gap-1"><Phone size={11} />{ct.phone}</div>}
                    {ct.email && <div className="flex items-center gap-1"><Mail size={11} />{ct.email}</div>}
                  </div>
                </div>
              ))}
              {(a.contacts || []).length === 0 && <p className="px-4 py-4 text-xs text-slate-400">No contacts yet.</p>}
            </div>
          </div>

          {/* open jobs */}
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-700">Open jobs</h3>
              <span className="rounded-full bg-slate-200 px-2 text-xs text-slate-600">{openJobs.length}</span>
            </div>
            <div className="divide-y divide-slate-100">
              {openJobs.map((j) => (
                <div key={j.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">{j.type} · {j.skill}</div>
                    <div className="font-mono text-xs text-slate-400">{j.id} · {fmtDate(j.date)} {j.time}</div>
                  </div>
                  <Badge className={statusClass(j.status)}>{j.status}</Badge>
                </div>
              ))}
              {openJobs.length === 0 && <p className="px-4 py-4 text-xs text-slate-400">No open jobs. Raise one above.</p>}
            </div>
          </div>

          {/* certificates */}
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-700">Certificates</h3>
              <span className="rounded-full bg-slate-200 px-2 text-xs text-slate-600">{aCerts.length}</span>
            </div>
            <div className="divide-y divide-slate-100">
              {aCerts.map((c) => (
                <div key={c.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">{c.type.split("—")[0].trim()}</div>
                    <div className="font-mono text-xs text-slate-400">{c.id} · exp {fmtDate(c.expiry)}</div>
                  </div>
                  <Badge className={certClass(c.st)}>{c.st}</Badge>
                </div>
              ))}
              {aCerts.length === 0 && <p className="px-4 py-4 text-xs text-slate-400">No certificates on file.</p>}
            </div>
          </div>
        </div>

        {/* job history */}
        {history.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3"><h3 className="text-sm font-semibold text-slate-700">Job history</h3></div>
            <div className="divide-y divide-slate-100">
              {history.map((j) => (
                <div key={j.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-700">{j.type} · {j.skill} — {eng(j.engineerId)?.name || "—"}</div>
                    <div className="font-mono text-xs text-slate-400">{j.id} · {fmtDate(j.date)}</div>
                  </div>
                  <Badge className={statusClass(j.status)}>{j.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderCerts() {
    let list = certs.map((c) => ({ ...c, expiry: addMonths(c.issued, 12) }));
    list = list.map((c) => ({ ...c, st: certStatus(c.expiry) }));
    if (certFilter !== "All") list = list.filter((c) => c.st === certFilter);
    list.sort((a, b) => a.expiry.localeCompare(b.expiry));
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1">
            {["All", "Expired", "Expiring", "Valid"].map((f) => (
              <button key={f} onClick={() => setCertFilter(f)}
                className={"rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 " +
                  (certFilter === f ? "bg-slate-800 text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50")}>
                {f}
              </button>
            ))}
          </div>
          <button onClick={() => openModal("cert")} className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <Plus size={16} /> Issue certificate
          </button>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Ref</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Engineer</th>
                <th className="px-4 py-2 font-medium">Issued</th>
                <th className="px-4 py-2 font-medium">Expires</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{c.id}</td>
                  <td className="px-4 py-2 font-medium text-slate-800">{custName(c.customerId)}</td>
                  <td className="px-4 py-2 text-xs text-slate-600">{c.type}</td>
                  <td className="px-4 py-2 text-slate-600">{eng(c.engineerId)?.name || "—"}</td>
                  <td className="px-4 py-2 text-slate-600">{fmtDate(c.issued)}</td>
                  <td className="px-4 py-2 text-slate-600">{fmtDate(c.expiry)}</td>
                  <td className="px-4 py-2"><Badge className={certClass(c.st)}>{c.st}</Badge></td>
                  <td className="px-4 py-2 text-right">
                    {c.st !== "Valid" && (
                      <button onClick={() => renewCert(c.id)} className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline focus:outline-none">
                        <RotateCw size={12} /> Renew
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-400">No certificates match this filter.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /* ----------------------------- modals ---------------------------- */
  function renderModal() {
    if (!modal) return null;
    const cancelBtn = <button onClick={() => setModal(null)} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500">Cancel</button>;
    const saveBtn = (fn, label) => <button onClick={fn} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">{label}</button>;

    if (modal === "job") return (
      <Modal title="New job" onClose={() => setModal(null)} footer={<>{cancelBtn}{saveBtn(saveJob, "Create job")}</>}>
        <Field label="Customer">
          {draft._lockCustomer ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">{custName(draft.customerId)}</div>
          ) : (
            <select className={inputCls} value={draft.customerId} onChange={(e) => setF("customerId", e.target.value)}>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.postcode}</option>)}
            </select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><select className={inputCls} value={draft.type} onChange={(e) => setF("type", e.target.value)}><option>Repair</option><option>Service</option></select></Field>
          <Field label="Priority"><select className={inputCls} value={draft.priority} onChange={(e) => setF("priority", e.target.value)}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></Field>
        </div>
        <Field label="Work type"><select className={inputCls} value={draft.skill} onChange={(e) => setF("skill", e.target.value)}>{SKILLS.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date"><input type="date" className={inputCls} value={draft.date} onChange={(e) => setF("date", e.target.value)} /></Field>
          <Field label="Time"><input type="time" className={inputCls} value={draft.time} onChange={(e) => setF("time", e.target.value)} /></Field>
          <Field label="Duration (min)"><input type="number" min="15" step="15" className={inputCls} value={draft.durationMin} onChange={(e) => setF("durationMin", Number(e.target.value) || 60)} /></Field>
        </div>
        <Field label="Notes"><textarea rows={2} className={inputCls} value={draft.notes} onChange={(e) => setF("notes", e.target.value)} placeholder="Fault description, access details…" /></Field>
      </Modal>
    );

    if (modal === "engineer") return (
      <Modal title="Add engineer" onClose={() => setModal(null)} footer={<>{cancelBtn}{saveBtn(saveEngineer, "Add engineer")}</>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input className={inputCls} value={draft.name} onChange={(e) => setF("name", e.target.value)} /></Field>
          <Field label="Gas Safe no."><input className={inputCls} value={draft.gasSafe} onChange={(e) => setF("gasSafe", e.target.value)} placeholder="7 digits" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><input className={inputCls} value={draft.phone} onChange={(e) => setF("phone", e.target.value)} /></Field>
          <Field label="Area"><input className={inputCls} value={draft.area} onChange={(e) => setF("area", e.target.value)} /></Field>
        </div>
        <Field label="Skills">
          <div className="flex flex-wrap gap-1.5">
            {SKILLS.map((s) => {
              const on = draft.skills?.includes(s);
              return (
                <button key={s} onClick={() => setF("skills", on ? draft.skills.filter((x) => x !== s) : [...(draft.skills || []), s])}
                  className={"rounded-full border px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 " +
                    (on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50")}>
                  {s}
                </button>
              );
            })}
          </div>
        </Field>
      </Modal>
    );

    if (modal === "customer") return (
      <Modal title="New account" onClose={() => setModal(null)} footer={<>{cancelBtn}{saveBtn(saveCustomer, "Create account")}</>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Account name"><input className={inputCls} value={draft.name} onChange={(e) => setF("name", e.target.value)} /></Field>
          <Field label="Type"><select className={inputCls} value={draft.type} onChange={(e) => setF("type", e.target.value)}>{CUSTOMER_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        </div>
        <Field label="Address"><input className={inputCls} value={draft.address} onChange={(e) => setF("address", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Postcode"><input className={inputCls} value={draft.postcode} onChange={(e) => setF("postcode", e.target.value)} /></Field>
          <Field label="Phone"><input className={inputCls} value={draft.phone} onChange={(e) => setF("phone", e.target.value)} /></Field>
        </div>
      </Modal>
    );

    if (modal === "contact") return (
      <Modal title="Add contact" onClose={() => setModal(null)} footer={<>{cancelBtn}{saveBtn(saveContact, "Add contact")}</>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input className={inputCls} value={draft.name} onChange={(e) => setF("name", e.target.value)} /></Field>
          <Field label="Role"><input className={inputCls} value={draft.role} onChange={(e) => setF("role", e.target.value)} placeholder="e.g. Property manager" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><input className={inputCls} value={draft.phone} onChange={(e) => setF("phone", e.target.value)} /></Field>
          <Field label="Email"><input className={inputCls} value={draft.email} onChange={(e) => setF("email", e.target.value)} /></Field>
        </div>
      </Modal>
    );

    if (modal === "cert") return (
      <Modal title="Issue certificate" onClose={() => setModal(null)} footer={<>{cancelBtn}{saveBtn(saveCert, "Issue")}</>}>
        <Field label="Customer"><select className={inputCls} value={draft.customerId} onChange={(e) => setF("customerId", e.target.value)}>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Certificate type"><select className={inputCls} value={draft.type} onChange={(e) => setF("type", e.target.value)}>{CERT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Issuing engineer"><select className={inputCls} value={draft.engineerId} onChange={(e) => setF("engineerId", e.target.value)}>{engineers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Issued"><input type="date" className={inputCls} value={draft.issued} onChange={(e) => setF("issued", e.target.value)} /></Field>
          <Field label="Appliances"><input type="number" min="1" className={inputCls} value={draft.appliances} onChange={(e) => setF("appliances", e.target.value)} /></Field>
        </div>
        <p className="text-xs text-slate-500">Expiry is set automatically to 12 months from the issue date ({fmtDate(addMonths(draft.issued || relDate(0), 12))}).</p>
      </Modal>
    );
    return null;
  }

  /* ------------------------------ shell ---------------------------- */
  const nav = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "dispatch", label: "Dispatch board", icon: ClipboardList },
    { id: "workorders", label: "Work Orders", icon: Briefcase },
    { id: "schedule", label: "Schedule board", icon: CalendarRange },
    { id: "engineers", label: "Engineers", icon: Wrench },
    { id: "accounts", label: "Accounts", icon: Building2 },
    { id: "certs", label: "Certificates", icon: FileCheck2 },
  ];
  const titles = { dashboard: "Dashboard", dispatch: "Dispatch board", workorders: "Work Orders", schedule: "Schedule board", engineers: "Engineers", accounts: "Accounts", certs: "Gas safety certificates" };

  return (
    <div className="flex min-h-screen bg-slate-100 font-sans text-slate-800">
      {/* sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col bg-slate-900 text-slate-300 md:flex">
        <div className="flex items-center gap-2 border-b border-slate-800 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600">
            <Flame size={18} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">Flueline</div>
            <div className="text-xs text-slate-400">Dispatch</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav.map((n) => (
            <button key={n.id} onClick={() => setTab(n.id)}
              className={"flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 " +
                (tab === n.id ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200")}>
              <n.icon size={17} /> {n.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-slate-800 px-5 py-3 text-xs text-slate-500">Gas repair &amp; servicing ops</div>
      </aside>

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">{titles[tab]}</h1>
            <p className="text-xs text-slate-500">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
          </div>
          {/* mobile nav */}
          <div className="flex gap-1 md:hidden">
            {nav.map((n) => (
              <button key={n.id} onClick={() => setTab(n.id)} aria-label={n.label}
                className={"rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-blue-500 " + (tab === n.id ? "bg-slate-800 text-white" : "text-slate-500")}>
                <n.icon size={18} />
              </button>
            ))}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-5">
          {tab === "dashboard" && renderDashboard()}
          {tab === "dispatch" && renderDispatch()}
          {tab === "workorders" && (woRecordId ? renderWorkOrderRecord() : renderWorkOrders())}
          {tab === "schedule" && renderSchedule()}
          {tab === "engineers" && renderEngineers()}
          {tab === "accounts" && renderAccounts()}
          {tab === "certs" && renderCerts()}
        </main>
      </div>

      {renderModal()}
      {renderBookingModal()}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg">
          <CheckCircle2 size={16} className="text-emerald-400" />{toast}
        </div>
      )}
    </div>
  );
}
