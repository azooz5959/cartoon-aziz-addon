const assert = require("node:assert/strict");
const test = require("node:test");
const { makeManifest, makeCatalog, makeMeta, makeStreams, encodeOptions, decodeOptions } = require("../src/addon");

test("manifest and catalog are valid", async () => {
  const manifest = makeManifest();
  assert.equal(manifest.name, "Cartoon Aziz");
  assert.equal(manifest.version, "3.6.0");
  assert.match(manifest.logo, /app-logo-v2\.png$/);
  assert.equal(manifest.catalogs.length, 6);
  const catalog = makeCatalog();
  assert.equal(catalog.metas.length, 3);
  assert.equal(catalog.metas[0].id, "cartoon-aziz:sally-visual");
  assert.match(catalog.metas[0].poster, /sally-poster\.png$/);
  assert.equal(makeCatalog("cartoon-aziz", "سالي").metas.length, 1);
  assert.equal(makeCatalog("cartoon-aziz", "غير موجود").metas.length, 0);
  assert.equal(makeCatalog("cartoon-aziz-classics").metas.length, 3);
  assert.match(makeCatalog("cartoon-aziz-latest").metas[0].name, /جزيرة الكنز/);
  assert.match(makeCatalog("cartoon-aziz-latest").metas[0].name, /🆕/);
});

test("configuration changes catalogs and display behavior", () => {
  const options = { kids: false, adventures: false, showQuality: false, usePoster: false, autoplay: false, newestFirst: true };
  const token = encodeOptions(options);
  assert.equal(decodeOptions(token).kids, false);
  assert.deepEqual(makeManifest(options).catalogs.map((item) => item.id), ["cartoon-aziz", "cartoon-aziz-classics", "cartoon-aziz-latest", "cartoon-aziz-recommended"]);
  const meta = makeMeta("cartoon-aziz:moka-moka", null, options);
  assert.equal(meta.meta.videos[0].episode, 50);
  assert.equal(meta.meta.videos[0].thumbnail, undefined);
  const stream = makeStreams("cartoon-aziz:moka-moka:1", options).streams[0];
  assert.equal(stream.name, "R2 الرئيسي");
  assert.equal(stream.behaviorHints, undefined);
});

test("Sally has 48 episodes and an encoded R2 stream URL", async () => {
  const meta = makeMeta("cartoon-aziz:sally-visual");
  assert.equal(meta.meta.videos.length, 48);
  assert.match(meta.meta.videos[0].thumbnail, /sally-poster\.png$/);
  assert.equal(meta.meta.runtime, "24 دقيقة");
  assert.match(meta.meta.logo, /sally-logo\.png$/);
  assert.match(meta.meta.description, /سالي كرو/);
  assert.deepEqual(makeMeta("cartoon-aziz:sally-visual", [1, 48]).meta.videos.map((v) => v.episode), [1, 48]);
  const result = makeStreams("cartoon-aziz:sally-visual:1");
  assert.equal(result.streams[0].url, "https://pub-2ad8f7652233436cb957fed37d7bed31.r2.dev/%D8%B3%D8%A7%D9%84%D9%8A/E1.mp4");
});

test("Moka Moka has 50 episodes and correct R2 folder", () => {
  const meta = makeMeta("cartoon-aziz:moka-moka");
  assert.equal(meta.meta.videos.length, 50);
  assert.equal(meta.meta.releaseInfo, "1993");
  assert.match(meta.meta.poster, /%D9%85%D9%88%D9%83%D8%A7%20%D9%85%D9%88%D9%83%D8%A7\.PNG$/);
  const result = makeStreams("cartoon-aziz:moka-moka:50");
  assert.equal(result.streams[0].url, "https://pub-2ad8f7652233436cb957fed37d7bed31.r2.dev/%D9%85%D9%88%D9%83%D8%A7%20%D9%85%D9%88%D9%83%D8%A7/E50.mp4");
});

test("Treasure Island has 26 episodes, story, poster, and correct R2 folder", () => {
  const meta = makeMeta("cartoon-aziz:treasure-island");
  assert.equal(meta.meta.videos.length, 26);
  assert.equal(meta.meta.releaseInfo, "1978");
  assert.match(meta.meta.description, /جيم هوكنز/);
  assert.match(meta.meta.poster, /%D8%AC%D8%B2%D9%8A%D8%B1%D8%A9%20%D8%A7%D9%84%D9%83%D9%86%D8%B2\.jpg$/);
  assert.match(meta.meta.videos[0].thumbnail, /S01E01%20-%2020260804_190847_322%20-%2012m49s\.png$/);
  assert.match(meta.meta.videos[25].thumbnail, /S01E26%20-%2020260805_020733_042%20-%204m52s\.png$/);
  const result = makeStreams("cartoon-aziz:treasure-island:26");
  assert.equal(result.streams[0].url, "https://pub-2ad8f7652233436cb957fed37d7bed31.r2.dev/%D8%AC%D8%B2%D9%8A%D8%B1%D8%A9%20%D8%A7%D9%84%D9%83%D9%86%D8%B2/E26.mp4");
});
