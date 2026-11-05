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

\connect dhub_extra
CREATE TABLE only_in_extra (id SERIAL PRIMARY KEY, note TEXT);
INSERT INTO only_in_extra (note) VALUES ('hello from dhub_extra');

