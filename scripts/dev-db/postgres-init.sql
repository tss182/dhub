-- Second database to exercise multi-database browsing on a single PostgreSQL connection.
CREATE DATABASE dhub_extra OWNER dhub;

\connect dhub
CREATE TABLE users (
    id    SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    org   TEXT
);
CREATE TABLE posts (
    id      SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title   TEXT
);
CREATE INDEX idx_users_org_email ON users (org, email);
COMMENT ON TABLE users IS 'Application users';
COMMENT ON COLUMN users.email IS 'Login e-mail';

-- Optional pgvector 0.7/0.8+ test fixture (runs only when vector extension is available)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS pgvector_test_docs (
            id          SERIAL PRIMARY KEY,
            title       TEXT NOT NULL,
            content     TEXT NOT NULL,
            tsv         tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
            embedding   vector(1536),
            half_emb    halfvec(768),
            sparse_emb  sparsevec(1000),
            bin_emb     bit(128)
        );
        CREATE INDEX IF NOT EXISTS idx_pgvec_docs_tsv ON pgvector_test_docs USING gin (tsv);
        CREATE INDEX IF NOT EXISTS idx_pgvec_docs_emb_hnsw ON pgvector_test_docs USING hnsw (embedding vector_cosine_ops);
        CREATE INDEX IF NOT EXISTS idx_pgvec_docs_bin_expr ON pgvector_test_docs USING hnsw ((binary_quantize(embedding)::bit(1536)) bit_hamming_ops);
        CREATE INDEX IF NOT EXISTS idx_pgvec_docs_half_hnsw ON pgvector_test_docs USING hnsw (half_emb halfvec_l2_ops);
        CREATE INDEX IF NOT EXISTS idx_pgvec_docs_sparse_hnsw ON pgvector_test_docs USING hnsw (sparse_emb sparsevec_ip_ops);
        CREATE INDEX IF NOT EXISTS idx_pgvec_docs_bit_hnsw ON pgvector_test_docs USING hnsw (bin_emb bit_hamming_ops);
    END IF;
END $$;

\connect dhub_extra
CREATE TABLE only_in_extra (id SERIAL PRIMARY KEY, note TEXT);
INSERT INTO only_in_extra (note) VALUES ('hello from dhub_extra');

