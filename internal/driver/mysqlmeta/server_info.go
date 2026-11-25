package mysqlmeta

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
)

// ServerInfo mirrors driver.ServerInfo without creating a package cycle with internal/driver.
type ServerInfo struct {
	Flavor                    string
	Version                   string
	Major                     int
	Minor                     int
	Patch                     int
	VersionComment            string
	SQLMode                   string
	TimeZone                  string
	SystemTimeZone            string
	CharacterSetServer        string
	CollationServer           string
	LowerCaseTableNames       int
	ExplicitDefaultsTimestamp bool
	PerformanceSchema         bool
	SupportsExplainTree       bool
	SupportsExplainAnalyze    bool
	SupportsCheckConstraints  bool
	SupportsFunctionalIndexes bool
	SupportsInvisibleColumns  bool
	SupportsRoles             bool
	SupportsSequences         bool
	SupportsReturning         bool
	SupportsIgnoredIndexes    bool
}

// ParseServerVersion extracts the server flavor and numeric version (major, minor, patch).
// MariaDB often reports "5.5.5-10.11.6-MariaDB" due to its replication compatibility prefix;
// that leading "5.5.5-" is stripped so MariaDB 10.x is not misidentified as 5.5.5.
func ParseServerVersion(rawVersion, versionComment string) (flavor string, major, minor, patch int) {
	v := strings.TrimSpace(rawVersion)
	lowerV := strings.ToLower(v)
	lowerC := strings.ToLower(versionComment)

	switch {
	case strings.Contains(lowerV, "mariadb") || strings.Contains(lowerC, "mariadb"):
		flavor = "mariadb"
	case strings.Contains(lowerV, "tidb") || strings.Contains(lowerC, "tidb"):
		flavor = "tidb"
	case strings.Contains(lowerC, "percona") || strings.Contains(lowerV, "percona"):
		flavor = "percona"
	case strings.Contains(lowerC, "vitess") || strings.Contains(lowerV, "vitess"):
		flavor = "vitess"
	default:
		flavor = "mysql"
	}

	if flavor == "mariadb" && strings.HasPrefix(v, "5.5.5-") {
		v = strings.TrimPrefix(v, "5.5.5-")
	}

	// Strip any suffix after '-' (e.g. "-MariaDB", "-log", "-0ubuntu0.22.04.1").
	if dash := strings.IndexByte(v, '-'); dash >= 0 {
		v = v[:dash]
	}

	parts := strings.Split(v, ".")
	if len(parts) > 0 {
		major, _ = strconv.Atoi(parts[0])
	}
	if len(parts) > 1 {
		minor, _ = strconv.Atoi(parts[1])
	}
	if len(parts) > 2 {
		patch, _ = strconv.Atoi(parts[2])
	}
	return flavor, major, minor, patch
}

// VersionAtLeast reports whether (major, minor, patch) >= (reqMajor, reqMinor, reqPatch).
func VersionAtLeast(major, minor, patch, reqMajor, reqMinor, reqPatch int) bool {
	if major != reqMajor {
		return major > reqMajor
	}
	if minor != reqMinor {
		return minor > reqMinor
	}
	return patch >= reqPatch
}

// DetectServerInfo queries the connected server for its version, flavor, and session settings.
func DetectServerInfo(ctx context.Context, db *sql.DB) (*ServerInfo, error) {
	var rawVer, verComment, sqlMode, tz, sysTz, charset, collation sql.NullString
	var lowerCase sql.NullInt64

	err := db.QueryRowContext(ctx,
		`SELECT VERSION(), @@version_comment, @@lower_case_table_names, @@sql_mode, @@time_zone, @@system_time_zone, @@character_set_server, @@collation_server`,
	).Scan(&rawVer, &verComment, &lowerCase, &sqlMode, &tz, &sysTz, &charset, &collation)
	if err != nil {
		return nil, err
	}

	flavor, major, minor, patch := ParseServerVersion(rawVer.String, verComment.String)

	// Detect Amazon Aurora MySQL if @@aurora_version exists.
	var auroraVer sql.NullString
	if err := db.QueryRowContext(ctx, `SELECT @@aurora_version`).Scan(&auroraVer); err == nil && strings.TrimSpace(auroraVer.String) != "" {
		flavor = "aurora"
	}

	var explicitTS, perfSchema sql.NullInt64
	_ = db.QueryRowContext(ctx, `SELECT @@explicit_defaults_for_timestamp`).Scan(&explicitTS)
	_ = db.QueryRowContext(ctx, `SELECT @@performance_schema`).Scan(&perfSchema)

	info := &ServerInfo{
		Flavor:                    flavor,
		Version:                   rawVer.String,
		Major:                     major,
		Minor:                     minor,
		Patch:                     patch,
		VersionComment:            verComment.String,
		SQLMode:                   sqlMode.String,
		TimeZone:                  tz.String,
		SystemTimeZone:            sysTz.String,
		CharacterSetServer:        charset.String,
		CollationServer:           collation.String,
		LowerCaseTableNames:       int(lowerCase.Int64),
		ExplicitDefaultsTimestamp: explicitTS.Int64 == 1,
		PerformanceSchema:         perfSchema.Int64 == 1,
	}

	if flavor == "mariadb" {
		info.SupportsCheckConstraints = VersionAtLeast(major, minor, patch, 10, 2, 1)
		info.SupportsSequences = VersionAtLeast(major, minor, patch, 10, 3, 0)
		info.SupportsInvisibleColumns = VersionAtLeast(major, minor, patch, 10, 3, 0)
		info.SupportsRoles = VersionAtLeast(major, minor, patch, 10, 0, 5)
		info.SupportsReturning = VersionAtLeast(major, minor, patch, 10, 5, 0)
		info.SupportsIgnoredIndexes = VersionAtLeast(major, minor, patch, 10, 6, 0)
		info.SupportsExplainAnalyze = VersionAtLeast(major, minor, patch, 10, 1, 0)
	} else {
		info.SupportsExplainTree = VersionAtLeast(major, minor, patch, 8, 0, 16)
		info.SupportsExplainAnalyze = VersionAtLeast(major, minor, patch, 8, 0, 18)
		info.SupportsCheckConstraints = VersionAtLeast(major, minor, patch, 8, 0, 16)
		info.SupportsFunctionalIndexes = VersionAtLeast(major, minor, patch, 8, 0, 13)
		info.SupportsInvisibleColumns = VersionAtLeast(major, minor, patch, 8, 0, 23)
		info.SupportsRoles = VersionAtLeast(major, minor, patch, 8, 0, 0)
	}

	return info, nil
}
