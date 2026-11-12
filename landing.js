"use strict";
const quoteOutput = document.getElementById("landing-quote");
const sourceOutput = document.getElementById("landing-source");
const asset = quoteOutput.dataset.asset;
const decimal = (value,digits) => new Intl.NumberFormat(undefined,{maximumFractionDigits:digits}).format(value);
const usd = new Intl.NumberFormat(undefined,{style:"currency",currency:"USD"});

async function updateLandingQuote() {
  try {
    const isCurrency = ["EUR","AUD"].includes(asset);
    const endpoint = isCurrency ? "https://api.frankfurter.dev/v2/rate/USD/" + asset
      : "https://standardbullion.com/spot-prices.json";
    const response = await fetch(endpoint,{signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error("Feed unavailable");
    const data = await response.json();
    if (isCurrency) {
      if (!(data.rate > 0)) throw new Error("Rate unavailable");
      quoteOutput.textContent = "1 USD = " + decimal(data.rate,6) + " " + asset;
      sourceOutput.textContent = "Frankfurter · Reference rate dated " + data.date;
      return;
    }
    const spot = code => {
      const metal = data.metals.find(item => item.symbol === code);
      return metal?.ask > 0 && metal.bid > 0 ? (metal.ask+metal.bid)/2 : NaN;
    };
    const price = asset === "ratio" ? spot("XAU")/spot("XAG") : spot(asset);
    if (!Number.isFinite(price)) throw new Error("Price unavailable");
    quoteOutput.textContent = asset === "ratio" ? decimal(price,2) + " ounces of silver per ounce of gold"
      : usd.format(price) + " per troy oz · " + usd.format(price/31.1034768) + " per gram";
    sourceOutput.textContent = "Data by Standard Bullion · " + new Date(data.updated).toLocaleString();
  } catch {
    sourceOutput.textContent = "The latest quote could not be loaded.";
    if (quoteOutput.textContent.startsWith("Loading")) quoteOutput.textContent = "Quote temporarily unavailable";
  }
}
try { document.documentElement.dataset.theme = localStorage.getItem("rate-atelier-theme") ?? ""; } catch {}
updateLandingQuote();
setInterval(() => { if (!document.hidden) updateLandingQuote(); },60000);
