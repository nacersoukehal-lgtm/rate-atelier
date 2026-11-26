(() => {
  "use strict";
  const get=id=>document.getElementById(id), n=id=>get(id).valueAsNumber;
  const params=new URLSearchParams(location.search);
  const positive=v=>Number.isFinite(v)&&v>0;
  const names=new Intl.DisplayNames(undefined,{type:"currency"});
  const digits=new Intl.NumberFormat(undefined,{maximumFractionDigits:6});
  const cash=(v,c)=>new Intl.NumberFormat(undefined,{style:"currency",currency:c,currencyDisplay:"code"}).format(v);
  const shared=window.rateAtelierResults;
  let feed=currencyFeed.seed(), loading=false;
  let supported;
  try { supported=new Set(Intl.supportedValuesOf("currency")); } catch { supported=new Set(["USD","EUR","GBP","CAD","AUD","DZD","JPY"]); }
  const conventional=code=>supported.has(code) && !["XAU","XAG","XPT","XPD"].includes(code);
  function populate(id,fallback) {
    const select=get(id), selected=select.value || params.get(id) || fallback;
    const codes=[...new Set(["USD","EUR","GBP","CAD","AUD","DZD","JPY",...[...(feed?.names?.keys() ?? [])].filter(conventional)])];
    select.replaceChildren(...codes.map(code=>new Option(code+" — "+names.of(code),code)));
    select.value=codes.includes(selected)?selected:fallback;
  }
  function cross(from,to) {
    if (from===to) return {rate:1,note:"Same currency · No exchange-rate conversion"};
    const base=feed?.rates.get(from), quote=feed?.rates.get(to);
    if (!positive(base?.rate)||!positive(quote?.rate)) return null;
    const observations=[...[from,to].filter(c=>c!=="USD").map(c=>{
      const row=feed.rates.get(c);
      return c+": "+(row.date || "Observation date unavailable")+" · "+(row.source || feed.source);
    })];
    return {rate:quote.rate/base.rate,note:[...new Set(observations)].join("; ")+(feed.published?" · Last published reference":"")};
  }
  async function refresh(render) {
    if (loading) return;
    loading=true;
    try { feed=await currencyFeed.latest(); } catch {}
    loading=false; render();
  }
  if (get("travel-tool")) {
    const root=get("travel-tool"), methods=[["card","Pay by card"],["atm","Withdraw cash"],["cash","Exchange cash"]];
    const fields=["travel-budget","travel-from","travel-to","travel-reference",...methods.flatMap(([key])=>[key+"-percent",key+"-fixed",key+"-count",key+"-rate"])];
    populate("travel-from","USD");populate("travel-to","EUR");shared.restore(fields);
    let report=null;
    function render() {
      const ref=cross(get("travel-from").value,get("travel-to").value), manual=get("travel-reference").value!=="";
      const rate=manual?n("travel-reference"):ref?.rate;
      const reference=manual ? "User-entered reference rate"+(params.get("reference-note")?" · "+params.get("reference-note").slice(0,600):"") : ref?.note;
      get("travel-reference-note").textContent=positive(rate)?"1 "+get("travel-from").value+" = "+digits.format(rate)+" "+get("travel-to").value+" · "+reference:
        "Reference rate unavailable. Enter a reference rate above to compare methods.";
      const budget=n("travel-budget"), from=get("travel-from").value,to=get("travel-to").value;
      const rows=methods.map(([key,label])=>{
        const quoted=get(key+"-rate").value!==""?n(key+"-rate"):rate;
        const value=rateAtelierPracticalMath.travel(budget,n(key+"-percent"),n(key+"-fixed"),n(key+"-count"),quoted);
        return {key,label,value,quoted,missingFees:[key+"-percent",key+"-fixed"].some(id=>get(id).value==="")};
      });
      const valid=rows.every(row=>row.value)&&positive(rate)&&root.checkValidity();
      get("travel-status").textContent=valid?"Fees stay inside your total budget. Highest spendable amount is highlighted.":rows.some(row=>row.missingFees)?"Enter your actual fees for each method. Enter 0 only if confirmed, or select Confirm no fees. Untouched methods are incomplete.":"Enter nonnegative amounts and fees, whole transaction counts, and valid rates. Fixed charges cannot exceed the budget.";
      get("travel-caption").textContent=Number.isFinite(budget)?cash(budget,from)+" total budget · Spendable amounts in "+to:"Comparison";
      const best=valid?Math.max(...rows.map(r=>r.value.received)):NaN;
      get("travel-rows").replaceChildren(...rows.map(row=>{
        const tr=document.createElement("tr");
        if (valid && Math.abs(row.value.received-best)<1e-8) tr.dataset.best="true";
        for(const text of [row.label,row.value?cash(row.value.received,to):row.missingFees?"Incomplete · Enter actual fees":"Unavailable",row.value?cash(row.value.fees,from):"Unavailable",row.value&&positive(rate)?cash(budget*rate-row.value.received,to):"Unavailable"]){
          const td=document.createElement("td");td.textContent=text;tr.append(td);
        }return tr;
      }));
      get("travel-verdict").textContent=valid?rows.filter(r=>Math.abs(r.value.received-best)<1e-8).map(r=>r.label).join(" and ")+" leaves "+cash(best,to)+" spendable under these assumptions.":"";
      report=valid?{title:"Travel exchange-cost comparison",params:{"travel-reference":String(rate),"reference-note":reference},lines:[
        "Total budget: "+cash(budget,from),"Reference rate: "+rate+" "+to+" per "+from,"Reference source/date: "+reference,
        "Formula: principal = (budget - fixed charge × count) / (1 + percentage fee / 100).",
        ...rows.map(r=>r.label+": "+cash(r.value.received,to)+" spendable; explicit fees "+cash(r.value.fees,from)+"; rate "+r.quoted+"; percentage "+n(r.key+"-percent")+"%; fixed "+n(r.key+"-fixed")+" × "+n(r.key+"-count")),
        "Shortfall includes explicit fees and any difference between entered and reference rates."
      ]}:null;
    }
    root.addEventListener("submit",event=>event.preventDefault());
    root.addEventListener("input",render);root.addEventListener("change",render);
    get("travel-refresh").addEventListener("click",()=>{get("travel-reference").value="";params.delete("reference-note");refresh(()=>{for(const [id,fallback] of [["travel-from","USD"],["travel-to","EUR"]])populate(id,fallback);render();});});
    for (const button of root.querySelectorAll("[data-no-fees]")) button.addEventListener("click",()=>{
      const key=button.dataset.noFees;
      get(key+"-percent").value="0";get(key+"-fixed").value="0";render();
    });
    shared.bind(root,fields,()=>report);render();
    refresh(()=>{populate("travel-from","USD");populate("travel-to","EUR");shared.restore(["travel-from","travel-to"]);render();});
  }
  if (get("multi-tool")) {
    const root=get("multi-tool"), defaults=["EUR","GBP","CAD","DZD","JPY"];
    const requested=(params.get("targets")||defaults.join(",")).split(",").filter(conventional).slice(0,10);
    const selected=new Set(requested.length?requested:defaults);
    let fixed=null,report=null;
    try {
      const decoded=JSON.parse(params.get("reference")||"null");
      if (Array.isArray(decoded) && decoded.length<=10) {
        const safe=decoded.filter(r=>conventional(r.code)&&positive(r.rate)&&typeof r.note==="string"&&r.note.length<800);
        if(safe.length)fixed=safe;
      }
    } catch {}
    populate("multi-from","USD");shared.restore(["multi-from","multi-amount"]);
    function choices() {
      const query=get("multi-search").value.trim().toLowerCase();
      const codes=[...new Set([...selected,"USD","EUR","GBP","CAD","AUD","DZD","JPY",...[...(feed?.names?.keys()??[])].filter(conventional)])];
      get("multi-selection-count").textContent=selected.size+" selected";
      get("multi-choices").replaceChildren(...codes.filter(c=>selected.has(c)||(c+" "+names.of(c)).toLowerCase().includes(query)).sort((a,b)=>Number(selected.has(b))-Number(selected.has(a))||a.localeCompare(b)).map(code=>{
        const label=document.createElement("label"),check=document.createElement("input");
        check.type="checkbox";check.value=code;check.checked=selected.has(code);
        check.addEventListener("change",()=>{
          if(check.checked&&selected.size>=10){check.checked=false;get("multi-status").textContent="Select up to 10 destination currencies.";return;}
          check.checked?selected.add(code):selected.delete(code);render();choices();
        });
        label.append(check,document.createTextNode(" "+code+" — "+names.of(code)));return label;
      }));
    }
    function render() {
      const from=get("multi-from").value,amount=n("multi-amount");
      const valid=Number.isFinite(amount)&&amount>=0;
      const rows=[...selected].map(code=>({code,...(fixed?.find(r=>r.code===code)??(!fixed?cross(from,code):null))}));
      get("multi-caption").textContent=valid?cash(amount,from)+" in selected currencies":"Selected currency conversions";
      get("multi-rows").replaceChildren(...rows.map(row=>{
        const tr=document.createElement("tr");
        for(const text of [row.code+" — "+names.of(row.code),valid&&positive(row.rate)?cash(amount*row.rate,row.code):"Reference unavailable",positive(row.rate)?digits.format(row.rate):"Unavailable",row.note||"No published reference available"]){
          const td=document.createElement("td");td.textContent=text;tr.append(td);
        }return tr;
      }));
      get("multi-status").textContent=!valid?"Enter an amount of zero or more.":!selected.size?"Choose at least one destination currency.":fixed?"Shared reference snapshot · Values are fixed to the rates and dates in this link. Refresh to use current references.":loading?"Checking reference rates…":rows.some(r=>!positive(r.rate))?"Some references are unavailable. Available conversions remain visible.":"Reference conversions before provider fees. Each row retains its own source date.";
      const available=rows.filter(r=>positive(r.rate));
      report=valid&&available.length?{title:"Multiple-currency conversion",params:{targets:[...selected].join(","),reference:JSON.stringify(available.map(({code,rate,note})=>({code,rate,note})))},lines:["Amount: "+cash(amount,from),...available.map(r=>cash(amount*r.rate,r.code)+" · Rate "+r.rate+" "+r.code+" per "+from+" · "+r.note),"Provider fees and spreads are not included."]}:null;
    }
    root.addEventListener("submit",event=>event.preventDefault());
    root.addEventListener("input",event=>{if(event.target.id!=="multi-search")render();});
    get("multi-search").addEventListener("input",choices);
    get("multi-from").addEventListener("change",()=>{fixed=null;render();});
    get("multi-refresh").addEventListener("click",()=>{fixed=null;refresh(()=>{populate("multi-from","USD");choices();render();});});
    shared.bind(root,["multi-amount","multi-from"],()=>report);choices();render();
    refresh(()=>{populate("multi-from","USD");shared.restore(["multi-from"]);choices();render();});
  }
})();


