(() => {
 'use strict';
 const API='https://rate-atelier-alerts.rateatelier.workers.dev';
 const mount=document.getElementById('email-alerts');
 if(!mount)return;
 async function start(){
  const r=await fetch(API+'/health',{signal:AbortSignal.timeout(8000)});
  if(!r.ok)return;
  const config=await r.json();
  if(!config.ready||!config.siteKey)return;
  mount.hidden=false;
  const form=mount.querySelector('form'),status=mount.querySelector('[role="status"]'),button=form.querySelector('button');
  const type=form.elements.kind,asset=form.elements.asset,unit=mount.querySelector('[data-email-unit]');
  const metals={XAU:'Gold',XAG:'Silver',XPT:'Platinum',XPD:'Palladium'};
  function choices(){
   asset.replaceChildren();
   const codes=config.assets.filter(c=>!metals[c]);
   const stocks=typeof stockCatalog!=='undefined'?stockCatalog.filter(s=>s.region==='U.S.'&&['Stock','ETF'].includes(s.type)&&/^[A-Z][A-Z0-9-]{0,11}$/.test(s.symbol)):[];
   const items=type.value==='metal'?Object.entries(metals).map(([c,name])=>[c,name]):type.value==='crypto'?Object.entries(config.crypto||{}).map(([c,name])=>['crypto:'+c,name]):type.value==='stock'?stocks.map(s=>['stock:'+s.symbol,s.symbol+' — '+s.name]).sort((a,b)=>a[1].localeCompare(b[1])):codes.flatMap(a=>codes.filter(b=>b!==a).map(b=>[a+'/'+b,a+' → '+b]));
   for(const [value,label]of items)asset.add(new Option(label,value));
   unit.textContent=type.value==='metal'?'Target in USD per troy ounce':type.value==='crypto'?'Target in USD per coin':type.value==='stock'?'Target in USD per share':'Target rate (To currency per 1 From currency)';
  }
  type.addEventListener('change',choices);choices();
  for(const value of ['crypto','stock'])if(!(value==='crypto'?Object.keys(config.crypto||{}).length:config.stocks))form.querySelector('option[value="'+value+'"]').remove();
  // Load verification only when the visitor opens the email form.
  const details=mount.querySelector('details');let widget,challenge='';
  details.addEventListener('toggle',async()=>{
   if(!details.open||widget!==undefined)return;
   widget=null;
   try{
    if(!window.turnstile)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.onload=resolve;s.onerror=reject;document.head.append(s);});
    widget=window.turnstile.render(mount.querySelector('[data-verification]'),{sitekey:config.siteKey,action:'price-alert',callback:t=>{challenge=t;button.disabled=false;},'expired-callback':()=>{challenge='';button.disabled=true;},'error-callback':()=>{challenge='';button.disabled=true;status.textContent='Verification could not load. Please try again later.';}});
   }catch{status.textContent='Verification could not load. Please try again later.';}
  });
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(!form.reportValidity()||!challenge)return;
   button.disabled=true;status.textContent='Sending your confirmation email…';
   try{
    const response=await fetch(API+'/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.elements.email.value,asset:asset.value,target:Number(form.elements.target.value),direction:form.elements.direction.value,consent:form.elements.consent.checked,turnstile:challenge}),signal:AbortSignal.timeout(25000)});
    const data=await response.json();status.textContent=data.message||data.error||'Please try again later.';
    if(response.ok){form.elements.email.value='';form.elements.consent.checked=false;}
   }catch{status.textContent='We could not confirm delivery. Check your inbox before trying again.';}
   finally{challenge='';if(widget!==null)window.turnstile.reset(widget);}
  });
 }
 start().catch(()=>{}); // Browser alerts continue independently if email service is offline.
})();
