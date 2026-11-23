# DHub User Guide

Welcome to **DHub**, a fast, keyboard-first multi-database desktop IDE for SQL and NoSQL workflows. This guide explains every feature, shortcut, and database-specific query convention available in DHub.

> **Tip inside the app:** Press **`Ctrl+H` / `⌘H`** at any time to open the interactive **Help & User Guide** modal, or click **Syntax & Help** inside any Query Console toolbar for driver-specific query examples.

---

## Table of Contents

1. [Getting Started & Creating Connections](#1-getting-started--creating-connections)
2. [Navigating the Workbench](#2-navigating-the-workbench)
3. [Using the Query Console](#3-using-the-query-console)
4. [Engine-Specific Query Guides (SQL, MongoDB, Redis)](#4-engine-specific-query-guides-sql-mongodb-redis)
5. [Working with the Data Grid](#5-working-with-the-data-grid)
6. [Schema & Administration Tools](#6-schema--administration-tools)
7. [Workspaces, Settings & Backup](#7-workspaces-settings--backup)
8. [Keyboard Shortcuts Reference](#8-keyboard-shortcuts-reference)
9. [FAQ & Troubleshooting](#9-faq--troubleshooting)

---

## 1. Getting Started & Creating Connections

### Adding Your First Connection
1. Open the **Explorer** sidebar (`Ctrl+B` / `⌘B` if collapsed) and click **New Connection** (`+`), or click **New Connection** on the empty workbench screen.
2. Click the **Driver** selector to pick your database engine from the Driver Picker modal:
   - **Relational (`SQL`):** SQLite, PostgreSQL, MySQL, MariaDB, SQL Server (MSSQL), Oracle
   - **Analytical & Columnar (`OLAP`):** ClickHouse
   - **NoSQL & Search Engines:**
     - **Document (`Document`):** MongoDB
     - **Key-Value (`Key-Value`):** Redis / Redis Stack
     - **Vector (`Vector`):** Qdrant
     - **Search (`Search`):** Elasticsearch
3. Fill in the connection parameters:
   - **SQLite:** Browse or enter the `.db` / `.sqlite` file path.
   - **Network Databases:** Enter **Host**, **Port**, **Username**, **Password**, and optional **Database Name**.
4. Click **Test Connection** to verify connectivity before saving.

### Environment Safety Badges (`LOCAL` / `DEV` / `PROD`)
Assign an environment type to every connection in the Connection Dialog:
- **Local:** Neutral dark styling.
- **Development (`DEV`):** Emerald accent on tabs, worksheet toolbars, and table headers.
- **Production (`PROD`):** Rose-red accent across tabs, toolbars, table headers, and extra confirmation warnings when running potentially destructive queries.

### Security Tabs in Connection Dialog
- **SSH Tunnel:** Enable SSH tunneling to reach private databases through a bastion server. Supports **Private Key**, **Password**, or **SSH Agent** authentication. DHub verifies SSH host keys using Trust-On-First-Use (`known_hosts`) stored locally.
- **SSL / TLS:** Choose SSL modes (`disable`, `require`, `verify-ca`, `verify-full`, etc.) and attach custom CA, Client Certificate, and Client Key files.
- **Advanced:**
  - **Read-Only Mode:** Blocks inline cell edits, row inserts/deletes, CSV imports, and mock data generation on that connection.
  - **Transaction Mode:** Set default console behavior to `Auto-Commit` or `Manual`.

---

## 2. Navigating the Workbench

DHub uses a clean four-zone layout:

### Left Sidebar (`Ctrl+B` / `⌘B`)
- **Explorer Tab:** Browse Folders, Connections, Databases, Schemas (PostgreSQL/MSSQL), Tables, Views, Materialized Views, Routines, Triggers, and Sequences.
  - Right-click any node for context actions: **New Query Console**, **Create Table**, **Edit Structure**, **ER Diagram**, **User Management**, **Database Visibility Filter**, **Export/Import**, and **Refresh**.
  - Click the **`X of Y`** database badge next to a connection to hide or show specific databases in the tree and search results.
  - Drag and drop connections or folders to organize and reorder your tree.
- **Workspaces Tab:** Save, switch, and manage independent workspace sessions with their own open tabs.

### Center Workbench
- **Tab Bar:** Displays active Table Data views, Query Consoles, ER Diagrams, and User Manager tabs.
  - Drag tabs to reorder them.
  - Right-click any tab to **Rename**, **Duplicate Console**, **Copy SQL**, **Reload Data**, or close tabs.
  - When many tabs are open, click **`>> N`** on the right edge of the tab bar to filter and jump to overflow tabs.
- **Header Bar:** Quick access to **Workspace Selector** and the **Settings & Tools** gear menu (**Settings (`Ctrl+I` / `⌘I`)**, **Snippets**, **Schema Diff**, and **Help (`Ctrl+H` / `⌘H`)**).

### Bottom Services Panel (Query Console Tabs)
- **Query Result:** Displays tabular results (and multiple result tabs when executing multi-statement scripts). Includes a 1-click **Copy SQL** pill.
- **Output Log:** Shows timestamped execution logs, affected row counts, and timings.
- **Query History:** Search and filter past queries across connections; insert back into the editor or re-execute immediately.
- **Explain Plan:** Visualizes execution plan output from `EXPLAIN` or `EXPLAIN ANALYZE`.

### Right Sidebar (`Ctrl+R` / `⌘R`)
- **Console Tab:** Manage saved SQL/Query worksheets grouped across connections.
- **Views Tab (`Ctrl+T` / `⌘T`):** Inspect and edit the currently selected Data Grid cell value in full text, formatted JSON, or multi-line view.

---

## 3. Using the Query Console

### Executing Queries
- Place your cursor inside a SQL statement (delimited by `;`) or highlight a block of text and press **`Ctrl+Enter` / `⌘Enter`** (or click **Run**).
- Press **`Ctrl+Shift+D` / `⌘Shift+D`** (or click **Stop**) to cancel an active query.

### Context-Aware Autocomplete
As you type in a SQL Console, DHub automatically suggests:
- Tables and views in the active database/schema
- Column names and types (with primary-key indicators)
- Columns scoped to table aliases (`SELECT u.email FROM users u`)
- Foreign-key `JOIN` conditions (`JOIN orders o ON o.user_id = u.id`)
- SQL keywords, aggregate/window functions, and snippets

### Dynamic Query Parameters
Include placeholders in your SQL to prompt for parameter values at runtime:
- **Named:** `SELECT * FROM orders WHERE customer_id = :customer_id AND status = :status;`
- **Positional:** `SELECT * FROM users WHERE id = $1;`
- **Anonymous:** `SELECT * FROM logs WHERE level = ?;`

### Manual vs. Auto Transactions
Click **`Tx: AUTO`** / **`Tx: MANUAL`** in the worksheet toolbar to toggle transaction handling per tab:
- In **Manual Mode**, the first executed statement opens a transaction. Use **Commit** or **Rollback** in the toolbar to finalize or discard changes.
- The bottom status bar displays `Tx: MANUAL (ACTIVE: N)` whenever uncommitted statements exist. Closing a tab with an open transaction automatically rolls it back safely.

### Dangerous Query Protection
If you execute an `UPDATE` or `DELETE` statement without a `WHERE` clause, DHub pauses and displays a confirmation dialog showing the exact statement and an extra **PRODUCTION** warning banner if applicable.

### Explain Plans & SQL Formatting
- Click **Explain** (or use the split arrow for **Explain Analyze**) to inspect query plans in the **Explain Plan** bottom tab.
- Click **Format** or press **`Shift+Alt+F`** to format SQL using the active engine's dialect.

---

## 4. Engine-Specific Query Guides (SQL, MongoDB, Redis)

### Relational SQL & Analytical OLAP Engines
**Relational (`SQL`):** PostgreSQL, MySQL, MariaDB, SQLite, SQL Server (MSSQL), Oracle  
**Analytical & Columnar (`OLAP`):** ClickHouse
- Use the **Database Dropdown** in the worksheet toolbar to switch the target database for that console.
- For **PostgreSQL** and **MSSQL**, expand individual schemas (`public`, `dbo`, etc.) in the Explorer tree.
- Double-click any table in the Explorer to open its data grid, or right-click to inspect DDL, indexes, foreign keys, and constraints.

### MongoDB
DHub lets you browse MongoDB collections like tables and query them using **Mongo Shell syntax**, **SQL-like syntax**, or **raw JSON commands**:

1. **Mongo Shell Syntax (`db.<collection>.<method>(...)`)**:
   ```javascript
   db.users.find({ "status": "active" });
   db.users.countDocuments({ "role": "admin" });
   db.users.insertOne({ "name": "Alice", "role": "editor" });
   db.users.deleteOne({ "_id": "65f1a2b3c4d5e6f7a8b9c0d1" });
   db.users.deleteMany({ "archived": true });
   db.temp_logs.drop();
   ```
2. **SQL-Like Queries**:
   ```sql
   SELECT * FROM users WHERE status = 'active' LIMIT 50 OFFSET 0;
   SELECT name, email FROM users WHERE role = 'admin';
   SELECT COUNT(*) FROM users WHERE status = 'active';
   ```
3. **Database Discovery & Admin Commands**:
   ```sql
   SHOW DBS;
   SHOW COLLECTIONS;
   ```
   ```json
   { "ping": 1 }
   ```
   ```json
   { "buildInfo": 1 }
   ```
- Opening a collection from the Explorer automatically infers fields and indexes from sampled documents, and allows inline inserting, updating (`_id` matching), and deleting with DML preview (`insertOne`, `updateOne`, `deleteOne`).

### Redis
DHub maps Redis databases (`db0`–`db15`) and keys into an intuitive explorer and grid:

1. **Explorer & Key Types**:
   - Expand `db0`–`db15` to scan keys along with their data type (`string`, `hash`, `list`, `set`, `zset`) and TTL status.
   - Right-click a Redis database or connection to **Add Key**, **Flush DB / Flush All**, or inspect **Redis Server Info**.
2. **Pseudo-SQL Queries**:
   ```sql
   SELECT * FROM keys;
   SELECT COUNT(*) FROM keys;
   SELECT * FROM "user:1001";
   ```
3. **Native Redis CLI Commands** (run single or multiple lines):
   ```redis
   GET user:1001
   SET session:abc "active" EX 3600
   HGETALL user:profile:1001
   LPUSH queue:jobs "task_1"
   ZRANGE leaderboard 0 9 WITHSCORES
   TTL session:abc
   INFO server
   ```

---

## 5. Working with the Data Grid

### Viewing Modes: Pagination vs. Lazy Load
Configure in **Settings -> Data Grid & Query** (or toggle directly from the grid footer):
- **Pagination:** Navigate data by numbered pages (`First`, `Prev`, `Next`, `Last`) with configurable batch sizes (`25` to `5000` rows).
- **Lazy Load (Infinite):** Scroll continuously; additional rows load automatically as you reach the bottom.

### Filtering, Sorting & Freezing Columns
- **WHERE Filter Bar:** Enter a filter condition (e.g., `status = 'active' AND age > 21`) above the table grid and press `Enter`. Click **Reset Filter** to clear it.
- **Multi-Column Sorting:** Click column headers to cycle `ASC`, `DESC`, or remove sort.
- **Freeze Columns:** Pin key columns (such as `id`) to the left edge while scrolling horizontally across wide tables.

### Inline Editing & Staged Changes
When viewing a table with a Primary Key on a non-read-only connection:
1. Double-click a cell (or press `Enter`) to edit its value inline. Null values, booleans, dates/timestamps, and JSON are handled cleanly.
2. Press **`Ctrl+D` / `⌘D`** to duplicate the active row as a new staged insert, or click `+` in the grid toolbar to add a blank row.
3. Press **`Delete` / `⌘⌫`** to mark the selected row for deletion.
4. Use the staged changes toolbar to:
   - **Preview SQL:** Inspect the exact `INSERT`, `UPDATE`, `DELETE`, or MongoDB statements before running.
   - **Apply (`Ctrl+S` / `⌘S`):** Commit all staged edits to the database.
   - **Revert (`Esc`):** Discard pending grid edits.

### Value Viewer (`Ctrl+T` / `⌘T`) & Smart Copy Formats
- Select any cell and press **`Ctrl+T` / `⌘T`** (or open the **Views** tab in the Right Sidebar) to read or edit long strings and pretty-printed JSON.
- Use the **Copy Format Selector** in the table toolbar or Settings to choose how `Ctrl+C` / `⌘C` copies data:
  - `CSV`
  - `JSON`
  - `SQL INSERT`
  - `SQL UPDATE`
  - `SQL UPSERT`

### Export, Import & Mock Data
- **Export (`Download` icon):** Export table rows to CSV, JSON, or SQL `INSERT` statements.
- **Import (`Upload` icon):** Import CSV files with interactive column mapping.
- **Mock Data Generator (`Wand` icon):** Generate up to `10000` sample rows based on column names and types (UUIDs, emails, timestamps, numbers, booleans, JSON, etc.). Disabled on `PROD` connections for safety.

---

## 6. Schema & Administration Tools

- **Create / Edit Table Modal:** Design new tables or inspect/alter existing columns, primary keys, foreign keys, indexes, check constraints, and generated DDL.
- **ER Diagram View:** Right-click a database or schema in the Explorer and select **ER Diagram** to view an interactive relationship graph. Drag table cards, zoom/pan, search tables, and click to open any table's data.
- **Schema Diff:** Click **Schema Diff** in the top header to compare two connections/databases/schemas side by side and generate migration SQL into a new Query Console.
- **User & Privilege Manager:** Right-click a supported connection (PostgreSQL, MySQL, MariaDB) and open **User Management** to view users, create/drop accounts, lock/unlock logins, generate secure passwords, and grant or revoke privileges.

---

## 7. Workspaces, Settings & Backup

- **Workspaces:** Switch between named workspaces via the top header dropdown or the **Workspaces** tab in the Left Sidebar. Each workspace preserves its own set of open tabs.
- **Appearance & Editor Preferences (`Ctrl+I` / `⌘I`):**
  - Switch between **Dark Mode** and **Light Mode**.
  - Adjust SQL editor font size (`12px`–`16px`), word wrap, and code minimap.
  - Set default Data View Mode, Batch/Page Size, and Copy Format.
- **Configuration Import & Export:** Under **Settings -> Import & Export**, export your preferences, connection folders, and connection profiles (with an optional warning-gated toggle to include passwords/SSH credentials) to a `.json` file, and restore them with conflict strategies (`Overwrite`, `Skip`, or `Duplicate`).

---

## 8. Keyboard Shortcuts Reference

| Category | Action | Windows / Linux | macOS |
| :--- | :--- | :--- | :--- |
| **Navigation** | Open Help & User Guide | `Ctrl+H` | `⌘H` |
| **Navigation** | Search Everywhere | `Ctrl+P` | `⌘P` |
| **Navigation** | Toggle Left Sidebar (Explorer / Workspaces) | `Ctrl+B` | `⌘B` |
| **Navigation** | Toggle Right Sidebar (Consoles / Views) | `Ctrl+R` | `⌘R` |
| **Navigation** | Open Settings & Preferences | `Ctrl+I` | `⌘I` |
| **Navigation** | Close Active Tab | `Ctrl+W` | `⌘W` |
| **Query Console** | Execute Statement at Cursor / Selection | `Ctrl+Enter` | `⌘Enter` |
| **Query Console** | Stop Running Query | `Ctrl+Shift+D` | `⌘Shift+D` |
| **Query Console** | Format SQL Code | `Shift+Alt+F` | `Shift+Alt+F` |
| **Data Grid** | Apply Staged Changes | `Ctrl+S` | `⌘S` |
| **Data Grid** | Duplicate Active Row | `Ctrl+D` | `⌘D` |
| **Data Grid** | Delete Active Row | `Delete` | `⌘⌫` |
| **Data Grid** | Toggle Cell Value Viewer | `Ctrl+T` | `⌘T` |
| **General** | Revert Pending Edits / Close Modal | `Esc` | `Esc` |

---

## 9. FAQ & Troubleshooting

### Why can't I edit cells in a table or query result?
Inline editing requires:
1. The connection is **not** marked **Read-Only** in Connection Settings.
2. The result comes from a single table/collection with an identified **Primary Key** (or `_id` in MongoDB). Complex `JOIN` or aggregated query results are read-only by design.

### Why are some databases hidden from my Explorer or Search Everywhere?
You may have an active **Database Visibility Filter**. Look for the **`X of Y`** badge next to your connection name in the Explorer and click it to check/uncheck which databases are visible.

### How does SSH Host Key Verification work?
DHub uses **Trust-On-First-Use (TOFU)** against its own local `known_hosts` file. The first time you connect through an SSH bastion host, its fingerprint is recorded. If the remote host key changes unexpectedly later, DHub blocks the connection to protect against MITM attacks.

### Where are my connections, passwords, and worksheets stored?
- Connection metadata, folders, worksheets, snippets, workspaces, and query history are stored locally in DHub's internal SQLite store.
- Database passwords and SSH passphrases are stored in your system's native **OS Keyring** whenever available (with encrypted AES-GCM fallback).

### How do I run updates?
Open **Settings -> Version** and click **Check for Updates**. DHub checks GitHub Releases for newer versions and lets you review the changelog before updating.
