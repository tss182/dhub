package main

import (
	"embed"
	"log"

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
}

func main() {
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
