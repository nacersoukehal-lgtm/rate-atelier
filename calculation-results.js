(() => {
  "use strict";
  // Share only explicit calculator inputs and dated reference observations.
  const api = {
    restore(fields) {
      const params = new URLSearchParams(location.search);
      for (const id of fields) {
        const input = document.getElementById(id), raw = params.get(id);
        if (!input || raw === null || raw.length > 120) continue;
        if (input.tagName === "SELECT") {
          if ([...input.options].some(o => o.value === raw)) input.value=raw;
        } else if (input.type === "number") {
          if (raw.trim() && Number.isFinite(Number(raw)) &&
              (!input.min || Number(raw)>=Number(input.min)) && (!input.max || Number(raw)<=Number(input.max))) input.value=raw;
        }
      }
    },
    bind(root,fields,report) {
      const status=root.querySelector("[data-result-status]");
      const link=root.querySelector("[data-result-share]");
      const download=root.querySelector("[data-result-download]");
      if (!link || !download) return;
      function output() {
        const result=report();
        if (!result || !result.lines?.length) throw Error("Complete valid inputs and wait for a reference rate before sharing.");
        const url=new URL(location.pathname,location.origin);
        for (const id of fields) {
          const input=document.getElementById(id);
          if (input && input.value !== "") url.searchParams.set(id,input.value);
        }
        for (const [key,value] of Object.entries(result.params ?? {})) url.searchParams.set(key,value);
        return {url:url.href,text:["Rate Atelier — "+result.title,"Calculated: "+new Date().toISOString(),"",...result.lines,"","Reproduce this calculation: "+url.href,"Reference estimates; verify final rates and fees with your provider."].join("\n")};
      }
      link.addEventListener("click",async () => {
        try {
          const result=output();
          await navigator.clipboard.writeText(result.url);
          status.textContent="Result link copied. It contains your calculator inputs and dated reference rates.";
        } catch(error) {
          status.replaceChildren(document.createTextNode(error.message+" "));
          try {
            const result=output(), a=document.createElement("a"); a.href=result.url; a.textContent="Open shareable result"; status.append(a);
          } catch {}
        }
      });
      download.addEventListener("click",() => {
        try {
          const result=output(), blob=new Blob([result.text],{type:"text/plain;charset=utf-8"});
          const url=URL.createObjectURL(blob), a=document.createElement("a");
          a.href=url; a.download="rate-atelier-"+location.pathname.split("/").at(-1).replace(".html","")+"-"+new Date().toISOString().slice(0,10)+".txt";
          a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
          status.textContent="Dated summary downloaded with inputs, rates, fees, and sources.";
        } catch(error) { status.textContent=error.message; }
      });
    }
  };
  window.rateAtelierResults=api;
})();

