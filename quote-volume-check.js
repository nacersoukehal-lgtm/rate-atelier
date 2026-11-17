"use strict";

globalThis.rateAtelierVolumeFlag = function (symbol,quote,previous) {
  if (symbol !== "USDT" || !Number.isFinite(quote?.volume_24h) || !(quote.market_cap > 0)) return false;
  const turnover = quote.volume_24h / quote.market_cap;
  return turnover > 1.25 || (turnover > 1 && previous > 0 && quote.volume_24h > previous * 4);
};
