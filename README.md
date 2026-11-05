# DHub

Desktop database client yang ringan dan *keyboard-first* (PostgreSQL, MySQL/MariaDB, SQLite), dibangun dengan **Go + Wails v3** dan **React + TypeScript + Tailwind CSS v4 + Monaco Editor**.

Blueprint arsitektur dan roadmap ada di [plan.md](plan.md).

## Menjalankan

```bash
wails3 dev        # development dengan hot-reload
wails3 build      # build produksi (hasil di folder bin/)
```

Setelah mengubah method/struct pada service Go, regenerate TypeScript bindings:

```bash
wails3 generate bindings
```

## Testing

```bash
go test ./...                 # unit test (tidak butuh server database)
docker compose up -d          # PostgreSQL (:55432) & MySQL (:53306) untuk uji manual/integrasi
```

`docker compose` menyiapkan PostgreSQL dengan dua database (`dhub`, `dhub_extra`) untuk menguji browsing multi-database dalam satu koneksi.

## Struktur

- `main.go` — entry point Wails, registrasi service & event
- `internal/driver` — kontrak `DatabaseDriver` + implementasi `postgres`, `mysql`, `sqlite`
- `internal/manager` — session/pool manager (termasuk SSH tunnel)
- `internal/services` — service Wails (Connection, Schema, Query, Workspace)
- `internal/store` — penyimpanan lokal SQLite (koneksi, worksheet, history, cache schema)
- `internal/tunnel` — SSH tunnel (host key diverifikasi lewat `known_hosts` milik DHub, TOFU)
- `frontend/` — UI React
