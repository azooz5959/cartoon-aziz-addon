const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { createHash } = require("node:crypto");

const dataPath = process.env.CARTOONS_FILE || path.join(__dirname, "..", "cartoons.json");
const checkCache = new Map();
const CHECK_TTL = Number(process.env.STREAM_CHECK_TTL_MS) || 6 * 60 * 60 * 1000;

const CACHE_CONTROL = {
  manifest: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
  catalog: "public, max-age=1800, s-maxage=21600, stale-while-revalidate=86400",
  meta: "public, max-age=1800, s-maxage=21600, stale-while-revalidate=86400",
  stream: "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600",
  page: "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  health: "no-store"
};

function loadData() {
  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

function assetBaseUrl() {
  const configured = process.env.ASSET_BASE_URL || process.env.R2_ASSET_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return `${loadData().baseUrl.replace(/\/$/, "")}/assets`;
}

function assetUrl(filename) {
  return `${assetBaseUrl()}/${encodeURIComponent(filename)}`;
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
    version: "3.8.4",
    name: "Cartoon Aziz",
    logo: assetUrl("app-logo-v2.png"),
    background: assetUrl("app-logo-v2.png"),
    description: "عالم الكرتون العربي الكلاسيكي بجودة عالية — مكتبة عزيز الخاصة",
    resources: ["catalog", "meta", "stream"],
    types: ["series"],
    catalogs,
    idPrefixes: ["cartoon-aziz:"],
    behaviorHints: { configurable: true, configurationRequired: false },
    stremioAddonsConfig: {
      issuer: "https://stremio-addons.net",
      signature: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..FOkpf7Pk68fGKq_cfs5aSA.Cyf2xHn-hhOgfuSXPPdlrDbjzJuH6iJeMgWDct-54zNaVj-fZ7myqVWmg9M8nY8fbFwY2ihC3v7KtHubZpSXkqu1lui6inh3uhx5QlW5PMPYd7n8OaHZ4bQ1j4I4AOSz.ZmY_mMAvsjC8L9dXZDxjdw"
    }
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
  // Network probing is deliberately opt-in. R2 URLs are returned directly and
  // Stremio performs the actual media request without proxying through Render.
  if (process.env.CHECK_STREAMS !== "true") return null;
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
  *{box-sizing:border-box}
  body{margin:0;background:#05070c;color:#f4f6f9;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;min-height:100vh;overflow-x:hidden}
  body:before{content:"";position:fixed;inset:0;background:radial-gradient(900px 500px at 85% -10%,#3a2a5c55,transparent),radial-gradient(700px 500px at -10% 30%,#efb74c22,transparent),#05070c;z-index:-2}
  body:after{content:"";position:fixed;top:-15%;right:-15%;width:65%;height:65%;background:url('${assetUrl("app-logo-v2.png")}') center/contain no-repeat;opacity:.14;filter:blur(70px) saturate(1.3);z-index:-1;pointer-events:none}
  .wrap{max-width:1080px;margin:auto;padding:60px 24px 80px}
  .hero{display:flex;gap:36px;align-items:center;background:linear-gradient(160deg,#ffffff0f,#ffffff03);border:1px solid #ffffff17;border-radius:28px;padding:36px;backdrop-filter:blur(18px);box-shadow:0 30px 80px -30px #000}
  .logo-wrap{position:relative;width:180px;height:180px;flex-shrink:0;border-radius:34px;overflow:hidden;box-shadow:0 24px 60px -14px #000,0 0 0 1px #ffffff26 inset,0 0 50px -6px #efb74c55}
  .logo-wrap .bg{position:absolute;inset:-24px;width:calc(100% + 48px);height:calc(100% + 48px);object-fit:cover;filter:blur(26px) saturate(2.1) brightness(.85);transform:scale(1.3)}
  .logo-wrap .fg{position:absolute;inset:12%;width:76%;height:76%;object-fit:contain;filter:drop-shadow(0 14px 28px #000c)}
  .tag{color:#efb74c;font-weight:800;letter-spacing:.3px;font-size:14px}
  .hero h1{margin:6px 0 10px;font-size:34px;font-weight:900;background:linear-gradient(90deg,#fff,#e7c98f);-webkit-background-clip:text;background-clip:text;color:transparent}
  .hero p{color:#b6bfca;margin:0 0 22px;line-height:1.7;font-size:15px}
  .buttons{display:flex;gap:12px;flex-wrap:wrap}
  .btn{background:linear-gradient(135deg,#f5c565,#e0a53a);color:#241705;padding:13px 22px;border-radius:13px;text-decoration:none;font-weight:800;box-shadow:0 10px 24px -8px #efb74c88;transition:transform .15s,box-shadow .15s}
  .btn:hover{transform:translateY(-2px);box-shadow:0 14px 30px -8px #efb74caa}
  .ghost{background:#ffffff0f;color:#fff;border:1px solid #ffffff2a;box-shadow:none;backdrop-filter:blur(6px)}
  .ghost:hover{background:#ffffff1c}
  .stats,.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:32px}
  .box,.card{background:linear-gradient(160deg,#ffffff0d,#ffffff02);border:1px solid #ffffff15;border-radius:20px;padding:22px;backdrop-filter:blur(14px);transition:transform .15s,border-color .15s}
  .box:hover,.card:hover{transform:translateY(-3px);border-color:#efb74c55}
  .num{font-size:32px;font-weight:900;color:#efb74c}
  .card{display:flex;gap:16px;align-items:center}
  .card img{width:74px;height:100px;object-fit:cover;border-radius:12px;box-shadow:0 10px 22px -8px #000}
  small{color:#8b96a3}
  h2{font-size:22px;margin:44px 0 18px;font-weight:800}
  @media(max-width:650px){.hero{flex-direction:column;text-align:center;padding:28px}.hero p{text-align:center}.buttons{justify-content:center}.logo-wrap{width:140px;height:140px}.stats,.cards{grid-template-columns:1fr}}
  </style></head><body><main class="wrap">
  <section class="hero">
    <div class="logo-wrap"><img class="bg" src="${assetUrl("app-logo-v2.png")}"><img class="fg" src="${assetUrl("app-logo-v2.png")}"></div>
    <div>
      <div class="tag">مكتبة عزيز الخاصة</div>
      <h1>Cartoon Aziz</h1>
      <p>كلاسيكيات الكرتون العربي، مرتبة وجاهزة للمشاهدة بجودة عالية.</p>
      <div class="buttons"><a class="btn" href="/configure">إعداد الإضافة</a><a class="btn ghost" href="/manifest.json">Manifest</a></div>
    </div>
  </section>
  <section class="stats">
    <div class="box"><div class="num">✓</div><small>حالة الإضافة</small><div>تعمل الآن</div></div>
    <div class="box"><div class="num">${cartoons.length}</div><small>المسلسلات</small></div>
    <div class="box"><div class="num">${total}</div><small>الحلقات</small></div>
  </section>
  <h2>المكتبة</h2>
  <section class="cards">${cartoons.map(c => `<div class="card"><img src="${c.poster}"><div><b>${c.name}</b><br><small>${c.year || ""} • ${c.quality || "HD"}<br>${c.episodes} حلقة</small></div></div>`).join("")}</section>
  </main></body></html>`;
}

function configurePage() {
  const { cartoons } = loadData();
  const total = cartoons.reduce((sum, item) => sum + item.episodes, 0);
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>إعداد Cartoon Aziz</title><style>
  *{box-sizing:border-box}
  body{margin:0;background:#05070c;color:#f4f6f9;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;min-height:100vh}
  body:before{content:"";position:fixed;inset:0;background:radial-gradient(900px 500px at 90% -10%,#3a2a5c4d,transparent),radial-gradient(700px 500px at -10% 40%,#efb74c1c,transparent),#05070c;z-index:-2}
  body:after{content:"";position:fixed;top:-15%;right:-15%;width:55%;height:55%;background:url('${assetUrl("app-logo-v2.png")}') center/contain no-repeat;opacity:.12;filter:blur(60px) saturate(1.3);z-index:-1;pointer-events:none}
  .wrap{max-width:960px;margin:auto;padding:44px 20px 70px}
  .head{display:flex;align-items:center;gap:22px;margin-bottom:30px;background:linear-gradient(160deg,#ffffff0f,#ffffff03);border:1px solid #ffffff17;border-radius:24px;padding:24px;backdrop-filter:blur(18px)}
  .logo-wrap{position:relative;width:96px;height:96px;flex-shrink:0;border-radius:24px;overflow:hidden;box-shadow:0 16px 40px -10px #000,0 0 0 1px #ffffff26 inset,0 0 34px -4px #efb74c55}
  .logo-wrap .bg{position:absolute;inset:-16px;width:calc(100% + 32px);height:calc(100% + 32px);object-fit:cover;filter:blur(18px) saturate(2.1) brightness(.85);transform:scale(1.3)}
  .logo-wrap .fg{position:absolute;inset:11%;width:78%;height:78%;object-fit:contain;filter:drop-shadow(0 10px 18px #000c)}
  .head h1{margin:0;font-size:24px;font-weight:900}
  .head p{color:#9aa5b1;margin:6px 0 0;font-size:14px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .card{background:linear-gradient(160deg,#ffffff0d,#ffffff02);border:1px solid #ffffff15;border-radius:20px;padding:24px;backdrop-filter:blur(14px)}
  .card h2{font-size:16px;margin:0 0 16px;font-weight:800;color:#e7c98f}
  .option{display:flex;align-items:center;justify-content:space-between;padding:13px 0;border-bottom:1px solid #ffffff0d}
  .option:last-child{border:0}
  .switch{position:relative;width:48px;height:27px}
  .switch input{opacity:0}
  .slider{position:absolute;inset:0;background:#2a3441;border-radius:30px;cursor:pointer;transition:.2s}
  .slider:before{content:"";position:absolute;width:21px;height:21px;right:3px;top:3px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 2px 6px #0006}
  .switch input:checked+.slider{background:linear-gradient(135deg,#f5c565,#e0a53a)}
  .switch input:checked+.slider:before{transform:translateX(-21px)}
  select,.url{width:100%;background:#0a0f16;color:#fff;border:1px solid #ffffff1f;border-radius:12px;padding:12px 14px;font-size:14px}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}
  .stat{background:linear-gradient(160deg,#ffffff0d,#ffffff02);border:1px solid #ffffff15;border-radius:16px;padding:18px;text-align:center;backdrop-filter:blur(14px)}
  .stat b{display:block;color:#efb74c;font-size:24px;font-weight:900}
  .stat span{color:#8b96a3;font-size:12.5px}
  .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
  button,a.btn{border:0;border-radius:12px;padding:13px 20px;background:linear-gradient(135deg,#f5c565,#e0a53a);color:#241705;font-weight:800;text-decoration:none;cursor:pointer;box-shadow:0 10px 22px -8px #efb74c77;transition:transform .15s}
  button:hover,a.btn:hover{transform:translateY(-2px)}
  .secondary{background:#ffffff10!important;color:#fff!important;border:1px solid #ffffff22;box-shadow:none!important}
  .status{color:#78df98}
  .muted{color:#8b96a3;font-size:13px}
  @media(max-width:700px){.grid,.stats{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}.head{flex-direction:column;text-align:center}}
  </style></head><body><main class="wrap">
  <div class="head">
    <div class="logo-wrap"><img class="bg" src="${assetUrl("app-logo-v2.png")}"><img class="fg" src="${assetUrl("app-logo-v2.png")}"></div>
    <div><h1>إعداد Cartoon Aziz</h1><p>خصص مكتبتك ثم ثبّت الرابط الناتج في Harbor.</p></div>
  </div>
  <section class="stats"><div class="stat"><b id="r2">…</b><span>حالة R2</span></div><div class="stat"><b>${cartoons.length}</b><span>المسلسلات</span></div><div class="stat"><b>${total}</b><span>الحلقات</span></div><div class="stat"><b>3.8.4</b><span>الإصدار</span></div></section>
  <div class="grid">
    <section class="card"><h2>أقسام المكتبة</h2><div class="option"><span>كرتون</span><b>مفعّل</b></div><div class="option"><span>أفلام</span><b>مفعّل</b></div></section>
    <section class="card"><h2>العرض والتشغيل</h2>${[["showQuality","إظهار الجودة بجانب السيرفر"],["usePoster","استخدام البوستر للحلقات"],["hideMissing","إخفاء الروابط غير الموجودة"],["autoplay","تشغيل الحلقة التالية تلقائيًا"],["newestFirst","عرض الأحدث أولًا"]].map(([id,label])=>`<div class="option"><span>${label}</span><label class="switch"><input id="${id}" type="checkbox" ${id==='newestFirst'?'':'checked'}><span class="slider"></span></label></div>`).join("")}<div class="option"><span>الجودة الافتراضية</span><select id="quality" style="width:125px"><option value="auto">تلقائية</option><option value="1080p">1080p</option><option value="HD">HD</option></select></div></section>
  </div>
  <section class="card" style="margin-top:16px"><h2>رابط التثبيت</h2><input class="url" id="url" readonly><p class="muted">آخر تحديث: ${fs.statSync(dataPath).mtime.toLocaleString("ar-SA")}</p><div class="actions"><button id="install">تثبيت في Harbor</button><button class="secondary" id="copy">نسخ رابط Manifest</button><button class="secondary" id="save">حفظ الإعدادات</button><button class="secondary" id="reset">إعادة الافتراضي</button><a class="btn secondary" href="/">الصفحة الرئيسية</a></div></section>
  </main><script>
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
  fetch('/health.json').then(r=>r.json()).then(x=>{const el=document.getElementById('r2');el.textContent=x.r2?'مهيأ':'غير مهيأ';el.className=x.r2?'status':''}).catch(()=>document.getElementById('r2').textContent='غير مهيأ');
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
    const send = (payload, contentType, status, cacheControl) => {
      const etag = `"${createHash("sha256").update(payload).digest("base64url").slice(0, 22)}"`;
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, { "Cache-Control": cacheControl, ETag: etag });
        return res.end();
      }
      res.writeHead(status, { "Content-Type": contentType, "Cache-Control": cacheControl, ETag: etag, "Content-Length": Buffer.byteLength(payload) });
      res.end(req.method === "HEAD" ? undefined : payload);
    };
    const json = (body, status = 200, cacheControl = "no-store") => {
      const payload = JSON.stringify(body);
      return send(payload, "application/json; charset=utf-8", status, cacheControl);
    };
    const html = (body) => send(body, "text/html; charset=utf-8", 200, CACHE_CONTROL.page);

    if (routePath === "/") return html(welcomePage());
    if (routePath === "/configure") return html(configurePage());
    if (routePath === "/manifest.json") return json(makeManifest(options), 200, CACHE_CONTROL.manifest);
    if (routePath === "/health.json") {
      const { baseUrl, cartoons } = loadData();
      // Configuration-only health check: never downloads or probes an R2 object.
      const r2 = /^https:\/\//i.test(baseUrl);
      return json({ status: "ok", r2, series: cartoons.length, episodes: cartoons.reduce((sum, c) => sum + c.episodes, 0) }, 200, CACHE_CONTROL.health);
    }

    const catalogMatch = /^\/catalog\/series\/(cartoon-aziz-(?:cartoons|movies))(?:\/search=(.*))?\.json$/.exec(routePath);
    if (catalogMatch) return json(makeCatalog(catalogMatch[1], catalogMatch[2] || ""), 200, CACHE_CONTROL.catalog);

    const metaMatch = /^\/meta\/series\/(.+)\.json$/.exec(routePath);
    if (metaMatch) {
      const { cartoons } = loadData();
      const cartoon = cartoons.find((item) => addonId(item.id) === metaMatch[1]);
      return json(makeMeta(metaMatch[1], cartoon && options.hideMissing ? await availableEpisodes(cartoon) : null, options), 200, CACHE_CONTROL.meta);
    }
    const streamMatch = /^\/stream\/series\/(.+)\.json$/.exec(routePath);
    if (streamMatch) return json(makeStreams(streamMatch[1], options), 200, CACHE_CONTROL.stream);
    return json({ error: "Not found" }, 404);
  });
}

module.exports = { createApp, makeManifest, makeCatalog, makeMeta, makeStreams, welcomePage, normalize, encodeOptions, decodeOptions, isMovie };
