package handlers

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
)

type ProblemError struct {
	Code      string          `json:"code"`
	Message   string          `json:"message"`
	RequestID string          `json:"requestId"`
	Details   *ProblemDetails `json:"details,omitempty"`
}

type ProblemDetails struct {
	CurrentRevision       *int64 `json:"currentRevision,omitempty"`
	AttemptedBaseRevision *int64 `json:"attemptedBaseRevision,omitempty"`
}

type Problem struct {
	Type     string        `json:"type,omitempty"`
	Title    string        `json:"title,omitempty"`
	Status   int           `json:"status,omitempty"`
	Detail   string        `json:"detail,omitempty"`
	Instance string        `json:"instance,omitempty"`
	Error    *ProblemError `json:"error,omitempty"`
}

func generateRequestID() string {
	var u [16]byte
	_, _ = rand.Read(u[:])
	u[6] = (u[6] & 0x0f) | 0x40
	u[8] = (u[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", u[0:4], u[4:6], u[6:8], u[8:10], u[10:])
}

func WriteJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func WriteProblem(w http.ResponseWriter, status int, title string, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	reqID := generateRequestID()
	_ = json.NewEncoder(w).Encode(Problem{
		Type:   "about:blank",
		Title:  title,
		Status: status,
		Detail: detail,
		Error: &ProblemError{
			Code:      title,
			Message:   detail,
			RequestID: reqID,
		},
	})
}

func WriteConflictProblem(w http.ResponseWriter, title string, detail string, currentRev int64, attemptedBaseRev int64) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(http.StatusConflict)
	reqID := generateRequestID()
	_ = json.NewEncoder(w).Encode(Problem{
		Type:   "about:blank",
		Title:  title,
		Status: http.StatusConflict,
		Detail: detail,
		Error: &ProblemError{
			Code:      title,
			Message:   detail,
			RequestID: reqID,
			Details: &ProblemDetails{
				CurrentRevision:       &currentRev,
				AttemptedBaseRevision: &attemptedBaseRev,
			},
		},
	})
}
