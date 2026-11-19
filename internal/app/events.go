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

type UpdateProgressEvent struct {
	Status     string  `json:"status"` // "downloading" | "completed" | "installing" | "error"
	Downloaded int64   `json:"downloaded"`
	Total      int64   `json:"total"`
	Percent    float64 `json:"percent"`
	Error      string  `json:"error,omitempty"`
}

type BackupProgressEvent struct {
	ConnectionID string  `json:"connectionId"`
	Database     string  `json:"database"`
	Status       string  `json:"status"` // "running" | "completed" | "error"
	Percent      float64 `json:"percent"`
	CurrentTable string  `json:"currentTable,omitempty"`
	TablesDone   int     `json:"tablesDone"`
	TotalTables  int     `json:"totalTables"`
	BytesWritten int64   `json:"bytesWritten"`
	TotalBytes   int64   `json:"totalBytes,omitempty"`
	Message      string  `json:"message,omitempty"`
}


