"use strict";

const financeHistory = (() => {
  const cache = new Map();
  const day = 86400000;
  const date = time => new Date(time).toISOString().slice(0,10);

  function load(url, parse) {
    const saved = cache.get(url);
    if (saved && Date.now() - saved.time < 300000) return saved.request;
    const request = fetch(url,{signal:AbortSignal.timeout(10000)}).then(async response => {
      if (!response.ok) throw new Error("History unavailable");
      const rows = parse(await response.json());
      return rows.filter(row => Number.isFinite(Date.parse(row.date)) && row.value > 0 && Number.isFinite(row.value))
        .sort((a,b) => Date.parse(a.date)-Date.parse(b.date));
    });
    cache.set(url,{time:Date.now(),request});
    request.catch(() => { if (cache.get(url)?.request === request) cache.delete(url); });
    return request;
  }

  function fx(from,to,days = 30) {
    if (from === to) return Promise.resolve([{date:date(Date.now()-days*day),value:1},{date:date(Date.now()),value:1}]);
    const params = new URLSearchParams({base:from,quotes:to,from:date(Date.now()-days*day)});
    return load("https://api.frankfurter.dev/v2/rates?" + params,
      rows => rows.map(row => ({date:row.date,value:row.rate})));
  }

  function metal(code) {
    return load("https://standardbullion.com/api/v1/market/history?" + new URLSearchParams({metal:code,range:"1m"}),
      data => data.points.filter(row => row.t >= date(Date.now()-30*day)).map(row => ({date:row.t,value:row.price})));
  }

  function bitcoin() {
    const params = new URLSearchParams({start:date(Date.now()-30*day),interval:"1d"});
    return load("https://api.coinpaprika.com/v1/tickers/btc-bitcoin/historical?" + params,
      rows => rows.map(row => ({date:row.timestamp,value:row.price})));
  }

  return {fx,metal,bitcoin};
})();

function drawFinanceChart(host,points,format,label) {
  const dates = points.map(point => typeof point.date === "number" ? point.date : Date.parse(point.date));
  const values = points.map(point => point.value);
  const first = points[0];
  const last = points.at(-1);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const elapsed = dates.at(-1)-dates[0] || 1;
  const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 500 128");
  svg.setAttribute("role","img");
  svg.setAttribute("aria-label",label + ". Range " + format(min) + " to " + format(max));
  const line = document.createElementNS(svg.namespaceURI,"polyline");
  line.setAttribute("points",points.map((point,index) =>
    (6+488*(dates[index]-dates[0])/elapsed) + "," + (max === min ? 64 : 120-112*(point.value-min)/(max-min))).join(" "));
  line.setAttribute("fill","none");
  line.setAttribute("stroke","currentColor");
  line.setAttribute("stroke-width","2");
  line.setAttribute("vector-effect","non-scaling-stroke");
  svg.append(line);
  const caption = document.createElement("small");
  const dateLabel = point => typeof point.date === "number" ? "Year " + point.date
    : new Date(point.date).toLocaleDateString(undefined,{month:"short",day:"numeric",timeZone:"UTC"});
  caption.textContent = dateLabel(first) + " · " + format(first.value) + " → " + dateLabel(last) + " · " + format(last.value);
  host.replaceChildren(svg,caption);
}

function mountFinanceHistory(host,read) {
  let revision = 0;
  return async () => {
    const request = ++revision;
    host.textContent = "Loading history…";
    try {
      const {points,format,label} = await read();
      if (request !== revision) return;
      if (points.length < 2) throw new Error("Insufficient history");
      drawFinanceChart(host,points,format,label);
    } catch {
      if (request === revision) host.textContent = "History is unavailable for this selection.";
    }
  };
}

const assetHistory = document.querySelector("[data-asset-history]");
if (assetHistory) {
  const asset = assetHistory.dataset.assetHistory;
  const usdFormat = new Intl.NumberFormat(undefined,{style:"currency",currency:"USD"});
  mountFinanceHistory(assetHistory,async () => ({
    points:await (asset === "BTC" ? financeHistory.bitcoin() : ["EUR","DZD"].includes(asset) ? financeHistory.fx("USD",asset) : financeHistory.metal(asset)),
    format:["EUR","DZD"].includes(asset) ? new Intl.NumberFormat(undefined,{style:"currency",currency:asset,maximumFractionDigits:4}).format : usdFormat.format,
    label:["EUR","DZD"].includes(asset) ? asset + " per US dollar" : asset === "BTC" ? "Bitcoin price in USD" : "USD per troy ounce"
  }))();
}
