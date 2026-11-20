package services

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"dhub/internal/driver"
)

// GetDatabaseDDL returns the combined DDL statements (schema only, no data) for a database or specific schema.
func (s *SchemaService) GetDatabaseDDL(connectionID, database, schema string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	drv, err := s.sessions.GetOrConnect(ctx, connectionID)
	if err != nil {
		return "", err
	}

	conn, _ := s.store.GetConnection(ctx, connectionID)
	driverName := ""
	if conn != nil {
		driverName = strings.ToLower(strings.TrimSpace(conn.Driver))
	}

	database = strings.TrimSpace(database)
	schema = strings.TrimSpace(schema)

	var schemas []string
	if schema != "" {
		schemas = []string{schema}
	} else if driverName == "postgres" || driverName == "mssql" || driverName == "oracle" {
		listed, listErr := drv.ListSchemas(ctx, database)
		if listErr == nil && len(listed) > 0 {
			schemas = listed
		} else if driverName == "postgres" {
			schemas = []string{"public"}
		} else if driverName == "mssql" {
			schemas = []string{"dbo"}
		} else {
			schemas = []string{""}
		}
	} else {
		schemas = []string{database}
	}

	var sb strings.Builder
	sb.WriteString("-- ============================================================\n")
	sb.WriteString("-- DHub DDL Export (Structure Only, No Data)\n")
	if database != "" {
		sb.WriteString(fmt.Sprintf("-- Database: %s\n", database))
	}
	if schema != "" {
		sb.WriteString(fmt.Sprintf("-- Schema:   %s\n", schema))
	}
	sb.WriteString(fmt.Sprintf("-- Date:     %s\n", time.Now().Format("2006-01-02 15:04:05")))
	sb.WriteString("-- ============================================================\n\n")

	objectCount := 0
	for _, sch := range schemas {
		objs, listErr := drv.ListObjects(ctx, database, sch)
		if listErr != nil {
			if len(schemas) == 1 {
				return "", listErr
			}
			continue
		}

		var ordered []driver.ObjectSummary
		for _, o := range objs {
			if o.Type == "table" {
				ordered = append(ordered, o)
			}
		}
		for _, o := range objs {
			if o.Type == "view" || o.Type == "materialized_view" {
				ordered = append(ordered, o)
			}
		}

		if len(schemas) > 1 && len(ordered) > 0 {
			sb.WriteString(fmt.Sprintf("-- Schema: %s\n\n", sch))
		}

		for _, obj := range ordered {
			tStruct, structErr := drv.GetTableStructure(ctx, database, sch, obj.Name)
			if structErr != nil || tStruct == nil {
				continue
			}
			ddl := strings.TrimSpace(tStruct.DDL)
			if ddl == "" {
				continue
			}
			if !strings.HasSuffix(ddl, ";") {
				ddl += ";"
			}
			label := strings.ToUpper(obj.Type)
			if sch != "" && sch != database {
				sb.WriteString(fmt.Sprintf("-- %s: %s.%s\n", label, sch, obj.Name))
			} else {
				sb.WriteString(fmt.Sprintf("-- %s: %s\n", label, obj.Name))
			}
			sb.WriteString(ddl)
			sb.WriteString("\n\n")
			objectCount++
		}
	}

	if objectCount == 0 {
		sb.WriteString("-- No tables or views found.\n")
	}

	return strings.TrimRight(sb.String(), "\n") + "\n", nil
}

// SaveDDLFile writes generated DDL text to the specified file path on disk.
func (s *SchemaService) SaveDDLFile(filePath, content string) error {
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return fmt.Errorf("file path is required")
	}
	return os.WriteFile(filePath, []byte(content), 0644)
}

// GetObjectDDL retrieves the live DDL definition for a routine, trigger, event, sequence, view, or table.
func (s *SchemaService) GetObjectDDL(connectionID, database, schema, objectType, objectName string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	drv, err := s.sessions.GetOrConnect(ctx, connectionID)
	if err != nil {
		return "", err
	}

	conn, _ := s.store.GetConnection(ctx, connectionID)
	drvName := ""
	if conn != nil {
		drvName = strings.ToLower(strings.TrimSpace(conn.Driver))
	}

	objType := strings.ToLower(strings.TrimSpace(objectType))
	objName := strings.TrimSpace(objectName)
	database = strings.TrimSpace(database)
	schema = strings.TrimSpace(schema)

	if objType == "table" || objType == "" {
		st, sErr := drv.GetTableStructure(ctx, database, schema, objName)
		if sErr != nil {
			return "", sErr
		}
		return st.DDL, nil
	}

	execSingleCell := func(sqlText string, colIdx int) (string, error) {
		res, qErr := drv.Execute(ctx, driver.QueryRequest{
			ExecutionID:  "ddl-" + fmt.Sprintf("%d", time.Now().UnixNano()),
			ConnectionID: connectionID,
			Database:     database,
			Schema:       schema,
			SQL:          sqlText,
			Limit:        10,
		})
		if qErr != nil {
			return "", qErr
		}
		if res == nil || len(res.Rows) == 0 || len(res.Rows[0]) <= colIdx || res.Rows[0][colIdx] == nil {
			return "", fmt.Errorf("definition not found")
		}
		return strings.TrimSpace(fmt.Sprint(res.Rows[0][colIdx])), nil
	}

	escLit := func(v string) string {
		return strings.ReplaceAll(v, "'", "''")
	}

	switch drvName {
	case "mysql", "mariadb":
		dbPrefix := ""
		targetDB := schema
		if targetDB == "" || targetDB == "main" {
			targetDB = database
		}
		if targetDB != "" && targetDB != "main" {
			dbPrefix = quoteIdentifier(drvName, targetDB) + "."
		}
		qName := quoteIdentifier(drvName, objName)
		switch objType {
		case "routine":
			if ddl, err := execSingleCell(fmt.Sprintf("SHOW CREATE PROCEDURE %s%s", dbPrefix, qName), 2); err == nil && ddl != "" {
				return ddl, nil
			}
			return execSingleCell(fmt.Sprintf("SHOW CREATE FUNCTION %s%s", dbPrefix, qName), 2)
		case "trigger":
			return execSingleCell(fmt.Sprintf("SHOW CREATE TRIGGER %s%s", dbPrefix, qName), 2)
		case "event":
			return execSingleCell(fmt.Sprintf("SHOW CREATE EVENT %s%s", dbPrefix, qName), 3)
		case "sequence":
			return execSingleCell(fmt.Sprintf("SHOW CREATE SEQUENCE %s%s", dbPrefix, qName), 1)
		case "view":
			return execSingleCell(fmt.Sprintf("SHOW CREATE VIEW %s%s", dbPrefix, qName), 1)
		}

	case "postgres":
		sch := schema
		if sch == "" || sch == "main" {
			sch = "public"
		}
		switch objType {
		case "routine":
			q := fmt.Sprintf(`SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = '%s' AND p.proname = '%s' LIMIT 1`, escLit(sch), escLit(objName))
			return execSingleCell(q, 0)
		case "trigger":
			q := fmt.Sprintf(`SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '%s' AND t.tgname = '%s' LIMIT 1`, escLit(sch), escLit(objName))
			return execSingleCell(q, 0)
		case "view", "materialized_view":
			q := fmt.Sprintf(`SELECT pg_get_viewdef('"%s"."%s"'::regclass, true)`, escLit(sch), escLit(objName))
			if ddl, err := execSingleCell(q, 0); err == nil && ddl != "" {
				kw := "VIEW"
				if objType == "materialized_view" {
					kw = "MATERIALIZED VIEW"
				}
				return fmt.Sprintf("CREATE OR REPLACE %s %s.%s AS\n%s", kw, quoteIdentifier(drvName, sch), quoteIdentifier(drvName, objName), ddl), nil
			}
		case "sequence":
			q := fmt.Sprintf(`SELECT 'CREATE SEQUENCE ' || quote_ident(schemaname) || '.' || quote_ident(sequencename) || ' INCREMENT BY ' || increment_by || ' MINVALUE ' || min_value || ' MAXVALUE ' || max_value || ' START WITH ' || start_value || ';' FROM pg_sequences WHERE schemaname = '%s' AND sequencename = '%s' LIMIT 1`, escLit(sch), escLit(objName))
			return execSingleCell(q, 0)
		}

	case "mssql", "sqlserver":
		sch := schema
		if sch == "" || sch == "main" {
			sch = "dbo"
		}
		switch objType {
		case "routine", "trigger", "view":
			q := fmt.Sprintf(`SELECT OBJECT_DEFINITION(OBJECT_ID('[%s].[%s]'))`, escLit(sch), escLit(objName))
			return execSingleCell(q, 0)
		case "sequence":
			q := fmt.Sprintf(`SELECT 'CREATE SEQUENCE [' + s.name + '].[' + seq.name + '] START WITH ' + CAST(seq.start_value AS VARCHAR(30)) + ' INCREMENT BY ' + CAST(seq.increment AS VARCHAR(30)) + ';' FROM sys.sequences seq JOIN sys.schemas s ON seq.schema_id = s.schema_id WHERE s.name = '%s' AND seq.name = '%s'`, escLit(sch), escLit(objName))
			return execSingleCell(q, 0)
		}

	case "sqlite":
		q := fmt.Sprintf(`SELECT sql FROM sqlite_master WHERE name = '%s' LIMIT 1`, escLit(objName))
		return execSingleCell(q, 0)

	case "oracle":
		oraType := strings.ToUpper(objType)
		if oraType == "ROUTINE" {
			oraType = "PROCEDURE"
		} else if oraType == "MATERIALIZED_VIEW" {
			oraType = "MATERIALIZED_VIEW"
		}
		if schema != "" {
			q := fmt.Sprintf(`SELECT DBMS_METADATA.GET_DDL('%s', '%s', '%s') FROM DUAL`, escLit(oraType), escLit(objName), escLit(schema))
			return execSingleCell(q, 0)
		}
		q := fmt.Sprintf(`SELECT DBMS_METADATA.GET_DDL('%s', '%s') FROM DUAL`, escLit(oraType), escLit(objName))
		return execSingleCell(q, 0)
	}

	st, sErr := drv.GetTableStructure(ctx, database, schema, objName)
	if sErr == nil && st != nil && st.DDL != "" {
		return st.DDL, nil
	}
	return "", fmt.Errorf("DDL extraction is not supported for %s '%s' on %s", objType, objName, drvName)
}
