import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { loadCorpConfigs } from "./core/config/loader.js";
import { CorpContext } from "./core/config/manager.js";
import { createSealClient } from "./core/http/factory.js";
import { resolveLiveSealEnterpriseConfig } from "./domains/seal/source.js";
import { findSealMcpTool, findSealTool, sealMcpTools } from "./domains/seal/tools.js";

async function main() {
  const corps = loadCorpConfigs();
  const corpContext = new CorpContext(corps);

  const server = new Server(
    {
      name: "seal-home",
      version: "0.3.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "seal_corp_switch",
        description: "切换当前 Seal 企业",
        inputSchema: {
          type: "object",
          properties: {
            corpId: { type: "string", description: "企业配置 ID" }
          },
          required: ["corpId"]
        }
      },
      ...sealMcpTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: z.toJSONSchema(tool.parameters)
      }))
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    corpContext.refresh(loadCorpConfigs());

    if (name === "seal_corps_list") {
      return textResult(corpContext.listCorps());
    }

    if (name === "seal_corp_switch") {
      const { corpId } = args as { corpId: string };
      const success = corpContext.switchCorp(corpId);
      return textResult(
        success ? { success: true, current: corpId } : { success: false, message: `Unknown corp: ${corpId}` },
        !success
      );
    }

    const currentCorp = corpContext.getCurrent();
    if (!currentCorp) {
      return textResult(
        {
          error:
            "No enterprise config loaded. Add a non-example JSON file under enterprises/."
        },
        true
      );
    }

    try {
      if (name === "seal_source_config") {
        return textResult(await resolveLiveSealEnterpriseConfig(currentCorp));
      }

      const tool = findSealMcpTool(name) ?? findSealTool(name);
      if (!tool) {
        return textResult({ error: `Unknown tool: ${name}` }, true);
      }

      const client = await createSealClient(currentCorp);
      const result = await tool.handler(client, args as never, { corp: currentCorp });
      return textResult(result);
    } catch (error) {
      return textResult(
        { error: error instanceof Error ? error.message : String(error) },
        true
      );
    }
  });

  await server.connect(new StdioServerTransport());
  console.error("seal-home MCP server running on stdio");
}

function textResult(value: unknown, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ],
    isError
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
