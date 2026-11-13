"use strict";

const byId = id => document.getElementById(id);
const write = (id, value) => { byId(id).textContent = value; };
const fxApi = "https://api.frankfurter.dev/v2/rates";
const bullion = "https://standardbullion.com";
const currencyDefaults = {from:"USD",to:"EUR","metal-currency":"USD",send:"USD",receive:"EUR","home-from":"USD","home-to":"EUR"};
let currencyOptions = [["EUR — Euro","EUR"],["USD — United States Dollar","USD"]];
let currencyDirectory = null;
let currentFxSource = '';
let usingSavedRates = false;
const metalCatalog = [
  {code:"XAU",id:"gold",name:"Gold"},
  {code:"XAG",id:"silver",name:"Silver"},
  {code:"XPT",id:"platinum",name:"Platinum"},
  {code:"XPD",id:"palladium",name:"Palladium"},
  {code:"HG",id:"copper",name:"Copper futures"}
];
const preciousMetalCodes = metalCatalog.filter(metal => metal.code !== "HG").map(metal => metal.code);
const metalUnit = code => code === "HG" ? "USD / lb" : "USD / troy oz";
const metalSource = code => code === "HG" ? "Yahoo Finance" : "Standard Bullion";
const metalPrice = (code,price) => code === "HG" ? "USD " + num(price,4) : money(price,"USD");

const ouncesInGrams = 31.1034768;
const rates = new Map([["USD", { rate: 1 }]]);
const unavailable = "Quote unavailable";
const quoteKey = key => "rate-atelier-last-quote:" + key;
function readQuotes(key,fallback) {
  try { return JSON.parse(localStorage.getItem(quoteKey(key))) ?? fallback; }
  catch { return fallback; }
}
function saveQuotes(key,value) {
  try { localStorage.setItem(quoteKey(key),JSON.stringify(value)); } catch {}
}
const metals = new Map(readQuotes("metals",[]).map(([code,quote]) => [code,{...quote,stale:true}]));
let dollarIndex = readQuotes("dollar",null);
if (dollarIndex) dollarIndex.stale = true;
const seriesCache = new Map();
const goldPurities = [["18K", .75], ["24K", 1], ["22K", 22/24], ["21K", 21/24], ["14K", 14/24], ["10K", 10/24], ["9K", 9/24]];
const silverPurities = [["Sterling · 92.5%", .925], ["Fine · 99.9%", .999], ["Coin silver · 90%", .9], ["Pure · 100%", 1]];
let points = [];
let range = "1m";
let chartRequest = 0;
let refreshing = false;

function fillSelect(id, entries, selected) {
  byId(id).replaceChildren(...entries.map(([label, value]) => new Option(label, value)));
  if (selected) byId(id).value = selected;
}
function populateCurrencySelects(converterOnly = false) {
  const query = byId("currency-search").value.trim().toLowerCase();
  const matches = currencyOptions.filter(([label]) => label.toLowerCase().includes(query));
  for (const [id, initial] of Object.entries(currencyDefaults)) {
    const converter = id === "from" || id === "to";
    if (converterOnly && !converter) continue;
    const selected = byId(id).value || initial;
    const entries = converter && query
      ? currencyOptions.filter(entry => entry[1] === selected || matches.includes(entry))
      : currencyOptions;
    fillSelect(id,entries,entries.some(([,code]) => code === selected) ? selected : undefined);
  }
  write("currency-count",query ? matches.length + " matching currencies" :
    currencyDirectory ? currencyOptions.length + " currencies available" : "Loading currency list…");
}
populateCurrencySelects();
byId("currency-search").addEventListener("input",() => populateCurrencySelects(true));

async function refreshRates() {
  try {
    const result = await currencyFeed.latest();
    const saved = readQuotes("fx",null);
    const prior = rates.size > 1 ? new Map(rates) : new Map(saved?.rates ?? []);
    currentFxSource = result.source;
    usingSavedRates = false;
    currencyDirectory = new Map([...(currencyDirectory ?? saved?.names ?? []),...result.names]);
    rates.clear();
    for (const [code,row] of prior) rates.set(code,{...row,stale:true});
    for (const [code,row] of result.rates) rates.set(code,{...row,source:result.source});
    currencyOptions = [...currencyDirectory].sort(([a],[b]) => a.localeCompare(b)).map(([code,name]) => [code+" — "+name,code]);
    saveQuotes("fx",{source:currentFxSource,names:[...currencyDirectory],rates:[...rates]});
    populateCurrencySelects();
    compare();
    return result.source;
  } catch (error) {
    const saved = rates.size <= 1 ? readQuotes("fx",null) : null;
    if (saved) {
      currentFxSource = saved.source;
      currencyDirectory = new Map(saved.names);
      for (const [code,row] of saved.rates) rates.set(code,row);
      currencyOptions = saved.names.sort(([a],[b]) => a.localeCompare(b)).map(([code,name]) => [code+" — "+name,code]);
      populateCurrencySelects();
      compare();
    }
    usingSavedRates = rates.size > 1;
    throw error;
  }
}

function fxRateDetail(from,to) {
  if (from === to) return "";
  const quotes = [from,to].filter(code => code !== "USD").map(code => rates.get(code)).filter(Boolean);
  const sources = [...new Set(quotes.map(row => row.source || currentFxSource))];
  const dates = [...new Set(quotes.map(row => row.date).filter(Boolean))];
  const stale = usingSavedRates || quotes.some(row => row.stale);
  return [...sources,...dates.map(dateOnly),stale ? "Stale · last known rate" : ""].filter(Boolean).join(" · ");
}

const num = (value, digits = 2) => new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value);
const money = (value, currency) => new Intl.NumberFormat(undefined, { style:"currency", currency, currencyDisplay:"code" }).format(value);
const dateOnly = date => new Date(date.slice(0,10) + "T00:00:00Z").toLocaleDateString(undefined, {month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
const timestamp = date => new Date(date).toLocaleString(undefined,{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"});
function quoteDetail(quote,source = "",maxAge = 0) {
  const time = Date.parse(quote?.date);
  const stale = quote?.stale || (maxAge && Number.isFinite(time) && Date.now()-time > maxAge);
  return [stale ? "Stale" : "",source,Number.isFinite(time) ? timestamp(time) : ""].filter(Boolean).join(" · ");
}
const metalDetail = (code,quote) => quoteDetail(quote,metalSource(code),code === "HG" ? 0 : 3600000);
const isPositive = value => Number.isFinite(value) && value > 0;
const input = id => byId(id).valueAsNumber;
const valid = value => Number.isFinite(value) && value >= 0;
const rate = currency => rates.get(currency)?.rate;
const format = (value, currency) => Number.isFinite(value) ? money(value,currency) : "—";

async function json(url,cache = "default") {
  const response = await fetch(url, {cache,signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error("Data feed returned HTTP " + response.status);
  return response.json();
}

const cardDecimals = new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});

function updateQuotes() {
  for (const {id,code} of metalCatalog) {
    const metal = metals.get(code);
    write(id, metal ? metalPrice(code,metal.price) : unavailable);
    write(id + "-time", metal ? metalDetail(code,metal) : metalSource(code));
  }
  const gold = metals.get("XAU");
  const silver = metals.get("XAG");
  write("ratio", gold && silver ? cardDecimals.format(gold.price / silver.price) + "×" : unavailable);
  write("ratio-time",gold && silver ? metalDetail("XAU",{
    date:[gold.date,silver.date].sort()[0],stale:gold.stale || silver.stale
  }) : "Silver ounces per ounce of gold");
  const eur = rates.get("EUR");
  write("usd", eur ? "€" + cardDecimals.format(eur.rate) : unavailable);
  write("usd-time", eur ? fxRateDetail("USD","EUR") : "Reference rate unavailable");
}

function convert() {
  const from = byId("from").value;
  const to = byId("to").value;
  const amount = input("amount");
  const cross = from === to ? 1 : rate(to) / rate(from);
  write("converted", format(valid(amount) ? amount * cross : NaN,to));
  const detail = fxRateDetail(from,to);
  write("fx-detail", isPositive(cross) ? "1 " + from + " = " + num(cross,6) + " " + to + (detail ? " · " + detail : "") : "Rate unavailable for this pair.");
}

function calculateMetal() {
  const quote = metals.get(byId("metal").value);
  const currency = byId("metal-currency").value;
  const weight = input("weight");
  const unit = +byId("weight-unit").value;
  const purity = +byId("purity").value;
  const unitPrice = quote?.price * rate(currency) * unit / ouncesInGrams;
  write("melt", format(valid(weight) ? unitPrice * weight * purity : NaN,currency));
  const unitName = {"1":"g","31.1034768":"troy oz","1000":"kg"}[unit];
  write("metal-detail", isPositive(unitPrice) ? money(unitPrice,currency) + " / " + unitName + " pure · " + metalDetail(byId("metal").value,quote) : "Price or exchange rate unavailable.");
}

function compare() {
  const budget = input("budget");
  const send = byId("send").value;
  const receive = byId("receive").value;
  const amounts = ["a","b"].map(offer => {
    const fee = input("fee-" + offer);
    const quoted = input("rate-" + offer);
    const received = valid(budget) && valid(fee) && fee <= budget && isPositive(quoted) ? (budget - fee) * quoted : NaN;
    write("offer-" + offer,format(received,receive));
    write("effective-" + offer,Number.isFinite(received) && budget > 0 ? "Effective rate: " + num(received/budget,6) + " " + receive + " per " + send : "");
    return received;
  });
  write("offer-units","Fee in " + send + " · Rate in " + receive + " per " + send);
  const [a,b] = amounts;
  let result = "Enter both quoted rates and fees within your budget.";
  if (Number.isFinite(a) && Number.isFinite(b)) {
    const difference = money(Math.abs(a-b),receive);
    const winner = a > b ? "a" : "b";
    const provider = byId("provider-" + winner).value;
    const name = "Offer " + winner.toUpperCase() + (provider ? " (" + provider + ")" : "");
    result = difference === money(0,receive) ? "Both offers deliver the same amount at display precision." : name + " delivers " + difference + " more.";
  }
  write("verdict",result);
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  byId("refresh").disabled = true;
  const snapshot = loadStockSnapshot();
  const results = await Promise.allSettled([
    refreshRates(),
    json(bullion + "/spot-prices.json").then(data => {
      const updated = [];
      for (const symbol of preciousMetalCodes) {
        const item = data.metals.find(entry => entry.symbol === symbol);
        if (isPositive(item?.bid) && isPositive(item.ask) && Number.isFinite(Date.parse(data.updated))) {
          metals.set(symbol,{price:(item.bid + item.ask) / 2,date:data.updated,move:item.changeToday?.percent});
          updated.push(symbol);
        }
      }
      return updated;
    }),
    refreshCopper(),
    refreshDollarIndex()
  ]);
  await snapshot;
  if (results[0].status === "rejected" && !currencyDirectory) write("currency-count","Currency list temporarily unavailable. Try Refresh.");
  const freshMetals = new Set(results[1].status === "fulfilled" ? results[1].value : []);
  if (results[2].status === "fulfilled" && !metals.get("HG")?.stale) freshMetals.add("HG");
  for (const [code,quote] of metals) quote.stale = !freshMetals.has(code);
  if (dollarIndex) dollarIndex.stale = !!dollarIndex.stale || results[3].status === "rejected";
  saveQuotes("metals",[...metals]);
  if (dollarIndex) saveQuotes("dollar",dollarIndex);
  updateQuotes();
  updateMarketSummary();
  document.dispatchEvent(new Event("market-quotes-updated"));
  applyLandingPair();
  convert();
  calculateMetal();
  updateHomeConverter();
  updateWatchQuotes();
  checkPriceAlerts(new Set([results[0].value === "Frankfurter" ? "fx" : "","metal"]),freshMetals);
  byId("refresh").disabled = false;
  refreshing = false;
}

const forexPair = asset => asset === "FX" ? ["USD","EUR"] : asset.startsWith("FX:") ? asset.slice(3).split("/") : null;
const referenceCode = asset => asset.startsWith("REF:") ? asset.slice(4) : "";
let referenceData;
let chartInspection = -1;
let chartPosition;
let referenceRequest;
const marketRangeDays = {"7d":7,"1m":30,"1y":365};

async function loadMetalReferences() {
  if (referenceData) return referenceData;
  if (referenceRequest) return referenceRequest;
  referenceRequest = json("./metal-references.json").then(data => {
    referenceData = data;
    return data;
  });
  try { return await referenceRequest; }
  finally { referenceRequest = null; }
}

function referenceDate(date,cadence) {
  if (cadence === "Annual") return date.slice(0,4);
  if (cadence === "Monthly") return new Date(date+"T00:00:00Z").toLocaleDateString(undefined,{month:"short",year:"numeric",timeZone:"UTC"});
  return dateOnly(date);
}

async function renderMetalReferences() {
  const status = byId("metal-reference-state");
  try {
    const data = await loadMetalReferences();
    const rows = Object.entries(data).map(([code,item]) => {
      const row = document.createElement("tr");
      const [date,price] = item.points.at(-1);
      const lead = row.insertCell();
      const button = document.createElement("button");
      button.type = "button";
      button.className = "coin-open";
      button.textContent = item.name;
      button.addEventListener("click",() => {
        byId("series").value = "REF:" + code;
        loadMarketHistory();
        byId("chart-title").scrollIntoView({block:"center"});
        byId("series").focus({preventScroll:true});
      });
      const grade = document.createElement("small");
      grade.textContent = item.grade;
      lead.append(button,grade);
      row.insertCell().textContent = num(price,2) + " " + item.unit;
      row.insertCell().textContent = referenceDate(date,item.cadence) + " · " + item.cadence.toLowerCase();
      const link = document.createElement("a");
      link.href = item.link;
      link.textContent = item.source;
      row.insertCell().append(link);
      return row;
    });
    byId("metal-reference-rows").replaceChildren(...rows);
    status.hidden = true;
  } catch {
    status.textContent = "Published metal prices are temporarily unavailable.";
  }
}

function marketChartValue(asset,price) {
  const pair = forexPair(asset);
  const benchmark = referenceData?.[referenceCode(asset)];
  if (pair) return num(price,4) + " " + pair[1] + " per " + pair[0];
  if (benchmark) return num(price,2) + " " + benchmark.unit;
  return "$" + num(price,asset === "HG" ? 4 : 2);
}

async function loadMarketHistory(force = false) {
  const request = ++chartRequest;
  const asset = byId("series").value;
  const pair = forexPair(asset);
  const code = referenceCode(asset);
  const benchmark = code ? await loadMetalReferences().catch(() => null).then(data => data?.[code]) : null;
  if (request !== chartRequest) return;
  chartInspection = -1;
  byId("chart-point").hidden = true;
  const disabled = pair || code ? ["24h"] : [];
  if (benchmark?.cadence === "Monthly") disabled.push("7d","1m");
  if (benchmark?.cadence === "Annual") disabled.push("7d","1m","1y");
  if (disabled.includes(range)) range = benchmark?.cadence === "Annual" ? "max" : benchmark?.cadence === "Monthly" ? "1y" : "1m";
  document.querySelectorAll(".period [data-range]").forEach(button => {
    button.disabled = disabled.includes(button.dataset.range);
    button.setAttribute("aria-pressed",String(button.dataset.range === range));
  });
  for (const button of document.querySelectorAll("[data-chart-asset]")) {
    button.setAttribute("aria-pressed",String(button.dataset.chartAsset === asset));
  }
  const selectedRange = range;
  const key = asset + selectedRange;
  const state = byId("chart-state");
  const cached = seriesCache.get(key);
  if (!force || !points.length) {
    state.hidden = false;
    state.textContent = "Loading historical prices…";
    points = [];
    updateChartSummary(asset);
    draw();
  }
  write("chart-source",pair ? "Frankfurter · " + pair[1] + " per " + pair[0] + " · Business-day reference rates"
    : benchmark ? benchmark.source + " · " + benchmark.cadence + " observations · " + benchmark.grade + " · " + benchmark.unit
    : "Data by " + metalSource(asset) + " · " + metalUnit(asset));
  try {
    let next = cached?.points;
    if (!cached || force || Date.now() - cached.saved > 300000) {
      if (pair) {
        const start = range === "max" ? "1999-01-01" : new Date(Date.now() - marketRangeDays[range] * 86400000).toISOString().slice(0,10);
        const params = new URLSearchParams({base:pair[0],quotes:pair[1],from:start});
        if (range === "max") params.set("group","month");
        const rows = await json(fxApi + "?" + params);
        next = rows.map(row => ({date:row.date,price:row.rate}));
      } else if (code) {
        const latest = Date.parse(benchmark.points.at(-1)[0]);
        const cutoff = range === "max" ? -Infinity : latest-marketRangeDays[range]*86400000;
        next = benchmark.points.filter(([date]) => Date.parse(date)>=cutoff).map(([date,price]) => ({date,price}));
      } else if (asset === "HG") {
        next = await copperHistory(range);
      } else {
        const data = await json(bullion + "/api/v1/market/history?metal=" + asset + "&range=" + range);
        next = data.points.map(point => ({date:point.t,price:point.price}));
      }
      next = next.filter(point => isPositive(point.price) && Number.isFinite(Date.parse(point.date)));
      next.sort((a,b) => Date.parse(a.date) - Date.parse(b.date));
      const days = marketRangeDays[selectedRange] ?? (selectedRange === "24h" ? 1 : 0);
      if (days && next.length) {
        const cutoff = Date.parse(next.at(-1).date) - days * 86400000;
        next = next.filter(point => Date.parse(point.date) >= cutoff);
      }
      if (next.length < 2) throw new Error("Insufficient historical data");
      seriesCache.set(key,{points:next,saved:Date.now()});
    }
    if (request !== chartRequest) return;
    points = next;
    state.hidden = true;
  } catch {
    if (request !== chartRequest) return;
    points = cached?.points ?? [];
    state.hidden = !!points.length;
    state.textContent = "Historical prices are temporarily unavailable.";
    if (points.length) byId("chart-source").append(" · Showing saved history");
  }
  updateChartSummary(asset);
  draw();
}

function updateChartSummary(asset) {
  const latest = points.at(-1);
  const first = points[0];
  byId("chart-summary").hidden = !latest;
  if (!latest) return;
  const change = (latest.price / first.price - 1) * 100;
  const badge = byId("chart-change");
  badge.textContent = (change > 0 ? "+" : "") + num(change,2) + "% over range";
  badge.dataset.direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  write("chart-value",marketChartValue(asset,latest.price));
  const cadence = referenceData?.[referenceCode(asset)]?.cadence;
  const label = point => cadence ? referenceDate(point.date,cadence) : chartDate(point.date);
  write("chart-date",label(first) + " – " + label(latest));
}

function draw() {
  const canvas = byId("chart");
  const {width,height} = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale,scale);
  chartPosition = null;
  if (points.length < 2 || width < 100 || height < 100) return;
  const values = points.map(point => point.price);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high-low || high*.01)*.12;
  const left = width < 460 ? 67 : 88;
  const right = width-16;
  const top = 16;
  const bottom = height-34;
  const y = value => bottom - (value - low + pad) / (high - low + 2*pad) * (bottom-top);
  const first = Date.parse(points[0].date);
  const last = Date.parse(points.at(-1).date);
  const x = date => left + (Date.parse(date)-first)/(last-first || 1)*(right-left);
  ctx.font = "11px Arial";
  ctx.fillStyle = "#c3d1c2";
  ctx.strokeStyle = "#3b5549";
  ctx.textAlign = "right";
  for (let index=0; index<4; index++) {
    const price = low-pad + (high-low+2*pad)*index/3;
    const level = y(price);
    ctx.fillText(num(price,high<2 ? 4 : 2),left-8,level+4);
    ctx.beginPath();
    ctx.moveTo(left,level);
    ctx.lineTo(right,level);
    ctx.stroke();
  }
  const labelCount = width < 520 ? 3 : 5;
  for (let tick = 0; tick < labelCount; tick++) {
    const fraction = tick/(labelCount-1);
    const position = left+fraction*(right-left);
    ctx.textAlign = tick === 0 ? "left" : tick === labelCount-1 ? "right" : "center";
    const date = new Date(first+fraction*(last-first));
    const label = date.toLocaleDateString(undefined,last-first > 500*86400000
      ? {year:"numeric",timeZone:"UTC"} : {month:"short",day:"numeric",timeZone:"UTC"});
    ctx.fillText(label,position,height-9);
  }
  const gradient = ctx.createLinearGradient(0,top,0,bottom);
  gradient.addColorStop(0,"#d8b76a55");
  gradient.addColorStop(1,"#d8b76a02");
  ctx.beginPath();
  points.forEach((point,index) => index ? ctx.lineTo(x(point.date),y(point.price)) : ctx.moveTo(x(point.date),y(point.price)));
  ctx.strokeStyle = "#e9ca86";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.lineTo(x(points.at(-1).date),bottom);
  ctx.lineTo(left,bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  chartPosition = {x,left,right,first,last};
  const selected = points[chartInspection];
  if (selected) {
    const cx = x(selected.date), cy = y(selected.price);
    ctx.strokeStyle = "#adc2b6";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx,top);
    ctx.lineTo(cx,bottom);
    ctx.stroke();
    ctx.fillStyle = "#f6d898";
    ctx.beginPath();
    ctx.arc(cx,cy,4,0,Math.PI*2);
    ctx.fill();
  }
  canvas.setAttribute("aria-label","Historical chart from " + dateOnly(points[0].date) + " to " + dateOnly(points.at(-1).date) + ". Range " + num(low,4) + " to " + num(high,4) + ".");
}

function inspectChart(index) {
  if (!chartPosition || !points.length) return;
  chartInspection = Math.max(0,Math.min(index,points.length-1));
  const point = points[chartInspection];
  const asset = byId("series").value;
  const cadence = referenceData?.[referenceCode(asset)]?.cadence;
  const detail = byId("chart-point");
  detail.textContent = (cadence ? referenceDate(point.date,cadence) : chartDate(point.date)) + " · " + marketChartValue(asset,point.price);
  detail.hidden = false;
  draw();
}
function clearChartInspection() {
  if (chartInspection < 0) return;
  chartInspection = -1;
  byId("chart-point").hidden = true;
  draw();
}
byId("chart").addEventListener("pointermove",event => {
  if (!chartPosition) return;
  const {first,last,left,right} = chartPosition;
  const date = first+(last-first)*(event.offsetX-left)/(right-left);
  let low = 0, high = points.length-1;
  while (low < high) {
    const middle = Math.floor((low+high)/2);
    if (date > (Date.parse(points[middle].date)+Date.parse(points[middle+1].date))/2) low = middle+1;
    else high = middle;
  }
  if (chartInspection !== low) inspectChart(low);
});
byId("chart").addEventListener("pointerleave",clearChartInspection);
byId("chart").addEventListener("blur",clearChartInspection);
byId("chart").addEventListener("keydown",event => {
  if (!["ArrowLeft","ArrowRight","Escape"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Escape") clearChartInspection();
  else inspectChart(chartInspection < 0 ? points.length-1 : chartInspection+(event.key === "ArrowLeft" ? -1 : 1));
});
for (const button of document.querySelectorAll("[data-chart-asset]")) {
  button.addEventListener("click",() => {
    byId("series").value = button.dataset.chartAsset;
    loadMarketHistory();
  });
}

function setPurity() {
  const code = byId("metal").value;
  const options = code === "XAU" ? goldPurities : code === "XAG" ? silverPurities :
    [["950 · 95%",.95],["900 · 90%",.9],["999 · 99.9%",.999],["Pure · 100%",1]];
  fillSelect("purity",options);
  calculateMetal();
}

for (const id of ["amount","from","to"]) byId(id).addEventListener("input",convert);
for (const id of ["weight","weight-unit","purity","metal-currency"]) byId(id).addEventListener("input",calculateMetal);
for (const id of ["budget","send","receive","rate-a","rate-b","fee-a","fee-b","provider-a","provider-b"]) byId(id).addEventListener("input",compare);
byId("metal").addEventListener("change",setPurity);
byId("swap").addEventListener("click",() => {
  const from = byId("from");
  const to = byId("to");
  byId("currency-search").value = "";
  populateCurrencySelects(true);
  [from.value,to.value] = [to.value,from.value];
  convert();
});
byId("refresh").addEventListener("click",() => { refresh(); loadMarketHistory(true); });
byId("series").addEventListener("change",() => loadMarketHistory());
document.querySelectorAll("[data-range]").forEach(button => button.addEventListener("click",() => {
  range = button.dataset.range;
  document.querySelectorAll("[data-range]").forEach(other => other.setAttribute("aria-pressed",String(other === button)));
  loadMarketHistory();
}));
new ResizeObserver(draw).observe(byId("chart"));
setPurity();
compare();
queueMicrotask(refresh);
const landingChart = new URLSearchParams(location.search).get("chart");
if (["XAU","XAG"].includes(landingChart)) byId("series").value = landingChart;
loadMarketHistory();
renderMetalReferences();
setInterval(() => { if (!document.hidden) refresh(); },60000);
document.addEventListener("visibilitychange",() => { if (!document.hidden) refresh(); });

let cryptoAssets = [];
let microAssets = [];
let memeAssets = [];
let memeLoading = false;
let memeChecked = 0;
const cryptoStatus = {major:"",micro:"",meme:""};
const staleCrypto = new Set();
const savedCrypto = readQuotes("crypto",null);
if (savedCrypto) {
  cryptoAssets = savedCrypto.major;
  microAssets = savedCrypto.micro;
  staleCrypto.add("major").add("micro");
}
memeAssets = readQuotes("meme",[]);
if (memeAssets.length) staleCrypto.add("meme");
let cryptoQuotes = new Map([...cryptoAssets,...microAssets].map(asset => [asset.id,asset]));
let cryptoPage = 0;
let loadingCrypto = false;
let lastCryptoCheck = 0;
const pageSize = 10;
const compactUSD = new Intl.NumberFormat(undefined,{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2});
const cryptoPrice = new Intl.NumberFormat(undefined,{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:10});

function cryptoRanking() {
  const kind = byId("crypto-ranking").value;
  return kind === "meme" ? memeAssets : kind === "micro" ? microAssets : cryptoAssets;
}

function renderCrypto() {
  const kind = byId("crypto-ranking").value || "major";
  const ranked = cryptoRanking();
  document.dispatchEvent(new Event("crypto-ranking-rendered"));
  const source = byId("crypto-source");
  source.textContent = kind === "meme" ? "CoinGecko" : "CoinPaprika";
  source.href = kind === "meme" ? "https://www.coingecko.com/en/categories/meme-token" : "https://coinpaprika.com/";
  write("crypto-time",cryptoStatus[kind]);
  write("crypto-method",{
    major:"Top 50 cryptocurrencies by market cap. Select an asset for its profile.",
    micro:"Ranked by market cap among coins with $1M to under $10M in market cap and at least $100K in reported 24h volume.",
    meme:"CoinGecko meme category ranked by market cap. The list reflects market size and is for research."
  }[kind]);
  const query = byId("crypto-search").value.trim().toLowerCase();
  const matches = ranked.filter(asset => (asset.name + " " + asset.symbol).toLowerCase().includes(query));
  cryptoPage = Math.min(cryptoPage,Math.max(0,Math.ceil(matches.length / pageSize)-1));
  const start = cryptoPage * pageSize;
  const rows = matches.slice(start,start+pageSize).map(asset => {
    const quote = asset.quotes.USD;
    const change = quote.percent_change_24h;
    const row = document.createElement("tr");
    const cells = [
      String(ranked.indexOf(asset)+1),
      "",
      cryptoPrice.format(quote.price),
      Number.isFinite(change) ? (change > 0 ? "+" : "") + num(change) + "%" : "—",
      compactUSD.format(quote.market_cap),
      valid(quote.volume_24h) ? compactUSD.format(quote.volume_24h) : "—"
    ];
    cells.forEach(value => { row.insertCell().textContent = value; });
    row.cells[3].className = change > 0 ? "positive" : change < 0 ? "negative" : "";
    const link = document.createElement("button");
    link.type = "button";
    link.className = "coin-open";
    link.dataset.coin = asset.id;
    link.setAttribute("aria-haspopup","dialog");
    link.textContent = asset.name;
    link.addEventListener("click",() => openCoinProfile(asset));
    const symbol = document.createElement("small");
    symbol.textContent = asset.symbol;
    row.cells[1].append(link,symbol);
    const detail = document.createElement("small");
    detail.textContent = quoteDetail({date:asset.last_updated,stale:staleCrypto.has(kind)},"",1800000);
    row.cells[2].append(detail);
    return row;
  });
  byId("crypto-rows").replaceChildren(...rows);
  byId("crypto-prev").disabled = cryptoPage === 0;
  byId("crypto-next").disabled = start+pageSize >= matches.length;
  write("crypto-page",matches.length ? (start+1) + "–" + Math.min(start+pageSize,matches.length) + " of " + matches.length : "—");
  const state = byId("crypto-state");
  state.hidden = !!matches.length;
  state.textContent = ranked.length ? "No matching cryptocurrency."
    : cryptoStatus[kind] ? "Quote unavailable. Use Refresh to retry." : "Loading cryptocurrency rankings…";
}

async function refreshCrypto(force = false) {
  if (loadingCrypto || (!force && Date.now() - lastCryptoCheck < 300000)) return;
  loadingCrypto = true;
  lastCryptoCheck = Date.now();
  try {
    const assets = await json("https://api.coinpaprika.com/v1/tickers");
    const ranked = assets.filter(asset => isPositive(asset.quotes?.USD?.price) && isPositive(asset.quotes.USD.market_cap))
      .sort((a,b) => b.quotes.USD.market_cap - a.quotes.USD.market_cap).slice(0,50);
    if (ranked.length < 50) throw new Error("Incomplete crypto rankings");
    cryptoAssets = ranked;
    microAssets = assets.filter(asset => {
      const quote = asset.quotes?.USD;
      return isPositive(quote?.price) && quote.market_cap >= 1000000 &&
        quote.market_cap < 10000000 && quote.volume_24h >= 100000;
    }).sort((a,b) => b.quotes.USD.market_cap-a.quotes.USD.market_cap).slice(0,50);
    cryptoQuotes = new Map(assets.map(asset => [asset.id,asset]));
    staleCrypto.delete("major");
    staleCrypto.delete("micro");
    saveQuotes("crypto",{major:cryptoAssets,micro:microAssets});
    populateWatchPicker();
    updateWatchQuotes();
    checkPriceAlerts(new Set(["crypto"]));
    const newest = Math.max(...ranked.map(asset => Date.parse(asset.last_updated)).filter(Number.isFinite));
    cryptoStatus.major = (Number.isFinite(newest) ? " · Latest quote " + timestamp(newest) : "") + " · Refreshes every 5 min";
    const microTime = Math.max(...microAssets.map(asset => Date.parse(asset.last_updated)).filter(Number.isFinite));
    cryptoStatus.micro = (Number.isFinite(microTime) ? " · Latest quote " + timestamp(microTime) : "") + " · Refreshes every 5 min";
    renderCrypto();
    refreshOpenCoinQuote();
  } catch {
    staleCrypto.add("major").add("micro");
    cryptoStatus.major = cryptoAssets.length ? " · Stale · refresh failed" : " · Quote unavailable";
    cryptoStatus.micro = microAssets.length ? " · Stale · refresh failed" : " · Quote unavailable";
    updateWatchQuotes();
    refreshOpenCoinQuote();
    renderCrypto();
  } finally {
    loadingCrypto = false;
  }
}

byId("crypto-search").addEventListener("input",() => { cryptoPage = 0; renderCrypto(); });
byId("crypto-prev").addEventListener("click",() => { cryptoPage--; renderCrypto(); });
byId("crypto-next").addEventListener("click",() => { cryptoPage++; renderCrypto(); });
byId("refresh").addEventListener("click",() => refreshCrypto(true));
document.addEventListener("visibilitychange",() => { if (!document.hidden) refreshCrypto(); });
setInterval(() => { if (!document.hidden) refreshCrypto(); },300000);
refreshCrypto();

const sectionNav = byId("section-nav");
const sectionTabs = Array.from(sectionNav.querySelectorAll("a[href^='#']"));
const secondarySections = Array.from(byId("secondary-sections").querySelectorAll("a"));
const sectionLinks = [...sectionTabs,...secondarySections];
sectionNav.setAttribute("role","tablist");

function activateTab(tab, updateUrl = false) {
  for (const candidate of sectionLinks) {
    const active = candidate === tab;
    if (sectionTabs.includes(candidate)) {
      candidate.setAttribute("aria-selected",String(active));
      candidate.tabIndex = active || (!sectionTabs.includes(tab) && candidate === sectionTabs[0]) ? 0 : -1;
    } else if (active) candidate.setAttribute("aria-current","location");
    else candidate.removeAttribute("aria-current");
    byId(candidate.hash.slice(1)).hidden = !active;
  }
  if (tab.hash === "#stocks") refreshStocks();
  if (tab.hash === "#calendar") loadCalendar();
  if (tab.hash === "#markets") refreshStocks();
  if (updateUrl && window.location.hash !== tab.hash) {
    window.history.pushState(null,"",tab.hash);
    window.scrollTo(0,0);
  }
}

function syncTabs() {
  activateTab(sectionLinks.find(tab => tab.hash === window.location.hash) ?? sectionTabs[0]);
}

for (const [index, tab] of sectionTabs.entries()) {
  const panel = byId(tab.hash.slice(1));
  tab.id = "tab-" + panel.id;
  tab.setAttribute("role","tab");
  tab.setAttribute("aria-controls",panel.id);
  panel.setAttribute("role","tabpanel");
  panel.setAttribute("aria-labelledby",tab.id);
  panel.tabIndex = 0;
  tab.addEventListener("click",event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    activateTab(tab,true);
  });
  tab.addEventListener("keydown",event => {
    const count = sectionTabs.length;
    const nextIndex = {
      ArrowLeft:(index+count-1)%count,
      ArrowRight:(index+1)%count,
      Home:0,
      End:count-1
    }[event.key];
    if (event.key === " ") {
      event.preventDefault();
      activateTab(tab,true);
    } else if (nextIndex !== undefined) {
      event.preventDefault();
      sectionTabs[nextIndex].focus();
      activateTab(sectionTabs[nextIndex],true);
    }
  });
}
for (const link of secondarySections) {
  link.addEventListener("click",event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    activateTab(link,true);
    const panel = byId(link.hash.slice(1));
    panel.tabIndex = -1;
    panel.focus({preventScroll:true});
  });
}
window.addEventListener("popstate",syncTabs);
window.addEventListener("hashchange",syncTabs);

const watchKey = "rate-atelier-watchlist";
const watchMetals = new Map(metalCatalog.map(({code,name}) => [code,name]));

const watchQuotes = new Map();
let pinned = [];
try {
  const saved = JSON.parse(localStorage.getItem(watchKey) || "[]");
  if (Array.isArray(saved)) pinned = saved.filter(item =>
    item && ["fx","metal","crypto","stock"].includes(item.type) &&
    typeof item.code === "string" && typeof item.label === "string"
  ).slice(0,20);
} catch { /* The watchlist remains usable for this visit. */ }

function exchangeRate(from,to) {
  return from === to ? 1 : rate(to) / rate(from);
}

function updateHomeConverter() {
  const from = byId("home-from").value;
  const to = byId("home-to").value;
  const cross = exchangeRate(from,to);
  const amount = input("home-amount");
  write("home-result",format(valid(amount) ? amount * cross : NaN,to));
  const detail = fxRateDetail(from,to);
  write("home-rate",isPositive(cross) ? "1 " + from + " = " + num(cross,6) + " " + to +
    (detail ? " · " + detail : "") : "Reference rate unavailable.");
  byId("save-pair").disabled = from === to;
}

function populateWatchPicker() {
  const kind = byId("watch-type").value;
  const asset = byId("watch-asset");
  const current = asset.value;
  const choices = kind === "crypto" ? cryptoAssets.map(item => [item.name + " · " + item.symbol,item.id])
    : Array.from(kind === "stock" ? watchStocks : watchMetals, ([code,label]) => [label,code]);
  fillSelect("watch-asset",choices,choices.some(([,code]) => code === current) ? current : undefined);
  byId("save-asset").disabled = !choices.length;
}

function updateWatchQuotes() {
  for (const item of pinned) {
    const quote = watchQuotes.get(item);
    if (!quote) continue;
    if (item.type === "fx") {
      const [from,to] = item.code.split("/");
      const cross = exchangeRate(from,to);
      quote.textContent = isPositive(cross) ? num(cross,6) + " " + to + (fxRateDetail(from,to) ? " · " + fxRateDetail(from,to) : "") : unavailable;
    } else if (item.type === "metal") {
      const data = metals.get(item.code);
      quote.textContent = data ? metalPrice(item.code,data.price) + " · " + metalDetail(item.code,data) : unavailable;
    } else if (item.type === "crypto") {
      const data = cryptoQuotes.get(item.code);
      const price = data?.quotes?.USD?.price;
      quote.textContent = isPositive(price) ? cryptoPrice.format(price) + " · " +
        quoteDetail({date:data.last_updated,stale:staleCrypto.has("major")},"CoinPaprika",1800000) : unavailable;
    } else if (item.type === "stock") {
      const data = stockQuotes.get(item.code);
      quote.textContent = data ? stockValue(data,data.price) + " · " + stockQuoteDetail(data,"Yahoo Finance") : unavailable;
    }
  }
}

function renderWatchlist(message = "") {
  watchQuotes.clear();
  const rows = pinned.map(item => {
    const row = document.createElement("li");
    const label = document.createElement("strong");
    label.textContent = stockAssets.get(item.code)?.name ?? item.label;
    const quote = document.createElement("small");
    quote.textContent = "—";
    watchQuotes.set(item,quote);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label","Remove " + item.label);
    remove.addEventListener("click",() => {
      pinned = pinned.filter(saved => saved !== item);
      saveWatchlist(item.label + " removed.");
    });
    row.append(label,quote,remove,createWatchChart(item));
    return row;
  });
  byId("watch-items").replaceChildren(...rows);
  write("watch-state",message || (pinned.length ? "" : "Save a currency pair above or add an asset to get started."));
  updateWatchQuotes();
  refreshStocks();
  populateAlertAssets();
}

function saveWatchlist(message) {
  try {
    localStorage.setItem(watchKey,JSON.stringify(pinned));
  } catch {
    message += " Browser storage is unavailable. Changes last for this visit.";
  }
  renderWatchlist(message);
}

function pin(item) {
  if (pinned.some(saved => saved.type === item.type && saved.code === item.code)) {
    write("watch-state",item.label + " is already saved.");
    return;
  }
  if (pinned.length >= 20) {
    write("watch-state","Your watchlist holds 20 items. Remove one to make room.");
    return;
  }
  pinned.push(item);
  saveWatchlist(item.label + " saved.");
}

for (const id of ["home-amount","home-from","home-to"]) byId(id).addEventListener("input",updateHomeConverter);
byId("home-swap").addEventListener("click",() => {
  const from = byId("home-from");
  const to = byId("home-to");
  [from.value,to.value] = [to.value,from.value];
  updateHomeConverter();
});
byId("home-compare").addEventListener("click",() => {
  const amount = input("home-amount");
  byId("budget").value = valid(amount) ? amount : "";
  byId("send").value = byId("home-from").value;
  byId("receive").value = byId("home-to").value;
  compare();
});
byId("save-pair").addEventListener("click",() => {
  const from = byId("home-from").value;
  const to = byId("home-to").value;
  if (from !== to) pin({type:"fx",code:from+"/"+to,label:from+" / "+to});
});
byId("watch-type").addEventListener("input",populateWatchPicker);
byId("save-asset").addEventListener("click",() => {
  const type = byId("watch-type").value;
  const select = byId("watch-asset");
  if (select.value) pin({type,code:select.value,label:select.options[select.selectedIndex].textContent});
});


const calendarApi = "https://showmytrades.com/api/public/calendar/v1?impact=high,medium&days=14";
const calendarCurrencies = {
  USD:"United States",EUR:"Euro area",GBP:"United Kingdom",JPY:"Japan",
  AUD:"Australia",NZD:"New Zealand",CAD:"Canada",CHF:"Switzerland",CNY:"China"
};
const calendarDate = new Intl.DateTimeFormat(undefined,{weekday:"short",month:"short",day:"numeric"});
const calendarTime = new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit"});
const calendarFullTime = new Intl.DateTimeFormat(undefined,{
  weekday:"long",month:"long",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"
});
const calendarPageSize = 12;
let calendarEvents = [];
let calendarPage = 0;
let calendarLastFetch = 0;
let calendarLoading = false;
let calendarFailed = false;
let eventOpener;
const eventDialog = byId("calendar-event");

function eventValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "—";
}

const eventTopics = [
  [/central bank|fomc|interest rate|rate decision|monetary policy|cash rate|bank rate|deposit facility/i,
    "Central bank releases report policy decisions or explain how officials are assessing the economy.",
    "Markets compare the decision and accompanying guidance with what was expected. The guidance can matter even when rates stay unchanged."],
  [/producer price|\bppi\b/i,
    "Producer price indices track changes in prices received by producers. The release may report a monthly or annual change.",
    "Producer prices help show whether price pressures are building earlier in the supply chain."],
  [/consumer price|\bcpi\b|inflation|personal consumption expenditure|\bpce\b/i,
    "This release tracks consumer prices, household spending, or expectations about inflation, depending on the named series.",
    "Central banks use inflation and spending data to assess price pressures. Read the period and compare like-for-like figures."],
  [/jobless|unemployment claim|claimant count/i,
    "Claims releases track applications for unemployment benefits or the number of people claiming them, depending on the country.",
    "Claims can show changes in the labor market between broader monthly jobs reports."],
  [/employment|payroll|job openings|\bwages?\b|earnings/i,
    "Labor releases report measures such as employment, unemployment, vacancies, or pay. Each measures a different part of the jobs market.",
    "Markets watch employment and wage trends for clues about household demand and monetary policy."],
  [/gross domestic product|\bgdp\b/i,
    "Gross domestic product measures economic output. GDP growth can be reported monthly, quarterly, annually, or at an annualized rate.",
    "Compare growth figures on the same basis. An annualized quarterly rate is different from a year-over-year change."],
  [/retail sales/i,
    "Retail sales measure spending at retailers. Some releases exclude categories such as vehicles or fuel.",
    "Retail sales help show how household demand is changing, though nominal sales can also rise when prices increase."],
  [/industrial|manufactur|factory|purchasing managers|\bpmi\b/i,
    "This release tracks industrial activity or survey responses from businesses. The title indicates whether it is an output figure or a survey.",
    "These releases help show whether business activity is strengthening or weakening."],
  [/housing|home sales|house price|building permit/i,
    "Housing releases track measures such as home sales, prices, construction, or building approvals.",
    "Housing activity can respond to mortgage rates, household demand, and the supply of homes."],
  [/trade balance|imports|exports/i,
    "Trade releases report goods or services bought from and sold to other economies. The trade balance is exports minus imports.",
    "Changes in trade can reflect shifts in domestic demand, overseas demand, or prices."]
];

function showEconomicEvent(event,opener) {
  eventOpener = opener;
  const region = calendarCurrencies[event.currency] ?? event.currency;
  write("calendar-title",event.title);
  write("event-label",region + " · " + event.currency + " · " + event.impact + " impact");
  write("event-time",calendarFullTime.format(new Date(event.time)));
  const moved = event.status === "moved" && Number.isFinite(Date.parse(event.moved_from));
  const schedule = moved ? "Rescheduled from " + calendarFullTime.format(new Date(event.moved_from)) + "."
    : event.status === "tentative" ? "Release time is tentative." : "";
  write("event-schedule",[schedule,event.period ? "Reporting period " + event.period : ""].filter(Boolean).join(" "));
  const values = [["Actual",event.actual],["Forecast",event.forecast],["Previous",event.previous]];
  byId("event-values").replaceChildren(...values.map(([label,value]) => {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = eventValue(value);
    item.append(term,detail);
    return item;
  }));
  const topic = eventTopics.find(([pattern]) => pattern.test(event.title));
  write("event-about",topic?.[1] ?? "This is a scheduled release or announcement for " + region + ". The calendar feed supplies the event name, timing, and any reported figures.");
  write("event-why",topic?.[2] ?? "");
  eventDialog.showModal();
  eventDialog.scrollTop = 0;
}

function renderCalendar() {
  const query = byId("calendar-search").value.trim().toLowerCase();
  const currency = byId("calendar-currency").value;
  const impact = byId("calendar-impact").value;
  const events = calendarEvents.filter(event =>
    (!currency || event.currency === currency) && (!impact || event.impact === impact) &&
    (!query || (event.title + " " + event.currency + " " + (calendarCurrencies[event.currency] ?? "")).toLowerCase().includes(query)));
  calendarPage = Math.min(calendarPage,Math.max(0,Math.ceil(events.length/calendarPageSize)-1));
  const start = calendarPage * calendarPageSize;
  const rows = events.slice(start,start+calendarPageSize).map(event => {
    const row = document.createElement("tr");
    const time = new Date(event.time);
    const timeCell = row.insertCell();
    const date = document.createElement("strong");
    const clock = document.createElement("small");
    date.textContent = calendarDate.format(time);
    clock.textContent = calendarTime.format(time);
    timeCell.append(date,clock);
    const eventCell = row.insertCell();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "coin-open";
    button.setAttribute("aria-haspopup","dialog");
    button.textContent = event.title;
    button.addEventListener("click",() => showEconomicEvent(event,button));
    const label = document.createElement("small");
    label.className = "calendar-impact";
    label.dataset.impact = event.impact;
    label.textContent = event.currency + " · " + event.impact + " impact";
    eventCell.append(button,label);
    for (const value of [event.actual,event.forecast,event.previous]) row.insertCell().textContent = eventValue(value);
    return row;
  });
  byId("calendar-rows").replaceChildren(...rows);
  byId("calendar-prev").disabled = calendarPage === 0;
  byId("calendar-next").disabled = start+calendarPageSize >= events.length;
  write("calendar-page",events.length ? (start+1) + "–" + Math.min(start+calendarPageSize,events.length) + " of " + events.length : "—");
  const status = byId("calendar-status");
  status.hidden = !!events.length && !calendarFailed;
  status.textContent = calendarFailed ? (calendarEvents.length ? "Refresh failed. Showing previously loaded events." : "Calendar data is temporarily unavailable. Try Refresh.")
    : calendarLoading && !calendarEvents.length ? "Loading economic events…" : "No events match your filters.";
}

async function loadCalendar(force = false) {
  if (calendarLoading || (!force && Date.now() - calendarLastFetch < 900000)) return;
  calendarLoading = true;
  if (!calendarEvents.length) renderCalendar();
  try {
    const data = await json(calendarApi);
    if (!Array.isArray(data.events)) throw new Error("Calendar response has no events");
    calendarEvents = data.events.filter(event => typeof event.title === "string" && Number.isFinite(Date.parse(event.time)))
      .sort((a,b) => Date.parse(a.time)-Date.parse(b.time));
    calendarLastFetch = Date.now();
    calendarFailed = false;
    write("calendar-source","ShowMyTrades · Next 14 days · Checked " + calendarTime.format(new Date()));
  } catch {
    calendarFailed = true;
  } finally {
    calendarLoading = false;
    renderCalendar();
  }
}

fillSelect("calendar-currency",[["All currencies",""],...Object.entries(calendarCurrencies).map(([code,country]) => [code + " · " + country,code])]);
for (const id of ["calendar-search","calendar-currency","calendar-impact"]) {
  byId(id).addEventListener("input",() => { calendarPage = 0; renderCalendar(); });
}
byId("calendar-prev").addEventListener("click",() => { calendarPage--; renderCalendar(); });
byId("calendar-next").addEventListener("click",() => { calendarPage++; renderCalendar(); });
byId("refresh").addEventListener("click",() => { if (!byId("calendar").hidden) loadCalendar(true); });
setInterval(() => { if (!document.hidden && !byId("calendar").hidden) loadCalendar(); },900000);
eventDialog.addEventListener("close",() => {
  (eventOpener?.isConnected ? eventOpener : byId("calendar-search")).focus();
});

const sparkCache = new Map();
async function watchHistory(item) {
  const key = item.type + ":" + item.code;
  const saved = sparkCache.get(key);
  if (saved && Date.now() - saved.time < 300000) return saved.request;
  const request = (async () => {
    const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0,10);
    let data;
    if (item.type === "fx") {
      const [base,quote] = item.code.split("/");
      const rows = await json(fxApi + "?" + new URLSearchParams({base,quotes:quote,from:start}));
      data = rows.map(row => ({date:row.date,price:row.rate}));
    } else if (item.type === "metal" && item.code === "HG") {
      data = await copperHistory("7d");
    } else if (item.type === "metal") {
      const response = await json(bullion + "/api/v1/market/history?range=7d&metal=" + encodeURIComponent(item.code));
      data = response.points.map(row => ({date:row.t,price:row.price}));
    } else {
      const rows = await json("https://api.coinpaprika.com/v1/tickers/" + encodeURIComponent(item.code) + "/historical?start=" + start + "&interval=1d");
      data = rows.map(row => ({date:row.timestamp,price:row.price}));
    }
    return data.filter(point => isPositive(point.price) && Number.isFinite(Date.parse(point.date)))
      .sort((a,b) => Date.parse(a.date)-Date.parse(b.date));
  })();
  sparkCache.set(key,{time:Date.now(),request});
  try { return await request; }
  catch (error) { sparkCache.delete(key); throw error; }
}

function createWatchChart(item) {
  const details = document.createElement("details");
  details.className = "watch-chart";
  const summary = document.createElement("summary");
  summary.textContent = item.type === "stock" ? "Mini chart · 1 month" : "Mini chart · 7 days";
  const panel = document.createElement("div");
  details.append(summary,panel);
  details.addEventListener("toggle",async () => {
    if (!details.open || panel.dataset.loading || panel.dataset.rendered) return;
    panel.dataset.loading = "true";
    panel.textContent = "Loading chart…";
    try {
      const points = item.type === "stock" ? (await fetchStock(item.code)).points : await watchHistory(item);
      if (points.length < 2) throw new Error("Insufficient data");
      const values = points.map(point => point.price);
      const minimum = Math.min(...values);
      const spread = Math.max(...values)-minimum;
      const times = points.map(point => Date.parse(point.date));
      const duration = times.at(-1)-times[0] || 1;
      const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
      svg.setAttribute("viewBox","0 0 200 48");
      svg.setAttribute("role","img");
      svg.setAttribute("aria-label",item.label + " chart from " + dateOnly(points[0].date) + " to " + dateOnly(points.at(-1).date));
      const line = document.createElementNS(svg.namespaceURI,"polyline");
      line.setAttribute("points",values.map((value,index) =>
        (2+196*(times[index]-times[0])/duration) + "," + (spread ? 44-40*(value-minimum)/spread : 24)).join(" "));
      const change = 100 * (values.at(-1)/values[0]-1);
      line.setAttribute("stroke",change < 0 ? "#a03532" : "#185741");
      line.setAttribute("fill","none");
      line.setAttribute("stroke-width","2");
      svg.append(line);
      const caption = document.createElement("small");
      caption.textContent = (change > 0 ? "+" : "") + num(change) + "% · " +
        (item.type === "metal" ? metalSource(item.code) : ({fx:"Frankfurter",crypto:"CoinPaprika",stock:"Yahoo Finance"})[item.type]);
      panel.replaceChildren(svg,caption);
      panel.dataset.rendered = "true";
    } catch {
      panel.textContent = "History unavailable. Reopen to retry.";
    } finally {
      delete panel.dataset.loading;
    }
  });
  return details;
}

const alertKey = "rate-atelier-price-alerts";
let priceAlerts = [];
try {
  const saved = JSON.parse(localStorage.getItem(alertKey) || "[]");
  if (Array.isArray(saved)) priceAlerts = saved.filter(alert =>
    alert && typeof alert.id === "string" && typeof alert.code === "string" &&
    typeof alert.label === "string" && ["fx","metal","crypto"].includes(alert.type) &&
    ["above","below"].includes(alert.direction) && isPositive(alert.target));
} catch { /* Alerts remain usable for this visit. */ }

function saveAlerts() {
  try { localStorage.setItem(alertKey,JSON.stringify(priceAlerts)); return true; }
  catch { return false; }
}

function alertUnit(item) {
  return item.type === "fx" ? item.code.split("/")[1] + " per " + item.code.split("/")[0]
    : item.type === "metal" ? metalUnit(item.code) : "USD";
}

function selectedAlertAsset() {
  return pinned.find(item => item.type + ":" + item.code === byId("alert-asset").value);
}

function updateAlertUnit() {
  const asset = selectedAlertAsset();
  write("alert-unit",asset ? "Target (" + alertUnit(asset) + ")" : "Target price");
}

function populateAlertAssets() {
  const select = byId("alert-asset");
  const available = pinned.filter(item => item.type !== "stock");
  const entries = available.map(item => [item.label,item.type + ":" + item.code]);
  if (!entries.length) entries.push(["Save an eligible asset first",""]);
  fillSelect("alert-asset",entries,entries.some(([,id]) => id === select.value) ? select.value : undefined);
  byId("alert-add").disabled = !available.length;
  byId("alert-target").disabled = !available.length;
  updateAlertUnit();
}

function renderAlerts() {
  byId("alert-items").replaceChildren(...priceAlerts.map(alert => {
    const row = document.createElement("li");
    const label = document.createElement("strong");
    label.textContent = alert.label;
    const detail = document.createElement("small");
    detail.textContent = (alert.reached ? "Reached · " : "Watching · ") + (alert.direction === "above" ? "≥ " : "≤ ") +
      num(alert.target,10) + " " + alertUnit(alert);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label","Remove alert for " + alert.label);
    remove.addEventListener("click",() => {
      priceAlerts = priceAlerts.filter(item => item !== alert);
      saveAlerts();
      renderAlerts();
      write("alert-status","Alert removed.");
    });
    row.append(label,detail,remove);
    return row;
  }));
}

function checkPriceAlerts(updatedTypes,freshMetals = new Set()) {
  const reached = [];
  for (const alert of priceAlerts) {
    if (alert.reached || !updatedTypes.has(alert.type) || (alert.type === "metal" && !freshMetals.has(alert.code))) continue;
    const [base,quote] = alert.code.split("/");
    const current = alert.type === "fx" ? exchangeRate(base,quote)
      : alert.type === "metal" ? metals.get(alert.code)?.price : cryptoQuotes.get(alert.code)?.quotes?.USD?.price;
    if (!isPositive(current)) continue;
    if (alert.direction === "above" ? current < alert.target : current > alert.target) continue;
    alert.reached = true;
    reached.push(alert.label + " reached " + num(current,10) + " " + alertUnit(alert));
  }
  if (!reached.length) return;
  saveAlerts();
  renderAlerts();
  write("alert-status",reached.join(". ") + ".");
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    for (const message of reached) {
      try { new Notification("Rate Atelier price alert",{body:message}); }
      catch { /* In-page alerts remain available. */ }
    }
  }
}

byId("alert-asset").addEventListener("input",updateAlertUnit);
byId("alert-form").addEventListener("submit",event => {
  event.preventDefault();
  const item = selectedAlertAsset();
  const target = input("alert-target");
  if (!item || !isPositive(target)) {
    write("alert-status","Choose a saved asset and enter a target greater than zero.");
    return;
  }
  const direction = byId("alert-direction").value;
  if (priceAlerts.some(alert => !alert.reached && alert.code === item.code && alert.type === item.type && alert.direction === direction && alert.target === target)) {
    write("alert-status","This target is already being watched.");
    return;
  }
  priceAlerts.push({...item,direction,target,id:crypto.randomUUID(),reached:false});
  const saved = saveAlerts();
  byId("alert-target").value = "";
  renderAlerts();
  write("alert-status",saved ? "Alert set. It will check on the next price refresh." : "Alert set for this visit. Browser storage is unavailable.");
});
const notificationButton = byId("alert-notifications");
notificationButton.hidden = typeof Notification === "undefined";
if (!notificationButton.hidden && Notification.permission === "granted") {
  notificationButton.textContent = "Browser notifications enabled";
  notificationButton.disabled = true;
}
notificationButton.addEventListener("click",async () => {
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      notificationButton.textContent = "Browser notifications enabled";
      notificationButton.disabled = true;
    }
    write("alert-status",permission === "granted" ? "Browser notifications enabled." : "In-page alerts are available.");
  } catch { write("alert-status","In-page alerts are available."); }
});



const coinGeckoApi = "https://api.coingecko.com/api/v3";
const coinAliases = new Map([
  ["steth-lido-staked-ether","staked-ether"],["wsteth-wrapped-liquid-staked-ether-20","wrapped-steth"],
  ["wbtc-wrapped-bitcoin","wrapped-bitcoin"],["wbeth-wrapped-beacon-eth","wrapped-beacon-eth"],
  ["cbbtc-coinbase-wrapped-btc","coinbase-wrapped-btc"],["weeth-wrapped-eeth","wrapped-eeth"],
  ["weth-weth","weth"],["susds-susds","susds"],["cc-canton-network","canton-network"],
  ["hbar-hedera-hashgraph","hedera-hashgraph"],["rain-rain-protocol","rain"],["btw-bitway","bitway"]
]);
const profileDialog = byId("coin-profile");
const projectCache = new Map();
const descriptionCache = new Map();
let recordCache;
let openCoin;
let profileRequest = 0;
let openCoinRecords;
let openCoinProject;
let openCoinDescription;
const supplyFormat = new Intl.NumberFormat(undefined,{notation:"compact",maximumFractionDigits:2});
const positiveFormat = (value,formatValue) => isPositive(value) ? formatValue(value) : "—";
const percent = value => Number.isFinite(value) ? (value > 0 ? "+" : "") + num(value) + "%" : "—";
const quoteDate = value => Number.isFinite(Date.parse(value)) ? dateOnly(value) : "";
const coinIdentity = coin => [coin.symbol,coin.name].map(value => value.toLowerCase().replace(/[^a-z0-9]/g,"")).join(":");

async function coinRecords() {
  if (recordCache && Date.now() - recordCache.time < 300000) return recordCache.request;
  const query = coinGeckoApi + "/coins/markets?vs_currency=usd";
  const request = Promise.allSettled([
    json(query + "&per_page=250"),
    json(query + "&ids=" + [...coinAliases.values()].join(","))
  ]).then(results => {
    const rows = results.flatMap(result => result.status === "fulfilled" && Array.isArray(result.value) ? result.value : []);
    if (!rows.length) throw new Error("Records unavailable");
    return {rows,complete:results.every(result => result.status === "fulfilled")};
  });
  recordCache = {time:Date.now(),request};
  try {
    const result = await request;
    if (!result.complete && recordCache?.request === request) recordCache = undefined;
    return result;
  } catch (error) {
    if (recordCache?.request === request) recordCache = undefined;
    throw error;
  }
}

async function coinProject(id) {
  if (!projectCache.has(id)) {
    const request = json("https://api.coinpaprika.com/v1/coins/" + encodeURIComponent(id));
    projectCache.set(id,request);
    request.catch(() => projectCache.delete(id));
  }
  return projectCache.get(id);
}

function refreshOpenCoinQuote() {
  if (!openCoin || !profileDialog.open) return;
  openCoin = openCoin.gecko ? memeAssets.find(asset => asset.id === openCoin.id) ?? openCoin : cryptoQuotes.get(openCoin.id) ?? openCoin;
  const quote = openCoin.quotes.USD;
  write("coin-price",cryptoPrice.format(quote.price));
  write("coin-change",percent(quote.percent_change_24h) + " · 24h");
  byId("coin-change").className = quote.percent_change_24h < 0 ? "negative" : "positive";
  const source = openCoin.gecko ? "CoinGecko" : "CoinPaprika";
  write("coin-quote-time",quoteDetail({date:openCoin.last_updated,stale:staleCrypto.has(openCoin.gecko ? "meme" : "major")},source,1800000));
  renderCoinMetrics();
}

function renderCoinMetrics() {
  const asset = openCoin;
  const quote = asset.quotes.USD;
  const market = openCoinRecords;
  const range = isPositive(market?.low_24h) && isPositive(market?.high_24h) ?
    cryptoPrice.format(market.low_24h) + " – " + cryptoPrice.format(market.high_24h) : "—";
  const metrics = [
    ["Market cap",positiveFormat(quote.market_cap,compactUSD.format)],
    ["24h volume",positiveFormat(quote.volume_24h,compactUSD.format)],
    ["24h low–high",range],
    ["7d change",percent(quote.percent_change_7d)],
    ["30d change",percent(quote.percent_change_30d)],
    ["Circulating supply",positiveFormat(market?.circulating_supply ?? asset.circulating_supply,supplyFormat.format)],
    ["Total supply",positiveFormat(market?.total_supply ?? asset.total_supply,supplyFormat.format)],
    ["Maximum supply",positiveFormat(market?.max_supply ?? asset.max_supply,supplyFormat.format)]
  ];
  byId("coin-metrics").replaceChildren(...metrics.map(([title,value]) => {
    const field = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = title;
    detail.textContent = value;
    field.append(term,detail);
    return field;
  }));
}

function renderCoinRecords() {
  const provider = openCoinRecords;
  const quote = openCoin.quotes.USD;
  const records = [
    ["All-time high",provider?.ath ?? quote.ath_price,provider?.ath_date ?? quote.ath_date],
    ["All-time low",provider?.atl,provider?.atl_date]
  ];
  byId("coin-records").replaceChildren(...records.map(([title,value,date]) => {
    const card = document.createElement("div");
    const label = document.createElement("small");
    const amount = document.createElement("strong");
    const stamp = document.createElement("small");
    label.textContent = title;
    amount.textContent = positiveFormat(value,cryptoPrice.format);
    stamp.textContent = quoteDate(date) || (isPositive(value) ? "Date unavailable" : "Record unavailable");
    card.append(label,amount,stamp);
    return card;
  }));
}

async function supplementalDescription(id) {
  if (!descriptionCache.has(id)) {
    const query = "?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false";
    const request = json(coinGeckoApi + "/coins/" + encodeURIComponent(id) + query).then(data =>
      typeof data.description?.en === "string" ? data.description.en.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim() : ""
    );
    descriptionCache.set(id,request);
    request.catch(() => descriptionCache.delete(id));
  }
  return descriptionCache.get(id);
}

function renderCoinAbout() {
  const project = openCoinProject;
  const raw = (typeof project?.description === "string" ? project.description.trim() : "") || openCoinDescription || "";
  const text = raw.length > 650 ? (raw.slice(0,650).match(/^.+[.!?](?=\s|$)/)?.[0] ?? raw.slice(0,647) + "…") : raw;
  write("coin-description",text || (project ? "A project description is unavailable." : "Loading project description…"));
  const launch = quoteDate(project?.started_at);
  const first = quoteDate(project?.first_data_at ?? openCoin.first_data_at);
  const facts = [launch ? "Project launch · " + launch : "",first ? "First tracked by CoinPaprika · " + first : ""];
  const founder = project?.team?.find(member => typeof member.position === "string" && /^founder$/i.test(member.position));
  if (founder?.name) facts.push("Founder · " + founder.name);
  byId("coin-history").replaceChildren(...facts.filter(Boolean).map(fact => {
    const row = document.createElement("li");
    row.textContent = fact;
    return row;
  }));
  byId("coin-tags").replaceChildren(...(project?.tags ?? []).slice(0,5).map(tag => {
    const badge = document.createElement("span");
    badge.textContent = tag.name;
    return badge;
  }));
}

async function loadCoinProfile(asset) {
  const request = ++profileRequest;
  byId("coin-profile-retry").hidden = true;
  write("coin-profile-status","Loading project and price records…");
  if (asset.gecko) {
    const description = await supplementalDescription(asset.gecko.id).catch(() => "");
    if (request !== profileRequest || !profileDialog.open) return;
    openCoinDescription = description;
    renderCoinAbout();
    if (!description) write("coin-description","A project description is unavailable.");
    write("coin-profile-status","");
    return;
  }
  const [project,records] = await Promise.allSettled([coinProject(asset.id),coinRecords()]);
  if (request !== profileRequest || !profileDialog.open) return;
  if (project.status === "fulfilled") openCoinProject = project.value;
  if (records.status === "fulfilled") {
    const alias = coinAliases.get(asset.id);
    openCoinRecords = records.value.rows.find(row => alias ? row.id === alias : coinIdentity(row) === coinIdentity(asset));
  }
  if (!openCoinProject?.description?.trim() && openCoinRecords?.id) {
    const description = await supplementalDescription(openCoinRecords.id).catch(() => "");
    if (request !== profileRequest || !profileDialog.open) return;
    openCoinDescription = description;
  }
  renderCoinAbout();
  if (!openCoinProject && !openCoinDescription) write("coin-description","Project description is temporarily unavailable.");
  renderCoinRecords();
  renderCoinMetrics();
  const incomplete = !openCoinProject || !openCoinRecords;
  byId("coin-profile-retry").hidden = !incomplete;
  write("coin-profile-status",incomplete ? "Some profile data is unavailable." : "");
}

function openCoinProfile(asset) {
  openCoin = asset;
  openCoinRecords = asset.gecko;
  openCoinProject = undefined;
  openCoinDescription = undefined;
  write("coin-title",asset.name);
  write("coin-symbol",asset.symbol + " · #" + (cryptoRanking().indexOf(asset)+1) + " in this ranking");
  write("coin-credit",asset.gecko ? "Quotes, project data, and price records by CoinGecko." :
    "Market quotes and project data by CoinPaprika. Price records and supplemental metrics by CoinGecko where available.");
  profileDialog.showModal();
  profileDialog.scrollTop = 0;
  refreshOpenCoinQuote();
  renderCoinRecords();
  renderCoinAbout();
  loadCoinProfile(asset);
}

byId("coin-profile-retry").addEventListener("click",() => { if (openCoin) loadCoinProfile(openCoin); });
profileDialog.addEventListener("close",() => {
  profileRequest++;
  if (!openCoin) return;
  const opener = Array.from(byId("crypto-rows").querySelectorAll(".coin-open")).find(button => button.dataset.coin === openCoin.id);
  (opener ?? byId("crypto-search")).focus();
  openCoin = undefined;
});

const stockCatalog = [
  ["NASDAQ:COMP","^IXIC","Nasdaq Composite","Indices","Nasdaq","Tracks a broad range of companies listed on Nasdaq."],
  ["NYSE:NYA","^NYA","NYSE Composite","Indices","NYSE","Tracks common stocks listed on the New York Stock Exchange."],
  ["KRX:KOSPI","^KS11","KOSPI","Indices","Korea Exchange","Broad benchmark for South Korean shares."],
  ["TWSE:TAIEX","^TWII","Taiwan Weighted Index","Indices","Taiwan","Broad benchmark for the Taiwan Stock Exchange."],
  ["NASDAQ:AVGO","AVGO","Broadcom","U.S.","Nasdaq","Designs semiconductors and develops infrastructure software."],
  ["NASDAQ:COST","COST","Costco","U.S.","Nasdaq","Operates membership warehouses and online stores."],
  ["NYSE:GS","GS","Goldman Sachs","U.S.","NYSE","Provides investment banking, trading, and asset management services."],
  ["NYSE:DIS","DIS","Walt Disney","U.S.","NYSE","Operates entertainment, sports media, and theme park businesses."],
  ["LSE:BARC","BARC.L","Barclays","UK","London","Provides retail, corporate, and investment banking services."],
  ["LSE:VOD","VOD.L","Vodafone","UK","London","Provides mobile and fixed telecommunications services."],
  ["TSE:6758","6758.T","Sony Group","Asia","Tokyo","Operates gaming, music, film, electronics, and image sensor businesses."],
  ["HKEX:9988","9988.HK","Alibaba Group","Asia","Hong Kong","Operates e-commerce platforms and cloud services."],
  ["KRX:000660","000660.KS","SK Hynix","Asia","Korea Exchange","Produces memory semiconductors."],
  ["TWSE:2330","2330.TW","TSMC","Asia","Taiwan","Manufactures semiconductors for other chip designers."],
  ["SGX:D05","D05.SI","DBS Group","Asia","Singapore","Provides retail and commercial banking services."],
  ["FOREXCOM:SPXUSD","^GSPC","S&P 500","Indices","United States","Tracks large U.S. companies weighted by their publicly traded market capitalization."],
  ["FOREXCOM:DJI","^DJI","Dow Jones Industrial Average","Indices","United States","A price-weighted index of 30 large U.S. companies."],
  ["FOREXCOM:NSXUSD","^NDX","Nasdaq 100","Indices","Nasdaq","Tracks 100 of the largest non-financial companies listed on Nasdaq."],
  ["FOREXCOM:UKXGBP","^FTSE","FTSE 100","Indices","London","Tracks 100 large companies listed on the London Stock Exchange."],
  ["INDEX:NKY","^N225","Nikkei 225","Indices","Tokyo","A price-weighted benchmark of 225 Japanese stocks."],
  ["INDEX:HSI","^HSI","Hang Seng","Indices","Hong Kong","A benchmark for large and actively traded companies listed in Hong Kong."],
  ["SSE:000001","000001.SS","Shanghai Composite","Indices","Shanghai","A broad index covering shares listed on the Shanghai Stock Exchange."],
  ["BSE:SENSEX","^BSESN","BSE Sensex","Indices","BSE","Tracks 30 major companies listed on India’s BSE."],
  ["NYSE:JPM","JPM","JPMorgan Chase","U.S.","NYSE","A U.S. banking group with consumer, commercial, investment banking, and asset management businesses."],
  ["NYSE:KO","KO","Coca-Cola","U.S.","NYSE","A global beverage company with a portfolio of sparkling drinks, water, juices, and other beverages."],
  ["NYSE:XOM","XOM","Exxon Mobil","U.S.","NYSE","An integrated energy company involved in oil and gas production, refining, and chemicals."],
  ["AMEX:UUUU","UUUU","Energy Fuels","U.S.","NYSE American","Produces uranium and develops rare earth and other critical mineral products."],
  ["AMEX:SPY","SPY","SPDR S&P 500 ETF","U.S.","NYSE Arca","An exchange-traded fund designed to track the S&P 500.","ETF"],
  ["NASDAQ:AAPL","AAPL","Apple","U.S.","Nasdaq","Designs and sells consumer electronics, software, and services."],
  ["NASDAQ:MSFT","MSFT","Microsoft","U.S.","Nasdaq","Develops enterprise and consumer software, cloud services, and hardware."],
  ["NASDAQ:NVDA","NVDA","Nvidia","U.S.","Nasdaq","Designs GPUs and computing platforms used in AI, data centers, and gaming."],
  ["TURQUOISE:SHELL","SHEL.L","Shell","UK","London","An integrated energy company with oil, gas, chemicals, and trading operations."],
  ["TURQUOISE:AZNL","AZN.L","AstraZeneca","UK","London","A pharmaceutical company focused on developing and selling prescription medicines."],
  ["TURQUOISE:HSBAL","HSBA.L","HSBC","UK","London","An international banking and financial services group."],
  ["TURQUOISE:BPL","BP.L","BP","UK","London","An energy company operating across oil, gas, refining, and retail fuels."],
  ["SZSE:002594","002594.SZ","BYD","Asia","Shenzhen","A Chinese manufacturer of electric vehicles, batteries, and electronics."],
  ["BSE:TCS","TCS.BO","Tata Consultancy Services","Asia","BSE","An Indian information technology services and consulting company."],
  ["SSE:600519","600519.SS","Kweichow Moutai","Asia","Shanghai","A Chinese producer of baijiu spirits, including its flagship Moutai."],
  ["BSE:RELIANCE","RELIANCE.BO","Reliance Industries","Asia","BSE","An Indian group with energy, petrochemicals, retail, and telecommunications businesses."],
  ["NYSE:BRK.B","BRK-B","Berkshire Hathaway","U.S.","NYSE","A holding company with insurance, rail, energy, and other businesses."],
  ["NYSE:V","V","Visa","U.S.","NYSE","Operates a global payments network."],
  ["NASDAQ:WMT","WMT","Walmart","U.S.","Nasdaq","Operates retail stores and e-commerce businesses."],
  ["NASDAQ:AMZN","AMZN","Amazon","U.S.","Nasdaq","Operates e-commerce, cloud computing, and advertising businesses."],
  ["NASDAQ:GOOGL","GOOGL","Alphabet","U.S.","Nasdaq","Operates Google Search, YouTube, and Google Cloud."],
  ["NASDAQ:META","META","Meta Platforms","U.S.","Nasdaq","Operates Facebook, Instagram, and WhatsApp."],
  ["NASDAQ:TSLA","TSLA","Tesla","U.S.","Nasdaq","Manufactures electric vehicles and energy storage products."],
  ["AMEX:BTG","BTG","B2Gold","U.S.","NYSE American","Produces gold and develops mining projects."],
  ["LSE:ULVR","ULVR.L","Unilever","UK","London","Makes personal care, home care, and food products."],
  ["LSE:RIO","RIO.L","Rio Tinto","UK","London","Produces iron ore, aluminum, copper, and other minerals."],
  ["TSE:7203","7203.T","Toyota Motor","Asia","Tokyo","Manufactures passenger and commercial vehicles."],
  ["KRX:005930","005930.KS","Samsung Electronics","Asia","Korea Exchange","Makes semiconductors, smartphones, and consumer electronics."],
  ["HKEX:700","0700.HK","Tencent","Asia","Hong Kong","Operates messaging, gaming, and other digital services."],
  ["AMEX:VOO","VOO","Vanguard S&P 500 ETF","U.S.","NYSE Arca","Tracks the S&P 500 Index.","ETF"],
  ["NASDAQ:QQQ","QQQ","Invesco QQQ","U.S.","Nasdaq","Tracks the Nasdaq-100 Index.","ETF"],
  ["AMEX:VTI","VTI","Vanguard Total Stock Market ETF","U.S.","NYSE Arca","Tracks a broad index of U.S. stocks across company sizes.","ETF"],
  ["AMEX:VT","VT","Vanguard Total World Stock ETF","U.S.","NYSE Arca","Tracks developed and emerging market equities worldwide.","ETF"],
  ["AMEX:IWM","IWM","iShares Russell 2000 ETF","U.S.","NYSE Arca","Tracks U.S. small-cap stocks in the Russell 2000 Index.","ETF"],
  ["AMEX:VWO","VWO","Vanguard FTSE Emerging Markets ETF","U.S.","NYSE Arca","Tracks equities in emerging markets.","ETF"],
  ["NASDAQ:BND","BND","Vanguard Total Bond Market ETF","U.S.","Nasdaq","Tracks a broad index of U.S. investment-grade bonds.","ETF"],
  ["NASDAQ:TLT","TLT","iShares 20+ Year Treasury Bond ETF","U.S.","Nasdaq","Tracks U.S. Treasury bonds with more than 20 years to maturity.","ETF"],
  ["AMEX:GLD","GLD","SPDR Gold Shares","U.S.","NYSE Arca","An exchange-traded trust designed to reflect the price of gold bullion.","ETF"],
  ["AMEX:SLV","SLV","iShares Silver Trust","U.S.","NYSE Arca","An exchange-traded trust designed to reflect the price of silver bullion.","ETF"]
].concat(additionalStockListings).map(([code,symbol,name,region,exchange,about = "",type = region === "Indices" ? "Index" : "Stock"]) =>
  ({code,symbol,name,region,exchange,about,type}));
const stockExchanges = [...new Set(stockCatalog.filter(asset => asset.type !== "Index").map(asset => asset.exchange))].sort();
for (const exchange of stockExchanges) byId("stock-exchange").add(new Option(exchange,exchange));
const stockAssets = new Map(stockCatalog.map(asset => [asset.code,asset]));
const watchStocks = new Map(stockCatalog.map(asset => [asset.code,asset.name + " · " + asset.exchange]));
const stockQuotes = new Map(readQuotes("stocks",[]).flatMap(([code,quote]) => {
  const asset = stockAssets.get(code);
  return asset ? [[code,{...quote,asset,points:quote.points ?? [],stale:true}]] : [];
}));
function rememberStock(code,data) {
  const current = stockQuotes.get(code);
  if (current && Date.parse(current.date) > Date.parse(data.date)) {
    return false;
  }
  if (current?.points.length >= 2 &&
      (data.points.length < 2 || Date.parse(data.points[0].date) > Date.parse(current.points[0].date))) {
    data = {...data,points:current.points};
  }
  if (current?.date === data.date) {
    data.high ??= current.high;
    data.low ??= current.low;
  }
  const label = stockQuoteDetail(data);
  data.confirmedClose = label.includes("Latest session close");
  stockQuotes.delete(code);
  stockQuotes.set(code,data);
  saveQuotes("stocks",[...stockQuotes].slice(-80).map(([key,{asset,points,...quote}]) =>
    [key,{...quote,points:recentStockPoints(points)}]));
  return true;
}
function recentStockPoints(points) {
  if (!points?.length) return [];
  const cutoff = Date.parse(points.at(-1).date) - 30 * 86400000;
  return points.filter(point => Date.parse(point.date) >= cutoff);
}
let stockSnapshotRequest;
let stockYearSnapshots = {};
function loadStockSnapshot() {
  stockSnapshotRequest ??= json("./stock-quote-snapshot.json?v=batch-quotes").then(snapshot => {
    const copper = snapshot.benchmarks?.copper;
    const dollar = snapshot.benchmarks?.dollar;
    if (!metals.has("HG") && copper) metals.set("HG",{...copper,stale:true});
    if (dollar && (!dollarIndex || Date.parse(dollar.date) > Date.parse(dollarIndex.date))) dollarIndex = {...dollar,stale:true};
    else if (dollar && dollarIndex?.date === dollar.date && !Number.isFinite(dollarIndex.move)) dollarIndex.move = dollar.move;
    updateQuotes();
    updateMarketSummary();
    stockYearSnapshots = snapshot.yearHistory ?? {};
    for (const [code,quote] of Object.entries(snapshot.quotes)) {
      const asset = stockAssets.get(code);
      const existing = stockQuotes.get(code);
      if (!asset || !isPositive(quote.price) || !Number.isFinite(Date.parse(quote.date))) continue;
      if (existing && Date.parse(existing.date) >= Date.parse(quote.date)) {
        if (existing.points.length < 2) existing.points = quote.points ?? [];
        continue;
      }
      stockQuotes.set(code,{...quote,asset,points:quote.points ?? [],stale:true});
    }
    if (!byId("stocks").hidden) renderStocks();
    updateWatchQuotes();
    if (activeStock && stockDialog.open) renderStockProfile(activeStock);
  }).catch(() => { stockSnapshotRequest = undefined; });
}
const stockCache = new Map();
const stockDialog = byId("stock-profile");
const stockPageSize = 12;
let stockPage = 0;
let stockLoading = false;
const checkingStockQuotes = new Set();
let stockRefreshPending = false;
let stockRefreshForced = false;
let stockRefreshTimer;
const attemptedStockQuotes = new Set();
let activeStock;
let stockChartRequest = 0;

async function yahooChart(symbol,range,interval = "1d",cache = "default",accept = series => !!series?.meta) {
  const params = new URLSearchParams({range,interval});
  if (cache === "no-store") params.set("_",Math.floor(Date.now()/60000));
  const path = "/v8/finance/chart/" + encodeURIComponent(symbol) + "?" + params;
  for (const host of ["query1.finance.yahoo.com","query2.finance.yahoo.com"]) {
    try {
      const data = await json("https://proxy.cors.dev/https://" + host + path,cache);
      const series = data.chart?.result?.[0];
      if (accept(series)) return series;
    } catch { /* Retry through the alternate Yahoo Finance host. */ }
  }
  throw new Error("Market data unavailable");
}

let hostedQuoteRequest;
let hostedQuotes;
let hostedQuotesChecked = 0;
const hostedQuoteMaxAge = 35 * 60000;

async function loadHostedQuotes(force = false) {
  if (hostedQuoteRequest) return hostedQuoteRequest;
  if (!force && hostedQuotes && Date.now()-hostedQuotesChecked < 60000) return hostedQuotes;
  const url = "https://raw.githubusercontent.com/nacersoukehal-lgtm/rate-atelier/main/market-quotes.json";
  hostedQuoteRequest = json(url + "?window=" + Math.floor(Date.now()/60000)).then(data => {
    hostedQuotes = data;
    hostedQuotesChecked = Date.now();
    return data;
  }).catch(() => hostedQuotes ?? {}).finally(() => { hostedQuoteRequest = undefined; });
  return hostedQuoteRequest;
}

function hostedSeries(data,symbol,allowSaved = false) {
  const entry = data[symbol];
  const meta = entry?.series?.meta;
  const age = Date.now()-Date.parse(entry?.verifiedAt);
  if (meta?.symbol !== symbol || !isPositive(meta.regularMarketPrice) || !isPositive(meta.regularMarketTime) ||
      !Number.isFinite(age) || (!allowSaved && age > hostedQuoteMaxAge) || age < -60000) return null;
  return entry.series;
}

async function yahooQuoteBatch(symbols) {
  const params = new URLSearchParams({symbols:symbols.join(","),range:"5d",interval:"1d",_:Math.floor(Date.now()/60000)});
  const path = "/v7/finance/spark?" + params;
  for (const host of ["query1.finance.yahoo.com","query2.finance.yahoo.com"]) {
    try {
      const payload = await json("https://proxy.cors.dev/https://" + host + path,"no-store");
      const rows = payload.spark?.result ?? [];
      const quotes = new Map(rows.map(row => [row.symbol,row.response?.[0]]).filter(([,series]) =>
        isPositive(series?.meta?.regularMarketPrice) && isPositive(series.meta.regularMarketTime)));
      if (quotes.size) return quotes;
    } catch { /* Try the second host, then individual quote requests. */ }
  }
  return new Map();
}

async function refreshCopper() {
  const quote = await fetchBenchmark("HG=F");
  const previous = metals.get("HG");
  if (previous && Date.parse(quote.date) < Date.parse(previous.date)) throw new Error("Older copper quote");
  metals.set("HG",quote);
}

async function copperHistory(range) {
  const {timestamp:times,indicators} = await yahooChart("HG=F",({"24h":"1d","1y":"1y","max":"max"})[range] ?? "1mo",range === "24h" ? "5m" : "1d");
  const closes = indicators?.quote?.[0]?.close ?? [];
  const cutoff = range === "7d" ? Date.now()-7*86400000 : range === "24h" ? Date.now()-86400000 : 0;
  return (times ?? []).map((time,index) => ({date:new Date(time * 1000).toISOString(),price:closes[index]}))
    .filter(point => isPositive(point.price) && Date.parse(point.date) >= cutoff);
}

async function fetchStock(code,range = "1mo",force = false) {
  const asset = stockAssets.get(code);
  if (!asset) throw new Error("Unknown asset");
  const key = code + ":" + range;
  const cached = stockCache.get(key);
  if (cached && !force && Date.now() - cached.time < 120000) return cached.request;
  const request = (async () => {
    const valid = result => {
      const meta = result?.meta;
      if (!isPositive(meta?.regularMarketPrice) || !isPositive(meta.regularMarketTime)) return false;
      if (range !== "1y") return true;
      const closes = result.indicators?.quote?.[0]?.close ?? [];
      const dates = (result.timestamp ?? []).filter((time,index) => isPositive(time) && isPositive(closes[index]));
      return dates.at(-1) - dates[0] >= 330 * 86400;
    };
    const series = await yahooChart(asset.symbol,range,"1d","default",valid)
      .catch(error => {
        if (range !== "1mo") throw error;
        return yahooChart(asset.symbol,"5d","1d","default",valid);
      });
    return parseStockQuote(asset,series);
  })();
  stockCache.set(key,{time:Date.now(),request});
  try { return await request; }
  catch (error) { if (stockCache.get(key)?.request === request) stockCache.delete(key); throw error; }
}

function parseStockQuote(asset,series) {
  const meta = series?.meta;
  const candle = series?.indicators?.quote?.[0];
  if (!isPositive(meta?.regularMarketPrice) || !isPositive(meta.regularMarketTime)) throw new Error("Quote unavailable");
  const rows = (series.timestamp ?? []).map((time,index) => ({
    date:new Date(time * 1000).toISOString(),price:candle?.close?.[index],open:candle?.open?.[index]
  })).filter(point => isPositive(point.price));
  const quoteTime = new Date(meta.regularMarketTime * 1000);
  const day = new Intl.DateTimeFormat("en-CA",{timeZone:meta.exchangeTimezoneName || "UTC",dateStyle:"short"});
  const last = rows.at(-1);
  const sameSession = last && Number.isFinite(+quoteTime) && day.format(new Date(last.date)) === day.format(quoteTime);
  const previous = rows.at(sameSession ? -2 : -1)?.price;
  return {
    asset,checkedAt:Date.now(),sessionStart:meta.currentTradingPeriod?.regular?.start * 1000,
    sessionEnd:meta.currentTradingPeriod?.regular?.end * 1000,price:meta.regularMarketPrice,currency:meta.currency,date:Number.isFinite(+quoteTime) ? quoteTime.toISOString() : "",
    open:sameSession ? last.open : undefined,high:isPositive(meta.regularMarketDayHigh) ? meta.regularMarketDayHigh : undefined,
    low:isPositive(meta.regularMarketDayLow) ? meta.regularMarketDayLow : undefined,previous,
    change:isPositive(previous) ? meta.regularMarketPrice-previous : undefined,
    percent:isPositive(previous) ? (meta.regularMarketPrice/previous-1)*100 : undefined,
    volume:meta.regularMarketVolume,yearHigh:meta.fiftyTwoWeekHigh,yearLow:meta.fiftyTwoWeekLow,points:rows
  };
}

function stockQuoteDetail(data,source = "",checking = false,now = Date.now()) {
  const time = Date.parse(data.date);
  const {sessionStart,sessionEnd} = data;
  const knownSession = Number.isFinite(sessionStart) && sessionEnd > sessionStart;
  const open = knownSession && now >= sessionStart && now < sessionEnd;
  const close = knownSession && (now >= sessionEnd && time >= sessionEnd - 15 * 60000 ||
    now < sessionStart && time < sessionStart && sessionStart - time < 4 * 86400000 &&
    (!data.stale || data.confirmedClose));
  const outdated = open && now - time > 35 * 60000 ||
    knownSession && now >= sessionEnd + 35 * 60000 && !close;
  const label = close ? "Latest session close" : outdated || data.stale ? "Stale" : "";
  const refresh = checking ? "Checking for updates" : data.refreshFailed ? "Refresh unconfirmed" : "";
  return [refresh,checking ? "" : label,quoteDetail({...data,stale:false},source)].filter(Boolean).join(" · ");
}

function stockValue(data,value) {
  if (!Number.isFinite(value)) return "—";
  const amount = new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
  return data.asset.region === "Indices" ? amount : amount + (data.currency ? " " + data.currency : "");
}

function stockHighLow(data,value) {
  return data && isPositive(value) ? stockValue(data,value) : "Unavailable";
}

const priorityAsianSymbols = new Set(["^KS11","^TWII","6758.T"]);

async function improveStockQuote(asset,data,force) {
  const now = Date.now();
  const open = now >= data?.sessionStart && now < data?.sessionEnd;
  const lagging = open && now - Date.parse(data.date) > 10 * 60000;
  const needsRange = asset.symbol === "^NYA" && data && (!data.high || !data.low);
  const priority = priorityAsianSymbols.has(asset.symbol);
  if (!lagging && !needsRange && !(priority && (force || !data || data.stale))) return data;
  const series = await yahooChart(asset.symbol,needsRange ? "5d" : "1d","5m","no-store",
    result => result?.meta?.symbol === asset.symbol && isPositive(result.meta.regularMarketTime));
  const latest = parseStockQuote(asset,series);
  if (!data || Date.parse(latest.date) > Date.parse(data.date)) {
    const move = series.meta.regularMarketChangePercent;
    const previous = Number.isFinite(move) ? latest.price/(1+move/100) : undefined;
    data = {...latest,points:[],open:undefined,previous,
      change:previous ? latest.price-previous : undefined,percent:Number.isFinite(move) ? move : undefined};
  }
  if (!needsRange) return data;
  let {sessionStart,sessionEnd} = data;
  const quoteTime = Date.parse(data.date);
  // The provider can publish the next trading period alongside the prior close.
  if (quoteTime < sessionStart) {
    const dailyStart = Date.parse(data.points.at(-1)?.date);
    const duration = sessionEnd-sessionStart;
    if (!Number.isFinite(dailyStart) || !(duration > 0) ||
        quoteTime < dailyStart+duration || quoteTime > dailyStart+duration+30*60000) return data;
    sessionStart = dailyStart;
    sessionEnd = dailyStart+duration;
  }
  if (!Number.isFinite(sessionStart) || !(sessionEnd > sessionStart) ||
      quoteTime < sessionStart || quoteTime > sessionEnd + 30 * 60000) return data;
  const candle = series.indicators?.quote?.[0];
  const interval = 5 * 60000;
  const cutoff = Math.min(sessionEnd-interval,quoteTime);
  const bars = new Map((series.timestamp ?? []).map((time,index) =>
    [time*1000,[candle?.high?.[index],candle?.low?.[index]]]));
  let high = data.price;
  let low = data.price;
  for (let time = sessionStart; time <= cutoff; time += interval) {
    const [barHigh,barLow] = bars.get(time) ?? [];
    if (!isPositive(barHigh) || !isPositive(barLow) || barHigh < barLow) return data;
    high = Math.max(high,barHigh);
    low = Math.min(low,barLow);
  }
  return {...data,high:data.high ?? high,low:data.low ?? low};
}

async function refreshStocks(force = false) {
  clearTimeout(stockRefreshTimer);
  if (stockLoading) {
    stockRefreshPending = true;
    stockRefreshForced ||= force;
    return;
  }
  const visible = !byId("stocks").hidden;
  const codes = visible ? currentStockPage().map(asset => asset.code)
    : pinned.filter(item => item.type === "stock").map(item => item.code);
  if (!codes.length) {
    if (visible) renderStocks();
    return;
  }
  stockLoading = true;
  for (const code of codes) checkingStockQuotes.add(code);
  loadStockSnapshot();
  if (visible) renderStocks();
  const symbols = codes.map(code => stockAssets.get(code).symbol);
  const hosted = loadHostedQuotes(force);
  const batch = await yahooQuoteBatch(symbols);
  const backup = await hosted;
  for (let offset = 0; offset < codes.length && !stockRefreshPending; offset += 6) {
    await Promise.allSettled(codes.slice(offset,offset+6).map(async code => {
      try {
        const asset = stockAssets.get(code);
        const direct = batch.get(asset.symbol);
        const mirror = hostedSeries(backup,asset.symbol,true);
        const mirrorTime = mirror?.meta.regularMarketTime ?? 0;
        const directTime = direct?.meta.regularMarketTime ?? 0;
        const series = mirrorTime > directTime ? mirror : direct;
        const saved = stockQuotes.get(code);
        const mirrorVerified = !!hostedSeries(backup,asset.symbol);
        let data = series ? parseStockQuote(asset,series) : undefined;
        const live = !!series && (series === direct || mirrorVerified);
        const savedClose = data && stockQuoteDetail(data).startsWith("Latest session close");
        if (data && data.date === saved?.date) data.open ??= saved.open;
        const baseline = saved && (!data || Date.parse(saved.date) > Date.parse(data.date)) ? saved : data;
        const improved = await improveStockQuote(asset,baseline,force).catch(() => baseline);
        if (improved && (!baseline || Date.parse(improved.date) > Date.parse(baseline.date) ||
            live && baseline === data) && rememberStock(code,improved)) return;
        if (baseline === data) data = improved;

        // Keep an older hosted batch available while trying the individual feed.
        if (data) rememberStock(code,{...data,checkedAt:series === mirror ? Date.parse(backup[asset.symbol].verifiedAt) : data.checkedAt,
          stale:!savedClose,confirmedClose:!!savedClose,refreshFailed:true});
        const individual = await fetchStock(code,"1mo",force);
        const enriched = await improveStockQuote(asset,individual,force).catch(() => individual);
        if (!rememberStock(code,enriched)) throw new Error("Older quote");
      }
      catch {
        const previous = stockQuotes.get(code);
        if (previous) {
          const closed = stockQuoteDetail({...previous,refreshFailed:false}).startsWith("Latest session close");
          previous.stale = !closed;
          previous.confirmedClose = closed;
          previous.refreshFailed = true;
        }
      }
      finally { attemptedStockQuotes.add(code); }
    }));
  }
  checkingStockQuotes.clear();
  stockLoading = false;
  if (!byId("stocks").hidden) renderStocks();
  updateWatchQuotes();
  if (activeStock && stockDialog.open) renderStockProfile(activeStock);
  if (stockRefreshPending) {
    const forcePending = stockRefreshForced;
    stockRefreshPending = stockRefreshForced = false;
    refreshStocks(forcePending);
  }
}

function matchesStockFilters(asset) {
  const region = byId("stock-region").value;
  const type = byId("stock-type").value;
  const exchange = byId("stock-exchange").value;
  return (!region || asset.region === region) && (!type || asset.type === type) &&
    (!exchange || asset.exchange === exchange);
}

function matchingStockAssets() {
  const query = byId("stock-search").value.trim().toLowerCase();
  return stockCatalog.filter(asset => matchesStockFilters(asset) &&
    (!query || (asset.name + " " + asset.symbol + " " + asset.exchange).toLowerCase().includes(query)));
}

function currentStockPage(assets = matchingStockAssets()) {
  const start = stockPage * stockPageSize;
  return assets.slice(start,start+stockPageSize);
}

function renderStocks() {
  const visible = matchingStockAssets();
  stockPage = Math.min(stockPage,Math.max(0,Math.ceil(visible.length/stockPageSize)-1));
  const page = currentStockPage(visible);
  const start = stockPage*stockPageSize;
  byId("stock-rows").replaceChildren(...page.map(asset => {
    const row = document.createElement("tr");
    const data = stockQuotes.get(asset.code);
    const lead = row.insertCell();
    const button = document.createElement("button");
    button.className = "coin-open";
    button.type = "button";
    button.setAttribute("aria-haspopup","dialog");
    button.textContent = asset.name;
    button.addEventListener("click",() => openStockProfile(asset));
    const info = document.createElement("small");
    info.textContent = asset.symbol + " · " + asset.exchange + " · " + asset.type;
    lead.append(button,info);
    const values = data ? [stockValue(data,data.price),
      Number.isFinite(data.change) ? (data.change > 0 ? "+" : "") + num(data.change) : "—",percent(data.percent),
      stockValue(data,data.open),stockHighLow(data,data.high),stockHighLow(data,data.low),stockValue(data,data.previous)]
      : [attemptedStockQuotes.has(asset.code) ? unavailable : "Loading quote…","—","—","—","Unavailable","Unavailable","—"];
    values.forEach((value,index) => {
      const cell = row.insertCell();
      cell.textContent = value;
      if (index === 0 && data) {
        const detail = document.createElement("small");
        const checking = checkingStockQuotes.has(asset.code);
        detail.textContent = stockQuoteDetail(data,"",checking);
        cell.append(detail);
      }
      if (index === 1 || index === 2) cell.className = data?.change < 0 ? "negative" : "positive";
    });
    return row;
  }));
  const status = byId("stock-status");
  const missing = page.filter(asset => !stockQuotes.has(asset.code));
  status.textContent = !page.length ? "No assets match your filters."
    : missing.length && (stockLoading || missing.some(asset => !attemptedStockQuotes.has(asset.code))) ? "Loading market quotes…"
    : "";
  status.hidden = !status.textContent;
  document.dispatchEvent(new Event("stock-ranking-rendered"));
  byId("stock-prev").disabled = stockPage === 0;
  byId("stock-next").disabled = start+stockPageSize >= visible.length;
  write("stock-page",visible.length ? (start+1) + "–" + Math.min(start+stockPageSize,visible.length) + " of " + visible.length : "—");
}

function renderStockProfile(asset) {
  const data = stockQuotes.get(asset.code);
  write("stock-price",data ? stockValue(data,data.price) : unavailable);
  write("stock-change",data ? percent(data.percent) + " · session" : "");
  byId("stock-change").className = data?.change < 0 ? "negative" : "positive";
  write("stock-time",data ? stockQuoteDetail(data,"Yahoo Finance",checkingStockQuotes.has(asset.code)) : "Yahoo Finance");
  const fields = [
    ["Open",data?.open],["Day high",data?.high],["Day low",data?.low],["Previous close",data?.previous],
    ["52-week high",data?.yearHigh],["52-week low",data?.yearLow],["Session volume",data?.volume]
  ];
  byId("stock-metrics").replaceChildren(...fields.map(([label,value]) => {
    const block = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = /high|low/.test(label) ? stockHighLow(data,value)
      : data ? (label === "Session volume" ? positiveFormat(value,supplyFormat.format) : stockValue(data,value)) : "—";
    if (asset.symbol === "^NYA" && ["Day high","Day low"].includes(label) && !isPositive(value)) {
      detail.textContent += " · The feed did not provide this value or enough intraday data for this session.";
    }
    block.append(term,detail);
    return block;
  }));
}

function drawStockHistory(host,asset,points,stale = false) {
  const values = points.map(point => point.price);
  const min = Math.min(...values);
  const spread = Math.max(...values)-min;
  const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 500 136");
  svg.setAttribute("role","img");
  svg.setAttribute("aria-label",asset.name + " daily close history");
  const line = document.createElementNS(svg.namespaceURI,"polyline");
  line.setAttribute("points",values.map((value,index) =>
    (5+490*index/(values.length-1)) + "," + (spread ? 130-124*(value-min)/spread : 68)).join(" "));
  line.setAttribute("fill","none");
  line.setAttribute("stroke","#185741");
  line.setAttribute("stroke-width","2");
  svg.append(line);
  const caption = document.createElement("small");
  caption.textContent = dateOnly(points[0].date) + " – " + dateOnly(points.at(-1).date) + " · Daily prices" + (stale ? " · Stale · saved history" : "");
  host.replaceChildren(svg,caption);
}

async function renderStockHistory(requestedRange, notice = "") {
  const asset = activeStock;
  if (!asset) return;
  const request = ++stockChartRequest;
  const control = byId("stock-range");
  const host = byId("stock-profile-chart");
  const active = () => request === stockChartRequest && stockDialog.open;
  const showSavedMonth = () => {
    const points = recentStockPoints(stockQuotes.get(asset.code)?.points);
    if (points.length < 2) return false;
    drawStockHistory(host,asset,points,true);
    return true;
  };

  control.value = "1mo";
  write("stock-range-status",requestedRange === "1y" ? "Checking 1-year history…" : notice);
  if (!showSavedMonth()) host.textContent = "Loading price history…";
  try {
    const data = await fetchStock(asset.code,requestedRange);
    if (!active()) return;
    rememberStock(asset.code,data);
    renderStockProfile(asset);
    if (data.points.length < 2) throw new Error("Insufficient history");
    const span = Date.parse(data.points.at(-1).date) - Date.parse(data.points[0].date);
    if (requestedRange === "1y" && span < 330 * 86400000) throw new Error("Incomplete 1-year history");
    const older = Date.parse(data.date) < Date.parse(stockQuotes.get(asset.code)?.date);
    control.value = requestedRange;
    write("stock-range-status",notice);
    if (!(older && requestedRange === "1mo" && showSavedMonth())) drawStockHistory(host,asset,data.points,older);
  } catch {
    if (!active()) return;
    if (requestedRange === "1y") {
      await loadStockSnapshot();
      if (!active()) return;
      const saved = stockYearSnapshots[asset.code];
      if (saved?.length >= 2) {
        control.value = "1y";
        write("stock-range-status","Saved 1-year history");
        drawStockHistory(host,asset,saved,true);
        return;
      }
      renderStockHistory("1mo","1 year unavailable");
      return;
    }
    await loadStockSnapshot();
    if (!active()) return;
    renderStockProfile(asset);
    if (!showSavedMonth()) host.textContent = "Price history is unavailable.";
  }
}

function openStockProfile(asset) {
  activeStock = asset;
  write("stock-title",asset.name);
  write("stock-symbol",asset.symbol + " · " + asset.exchange);
  write("stock-about",asset.about);
  write("stock-pin-status","");
  byId("stock-range").value = "1mo";
  renderStockProfile(asset);
  stockDialog.showModal();
  stockDialog.scrollTop = 0;
  renderStockHistory("1mo");
}

for (const id of ["stock-search","stock-region","stock-type","stock-exchange"]) byId(id).addEventListener("input",() => {
  stockPage = 0;
  renderStocks();
  clearTimeout(stockRefreshTimer);
  stockRefreshTimer = setTimeout(refreshStocks,250);
});
byId("stock-prev").addEventListener("click",() => {stockPage--;refreshStocks();});
byId("stock-next").addEventListener("click",() => {stockPage++;refreshStocks();});
byId("stock-range").addEventListener("change",event => renderStockHistory(event.target.value));
byId("stock-pin").addEventListener("click",() => {
  const asset = activeStock;
  if (!asset) return;
  pin({type:"stock",code:asset.code,label:asset.name});
  write("stock-pin-status",byId("watch-state").textContent);
});
stockDialog.addEventListener("close",() => {activeStock=undefined; stockChartRequest++;});
byId("refresh").addEventListener("click",() => {
  if (!byId("stocks").hidden || !byId("markets").hidden) refreshStocks(true);
});
function refreshVisibleStocks() {
  if (!document.hidden && (!byId("stocks").hidden || !byId("markets").hidden)) refreshStocks();
}
setInterval(refreshVisibleStocks,120000);
document.addEventListener("visibilitychange",refreshVisibleStocks);

populateWatchPicker();
renderWatchlist();
renderAlerts();
updateHomeConverter();
syncTabs();


function chartDate(date) {
  return range === "24h" ? timestamp(date) : dateOnly(date);
}

async function refreshDollarIndex() {
  const quote = await fetchBenchmark("DX-Y.NYB");
  if (dollarIndex && Date.parse(quote.date) < Date.parse(dollarIndex.date)) throw new Error("Older dollar index quote");
  dollarIndex = quote;
}

async function fetchBenchmark(symbol) {
  const valid = result => isPositive(result?.meta?.regularMarketPrice) && isPositive(result.meta.regularMarketTime);
  const hosted = loadHostedQuotes();
  const batch = await benchmarkBatch();
  const mirror = hostedSeries(await hosted,symbol);
  const direct = batch.get(symbol);
  const latest = (mirror?.meta.regularMarketTime ?? 0) > (direct?.meta.regularMarketTime ?? 0) ? mirror : direct;
  if (latest && Date.now()-latest.meta.regularMarketTime*1000 < hostedQuoteMaxAge) {
    return parseBenchmarkQuote(latest);
  }
  const chart = await yahooChart(symbol,"5d","1d","no-store",valid).catch(() => null);
  const saved = hostedSeries(await hosted,symbol,true);
  const series = [latest,chart,saved].filter(Boolean).sort((a,b) =>
    b.meta.regularMarketTime-a.meta.regularMarketTime)[0];
  if (!series) throw new Error("Benchmark quote unavailable");
  const quote = parseBenchmarkQuote(series);
  const period = series.meta.currentTradingPeriod?.regular;
  const time = Date.parse(quote.date);
  const now = Date.now();
  const closed = now >= period?.end*1000 && time >= period.end*1000-15*60000 ||
    now < period?.start*1000 && time < period.start*1000 && period.start*1000-time < 12*3600000;
  return {...quote,stale:!closed && now-time > hostedQuoteMaxAge};
}

let benchmarkRequest;
function benchmarkBatch() {
  benchmarkRequest ??= yahooQuoteBatch(["HG=F","DX-Y.NYB"]).finally(() => { benchmarkRequest = undefined; });
  return benchmarkRequest;
}

function parseBenchmarkQuote(series) {
  const {meta} = series;
  const session = new Intl.DateTimeFormat("en-CA",{timeZone:meta.exchangeTimezoneName || "UTC",dateStyle:"short"});
  const currentDate = session.format(meta.regularMarketTime * 1000);
  const closes = series.indicators?.quote?.[0]?.close ?? [];
  const previous = (series.timestamp ?? []).map((time,index) => ({time,price:closes[index]}))
    .filter(row => isPositive(row.time) && isPositive(row.price) && session.format(row.time * 1000) < currentDate)
    .sort((a,b) => a.time-b.time).at(-1)?.price;
  const move = Number.isFinite(meta.regularMarketChangePercent) ? meta.regularMarketChangePercent
    : isPositive(previous) ? (meta.regularMarketPrice/previous-1)*100 : undefined;
  return {price:meta.regularMarketPrice,date:new Date(meta.regularMarketTime*1000).toISOString(),move};
}

function formatDollarIndexChange(value) {
  const rounded = Number(value.toFixed(2));
  const display = rounded === 0 ? 0 : rounded;
  return (display > 0 ? "+" : "") + display.toLocaleString(undefined,{
    minimumFractionDigits:2,maximumFractionDigits:2
  }) + "%";
}

function updateMarketSummary() {
  const gold = metals.get("XAU");
  const silver = metals.get("XAG");
  write("gold-purity-quotes",gold ? "24K " + money(gold.price/ouncesInGrams,"USD") + " · 22K " +
    money(gold.price*22/24/ouncesInGrams,"USD") + " · 18K " + money(gold.price*.75/ouncesInGrams,"USD") + " per gram" : "");
  for (const [key,quote,source] of [["gold",gold,"Standard Bullion"],["silver",silver,"Standard Bullion"],["dollar",dollarIndex,"Yahoo Finance"]]) {
    const change = byId("daily-"+key);
    change.textContent = quote ? (key === "dollar" ? num(quote.price,3) + " · " : "") + (Number.isFinite(quote.move) ? (key === "dollar" ? formatDollarIndexChange(quote.move) : percent(quote.move)) : "Daily change unavailable") : unavailable;
    change.className = quote?.move > 0 ? "positive" : quote?.move < 0 ? "negative" : "";
    write("daily-"+key+"-time",quote ? (key === "dollar" ? quoteDetail(quote,source) : metalDetail(key === "gold" ? "XAU" : "XAG",quote)) : source);
  }
}

let landingPairApplied = false;
function applyLandingPair() {
  const params = new URLSearchParams(location.search);
  const pair = params.get("pair");
  if (landingPairApplied || !["EUR","AUD","DZD","EURUSD"].includes(pair) || !rates.has(pair === "EURUSD" ? "EUR" : pair)) return;
  landingPairApplied = true;
  byId("home-from").value = pair === "EURUSD" ? "EUR" : "USD";
  byId("home-to").value = pair === "EURUSD" ? "USD" : pair;
}


async function refreshMemes(force = false) {
  if (byId("crypto-ranking").value !== "meme" || byId("crypto").hidden || memeLoading ||
      (!force && Date.now()-memeChecked < 300000)) return;
  memeLoading = true;
  try {
    const rows = await json(coinGeckoApi + "/coins/markets?vs_currency=usd&category=meme-token&order=market_cap_desc&per_page=50&price_change_percentage=7d,30d&sparkline=true");
    const next = rows.filter(row => isPositive(row.current_price) && isPositive(row.market_cap))
      .sort((a,b) => b.market_cap-a.market_cap).map(row => ({
        id:"gecko:"+row.id,name:row.name,symbol:row.symbol.toUpperCase(),last_updated:row.last_updated,gecko:row,
        quotes:{USD:{price:row.current_price,market_cap:row.market_cap,volume_24h:row.total_volume,
          percent_change_24h:row.price_change_percentage_24h,percent_change_7d:row.price_change_percentage_7d_in_currency,
          percent_change_30d:row.price_change_percentage_30d_in_currency}}
      }));
    if (!next.length) throw new Error("No meme quotes returned");
    memeAssets = next;
    staleCrypto.delete("meme");
    saveQuotes("meme",memeAssets.map(({gecko,...asset}) => ({...asset,gecko:{id:gecko.id}})));
    const newest = Math.max(...memeAssets.map(asset => Date.parse(asset.last_updated)).filter(Number.isFinite));
    cryptoStatus.meme = Number.isFinite(newest) ? " · Latest quote " + timestamp(newest) + " · Refreshes every 5 min"
      : " · No eligible quotes returned.";
    if (openCoin?.gecko && profileDialog.open) refreshOpenCoinQuote();
  } catch {
    staleCrypto.add("meme");
    cryptoStatus.meme = memeAssets.length ? " · Stale · refresh failed" : " · Quote unavailable";
    if (openCoin?.gecko && profileDialog.open) refreshOpenCoinQuote();
  } finally {
    memeChecked = Date.now();
    memeLoading = false;
    renderCrypto();
  }
}

byId("crypto-ranking").addEventListener("change",() => {
  cryptoPage = 0;
  renderCrypto();
  refreshMemes();
});
new MutationObserver(() => refreshMemes()).observe(byId("crypto"),{attributes:true,attributeFilter:["hidden"]});
byId("refresh").addEventListener("click",() => refreshMemes(true));
setInterval(() => { if (!document.hidden) refreshMemes(); },300000);
renderCrypto();
refreshMemes();
