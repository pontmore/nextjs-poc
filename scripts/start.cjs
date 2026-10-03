const { cpSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");

const root = resolve(__dirname, "..");
const standalone = join(root, ".next", "standalone");
let port = process.env.PORT || "3001";
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--port" || args[index] === "-p") {
    port = args[++index];
  } else if (args[index].startsWith("--port=")) {
    port = args[index].slice("--port=".length);
  } else {
    throw new Error(`Unsupported argument: ${args[index]}`);
  }
}
if (!/^\d+$/.test(port || "") || Number(port) < 1 || Number(port) > 65535) {
  throw new Error("Port must be an integer between 1 and 65535.");
}
if (!existsSync(join(standalone, "server.js"))) {
  throw new Error("Production build missing. Run npm run build before npm start.");
}
// Standalone output omits these assets; include them for local production runs.
cpSync(join(root, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });
if (existsSync(join(root, "public"))) {
  cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });
}
process.env.PORT = String(Number(port));
require(join(standalone, "server.js"));
