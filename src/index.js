#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import pkg from 'pg';
const { Pool } = pkg;
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// Configuration
const DB_MODE = process.env.DB_MODE || "sqlite"; // "sqlite" or "postgres"
const PG_URL = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5441/hivemind_memory";
const SQLITE_FILE = process.env.SQLITE_FILE || "./hivemind_memory.db";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text";

let pgPool = null;
let sqliteDb = null;

/**
 * Initialize Database Connection based on DB_MODE
 */
async function initDb() {
  if (DB_MODE === 'postgres') {
    pgPool = new Pool({ connectionString: PG_URL });
    console.error(`[ide-memory-mcp] Connected to PostgreSQL at ${PG_URL}`);
  } else {
    sqliteDb = await open({
      filename: SQLITE_FILE,
      driver: sqlite3.Database
    });
    // Create sqlite schema if not exists
    await sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS hivemind_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.error(`[hivemind-memory-mcp] Connected to local SQLite at ${SQLITE_FILE}`);
  }
}

/**
 * Generate embeddings using a local Ollama instance.
 */
async function embedText(text) {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBED_MODEL,
        prompt: text
      })
    });
    
    if (!res.ok) {
      throw new Error(`Ollama API returned ${res.status}`);
    }
    
    const data = await res.json();
    return data.embedding; // Returns raw JS array
  } catch (err) {
    throw new Error(`Embedding Generation Failed: Make sure Ollama is running and '${EMBED_MODEL}' is pulled. Error: ${err.message}`);
  }
}

/**
 * Cosine Similarity for SQLite array comparisons
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Setup MCP Server
const server = new Server({ name: "hivemind-memory-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

// Register Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "add_memory",
        description: "Add a new fact or memory to the persistent IDE database. Use this strictly to document bugs, priorities, lessons, or project outcomes.",
        inputSchema: {
          type: "object",
          properties: {
            category: { type: "string", enum: ['priorities', 'bugs', 'outcomes', 'lessons', 'activity'] },
            content: { type: "string" }
          },
          required: ["category", "content"]
        }
      },
      {
        name: "search_memory",
        description: "Search the persistent IDE database for past lessons, bugs, priorities, or project outcomes via semantic embeddings.",
        inputSchema: {
          type: "object",
          properties: {
            category: { type: "string", enum: ['priorities', 'bugs', 'outcomes', 'lessons', 'activity'] },
            query: { type: "string" },
            limit: { type: "number", default: 3 }
          },
          required: ["category", "query"]
        }
      }
    ]
  };
});

// Tool Call Execution Handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments || {};
  
  try {
    if (request.params.name === "add_memory") {
      const { category, content } = args;
      if (!category || !content) throw new McpError(ErrorCode.InvalidParams, "Missing params");

      const embeddingArray = await embedText(content);
      
      if (DB_MODE === 'postgres') {
        const client = await pgPool.connect();
        try {
          const embeddingStr = `[${embeddingArray.join(',')}]`;
          await client.query(`
            INSERT INTO hivemind_memory (category, content, embedding)
            VALUES ($1, $2, $3::vector)
          `, [category, content, embeddingStr]);
        } finally {
          client.release();
        }
      } else {
        await sqliteDb.run(`
          INSERT INTO ide_agent_memory (category, content, embedding)
          VALUES (?, ?, ?)
        `, [category, content, JSON.stringify(embeddingArray)]);
      }

      return { content: [{ type: "text", text: `[Hivemind Memory] ✅ Successfully saved memory to category: ${category}` }] };

    } else if (request.params.name === "search_memory") {
      const { category, query: searchQuery, limit = 3 } = args;
      if (!category || !searchQuery) throw new McpError(ErrorCode.InvalidParams, "Missing params");

      const embeddingArray = await embedText(searchQuery);

      let results = [];
      if (DB_MODE === 'postgres') {
        const client = await pgPool.connect();
        try {
          const embeddingStr = `[${embeddingArray.join(',')}]`;
          const res = await client.query(`
            SELECT content, 1 - (embedding <=> $1::vector) as similarity
            FROM hivemind_memory
            WHERE category = $2
            ORDER BY embedding <=> $1::vector
            LIMIT $3
          `, [embeddingStr, category, limit]);
          results = res.rows;
        } finally {
          client.release();
        }
      } else {
        const rows = await sqliteDb.all(`SELECT content, embedding FROM hivemind_memory WHERE category = ?`, [category]);
        const scoredRows = rows.map(r => {
          const dbVec = JSON.parse(r.embedding);
          return {
            content: r.content,
            similarity: cosineSimilarity(embeddingArray, dbVec)
          };
        });
        scoredRows.sort((a, b) => b.similarity - a.similarity);
        results = scoredRows.slice(0, limit);
      }

      if (results.length === 0) {
        return { content: [{ type: "text", text: `=== 🧠 Memory Retrieval: ${category} ===\n\nNo results found.` }] };
      }

      let output = `=== 🧠 Memory Retrieval: ${category} ===\n`;
      for (const r of results) {
        output += `\n--- Match (Score: ${Number(r.similarity).toFixed(2)}) ---\n${r.content}\n`;
      }
      return { content: [{ type: "text", text: output }] };

    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
  } catch (err) {
    return { content: [{ type: "text", text: `[Error] ${err.message}` }], isError: true };
  }
});

// Start Server
async function main() {
  await initDb();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error("[Fatal]", err);
  process.exit(1);
});
