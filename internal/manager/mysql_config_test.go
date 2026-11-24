package manager

import (
	"testing"

	"dhub/internal/store"
)

func TestNewMySQLConfig_SafeDefaults(t *testing.T) {
	for _, drv := range []string{"mysql", "mariadb"} {
		mc, err := newMySQLConfig(store.ConnectionConfig{ID: "c1", Driver: drv, Username: "u", DatabaseName: "d"}, "db.local", 3306)
		if err != nil {
			t.Fatal(err)
		}
		if mc.ParseTime {
			t.Errorf("%s: ParseTime must be off so zero dates and fractional seconds survive", drv)
		}
		if !mc.ClientFoundRows {
			t.Errorf("%s: ClientFoundRows must be on so RowsAffected means matched rows", drv)
		}
		if mc.MultiStatements {
			t.Errorf("%s: MultiStatements must be off", drv)
		}
		if mc.Addr != "db.local:3306" || mc.DBName != "d" {
			t.Errorf("%s: unexpected addr/db %q %q", drv, mc.Addr, mc.DBName)
		}
	}
}
