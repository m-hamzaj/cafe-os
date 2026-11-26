// Entry point for the cafe-os MCP server (stdio). Run with `npm run mcp`.
//
// lib/db-client.ts reads DATABASE_URL when it is first imported, so the env
// file has to be loaded before anything touches lib/queries. That's why the
// tools are pulled in with a dynamic import below rather than at the top.
//
// stdout carries the MCP protocol itself: a stray console.log would corrupt
// it, so all logging is sent to stderr.
import { existsSync } from "node:fs";
import { join } from "node:path";

console.log = console.error;
console.info = console.error;

async function main() {
  // This project compiles .ts as CommonJS under tsx, so __dirname is available.
  const envFile = join(__dirname, "..", ".env.local");
  // Variables already set (for example by the MCP client config) win over the file.
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const { startServer } = await import("./tools");
  await startServer();
}

main().catch((err) => {
  console.error("cafe-os MCP server failed to start:", err);
  process.exit(1);
});
