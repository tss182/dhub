//go:build integration

package mariadb

import (
	"os"
	"strings"
	"testing"

	"dhub/internal/driver/mysqlsuite"
)

// withAppOptions adds the connection options the application always sets, so the suite
// exercises the same behaviour: dates stay as text and RowsAffected counts matched rows.
func withAppOptions(dsn string) string {
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	return dsn + sep + "parseTime=false&clientFoundRows=true&multiStatements=false"
}

func TestIntegration(t *testing.T) {
	dsn := os.Getenv("DHUB_MARIADB_DSN")
	if dsn == "" {
		dsn = "dhub:dhub@tcp(localhost:53307)/dhub"
	}
	dsn = withAppOptions(dsn)
	drv, err := NewMariaDBDriver(dsn)
	if err != nil {
		t.Skipf("server unavailable: %v", err)
	}
	defer drv.Close()
	if err := drv.Ping(t.Context()); err != nil {
		t.Skipf("server not reachable at %s: %v", dsn, err)
	}
	ro, err := NewMariaDBDriverWithOptions(dsn, true)
	if err != nil {
		t.Fatalf("open read-only driver: %v", err)
	}
	defer ro.Close()
	mysqlsuite.RunWithReadOnly(t, drv, ro, "dhub")
}
