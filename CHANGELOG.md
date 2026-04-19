# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-04-19

### Changed
- **Performance**: Optimized the PostgreSQL `search_memory` query using a Common Table Expression (CTE) to fully utilize `pgvector`'s HNSW index, drastically speeding up queries on large datasets.
- **Performance**: Optimized the raw JavaScript `cosineSimilarity` fallback function (used in SQLite mode) to cache array lengths and combine square root computations for faster execution.

## [0.1.0] - 2026-04-19

### Added
- **Initial Open Source Release!**
- Dual SQLite and PostgreSQL (`pgvector`) support for scaling from solo developers to high-throughput autonomous swarms.
- Exponential Temporal Decay algorithm to ensure agents prioritize recent memories over outdated architectural decisions.
- Vector semantic search (`search_memory`) with automatic category filtering (`priorities`, `bugs`, `outcomes`, `lessons`, `activity`).
- Local-first architecture using Ollama and `nomic-embed-text` for absolute privacy.
- Included `.agent/templates/INFLIGHT.md` starter template to establish the `/close` and `/continue` agent workflow.
- Included `krusch-memory-demo` command to instantly verify DB and Ollama health upon installation.
- Support for Headless Agents (OpenClaw / Hermes) via standard `mcpServers` JSON config.
