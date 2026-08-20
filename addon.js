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

const DEFAULT_OPTIONS = { showQuality: true, usePoster: true, hideMissing: true, autoplay: true, newestFirst: false, quality: "auto" };

function normalizeOptions(value = {}) { return { ...DEFAULT_OPTIONS, ...value }; }
function encodeOptions(value) { return Buffer.from(JSON.stringify(normalizeOptions(value))).toString("base64url"); }
function decodeOptions(value) {
  try { return normalizeOptions(JSON.parse(Buffer.from(value, "base64url").toString("utf8"))); }
  catch { return normalizeOptions(); }
}

function makeManifest(userOptions = {}) {
  const options = normalizeOptions(userOptions);
  const catalogs = [
    { type: "series", id: "cartoon-aziz-cartoons", name: "كرتون", extra: [{ name: "search", isRequired: false }] },
    { type: "series", id: "cartoon-aziz-movies", name: "أفلام", extra: [{ name: "search", isRequired: false }] }
  ];
  return {
    id: "com.aziz.cartoon.v4",
    version: "3.8.5",
    name: "Cartoon Aziz",
    logo: "https://cartoon-aziz-addon.onrender.com/assets/app-logo-v2.png",
    background: "https://cartoon-aziz-addon.onrender.com/assets/sally-background.png",
    description: " الكرتون الكلاسيكي",
    resources: ["catalog", "meta", "stream"],
    types: ["series"],
    catalogs,
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

function isMovie(cartoon) {
  return cartoon.type === "movie" || (cartoon.categories || []).includes("movies");
}

function makeCatalog(catalogId = "cartoon-aziz-cartoons", search = "") {
  const { cartoons } = loadData();
  const needle = normalize(search);
  let filtered = cartoons.filter((cartoon) => {
    const movie = isMovie(cartoon);
    const inCategory = catalogId === "cartoon-aziz-movies" ? movie : !movie;
    const haystack = normalize([cartoon.name, cartoon.description, ...(cartoon.genres || [])].join(" "));
    return inCategory && (!needle || haystack.includes(needle));
  });
  return { metas: filtered.map(catalogMeta) };
}

function episodeThumbnail(cartoon, episode) {
  if (cartoon.episodeThumbnailUrls?.[episode - 1]) return cartoon.episodeThumbnailUrls[episode - 1];
  if (cartoon.episodeThumbnails && cartoon.episodeThumbnails[String(episode)]) return cartoon.episodeThumbnails[String(episode)];
  const thumbnailFile = cartoon.episodeThumbnailFiles?.[episode - 1];
  if (cartoon.episodeThumbnailBase && thumbnailFile) return `${cartoon.episodeThumbnailBase.replace(/\/$/, "")}/${encodeURIComponent(thumbnailFile)}`;
  if (cartoon.episodeThumbnailTemplate) return cartoon.episodeThumbnailTemplate.replace("{episode}", episode);
  return cartoon.episodeThumbnail || cartoon.poster || "";
}

function episodeTitle(cartoon, episode) {
  return cartoon.episodeTitles?.[String(episode)] || `${cartoon.episodeTitlePrefix || "الحلقة"} ${episode}`;
}

function makeMeta(id, availableEpisodes, userOptions = {}) {
  const options = normalizeOptions(userOptions);
  const { cartoons } = loadData();
  const cartoon = cartoons.find((item) => addonId(item.id) === id);
  if (!cartoon) return { meta: null };
  const allowed = availableEpisodes ? new Set(availableEpisodes) : null;
  let episodeNumbers = Array.from({ length: cartoon.episodes }, (_, index) => index + 1);
  if (options.newestFirst) episodeNumbers.reverse();
  const videos = episodeNumbers
    .filter((episode) => !allowed || allowed.has(episode))
    .map((episode) => ({
      id: videoId(cartoon.id, episode), title: episodeTitle(cartoon, episode),
      overview: `${cartoon.name} — الحلقة ${episode}\n${cartoon.description || ""}`, season: cartoon.season || 1, episode,
      released: new Date(Date.UTC(cartoon.year || 2000, 0, Math.min(episode, 28))).toISOString(),
      ...(cartoon.logo ? { logo: cartoon.logo } : {}),
      ...(cartoon.background ? { background: cartoon.background } : {}),
      ...(options.usePoster && episodeThumbnail(cartoon, episode) ? { thumbnail: episodeThumbnail(cartoon, episode) } : {})
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
  if (cartoon.episodeUrls?.[episode - 1]) return cartoon.episodeUrls[episode - 1];
  const prefix = cartoon.episodePrefix || "E";
  const extension = cartoon.extension || ".mp4";
  return `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(cartoon.folder)}/${encodeURIComponent(`${prefix}${episode}${extension}`)}`;
}

function makeStreams(id, userOptions = {}) {
  const options = normalizeOptions(userOptions);
  // Harbor may turn a series-style video into "show:season:episode" even when
  // the original video id was "show:episode". Accept both forms so one-part
  // movies stored in the legacy series catalog still play.
  const match = /^cartoon-aziz:([^:]+):(?:(\d+):)?(\d+)$/.exec(id);
  if (!match) return { streams: [] };
  const { baseUrl, cartoons } = loadData();
  const cartoon = cartoons.find((item) => item.id === match[1]);
  const episode = Number(match[3]);
  if (!cartoon || episode < 1 || episode > cartoon.episodes) return { streams: [] };
  const configuredSources = cartoon.sources?.length ? cartoon.sources : [{ name: "R2 الرئيسي", quality: cartoon.quality || "HD", baseUrl, folder: cartoon.folder, episodePrefix: cartoon.episodePrefix, extension: cartoon.extension }];
  const streams = configuredSources.map((source, index) => {
    const sourceCartoon = { ...cartoon, folder: source.folder || cartoon.folder, episodePrefix: source.episodePrefix || cartoon.episodePrefix, extension: source.extension || cartoon.extension };
    const quality = source.quality || cartoon.quality || "HD";
    return {
      name: options.showQuality ? `${source.name || `السيرفر ${index + 1}`} • ${quality}` : (source.name || `السيرفر ${index + 1}`),
      title: `${cartoon.name} — ${episodeTitle(cartoon, episode)}${options.showQuality ? `\n${quality} • ${cartoon.runtime || ""}` : ""}`.trim(),
      url: streamUrl(source.baseUrl || baseUrl, sourceCartoon, episode),
      ...(options.autoplay ? { behaviorHints: { bingeGroup: `cartoon-aziz-${cartoon.id}-${quality}` } } : {})
    };
  });
  return { streams };
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
  const { cartoons } = loadData();
  const total = cartoons.reduce((sum, item) => sum + item.episodes, 0);
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>إعداد Cartoon Aziz</title><style>
  *{box-sizing:border-box}body{margin:0;background:#080d13;color:#f7f8fa;font-family:system-ui,-apple-system,sans-serif}.wrap{max-width:920px;margin:auto;padding:35px 20px}.head{display:flex;align-items:center;gap:18px;margin-bottom:24px}.head img{width:82px;border-radius:20px}.head p{color:#94a0ad;margin:4px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.card{background:#111923;border:1px solid #ffffff12;border-radius:18px;padding:22px}.card h2{font-size:18px;margin:0 0 15px}.option{display:flex;align-items:center;justify-content:space-between;padding:13px 0;border-bottom:1px solid #ffffff0d}.option:last-child{border:0}.switch{position:relative;width:48px;height:27px}.switch input{opacity:0}.slider{position:absolute;inset:0;background:#35404c;border-radius:30px;cursor:pointer}.slider:before{content:"";position:absolute;width:21px;height:21px;right:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}.switch input:checked+.slider{background:#eeb54a}.switch input:checked+.slider:before{transform:translateX(-21px)}select,.url{width:100%;background:#080d13;color:#fff;border:1px solid #ffffff1c;border-radius:10px;padding:12px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}.stat{background:#111923;border:1px solid #ffffff12;border-radius:14px;padding:16px}.stat b{display:block;color:#eeb54a;font-size:22px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}button,a.btn{border:0;border-radius:11px;padding:13px 18px;background:#eeb54a;color:#111;font-weight:800;text-decoration:none;cursor:pointer}.secondary{background:#202a35!important;color:#fff!important}.status{color:#78df98}.muted{color:#94a0ad;font-size:13px}@media(max-width:700px){.grid,.stats{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}}</style></head><body><main class="wrap"><div class="head"><img src="/assets/app-logo-v2.png"><div><h1>إعداد Cartoon Aziz</h1><p>خصص مكتبتك ثم ثبّت الرابط الناتج في Harbor.</p></div></div>
  <section class="stats"><div class="stat"><b id="r2">…</b><span>حالة R2</span></div><div class="stat"><b>${cartoons.length}</b><span>المسلسلات</span></div><div class="stat"><b>${total}</b><span>الحلقات</span></div><div class="stat"><b>3.8.5</b><span>الإصدار</span></div></section>
  <div class="grid"><section class="card"><h2>أقسام المكتبة</h2><div class="option"><span>كرتون</span><b>مفعّل</b></div><div class="option"><span>أفلام</span><b>مفعّل</b></div></section>
  <section class="card"><h2>العرض والتشغيل</h2>${[["showQuality","إظهار الجودة بجانب السيرفر"],["usePoster","استخدام البوستر للحلقات"],["hideMissing","إخفاء الروابط غير الموجودة"],["autoplay","تشغيل الحلقة التالية تلقائيًا"],["newestFirst","عرض الأحدث أولًا"]].map(([id,label])=>`<div class="option"><span>${label}</span><label class="switch"><input id="${id}" type="checkbox" ${id==='newestFirst'?'':'checked'}><span class="slider"></span></label></div>`).join("")}<div class="option"><span>الجودة الافتراضية</span><select id="quality" style="width:125px"><option value="auto">تلقائية</option><option value="1080p">1080p</option><option value="HD">HD</option></select></div></section></div>
  <section class="card" style="margin-top:16px"><h2>رابط التثبيت</h2><input class="url" id="url" readonly><p class="muted">آخر تحديث: ${fs.statSync(dataPath).mtime.toLocaleString("ar-SA")}</p><div class="actions"><button id="install">تثبيت في Harbor</button><button class="secondary" id="copy">نسخ رابط Manifest</button><button class="secondary" id="save">حفظ الإعدادات</button><button class="secondary" id="reset">إعادة الافتراضي</button><a class="btn secondary" href="/">الصفحة الرئيسية</a></div></section></main><script>
  const ids=['showQuality','usePoster','hideMissing','autoplay','newestFirst'];
  const defaults=${JSON.stringify(DEFAULT_OPTIONS)};
  const read=()=>Object.assign({},Object.fromEntries(ids.map(id=>[id,document.getElementById(id).checked])),{quality:document.getElementById('quality').value});
  const token=o=>btoa(JSON.stringify(o)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const update=()=>{document.getElementById('url').value=location.origin+'/c/'+token(read())+'/manifest.json'};
  ids.forEach(id=>document.getElementById(id).addEventListener('change',update));document.getElementById('quality').addEventListener('change',update);
  document.getElementById('copy').onclick=async()=>{await navigator.clipboard.writeText(document.getElementById('url').value);document.getElementById('copy').textContent='تم النسخ ✓'};
  document.getElementById('save').onclick=()=>{localStorage.setItem('cartoonAzizOptions',JSON.stringify(read()));document.getElementById('save').textContent='تم الحفظ ✓'};
  document.getElementById('reset').onclick=()=>{localStorage.removeItem('cartoonAzizOptions');ids.forEach(id=>document.getElementById(id).checked=defaults[id]);document.getElementById('quality').value=defaults.quality;update()};
  document.getElementById('install').onclick=()=>{location.href=document.getElementById('url').value.replace('https://','stremio://')};
  try{const saved=JSON.parse(localStorage.getItem('cartoonAzizOptions'));if(saved){ids.forEach(id=>document.getElementById(id).checked=saved[id]??defaults[id]);document.getElementById('quality').value=saved.quality||'auto'}}catch{}update();
  fetch('/health.json').then(r=>r.json()).then(x=>{const el=document.getElementById('r2');el.textContent=x.r2?'متصل':'غير متصل';el.className=x.r2?'status':''}).catch(()=>document.getElementById('r2').textContent='غير متصل');
  </script></body></html>`;
}

function createApp() {
  return http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const configured = /^\/c\/([^/]+)(\/.*)$/.exec(pathname);
    const options = configured ? decodeOptions(configured[1]) : normalizeOptions();
    const routePath = configured ? configured[2] : pathname;
    const json = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
    const html = (body) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(body); };

    if (routePath === "/") return html(welcomePage());
    if (routePath === "/configure") return html(configurePage());
    if (routePath === "/manifest.json") return json(makeManifest(options));
    if (routePath === "/health.json") {
      const { baseUrl, cartoons } = loadData();
      let r2 = false;
      try { const response = await fetch(streamUrl(baseUrl, cartoons[0], 1), { method: "HEAD", signal: AbortSignal.timeout(5000) }); r2 = response.status !== 404; } catch {}
      return json({ status: "ok", r2, series: cartoons.length, episodes: cartoons.reduce((sum, c) => sum + c.episodes, 0) });
    }
    if (routePath.startsWith("/assets/")) {
      const filename = path.basename(routePath);
      const assetPath = path.join(publicPath, filename);
      if (fs.existsSync(assetPath)) { res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" }); return fs.createReadStream(assetPath).pipe(res); }
    }

    const catalogMatch = /^\/catalog\/series\/(cartoon-aziz-(?:cartoons|movies))(?:\/search=(.*))?\.json$/.exec(routePath);
    if (catalogMatch) return json(makeCatalog(catalogMatch[1], catalogMatch[2] || ""));

    const metaMatch = /^\/meta\/series\/(.+)\.json$/.exec(routePath);
    if (metaMatch) {
      const { cartoons } = loadData();
      const cartoon = cartoons.find((item) => addonId(item.id) === metaMatch[1]);
      return json(makeMeta(metaMatch[1], cartoon && options.hideMissing ? await availableEpisodes(cartoon) : null, options));
    }
    const streamMatch = /^\/stream\/series\/(.+)\.json$/.exec(routePath);
    if (streamMatch) return json(makeStreams(streamMatch[1], options));
    return json({ error: "Not found" }, 404);
  });
}

module.exports = { createApp, makeManifest, makeCatalog, makeMeta, makeStreams, welcomePage, normalize, encodeOptions, decodeOptions, isMovie };
