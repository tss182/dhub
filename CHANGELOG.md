# Changelog

All notable changes to DHub will be documented in this file.

## [0.1.2] - 2026-11-05

### Added
- **Smart Contextual Autocomplete & FK JOIN Suggestions**:
  - Automatically suggests `JOIN <table> ON <table>.<col> = <source>.<col>` based on foreign key relationships defined in schema.
  - Contextual `ON` completion proposing matching primary key and foreign key conditions.
  - Alias awareness (e.g. `u.` expands `users` table columns).
- **Interactive ER Diagram View (`ERDiagramView`)**:
  - Visual schema diagram with auto-layout and drag-and-drop table cards.
  - SVG bezier curved lines connecting foreign keys to primary keys with arrow markers.
  - Real-time search filter and table hover highlighting.
  - One-click SVG export.
  - Context menu item "Open ER Diagram..." from Database Explorer.
- **Object Explorer Expansion**:
  - Grouped tree folders for Tables, Views, Materialized Views, Routines / Functions, and Triggers with specialized icons and DDL inspection.
- **Data Export & Import Service (`ExportService`)**:
  - High-performance streaming export to CSV, JSON, and SQL INSERT statements.
  - CSV Import wizard with automatic column name matching and delimiter selection.
- **Full Transaction Management**:
  - Per-tab Auto / Manual transaction controls with Commit and Rollback toolbar buttons.
  - Safe auto-rollback on closing tabs with active uncommitted transactions.
  - Dynamic status bar indicator (`Tx: AUTO` / `Tx: MANUAL (ACTIVE: N)`).
- **SQL Formatter & Safety**:
  - `Shift+Alt+F` SQL formatting powered by `sql-formatter` with dialect awareness (PostgreSQL, MySQL, SQLite).
  - Parameter prompt modal detecting `:param`, `$1`, and `?` placeholders before execution.
  - Dangerous query warning modal for `UPDATE` and `DELETE` without a `WHERE` clause.
- **Explain Plan Panel**:
  - Dedicated bottom panel tab visualizing query execution plans with cost, timing, and node breakdowns.
- **Read-Only Enforcement**:
  - Backend validation blocking non-SELECT queries for read-only connections.
  - Distinct `READ-ONLY` badge and disabled data grid mutations.
- **Real Query Cancellation**:
  - `CancelQuery(executionId)` with Go context cancellation and `Ctrl+F2` shortcut.
- **SSH Tunneling & Security**:
  - Integrated SSH Tunneling supporting password and private key authentication.
  - Known-hosts validation to prevent MITM attacks.
  - Full backup/restore support through active SSH tunnels.
- **Automated Version Sync**:
  - `scripts/sync-version.sh` syncing versions across `build/config.yml`, `package.json`, and Windows MSIX manifests.

### Fixed
- Fixed SQLite single-connection pool deadlock during manual transactions by enabling WAL mode, `busy_timeout(5000)`, and increasing max open connections.
- Fixed query state isolation across tabs so switching tabs never leaks or resets results from another worksheet.
- Fixed PostgreSQL multi-database pool routing so queries and schema inspection correctly target the selected database.

### Testing & Quality
- Added unit tests for `ExportService` (CSV preview, export to CSV/JSON/SQL, import to table).
- Added unit tests for `MySQLDriver` (identifier quoting, date-time normalization, DML preview generation).
- Added unit tests for `SQLiteDriver` (`ApplyChanges`, `GenerateDMLPreview`, deep pagination, FK and index inspection).
- Added unit tests for `SessionManager` (connection caching and disconnect lifecycle).
- Added unit tests for `LocalStore` (connections CRUD, query history recording and bounds, schema cache).
- 100% Go test suite pass rate (`go test ./...`).
- Zero TypeScript build errors (`npm run build`).

