import { createApiContext } from "./context.js";

const ctx = createApiContext();
const url = await ctx.start();
console.log(`AgentGuard X API listening on ${url}  (DEMO / SANDBOX / NO REAL DATA)`);
