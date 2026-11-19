package main

import (
	"embed"
	"log"
	"os"
	"runtime/debug"

	"dhub/internal/app"
	"dhub/internal/manager"
	"dhub/internal/services"
	"dhub/internal/store"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed frontend/public/app-icon.png
var appIcon []byte

func init() {
	// Register custom events for typed JS bindings
	application.RegisterEvent[app.QueryStatusEvent]("query:status")
	application.RegisterEvent[app.SchemaSyncEvent]("schema:sync")
	application.RegisterEvent[app.ConnectionStateEvent]("connection:state")
	application.RegisterEvent[app.UpdateProgressEvent]("update:progress")
	application.RegisterEvent[app.BackupProgressEvent]("backup:progress")
	application.RegisterEvent[app.BackupProgressEvent]("restore:progress")
	application.RegisterEvent[app.ToolDownloadProgressEvent]("backup:tool-download")
}

func main() {
	// Tune Go runtime for low-memory desktop environments unless overridden by env vars.
	if os.Getenv("GOGC") == "" {
		debug.SetGCPercent(40)
	}
	if os.Getenv("GOMEMLIMIT") == "" {
		debug.SetMemoryLimit(128 << 20) // 128 MiB soft limit
	}

	localStore, err := store.NewLocalStore()
	if err != nil {
		log.Fatalf("failed to initialize internal sqlite store: %v", err)
	}
	defer localStore.Close()

	sessionMgr := manager.NewSessionManager(localStore)
	defer sessionMgr.CloseAll()

	var wailsApp *application.App

	connSvc := services.NewConnectionService(localStore, sessionMgr, func() *application.App { return wailsApp })
	schemaSvc := services.NewSchemaService(localStore, sessionMgr, func() *application.App { return wailsApp })
	querySvc := services.NewQueryService(localStore, sessionMgr, func() *application.App { return wailsApp })
	workspaceSvc := services.NewWorkspaceService(localStore)
	exportSvc := services.NewExportService(localStore, sessionMgr, func() *application.App { return wailsApp })
	updateSvc := services.NewUpdateService(func() *application.App { return wailsApp })

	wailsApp = application.New(application.Options{
		Name:        "DHub",
		Description: "High-Performance Multi-Database IDE",
		Icon:        appIcon,
		Linux: application.LinuxOptions{
			ProgramName:   "dhub",
			ApplicationID: "com.dhub.app",
		},
		Services: []application.Service{
			application.NewService(connSvc),
			application.NewService(schemaSvc),
			application.NewService(querySvc),
			application.NewService(workspaceSvc),
			application.NewService(exportSvc),
			application.NewService(updateSvc),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "DHub",
		Width:            1440,
		Height:           900,
		MinWidth:         1024,
		MinHeight:        640,
		BackgroundColour: application.NewRGB(18, 19, 23), // DataGrip Islands Dark
		URL:              "/",
		Linux: application.LinuxWindow{
			Icon: appIcon,
		},
	})

	if err := wailsApp.Run(); err != nil {
		log.Fatal(err)
	}
}
