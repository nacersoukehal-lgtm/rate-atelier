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

  function seed(snapshot) {
    try {
      snapshot ??= JSON.parse(document.getElementById("published-fx-data")?.textContent || "null");
      if (snapshot?.base !== "USD" || !Array.isArray(snapshot.rates)) return null;
      const rows = snapshot.rates.filter(([code,row]) => /^[A-Z]{3}$/.test(code) &&
        Number.isFinite(row?.rate) && row.rate > 0 && (code === "USD" || /^\d{4}-\d{2}-\d{2}$/.test(row.date)));
      if (!rows.some(([code]) => code !== "USD")) return null;
      const names = new Map(snapshot.names ?? []);
      return {rates:new Map(rows),names:new Map(rows.map(([code]) => [code,names.get(code) || displayNames.of(code)])),
        source:"Published reference rates",published:true};
    } catch { return null; }
  }

  async function published() {
    const embedded = seed();
    if (embedded) return embedded;
    const result = seed(await read("./currency-reference-snapshot.json","json"));
    if (!result) throw new Error("No published reference rates");
    return result;
  }

  async function primary() {
    const [rows,downloadedNames,euro] = await Promise.all([
      read(frankfurter+"rates?base=USD","json"),
      directory ?? read(frankfurter+"currencies","json").then(entries =>
        new Map(entries.filter(entry => entry.type === "currency").map(entry => [entry.iso_code,entry.name]))).catch(() => null),
      read(frankfurter+"providers/ecb/rate/usd/eur","json").catch(() => null)
    ]);
    const names = downloadedNames ?? new Map(rows.filter(row => /^[A-Z]{3}$/.test(row.quote)).map(row => [row.quote,displayNames.of(row.quote)]));
    const available = rows.filter(row => names.has(row.quote) && Number.isFinite(row.rate) && row.rate > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(row.date));
    if (!available.length) throw new Error("Frankfurter returned no rates");
    directory = names;
    const rates = new Map([["USD",{rate:1}],...available.map(row => [row.quote,row])]);
    if (euro?.quote === "EUR" && Number.isFinite(euro.rate) && euro.rate > 0 && /^\d{4}-\d{2}-\d{2}$/.test(euro.date)) {
      rates.set("EUR",{...euro,source:"ECB via Frankfurter"});
    }
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
    catch {
      try { return await fallback(); }
      catch { return published(); }
    }
  }
  return {latest,seed};
})();


