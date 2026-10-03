/**
 * Minimal MCP stdio server. Speaks newline-delimited JSON-RPC 2.0 over stdin
 * and stdout, supporting the `initialize`, `tools/list` and `tools/call`
 * methods so AgentGuard can be driven by any MCP client.
 */
export interface McpToolHandler {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call(args: Record<string, unknown>): Promise<unknown>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

export async function serveMcpStdio(
  serverInfo: { name: string; version: string },
  tools: McpToolHandler[],
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  let buffer = "";

  const respond = (id: JsonRpcRequest["id"], result: unknown) => {
    output.write(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }) + "\n");
  };
  const respondError = (id: JsonRpcRequest["id"], code: number, message: string) => {
    output.write(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }) + "\n");
  };

  const handle = async (req: JsonRpcRequest): Promise<void> => {
    switch (req.method) {
      case "initialize":
        return respond(req.id, {
          protocolVersion: "2024-11-05",
          serverInfo,
          capabilities: { tools: {} },
        });
      case "notifications/initialized":
        return;
      case "tools/list":
        return respond(req.id, {
          tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        });
      case "tools/call": {
        const name = req.params?.name as string | undefined;
        const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
        const tool = tools.find((t) => t.name === name);
        if (!tool) return respondError(req.id, -32602, `Unknown tool: ${name}`);
        try {
          const result = await tool.call(args);
          return respond(req.id, {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: false,
          });
        } catch (err) {
          return respondError(req.id, -32000, (err as Error).message);
        }
      }
      default:
        return respondError(req.id, -32601, `Method not found: ${req.method}`);
    }
  };

  input.setEncoding?.("utf8");
  for await (const chunk of input) {
    buffer += chunk as string;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        await handle(JSON.parse(line) as JsonRpcRequest);
      } catch {
        respondError(null, -32700, "Parse error");
      }
    }
  }
}
