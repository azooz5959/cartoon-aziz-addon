const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const dataPath = process.env.CARTOONS_FILE || path.join(__dirname, "..", "cartoons.json");
const publicPath = path.join(__dirname, "..", "public");
const checkCache = new Map();
const CHECK_TTL = 10 * 60 * 1000;

function loadData() {
  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

function addonId(cartoonId) { return `cartoon-aziz:${cartoonId}`; }
function videoId(cartoonId, episode) { return `${addonId(cartoonId)}:${episode}`; }
function normalize(value = "") {
  return value.toLowerCase().normalize("NFKD").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").trim();
}

function artworkFields(cartoon) {
  return {
    ...(cartoon.poster ? { poster: cartoon.poster } : {}),
    ...(cartoon.background ? { background: cartoon.background } : {})
  };
}

function makeManifest() {
  return {
    id: "com.aziz.cartoon.v3.visual",
    version: "3.1.1",
    name: "Cartoon Aziz",
    logo: "https://cartoon-aziz-addon.onrender.com/assets/app-logo-v2.png",
    background: "https://cartoon-aziz-addon.onrender.com/assets/sally-background.png",
    description: "عالم الكرتون العربي الكلاسيكي بجودة عالية — مكتبة عزيز الخاصة",
    resources: ["catalog", "meta", "stream"],
    types: ["series"],
    catalogs: [
      { type: "series", id: "cartoon-aziz", name: "كل المسلسلات", extra: [{ name: "search", isRequired: false }] },
      { type: "series", id: "cartoon-aziz-classics", name: "كلاسيكيات" },
      { type: "series", id: "cartoon-aziz-adventures", name: "مغامرات" },
      { type: "series", id: "cartoon-aziz-kids", name: "أطفال" }
    ],
    idPrefixes: ["cartoon-aziz:"],
    behaviorHints: { configurable: true, configurationRequired: false }
  };
}

function catalogMeta(cartoon) {
  return {
    id: addonId(cartoon.id), type: "series", name: cartoon.name,
    description: cartoon.description || "", releaseInfo: cartoon.year ? String(cartoon.year) : (cartoon.releaseInfo || ""),
    genres: cartoon.genres || [], ...artworkFields(cartoon)
  };
}

function makeCatalog(catalogId = "cartoon-aziz", search = "") {
  const { cartoons } = loadData();
  const category = catalogId.replace("cartoon-aziz-", "");
  const needle = normalize(search);
  const filtered = cartoons.filter((cartoon) => {
    const inCategory = catalogId === "cartoon-aziz" || (cartoon.categories || []).includes(category);
    const haystack = normalize([cartoon.name, cartoon.description, ...(cartoon.genres || [])].join(" "));
    return inCategory && (!needle || haystack.includes(needle));
  });
  return { metas: filtered.map(catalogMeta) };
}

function episodeThumbnail(cartoon, episode) {
  if (cartoon.episodeThumbnails && cartoon.episodeThumbnails[String(episode)]) return cartoon.episodeThumbnails[String(episode)];
  if (cartoon.episodeThumbnailTemplate) return cartoon.episodeThumbnailTemplate.replace("{episode}", episode);
  return cartoon.episodeThumbnail || cartoon.poster || "";
}

function makeMeta(id, availableEpisodes) {
  const { cartoons } = loadData();
  const cartoon = cartoons.find((item) => addonId(item.id) === id);
  if (!cartoon) return { meta: null };
  const allowed = availableEpisodes ? new Set(availableEpisodes) : null;
  const videos = Array.from({ length: cartoon.episodes }, (_, index) => index + 1)
    .filter((episode) => !allowed || allowed.has(episode))
    .map((episode) => ({
      id: videoId(cartoon.id, episode), title: `${cartoon.episodeTitlePrefix || "الحلقة"} ${episode}`,
      overview: `${cartoon.name} — الحلقة ${episode}\n${cartoon.description || ""}`, season: cartoon.season || 1, episode,
      released: new Date(Date.UTC(cartoon.year || 2000, 0, Math.min(episode, 28))).toISOString(),
      ...(cartoon.logo ? { logo: cartoon.logo } : {}),
      ...(cartoon.background ? { background: cartoon.background } : {}),
      ...(episodeThumbnail(cartoon, episode) ? { thumbnail: episodeThumbnail(cartoon, episode) } : {})
    }));
  return { meta: {
    id: addonId(cartoon.id), type: "series", name: cartoon.displayName || cartoon.name,
    description: cartoon.description || "", releaseInfo: cartoon.year ? String(cartoon.year) : (cartoon.releaseInfo || ""),
    runtime: cartoon.runtime || "", genres: cartoon.genres || [], language: cartoon.language || "العربية",
    ...(cartoon.logo ? { logo: cartoon.logo } : {}),
    videos, ...artworkFields(cartoon)
  } };
}

function streamUrl(baseUrl, cartoon, episode) {
  const prefix = cartoon.episodePrefix || "E";
  const extension = cartoon.extension || ".mp4";
  return `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(cartoon.folder)}/${encodeURIComponent(`${prefix}${episode}${extension}`)}`;
}

function makeStreams(id) {
  const match = /^cartoon-aziz:([^:]+):(\d+)$/.exec(id);
  if (!match) return { streams: [] };
  const { baseUrl, cartoons } = loadData();
  const cartoon = cartoons.find((item) => item.id === match[1]);
  const episode = Number(match[2]);
  if (!cartoon || episode < 1 || episode > cartoon.episodes) return { streams: [] };
  return { streams: [{
    name: `Cartoon Aziz • ${cartoon.quality || "HD"}`,
    title: `${cartoon.name} — الحلقة ${episode}\n${cartoon.quality || "HD"} • ${cartoon.runtime || ""}`.trim(),
    url: streamUrl(baseUrl, cartoon, episode), behaviorHints: { bingeGroup: `cartoon-aziz-${cartoon.id}` }
  }] };
}

async function availableEpisodes(cartoon) {
  if (process.env.CHECK_STREAMS === "false") return null;
  const cached = checkCache.get(cartoon.id);
  if (cached && Date.now() - cached.time < CHECK_TTL) return cached.episodes;
  const { baseUrl } = loadData();
  const episodes = [];
  const queue = Array.from({ length: cartoon.episodes }, (_, i) => i + 1);
  async function worker() {
    while (queue.length) {
      const episode = queue.shift();
      try {
        const response = await fetch(streamUrl(baseUrl, cartoon, episode), { method: "HEAD", signal: AbortSignal.timeout(5000) });
        if (response.status !== 404) episodes.push(episode);
      } catch { episodes.push(episode); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, cartoon.episodes) }, worker));
  episodes.sort((a, b) => a - b);
  checkCache.set(cartoon.id, { time: Date.now(), episodes });
  return episodes;
}

function welcomePage() {
  const { cartoons } = loadData();
  const total = cartoons.reduce((sum, item) => sum + item.episodes, 0);
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cartoon Aziz</title><style>
  *{box-sizing:border-box}body{margin:0;background:#070b10;color:#fff;font-family:system-ui,-apple-system,sans-serif;min-height:100vh}body:before{content:"";position:fixed;inset:0;background:linear-gradient(90deg,#070b10 20%,transparent),url('/assets/sally-background.png') center/cover;opacity:.3;z-index:-1}.wrap{max-width:1050px;margin:auto;padding:50px 24px}.hero{display:flex;gap:28px;align-items:center}.logo{width:150px;border-radius:28px;box-shadow:0 15px 55px #000}.tag{color:#efb74c;font-weight:800}.buttons{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}.btn{background:#efb74c;color:#111;padding:13px 20px;border-radius:12px;text-decoration:none;font-weight:800}.ghost{background:#ffffff12;color:#fff;border:1px solid #ffffff25}.stats,.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin-top:35px}.box,.card{background:#111923dc;border:1px solid #ffffff12;border-radius:18px;padding:20px}.num{font-size:30px;font-weight:900;color:#efb74c}.card{display:flex;gap:16px;align-items:center}.card img{width:80px;height:110px;object-fit:cover;border-radius:10px}small{color:#aeb7c2}@media(max-width:650px){.hero{display:block}.logo{width:110px}.stats,.cards{grid-template-columns:1fr}}</style></head><body><main class="wrap"><section class="hero"><img class="logo" src="/assets/app-logo-v2.png"><div><div class="tag">مكتبة عزيز الخاصة</div><h1>Cartoon Aziz</h1><p>كلاسيكيات الكرتون العربي، مرتبة وجاهزة للمشاهدة بجودة عالية.</p><div class="buttons"><a class="btn" href="/configure">إعداد الإضافة</a><a class="btn ghost" href="/manifest.json">Manifest</a></div></div></section><section class="stats"><div class="box"><div class="num">✓</div><small>حالة الإضافة</small><div>تعمل الآن</div></div><div class="box"><div class="num">${cartoons.length}</div><small>المسلسلات</small></div><div class="box"><div class="num">${total}</div><small>الحلقات</small></div></section><h2>المكتبة</h2><section class="cards">${cartoons.map(c => `<div class="card"><img src="${c.poster}"><div><b>${c.name}</b><br><small>${c.year || ""} • ${c.quality || "HD"}<br>${c.episodes} حلقة</small></div></div>`).join("")}</section></main></body></html>`;
}

function configurePage() {
  const manifest = "https://cartoon-aziz-addon.onrender.com/manifest.json";
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>إعداد Cartoon Aziz</title><style>body{background:#090d12;color:#fff;font-family:system-ui;max-width:700px;margin:auto;padding:40px 20px}section{background:#121a24;border:1px solid #ffffff15;border-radius:18px;padding:24px}img{width:90px;border-radius:18px}input{width:100%;padding:14px;border-radius:10px;border:1px solid #ffffff20;background:#080c11;color:#fff;margin:12px 0}button,a{display:inline-block;border:0;border-radius:10px;padding:12px 18px;background:#efb74c;color:#111;font-weight:800;text-decoration:none;cursor:pointer}.ok{color:#72df91}</style></head><body><section><img src="/assets/app-logo-v2.png"><h1>إعداد Cartoon Aziz</h1><p class="ok">● الإضافة متصلة وتعمل</p><p>فعّل الأقسام التي تريدها من صفحة الإضافات داخل Harbor. يدعم الكتالوج البحث العربي وأقسام الكلاسيكيات والمغامرات والأطفال.</p><label>رابط Manifest</label><input id="url" readonly value="${manifest}"><button onclick="navigator.clipboard.writeText(document.getElementById('url').value);this.textContent='تم النسخ ✓'">نسخ الرابط</button> <a href="/">الصفحة الرئيسية</a></section></body></html>`;
}

function createApp() {
  return http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const json = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
    const html = (body) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(body); };

    if (pathname === "/") return html(welcomePage());
    if (pathname === "/configure") return html(configurePage());
    if (pathname === "/manifest.json") return json(makeManifest());
    if (pathname === "/health.json") {
      const { cartoons } = loadData();
      return json({ status: "ok", series: cartoons.length, episodes: cartoons.reduce((sum, c) => sum + c.episodes, 0) });
    }
    if (pathname.startsWith("/assets/")) {
      const filename = path.basename(pathname);
      const assetPath = path.join(publicPath, filename);
      if (fs.existsSync(assetPath)) { res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" }); return fs.createReadStream(assetPath).pipe(res); }
    }

    const catalogMatch = /^\/catalog\/series\/(cartoon-aziz(?:-(?:classics|adventures|kids))?)(?:\/search=(.*))?\.json$/.exec(pathname);
    if (catalogMatch) return json(makeCatalog(catalogMatch[1], catalogMatch[2] || ""));

    const metaMatch = /^\/meta\/series\/(.+)\.json$/.exec(pathname);
    if (metaMatch) {
      const { cartoons } = loadData();
      const cartoon = cartoons.find((item) => addonId(item.id) === metaMatch[1]);
      return json(makeMeta(metaMatch[1], cartoon ? await availableEpisodes(cartoon) : null));
    }
    const streamMatch = /^\/stream\/series\/(.+)\.json$/.exec(pathname);
    if (streamMatch) return json(makeStreams(streamMatch[1]));
    return json({ error: "Not found" }, 404);
  });
}

module.exports = { createApp, makeManifest, makeCatalog, makeMeta, makeStreams, welcomePage, normalize };
