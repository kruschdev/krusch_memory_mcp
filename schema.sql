-- Enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the memory table
CREATE TABLE IF NOT EXISTS hivemind_memory (
    id SERIAL PRIMARY KEY,
    category VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    embedding vector(768), -- Default Nomic text embedding dimension
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create an index for vector similarity search (HNSW for speed)
CREATE INDEX IF NOT EXISTS memory_embedding_idx ON hivemind_memory USING hnsw (embedding vector_cosine_ops);
