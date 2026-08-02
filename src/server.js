const { createApp } = require("./addon");

const port = Number(process.env.PORT) || 7000;
createApp().listen(port, () => {
  console.log(`Cartoon Aziz يعمل على http://localhost:${port}/manifest.json`);
});
