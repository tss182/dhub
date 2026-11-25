# DHub

[![Version](https://img.shields.io/badge/version-v0.3.19-blue.svg)](https://github.com/tss182/dhub/releases/latest)
[![Download](https://img.shields.io/badge/Download-GitHub%20Pages-10b981.svg)](https://tss182.github.io/dhub/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

A lightweight, high-performance, keyboard-first multi-database desktop client and SQL/NoSQL IDE built with **Go + Wails v3** and **React + TypeScript + Tailwind CSS v4 + Monaco Editor**.

Download the latest version (**v0.3.19**) for Windows, macOS, and Linux from the [DHub Download Page](https://tss182.github.io/dhub/) or [GitHub Releases](https://github.com/tss182/dhub/releases/latest).

For full usage instructions, engine-specific query guides, and troubleshooting, see the [User Guide](docs/USER_GUIDE.md) or press **`Ctrl+H`** (`⌘H`) inside the app to open the interactive **Help & User Guide**.

---

## Supported Database Engines (11 Drivers)

DHub supports relational SQL databases, analytical OLAP column stores, and specialized NoSQL & search engines out of the box:

| Engine | Default Port | Category & Tag | Highlights |
| :--- | :---: | :--- | :--- |
| **PostgreSQL** | `5432` | Relational (`SQL`) | Multi-database & multi-schema navigation, `pgvector` (`vector(N)` / `halfvec` / `hnsw` & `ivfflat` indexes), tables, views, materialized views, routines, triggers, indexes, `EXPLAIN ANALYZE`, user & role privileges |
| **MySQL** | `3306` | Relational (`SQL`) | Multi-database browsing, routines, triggers, indexes, `EXPLAIN`, user & privilege management |
| **MariaDB** | `3306` | Relational (`SQL`) | Full MariaDB dialect formatting, `ANALYZE` plans, and user/privilege management |
| **SQLite** | Local file | Relational (`SQL`) | Zero-config local file databases, schema designer, DDL viewer, and inline editing |
| **SQL Server (MSSQL)** | `1433` | Relational (`SQL`) | Multi-database & multi-schema (`dbo`, etc.) browsing, stored procedures/functions, T-SQL execution |
| **Oracle** | `1521` | Relational (`SQL`) | Schema browsing, tables, views, materialized views, routines, triggers, sequences, PL/SQL execution, and user/privilege management |
| **ClickHouse** | `9000` | Analytical & Columnar (`OLAP`) | High-speed column-oriented OLAP query execution, system catalog inspection, `EXPLAIN PIPELINE` |
| **MongoDB** | `27017` | Document (`Document`) | Collection browsing, BSON schema & index inference, Mongo Shell methods (`db.<coll>.find()`, `countDocuments()`, `insertOne()`, `deleteOne()`, `deleteMany()`, `drop()`), SQL-like `SELECT` syntax, raw JSON commands, and inline document editing |
| **Redis** | `6379` | Key-Value / Vector (`Key-Value`) | Logical database switcher (`db0`–`db15`), key scanner with type & TTL badges (`string`, `hash`, `list`, `set`, `zset`), **RediSearch (Redis Stack)** index inspection (`FT._LIST`, `FT.INFO`), `FT.SEARCH` KNN & `VECTOR_RANGE` similarity search, float32 vector decoding, inline document editing, and Redis CLI |
| **Qdrant** | `6333` | Vector (`Vector`) | Collection browsing, vector config & payload schema inspection, REST similarity search (`points/search`, `points/query`, `points/scroll`), pseudo-SQL (`SELECT`), compact vector previews, and inline point editing |
| **Elasticsearch** | `9200` | Search (`Search`) | Index browsing, `_mapping` & `dense_vector` inspection, Kibana-style REST DSL (`_search`, `knn`), native `/_sql` queries, pseudo-SQL (`SELECT`), and inline document editing |

---

## Key Features

### Connection Management & Security
- **Environment Safety Tags**: Tag connections as **Local**, **Development (`DEV`)**, or **Production (`PROD`)**. `DEV` (emerald) and `PROD` (rose) visually tint tabs, toolbars, and confirmation banners to prevent accidental production edits.
- **Read-Only Protection**: Lock connections in Read-Only mode to disable inline grid editing, imports, and mock data generation.
- **SSH Tunneling**: Connect securely through a bastion host using SSH key, password, or SSH agent authentication, with Trust-On-First-Use (TOFU) `known_hosts` verification.
- **SSL/TLS Support**: Configure SSL mode and custom CA, client certificate, and key files.
- **Credential Security**: Passwords and SSH secrets are stored in your OS Keyring (with encrypted AES-GCM local storage fallback).

### Database Explorer & Schema Tools
- **Organized Tree & Folders**: Group connections into color-coded folders and reorder them with drag-and-drop.
- **Database Visibility Filter (`X of Y`)**: Choose which databases appear in the explorer tree, Search Everywhere, and database switchers.
- **Table Structure Designer**: Visually inspect, create, or alter table columns, primary keys, foreign keys, indexes, check constraints, and generated DDL.
- **ER Diagram View**: Interactive canvas visualizing tables, columns, primary keys, and foreign-key relationships with zoom, pan, search, and node dragging.
- **Schema Diff & Migration SQL**: Compare two databases or schemas across connections and generate migration DDL statements directly into a Query Console.
- **User & Privilege Manager**: Inspect and manage database users, roles, and object/admin privileges for supported engines.

### Intelligent Query Console
- **Context-Aware SQL Autocomplete**: Suggests tables, views, column names, table aliases, foreign-key join conditions, SQL functions, and snippets.
- **Dynamic Parameter Binding**: Use `:param_name`, `$1`, or `?` placeholders in queries and fill values interactively in a prompt before execution.
- **Dangerous Query Guard**: Intercepts `UPDATE` or `DELETE` statements missing a `WHERE` clause (with extra warnings on `PROD` connections).
- **Transaction Control (`Tx: AUTO` / `Tx: MANUAL`)**: Switch between auto-commit and manual transaction mode with one-click `Commit` and `Rollback` buttons and live status indicators.
- **SQL Formatting & Explain Plans**: Format SQL (`Shift+Alt+F`) according to the active engine dialect and inspect `EXPLAIN` / `EXPLAIN ANALYZE` execution plans.
- **Query History, Snippets & Syntax Cheat-Sheet**: Re-run past queries, bookmark reusable SQL snippets, and open the driver-aware **Syntax & Help** popover right in the console toolbar.
- **Quick Console Switcher & Tab Context Menu**: Click the **`+`** button next to the rightmost tab—or right-click any table tab and open **Console**—to create a **New Console** on the active connection and database/schema or jump directly to any existing console on that connection.

### High-Performance Data Grid
- **Pagination & Infinite Lazy-Load**: Switch between numbered pages and continuous scroll loading with customizable batch sizes (`10`–`5000` rows).
- **Inline Editing & DML Preview**: Edit cells, duplicate rows (`Ctrl+D`), or mark rows for deletion (`Delete`). Preview exact generated SQL/Mongo statements before applying (`Ctrl+S`) or reverting (`Esc`).
- **Filtering, Sorting & Freezing**: Apply custom `WHERE` filters, multi-column sorting, and freeze key columns while scrolling horizontally.
- **Value Viewer (`Ctrl+T` / `⌘T`)**: Inspect and edit long text, JSON, or multi-line values in a dedicated side panel.
- **Smart Copy Formats**: Copy selected cells or rows as **CSV**, **JSON**, **SQL INSERT**, **SQL UPDATE**, or **SQL UPSERT**.
- **Export, Import & Mock Data**: Export data to CSV/JSON/SQL, import CSV files with column mapping, or generate realistic mock rows for testing.

### Workspaces & Portable Backup
- **Workspaces**: Save and switch between distinct tab/console workspace sessions.
- **Import & Export Configuration**: Back up application settings, folders, and connections (optionally including credentials) to a portable JSON file.
- **In-App Help & Auto-Updates**: Press `Ctrl+H` (`⌘H`) anytime for the interactive User Guide, and check for GitHub Releases updates from Settings.

---

## Keyboard Shortcuts

### Global & Navigation
| Action | Windows / Linux | macOS |
| :--- | :--- | :--- |
| **Open Help & User Guide** | `Ctrl+H` | `⌘H` |
| **Search Everywhere** | `Ctrl+P` | `⌘P` |
| **Toggle Left Sidebar (Explorer / Workspaces)** | `Ctrl+B` | `⌘B` |
| **Toggle Right Sidebar (Consoles / Views)** | `Ctrl+R` | `⌘R` |
| **Open Settings & Preferences** | `Ctrl+I` | `⌘I` |
| **Close Active Tab** | `Ctrl+W` | `⌘W` |

### Query Console & SQL Editor
| Action | Windows / Linux | macOS |
| :--- | :--- | :--- |
| **Execute Query at Cursor / Selection** | `Ctrl+Enter` | `⌘Enter` |
| **Execute All Statements in Editor** | `Ctrl+Shift+Enter` | `⌘Shift+Enter` |
| **Stop Running Query** | `Ctrl+Shift+D` | `⌘Shift+D` |
| **Format SQL Code** | `Shift+Alt+F` | `Shift+Alt+F` |
| **Revert / Close Popovers & Modals** | `Esc` | `Esc` |

### Data Grid & Cell Editing
| Action | Windows / Linux | macOS |
| :--- | :--- | :--- |
| **Apply Staged Grid Changes** | `Ctrl+S` | `⌘S` |
| **Duplicate Active Grid Row** | `Ctrl+D` | `⌘D` |
| **Delete Active Grid Row** | `Delete` | `⌘⌫` |
| **Toggle Value Viewer (`Views`)** | `Ctrl+T` | `⌘T` |
| **Copy Selected Cells** | `Ctrl+C` | `⌘C` |
| **Copy As Format Dialog** | `Ctrl+Shift+C` | `⌘Shift+C` |
| **Paste Data into Grid** | `Ctrl+V` | `⌘V` |
| **Revert / Cancel Edits or Close Modal** | `Esc` | `Esc` |

---

## Development & Running

### Prerequisites
- **Go** `1.26+`
- **Node.js** & **npm**
- **Wails v3 CLI** (`wails3`)

### Commands

```bash
# Start development mode with hot-reload
wails3 dev

# Build production binary (output in bin/)
wails3 build

# Regenerate TypeScript bindings after changing Go service structs/methods
wails3 generate bindings
```

### Frontend Build Check

```bash
cd frontend
npm install
npm run build
```

---

## Testing

```bash
# Run Go unit tests (no external database server required)
go test ./...

# Start local PostgreSQL (:55432), MySQL (:53306) and MariaDB (:53307) containers for integration testing
docker compose up -d

# MySQL / MariaDB integration suite (skipped when the server is unreachable)
# Override the DSN with DHUB_MYSQL_DSN / DHUB_MARIADB_DSN
go test -tags integration ./internal/driver/mysql/... ./internal/driver/mariadb/...
```

`docker compose` provisions PostgreSQL with two databases (`dhub` and `dhub_extra`) to verify multi-database browsing within a single connection, along with MySQL (`dhub`) and MariaDB (`dhub`).

---

## Project Structure

- `main.go` — Wails v3 application entry point, window setup, event and service registration
- `internal/driver/` — `DatabaseDriver` interface and implementations for `postgres`, `mysql`, `sqlite`, `mariadb`, `mssql`, `oracle`, `clickhouse`, `mongodb`, `redis`, `qdrant`, and `elasticsearch`
- `internal/manager/` — Active session and connection pool manager (including SSH tunnel lifecycle)
- `internal/services/` — Wails RPC services (`ConnectionService`, `SchemaService`, `QueryService`, `WorkspaceService`, `ExportService`, `UpdateService`)
- `internal/store/` — Local SQLite persistence for connections, folders, worksheets, snippets, query history, workspaces, and schema cache
- `internal/tunnel/` — SSH tunnel manager with Trust-On-First-Use (TOFU) `known_hosts` verification
- `frontend/` — React + TypeScript + Tailwind CSS v4 + Monaco Editor UI
- `docs/USER_GUIDE.md` — Comprehensive English user manual

---

## License

Copyright (C) 2026 **Triyana Suryapraja Sukmana** (<triyana.ss.136@gmail.com>)

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)** — see the [LICENSE](LICENSE) file for details.
