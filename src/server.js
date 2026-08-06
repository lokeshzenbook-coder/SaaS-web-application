import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(`SaaS app listening on http://${config.host}:${config.port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
