"use strict";

const nftSection = document.getElementById("nfts");
const nftRows = document.getElementById("nft-rows");
const nftStatus = document.getElementById("nft-status");
const nftSearch = document.getElementById("nft-search");
const nftSort = document.getElementById("nft-sort");
const nftRefresh = document.getElementById("nft-refresh");
const nftDialog = document.getElementById("nft-profile");
const nftEndpoint = "https://proxy.cors.dev/https://api-mainnet.magiceden.dev/v2/collections/";
const nftNumbers = new Intl.NumberFormat(undefined,{maximumFractionDigits:4});
const nftDates = new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"});
let nftCollections = [];
let nftLoading = false;
let nftLastAttempt = 0;
let nftActiveId;

function nftSol(value) {
  return Number.isFinite(value) && value > 0 ? nftNumbers.format(value/1e9) + " SOL" : "—";
}

function nftMetrics(stats) {
  return [
    ["Floor price",nftSol(stats.floorPrice)],
    ["Listed items",Number.isFinite(stats.listedCount) ? nftNumbers.format(stats.listedCount) : "—"],
    ["24h average sale",nftSol(stats.avgPrice24hr)],
    ["7-day volume",nftSol(stats.volume7d)]
  ];
}

function nftArtwork(collection, size) {
  const image = document.createElement("img");
  image.src = collection.image;
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
  if (artwork.dataset.collection !== collection.id) {
    artwork.replaceChildren(nftArtwork(collection,180));
    artwork.dataset.collection = collection.id;
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
  const collectionList = nftCollections.filter(collection => collection.name.toLowerCase().includes(query));
  collectionList.sort((a,b) => {
    if (order === "name") return a.name.localeCompare(b.name);
    return (b.stats[order] ?? -1) - (a.stats[order] ?? -1);
  });
  nftRows.replaceChildren(...collectionList.map(collection => {
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
      const snapshot = await fetch("./nft-collections.json?v=artwork",{signal:AbortSignal.timeout(8000)});
      if (!snapshot.ok) throw new Error("Snapshot unavailable");
      nftCollections = await snapshot.json();
      renderNftCollections();
    }
    let updated = 0;
    for (let start = 0; start < nftCollections.length; start += 4) {
      await Promise.allSettled(nftCollections.slice(start,start+4).map(async collection => {
        const response = await fetch(nftEndpoint + encodeURIComponent(collection.id) + "/stats",{signal:AbortSignal.timeout(8000)});
        if (!response.ok) throw new Error("Quote unavailable");
        const stats = await response.json();
        if (stats.symbol !== collection.id || !Number.isFinite(stats.listedCount)) throw new Error("Invalid quote");
        collection.stats = stats;
        collection.checkedAt = new Date().toISOString();
        updated++;
      }));
    }
    renderNftCollections();
    nftStatus.textContent = updated === nftCollections.length ? "Collection data fetched from Magic Eden. Checks run every 10 minutes while this tab is open."
      : updated ? "Some quotes couldn’t refresh. Their last fetched values are shown."
      : "The feed couldn’t refresh. Showing saved quotes with their fetch times.";
  } catch {
    nftStatus.textContent = "NFT collection data is temporarily unavailable. Try refreshing in a moment.";
  } finally {
    nftLoading = false;
    nftRefresh.disabled = false;
  }
}

nftSearch.addEventListener("input",renderNftCollections);
nftSort.addEventListener("input",renderNftCollections);
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
