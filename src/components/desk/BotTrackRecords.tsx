import { useEffect, useState } from "react";
import type { botRecords } from "@/lib/desk/bot-records.server";
type Records=Awaited<ReturnType<typeof botRecords>>;
export function BotTrackRecords() {
  const [data,setData]=useState<Records|null>(null),[error,setError]=useState(false),[favorites,setFavorites]=useState<string[]>([]);
  useEffect(()=>{
    try {const v=JSON.parse(localStorage.getItem("council.bot.favorites.v1")??"[]");if(Array.isArray(v))setFavorites(v.filter(x=>typeof x==="string"));} catch { /* optional local preference */ }
    let alive=true;
    const pull=async()=>{try {const r=await fetch("/api/bot-records");if(!r.ok)throw Error();const d=await r.json();if(alive){setData(d);setError(false);}}catch{if(alive)setError(true);}};
    void pull();const timer=setInterval(()=>void pull(),60_000);return()=>{alive=false;clearInterval(timer);};
  },[]);
  const toggle=(seat:string)=>{const next=favorites.includes(seat)?favorites.filter(s=>s!==seat):[...favorites,seat];setFavorites(next);try{localStorage.setItem("council.bot.favorites.v1",JSON.stringify(next));}catch{/* optional local preference */}};
  const rate=(hits:number,n:number)=>n?`${(100*hits/n).toFixed(1)}% (${hits}/${n})`:"—";
  return <section className="rounded-md border border-border bg-surface p-3" aria-label="Bot track records">
    <h3 className="font-medium">Compare bots · pick favorites</h3>
    <p className="mt-2 text-ui text-muted">Research reads at each window's final recorded frame. These scores are not entry-time accuracy, simulated profit or booked trades. The Chair controls its own decision.</p>
    <p className="mt-1 text-ui text-muted">Favorites reorder this board on this browser. They do not change your mutes, the Chair, or the canonical book.</p>
    {error&&<p className="mt-2 text-ui">Track records unavailable{data?"; showing the last fetched snapshot":""}.</p>}
    {data?<><p className="mt-2 text-ui">Cohort: {data.start} to {data.end}. Official outcomes; quarantined windows excluded. Fewer than 50 reads is a small sample.</p>
    <div className="mt-3 overflow-x-auto"><table className="table-research"><thead><tr><th>Favorite</th><th>Bot</th><th>Role</th><th>Observed windows</th><th>Raw direction hits</th><th>Final direction hits</th><th>Raw held as WAIT</th></tr></thead><tbody>
      {[...data.rows].sort((a,b)=>Number(favorites.includes(b.seat))-Number(favorites.includes(a.seat))||a.seat.localeCompare(b.seat)).map(r=><tr key={r.seat} className="border-t border-border"><td><button type="button" aria-pressed={favorites.includes(r.seat)} aria-label={`Favorite ${r.seat}`} onClick={()=>toggle(r.seat)}>{favorites.includes(r.seat)?"★":"☆"}</button></td><td>{r.seat}</td><td>{r.role}</td><td>{r.windows}</td><td>{rate(r.raw_hits,r.raw_n)}{r.raw_n>0&&r.raw_n<50?" · small sample":""}</td><td>{rate(r.final_hits,r.final_n)}{r.final_n>0&&r.final_n<50?" · small sample":""}</td><td>{r.suppressed}</td></tr>)}</tbody></table></div></>:!error&&<p className="mt-2 text-ui">Loading bot track records…</p>}
  </section>;
}
