"use strict";

const form = document.getElementById("widget-form");
const amountInput = document.getElementById("widget-amount");
const fromInput = document.getElementById("widget-from");
const toInput = document.getElementById("widget-to");
const result = document.getElementById("widget-result");
const status = document.getElementById("widget-status");
const embed = document.getElementById("widget-embed");
let currencyNames = new Map();
let widgetSource = "";
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
    ? "1 " + from + " = " + rateFormat.format(cross) + " " + to + (from !== to && widgetSource ? " · " + widgetSource : "") + (dates.length ? " · " + dates.join(" / ") : "") + (quoteUnavailable ? " · Saved rates" : "")
    : quoteUnavailable ? "Exchange rates unavailable. Refresh to retry." : widgetSource ? "Rate unavailable for this pair." : "Loading exchange rates…";
}

async function loadWidgetRates() {
  try {
    const {rates,names,source} = await currencyFeed.latest();
    widgetRates = rates;
    widgetSource = source;
    currencyNames = source === "Frankfurter" ? names : new Map([...currencyNames,...names]);
    const codes = [...currencyNames.keys()].sort();
    for (const input of [fromInput,toInput]) {
      const selected = input.value;
      input.replaceChildren(...codes.map(code => new Option(code + " · " + (currencyNames.get(code) ?? code),code)));
      input.value = currencyNames.has(selected) ? selected : input === toInput ? "EUR" : "USD";
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
