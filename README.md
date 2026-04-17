# Hivemind Memory MCP

This is a Model Context Protocol (MCP) server that provides your IDE AI assistants (like Claude Desktop or Cursor) with long-term, semantic memory. Instead of your agent forgetting previous bugs, lessons, or project outcomes when you close the editor, it can retrieve them using vector embeddings.

## Features
- Native semantic search (Cosine Similarity).
- Pluggable Database engines (SQLite or PostgreSQL/pgvector).
- 100% local embedding generation via Ollama (No API keys needed).

## Prerequisites

Because this MCP generates embeddings 100% locally to protect your codebase privacy, you **must** have Ollama installed and running.

1. Install [Ollama](https://ollama.com/).
2. Pull the required text embedding model by running:
   ```bash
   ollama pull nomic-embed-text
   ```

## Installation

```bash
npm install
```

## Database Modes

This server supports two database modes, controlled by the `DB_MODE` environment variable.

### 1. SQLite Mode (Default & Recommended for Personal Use)
```bash
DB_MODE=sqlite
```
**Why use it?** Perfect for personal developers. It creates a local `hivemind_memory.db` file without needing Docker or a database server. 
**How it works:** It uses a raw JavaScript mathematical fallback to calculate Cosine Similarity across all your memories. This is extremely fast (1-5ms) for up to ~10,000 memories, which is more than enough for a standard developer's bug and lesson log.

### 2. PostgreSQL (pgvector) Mode (For Enterprise / Huge Workspaces)
```bash
DB_MODE=postgres
DATABASE_URL=postgres://postgres:postgres@localhost:5441/hivemind_memory
```
**Why use it?** The main reason we use PostgreSQL is **scale**. If your agent is automatically logging every single file diff, chat interaction, and architectural decision, your memory table will grow to hundreds of thousands of vectors. 
**How it works:** Instead of checking every vector one by one, `pgvector` uses native C-based HNSW (Hierarchical Navigable Small World) indexing to find the closest match instantly, saving massive amounts of compute.

You can start the bundled Postgres database by running:
```bash
docker-compose up -d
```

## Integrating with Claude Desktop / IDEs

### 1. Using SQLite (Default)
Add this to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "hivemind-memory": {
      "command": "node",
      "args": ["/absolute/path/to/hivemind-memory-mcp/src/index.js"],
      "env": {
        "DB_MODE": "sqlite",
        "OLLAMA_URL": "http://localhost:11434",
        "EMBED_MODEL": "nomic-embed-text"
      }
    }
  }
}
```

### 2. Using PostgreSQL (Enterprise Scale)
If you spun up the `pgvector` docker container and want to use it instead, add this:
```json
{
  "mcpServers": {
    "hivemind-memory": {
      "command": "node",
      "args": ["/absolute/path/to/hivemind-memory-mcp/src/index.js"],
      "env": {
        "DB_MODE": "postgres",
        "DATABASE_URL": "postgres://postgres:postgres@localhost:5441/hivemind_memory",
        "OLLAMA_URL": "http://localhost:11434",
        "EMBED_MODEL": "nomic-embed-text"
      }
    }
  }
}
```

---

## About the Project
**Hivemind Memory MCP** was built by [kruschdev](https://github.com/kruschdev) as part of the Krusch Homelab ecosystem. It is designed to bridge the gap between ephemeral IDE chat sessions and true, persistent agentic memory.

If you find this useful for your local workflows, feel free to star the repository or reach out!
