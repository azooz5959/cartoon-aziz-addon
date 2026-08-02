const assert = require("node:assert/strict");
const test = require("node:test");
const { makeManifest, makeCatalog, makeMeta, makeStreams } = require("../src/addon");

test("manifest and catalog are valid", async () => {
  const manifest = makeManifest();
  assert.equal(manifest.name, "Cartoon Aziz");
  assert.match(manifest.logo, /app-logo\.png$/);
  const catalog = makeCatalog();
  assert.equal(catalog.metas[0].id, "cartoon-aziz:sally");
  assert.match(catalog.metas[0].poster, /sally-poster\.png$/);
});

test("Sally has 48 episodes and an encoded R2 stream URL", async () => {
  const meta = makeMeta("cartoon-aziz:sally");
  assert.equal(meta.meta.videos.length, 48);
  assert.match(meta.meta.videos[0].thumbnail, /sally-poster\.png$/);
  const result = makeStreams("cartoon-aziz:sally:1");
  assert.equal(result.streams[0].url, "https://pub-2ad8f7652233436cb957fed37d7bed31.r2.dev/%D8%B3%D8%A7%D9%84%D9%8A/E1.mp4");
});
