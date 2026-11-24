# Rencana Perbaikan & Pengembangan Driver MySQL dan MariaDB — DHub

Tanggal analisis: 2026-11-23
Basis kode: working tree per 2026-11-24. `git status` saat revisi ini hanya menunjukkan perubahan belum di-commit di `schema_ddl_service.go`, `schema_diff_service.go`, dan `SchemaDiffModal.tsx`. `executor.go`, `splitter.go`, `query_service.go`, dan `session_manager.go` sudah bersih. Catatan "perubahan Postgres belum di-commit" di versi sebelumnya sudah tidak berlaku. Fase yang menyentuh tiga file schema-diff/DDL itu tetap harus menunggu perubahan tersebut di-commit atau di-rebase.

**Cakupan driver**: MySQL **dan** MariaDB sama-sama target perbaikan. Perbaikan dikerjakan untuk kedua driver dalam PR yang sama. Perbedaan perilaku antar server dikumpulkan di **Bagian 7A** (M1–M17), dan item bertanda "beda" di kolom MariaDB perlu penanganan khusus di sana.

## 0. Cakupan & cara membaca

File yang direview:

| Area | File |
| :--- | :--- |
| Driver | `internal/driver/mysql/mysql.go`, `mysql_test.go`, `internal/driver/mariadb/mariadb.go` (tidak punya file test sama sekali) |
| Eksekusi bersama | `internal/driver/executor.go`, `internal/driver/splitter.go`, `internal/driver/driver.go` |
| Koneksi | `internal/manager/session_manager.go` (case `"mysql", "mariadb"`, ±baris 387) |
| Service | `query_service.go`, `export_service.go`, `schema_ddl_service.go`, `schema_diff_service.go`, `schema_backup_service.go`, `data_diff_service.go` |
| Frontend | `App.tsx`, `DataGrid.tsx`, `CreateTableModal.tsx`, `DatabaseExplorer.tsx`, `UserManager.tsx`, `ActivityMonitor.tsx`, `SqlWorksheet.tsx`, `driverCapabilities.ts` |
| Library | `github.com/go-sql-driver/mysql v1.10.1` (perilaku dicek langsung di module cache: `packets.go`, `rows.go`, `utils.go`) |

Prioritas:

- **P0**: keamanan atau kehilangan/korupsi data. Kerjakan dulu.
- **P1**: hasil salah atau fitur inti rusak pada kasus umum.
- **P2**: fitur yang belum ada tapi diharapkan dari klien MySQL.
- **P3**: nice-to-have / hutang teknis.

Effort: **S** (< ½ hari), **M** (½–2 hari), **L** (> 2 hari).

Kategori: **BUG** (perbaikan), **FITUR** (belum ada), **HAPUS** (fitur/perilaku yang seharusnya tidak ada), **TEKNIS** (hutang teknis).

Hampir semua temuan juga berlaku untuk MariaDB karena kodenya hasil salin-tempel (`diff` kedua file setelah nama disamakan hanya menyisakan: sequence di `ListObjects`, `generation_expression` + fallback kolom, query check constraint, dan penanganan `IS NULL` untuk PK di DML yang hanya ada di MySQL). Kolom "MariaDB" di tabel ringkasan berisi: **Ya** (sama persis), **Beda** (berlaku tapi solusinya berbeda, lihat Bagian 7A), **Sebagian**, atau **—** (tidak berlaku).

---

## 1. Ringkasan temuan

| ID | Judul | Kategori | Prio | Effort | MariaDB |
| :--- | :--- | :--- | :---: | :---: | :---: |
| S1 | Mode read-only bisa di-bypass (`MultiStatements=true` + perbedaan parsing komentar) | BUG | P0 | M | Ya (+ `/*M!`, M3) |
| S2 | SQL injection & password tersimpan plaintext di User Manager / query history | BUG | P0 | M | Ya |
| S3 | TLS fail-open: error CA/cert/RegisterTLSConfig diabaikan | BUG | P0 | S | Ya |
| S4 | Preview DML tidak meng-escape backslash | BUG | P0 | S | Ya |
| S5 | Identifier di frontend tidak di-escape (backtick) | BUG | P1 | S | Ya |
| D1 | BIGINT > 2^53 kehilangan presisi, edit bisa kena baris yang salah | BUG | P0 | S | Ya |
| D2 | Zero date `0000-00-00` tampil sebagai `0001-01-01` | BUG | P1 | M | Ya (lebih sering, M11) |
| D3 | BINARY/BLOB/BIT ditampilkan sebagai string rusak, PK biner tidak bisa diedit | BUG | P1 | M | Ya (+ `UUID`/`INET6`, M12) |
| D4 | Normalisasi nilai "null" & ISO-datetime pada semua string | HAPUS | P0 | S | Ya |
| D5 | Tabel tanpa PK menghasilkan `WHERE` kosong | BUG | P1 | M | Ya |
| D6 | Tidak ada verifikasi affected rows (optimistic concurrency) | BUG | P1 | S | Ya |
| D7 | Metadata kolom tidak lengkap (generated, ON UPDATE, charset, collation, invisible) | BUG | P0 | M | Beda (M1, M2) |
| D8 | Functional index hilang; prefix/desc/visible index & FK komposit tidak dimodelkan | BUG | P1 | M | Sebagian (M5) |
| D9 | Check constraint: status `ENFORCED` tidak dibaca | BUG | P3 | S | — |
| D10 | `ListSchemas` mengembalikan `[""]` | BUG | P2 | S | Ya |
| D11 | Sentinel `"main"` mencegah database bernama `main` | HAPUS | P2 | M | Ya |
| D12 | Error `rows.Err()` / scan diabaikan di introspeksi | BUG | P2 | S | Ya |
| D13 | State sesi (SET, temp table, `@var`, sql_mode) bocor antar eksekusi via pool | BUG | P1 | L | Ya |
| D14 | Transaksi manual: pool habis, implicit commit DDL, desync state | BUG | P1 | M | Ya |
| D15 | Cancel query tidak menghentikan query di server | BUG | P1 | M | Ya |
| D16 | Multiple result set (`CALL`) hanya membaca set pertama | FITUR | P2 | M | Ya |
| D17 | Warning MySQL (`SHOW WARNINGS`) tidak ditampilkan | FITUR | P2 | S | Ya |
| D18 | Skrip multi-statement yang gagal di tengah membuang hasil sebelumnya | BUG | P2 | M | Ya |
| P1 | Halaman pertama tidak di-LIMIT di server, tabel besar dibaca penuh | BUG | P0 | S | Ya (+ `RETURNING`, M4) |
| P2 | Export memakai OFFSET + chunk pertama membaca seluruh tabel | BUG | P1 | M | Ya |
| P3 | Statistik `information_schema` basi (cache 24 jam MySQL 8) | FITUR | P3 | S | — |
| P4 | Pool 4 koneksi dipakai semua fitur | BUG | P1 | S | Ya |
| F1 | Deteksi versi & flavor server | FITUR | P1 | M | Beda (M14) |
| F2 | EXPLAIN: FORMAT=TREE/JSON, guard EXPLAIN ANALYZE | FITUR | P1 | M | Beda (M7) |
| F3 | Session pinning per tab console + deteksi `USE db` | FITUR | P1 | L | Ya |
| F4 | Opsi koneksi: Unix socket, charset, time zone, init SQL, dll. | FITUR | P2 | M | Beda (M6) |
| F5 | Objek: parameter routine, partisi, opsi tabel, view security | FITUR | P2 | M | Ya |
| F6 | User manager: role MySQL 8, plugin auth, opsi akun | FITUR | P2 | M | Beda (M8) |
| F7 | Activity monitor: KILL QUERY, trx/lock, filter koneksi sendiri | FITUR | P2 | M | Beda (M9) |
| F8 | Schema diff MySQL: definisi kolom penuh, sintaks DROP INDEX, FK komposit | BUG | P1 | M | Beda (M13) |
| F9 | Backup: `--hex-blob`, `--no-tablespaces`, SSL, defaults-extra-file | BUG | P1 | S | Beda (M10) |
| F10 | Editor sel: ENUM/SET, JSON, spatial, BIT | FITUR | P3 | M | Ya |
| F11 | Status/variables server, top queries | FITUR | P3 | M | Ya |
| F12 | Test integrasi MySQL dan MariaDB (compose: MySQL ada, MariaDB belum) | TEKNIS | P0 | M | Ya |
| X1–X11 | Fitur yang seharusnya tidak ada (lihat Bagian 6) | HAPUS | P1–P3 | S | Ya |
| T1 | Duplikasi kode MySQL vs MariaDB yang sudah menyimpang | TEKNIS | P3 | L | Ya |
| M1–M17 | Perbedaan khusus MariaDB (Bagian 7A) | BUG/FITUR | P0–P3 | S–M | Hanya MariaDB |

---

## 2. Keamanan (P0)

### S1. Mode read-only bisa di-bypass

**Bukti**

- `session_manager.go` (case mysql): `mc.MultiStatements = true`. Server akan mengeksekusi beberapa statement yang dipisah `;` dalam satu kiriman.
- Proteksi read-only (`query_service.go` → `driver.IsReadOnlySafeQuery`) bekerja per statement hasil `SplitStatements`. Keamanannya bergantung pada splitter yang memecah SQL **persis** seperti server MySQL.
- Splitter (`splitter.go` baris ±21, ±290, ±445, ±563) menganggap `--` selalu awal komentar. Di MySQL, `--` hanya komentar kalau diikuti spasi/kontrol karakter. `SELECT 1 --1;DROP TABLE t` dianggap satu statement `SELECT` oleh DHub, tapi oleh MySQL dibaca `SELECT 1 - -1;` lalu `DROP TABLE t`.
- `stripStringsAndComments` membuang `/*! ... */`. Di MySQL, executable comment `/*! ... */` dan `/*!50700 ... */` **dieksekusi sebagai SQL**. Contoh: `SELECT * FROM t /*! INTO OUTFILE '/tmp/x' */` lolos cek `OUTFILE`.

**Dampak**: koneksi bertanda read-only (termasuk PROD) masih bisa menjalankan DML/DDL. Skenario ini harus dibuktikan dulu dengan test integrasi (F12) sebelum diperbaiki, tapi jalurnya jelas.

**Solusi (berlapis)**

1. Matikan `MultiStatements` untuk pool driver. Splitter sudah memecah di sisi klien (`ExecuteStatementsWithDialect`), jadi fitur ini tidak dibutuhkan. Sebelum mengubah, grep pemanggil yang mengirim beberapa statement dalam satu `ExecContext` tanpa lewat splitter (restore di `backup_tools.go` memakai `splitSQLStatementsForRestore`, jadi aman; cek ulang `export_service`, `data_diff_service`).
2. Tambah dialect `"mysql"` di splitter, mengikuti pola `isPostgres` yang baru ditambahkan:
   - `--` hanya komentar bila karakter berikutnya spasi, tab, newline, kontrol, atau EOF.
   - `/*!` dan `/*+` (optimizer hint) diperlakukan sebagai kode, bukan komentar, di `stripStringsAndComments` untuk dialect mysql. Untuk read-only, lebih aman langsung **menolak** statement yang mengandung `/*!`.
   - MariaDB juga mengeksekusi `/*M! ... */` dan `/*M!100100 ... */` (MySQL menganggapnya komentar biasa). Dialect `mariadb` harus menolak `/*!` **dan** `/*M!` (M3).
3. Panggil `driver.ExecuteStatementsWithDialect(ctx, conn, req, "mysql")` dari `MySQLDriver.Execute` (dan `"mariadb"` dari `MariaDBDriver.Execute`, `mariadb.go` baris 473) (saat ini memakai `ExecuteStatements` dengan dialect kosong). `query_service.go` juga harus memanggil `SplitStatementsForDialect(req.SQL, "mysql")` di cek read-only, bukan `SplitStatements`.
4. Pertahanan di sisi server untuk koneksi read-only: set variabel sesi saat koneksi dibuka, misalnya `mc.Params["transaction_read_only"] = "1"` (MySQL ≥ 5.7.20/8.0; fallback `tx_read_only` untuk versi lama, butuh F1). **Jangan** kirim variabel ini lewat `mc.Params` tanpa tahu flavor: go-sql-driver mengirimnya sebagai `SET` saat connect, dan server yang tidak mengenal variabelnya (MariaDB lama, MySQL 5.7 < 5.7.20) menolak koneksi. Untuk MariaDB pakai `tx_read_only` (lihat M3, M6). Ini memblokir DML di InnoDB walaupun parser DHub kecolongan. Dokumentasikan bahwa proteksi terkuat tetap user database dengan hak `SELECT` saja.

**Test**

- Unit: `IsReadOnlySafeQuery` untuk `SELECT 1 --1;DROP TABLE t`, `SELECT 1 /*!; DROP TABLE t */`, `SELECT * FROM t /*! INTO OUTFILE '/tmp/x' */`, `SELECT '--' ; DELETE FROM t`.
- Integrasi: koneksi read-only ke MySQL 8.4, jalankan payload di atas, pastikan tabel tetap ada.

### S2. SQL injection & kebocoran password di User Manager

**Bukti** (`UserManager.tsx`)

- Baris ±488: `IDENTIFIED BY '${pass.replace(/'/g, "\\'")}'`. Backslash tidak di-escape. Password berisi `\'` menjadi `\\'` → MySQL membaca `\\` sebagai backslash literal, lalu `'` menutup string. Sisa password dieksekusi sebagai SQL (diperparah S1/`MultiStatements`).
- Baris ±913 (ganti password): pola yang sama.
- Username dan host disisipkan di dalam backtick tanpa menggandakan backtick (baris ±490, 679, 786, 791, 864, 972).
- `QueryService.ExecuteQuery` selalu memanggil `RecordQueryHistory` dengan `SQLText: req.SQL` (`query_service.go` ±baris 210). Password pengguna tersimpan plaintext di SQLite lokal dan muncul di panel history.

**Solusi**

1. Pindahkan pembentukan SQL akun ke backend, misalnya `UserService` dengan method `CreateUser`, `AlterPassword`, `Grant`, `Revoke`, `DropUser`, `SetLock`. Backend memakai:
   - `quoteIdent` untuk user/host (menggandakan backtick), atau format `'user'@'host'` dengan escape string literal.
   - Fungsi escape string literal MySQL yang benar: `\` → `\\`, `'` → `\'`, NUL → `\0`, `\n`, `\r`, `\x1a` → `\Z`. Kalau `@@sql_mode` mengandung `NO_BACKSLASH_ESCAPES`, cukup gandakan `'`. Mode ini dibaca saat connect (F1).
2. Statement akun tidak dicatat ke history. Tambahkan field `SkipHistory bool` di `QueryRequest`, atau redaksi otomatis pola `IDENTIFIED BY '...'`, `IDENTIFIED WITH ... BY '...'`, `PASSWORD '...'` sebelum `RecordQueryHistory` untuk semua query (pengguna juga bisa mengetik `ALTER USER` sendiri di console).
3. Hapus `FLUSH PRIVILEGES` (lihat X5).

**Test**: password `a'b\c`, `x\'; DROP USER root@'%'; --`, user dengan backtick, host `10.0.%`. Pastikan login dengan password tersebut berhasil, dan history tidak menyimpan password.

### S3. TLS fail-open

**Bukti** (`session_manager.go`, case mysql)

- `os.ReadFile(cfg.SSLCAPath)` gagal → diam saja, `RootCAs` tetap nil (memakai CA sistem).
- `tls.LoadX509KeyPair` gagal → diam saja, client cert tidak dikirim.
- `RegisterTLSConfig` gagal → `mc.TLSConfig` tidak di-set, koneksi berjalan **tanpa TLS** padahal pengguna mengisi CA.
- Kalau CA diisi tapi `SSLMode` = `disable`, TLS tetap aktif. Perilaku ini membingungkan.
- `verify-ca` diperlakukan sama dengan `verify-identity`. go-sql-driver mengisi `ServerName` dari host. Lewat SSH tunnel host-nya `127.0.0.1`, jadi verifikasi hostname gagal.

**Solusi**

1. Semua error di atas dikembalikan sebagai error koneksi yang jelas ("CA file tidak bisa dibaca: ...").
2. Pemetaan mode yang tegas:
   - `disable` → `TLSConfig="false"` (abaikan file).
   - `preferred` → `"preferred"`, atau config custom dengan fallback.
   - `required` → TLS tanpa verifikasi.
   - `verify-ca` → `InsecureSkipVerify=true` + `VerifyPeerCertificate` custom yang memvalidasi rantai terhadap CA tanpa cek hostname.
   - `verify-identity` → verifikasi penuh dengan `ServerName = cfg.Host` asli (bukan host tunnel).
3. Nama TLS config per koneksi sudah unik (`custom_tls_<id>`). Pastikan re-register saat konfigurasi diubah (sudah terjadi karena `createDriver` dipanggil ulang).

### S4. Preview DML tidak meng-escape backslash

**Bukti**: `mysql.go` `formatSQLVal` (±baris 632) hanya `'` → `''`. Pada `sql_mode` default MySQL, backslash adalah karakter escape. Nilai `C:\temp\` menghasilkan preview `'C:\temp\'` yang tidak valid. Kalau preview disalin ke console, hasilnya bisa berbeda dari yang di-apply.

`ApplyChanges` memakai placeholder, jadi data yang di-apply aman. Masalahnya ada di preview, yang seharusnya identik dengan yang dijalankan.

**Solusi**: pakai fungsi yang sudah benar dan teruji di `backup_tools.go` (`formatSQLValue("mysql", v)`, ada test `'it\'s\na\\b'`). Pindahkan ke paket bersama (misal `internal/driver/sqlfmt`) agar driver bisa memakainya tanpa import dari `services`. Tambahkan juga format `[]byte` → `X'..'`, `bool` → `1/0`, `time.Time`.

### S5. Identifier tidak di-escape di frontend

**Bukti**: `DatabaseExplorer.tsx` baris ±2011 (`RENAME TABLE`), ±2595 (`DROP SEQUENCE`), ±2656–2760 (SHOW CREATE / DROP routine & trigger), `CreateTableModal.tsx` (trigger, kolom), `UserManager.tsx`. Semuanya `` `${name}` `` tanpa menggandakan backtick. Util `quoteSqlIdentifier` di `utils/sqlIdentifier.ts` sudah ada tapi tidak dipakai di tempat-tempat ini.

**Solusi**: ganti semua interpolasi manual dengan `quoteSqlIdentifier(driver, name)`. Tambahkan lint sederhana (grep di CI) untuk pola `` \`${ `` pada file-file ini.

---

## 3. Kebenaran data (grid, editing, tipe data)

### D1. BIGINT kehilangan presisi (P0)

**Bukti**: go-sql-driver v1.10.1 (`packets.go`, `textRows.readRow`) mengubah `BIGINT` menjadi `int64`/`uint64`, dan `INT` menjadi `int64`, juga pada text protocol. Nilai ini dikirim sebagai angka JSON ke frontend. JavaScript hanya presisi sampai 2^53. `normalizeScannedValue` (`executor.go` ±baris 113) hanya melindungi dialect `clickhouse` dan `postgres`. MySQL memanggil executor dengan dialect `""`.

**Dampak**: ID snowflake, `UUID_SHORT()`, atau `BIGINT UNSIGNED` besar tampil salah. Saat diedit, `WHERE id = <nilai terbulatkan>` mengenai 0 baris, atau baris lain kalau nilai hasil pembulatan kebetulan ada.

**Solusi**: (1) `Execute` memakai dialect `"mysql"` (sama dengan S1 poin 3). (2) Tambahkan `"mysql"`, `"mariadb"` ke cabang safe-int di `normalizeScannedValue`. (3) `ApplyChanges` menerima PK berupa string angka; MySQL mengonversi sendiri, jadi aman.

**Test**: insert `9007199254740993` dan `18446744073709551615` (unsigned), buka grid, edit kolom lain di baris tersebut, pastikan affected = 1.

### D2. Zero date dan presisi waktu (P1)

**Bukti**: `ParseTime = true`. `parseDateTime` (`utils.go`) mengembalikan `time.Time{}` untuk `0000-00-00 00:00:00`. Executor memformatnya menjadi `0001-01-01 00:00:00`. Kalau pengguna mengedit kolom lain lalu nilai itu ikut terkirim, `0001-01-01` tertulis ke database. Selain itu `DATETIME(3)` selalu ditampilkan 6 digit, dan `TIMESTAMP` dibaca dengan `Loc=UTC` tanpa info zona waktu sesi.

**Opsi**

- **A.** Tetap `ParseTime=true`, tambahkan penanganan `t.IsZero()` untuk dialect mysql → `0000-00-00` / `0000-00-00 00:00:00`, dan format presisi sesuai `DECIMAL_SIZE` kolom.
- **B (rekomendasi).** `ParseTime=false` untuk pool MySQL. Server sudah mengirim tanggal sebagai teks; executor mengubah `[]byte` menjadi string apa adanya. Zero date, presisi fractional, dan format asli terjaga tanpa konversi. Risiko: kode lain yang mengharapkan `time.Time`. Sebelum mengubah, cek `export_service.go` (format XLSX/JSON), `data_diff_service.go` (perbandingan nilai), dan `backup_tools.go` `formatSQLValue`.

Kedua opsi juga butuh: tampilkan `@@session.time_zone` di status bar untuk kolom `TIMESTAMP` (F1/F4).

### D3. BINARY / BLOB / BIT (P1)

**Bukti**: `normalizeScannedValue` mengubah semua `[]byte` menjadi `string(b)`. Byte non-UTF-8 diganti `U+FFFD` saat di-encode JSON oleh Wails. `BINARY(16)` (UUID) dan `BIT(1)` tampil sebagai karakter rusak. Kalau `BINARY(16)` adalah PK, `WHERE id = '<rusak>'` tidak pernah cocok sehingga baris tidak bisa diedit atau dihapus.

**Solusi**

1. Untuk dialect mysql, berdasarkan `DatabaseTypeName()`: `BINARY`, `VARBINARY`, `*BLOB`, `GEOMETRY` → hex `0x...` (pola yang sama dengan `BYTEA` Postgres di diff terbaru). `BIT` → angka (`uint64` big-endian dari byte) atau `b'0101'`.
2. `ApplyChanges` harus tahu tipe kolom. Opsi: driver memanggil `GetTableStructure` (dengan cache singkat per tabel) di awal `ApplyChanges`, lalu mengubah string `0x..` kembali ke `[]byte` untuk kolom biner, dan angka ke BIT. Alternatif: frontend mengirim tipe kolom di `RowChange`. Opsi pertama tidak mengubah kontrak API.
3. Preview (S4) mengeluarkan `X'..'` / `0x..` untuk kolom biner.
4. Grid: kolom biner tidak boleh diedit sebagai teks bebas. Sediakan editor hex, atau jadikan read-only kecuali untuk tipe `BINARY(16)` dengan mode tampilan UUID (`BIN_TO_UUID`, MySQL 8+).

### D4. Normalisasi nilai yang merusak data (P0, HAPUS)

**Bukti**: `normalizeMySQLValue` (`mysql.go` ±baris 522) diterapkan ke **semua** nilai string di insert, update, dan WHERE:

- String `"null"`, `"NULL"`, `"<null>"` diubah menjadi SQL `NULL`. Pengguna tidak bisa menyimpan teks literal `null` ke `VARCHAR`. Frontend sudah mengirim `null` asli untuk NULL (`cleanPastedValue` di `gridFormatters.ts`), jadi aturan backend ini tidak diperlukan.
- String yang mirip ISO datetime (`2026-11-05T12:30:00+07:00`) diubah menjadi `2026-11-05 12:30:00`. Ini terjadi juga pada kolom `VARCHAR`/`JSON` yang memang menyimpan string ISO. Offset zona waktu dibuang tanpa konversi, sehingga waktunya bergeser.
- Aturan yang sama dipakai di klausa WHERE untuk PK: PK string `"null"` dicari dengan `IS NULL`.

**Solusi**: hapus konversi "null". Konversi datetime hanya untuk kolom bertipe `DATE`, `DATETIME`, `TIMESTAMP` (butuh info tipe dari D3 poin 2). Untuk input dengan offset, konversi ke `@@session.time_zone` atau tolak dengan pesan jelas. Update `TestNormalizeMySQLValue` sesuai perilaku baru.

### D5. Tabel tanpa primary key (P1)

**Bukti**: `DataGrid.tsx` `buildRowMetaMaps` membuat `pkMap` kosong kalau tabel tidak punya PK. `GenerateDMLPreview`/`ApplyChanges` menghasilkan `UPDATE ... SET ... WHERE ` (WHERE kosong). Sekarang ini gagal dengan syntax error, jadi data aman, tapi pengguna hanya mendapat error yang membingungkan. Tidak ada guard eksplisit: perubahan kecil di masa depan (misalnya `strings.Join` dengan default `1=1`) bisa membuat update mengenai seluruh tabel.

**Solusi**

1. Guard backend: tolak update/delete dengan `PrimaryKey` kosong ("tabel tidak punya primary key / unique key").
2. Frontend: kalau tidak ada PK, pakai unique index yang semua kolomnya `NOT NULL` (data sudah ada di `structure.indexes`).
3. Kalau tidak ada unique key juga: mode "cocokkan semua kolom asli + `LIMIT 1`" (MySQL mendukung `LIMIT` di `UPDATE`/`DELETE` satu tabel), dengan peringatan, atau jadikan grid read-only. Keputusan ini perlu dikonfirmasi (lihat Bagian 9).
4. Kolom `FLOAT`/`DOUBLE`/`JSON`/`BLOB` tidak boleh dipakai sebagai kunci pencocokan karena perbandingan kesetaraannya tidak andal.

### D6. Affected rows & konflik bersamaan (P1)

**Bukti**: `ApplyChanges` hanya menjumlahkan `RowsAffected`. MySQL secara default melaporkan baris yang **berubah**, bukan yang **cocok**. Update dengan nilai sama menghasilkan 0. Baris yang sudah dihapus orang lain juga menghasilkan 0, dan tidak ada yang memberi tahu pengguna.

**Solusi**: set `mc.ClientFoundRows = true` (hanya memengaruhi `RowsAffected`), lalu untuk setiap update/delete berbasis PK, cek `RowsAffected == 1`. Kalau 0: rollback seluruh batch dengan pesan "baris sudah diubah/dihapus sesi lain, reload data". Opsional: mode optimistic yang ikut mencocokkan nilai asli kolom yang diubah.

### D7. Metadata kolom tidak lengkap (P0 untuk designer)

**Bukti**: query kolom di `GetTableStructure` (`mysql.go` ±baris 227) hanya membaca `column_name, column_type, data_type, is_nullable, column_key, column_default, extra, column_comment`. Kolom `extra` dibaca tapi hanya dipakai untuk `auto_increment`. Driver MariaDB sudah membaca `generation_expression`, driver MySQL belum.

Dampak nyata di `CreateTableModal.tsx` (±baris 1858): saat membuka tabel yang sudah ada, `columnKind` dan `onUpdate` tidak diisi. Mengedit komentar kolom `updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` menghasilkan `CHANGE COLUMN` tanpa `ON UPDATE`. Perilaku itu **hilang diam-diam**. Hal yang sama terjadi pada:

- Generated column (`VIRTUAL`/`STORED`): berubah menjadi kolom biasa, atau ALTER gagal.
- Charset/collation per kolom: kembali ke default tabel.
- Default berupa ekspresi (`(uuid())`, `CURRENT_TIMESTAMP(3)`), ditandai `DEFAULT_GENERATED` di `extra`: designer mengutipnya sebagai string literal.
- Invisible column (MySQL 8.0.23+): menjadi visible.

Di grid, generated column tampak bisa diedit, lalu update gagal dengan error 3105.

**Solusi**

1. Tambahkan field ke `driver.ColumnMeta` (opsional, `omitempty`, tidak merusak driver lain):
   `Extra`, `GenerationExpression`, `ColumnKind` (`NORMAL|VIRTUAL|STORED`), `OnUpdate`, `CharacterSet`, `Collation`, `IsInvisible`, `IsGenerated`, `SRID`. Field `DefaultKind` yang sudah ada diisi `literal|expression|null|none`.
2. Query: tambah `GENERATION_EXPRESSION`, `CHARACTER_SET_NAME`, `COLLATION_NAME`, `SRS_ID` (8.0+). Lakukan fallback bertingkat seperti MariaDB kalau kolom tidak ada (5.7 tidak punya `SRS_ID`). Parse `extra`: `on update CURRENT_TIMESTAMP(n)`, `VIRTUAL GENERATED`, `STORED GENERATED`, `DEFAULT_GENERATED`, `INVISIBLE`.
3. Bedakan "default NULL" vs "tidak ada default": `column_default IS NULL` dan `is_nullable = 'YES'` berarti default NULL. Kalau `NOT NULL` tanpa default, berarti tidak ada default.
4. Regenerasi binding (`wails3 generate bindings`), lalu isi `columnKind`, `onUpdate`, charset, dan collation di mapping `CreateTableModal`. Generated column read-only di grid.
5. `parseColumnType` di designer harus menangani `int unsigned`, `zerofill`, `enum('a','b')`, `set(...)`, `decimal(10,2) unsigned`.

Untuk MariaDB, format `column_default` dan `extra` berbeda dari MySQL dan `mariadb.go` saat ini menaruh `generation_expression` ke `DefaultValue` (M1, M2). Jangan menyalin parser MySQL begitu saja.

**Test**: tabel dengan semua jenis kolom di atas. Buka designer, ubah komentar satu kolom, generated ALTER tidak boleh mengubah atribut lain. Bandingkan `SHOW CREATE TABLE` sebelum dan sesudah.

### D8. Index & foreign key (P1)

**Bukti**

- Functional index (MySQL 8.0.13+) punya `COLUMN_NAME = NULL` di `information_schema.statistics`. Scan ke `string` gagal, lalu baris di-skip diam-diam, sehingga index hilang dari UI dan schema diff.
- Tidak dibaca: `SUB_PART` (prefix index `name(10)`), `COLLATION` (`D` = descending index), `IS_VISIBLE` (8.0), `EXPRESSION`, `CARDINALITY`.
- `ForeignKeyMeta` satu baris per kolom. FK komposit `(a,b) → (x,y)` dipecah menjadi dua entri dengan nama constraint sama. Schema diff (`schema_diff_service.go` ±baris 476) membuat dua `ADD CONSTRAINT` bernama sama yang tidak valid.

**Solusi**: tambahkan ke `IndexMeta`: `SubParts []int`, `Descending []bool`, `IsVisible *bool`, isi `Expression`. Pakai `sql.NullString` untuk `column_name`. Untuk FK, tambahkan `Columns []string` dan `RefColumns []string` (tetap isi `ColumnName`/`RefColumn` untuk kompatibilitas), dikelompokkan per `constraint_name` sesuai `ordinal_position`. Sesuaikan designer dan schema diff.

### D9. Check constraint (P3)

Tambahkan `tc.ENFORCED` (MySQL 8.0.16+) ke `CheckConstraintMeta` agar `NOT ENFORCED` tidak hilang saat ALTER. Di 5.7 query gagal dan sudah ditangani (diabaikan). Sebaiknya di-skip berdasarkan versi (F1) daripada mengandalkan error.

### D10. `ListSchemas` mengembalikan `[""]` (P2)

Kalau koneksi tanpa default database dan `database` kosong, hasilnya `[""]`. Kembalikan `[]` atau `[database]` hanya jika tidak kosong.

### D11. Sentinel `"main"` (P2, HAPUS)

**Bukti**: `resolveDatabase` mengabaikan nilai `"main"`, karena frontend memakai `'main'` sebagai fallback (`App.tsx` baris ±639, ±1083, ±1513; `DatabaseExplorer.tsx` beberapa tempat `contextMenu.database || 'main'`). Akibatnya database MySQL yang benar-benar bernama `main` tidak bisa dibuka.

**Solusi bertahap**: (1) frontend berhenti mengirim `'main'` untuk driver mysql/mariadb (pakai `driverCapabilities.defaultDatabase` = `''`). (2) Migrasi workspace/tab tersimpan yang berisi `database: 'main'` untuk koneksi MySQL. (3) Setelah satu rilis, hapus pengecualian `"main"` di driver, `schema_ddl_service.go`, dan `data_diff_service.go`.

### D12. Error introspeksi diabaikan (P2)

`ListObjects` dan `GetTableStructure` tidak memeriksa `rows.Err()`, dan `if err := rows.Scan(...); err == nil` membuang baris yang gagal. Error query routine/trigger/event juga diabaikan. Itu wajar untuk masalah hak akses, tapi pengguna tidak tahu daftarnya tidak lengkap. Executor juga `continue` saat scan gagal.

**Solusi**: cek `rows.Err()`. Scan memakai `sql.NullString`/`sql.NullInt64` supaya tidak gagal karena NULL. Kumpulkan peringatan non-fatal (misalnya `ObjectSummary` tambahan atau field `Warnings` di response) agar UI bisa menampilkan "Triggers tidak bisa dibaca: akses ditolak".

---

## 4. Sesi, transaksi, cancel, dan eksekusi

### D13. State sesi bocor antar eksekusi (P1)

**Bukti**: `MySQLDriver.Execute` mengambil koneksi acak dari pool (`m.db.Conn(ctx)`), menjalankan `USE`, lalu mengembalikannya. `USE` hanya di-reset kalau `defaultDB != ""`. Semua state sesi MySQL ikut terbawa ke pemakai koneksi berikutnya:

- `SET SESSION sql_mode = ''`, `SET FOREIGN_KEY_CHECKS = 0`, `SET time_zone = ...` dari console ikut berlaku di `ApplyChanges` grid yang kebetulan memakai koneksi yang sama.
- Sebaliknya, `SET @a = 1;` lalu di eksekusi berikutnya `SELECT @a;` hasilnya `NULL` kalau koneksinya berbeda. `CREATE TEMPORARY TABLE` lalu query berikutnya gagal "table doesn't exist".
- `LOCK TABLES` / `GET_LOCK()` tertinggal di koneksi pool.

Perilaku ini tidak deterministik dan sulit di-debug pengguna.

**Solusi**: lihat F3 (session pinning). Sampai F3 selesai, perbaikan minimal: grid/metadata/ApplyChanges memakai pool terpisah yang tidak pernah dipakai console, sehingga `SET` dari console tidak memengaruhi operasi edit.

### F3. Session pinning per tab console (P1, L)

Desain:

1. `MySQLDriver` punya dua jalur: `metaPool *sql.DB` (introspeksi, grid, ApplyChanges, export) dan `sessions map[tabID]*sql.Conn` untuk console.
2. `QueryRequest.TabID` sudah ada. Kalau `TabID` terisi dan berasal dari console, `Execute` memakai/membuat `*sql.Conn` khusus tab itu.
3. `USE` hanya dikirim kalau database tab berbeda dari database aktif koneksi tersebut (simpan state terakhir).
4. Deteksi statement `USE x` di console: perbarui database aktif tab dan kirim event ke frontend agar selector database ikut berubah.
5. Lifecycle: tutup koneksi saat tab ditutup (perlu hook dari frontend/`WorkspaceService`), saat koneksi di-disconnect, dan setelah idle (misalnya 10 menit, kurang dari `wait_timeout` server). Saat dipakai lagi, cek dengan `PingContext`. Kalau koneksi mati, buat ulang dan beri tahu pengguna bahwa variabel sesi/temp table hilang.
6. Batasi jumlah sesi (misal 16). Di atas itu, tab paling lama idle ditutup.
7. Integrasi dengan transaksi manual (D14): transaksi tab berjalan di koneksi pinned yang sama, jadi tidak butuh `*sql.Tx` terpisah.

Ini mengubah kontrak `DatabaseDriver` secara opsional: tambahkan interface `SessionCloser { CloseSession(tabID string) }` yang dicek dengan type assertion, seperti `CloseDatabasePool` di Postgres.

### D14. Transaksi manual (P1)

**Bukti**

- `SetMaxOpenConns(4)`. Setiap tab dengan `Tx: MANUAL` memegang satu koneksi sampai commit/rollback. Empat tab manual membuat semua operasi lain (explorer, grid, autocomplete) menunggu sampai timeout 5 menit.
- DDL di MySQL melakukan **implicit commit**. Setelah `ALTER TABLE` di tengah transaksi manual, UI masih menampilkan transaksi terbuka dan tombol Rollback, padahal perubahan sebelumnya sudah ter-commit.
- Mengetik `COMMIT`, `ROLLBACK`, atau `START TRANSACTION` di console saat mode manual membuat state `*sql.Tx` di Go tidak sinkron dengan server.
- `BeginTx` menjalankan `USE` sekali. Ganti database di tab saat transaksi terbuka diabaikan.
- Koneksi idle melewati `wait_timeout` diputus server. Statement berikutnya gagal dengan `invalid connection` tanpa penjelasan bahwa transaksi sudah hilang.
- Cancel saat transaksi berjalan menutup koneksi (perilaku go-sql-driver). Transaksi hilang, tetapi `TxSession` masih ada di `activeTx`.

**Solusi**

1. Pool lebih besar dan bisa dikonfigurasi (P4). Transaksi manual memakai koneksi pinned (F3), bukan dari pool bersama.
2. Deteksi statement implicit-commit (daftar MySQL: `CREATE/ALTER/DROP/RENAME/TRUNCATE`, `LOCK TABLES`, `GRANT`, `SET autocommit=1`, dll.). Saat mode manual: tampilkan konfirmasi "Statement ini akan meng-commit transaksi yang sedang berjalan", lalu setelah eksekusi tandai transaksi selesai.
3. Tangkap `COMMIT`/`ROLLBACK`/`BEGIN`/`START TRANSACTION` yang diketik di mode manual: arahkan ke `CommitTransaction`/`RollbackTransaction`, atau tolak dengan pesan.
4. Kunci selector database selama transaksi terbuka.
5. Saat error `driver.ErrBadConn` / `mysql.ErrInvalidConn`, hapus `TxSession`, kirim status `aborted` ke UI dengan pesan "koneksi terputus, transaksi di-rollback oleh server".
6. Tampilkan umur transaksi dan peringatan setelah N menit (transaksi panjang menahan lock & undo log).

### D15. Cancel tidak menghentikan query di server (P1)

**Bukti**: `CancelQuery` memanggil `cancel()` context. go-sql-driver menangani pembatalan dengan menutup socket. Server MySQL tetap menjalankan query (terutama `UPDATE`/`DELETE`/`ALTER` panjang, dan tetap menahan lock) sampai query selesai atau server mendeteksi koneksi putus.

**Solusi**

1. Sebelum menjalankan statement, simpan `CONNECTION_ID()` koneksi (sekali per koneksi pinned, cache).
2. Daftarkan `executionID → connectionID` di driver.
3. Saat cancel: buka koneksi terpisah dari `metaPool` dan jalankan `KILL QUERY <id>`. Setelah itu baru batalkan context. Dengan `KILL QUERY`, koneksi tetap hidup, sehingga transaksi dan sesi tidak hilang.
4. Butuh optional interface `QueryCanceller { CancelExecution(executionID string) error }` yang dipanggil `QueryService.CancelQuery` sebelum `cancel()`.
5. Untuk SELECT, tambahkan opsi `max_execution_time` default (F4) sebagai pengaman.

### D16. Multiple result set (P2)

**Bukti**: executor hanya membaca result set pertama dari `QueryContext`. `CALL proc()` yang mengembalikan beberapa `SELECT` hanya menampilkan yang pertama. Sisanya dibuang oleh `rows.Close()`.

**Solusi**: untuk dialect mysql, setelah loop baris jalankan `for rows.NextResultSet() { ... }` dan masukkan setiap set sebagai `StatementResult` tersendiri (UI sudah mendukung `Results` banyak). Untuk parameter `OUT`/`INOUT`, template CALL di explorer membuat `CALL p(@o1); SELECT @o1;`. Ini butuh F3 agar kedua statement memakai koneksi yang sama. Kalau dijalankan dalam satu eksekusi, sudah satu koneksi.

### D17. Warning MySQL tidak ditampilkan (P2)

Dalam `sql_mode` non-strict, `INSERT` bisa memotong data atau mengubah nilai dengan warning saja. Hal yang sama berlaku untuk `ALTER` yang men-truncate. Pengguna tidak melihatnya.

**Solusi**: setelah statement non-SELECT di dialect mysql, jalankan `SHOW WARNINGS` di koneksi yang sama (murah) dan simpan di `StatementResult.Warnings []string` (field baru, `omitempty`). Tampilkan badge di hasil. Tambahkan juga `LastInsertId` untuk `INSERT` (`res.LastInsertId()`).

### D18. Kegagalan di tengah skrip (P2)

**Bukti**: `ExecuteStatementsWithDialect` mengembalikan `nil, error` saat satu statement gagal. Hasil statement sebelumnya, yang dalam autocommit **sudah ter-commit**, tidak dikembalikan ke UI.

**Solusi**: kembalikan `QueryResult` berisi `Results` yang sukses, ditambah satu `StatementResult` dengan `Error` untuk statement yang gagal dan indeksnya. Perubahan ini ada di executor bersama, jadi koordinasikan dengan driver lain (Postgres sedang diubah). Opsi "continue on error" untuk skrip bisa ditambahkan belakangan.

---

## 5. Performa

### P1. Halaman pertama tidak di-LIMIT di server (P0)

**Bukti**

- `App.tsx` ±baris 1574 membuka tabel dengan `SELECT * FROM db.t [WHERE] [ORDER BY];` tanpa LIMIT, lalu mengirim `limit`/`offset` ke backend.
- `wrapSelectForPaging` (`executor.go` ±baris 26) mengembalikan `ok=false` kalau `offset <= 0` kecuali dialect `clickhouse`. Halaman pertama tidak dibungkus LIMIT.
- Executor berhenti membaca setelah `limit` baris lalu memanggil `rows.Close()`. Di go-sql-driver (`rows.go`, `Close` → `mc.skipRows()`), semua baris sisa **tetap dibaca dari jaringan lalu dibuang**.

**Dampak**: membuka tabel 50 juta baris berarti server mengirim 50 juta baris dan DHub membuangnya. Ini bisa makan beberapa menit, memakan bandwidth/SSH tunnel, dan menahan koneksi pool. Hal yang sama berlaku untuk semua SELECT tanpa LIMIT yang diketik di console.

**Solusi**

1. Untuk dialect `mysql`/`mariadb`, selalu dorong LIMIT ke server, termasuk halaman pertama (seperti ClickHouse).
2. Lebih baik **menambahkan** `LIMIT n OFFSET m` di akhir statement daripada membungkus dengan derived table:
   - Derived table gagal kalau ada nama kolom duplikat (`SELECT a.id, b.id ...`), dan saat ini jatuh ke fallback yang kembali membaca semua baris.
   - `ORDER BY` di dalam derived table bisa diabaikan optimizer MySQL kalau derived table tidak di-merge.
   - Penambahan langsung juga bekerja untuk `WITH ... SELECT` (MySQL 8).
3. Jangan menambahkan LIMIT kalau statement sudah berisi `LIMIT` di level teratas, `INTO`, `FOR UPDATE`/`FOR SHARE`/`LOCK IN SHARE MODE` (atau sisipkan LIMIT sebelum klausa lock), `PROCEDURE ANALYSE`, atau `UNION` tanpa tanda kurung (LIMIT tetap valid di akhir UNION; perlu test).
4. Deteksi "level teratas" memakai `stripStringsAndComments` + penghitungan kedalaman kurung, bukan `strings.Contains(" LIMIT ")` seperti sekarang (yang juga menolak subquery ber-LIMIT).
5. Fallback terakhir: kalau statement tidak bisa di-LIMIT, setelah baris ke `limit+1` jalankan `KILL QUERY` (D15) daripada men-drain.

**Test**: tabel 1 juta baris di MySQL test container. Buka grid, waktu respons harus kurang dari 1 detik. Ukur bytes yang diterima, atau cek `performance_schema.events_statements_history.ROWS_SENT`.

### P2. Export (P1)

**Bukti**: `ExportService.ExportToFile` mengambil chunk 5000 baris dengan `Limit`/`Offset` lewat `drv.Execute`:

- Chunk pertama `offset=0`: terkena P1, server mengirim seluruh tabel untuk 5000 baris pertama.
- Chunk berikutnya `LIMIT 5000 OFFSET k`: MySQL harus memindai k baris setiap kali. Totalnya O(n²).
- Tanpa `ORDER BY`, urutan antar chunk tidak dijamin. Baris bisa dobel atau hilang kalau ada penulisan bersamaan atau rencana eksekusi berubah.

**Solusi**: tambahkan optional interface `RowStreamer { StreamQuery(ctx, req, func(cols, row) error) error }`. Implementasi MySQL menjalankan **satu** query dan membaca baris satu per satu sampai selesai (go-sql-driver sudah streaming, tanpa buffer penuh). Untuk tabel dengan PK, alternatifnya keyset pagination (`WHERE pk > last ORDER BY pk LIMIT n`). Export service memakai `RowStreamer` kalau tersedia, dan tetap fallback ke OFFSET untuk driver lain.

### P3. Statistik basi (P3)

MySQL 8 meng-cache `TABLE_ROWS`, `DATA_LENGTH`, dll. di `information_schema.tables` selama `information_schema_stats_expiry` (default 86400 detik). InnoDB `TABLE_ROWS` juga hanya estimasi. UI menampilkannya seolah akurat.

**Solusi**: label "≈" di explorer. Tombol "Refresh statistics" menjalankan `SET SESSION information_schema_stats_expiry = 0` sebelum query (8.0+), atau `ANALYZE TABLE` dengan konfirmasi (koneksi non read-only). Tombol "Hitung baris persis" menjalankan `SELECT COUNT(*)` atas permintaan pengguna.

### P4. Ukuran pool (P1)

`SetMaxOpenConns(4)` dipakai bersama oleh explorer, grid, console, autocomplete, export, schema diff (yang sendiri memakai konkurensi 4), dan transaksi manual. Satu export panjang ditambah schema diff sudah cukup membuat UI menunggu.

**Solusi**: pisahkan `metaPool` (misal 4 koneksi) dari koneksi pinned console (F3). Jadikan batas total bisa dikonfigurasi per koneksi (default 8–10), karena server bersama/cloud punya `max_connections` terbatas. `ConnMaxLifetime` juga dibuat konfigurasi (proxy seperti RDS Proxy/ProxySQL butuh nilai lebih kecil).

---

## 6. Fitur yang seharusnya tidak ada (HAPUS)

| ID | Perilaku | Lokasi | Alasan | Tindakan |
| :--- | :--- | :--- | :--- | :--- |
| X1 | `MultiStatements = true` | `session_manager.go` case mysql | Tidak dibutuhkan (splitter di klien) dan membuka jalur bypass read-only/injection (S1, S2) | Set `false` setelah audit pemanggil |
| X2 | Konversi string `"null"`/`"<null>"` → NULL dan ISO-datetime pada semua kolom | `mysql.go` `normalizeMySQLValue` | Merusak data teks (D4) | Hapus / jadikan type-aware |
| X3 | Sentinel `"main"` untuk MySQL | `resolveDatabase`, `App.tsx`, `DatabaseExplorer.tsx`, `schema_ddl_service.go`, `data_diff_service.go` | Warisan SQLite; database bernama `main` tidak bisa dipakai (D11) | Migrasi bertahap |
| X4 | `FLUSH PRIVILEGES` setelah `CREATE USER`/`GRANT`/`REVOKE`/`ALTER USER` | `UserManager.tsx` baris ±501, 786, 791, 864, 913 | Tidak diperlukan: statement akun me-reload privilege otomatis. Butuh hak `RELOAD`, sehingga admin tanpa `RELOAD` melihat error padahal user sudah terbuat | Hapus |
| X5 | Default `database: 'mysql'` di Activity Monitor, User Manager, explorer | `ActivityMonitor.tsx` ±62, ±232; `UserManager.tsx` ±482, 673, 774, 868, 906, 966; `DatabaseExplorer.tsx` ±494 | Memaksa `USE mysql`, yang gagal untuk user tanpa hak ke schema `mysql`. Akibatnya monitor tidak jalan padahal `SHOW PROCESSLIST` sebenarnya bisa | Kirim database kosong (driver tidak menjalankan `USE`) |
| X6 | `DROP PROCEDURE ...; DROP FUNCTION ...` sekaligus kalau tipe routine tidak dikenali | `DatabaseExplorer.tsx` ±2754 | MySQL membolehkan procedure dan function dengan nama sama. Menghapus satu bisa ikut menghapus yang lain | Driver mengirim tipe routine di field terstruktur (misal `ObjectSummary.Engine = "PROCEDURE"` atau field baru `RoutineType`), bukan di-encode di `Comment` `"[PROCEDURE] ..."`. Drop hanya tipe yang tepat |
| X7 | Menu/DDL `SEQUENCE` untuk MySQL | `DatabaseExplorer.tsx` ±2007, ±2537–2564, `schema_ddl_service.go` case `sequence` | Sequence hanya ada di MariaDB 10.3+. `driverCapabilities.ts` entri `mariadb` **belum** memasang `supportsSequences: true`, jadi gate harus ditambah di kedua sisi | Set `supportsSequences: true` hanya di `mariadb`, gate menu dengan capability itu |
| X8 | `EXPLAIN ANALYZE` (MySQL) dan `ANALYZE <stmt>` (MariaDB) tanpa guard | `SqlWorksheet.tsx` ±1788–1792 | `EXPLAIN ANALYZE` **mengeksekusi** statement (MariaDB: `ANALYZE <stmt>` juga mengeksekusi). Di MySQL 8 ini mencakup multi-table `UPDATE`/`DELETE`, jadi data benar-benar berubah. Juga tidak ada di MySQL < 8.0.18 | Lihat F2 |
| X9 | Auto-refresh Activity Monitor (tiap 3 detik) dicatat ke query history | `ActivityMonitor.tsx` + `RecordQueryHistory` | Membanjiri history dengan `SHOW FULL PROCESSLIST` | Flag `SkipHistory` untuk query internal UI |
| X10 | Template `ALTER DATABASE ... utf8mb4_unicode_ci` | `DatabaseExplorer.tsx` ±2130 | Default MySQL 8 adalah `utf8mb4_0900_ai_ci`, MariaDB 11.5+ `utf8mb4_uca1400_ai_ci`. Template ini mendorong pengguna mengganti collation tanpa sadar | Isi dari collation database saat ini (`information_schema.schemata`) |
| X11 | `USE` di dalam `ApplyChanges` | `mysql.go` `ApplyChanges` | Nama tabel sudah fully-qualified. `USE` menambah satu round-trip dan gagal untuk user yang hanya punya hak level tabel | Hapus |

---

## 7. Fitur yang belum ada (P1–P3)

### F1. Deteksi versi & flavor server (P1, M)

Saat ini driver tidak tahu sedang terhubung ke MySQL 5.7, 8.0, 8.4 LTS, 9.x, Percona, Aurora, TiDB, atau PlanetScale/Vitess. Banyak fitur bergantung pada versi: check constraint (8.0.16), functional index (8.0.13), invisible column (8.0.23), `EXPLAIN ANALYZE` (8.0.18), `FORMAT=TREE` (8.0.16), role (8.0), `SHOW REPLICA STATUS` (8.0.22), `mysql_native_password` nonaktif default (8.4).

**Rencana**

1. Saat connect jalankan sekali: `SELECT VERSION(), @@version_comment, @@lower_case_table_names, @@sql_mode, @@time_zone, @@system_time_zone, @@character_set_server, @@collation_server`. Deteksi Aurora (`@@aurora_version`), TiDB (`tidb_version()` / `VERSION()` mengandung `TiDB`), Vitess (`@@version_comment`).
2. Simpan di `MySQLDriver.serverInfo`. Ekspos via optional interface `ServerInfoProvider { ServerInfo(ctx) (*ServerInfo, error) }` dan service `SchemaService.GetServerInfo(connID)`.
3. Frontend: `driverCapabilities` di-merge dengan kemampuan runtime (misal `supportsExplainAnalyze`, `supportsRoles`, `supportsCheckConstraints`).
4. Tampilkan versi di tooltip koneksi dan status bar.

### F2. EXPLAIN yang lebih baik (P1, M)

1. `EXPLAIN` biasa tetap (tabel).
2. `EXPLAIN FORMAT=TREE` (8.0.16+) sebagai default tampilan teks yang mudah dibaca.
3. `EXPLAIN FORMAT=JSON` untuk visual plan (pohon node: cost, rows, access type, index yang dipakai, `using filesort`/`using temporary` disorot).
4. `EXPLAIN ANALYZE` hanya diaktifkan untuk `SELECT`/`TABLE`/`WITH ... SELECT`. Untuk statement lain: tolak, atau minta konfirmasi eksplisit dan jalankan di dalam transaksi yang di-rollback (hanya aman untuk InnoDB; tampilkan catatan itu).
5. Versi < 8.0.18: sembunyikan tombol ANALYZE.

### F4. Opsi koneksi MySQL (P2, M)

Field baru di `ConnectionConfig` (atau map `Options` seperti `pgOpts` di Postgres):

| Opsi | Implementasi | Catatan |
| :--- | :--- | :--- |
| Unix socket | `mc.Net = "unix"`, `mc.Addr = path` | Umum di Linux lokal (`/var/run/mysqld/mysqld.sock`), dan user `auth_socket` |
| Charset / collation koneksi | `mc.Collation` | Default go-sql-driver `utf8mb4_general_ci` |
| Time zone sesi | `mc.Params["time_zone"]="'+07:00'"` + `mc.Loc` | Konsisten dengan D2 |
| Init SQL | dijalankan per koneksi baru (via `Connector` + hook) | Misal `SET SESSION sql_mode=...` |
| `max_execution_time` default SELECT | `mc.Params["max_execution_time"]` (ms, MySQL 5.7.8+) | Pengaman untuk PROD |
| Cleartext password (PAM/LDAP) | `mc.AllowCleartextPasswords` | Hanya izinkan kalau TLS aktif |
| Compression | `mc.Compress` (go-sql-driver v1.8+) | Berguna lewat SSH/WAN |
| Read/write timeout | `mc.ReadTimeout`, `mc.WriteTimeout` | Deteksi koneksi mati lebih cepat |
| Connection attributes | `mc.ConnectionAttributes = "program_name:DHub"` | DBA bisa melihat sumber koneksi di `performance_schema.session_connect_attrs` |
| AWS RDS IAM auth | token via AWS SDK sebagai password | Opsional, P3 |

UI: bagian "Advanced" di `ConnectionDialog.tsx` khusus mysql/mariadb.

### F5. Cakupan objek (P2, M)

1. **Routine**: baca `information_schema.parameters` → tampilkan signature dan buat template `CALL p(?, ?)` / `SELECT f(?)` dengan parameter binding yang sudah ada. Fallback DDL kalau `SHOW CREATE PROCEDURE` mengembalikan NULL (user bukan definer, tanpa `SHOW_ROUTINE`): pakai `information_schema.routines.ROUTINE_DEFINITION` dengan catatan "body mungkin tidak lengkap".
2. **View**: `information_schema.views` (`SECURITY_TYPE`, `DEFINER`, `CHECK_OPTION`, `IS_UPDATABLE`). View yang updatable bisa diedit di grid. View yang tidak updatable harus read-only.
3. **Partisi**: `information_schema.partitions` (metode, ekspresi, jumlah baris per partisi). Field `supportsPartitions` sudah ada di capabilities.
4. **Opsi tabel**: `ROW_FORMAT`, `AUTO_INCREMENT` saat ini, `CREATE_OPTIONS`, `DATA_FREE` (fragmentasi, membantu keputusan OPTIMIZE), `TABLE_COLLATION`, charset.
5. **System views**: tandai `IsInternal` untuk `SYSTEM VIEW` dan schema sistem, supaya filter di frontend tidak hardcode di 5 tempat (`App.tsx` ±1926/2971, `RightSidebar.tsx`, `ConsoleList.tsx`, `SchemaFilterModal.tsx`). Pusatkan di `driverCapabilities.systemDatabases`.

### F6. User & privilege MySQL 8 (P2, M)

1. Role: `CREATE ROLE`, `GRANT role TO user`, `SET DEFAULT ROLE`, daftar dari `mysql.role_edges` / `information_schema.applicable_roles`.
2. Plugin autentikasi saat create/alter: `caching_sha2_password` (default 8.0+), `mysql_native_password` (nonaktif default di 8.4, beri peringatan), `auth_socket`.
3. Opsi akun: `PASSWORD EXPIRE`, `FAILED_LOGIN_ATTEMPTS`/`PASSWORD_LOCK_TIME` (8.0.19), `REQUIRE SSL/X509`, resource limits (`MAX_QUERIES_PER_HOUR`, dst.).
4. Fallback untuk user tanpa akses `mysql.user`: `SELECT CURRENT_USER()` + `SHOW GRANTS` saja, dengan pesan "butuh hak SELECT pada mysql.* untuk melihat semua user".
5. Privilege level kolom & routine (`information_schema.column_privileges`, `GRANT EXECUTE ON PROCEDURE`).
6. Semua SQL dibentuk di backend (S2).

### F7. Activity monitor (P2, M)

1. Dua aksi: **Kill Query** (`KILL QUERY id`, aman, koneksi tetap hidup) dan **Kill Connection** (`KILL id`). Saat ini hanya ada `KILL id`.
2. Sembunyikan/tandai koneksi DHub sendiri (`CONNECTION_ID()` dan `program_name` dari F4).
3. MySQL 8.0.22+ (MariaDB: lihat M9): pakai `performance_schema.processlist` (tidak memakai global mutex seperti `SHOW PROCESSLIST`) atau `sys.session` (ada info trx, lock, memory).
4. Tab tambahan: transaksi aktif (`information_schema.innodb_trx`: umur, baris terkunci), lock wait (`sys.innodb_lock_waits` atau `performance_schema.data_lock_waits`), metadata lock (`performance_schema.metadata_locks`, perlu instrument aktif).
5. Tidak masuk history (X9), tanpa `USE mysql` (X5). Validasi `proc.id` numerik sebelum disisipkan ke `KILL`.

### F8. Schema diff untuk MySQL (P1, M)

**Bukti** (`schema_diff_service.go`)

- `buildModifyColumnSQL` (±baris 578): `ALTER TABLE t MODIFY COLUMN c <type> <null>`. Di MySQL, `MODIFY` mengganti **seluruh** definisi kolom. `DEFAULT`, `AUTO_INCREMENT`, `COMMENT`, `CHARACTER SET`/`COLLATE`, `ON UPDATE`, dan ekspresi generated di target **hilang** saat migrasi dijalankan.
- `ADD COLUMN` (±baris 346) juga tanpa default/comment/posisi (`AFTER`).
- Drop index (±baris 465): `DROP INDEX x;` bukan sintaks MySQL (harus `DROP INDEX x ON t` atau `ALTER TABLE t DROP INDEX x`). Untungnya saat ini masih berupa komentar.
- FK komposit dipecah (D8).
- Perbandingan kolom hanya tipe + nullable. Default, comment, collation, extra tidak dibandingkan. Index hanya membandingkan kolom + unique, tanpa tipe (FULLTEXT/SPATIAL), prefix, atau urutan.
- Hanya tabel. View, routine, trigger, dan event tidak dibandingkan.

**Solusi**: buat `buildMySQLColumnDefinition(col ColumnMeta)` di satu tempat (dipakai diff dan, kalau memungkinkan, oleh designer lewat backend) yang menghasilkan definisi lengkap dari metadata D7. Bandingkan semua atribut. Gunakan `ALTER TABLE ... DROP INDEX`, `ADD [UNIQUE|FULLTEXT|SPATIAL] INDEX` dengan prefix dan `DESC`. Gabungkan beberapa perubahan per tabel menjadi satu `ALTER TABLE` (lebih cepat, satu rebuild). Diff view/routine/trigger/event dengan membandingkan DDL yang dinormalisasi (hapus `DEFINER`, `AUTO_INCREMENT=n`).

### F9. Backup / restore (P1, S)

**Bukti** (`schema_backup_service.go` ±baris 502–620)

- Tanpa `--hex-blob`: kolom biner di dump bisa rusak tergantung charset.
- Tanpa `--no-tablespaces`: MySQL 8.0.21+ butuh hak `PROCESS` untuk dump tablespace. User non-admin gagal dengan "Access denied; you need (at least one of) the PROCESS privilege(s)". Retry otomatis saat ini hanya untuk `COLUMN_STATISTICS` dan `GTID_PURGED`.
- Opsi SSL koneksi (CA/cert/key, mode) tidak diteruskan ke `mysqldump`/`mysql`. Backup gagal ke server yang mewajibkan TLS, atau berjalan tanpa TLS ke server yang hanya "preferred".
- Password lewat `MYSQL_PWD`: environment variable ini sudah deprecated di MySQL 8 dan bisa terlihat oleh proses lain milik user yang sama (`/proc/<pid>/environ`).
- `--ignore-table=db.tbl` dibentuk tanpa validasi nama.

**Solusi**: tambah `--hex-blob` dan `--no-tablespaces` sebagai default (dengan opsi untuk mematikan). Teruskan `--ssl-mode`, `--ssl-ca`, `--ssl-cert`, `--ssl-key`. Tulis kredensial ke file sementara `--defaults-extra-file` dengan permission `0600`, hapus setelah selesai (harus menjadi argumen **pertama**). Default `--set-gtid-purged=OFF` untuk dump satu database. Pesan error yang jelas untuk `SHOW_ROUTINE`/`TRIGGER`/`EVENT` yang kurang.

### F10. Editor sel sesuai tipe MySQL (P3, M)

1. `ENUM`/`SET`: dropdown / multi-select dari `column_type`.
2. `JSON`: validasi sebelum submit, pretty print di Value Viewer.
3. Spatial (`GEOMETRY`, `POINT`, ...): tampilkan `ST_AsText`, tulis dengan `ST_GeomFromText(?, srid)`. Butuh projection khusus di query grid (`SELECT ST_AsText(col) AS col`), atau read-only di tahap awal.
4. `BIT(1)` sebagai checkbox, `TINYINT(1)` opsional sebagai boolean.
5. `YEAR`, `TIME` (bisa negatif atau > 24 jam) memakai input teks dengan validasi, bukan time picker.

### F11. Info server (P3, M)

Panel read-only: `SHOW GLOBAL STATUS` dan `SHOW GLOBAL VARIABLES` dengan pencarian, `SHOW ENGINE INNODB STATUS`, status replikasi (`SHOW REPLICA STATUS` 8.0.22+, fallback `SHOW SLAVE STATUS`), top query dari `performance_schema.events_statements_summary_by_digest`.

### F12. Test integrasi MySQL (P0, M)

`docker-compose.yml` hanya menyediakan `mysql:8.4` di port 53306 dan **tidak ada service MariaDB**. Belum ada test Go yang memakai database sungguhan. `mysql_test.go` hanya berisi unit test murni, dan `internal/driver/mariadb/` tidak punya file test.

**Rencana**

0. Tambahkan service `mariadb` ke `docker-compose.yml` (usulan `mariadb:11.4`, port 53307, user/db `dhub`; pastikan port bebas) dan healthcheck `healthcheck.sh --connect`.
1. Build tag `//go:build integration` dan env `DHUB_MYSQL_DSN` (default `dhub:dhub@tcp(localhost:53306)/dhub`) serta `DHUB_MARIADB_DSN` (default `dhub:dhub@tcp(localhost:53307)/dhub`). Test di-skip kalau env tidak ada. Suite dibuat sekali dan dijalankan terhadap kedua driver (table-driven per flavor).
2. Fixture SQL di `scripts/dev-db/mysql-init.sql` dan `mariadb-init.sql` (seperti Postgres; fixture MariaDB menambah sequence, system-versioned table, kolom `UUID`/`INET6`, `INSERT ... RETURNING`, dan default `NULL`/literal untuk M1): tabel dengan semua tipe (BIGINT besar, unsigned, BINARY(16) PK, BIT, zero date, generated, ON UPDATE, invisible, functional index, prefix index, desc index, FK komposit, check constraint, tabel tanpa PK, view, procedure multi-result, function, trigger, event, partisi, database bernama `main`).
3. Matriks versi (opsional di CI): `mysql:5.7`, `mysql:8.0`, `mysql:8.4`, `mysql:9`, `mariadb:10.6`, `mariadb:10.11`, `mariadb:11.4`. Mode `sql_mode` strict dan `NO_BACKSLASH_ESCAPES`.
4. Setiap item di plan ini punya minimal satu test (kolom "Test" di tiap bagian).
5. Perintah: `docker compose up -d mysql mariadb && go test -tags integration ./internal/driver/mysql/... ./internal/driver/mariadb/...`. Tambahkan ke README bagian Testing.

### T1. Duplikasi MySQL vs MariaDB (P3, L)

`mysql.go` (644 baris) dan `mariadb.go` (657 baris) hampir identik dan sudah menyimpang:

- MariaDB punya `generation_expression` (salah dipetakan ke `DefaultValue`, M2), sequence di `ListObjects`, dan fallback check constraint. MySQL belum.
- MySQL punya penanganan `IS NULL` untuk PK di DML (`mysql.go` ±498–512, ±589–614). MariaDB belum, jadi PK string `"null"` di MariaDB masih berbuah `= NULL`.
- Kedua driver tidak punya test bersama. Suite integrasi F12 yang dijalankan terhadap keduanya adalah syarat sebelum T1.

Setiap perbaikan di plan ini harus ditulis dua kali kalau duplikasi dibiarkan. Usulan: paket `internal/driver/mysqlfamily` berisi implementasi bersama + interface `flavor` kecil (query metadata yang berbeda, sequence MariaDB, sintaks EXPLAIN/ANALYZE, `JSON` alias `LONGTEXT` di MariaDB). `mysql` dan `mariadb` menjadi wrapper tipis. Ini refactor besar, jadi lakukan **setelah** test integrasi F12 ada, dan perlu persetujuan (Bagian 9). Kalau tidak disetujui, setiap PR di plan ini wajib menerapkan perubahan ke kedua driver.

---

## 7A. Perbedaan khusus MariaDB (M1–M17)

Bagian ini berisi hal yang **tidak bisa** diselesaikan dengan menyalin perbaikan MySQL. Beberapa klaim tentang perilaku server MariaDB berasal dari dokumentasi dan pengetahuan umum, bukan dari eksekusi di repo ini. Item bertanda **[verifikasi]** harus dibuktikan dulu dengan suite F12 terhadap `mariadb:10.6`, `10.11`, dan `11.4` sebelum diperbaiki.

### M1. Format `column_default` MariaDB berbeda (P0, S) [verifikasi]

MariaDB 10.2.7+ mengembalikan `information_schema.columns.column_default` sebagai **teks ekspresi SQL**: default string tampil dengan kutip (`'abc'`), kolom nullable tanpa default tampil sebagai string `NULL` (bukan SQL NULL), dan fungsi tampil sebagai `current_timestamp()`. MySQL mengembalikan nilai mentah tanpa kutip dan SQL NULL. `mariadb.go` (±baris 262–268) menyalin nilai itu apa adanya ke `DefaultValue`, sedangkan designer (`CreateTableModal.tsx`) dan schema diff menganggapnya literal MySQL. Akibatnya designer bisa menulis `DEFAULT ''abc''` atau `DEFAULT 'NULL'` (default berupa teks "NULL") saat ALTER.

**Solusi**: parser default khusus MariaDB yang mengisi `DefaultKind` (`literal|expression|null|none`) dan `DefaultValue` yang sudah dinormalisasi. Test: kolom `VARCHAR DEFAULT 'abc'`, `VARCHAR NULL` tanpa default, `INT DEFAULT 0`, `DATETIME DEFAULT current_timestamp()`, `VARCHAR NOT NULL` tanpa default. Hasil ALTER lewat designer tidak boleh mengubah `SHOW CREATE TABLE`.

### M2. Generated column MariaDB salah dipetakan (P0, S)

`mariadb.go` ±baris 269: `if genExpr != "" && defVal == "" { defVal = genExpr }`. Ekspresi generated column dimasukkan ke `DefaultValue`. Designer lalu menampilkannya sebagai default biasa dan ALTER menghasilkan `DEFAULT <ekspresi>` pada kolom generated, yang ditolak server atau mengubah artinya. Fallback `hasGenExpr=false` (MariaDB < 10.2) juga membuat kolom generated tidak dikenali.

**Solusi**: ikuti D7 (`ColumnKind`, `GenerationExpression`) dan hapus pencampuran ke `DefaultValue`. Baca `extra` untuk `VIRTUAL GENERATED` / `STORED GENERATED` / `PERSISTENT`. MariaDB juga punya `INVISIBLE` (10.3+), `COMPRESSED` (10.3+), dan kolom periode system-versioning (`ROW_START`/`ROW_END`) yang harus dibaca-saja di grid. Perilaku `explicit_defaults_for_timestamp`: default OFF di MariaDB < 10.10, sehingga kolom `TIMESTAMP` pertama tanpa default eksplisit mendapat `DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` otomatis. Baca variabel itu di F1 dan tampilkan peringatan di designer. **[verifikasi]**

### M3. Executable comment MariaDB dan read-only sisi server (P0, S)

1. MariaDB mengeksekusi `/*M! ... */` dan `/*M!100100 ... */` selain `/*! ... */`. Splitter dan `stripStringsAndComments` untuk dialect `mariadb` harus memperlakukan keduanya seperti S1 (tolak di mode read-only).
2. Variabel read-only sesi: MariaDB memakai `tx_read_only` (ada sejak 5.5/10.0). Apakah `transaction_read_only` dikenali tergantung versi **[verifikasi]**. Karena variabel yang tidak dikenal membuat koneksi gagal, set lewat `SET SESSION TRANSACTION READ ONLY` setelah connect (hook init per koneksi dari F4) dan bukan lewat `mc.Params`, serta pilih nama variabel berdasarkan flavor dari F1.

### M4. `RETURNING` dan LIMIT pushdown (P1, S)

MariaDB mendukung `INSERT ... RETURNING` (10.5+), `REPLACE ... RETURNING` (10.5+), dan `DELETE ... RETURNING` (10.0+). Statement ini menghasilkan result set. Pushdown LIMIT dari P1 hanya boleh dipasang pada `SELECT`/`WITH ... SELECT`/`TABLE`, bukan pada DML ber-`RETURNING`. Tambahkan juga pengecualian untuk `LIMIT ... ROWS EXAMINED n`, `FETCH FIRST ... ROWS`, dan klausa lock `WAIT n`/`NOWAIT`/`SKIP LOCKED` (10.6+). Test per bentuk statement di suite F12.

### M5. Index & constraint: apa yang tidak ada di MariaDB (P2, S)

- Functional index dan invisible index MySQL **tidak ada** di MariaDB. D8 untuk dua hal itu hanya berlaku di MySQL. Padanan MariaDB: `IGNORED` index (10.6+, kolom `IGNORED` di `information_schema.statistics`) dan index pada virtual column.
- `DESC` index sungguhan baru ada di MariaDB 10.8. Sebelumnya `DESC` diterima tapi diabaikan. Gate tampilan arah index dengan versi.
- Check constraint: MariaDB tidak punya `ENFORCED`, jadi D9 tidak berlaku. MariaDB membuat check `json_valid(...)` otomatis untuk kolom `JSON` (alias `LONGTEXT`). Designer akan menampilkannya sebagai check constraint buatan pengguna. Sembunyikan atau tandai constraint itu **[verifikasi]**.
- `information_schema.tables.table_type` bisa bernilai `SYSTEM VERSIONED` (10.3+) dan `SEQUENCE`. Cek semua tempat yang membandingkan `BASE TABLE`/`VIEW` secara persis (backend dan frontend), supaya tabel system-versioned tidak hilang dari daftar.

### M6. Opsi koneksi: variabel dan plugin yang berbeda (P1, M)

| Opsi di F4 | MySQL | MariaDB |
| :--- | :--- | :--- |
| Batas waktu query | `max_execution_time` (ms, hanya SELECT, 5.7.8+) | `max_statement_time` (detik, desimal, semua statement, 10.1+) |
| Read-only sesi | `transaction_read_only` / `tx_read_only` | `tx_read_only` (M3) |
| Auth default | `caching_sha2_password` (8.0+) | `mysql_native_password`; `ed25519` dan `unix_socket` tersedia. Dukungan `ed25519` di go-sql-driver v1.10.1 harus dicek di module cache **[verifikasi]** |
| `performance_schema` | aktif default | **nonaktif default** (lihat M9) |
| Attribut koneksi | `program_name` terlihat di `performance_schema.session_connect_attrs` | hanya terlihat kalau `performance_schema=ON` |

Mengirim `max_execution_time` ke MariaDB (atau `max_statement_time` ke MySQL) lewat `mc.Params` membuat koneksi gagal dengan "Unknown system variable". Susun parameter sesi per flavor di satu fungsi `sessionInitSQL(flavor, opts)` dan jalankan lewat hook init, bukan DSN. `session_manager.go` saat ini membangun satu DSN yang sama untuk kedua driver (case `"mysql", "mariadb"`), jadi cabang `cfg.Driver == "mariadb"` di ±baris 435 harus dipindah ke atas, sebelum parameter diisi.

### M7. EXPLAIN MariaDB (P1, S)

MariaDB tidak punya `FORMAT=TREE` maupun `EXPLAIN ANALYZE` bergaya MySQL. Padanannya: `EXPLAIN FORMAT=JSON`, `ANALYZE <stmt>`, `ANALYZE FORMAT=JSON <stmt>` (10.1+), dan `SHOW EXPLAIN FOR <thread_id>` untuk query yang sedang berjalan. `SqlWorksheet.tsx` ±1791 sudah memakai `ANALYZE ` untuk MariaDB, tapi tanpa guard: `ANALYZE <stmt>` **mengeksekusi** statement, termasuk `UPDATE`/`DELETE`. Terapkan guard X8 untuk kedua flavor. Hati-hati dengan `ANALYZE TABLE` (statement berbeda, memperbarui statistik) yang bisa tertukar saat deteksi prefix.

### M8. User Manager MariaDB (P1, M)

- Sumber daftar user: `mysql.global_priv` (10.4+, `mysql.user` hanya view), `mysql.user` (lama). `UserManager.tsx` ±218–250 sudah punya fallback bertingkat. Pindahkan ke backend bersama S2 dan pilih query berdasarkan versi dari F1, bukan lewat percobaan-gagal.
- Role: `CREATE ROLE` (10.0.5+), `mysql.roles_mapping`, `SET DEFAULT ROLE`, `SET ROLE`. Sintaks berbeda dari MySQL 8 (`GRANT role TO user`, `SET DEFAULT ROLE ... FOR user`).
- Autentikasi: `IDENTIFIED VIA ed25519 USING PASSWORD('...')`, `IDENTIFIED VIA unix_socket`, bisa beberapa plugin sekaligus (`OR`). Sintaks MySQL `IDENTIFIED WITH plugin BY` tidak berlaku.
- Kunci akun: `ALTER USER ... ACCOUNT LOCK` hanya di 10.4.2+. Versi lama harus menyembunyikan tombol lock.
- `FLUSH PRIVILEGES` juga tidak perlu di MariaDB untuk `GRANT`/`CREATE USER` (X4), hanya kalau tabel `mysql.*` diubah langsung.
- Escape string untuk S2 sama dengan MySQL, tapi `NO_BACKSLASH_ESCAPES` dan `sql_mode` default MariaDB berbeda. Baca `@@sql_mode` per koneksi.

### M9. Activity monitor MariaDB (P2, S)

- `performance_schema` nonaktif secara default, jadi saran F7 butir 3 (`performance_schema.processlist`, `data_lock_waits`, `metadata_locks`) tidak bisa dipakai. Gunakan `information_schema.processlist` (punya kolom `PROGRESS`, `STAGE`, `MAX_STAGE`), `information_schema.innodb_trx`, dan `information_schema.innodb_lock_waits`. Deteksi `@@performance_schema` dan hanya tampilkan tab yang tersedia.
- Sintaks `KILL` MariaDB: `KILL [HARD | SOFT] [CONNECTION | QUERY] id` dan `KILL QUERY ID query_id`. `KILL QUERY id` sama seperti MySQL, jadi aksi "Kill Query" F7 tetap valid.
- `SHOW EXPLAIN FOR id` bisa ditambahkan di baris proses sebagai aksi.
- Skema `sys` baru ada di MariaDB 10.6+.

### M10. Backup MariaDB: flag per biner (P1, S)

`schema_backup_service.go` ±460–470 memilih biner `mysqldump`/`mariadb-dump` dari urutan fallback, dan ±605 mendeteksi `isMariaDBDump` dari nama biner. Saran F9 harus dibedakan **per biner**, bukan per `conn.Driver`:

| Flag | `mysqldump` (8.x) | `mariadb-dump` |
| :--- | :--- | :--- |
| `--hex-blob` | ya | ya |
| `--no-tablespaces` | ya (8.0.21+, 5.7.31+) | tidak ada **[verifikasi]**. Jangan dikirim |
| `--column-statistics=0` | ya | tidak ada |
| `--set-gtid-purged=OFF` | ya | tidak ada (sudah ditangani) |
| SSL | `--ssl-mode=...` | `--ssl`, `--ssl-ca`, `--ssl-cert`, `--ssl-key`, `--ssl-verify-server-cert`. `--ssl-mode` hanya ada di versi baru **[verifikasi]** |

Pasangan driver dan biner bisa tidak cocok (driver `mysql` dengan hanya `mariadb-dump` terpasang, atau `mysqldump` 8 melawan server MariaDB). `mysqldump` 8 terhadap MariaDB sering gagal di `COLUMN_STATISTICS` dan perilaku `GTID`. Susun flag dari nama biner yang benar-benar dipakai, dan jalankan `<biner> --help` sekali (cache) untuk mengecek flag yang didukung sebelum menambahkannya. Dump MariaDB dengan sequence perlu `mariadb-dump` yang mendukung `--sequences`/default 10.3+ **[verifikasi]**. Perubahan `--defaults-extra-file` (F9) berlaku untuk keduanya.

### M11. Zero date lebih sering terjadi di MariaDB (P1, S) [verifikasi]

Default `sql_mode` MariaDB tidak memuat `NO_ZERO_DATE`/`NO_ZERO_IN_DATE` seperti MySQL 5.7+/8.x, jadi `0000-00-00` jauh lebih umum pada data MariaDB yang ada. D2 menjadi P1 pasti untuk MariaDB. Rekomendasi opsi B (`ParseTime=false`) di D2 sebaiknya diterapkan ke kedua driver sekaligus.

### M12. Tipe khusus MariaDB (P2, M) [verifikasi]

`UUID` (10.7+), `INET6` (10.5+), `INET4` (10.10+), `VECTOR` (11.7+) dikirim ke klien dengan representasi yang bisa berupa biner. Cek apa yang dikembalikan `DatabaseTypeName()` dan bytes-nya, lalu perlakukan sesuai D3 (tampilkan sebagai teks kanonik, terima teks saat edit). Tambahkan ke `parseColumnType` di designer dan pastikan `ApplyChanges` tidak mengutip ulang nilai yang sudah benar.

---

### M13. Schema diff dan DDL: sintaks yang beda antar flavor (P1, M)

Diperiksa di `schema_diff_service.go`:

- ±baris 549: perubahan check constraint memakai `DROP CONSTRAINT IF EXISTS` untuk semua driver. MariaDB mendukungnya. MySQL tidak punya `IF EXISTS` pada `DROP CONSTRAINT`, jadi migrasi ini kemungkinan gagal di MySQL **[verifikasi]**. `DROP CONSTRAINT` baru dikenali MySQL 8.0.19+. Pada 8.0.16–8.0.18 harus `DROP CHECK`.
- ±baris 560 dan 610: komentar "Extra check/FK in target" memakai `DROP CONSTRAINT`. Di MySQL, FK harus `DROP FOREIGN KEY name` (di MariaDB juga). `DROP CONSTRAINT` untuk FK baru ada di MySQL 8.0.19+.
- ±baris 676: `MODIFY COLUMN` hanya membawa tipe dan nullable (F8). Untuk MariaDB, kolom generated memakai `AS (expr) VIRTUAL|PERSISTENT|STORED`, dan atribut `INVISIBLE`/`COMPRESSED` ikut hilang.
- Sequence MariaDB dan tabel system-versioned (`WITH SYSTEM VERSIONING`) tidak dibandingkan. Tanpa penanganan, migrasi bisa menghapus versioning atau gagal.

**Solusi**: `buildColumnDefinition(flavor, col)` dan `buildDropConstraint(flavor, version, kind, name)` memilih sintaks berdasarkan flavor dan versi (F1, M14). Tambahkan `CREATE SEQUENCE`/`ALTER SEQUENCE` ke diff MariaDB. Untuk tabel system-versioned, bandingkan flag versioning dan jangan menonaktifkannya tanpa konfirmasi. **Test**: jalankan migrasi hasil diff terhadap server tujuan sungguhan di suite F12 (MySQL 8.0.18, 8.0.19+, 8.4; MariaDB 10.6, 11.4).

### M14. Deteksi versi dan flavor MariaDB (P1, S)

F1 hanya membahas flavor MySQL. Tambahan untuk MariaDB:

- `VERSION()` bisa berawalan `5.5.5-` (misal `5.5.5-10.11.6-MariaDB`) **[verifikasi]**. Parser harus membuang awalan itu sebelum membandingkan versi, kalau tidak MariaDB 10.x terbaca sebagai 5.5.5.
- Deteksi MariaDB dari `VERSION()` atau `@@version_comment` yang mengandung `MariaDB`, bukan dari driver yang dipilih pengguna (keputusan 8).
- Gate fitur per versi MariaDB: sequence 10.3, check constraint 10.2.1, `RETURNING` pada INSERT 10.5, `IGNORED` index 10.6, `DESC` index 10.8, `UUID` 10.7, `account_locked` 10.4.2, skema `sys` 10.6.
- Simpan juga `@@sql_mode`, `@@explicit_defaults_for_timestamp`, `@@performance_schema`.
- `ServerInfo` memuat `Flavor` (`mysql|mariadb|percona|tidb|aurora|vitess`) dan `Version` terstruktur (major, minor, patch), supaya gate versi tidak membandingkan string.

### M15. Autocomplete, formatter, dan snippet MariaDB (P2, M) [verifikasi]

- `monacoSetup.ts` hanya mendaftarkan bahasa `mysql`, sedangkan `SqlWorksheet.tsx` ±1742 memberi `lang = 'mariadb'` pada driver MariaDB. Cek apakah `'mariadb'` valid untuk formatter yang dipakai dan apakah editor memakai highlight MySQL untuk MariaDB.
- Daftar fungsi di `monacoSetup.ts` (±baris 114) bergaya MySQL. Tambahkan yang khas MariaDB: `NEXTVAL`/`NEXT VALUE FOR`, `LASTVAL`, `SETVAL`, `JSON_VALUE`, `UUID()`, `INET6_ATON`, `FOR SYSTEM_TIME`, `RETURNING`. Fungsi khas MySQL 8 (`BIN_TO_UUID`, `JSON_SCHEMA_VALID`) jangan tampil untuk MariaDB.
- `SnippetsModal.tsx` sudah punya opsi `mariadb`. Pastikan ada snippet bawaan untuk sequence dan `RETURNING`, dan snippet khusus MySQL 8 tidak muncul di MariaDB.
- `HelpModal.tsx` menggabungkan MySQL dan MariaDB dalam satu entri. Pisahkan bagian yang berbeda.

### M16. Fitur khusus MariaDB yang belum ada (P2–P3, M)

1. **Sequence (P2)**: `ListObjects` sudah mengembalikan tipe `sequence` (`RowEstimate=-1`) dan `handleSequenceClick` di `DatabaseExplorer.tsx` ±2537 sudah membuat template. Yang kurang adalah gate capability (X7) dan aksi menu: `NEXTVAL`, `SETVAL`, `ALTER SEQUENCE`, `DROP SEQUENCE`.
2. **System-versioned table (P3)**: tandai tabel (`table_type = 'SYSTEM VERSIONED'`), tampilkan kolom `ROW_START`/`ROW_END` sebagai baca-saja, sediakan template `SELECT ... FOR SYSTEM_TIME AS OF/ALL/BETWEEN`. Grid tidak boleh mengedit baris historis.
3. **`sql_mode=ORACLE` (P3)**: kalau terdeteksi lewat F1, splitter perlu mengenali blok `BEGIN ... END` gaya PL/SQL dan `/` sebagai terminator. Kalau belum didukung, tampilkan peringatan.
4. **Engine tabel (P3)**: `Aria`, `ColumnStore`, `Spider`, `S3`, dan opsi `PAGE_CHECKSUM`/`TRANSACTIONAL`. Daftar engine di designer diambil dari `SHOW ENGINES`, bukan daftar tetap.
5. **JSON (P3)**: `JSON` adalah alias `LONGTEXT` (M5). Value Viewer tidak boleh menganggap kolom sebagai JSON hanya dari nama tipe.

### M17. Export dan data diff antar flavor (P2, S)

- `export_service.go` ±286 dan `data_diff_service.go` ±53 hanya menyamakan cabang `mysql`/`mariadb` untuk quoting. Setelah D2, D3, dan M12, kedua service harus memakai representasi nilai yang sama dengan grid: zero date apa adanya, biner sebagai `0x..`, `UUID`/`INET6` sebagai teks kanonik. Tambahkan test export dan data diff MySQL-ke-MariaDB, karena data diff lintas flavor akan menemukan beda representasi (misal `current_timestamp()` vs `CURRENT_TIMESTAMP`).
- Export SQL dari satu flavor ke flavor lain tidak boleh memuat sintaks satu sisi (`/*M! ... */`, `PERSISTENT`). Beri peringatan di dialog export bila flavor sumber dan tujuan berbeda.

---

## 8. Urutan pengerjaan (fase)

Setiap fase bisa dirilis sendiri. Setiap item berlaku untuk MySQL dan MariaDB kecuali disebut lain. Urutan dipilih supaya test ada lebih dulu, lalu keamanan dan kehilangan data, baru fitur.

### Fase 0 — Fondasi test (± 2 hari)

- F12: harness integrasi + fixture MySQL.
- Tulis test yang **gagal** untuk S1, D1, D4, D7, P1. Test ini menjadi bukti bug sebelum diperbaiki.
- Tambah service MariaDB ke compose dan jalankan suite yang sama untuk kedua driver.
- Koordinasi dengan perubahan belum di-commit di `schema_ddl_service.go`/`schema_diff_service.go`/`SchemaDiffModal.tsx` sebelum menyentuh F8 dan X7. `executor.go`/`splitter.go`/`query_service.go`/`session_manager.go` saat ini bersih.

### Fase 1 — Keamanan & kehilangan data (± 4–5 hari)

| Urutan | Item | File utama |
| :---: | :--- | :--- |
| 1 | S1 + X1 + M3 (dialect mysql/mariadb di splitter, `/*M!`, `MultiStatements=false`, read-only di sisi server per flavor) | `splitter.go`, `session_manager.go`, `mysql.go`, `mariadb.go`, `query_service.go` |
| 2 | D1 (BIGINT) | `executor.go`, `mysql.go` |
| 3 | P1 + M4 (LIMIT di halaman pertama, kecuali `RETURNING`) | `executor.go` |
| 4 | D4 + X2 (hapus normalisasi berbahaya) | `mysql.go`, `mariadb.go` |
| 5 | S4 (escape preview) | `mysql.go`, paket format bersama |
| 6 | S3 (TLS fail-closed) | `session_manager.go` |
| 7 | S2 + X4 + X9 (User Manager ke backend, redaksi history) | service baru, `UserManager.tsx`, `query_service.go` |
| 8 | D7 + M1 + M2 (metadata kolom, format default MariaDB) + mapping designer | `driver.go`, `mysql.go`, `mariadb.go`, `CreateTableModal.tsx`, bindings |

Kriteria selesai: semua test Fase 0 hijau, `go test ./...` dan `npm run build` lulus.
### Fase 2 — Kebenaran editing & metadata (± 4 hari)


D2 (pilih opsi A/B, bersama M11), D3 + M12, D5, D6, D8 + M5, D10, D12, S5, X5, X6, X7, X11.

### Fase 3 — Sesi, transaksi, cancel (± 5–7 hari)

P4 (pisah pool), F3 (session pinning), D13, D14, D15, D16, D17, D18.
Ini fase paling berisiko karena mengubah alur eksekusi. Butuh test konkuren: beberapa tab, transaksi manual, cancel di tengah `UPDATE` besar, kill koneksi dari server.

### Fase 4 — Fitur (± 6–8 hari, bisa paralel)

F1 + M14 (wajib duluan, karena F2/F6/D9/M6/M13 bergantung padanya), F2 + M7, X8, F8 + M13, F9 + M10, P2, F4 + M6, F5, F6 + M8, F7 + M9, M16 butir 1 (sequence), M17.

### Fase 5 — Opsional

F10, F11, P3, D9, D11 (tahap hapus sentinel), X10, M5 (bagian opsional), M15, M16 butir 2–5, T1 (refactor MySQL/MariaDB).

---

## 9. Keputusan yang perlu dikonfirmasi

1. **MariaDB ikut diperbaiki?** Sudah diputuskan: ya, dalam PR yang sama, sampai T1 dikerjakan. Yang perlu konfirmasi: versi MariaDB minimum. Usulan: 10.6 LTS ke atas penuh, 10.3–10.5 best-effort (sequence butuh 10.3, check constraint 10.2.1, `account_locked` 10.4.2, sys schema 10.6).
2. **D2: `ParseTime`.** Opsi B (`ParseTime=false`, string apa adanya) lebih sederhana dan lebih akurat, tapi perlu audit export/data-diff. Opsi A lebih kecil dampaknya ke kode lain.
3. **D5: tabel tanpa PK.** Read-only, atau boleh edit dengan "cocokkan semua kolom + `LIMIT 1`" dan peringatan?
4. **Versi minimum.** MySQL 5.7 sudah EOL (Oktober 2023). Usulan: 8.0+ didukung penuh, 5.7 best-effort (fitur yang butuh 8.0 disembunyikan via F1).
5. **T1: refactor gabungan MySQL/MariaDB.** Setuju dikerjakan setelah test integrasi ada?
6. **S1 poin 4: read-only di sisi server** (`transaction_read_only`). Perilaku ini bisa mengejutkan kalau pengguna sengaja memakai temporary table di koneksi read-only. Setuju dijadikan default?
7. **F3: session pinning** menambah jumlah koneksi ke server (satu per tab console aktif). Perlu batas default (usulan 16) dan opsi untuk mematikannya.
8. **Koneksi driver yang salah.** Pengguna bisa memilih `mysql` untuk server MariaDB atau sebaliknya. Setelah F1 mendeteksi flavor, tampilkan peringatan dan tawarkan ganti driver, atau pilih perilaku otomatis berdasarkan flavor terdeteksi?

---

## 10. Risiko

| Risiko | Mitigasi |
| :--- | :--- |
| `MultiStatements=false` mematahkan fitur yang diam-diam mengirim banyak statement sekaligus | Audit grep semua `ExecContext`/`QueryContext` di service sebelum mengubah, tambah test integrasi untuk restore, User Manager, maintenance |
| LIMIT pushdown mengubah hasil query yang ditulis pengguna (misal `UNION`, `FOR UPDATE`) | Daftar pengecualian + test per bentuk statement; fallback ke perilaku lama kalau ragu |
| Perubahan executor bersama berdampak ke driver lain | Semua logika baru di-gate dengan `dialect == "mysql" \|\| "mariadb"` |
| Session pinning menyebabkan kebocoran koneksi | Batas jumlah sesi, idle timeout, cleanup saat disconnect/tutup tab, metrik jumlah sesi di log |
| Field baru di `ColumnMeta`/`IndexMeta` memerlukan regenerasi binding | Semua field `omitempty`; jalankan `wails3 generate bindings` dan `npm run build` di setiap PR |
| Konflik dengan perubahan belum di-commit di file schema diff/DDL | Kerjakan F8 dan X7 setelah perubahan itu di-commit |
| Variabel sesi yang tidak dikenal flavor tertentu membuat koneksi gagal (`transaction_read_only`, `max_execution_time` di MariaDB) | Deteksi flavor lewat koneksi probe (F1) sebelum menyusun DSN. Jangan pakai `mc.Params` untuk variabel yang beda antar flavor |
| Perbaikan hanya diterapkan ke satu driver | Suite integrasi yang sama dijalankan untuk MySQL dan MariaDB. PR tidak boleh merge kalau salah satu tidak hijau |