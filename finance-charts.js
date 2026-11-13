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

  function metal(code,days = 30) {
    return load("https://standardbullion.com/api/v1/market/history?" + new URLSearchParams({metal:code,range:({7:"7d",30:"1m",365:"1y"})[days] ?? "1m"}),
      data => data.points.filter(row => Date.parse(row.t) >= Date.now()-days*day).map(row => ({date:row.t,value:row.price})));
  }

  function bitcoin(days = 30) {
    const params = new URLSearchParams({start:date(Date.now()-days*day),interval:"1d"});
    return load("https://api.coinpaprika.com/v1/tickers/btc-bitcoin/historical?" + params,
      rows => rows.map(row => ({date:row.timestamp,value:row.price})));
  }

  return {fx,metal,bitcoin};
})();

function drawFinanceChart(host,points,format,label) {
  const projected = typeof points[0].date === "number";
  const dates = points.map(point => projected ? point.date : Date.parse(point.date));
  const first = points[0];
  const last = points.at(-1);
  const min = points.reduce((value,point) => Math.min(value,point.value),Infinity);
  const max = points.reduce((value,point) => Math.max(value,point.value),-Infinity);
  const elapsed = dates.at(-1)-dates[0] || 1;
  const dateLabel = time => projected ? "Year " + Math.round(time) :
    new Date(time).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
  const x = index => 96+484*(dates[index]-dates[0])/elapsed;
  const y = value => max === min ? 82 : 148-132*(value-min)/(max-min);
  const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 600 180");
  svg.setAttribute("role","img");
  svg.setAttribute("aria-label",label + ". Range " + format(min) + " to " + format(max));
  const add = (tag,attributes,content) => {
    const element = document.createElementNS(svg.namespaceURI,tag);
    for (const [key,value] of Object.entries(attributes)) element.setAttribute(key,value);
    if (content) element.textContent = content;
    svg.append(element);
    return element;
  };
  const ticks = max === min ? [min] : [min,min+(max-min)/3,min+2*(max-min)/3,max];
  for (const value of ticks) {
    const position = y(value);
    add("line",{x1:96,x2:580,y1:position,y2:position,stroke:"currentColor",opacity:".2"});
    add("text",{x:88,y:position+4,"text-anchor":"end","font-size":13,fill:"currentColor"},format(value));
  }
  for (const [index,position,anchor] of [[0,96,"start"],[Math.floor(dates.length/2),338,"middle"],[dates.length-1,580,"end"]]) {
    if (anchor === "middle" && dates.length < 4) continue;
    add("text",{x:anchor === "middle" ? x(index) : position,y:171,"text-anchor":anchor,"font-size":13,fill:"currentColor"},dateLabel(dates[index]));
  }
  add("polyline",{points:points.map((point,index) => x(index)+","+y(point.value)).join(" "),
    fill:"none",stroke:"currentColor","stroke-width":2,"vector-effect":"non-scaling-stroke"});
  const selection = add("circle",{r:4,fill:"currentColor",visibility:"hidden"});
  const caption = document.createElement("p");
  const change = first.value ? " · Change " + new Intl.NumberFormat(undefined,{style:"percent",signDisplay:"exceptZero",maximumFractionDigits:2}).format(last.value/first.value-1) : "";
  caption.textContent = label + " · " + dateLabel(dates[0]) + " " + format(first.value) + " → " +
    dateLabel(dates.at(-1)) + " " + format(last.value) + change +
    " · Low " + format(min) + " · High " + format(max);
  const inspection = document.createElement("small");
  inspection.textContent = "Point at the chart or use the arrow keys to inspect a value.";
  let selected = dates.length-1;
  function inspect(index) {
    selected = index;
    selection.setAttribute("cx",x(index));
    selection.setAttribute("cy",y(points[index].value));
    selection.setAttribute("visibility","visible");
    inspection.textContent = dateLabel(dates[index]) + " · " + format(points[index].value);
  }
  svg.setAttribute("tabindex","0");
  function inspectPointer(event) {
    const box = svg.getBoundingClientRect();
    const scale = Math.min(box.width/600,box.height/180);
    const position = (event.clientX-box.left-(box.width-600*scale)/2)/scale;
    let nearest = 0;
    for (let index=1; index<dates.length; index++) {
      if (Math.abs(x(index)-position) < Math.abs(x(nearest)-position)) nearest = index;
    }
    inspect(nearest);
  }
  svg.addEventListener("pointermove",inspectPointer);
  svg.addEventListener("pointerdown",inspectPointer);
  svg.addEventListener("focus",() => inspect(selected));
  svg.addEventListener("keydown",event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    inspect(Math.max(0,Math.min(dates.length-1,selected+(event.key === "ArrowLeft" ? -1 : 1))));
  });

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "View history (" + points.length + " observations)";
  details.append(summary);
  details.addEventListener("toggle",() => {
    if (!details.open || details.querySelector("table")) return;
    const table = document.createElement("table");
    table.createCaption().textContent = label;
    for (const heading of [projected ? "Year" : "Date / time (UTC)", "Value"]) {
      const header = document.createElement("th");
      header.scope = "col";
      header.textContent = heading;
      (table.tHead?.rows[0] ?? table.createTHead().insertRow()).append(header);
    }
    const body = table.createTBody();
    for (let index=points.length-1; index>=0; index--) {
      const row = body.insertRow();
      row.insertCell().textContent = projected ? dateLabel(dates[index]) : new Date(dates[index]).toISOString().replace("T"," ").slice(0,16);
      row.insertCell().textContent = format(points[index].value);
    }
    const scroll = document.createElement("div");
    scroll.style.maxHeight = "20rem";
    scroll.style.overflow = "auto";
    scroll.append(table);
    details.append(scroll);
  });
  host.replaceChildren(svg,inspection,caption,details);
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
  const currency = ["EUR","DZD"].includes(asset);
  const format = currency ? new Intl.NumberFormat(undefined,{style:"currency",currency:asset,maximumFractionDigits:5}).format : usdFormat.format;
  const label = currency ? asset + " per US dollar" : asset === "BTC" ? "Bitcoin price in USD" : "USD per troy ounce";
  const rangeLabel = document.createElement("label");
  rangeLabel.textContent = "History range ";
  const range = document.createElement("select");
  for (const [days,name] of [[7,"7 days"],[30,"30 days"],[365,"1 year"]]) range.add(new Option(name,days));
  range.value = "30";
  rangeLabel.append(range);
  assetHistory.before(rangeLabel);
  assetHistory.removeAttribute("role");
  const update = mountFinanceHistory(assetHistory,async () => {
    const days = Number(range.value);
    const points = await (asset === "BTC" ? financeHistory.bitcoin(days) :
      currency ? financeHistory.fx("USD",asset,days) : financeHistory.metal(asset,days));
    if (days === 365 && Date.parse(points.at(-1)?.date)-Date.parse(points[0]?.date) < 300*86400000) {
      return {points,format,label:label + " · Partial one-year coverage"};
    }
    return {points,format,label};
  });
  range.addEventListener("change",update);
  update();
}
