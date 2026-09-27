import { createServer } from "vite";
import { createApp } from "./index.mjs";
const api = createApp().listen(5174, "127.0.0.1");
const vite = await createServer();
await vite.listen();
vite.printUrls();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await vite.close();
    api.close();
    process.exit();
  });
