# Hivemind Memory MCP - Agent Context

This file provides architectural context and rules for any AI agent or LLM operating within this repository. 

## Project Overview
This repository contains a standalone **Model Context Protocol (MCP)** server. Its primary function is to provide IDEs (like Cursor, Claude Desktop, or VS Code) with persistent semantic memory using vector embeddings. 

## Architecture & Rules

1. **The MCP SDK**: All communication must strictly adhere to the official `@modelcontextprotocol/sdk`. We use `StdioServerTransport` for all I/O.
2. **Dual-Database Support**: The core functionality must unconditionally support two distinct database modes via the `DB_MODE` environment variable:
   - `sqlite` (Default): Uses a local `.db` file and raw Javascript cosine similarity math. DO NOT try to import `sqlite-vss` or any C-extensions. Keep the mathematical fallback lightweight.
   - `postgres`: Uses `pgvector` for enterprise scale (HNSW indexing).
3. **Embeddings Strategy**: This project explicitly avoids hardcoded cloud APIs (like OpenAI or Google) to remain local-first. We rely on a local `Ollama` instance (usually `http://localhost:11434/api/embeddings`) using the `nomic-embed-text` model. Any changes to the `embedText()` function must preserve this localized architecture.
4. **Environment Variables**: Always use `dotenv` and provide safe fallbacks for all connections.

## Development Workflows
- If adding a new capability, ensure it is exposed via the `ListToolsRequestSchema`.
- Always return explicit, human-readable strings inside the `content: [{ type: "text", text: ... }]` response block for `CallToolRequestSchema`. 

## Hazards
- **NEVER** log sensitive embeddings or massive vector arrays to `console.log()` as it will saturate the `stdio` pipe and crash the MCP transport. Error logs should only use `console.error()`.
