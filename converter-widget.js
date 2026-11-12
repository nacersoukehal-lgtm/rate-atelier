"use strict";

const form = document.getElementById("widget-form");
const amountInput = document.getElementById("widget-amount");
const fromInput = document.getElementById("widget-from");
const toInput = document.getElementById("widget-to");
const result = document.getElementById("widget-result");
const status = document.getElementById("widget-status");
const embed = document.getElementById("widget-embed");
const ratesUrl = "https://api.frankfurter.dev/v2/rates?base=USD";
const currenciesUrl = "https://api.frankfurter.dev/v2/currencies";
let currencyNames;
const rateFormat = new Intl.NumberFormat(undefined,{maximumFractionDigits:6});
let widgetRates = new Map();
let quoteUnavailable = false;

function updateConversion() {
  const from = fromInput.value;
  const to = toInput.value;
  const amount = amountInput.valueAsNumber;
  const cross = from === to ? 1 : widgetRates.get(to)?.rate/widgetRates.get(from)?.rate;
  if (!Number.isFinite(cross) || !Number.isFinite(amount) || amount < 0) {
    result.textContent = "—";
  } else {
    result.textContent = new Intl.NumberFormat(undefined,{style:"currency",currency:to,currencyDisplay:"code"}).format(amount*cross);
  }
  const dates = [...new Set([widgetRates.get(from)?.date,widgetRates.get(to)?.date].filter(Boolean))];
  status.textContent = Number.isFinite(cross)
    ? "1 " + from + " = " + rateFormat.format(cross) + " " + to + " · Frankfurter" + (dates.length ? " · " + dates.join(" / ") : "") + (quoteUnavailable ? " · Saved rates" : "")
    : quoteUnavailable ? "Exchange rates unavailable. Refresh to retry." : "Loading exchange rates…";
}

async function loadWidgetRates() {
  try {
    const read = async url => {
      const response = await fetch(url,{signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error("Rate feed unavailable");
      return response.json();
    };
    const [rows,directory] = await Promise.all([read(ratesUrl),currencyNames ?? read(currenciesUrl).then(entries =>
      new Map(entries.filter(entry => entry.type === "currency").map(entry => [entry.iso_code,entry.name])))]);
    currencyNames = directory;
    const available = rows.filter(row => currencyNames.has(row.quote) && Number.isFinite(row.rate) && row.rate > 0);
    if (!available.length) throw new Error("Rate feed returned no currencies");
    widgetRates = new Map([["USD",{rate:1}],...available.map(row => [row.quote,row])]);
    const codes = [...widgetRates.keys()].sort();
    for (const input of [fromInput,toInput]) {
      const selected = input.value;
      input.replaceChildren(...codes.map(code => new Option(code + " · " + (currencyNames.get(code) ?? code),code)));
      input.value = widgetRates.has(selected) ? selected : "USD";
    }
    quoteUnavailable = false;
  } catch {
    quoteUnavailable = true;
  }
  updateConversion();
}

form.addEventListener("submit",event => event.preventDefault());
form.addEventListener("input",updateConversion);
document.getElementById("widget-swap").addEventListener("click",() => {
  if (!widgetRates.size) return;
  [fromInput.value,toInput.value] = [toInput.value,fromInput.value];
  updateConversion();
});
embed.hidden = new URLSearchParams(location.search).get("embed") === "1";
const url = new URL(location.pathname,location.origin);
url.searchParams.set("embed","1");
document.getElementById("widget-code").value = '<iframe title="Rate Atelier currency converter" src="' + url.href + '" width="380" height="390" loading="lazy" style="max-width:100%;border:0"></iframe>';
loadWidgetRates();
setInterval(() => { if (!document.hidden) loadWidgetRates(); },300000);
