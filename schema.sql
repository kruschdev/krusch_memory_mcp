-- Enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the memory table
CREATE TABLE IF NOT EXISTS krusch_memory (
    id SERIAL PRIMARY KEY,
    project VARCHAR(255),
    category VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    embedding vector(768), -- Default Nomic text embedding dimension
    tags TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create an index for vector similarity search (HNSW for speed)
CREATE INDEX IF NOT EXISTS memory_embedding_idx ON krusch_memory USING hnsw (embedding vector_cosine_ops);
