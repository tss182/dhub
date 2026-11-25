//go:build integration

package mysql

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
	dsn := os.Getenv("DHUB_MYSQL_DSN")
	if dsn == "" {
		dsn = "dhub:dhub@tcp(localhost:53306)/dhub"
	}
	dsn = withAppOptions(dsn)
	drv, err := NewMySQLDriver(dsn)
	if err != nil {
		t.Skipf("server unavailable: %v", err)
	}
	defer drv.Close()
	if err := drv.Ping(t.Context()); err != nil {
		t.Skipf("server not reachable at %s: %v", dsn, err)
	}
	ro, err := NewMySQLDriverWithOptions(dsn, true)
	if err != nil {
		t.Fatalf("open read-only driver: %v", err)
	}
	defer ro.Close()
	mysqlsuite.RunWithReadOnly(t, drv, ro, "dhub")
}
