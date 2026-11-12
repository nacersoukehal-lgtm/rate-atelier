"use strict";

const currencyFeed = (() => {
  const frankfurter = "https://api.frankfurter.dev/v2/";
  const ecb = "https://proxy.cors.dev/https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
  const displayNames = new Intl.DisplayNames(undefined,{type:"currency"});
  let directory;

  async function read(url,format) {
    const response = await fetch(url,{signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error("Exchange-rate feed unavailable");
    return response[format]();
  }

  async function primary() {
    const [rows,names] = await Promise.all([
      read(frankfurter+"rates?base=USD","json"),
      directory ?? read(frankfurter+"currencies","json").then(entries =>
        new Map(entries.filter(entry => entry.type === "currency").map(entry => [entry.iso_code,entry.name])))
    ]);
    const available = rows.filter(row => names.has(row.quote) && Number.isFinite(row.rate) && row.rate > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(row.date));
    if (!available.length) throw new Error("Frankfurter returned no rates");
    directory = names;
    const rates = new Map([["USD",{rate:1}],...available.map(row => [row.quote,row])]);
    return {rates,names:new Map([...rates.keys()].map(code => [code,names.get(code) ?? displayNames.of(code)])),source:"Frankfurter"};
  }

  async function fallback() {
    const xml = await read(ecb,"text");
    const date = xml.match(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/i)?.[1];
    const perEuro = new Map([["EUR",1]]);
    for (const [,code,value] of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"](\d+(?:\.\d+)?)['"]/g)) {
      if (+value > 0 && Number.isFinite(+value)) perEuro.set(code,+value);
    }
    const dollar = perEuro.get("USD");
    if (!date || !dollar || perEuro.size < 2) throw new Error("ECB returned no rates");
    const rates = new Map([...perEuro].map(([code,rate]) => [code,{rate:rate/dollar,date}]));
    const names = new Map([...rates.keys()].map(code => [code,displayNames.of(code)]));
    return {rates,names,source:"European Central Bank"};
  }

  async function latest() {
    try { return await primary(); }
    catch { return fallback(); }
  }
  return {latest};
})();
