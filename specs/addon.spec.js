const assert = require("node:assert/strict");
const test = require("node:test");
const { createApp, makeManifest, makeCatalog, makeMeta, makeStreams, encodeOptions, decodeOptions, isMovie } = require("../src/addon");

test("manifest, claim, and catalogs remain valid", () => {
  const manifest = makeManifest();
  assert.equal(manifest.name, "Cartoon Aziz");
  assert.equal(manifest.version, "3.8.5");
  assert.equal(manifest.id, "com.aziz.cartoon.v4");
  assert.match(manifest.logo, /app-logo-v2\.png$/);
  assert.doesNotMatch(manifest.logo, /onrender\.com/);
  assert.equal(manifest.stremioAddonsConfig.issuer, "https://stremio-addons.net");
  assert.ok(manifest.stremioAddonsConfig.signature);
  assert.deepEqual(manifest.catalogs.map((item) => item.name), ["كرتون", "أفلام"]);
  assert.equal(makeCatalog().metas.length, 14);
  assert.equal(makeCatalog("cartoon-aziz-movies").metas.length, 17);
  assert.equal(makeCatalog("cartoon-aziz-cartoons", "جزيرة الكنز").metas.length, 1);
});

test("asset host can be configured outside Render", () => {
  const previous = process.env.ASSET_BASE_URL;
  process.env.ASSET_BASE_URL = "https://media.example.com/static/";
  assert.equal(makeManifest().logo, "https://media.example.com/static/app-logo-v2.png");
  if (previous === undefined) delete process.env.ASSET_BASE_URL;
  else process.env.ASSET_BASE_URL = previous;
});

test("movie entries are routed only to the movies catalog", () => {
  assert.equal(isMovie({ type: "movie" }), true);
  assert.equal(isMovie({ categories: ["movies"] }), true);
  assert.equal(isMovie({ categories: ["classics", "kids"] }), false);
});

test("Harbor season and episode stream ids are accepted", () => {
  const legacy = makeStreams("cartoon-aziz:treasure-island:1");
  const harbor = makeStreams("cartoon-aziz:treasure-island:1:1");
  assert.equal(harbor.streams.length, 1);
  assert.equal(harbor.streams[0].url, legacy.streams[0].url);
});

test("configuration changes display behavior", () => {
  const options = { showQuality: false, usePoster: false, autoplay: false, newestFirst: true };
  const token = encodeOptions(options);
  assert.equal(decodeOptions(token).showQuality, false);
  const meta = makeMeta("cartoon-aziz:فلونة", null, options);
  assert.equal(meta.meta.videos[0].episode, 50);
  assert.equal(meta.meta.videos[0].thumbnail, undefined);
  const stream = makeStreams("cartoon-aziz:فلونة:1", options).streams[0];
  assert.equal(stream.name, "R2 الرئيسي");
  assert.equal(stream.behaviorHints, undefined);
});

test("stream responses point directly to R2, never Render", () => {
  const stream = makeStreams("cartoon-aziz:treasure-island:26").streams[0];
  assert.equal(stream.url, "https://pub-2ad8f7652233436cb957fed37d7bed31.r2.dev/%D8%AC%D8%B2%D9%8A%D8%B1%D8%A9%20%D8%A7%D9%84%D9%83%D9%86%D8%B2/E26.mp4");
  assert.doesNotMatch(stream.url, /onrender\.com/);
});

test("HTTP endpoints send cache headers and support conditional 304", async () => {
  const server = createApp();
  const request = (url, headers = {}) => new Promise((resolve, reject) => {
    const response = { status: 0, headers: {}, body: "" };
    const res = {
      setHeader(name, value) { response.headers[name.toLowerCase()] = value; },
      writeHead(status, values = {}) {
        response.status = status;
        for (const [name, value] of Object.entries(values)) response.headers[name.toLowerCase()] = value;
      },
      end(body = "") { response.body = body ? String(body) : ""; resolve(response); }
    };
    try { server.emit("request", { url, method: "GET", headers }, res); }
    catch (error) { reject(error); }
  });
  try {
    const manifest = await request("/manifest.json");
    assert.match(manifest.headers["cache-control"], /s-maxage=86400/);
    const etag = manifest.headers.etag;
    assert.ok(etag);
    const cached = await request("/manifest.json", { "if-none-match": etag });
    assert.equal(cached.status, 304);

    const catalog = await request("/catalog/series/cartoon-aziz-cartoons.json");
    assert.match(catalog.headers["cache-control"], /s-maxage=21600/);
    const stream = await request("/stream/series/cartoon-aziz:treasure-island:1.json");
    assert.match(stream.headers["cache-control"], /s-maxage=1800/);
    assert.doesNotMatch(stream.body, /onrender\.com/);
  } finally {
    server.close();
  }
});
