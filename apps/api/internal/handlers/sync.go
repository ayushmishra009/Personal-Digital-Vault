package handlers

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/personal-digital-vault/api/internal/database"
	"github.com/personal-digital-vault/api/internal/domain"
)

type EncryptedObjectEnvelopeDTO struct {
	ProtocolVersion  int    `json:"protocolVersion"`
	Algorithm        string `json:"algorithm"`
	KeyWrapAlgorithm string `json:"keyWrapAlgorithm"`
	PayloadVersion   int    `json:"payloadVersion"`
	Purpose          string `json:"purpose"`
	Nonce            string `json:"nonce"`
	WrappedDEK       string `json:"wrappedDek"`
	Ciphertext       string `json:"ciphertext"`
}

type SyncOperationDTO struct {
	OperationID     string                      `json:"operationId"`
	ObjectID        string                      `json:"objectId"`
	Kind            string                      `json:"kind"` // "upsert" or "delete"
	BaseRevision    int64                       `json:"baseRevision"`
	ClientCreatedAt string                      `json:"clientCreatedAt"`
	Envelope        *EncryptedObjectEnvelopeDTO `json:"envelope,omitempty"`
}

type SyncEventDTO struct {
	SequenceID    string `json:"sequenceId"`
	OperationID   string `json:"operationId"`
	DeviceID      string `json:"deviceId"`
	ObjectID      string `json:"objectId"`
	OperationKind string `json:"operationKind"`
	BaseRevision  int64  `json:"baseRevision"`
	NewRevision   int64  `json:"newRevision"`
	CreatedAt     string `json:"createdAt"`
}

type SyncPageDTO struct {
	Items      []SyncEventDTO `json:"items"`
	NextCursor string         `json:"nextCursor"`
	HasMore    bool           `json:"hasMore"`
}

func SubmitSyncOperationHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, aOk := domain.AccountFromContext(r.Context())
		device, dOk := domain.DeviceFromContext(r.Context())
		if !aOk || !dOk || account == nil || device == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		vaultID := r.PathValue("vaultId")
		if vaultID == "" {
			WriteProblem(w, http.StatusNotFound, "Not Found", "Vault ID required")
			return
		}

		var req SyncOperationDTO
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Invalid JSON payload")
			return
		}

		req.OperationID = strings.TrimSpace(req.OperationID)
		req.ObjectID = strings.TrimSpace(req.ObjectID)
		req.Kind = strings.TrimSpace(req.Kind)

		if req.OperationID == "" || req.ObjectID == "" {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "operationId and objectId are required")
			return
		}

		if req.Kind != "upsert" && req.Kind != "delete" {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "kind must be 'upsert' or 'delete'")
			return
		}

		if req.BaseRevision < 0 {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "baseRevision must be non-negative")
			return
		}

		var clientCreated time.Time
		if req.ClientCreatedAt != "" {
			t, err := time.Parse(time.RFC3339, req.ClientCreatedAt)
			if err == nil {
				clientCreated = t
			} else {
				clientCreated = time.Now().UTC()
			}
		} else {
			clientCreated = time.Now().UTC()
		}

		op := &domain.SyncOperationInput{
			OperationID:     req.OperationID,
			ObjectID:        req.ObjectID,
			Kind:            req.Kind,
			BaseRevision:    req.BaseRevision,
			ClientCreatedAt: clientCreated,
		}

		if req.Kind == "upsert" {
			if req.Envelope == nil {
				WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "envelope is required for upsert operation")
				return
			}
			env := req.Envelope
			if env.ProtocolVersion <= 0 || env.PayloadVersion <= 0 {
				WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Invalid protocol or payload version")
				return
			}
			if env.Algorithm == "" || env.KeyWrapAlgorithm == "" || env.Purpose == "" {
				WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Algorithm, keyWrapAlgorithm, and purpose are required")
				return
			}

			nonceBytes, err := base64.RawURLEncoding.DecodeString(env.Nonce)
			if err != nil {
				WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "nonce must be base64url")
				return
			}
			wrappedDekBytes, err := base64.RawURLEncoding.DecodeString(env.WrappedDEK)
			if err != nil {
				WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "wrappedDek must be base64url")
				return
			}
			ctBytes, err := base64.RawURLEncoding.DecodeString(env.Ciphertext)
			if err != nil {
				WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "ciphertext must be base64url")
				return
			}

			op.ProtocolVersion = env.ProtocolVersion
			op.Algorithm = env.Algorithm
			op.KeyWrapAlgorithm = env.KeyWrapAlgorithm
			op.PayloadVersion = env.PayloadVersion
			op.Purpose = env.Purpose
			op.Nonce = nonceBytes
			op.WrappedDEK = wrappedDekBytes
			op.Ciphertext = ctBytes
		}

		result, err := repo.SubmitSyncOperation(r.Context(), account.ID, device.ID, vaultID, op)
		if err != nil {
			var conflictErr *domain.RevisionConflictError
			if errors.As(err, &conflictErr) {
				WriteConflictProblem(
					w,
					"Revision Conflict",
					conflictErr.Error(),
					conflictErr.Conflict.CurrentRevision,
					conflictErr.Conflict.AttemptedBaseRevision,
				)
				return
			}
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "Not Found", "Vault not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to submit sync operation")
			return
		}

		WriteJSON(w, http.StatusCreated, result)
	}
}

func ListSyncEventsHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, ok := domain.AccountFromContext(r.Context())
		if !ok || account == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		vaultID := r.PathValue("vaultId")
		if vaultID == "" {
			WriteProblem(w, http.StatusNotFound, "Not Found", "Vault ID required")
			return
		}

		afterSeq := int64(0)
		if afterStr := r.URL.Query().Get("after"); afterStr != "" {
			if val, err := strconv.ParseInt(afterStr, 10, 64); err == nil && val >= 0 {
				afterSeq = val
			}
		}

		limit := 100
		if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
			if val, err := strconv.Atoi(limitStr); err == nil && val > 0 && val <= 500 {
				limit = val
			}
		}

		events, nextCursor, hasMore, err := repo.ListSyncEvents(r.Context(), account.ID, vaultID, afterSeq, limit)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "Not Found", "Vault not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to list sync events")
			return
		}

		items := make([]SyncEventDTO, len(events))
		for i, ev := range events {
			items[i] = SyncEventDTO{
				SequenceID:    strconv.FormatInt(ev.SequenceID, 10),
				OperationID:   ev.OperationID,
				DeviceID:      ev.DeviceID,
				ObjectID:      ev.ObjectID,
				OperationKind: ev.OperationKind,
				BaseRevision:  ev.BaseRevision,
				NewRevision:   ev.NewRevision,
				CreatedAt:     ev.CreatedAt.UTC().Format(time.RFC3339),
			}
		}

		WriteJSON(w, http.StatusOK, SyncPageDTO{
			Items:      items,
			NextCursor: nextCursor,
			HasMore:    hasMore,
		})
	}
}

func GetEncryptedObjectHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, ok := domain.AccountFromContext(r.Context())
		if !ok || account == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		vaultID := r.PathValue("vaultId")
		objectID := r.PathValue("objectId")
		if vaultID == "" || objectID == "" {
			WriteProblem(w, http.StatusNotFound, "Not Found", "Vault ID and Object ID required")
			return
		}

		var revPtr *int64
		if revStr := r.URL.Query().Get("revision"); revStr != "" {
			if val, err := strconv.ParseInt(revStr, 10, 64); err == nil && val > 0 {
				revPtr = &val
			}
		}

		rev, err := repo.GetEncryptedObjectRevision(r.Context(), account.ID, vaultID, objectID, revPtr)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "Not Found", "Object not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to get object")
			return
		}

		if rev.IsDeleted {
			WriteProblem(w, http.StatusNotFound, "Not Found", "Object was deleted")
			return
		}

		WriteJSON(w, http.StatusOK, EncryptedObjectEnvelopeDTO{
			ProtocolVersion:  rev.ProtocolVersion,
			Algorithm:        rev.Algorithm,
			KeyWrapAlgorithm: rev.KeyWrapAlgorithm,
			PayloadVersion:   rev.PayloadVersion,
			Purpose:          rev.Purpose,
			Nonce:            base64.RawURLEncoding.EncodeToString(rev.Nonce),
			WrappedDEK:       base64.RawURLEncoding.EncodeToString(rev.WrappedDEK),
			Ciphertext:       base64.RawURLEncoding.EncodeToString(rev.Ciphertext),
		})
	}
}

func PutEncryptedObjectHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, aOk := domain.AccountFromContext(r.Context())
		device, dOk := domain.DeviceFromContext(r.Context())
		if !aOk || !dOk || account == nil || device == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		vaultID := r.PathValue("vaultId")
		objectID := r.PathValue("objectId")
		if vaultID == "" || objectID == "" {
			WriteProblem(w, http.StatusNotFound, "Not Found", "Vault ID and Object ID required")
			return
		}

		ifMatchHeader := r.Header.Get("If-Match-Revision")
		if ifMatchHeader == "" {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "If-Match-Revision header required")
			return
		}
		ifMatchRev, err := strconv.ParseInt(ifMatchHeader, 10, 64)
		if err != nil || ifMatchRev < 0 {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Invalid If-Match-Revision header")
			return
		}

		var env EncryptedObjectEnvelopeDTO
		if err := json.NewDecoder(r.Body).Decode(&env); err != nil {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Invalid JSON payload")
			return
		}

		if env.ProtocolVersion <= 0 || env.PayloadVersion <= 0 {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Invalid protocol or payload version")
			return
		}
		if env.Algorithm == "" || env.KeyWrapAlgorithm == "" || env.Purpose == "" {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Algorithm, keyWrapAlgorithm, and purpose are required")
			return
		}

		nonceBytes, err := base64.RawURLEncoding.DecodeString(env.Nonce)
		if err != nil {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "nonce must be base64url")
			return
		}
		wrappedDekBytes, err := base64.RawURLEncoding.DecodeString(env.WrappedDEK)
		if err != nil {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "wrappedDek must be base64url")
			return
		}
		ctBytes, err := base64.RawURLEncoding.DecodeString(env.Ciphertext)
		if err != nil {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "ciphertext must be base64url")
			return
		}

		domainRev := &domain.EncryptedObjectRevision{
			VaultID:          vaultID,
			ObjectID:         objectID,
			ProtocolVersion:  env.ProtocolVersion,
			Algorithm:        env.Algorithm,
			KeyWrapAlgorithm: env.KeyWrapAlgorithm,
			PayloadVersion:   env.PayloadVersion,
			Purpose:          env.Purpose,
			Nonce:            nonceBytes,
			WrappedDEK:       wrappedDekBytes,
			Ciphertext:       ctBytes,
		}

		result, err := repo.PutEncryptedObject(r.Context(), account.ID, device.ID, vaultID, objectID, ifMatchRev, domainRev)
		if err != nil {
			var conflictErr *domain.RevisionConflictError
			if errors.As(err, &conflictErr) {
				WriteConflictProblem(
					w,
					"Revision Conflict",
					conflictErr.Error(),
					conflictErr.Conflict.CurrentRevision,
					conflictErr.Conflict.AttemptedBaseRevision,
				)
				return
			}
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "Not Found", "Vault not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to store encrypted object")
			return
		}

		WriteJSON(w, http.StatusOK, result)
	}
}
