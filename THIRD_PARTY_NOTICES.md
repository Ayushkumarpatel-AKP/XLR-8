# Third-Party Notices

AgentGuard X itself is licensed **Apache-2.0**.

No source code, images or text from any reference repository
(T3MP3ST, Pentest Swarm AI, or the local "Warrant / crashtest-AI" tree) is included in
this project — see `docs/references.md` for what was studied and what was implemented
independently.

The verification layer (`packages/receipt`) adds **no dependency**: it uses only
`node:crypto` + `node:zlib` on the server, and `crypto.subtle` + `CompressionStream` in
the browser. The public verification page runs the same signature check client-side.

## Runtime dependencies

| Package | Version range | License | Use |
| --- | --- | --- | --- |
| zod | ^3.24 | MIT | schema validation / contracts |
| fastify | ^5.2 | MIT | REST API |
| @fastify/cors | ^10.0 | MIT | CORS for the API |
| commander | ^12.1 | MIT | CLI argument parsing |
| react | ^18.3 | MIT | web UI |
| react-dom | ^18.3 | MIT | web UI |
| react-router-dom | ^6.28 | MIT | web routing |

## Development dependencies

| Package | Version range | License | Use |
| --- | --- | --- | --- |
| typescript | ^5.7 | Apache-2.0 | type checking |
| tsx | ^4.19 | MIT | run TS directly |
| vitest | ^2.1 | MIT | tests |
| vite | ^6.0 | MIT | web build / dev server |
| @vitejs/plugin-react | ^4.3 | MIT | React fast refresh |
| @types/node | ^22.10 | MIT | Node types |
| @types/react, @types/react-dom | ^18.3 | MIT | React types |

All runtime dependencies are permissively licensed (MIT / Apache-2.0) and are
compatible with Apache-2.0. Transitive licenses are those of the respective
packages as published on npm.
