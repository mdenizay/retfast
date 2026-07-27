import { createServer } from "node:http";

import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { attachRealtimeServer } from "./realtime/hub.js";
import { startRetrievalMaintenance } from "./routes/retrieval.js";

const server = createServer(app);
const socketServer = attachRealtimeServer(server);
const stopRetrievalMaintenance = startRetrievalMaintenance();

server.listen(config.PORT, "0.0.0.0", () => {
  console.log(`RETFAST API listening on port ${config.PORT}`);
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down.`);
  stopRetrievalMaintenance();
  socketServer.close();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
