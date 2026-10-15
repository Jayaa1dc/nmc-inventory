"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";

const BR = ["Battaramulla", "Kiribathgoda", "Panadura", "Ja-Ela", "Kirillawala", "Kurunegala", "Peliyagoda"];
const TABS = [["dash", "Dashboard"], ["branch", "Center Stock"], ["rec", "Receive (GRN)"], ["iss", "Issue"], ["grn", "GRN Reports"], ["log", "Records"], ["items", "Items & Suppliers"], ["ro", "Reorder Levels"]];
const fmt = (n) => Number(n || 0).toLocaleString("en-LK", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const nextCode = (p, codes) => p + "-" + String(Math.max(0, ...codes.map((c) => parseInt(c.split("-")[1]) || 0)) + 1).padStart(3, "0");

const lastB = () => { try { return localStorage.getItem("nmc_branch") || BR[0]; } catch { return BR[0]; } };
const saveB = (b) => { try { localStorage.setItem("nmc_branch", b); } catch {} };

export default function Page() { return <App />; }

function App() {
  const [tab, setTab] = useState("dash"), [D, setD] = useState(null), [msg, setMsg] = useState(""), [view, setView] = useState("");
  const toast = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3500); };
  const load = useCallback(async () => {
    const t = (n, q = "*") => supabase.from(n).select(q);
    const [items, sups, prices, grns, issues, ro, stock] = await Promise.all([
      t("items").order("code"), t("suppliers").order("code"), t("supplier_prices"),
      t("grns", "*, grn_lines(*)").order("created_at", { ascending: false }), t("issues").order("created_at", { ascending: false }), t("reorder_levels"), t("stock_levels"),
    ]);
    setD({ items: items.data || [], sups: sups.data || [], prices: prices.data || [], grns: grns.data || [], issues: issues.data || [], ro: ro.data || [], stock: stock.data || [] });
  }, []);
  useEffect(() => {
    load();
    const ch = supabase.channel("rt").on("postgres_changes", { event: "*", schema: "public" }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);
  if (!D) return <p style={{ padding: 20 }}>Loading…</p>;
  const me = { role: "admin" };

  const stock = {}; D.stock.forEach((r) => (stock[r.branch + "|" + r.item_code] = r));
  const lowP = (c) => D.prices.filter((p) => p.item_code === c).sort((a, b) => a.price - b.price)[0];
  const supName = (c) => D.sups.find((s) => s.code === c)?.name || "Opening stock";
  const canB = BR;
  const alerts = D.stock.filter((r) => r.min_qty > 0 && r.qty <= r.min_qty);
  const P = { D, me, stock, lowP, supName, canB, toast, reload: load, alerts, go: (id) => { setView(id); setTab("grn"); load(); }, view, setView };
  const Tab = { dash: Dash, branch: Branch, rec: Receive, iss: Issue, grn: Grns, log: Log, items: Items, ro: Reorder }[tab];
  return (
    <>
      <header><h1>NMC Stationery Inventory</h1>
        <span style={{ marginLeft: "auto" }}>{alerts.length ? <b style={{ color: "var(--r)" }}>{alerts.length} reorder alert{alerts.length > 1 ? "s" : ""}</b> : <span className="mu">No alerts</span>}</span></header>
      <nav>{TABS.map(([k, l]) => <button key={k} className={k === tab ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</nav>
      <main><Tab {...P} /></main>
      {msg && <div id="toast">{msg}</div>}
    </>
  );
}

function Dash({ D, stock, lowP, supName, alerts }) {
  let val = 0; D.stock.forEach((r) => { const p = lowP(r.item_code); val += r.qty * (p ? p.price : 0); });
  return (
    <>
      <div className="cards"><div className="card"><b>{D.items.length}</b><span>Items</span></div><div className="card"><b>{alerts.length}</b><span>Reorder alerts</span></div>
        <div className="card"><b>{fmt(val)}</b><span>Stock value (LKR, cheapest supplier price)</span></div><div className="card"><b>{D.grns.length}</b><span>GRNs recorded</span></div></div>
      <div className="box sc"><h2>Needs reordering</h2>{alerts.length ? <table><thead><tr><th>Center</th><th>Item</th><th className="n">Stock</th><th className="n">Level</th><th>Cheapest supplier</th></tr></thead><tbody>
        {alerts.map((a) => { const p = lowP(a.item_code); return <tr key={a.branch + a.item_code}><td>{a.branch}</td><td>{a.item_code} {a.item_name}</td><td className="n low">{fmt(a.qty)}</td><td className="n">{fmt(a.min_qty)}</td><td>{p ? supName(p.supplier_code) + " @ " + fmt(p.price) : "—"}</td></tr>; })}</tbody></table> : <span className="mu">Nothing at or below reorder level.</span>}</div>
      <div className="box sc"><h2>All centers: current stock</h2><table><thead><tr><th>Code</th><th>Item</th>{BR.map((b) => <th key={b} className="n">{b}</th>)}<th className="n">Total</th></tr></thead><tbody>
        {D.items.map((it) => { let t = 0; return <tr key={it.code}><td>{it.code}</td><td>{it.name}</td>{BR.map((b) => { const r = stock[b + "|" + it.code] || { qty: 0, min_qty: 0 }; t += Number(r.qty); return <td key={b} className={"n " + (r.min_qty > 0 && r.qty <= r.min_qty ? "low" : "")}>{fmt(r.qty)}</td>; })}<td className="n"><b>{fmt(t)}</b></td></tr>; })}</tbody></table><div className="mu">Red = at or below reorder level.</div></div>
    </>
  );
}

function Branch({ D, stock, lowP, canB }) {
  const [b, setB] = useState(lastB());
  return (
    <>
      <div className="box"><label className="mu">Center <select value={b} onChange={(e) => { saveB(e.target.value); setB(e.target.value); }}>{BR.map((x) => <option key={x}>{x}</option>)}</select></label></div>
      <div className="box sc"><table><thead><tr><th>Code</th><th>Item</th><th>UoM</th><th className="n">Stock</th><th className="n">Reorder level</th><th>Status</th><th className="n">Value (LKR)</th></tr></thead><tbody>
        {D.items.map((it) => { const r = stock[b + "|" + it.code] || { qty: 0, min_qty: 0 }, s = r.min_qty > 0 ? (r.qty <= 0 ? "OUT" : r.qty <= r.min_qty ? "REORDER" : "OK") : "—", p = lowP(it.code);
          return <tr key={it.code}><td>{it.code}</td><td>{it.name}</td><td>{it.uom}</td><td className={"n " + (s === "OUT" || s === "REORDER" ? "low" : "")}>{fmt(r.qty)}</td><td className="n">{r.min_qty || "—"}</td><td className={s === "OK" ? "ok" : s === "—" ? "" : "low"}>{s}</td><td className="n">{p ? fmt(r.qty * p.price) : "—"}</td></tr>; })}</tbody></table></div>
    </>
  );
}

const ItemList = ({ items }) => <datalist id="il">{items.map((i) => <option key={i.code} value={`${i.code} | ${i.name}`} />)}</datalist>;
const findItem = (items, v) => { const c = (v || "").split(" | ")[0].trim().toUpperCase(); return items.find((i) => i.code === c) || items.find((i) => i.name.toLowerCase() === (v || "").trim().toLowerCase()); };

function Receive({ D, canB, toast, go }) {
  const blank = { branch: lastB(), sup: "", inv: "", grn: "", date: today(), by: "", file: null };
  const [f, setF] = useState(blank), [lines, setLines] = useState([{ item: "", qty: "", price: "" }]), [st, setSt] = useState(""), [busy, setBusy] = useState(false);
  const fi = (v) => findItem(D.items, v);
  const upd = (k, key, val) => setLines((ls) => ls.map((l, i) => (i === k ? { ...l, [key]: val } : l)));
  const onItem = (k, v) => setLines((ls) => ls.map((l, i) => {
    if (i !== k) return l; const it = fi(v); let price = l.price;
    if (it && !price) { const ps = D.prices.filter((p) => p.item_code === it.code && (!f.sup || p.supplier_code === f.sup)).sort((a, b) => a.price - b.price); if (ps[0]) price = ps[0].price; }
    return { ...l, item: v, price };
  }));
  async function read() {
    if (!f.file) return toast("Choose a file first");
    setSt("Reading the file…");
    const fd = new FormData(); fd.append("file", f.file);
    fd.append("items", JSON.stringify(D.items.map((i) => ({ code: i.code, name: i.name })))); fd.append("suppliers", JSON.stringify(D.sups.map((s) => ({ code: s.code, name: s.name })))); fd.append("branches", JSON.stringify(BR));
    try {
      const r = await fetch("/api/extract-grn", { method: "POST", body: fd }), j = await r.json();
      if (!r.ok) { setSt(""); return toast(j.error || "Could not read the file"); }
      setF((x) => ({ ...x, branch: canB.includes(j.center) ? j.center : x.branch, sup: D.sups.some((s) => s.code === j.supplier_code) ? j.supplier_code : x.sup, inv: j.invoice_no || x.inv, grn: j.grn_no || x.grn, by: j.received_by || x.by, date: /^\d{4}-\d{2}-\d{2}$/.test(j.date || "") ? j.date : x.date }));
      const ls = (j.lines || []).map((l) => { const it = D.items.find((i) => i.code === l.item_code); return { item: it ? it.code + " | " + it.name : l.text || "", qty: l.qty ?? "", price: l.unit_price || "" }; });
      setLines(ls.length ? ls : [{ item: "", qty: "", price: "" }]);
      const un = ls.filter((l) => !fi(l.item)).length;
      setSt(`Read ${ls.length} line(s).` + (un ? ` ${un} item(s) not matched (red): pick the correct item.` : "") + " Check everything, then press Save.");
    } catch (e) { setSt(""); toast("Could not read the file: " + e.message); }
  }
  async function save() {
    if (!f.grn.trim()) return toast("GRN No is required");
    if (f.sup && !f.inv.trim()) return toast("Enter the invoice no");
    if (!f.by.trim()) return toast("Enter who received the goods");
    const out = [];
    for (const l of lines) { if (!l.item && !l.qty) continue; const it = fi(l.item), q = Number(l.qty); if (!it || !(q > 0)) return toast("Check the item lines: pick an item and enter a quantity"); out.push({ item_code: it.code, qty: q, unit_price: Number(l.price) || 0 }); }
    if (!out.length) return toast("Add at least one item line");
    setBusy(true);
    let path = "";
    if (f.file) { path = `${f.branch}/${Date.now()}-${f.file.name.replace(/[^\w.-]/g, "_")}`; const u = await supabase.storage.from("grn-files").upload(path, f.file); if (u.error) { setBusy(false); return toast("File upload failed: " + u.error.message); } }
    const { data, error } = await supabase.rpc("save_grn", { p: { grn_no: f.grn.trim(), branch: f.branch, supplier_code: f.sup, invoice_no: f.inv.trim(), grn_date: f.date, received_by: f.by.trim(), source_file: path, lines: out } });
    setBusy(false);
    if (error) return toast(error.code === "23505" ? `GRN ${f.grn} is already recorded` : error.message);
    toast("GRN saved, stock updated"); setF(blank); setLines([{ item: "", qty: "", price: "" }]); setSt(""); go(data);
  }
  return (
    <>
      <ItemList items={D.items} />
      <div className="box"><h2>Import from HIS GRN report</h2><div className="mu">Upload the HIS report as a PDF or photo/scan (max 4 MB). The data fills the form below for you to check. The file is kept with the GRN when you save.</div>
        <div className="row" style={{ marginTop: 8 }}><input type="file" accept="application/pdf,image/*" onChange={(e) => setF({ ...f, file: e.target.files[0] || null })} /><button className="p" onClick={read}>Read file</button></div><div className="mu" style={{ marginTop: 6 }}>{st}</div></div>
      <div className="box"><h2>Receive stock: GRN</h2><div className="mu" style={{ marginBottom: 8 }}>Enter the GRN after the goods and invoice are checked. Saving adds the items to stock automatically. GRN numbers cannot be repeated.</div>
        <div className="row">
          <label>Center<select value={f.branch} onChange={(e) => { saveB(e.target.value); setF({ ...f, branch: e.target.value }); }}>{canB.map((b) => <option key={b}>{b}</option>)}</select></label>
          <label>Supplier<select value={f.sup} onChange={(e) => setF({ ...f, sup: e.target.value })}><option value="">Opening stock (no supplier)</option>{D.sups.map((s) => <option key={s.code} value={s.code}>{s.code} {s.name}</option>)}</select></label>
          <label>Invoice No<input value={f.inv} onChange={(e) => setF({ ...f, inv: e.target.value })} /></label>
          <label>GRN No (required)<input value={f.grn} placeholder="e.g. GRN-0001" onChange={(e) => setF({ ...f, grn: e.target.value })} /></label>
          <label>Date<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label>Received by<input value={f.by} onChange={(e) => setF({ ...f, by: e.target.value })} /></label>
        </div>
        <div className="sc"><table style={{ marginTop: 10 }}><thead><tr><th>Item</th><th>Qty</th><th>Unit price (LKR)</th><th></th></tr></thead><tbody>
          {lines.map((l, k) => <tr key={k}><td><input className="li" list="il" placeholder="Code or item name" value={l.item} style={l.item && !fi(l.item) ? { borderColor: "var(--r)" } : {}} onChange={(e) => onItem(k, e.target.value)} /></td>
            <td><input type="number" min="0" step="any" value={l.qty} onChange={(e) => upd(k, "qty", e.target.value)} /></td><td><input type="number" min="0" step="any" value={l.price} onChange={(e) => upd(k, "price", e.target.value)} /></td>
            <td><button className="x" onClick={() => lines.length > 1 && setLines(lines.filter((_, i) => i !== k))}>✕</button></td></tr>)}</tbody></table></div>
        <div style={{ marginTop: 8 }}><button className="p" onClick={() => setLines([...lines, { item: "", qty: "", price: "" }])}>+ Add line</button> <button className="p" disabled={busy} onClick={save}>Save GRN &amp; update stock</button></div></div>
    </>
  );
}

function Issue({ D, canB, stock, toast, reload }) {
  const [f, setF] = useState({ branch: lastB(), item: "", qty: "", rby: "", iby: "", dept: "", note: "" });
  const it = findItem(D.items, f.item), av = it ? stock[f.branch + "|" + it.code]?.qty || 0 : 0;
  async function save() {
    const q = Number(f.qty);
    if (!it) return toast("Pick an item"); if (!(q > 0)) return toast("Enter a quantity"); if (!f.rby.trim() || !f.iby.trim()) return toast("Enter Issued by and Received by");
    if (q > av) return toast(`Only ${fmt(av)} in stock at ${f.branch}`);
    const { error } = await supabase.from("issues").insert({ branch: f.branch, item_code: it.code, qty: q, received_by: f.rby.trim(), issued_by: f.iby.trim(), dept: f.dept.trim(), note: f.note.trim() });
    if (error) return toast(error.message);
    toast("Issue saved"); setF({ ...f, item: "", qty: "", rby: "", note: "" }); reload();
  }
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="box"><ItemList items={D.items} /><h2>Issue stock</h2>
      <div className="row"><label>Center<select value={f.branch} onChange={(e) => { saveB(e.target.value); setF({ ...f, branch: e.target.value }); }}>{canB.map((b) => <option key={b}>{b}</option>)}</select></label>
        <label>Item<input list="il" style={{ width: 260 }} placeholder="Code or item name" value={f.item} onChange={set("item")} /></label><label>Qty<input type="number" min="0" step="any" style={{ width: 80 }} value={f.qty} onChange={set("qty")} /></label>
        <label>Received by (who took it)<input value={f.rby} onChange={set("rby")} /></label><label>Issued by<input value={f.iby} onChange={set("iby")} /></label>
        <label>Department<input style={{ width: 130 }} value={f.dept} onChange={set("dept")} /></label><label>Note<input style={{ width: 150 }} value={f.note} onChange={set("note")} /></label><button className="p" onClick={save}>Save issue</button></div>
      <div className="mu" style={{ marginTop: 6 }}>{it ? `Available at ${f.branch}: ${fmt(av)} ${it.uom || ""}` : ""}</div></div>
  );
}

function Grns({ D, supName, view, setView, toast }) {
  const g = D.grns.find((x) => x.id === view);
  async function openFile() { const { data, error } = await supabase.storage.from("grn-files").createSignedUrl(g.source_file, 300); if (error) return toast(error.message); window.open(data.signedUrl, "_blank"); }
  if (g) {
    const tot = g.grn_lines.reduce((s, l) => s + l.qty * l.unit_price, 0), nm = (c) => D.items.find((i) => i.code === c)?.name || "";
    return (
      <>
        <div className="noprint box"><button className="p" onClick={() => window.print()}>Print</button> <button className="p" onClick={() => setView("")}>Back to list</button> {g.source_file && <button className="p" onClick={openFile}>Open HIS report file</button>}</div>
        <div className="box"><h2 style={{ textAlign: "center", fontSize: 17 }}>NAWALOKA MEDICAL CENTRES (PVT) LTD<br />GOODS RECEIVED NOTE (GRN)</h2>
          <table><tbody><tr><th>GRN No</th><td>{g.grn_no}</td><th>Date</th><td>{g.grn_date}</td></tr><tr><th>Center</th><td>{g.branch}</td><th>Supplier</th><td>{g.supplier_code ? g.supplier_code + " " : ""}{supName(g.supplier_code)}</td></tr><tr><th>Invoice No</th><td>{g.invoice_no}</td><th>Received by</th><td>{g.received_by}</td></tr></tbody></table>
          <table style={{ marginTop: 12 }}><thead><tr><th>#</th><th>Code</th><th>Item</th><th className="n">Qty</th><th className="n">Unit price (LKR)</th><th className="n">Value (LKR)</th></tr></thead><tbody>
            {g.grn_lines.map((l, k) => <tr key={l.id}><td>{k + 1}</td><td>{l.item_code}</td><td>{nm(l.item_code)}</td><td className="n">{fmt(l.qty)}</td><td className="n">{fmt(l.unit_price)}</td><td className="n">{fmt(l.qty * l.unit_price)}</td></tr>)}
            <tr><th colSpan="5" className="n">Total</th><th className="n">{fmt(tot)}</th></tr></tbody></table>
          <table style={{ marginTop: 36 }}><tbody><tr>{["Received by", "Checked by", "Approved by"].map((x) => <td key={x} style={{ border: 0 }}>.............................<br />{x}</td>)}</tr></tbody></table></div>
      </>
    );
  }
  return (
    <div className="box sc"><h2>GRN Reports</h2><table><thead><tr><th>GRN No</th><th>Date</th><th>Center</th><th>Supplier</th><th>Invoice</th><th className="n">Lines</th><th className="n">Value (LKR)</th><th>Received by</th><th></th></tr></thead><tbody>
      {D.grns.map((x) => <tr key={x.id}><td>{x.grn_no}</td><td>{x.grn_date}</td><td>{x.branch}</td><td>{supName(x.supplier_code)}</td><td>{x.invoice_no}</td><td className="n">{x.grn_lines.length}</td><td className="n">{fmt(x.grn_lines.reduce((s, l) => s + l.qty * l.unit_price, 0))}</td><td>{x.received_by}</td><td><button className="p" onClick={() => setView(x.id)}>View / Print</button></td></tr>)}
      {!D.grns.length && <tr><td colSpan="9" className="mu">No GRNs yet.</td></tr>}</tbody></table></div>
  );
}

function Log({ D, supName }) {
  const [q, setQ] = useState(""), nm = (c) => D.items.find((i) => i.code === c)?.name || "";
  const rows = [];
  D.grns.forEach((g) => g.grn_lines.forEach((l) => rows.push({ ts: g.created_at, d: g.grn_date, ty: "GRN IN", b: g.branch, c: l.item_code, n: nm(l.item_code), q: Number(l.qty), ref: `GRN ${g.grn_no}${g.invoice_no ? " · Inv " + g.invoice_no : ""} · ${supName(g.supplier_code)}`, by: "", rb: g.received_by })));
  D.issues.forEach((v) => rows.push({ ts: v.created_at, d: v.created_at.slice(0, 10), ty: "ISSUE", b: v.branch, c: v.item_code, n: nm(v.item_code), q: -Number(v.qty), ref: [v.dept, v.note].filter(Boolean).join(" · "), by: v.issued_by, rb: v.received_by }));
  const sh = rows.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase())).sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 300);
  return (
    <>
      <div className="box"><label className="mu">Search (item, GRN no, person, center…)<br /><input style={{ width: 300 }} value={q} onChange={(e) => setQ(e.target.value)} /></label></div>
      <div className="box sc"><table><thead><tr><th>Date</th><th>Type</th><th>Center</th><th>Code</th><th>Item</th><th className="n">Qty</th><th>Reference</th><th>Issued by</th><th>Received by</th></tr></thead><tbody>
        {sh.map((r, i) => <tr key={i}><td>{r.d}</td><td className={r.q > 0 ? "ok" : ""}>{r.ty}</td><td>{r.b}</td><td>{r.c}</td><td>{r.n}</td><td className="n">{r.q > 0 ? "+" : ""}{fmt(r.q)}</td><td>{r.ref}</td><td>{r.by}</td><td>{r.rb}</td></tr>)}
        {!sh.length && <tr><td colSpan="9" className="mu">No records.</td></tr>}</tbody></table></div>
    </>
  );
}

function Items({ D, me, toast, reload, lowP, supName }) {
  const admin = me.role === "admin";
  const [it, setIt] = useState({ name: "", cat: "Stationery", uom: "" }), [sp, setSp] = useState({ name: "", note: "" }), [ps, setPs] = useState(""), [txt, setTxt] = useState("");
  const sel = ps || D.sups[0]?.code;
  const addItem = async () => { if (!it.name.trim()) return; const code = nextCode("STN", D.items.map((i) => i.code)); const { error } = await supabase.from("items").insert({ code, name: it.name.trim(), category: it.cat, uom: it.uom }); if (error) return toast(error.message); toast("Added " + code); setIt({ ...it, name: "" }); reload(); };
  const addSup = async () => { if (!sp.name.trim()) return; const code = nextCode("SUP", D.sups.map((s) => s.code)); const { error } = await supabase.from("suppliers").insert({ code, name: sp.name.trim(), note: sp.note }); if (error) return toast(error.message); toast("Added " + code); setSp({ name: "", note: "" }); reload(); };
  async function imp() {
    const sm = {}, im = {}, sc = D.sups.map((s) => s.code), ic = D.items.map((i) => i.code);
    D.sups.forEach((s) => { sm[s.name.toLowerCase()] = s.code; sm[s.code.toLowerCase()] = s.code; }); D.items.forEach((i) => { im[i.name.toLowerCase()] = i.code; im[i.code.toLowerCase()] = i.code; });
    let n = 0;
    for (const c of txt.split("\n").map((l) => l.split(/\t|,/).map((x) => x.trim())).filter((c) => c.length >= 4 && c[1] && Number(c[3]) > 0)) {
      let s = sm[c[0].toLowerCase()]; if (!s) { s = nextCode("SUP", sc); sc.push(s); sm[c[0].toLowerCase()] = s; const r = await supabase.from("suppliers").insert({ code: s, name: c[0] }); if (r.error) return toast(r.error.message); }
      let i = im[c[1].toLowerCase()]; if (!i) { i = nextCode("STN", ic); ic.push(i); im[c[1].toLowerCase()] = i; const r = await supabase.from("items").insert({ code: i, name: c[1], uom: c[2] }); if (r.error) return toast(r.error.message); }
      const r = await supabase.from("supplier_prices").upsert({ item_code: i, supplier_code: s, price: Number(c[3]), brand: "" }, { onConflict: "item_code,supplier_code,brand" }); if (r.error) return toast(r.error.message); n++;
    }
    toast(n ? n + " prices imported" : "No valid lines"); setTxt(""); reload();
  }
  return (
    <>
      {admin && <><div className="box"><h2>Add item</h2><div className="row"><label>Name<input style={{ width: 240 }} value={it.name} onChange={(e) => setIt({ ...it, name: e.target.value })} /></label><label>Category<input style={{ width: 120 }} value={it.cat} onChange={(e) => setIt({ ...it, cat: e.target.value })} /></label><label>Unit<input style={{ width: 110 }} placeholder="nos / box / ream" value={it.uom} onChange={(e) => setIt({ ...it, uom: e.target.value })} /></label><button className="p" onClick={addItem}>Add (code is automatic)</button></div></div>
        <div className="box"><h2>Add supplier</h2><div className="row"><label>Name<input style={{ width: 240 }} value={sp.name} onChange={(e) => setSp({ ...sp, name: e.target.value })} /></label><label>Note<input style={{ width: 240 }} value={sp.note} onChange={(e) => setSp({ ...sp, note: e.target.value })} /></label><button className="p" onClick={addSup}>Add (code is automatic)</button></div></div></>}
      <div className="box sc"><h2>Suppliers</h2><table><thead><tr><th>Code</th><th>Supplier</th><th>Note</th></tr></thead><tbody>{D.sups.map((s) => <tr key={s.code}><td>{s.code}</td><td>{s.name}</td><td>{s.note}</td></tr>)}</tbody></table></div>
      <div className="box sc"><label className="mu">Supplier price list<br /><select value={sel} onChange={(e) => setPs(e.target.value)}>{D.sups.map((s) => <option key={s.code} value={s.code}>{s.code} {s.name}</option>)}</select></label>
        <table style={{ marginTop: 8 }}><thead><tr><th>Code</th><th>Item</th><th>Unit</th><th className="n">Price (LKR)</th><th>Brand</th></tr></thead><tbody>
          {D.prices.filter((p) => p.supplier_code === sel).sort((a, b) => a.item_code.localeCompare(b.item_code)).map((p) => { const i = D.items.find((x) => x.code === p.item_code); return <tr key={p.id}><td>{p.item_code}</td><td>{i?.name}</td><td>{i?.uom}</td><td className="n">{fmt(p.price)}</td><td>{p.brand}</td></tr>; })}</tbody></table></div>
      {admin && <div className="box"><h2>Import supplier price list</h2><div className="mu" style={{ marginBottom: 6 }}>One line per item: Supplier, Item, Unit, Price (paste from Excel). New suppliers and items get codes automatically; existing prices are updated.</div><textarea rows="5" style={{ width: "100%" }} value={txt} onChange={(e) => setTxt(e.target.value)} /><div style={{ marginTop: 8 }}><button className="p" onClick={imp}>Import</button></div></div>}
      <div className="box sc"><h2>Items (cheapest price)</h2><table><thead><tr><th>Code</th><th>Item</th><th>Unit</th><th className="n">Lowest price</th><th>Supplier</th></tr></thead><tbody>
        {D.items.map((i) => { const p = lowP(i.code); return <tr key={i.code}><td>{i.code}</td><td>{i.name}</td><td>{i.uom}</td><td className="n">{p ? fmt(p.price) : "—"}</td><td>{p ? supName(p.supplier_code) : ""}</td></tr>; })}</tbody></table></div>
    </>
  );
}

function Reorder({ D, canB, stock, toast, reload }) {
  async function save(b, code, v) { const { error } = await supabase.from("reorder_levels").upsert({ branch: b, item_code: code, min_qty: Number(v) || 0 }); if (error) toast(error.message); }
  return (
    <div className="box sc"><h2>Reorder levels per center</h2><div className="mu" style={{ marginBottom: 6 }}>Type a level and press Enter or leave the cell to save. The All column sets every center you can edit.</div>
      <table><thead><tr><th>Code</th><th>Item</th><th className="n">All</th>{BR.map((b) => <th key={b} className="n">{b}</th>)}</tr></thead><tbody>
        {D.items.map((it) => <tr key={it.code}><td>{it.code}</td><td>{it.name}</td>
          <td className="n"><input type="number" min="0" placeholder="all" style={{ width: 70 }} onBlur={async (e) => { if (e.target.value === "") return; for (const b of canB) await save(b, it.code, e.target.value); e.target.value = ""; toast("Set for all centers"); reload(); }} /></td>
          {BR.map((b) => <td key={b} className="n"><input type="number" min="0" style={{ width: 70 }} disabled={!canB.includes(b)} key={b + (stock[b + "|" + it.code]?.min_qty || 0)} defaultValue={stock[b + "|" + it.code]?.min_qty || ""} onBlur={async (e) => { await save(b, it.code, e.target.value); reload(); }} /></td>)}</tr>)}</tbody></table></div>
  );
}
