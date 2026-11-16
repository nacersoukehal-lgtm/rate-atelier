export const pages = {
  "gold-price-today.html": "XAU",
  "silver-price-today.html": "XAG",
  "usd-to-eur.html": "EUR",
  "eur-to-usd.html": "EURUSD",
  "usd-to-aud.html": "AUD",
  "usd-to-dzd.html": "DZD"
};

const usd = new Intl.NumberFormat("en-US", {style:"currency", currency:"USD"});
const decimal = new Intl.NumberFormat("en-US", {maximumFractionDigits:6});
const valid = row => Number.isFinite(row?.value) && row.value > 0 && Number.isFinite(Date.parse(row.date));

export function metalQuotes(data) {
  return Object.fromEntries(["XAU","XAG"].map(code => {
    const metal = data.metals?.find(row => row.symbol === code);
    const value = metal?.bid > 0 && metal?.ask > 0 ? (metal.bid + metal.ask) / 2 : NaN;
    return [code,{value,date:data.updated}];
  }));
}

export function fxQuotes(rows) {
  return Object.fromEntries(rows.map(({base,quote,rate,date}) => [
    base === "EUR" ? "EURUSD" : quote,{base,quote,value:rate,date}
  ]));
}

function replaceContent(html,id,content) {
  const pattern = new RegExp('(<[\\w-]+\\b[^>]*\\bid="' + id + '"[^>]*>)[\\s\\S]*?(</[\\w-]+>)');
  if (!pattern.test(html)) throw new Error("Missing element " + id);
  return html.replace(pattern,(_,open,close) => open + content + close);
}

function detail(row) {
  if (row.base) return "Published snapshot · Frankfurter · " + row.date;
  return "Published snapshot · Standard Bullion · " + new Date(row.date).toISOString().slice(0,16).replace("T"," ") + " UTC";
}

export function renderSnapshot(html,file,quotes) {
  if (file === "index.html") {
    for (const [code,id] of [["XAU","gold"],["XAG","silver"],["EUR","usd"]]) {
      const row = quotes[code];
      if (!valid(row)) continue;
      html = replaceContent(html,id,code === "EUR" ? "€" + row.value.toFixed(2) : usd.format(row.value));
      html = replaceContent(html,id+"-time",detail(row));
    }
    return html;
  }
  const row = quotes[pages[file]];
  if (!valid(row)) return html;
  const price = row.base ? "1 " + row.base + " = " + decimal.format(row.value) + " " + row.quote
    : usd.format(row.value) + " per troy oz · " + usd.format(row.value/31.1034768) + " per gram";
  html = replaceContent(html,"landing-quote",price);
  html = replaceContent(html,"landing-source",detail(row));
  html = html.replace(/(<[^>]*\bid="landing-quote"[^>]*?)>/,(_,tag) =>
    tag.replace(/ data-snapshot-(?:date|rate)="[^"]*"/g,"") +
    ' data-snapshot-date="' + new Date(row.date).toISOString() + '"' +
    (row.base ? ' data-snapshot-rate="' + row.value + '"' : "") + ">");
  const amount = html.match(/id="landing-amount"[^>]*\bvalue="([^"]+)"/);
  if (amount && row.base) {
    const currency = new Intl.NumberFormat("en-US",{style:"currency",currency:row.quote});
    html = replaceContent(html,"landing-result",currency.format(Number(amount[1])*row.value));
  }
  return html;
}
