(() => {
  "use strict";
  const key = "rate-atelier-analytics";
  const id = "G-35RE2G11SJ";
  let choice;
  try { choice = localStorage.getItem(key); } catch {}
  const banner = document.createElement("aside");
  banner.className = "panel analytics-choice";
  banner.setAttribute("aria-label","Analytics preferences");
  banner.innerHTML = '<p>Rate Atelier uses optional Google Analytics cookies to understand how visitors use the site.</p><button type="button" data-choice="yes">Allow analytics</button><button type="button" data-choice="no">Decline analytics</button> <a href="./site-information.html#privacy">Privacy</a>';
  banner.hidden = choice === "yes" || choice === "no";
  document.body.append(banner);
  const settings = document.createElement("button");
  settings.type = "button";
  settings.className = "secondary-action analytics-settings";
  settings.textContent = "Analytics preferences";
  (document.querySelector("footer") ?? document.body).append(settings);
  settings.addEventListener("click",() => {
    banner.hidden = false;
    banner.querySelector("button").focus();
  });

  function startAnalytics() {
    if (document.getElementById("rate-atelier-google-tag")) return;
    window["ga-disable-" + id] = false;
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    gtag("consent","default",{analytics_storage:"granted",ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied"});
    gtag("js",new Date());
    gtag("config",id,{allow_google_signals:false,allow_ad_personalization_signals:false});
    const tag = document.createElement("script");
    tag.id = "rate-atelier-google-tag";
    tag.async = true;
    tag.src = "https://www.googletagmanager.com/gtag/js?id=" + id;
    document.head.append(tag);
  }
  for (const button of banner.querySelectorAll("button[data-choice]")) {
    button.addEventListener("click",() => {
      const next = button.dataset.choice;
      try { localStorage.setItem(key,next); } catch {}
      banner.hidden = true;
      if (next === "yes" && choice === "no" && document.getElementById("rate-atelier-google-tag")) {
        location.reload();
        return;
      }
      if (next === "yes") startAnalytics();
      else {
        window["ga-disable-" + id] = true;
        for (const name of ["_ga","_ga_" + id.slice(2)]) {
          for (const domain of ["","; Domain=" + location.hostname]) {
            document.cookie = name + "=; Max-Age=0; Path=/" + domain;
          }
        }
      }
      choice = next;
    });
  }
  if (choice === "yes") startAnalytics();
})();
