package app

type QueryStatusEvent struct {
	ExecutionID string `json:"executionId"`
	State       string `json:"state"` // "running" | "completed" | "error" | "cancelled"
	Message     string `json:"message"`
	Timestamp   int64  `json:"timestamp"`
}

type SchemaSyncEvent struct {
	ConnectionID string `json:"connectionId"`
	Database     string `json:"database"`
	Schema       string `json:"schema"`
	Status       string `json:"status"` // "syncing" | "ready" | "error"
	Message      string `json:"message"`
}

type ConnectionStateEvent struct {
	ConnectionID string `json:"connectionId"`
	Status       string `json:"status"` // "connected" | "disconnected" | "error"
	Error        string `json:"error,omitempty"`
}

