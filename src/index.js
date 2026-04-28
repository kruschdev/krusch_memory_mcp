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
const PG_URL = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5441/krusch_memory";
const SQLITE_FILE = process.env.SQLITE_FILE || "./krusch_memory.db";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text";
const AUTO_TAG = process.env.AUTO_TAG === "true";
const TAG_MODEL = process.env.TAG_MODEL || "llama3.2";
const DECAY_RATE = parseFloat(process.env.DECAY_RATE || "0.01");

let pgPool = null;
let sqliteDb = null;

/**
 * Initialize Database Connection based on DB_MODE
 */
async function initDb() {
  if (DB_MODE === 'postgres') {
    pgPool = new Pool({ connectionString: PG_URL });
    try {
      await pgPool.query(`ALTER TABLE krusch_memory ADD COLUMN project VARCHAR(255)`);
    } catch (e) {
      // Ignore if column already exists
    }
    console.error(`[ide-memory-mcp] Connected to PostgreSQL at ${PG_URL}`);
  } else {
    sqliteDb = await open({
      filename: SQLITE_FILE,
      driver: sqlite3.Database
    });
    // Create sqlite schema if not exists
    await sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS krusch_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        tags TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Safe schema migration for older sqlite files
    try {
      await sqliteDb.exec(`ALTER TABLE krusch_memory ADD COLUMN tags TEXT`);
    } catch (e) {
      // Ignore if column already exists
    }
    try {
      await sqliteDb.exec(`ALTER TABLE krusch_memory ADD COLUMN project TEXT`);
    } catch (e) {
      // Ignore if column already exists
    }
    
    console.error(`[krusch-memory-mcp] Connected to local SQLite at ${SQLITE_FILE}`);
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
 * Generate tags using Ollama if AUTO_TAG is true.
 */
async function generateTags(text) {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TAG_MODEL,
        prompt: `Extract 3 to 5 concise keywords or tags from the following text. Respond ONLY with a comma-separated list of tags, nothing else.\n\nText: "${text}"`,
        stream: false
      })
    });
    
    if (!res.ok) {
      throw new Error(`Ollama Tag Generation returned ${res.status}`);
    }
    
    const data = await res.json();
    // Split by comma, trim whitespace
    const tags = data.response.split(',').map(t => t.trim()).filter(t => t.length > 0);
    return JSON.stringify(tags);
  } catch (err) {
    console.error(`[Krusch Memory] Warning: Tag generation failed: ${err.message}`);
    return null;
  }
}

/**
 * Cosine Similarity for SQLite array comparisons
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  const len = vecA.length;
  for (let i = 0; i < len; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / Math.sqrt(normA * normB);
}

// Setup MCP Server
const server = new Server({ name: "krusch-memory-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

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
            project: { type: "string", description: "Optional. The name of the current project (e.g., 't3code-dbos'). Helps prevent cross-project memory confusion." },
            category: { type: "string", enum: ['priorities', 'bugs', 'outcomes', 'lessons', 'activity'] },
            content: { type: "string" },
            tags: { type: "array", items: { type: "string" }, description: "Optional tags. If omitted and AUTO_TAG is true, tags will be generated automatically." }
          },
          required: ["category", "content"]
        }
      },
      {
        name: "health_check",
        description: "Verify that the Krusch Memory MCP server is alive and functioning.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "search_memory",
        description: "Search the persistent IDE database for past lessons, bugs, priorities, or project outcomes via semantic embeddings.",
        inputSchema: {
          type: "object",
          properties: {
            active_project: { type: "string", description: "Optional. The name of the current project. Memories from this project will receive a slight relevance boost." },
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
      const { category, content, tags, project } = args;
      if (!category || !content) throw new McpError(ErrorCode.InvalidParams, "Missing params");

      const embeddingArray = await embedText(content);
      
      let finalTags = tags ? JSON.stringify(tags) : null;
      if (!finalTags && AUTO_TAG) {
        finalTags = await generateTags(content);
      }
      
      console.error(`[Krusch Memory] 📝 Storing new memory in category: ${category}...`);
      
      if (DB_MODE === 'postgres') {
        const client = await pgPool.connect();
        try {
          const embeddingStr = `[${embeddingArray.join(',')}]`;
          await client.query(`
            INSERT INTO krusch_memory (project, category, content, embedding, tags)
            VALUES ($1, $2, $3, $4::vector, $5)
          `, [project || null, category, content, embeddingStr, finalTags]);
        } finally {
          client.release();
        }
      } else {
        await sqliteDb.run(`
          INSERT INTO krusch_memory (project, category, content, embedding, tags)
          VALUES (?, ?, ?, ?, ?)
        `, [project || null, category, content, JSON.stringify(embeddingArray), finalTags]);
      }

      console.error(`[Krusch Memory] ✅ Successfully stored memory.`);
      return { content: [{ type: "text", text: `[Krusch Memory] ✅ Successfully saved memory to category: ${category}` }] };

    } else if (request.params.name === "search_memory") {
      const { category, query: searchQuery, limit = 3, active_project } = args;
      if (!category || !searchQuery) throw new McpError(ErrorCode.InvalidParams, "Missing params");

      console.error(`[Krusch Memory] 🔍 Searching category '${category}' for: "${searchQuery}"...`);

      const embeddingArray = await embedText(searchQuery);

      let results = [];
      if (DB_MODE === 'postgres') {
        const client = await pgPool.connect();
        try {
          const embeddingStr = `[${embeddingArray.join(',')}]`;
          const res = await client.query(`
            WITH semantic_matches AS (
              SELECT project, content, tags, created_at, embedding <=> $1::vector as distance
              FROM krusch_memory
              WHERE category = $2
              ORDER BY embedding <=> $1::vector
              LIMIT 100
            )
            SELECT 
              project,
              content, 
              tags, 
              created_at,
              ((1 - distance) + CASE WHEN project = $5 THEN 0.1 ELSE 0 END) * exp(-$4::float * EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at))/86400) as similarity
            FROM semantic_matches
            ORDER BY similarity DESC
            LIMIT $3
          `, [embeddingStr, category, limit, DECAY_RATE, active_project || null]);
          results = res.rows;
        } finally {
          client.release();
        }
      } else {
        const rows = await sqliteDb.all(`SELECT project, content, tags, created_at, embedding FROM krusch_memory WHERE category = ?`, [category]);
        const now = new Date();
        const scoredRows = rows.map(r => {
          const dbVec = JSON.parse(r.embedding);
          const createdAt = new Date(r.created_at);
          const ageInDays = (now - createdAt) / (1000 * 60 * 60 * 24);
          const baseSimilarity = cosineSimilarity(embeddingArray, dbVec) + (active_project && r.project === active_project ? 0.1 : 0);
          const similarity = baseSimilarity * Math.exp(-DECAY_RATE * ageInDays);
          return {
            project: r.project,
            content: r.content,
            tags: r.tags,
            created_at: r.created_at,
            similarity: similarity
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
        let tagsStr = '';
        if (r.tags) {
          try { tagsStr = ` [Tags: ${JSON.parse(r.tags).join(', ')}]`; } catch(e) {}
        }
        const dateStr = r.created_at ? new Date(r.created_at).toISOString().split('T')[0] : 'unknown';
        const projectStr = r.project ? ` | Project: ${r.project}` : '';
        output += `\n--- Match (Score: ${Number(r.similarity).toFixed(2)}) | Date: ${dateStr}${projectStr}${tagsStr} ---\n${r.content}\n`;
      }
      return { content: [{ type: "text", text: output }] };

    } else if (request.params.name === "health_check") {
      return { content: [{ type: "text", text: `[Krusch Memory] 🟢 Server is healthy. Mode: ${DB_MODE}` }] };
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
