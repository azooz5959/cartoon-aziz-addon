const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const dataPath = process.env.CARTOONS_FILE || path.join(__dirname, "..", "cartoons.json");

function loadData() {
  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

function addonId(cartoonId) {
  return `cartoon-aziz:${cartoonId}`;
}

function videoId(cartoonId, episode) {
  return `${addonId(cartoonId)}:${episode}`;
}

function artworkFields(cartoon) {
  return {
    ...(cartoon.poster ? { poster: cartoon.poster } : {}),
    ...(cartoon.background ? { background: cartoon.background } : {})
  };
}

function makeManifest() {
  return {
    id: "com.aziz.cartoon",
    version: "1.0.0",
    name: "Cartoon Aziz",
    logo: "https://cartoon-aziz-addon.onrender.com/assets/app-logo.png",
    description: "مكتبة كرتون عربية تعمل عبر روابط Cloudflare R2 العامة",
    resources: ["catalog", "meta", "stream"],
    types: ["series"],
    catalogs: [{ type: "series", id: "cartoon-aziz", name: "Cartoon Aziz" }],
    idPrefixes: ["cartoon-aziz:"]
  };
}

function makeCatalog() {
  const { cartoons } = loadData();
  return { metas: cartoons.map((cartoon) => ({
    id: addonId(cartoon.id), type: "series", name: cartoon.name,
    description: cartoon.description || "", releaseInfo: cartoon.releaseInfo || "",
    ...artworkFields(cartoon)
  })) };
}

function makeMeta(id) {
  const { cartoons } = loadData();
  const cartoon = cartoons.find((item) => addonId(item.id) === id);
  if (!cartoon) return { meta: null };
  const videos = Array.from({ length: cartoon.episodes }, (_, index) => {
    const episode = index + 1;
    return { id: videoId(cartoon.id, episode), title: `الحلقة ${episode}`, season: 1,
      episode, released: new Date(Date.UTC(2000, 0, episode)).toISOString(),
      ...(cartoon.episodeThumbnail || cartoon.poster ? { thumbnail: cartoon.episodeThumbnail || cartoon.poster } : {}) };
  });
  return { meta: { id: addonId(cartoon.id), type: "series", name: cartoon.name,
    description: cartoon.description || "", releaseInfo: cartoon.releaseInfo || "",
    videos, ...artworkFields(cartoon) } };
}

function makeStreams(id) {
  const match = /^cartoon-aziz:([^:]+):(\d+)$/.exec(id);
  if (!match) return { streams: [] };
  const { baseUrl, cartoons } = loadData();
  const cartoon = cartoons.find((item) => item.id === match[1]);
  const episode = Number(match[2]);
  if (!cartoon || episode < 1 || episode > cartoon.episodes) return { streams: [] };
  const prefix = cartoon.episodePrefix || "E";
  const extension = cartoon.extension || ".mp4";
  const url = `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(cartoon.folder)}/${encodeURIComponent(`${prefix}${episode}${extension}`)}`;
  return { streams: [{ name: "Cartoon Aziz", title: `${cartoon.name} — الحلقة ${episode}`, url }] };
}

function createApp() {
  return http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const json = (body, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
    };

    if (pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end('<meta charset="utf-8"><title>Cartoon Aziz</title><h1>Cartoon Aziz</h1><p><a href="/manifest.json">فتح manifest.json</a></p>');
    }
    if (pathname === "/manifest.json") return json(makeManifest());

    const assets = {
      "/assets/app-logo.png": "app-logo.png",
      "/assets/sally-poster.png": "sally-poster.png"
    };
    if (assets[pathname]) {
      const assetPath = path.join(__dirname, "..", "public", assets[pathname]);
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
      return fs.createReadStream(assetPath).pipe(res);
    }

    if (pathname === "/catalog/series/cartoon-aziz.json") {
      return json(makeCatalog());
    }

    const metaMatch = /^\/meta\/series\/(.+)\.json$/.exec(pathname);
    if (metaMatch) {
      return json(makeMeta(metaMatch[1]));
    }

    const streamPathMatch = /^\/stream\/series\/(.+)\.json$/.exec(pathname);
    if (streamPathMatch) {
      return json(makeStreams(streamPathMatch[1]));
    }

    return json({ error: "Not found" }, 404);
  });
}

module.exports = { createApp, makeManifest, makeCatalog, makeMeta, makeStreams };
