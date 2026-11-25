package mysqlmeta

import "testing"

func TestParseServerVersion(t *testing.T) {
	cases := []struct {
		raw     string
		comment string
		flavor  string
		major   int
		minor   int
		patch   int
	}{
		{"8.4.3", "MySQL Community Server - GPL", "mysql", 8, 4, 3},
		{"5.7.44-log", "MySQL Community Server (GPL)", "mysql", 5, 7, 44},
		{"5.5.5-10.11.6-MariaDB-1:10.11.6+maria~ubu2204", "mariadb.org binary distribution", "mariadb", 10, 11, 6},
		{"11.4.2-MariaDB", "MariaDB Server", "mariadb", 11, 4, 2},
		{"8.0.36-28", "Percona Server (GPL), Release 28, Revision 47601f19", "percona", 8, 0, 36},
		{"8.0.11-TiDB-v7.5.1", "TiDB Server (Apache License 2.0) Community Edition", "tidb", 8, 0, 11},
	}
	for _, tc := range cases {
		f, maj, min, pat := ParseServerVersion(tc.raw, tc.comment)
		if f != tc.flavor || maj != tc.major || min != tc.minor || pat != tc.patch {
			t.Errorf("ParseServerVersion(%q, %q) = (%s, %d.%d.%d), want (%s, %d.%d.%d)",
				tc.raw, tc.comment, f, maj, min, pat, tc.flavor, tc.major, tc.minor, tc.patch)
		}
	}
}
