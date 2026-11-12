"use strict";

const nftSection = document.getElementById("nfts");
const nftRows = document.getElementById("nft-rows");
const nftStatus = document.getElementById("nft-status");
const nftSearch = document.getElementById("nft-search");
const nftSort = document.getElementById("nft-sort");
const nftRefresh = document.getElementById("nft-refresh");
const nftDialog = document.getElementById("nft-profile");
const nftEndpoint = "https://proxy.cors.dev/https://api-mainnet.magiceden.dev/collection_stats/search/solana?window=7d&limit=100&offset=0&sort=volume&direction=desc";
const nftPageSize = 20;
let nftPage = 0;
const nftPrev = document.getElementById("nft-prev");
const nftNext = document.getElementById("nft-next");
const nftNumbers = new Intl.NumberFormat(undefined,{maximumFractionDigits:4});
const nftDates = new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"});
let nftCollections = [];
let nftLoading = false;
let nftLastAttempt = 0;
let nftActiveId;

function nftSol(value) {
  return Number.isFinite(value) && value > 0 ? nftNumbers.format(value) + " SOL" : "—";
}

function nftMetrics(stats) {
  return [
    ["Floor price",nftSol(stats.floorPrice)],
    ["Listed items",Number.isFinite(stats.listedCount) ? nftNumbers.format(stats.listedCount) : "—"],
    ["7-day transactions",Number.isFinite(stats.transactions7d) ? nftNumbers.format(stats.transactions7d) : "—"],
    ["7-day volume",nftSol(stats.volume7d)]
  ];
}

function nftArtwork(collection, size) {
  const image = document.createElement("img");
  if (collection.image?.startsWith("https://")) image.src = collection.image;
  image.addEventListener("error",() => image.removeAttribute("src"),{once:true});
  image.alt = size > 52 ? collection.imageLabel || collection.name + " collection artwork" : "";
  image.width = size;
  image.height = size;
  image.decoding = "async";
  image.loading = size > 52 ? "eager" : "lazy";
  image.className = "nft-artwork";
  return image;
}

function renderNftProfile(collection) {
  const artwork = document.getElementById("nft-profile-artwork");
  if (artwork.dataset.collection !== collection.id || artwork.dataset.image !== collection.image) {
    artwork.replaceChildren(nftArtwork(collection,180));
    artwork.dataset.collection = collection.id;
    artwork.dataset.image = collection.image ?? "";
  }
  document.getElementById("nft-profile-title").textContent = collection.name;
  document.getElementById("nft-profile-description").textContent = collection.description;
  document.getElementById("nft-profile-time").textContent = "Magic Eden · Fetched " + nftDates.format(new Date(collection.checkedAt));
  document.getElementById("nft-profile-metrics").replaceChildren(...nftMetrics(collection.stats).map(([label,value]) => {
    const entry = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value;
    entry.append(term,detail);
    return entry;
  }));
}

function renderNftCollections() {
  const query = nftSearch.value.trim().toLowerCase();
  const order = nftSort.value;
  const collectionList = nftCollections.filter(collection => (collection.name + " " + collection.id).toLowerCase().includes(query));
  collectionList.sort((a,b) => {
    if (order === "name") return a.name.localeCompare(b.name);
    return (b.stats[order] ?? -1) - (a.stats[order] ?? -1);
  });
  nftPage = Math.min(nftPage,Math.max(0,Math.ceil(collectionList.length/nftPageSize)-1));
  const offset = nftPage*nftPageSize;
  const end = Math.min(offset+nftPageSize,collectionList.length);
  nftPrev.disabled = offset === 0;
  nftNext.disabled = end >= collectionList.length;
  document.getElementById("nft-page").textContent = end ? (offset+1) + "–" + end + " of " + collectionList.length : "0 collections";
  nftRows.replaceChildren(...collectionList.slice(offset,end).map(collection => {
    const row = document.createElement("tr");
    const lead = row.insertCell();
    const open = document.createElement("button");
    open.type = "button";
    open.className = "coin-open";
    open.textContent = collection.name;
    open.setAttribute("aria-haspopup","dialog");
    open.addEventListener("click",() => {
      nftActiveId = collection.id;
      renderNftProfile(collection);
      nftDialog.showModal();
    });
    const chain = document.createElement("small");
    chain.textContent = "Solana";
    const identity = document.createElement("div");
    identity.className = "nft-identity";
    const text = document.createElement("div");
    text.append(open,chain);
    identity.append(nftArtwork(collection,52),text);
    lead.append(identity);
    for (const [,value] of nftMetrics(collection.stats)) row.insertCell().textContent = value;
    row.insertCell().textContent = nftDates.format(new Date(collection.checkedAt));
    return row;
  }));
  document.getElementById("nft-empty").hidden = collectionList.length > 0 || nftCollections.length === 0;
  if (nftDialog.open) {
    const active = nftCollections.find(collection => collection.id === nftActiveId);
    if (active) renderNftProfile(active);
  }
}

async function refreshNfts(force = false) {
  const cooldown = force ? 30000 : 600000;
  if (nftLoading || nftSection.hidden || Date.now()-nftLastAttempt < cooldown) return;
  nftLoading = true;
  nftLastAttempt = Date.now();
  nftRefresh.disabled = true;
  nftStatus.textContent = "Checking Magic Eden for updated collection data…";
  try {
    if (!nftCollections.length) {
      const snapshot = await fetch("./nft-collections.json?v=top-100",{signal:AbortSignal.timeout(8000)});
      if (!snapshot.ok) throw new Error("Snapshot unavailable");
      nftCollections = await snapshot.json();
      renderNftCollections();
    }
    const response = await fetch(nftEndpoint,{signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error("Ranking unavailable");
    const rows = await response.json();
    const checkedAt = new Date().toISOString();
    const existing = new Map(nftCollections.map(collection => [collection.id,collection]));
    const ranked = new Map();
    for (const row of rows) {
      const id = row.collectionSymbol;
      if (typeof id !== "string" || typeof row.name !== "string" || row.currency !== "SOL" || !Number.isFinite(row.vol)) continue;
      ranked.set(id,{
        id,name:row.name,image:row.image || existing.get(id)?.image,
        description:existing.get(id)?.description ?? "",
        stats:{
          floorPrice:row.fpListingCurrency === "SOL" ? row.fp : undefined,
          listedCount:row.listedCount,transactions7d:row.txns,volume7d:row.vol
        },
        checkedAt
      });
    }
    if (ranked.size < 90) throw new Error("Incomplete ranking");
    nftCollections = [...ranked.values()].slice(0,100);
    renderNftCollections();
    nftStatus.textContent = "Ranking fetched from Magic Eden. Checks run every 10 minutes while this tab is open.";
  } catch {
    nftStatus.textContent = nftCollections.length ? "The ranking couldn’t refresh. Showing the last fetched data."
      : "NFT collection data is temporarily unavailable. Try refreshing in a moment.";
  } finally {
    nftLoading = false;
    nftRefresh.disabled = false;
  }
}

for (const filter of [nftSearch,nftSort]) filter.addEventListener("input",() => {
  nftPage = 0;
  renderNftCollections();
});
nftPrev.addEventListener("click",() => { nftPage--; renderNftCollections(); });
nftNext.addEventListener("click",() => { nftPage++; renderNftCollections(); });
nftRefresh.addEventListener("click",() => {
  if (Date.now()-nftLastAttempt < 30000) {
    nftStatus.textContent = "Please wait 30 seconds between refreshes.";
    return;
  }
  refreshNfts(true);
});
new MutationObserver(() => refreshNfts()).observe(nftSection,{attributes:true,attributeFilter:["hidden"]});
document.addEventListener("visibilitychange",() => { if (!document.hidden) refreshNfts(); });
setInterval(() => { if (!document.hidden) refreshNfts(); },600000);
refreshNfts();
