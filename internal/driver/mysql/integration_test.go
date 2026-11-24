//go:build integration

package mysql

import (
	"os"
	"testing"

	"dhub/internal/driver/mysqlsuite"
)

func TestIntegration(t *testing.T) {
	dsn := os.Getenv("DHUB_MYSQL_DSN")
	if dsn == "" {
		dsn = "dhub:dhub@tcp(localhost:53306)/dhub?parseTime=true"
	}
	drv, err := NewMySQLDriver(dsn)
	if err != nil {
		t.Skipf("mysql unavailable: %v", err)
	}
	defer drv.Close()
	if err := drv.Ping(t.Context()); err != nil {
		t.Skipf("mysql not reachable at %s: %v", dsn, err)
	}
	mysqlsuite.Run(t, drv, "dhub")
}
