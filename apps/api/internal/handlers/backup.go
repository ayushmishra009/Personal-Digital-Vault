package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/personal-digital-vault/api/internal/database"
	"github.com/personal-digital-vault/api/internal/domain"
)

type BackupMetadataDTO struct {
	SnapshotID       string `json:"snapshotId"`
	VaultID          string `json:"vaultId"`
	CiphertextSize   int64  `json:"ciphertextSize"`
	CiphertextDigest string `json:"ciphertextDigest"`
	CreatedAt        string `json:"createdAt"`
}

type BackupMetadataListDTO struct {
	Items []BackupMetadataDTO `json:"items"`
}

type CreateBackupMetadataRequestDTO struct {
	SnapshotID       string `json:"snapshotId"`
	CiphertextSize   int64  `json:"ciphertextSize"`
	CiphertextDigest string `json:"ciphertextDigest"`
}

func CreateBackupMetadataHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, aOk := domain.AccountFromContext(r.Context())
		device, dOk := domain.DeviceFromContext(r.Context())
		if !aOk || !dOk || account == nil || device == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		vaultID := extractVaultID(r.URL.Path)
		if vaultID == "" {
			WriteProblem(w, http.StatusBadRequest, "BadRequest", "Missing vault ID in path")
			return
		}

		var req CreateBackupMetadataRequestDTO
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			WriteProblem(w, http.StatusBadRequest, "BadRequest", "Invalid JSON payload")
			return
		}

		if req.SnapshotID == "" {
			WriteProblem(w, http.StatusBadRequest, "BadRequest", "Missing snapshotId")
			return
		}
		if req.CiphertextSize <= 0 {
			WriteProblem(w, http.StatusBadRequest, "BadRequest", "ciphertextSize must be positive")
			return
		}
		digest, err := decodeBase64URLDigest(req.CiphertextDigest)
		if err != nil {
			WriteProblem(w, http.StatusBadRequest, "BadRequest", "Invalid ciphertextDigest: must be 32 bytes base64url")
			return
		}

		input := &domain.CreateBackupMetadataInput{
			SnapshotID:     req.SnapshotID,
			CiphertextSize: req.CiphertextSize,
			CiphertextHash: digest,
		}

		meta, err := repo.SaveBackupMetadata(r.Context(), account.ID, vaultID, input)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "NotFound", "Vault not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "InternalError", err.Error())
			return
		}

		WriteJSON(w, http.StatusCreated, BackupMetadataDTO{
			SnapshotID:       meta.SnapshotID,
			VaultID:          meta.VaultID,
			CiphertextSize:   meta.CiphertextSize,
			CiphertextDigest: encodeBase64URLDigest(meta.CiphertextHash),
			CreatedAt:        meta.CreatedAt.Format(time.RFC3339),
		})
	}
}

func ListBackupMetadataHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, aOk := domain.AccountFromContext(r.Context())
		device, dOk := domain.DeviceFromContext(r.Context())
		if !aOk || !dOk || account == nil || device == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		vaultID := extractVaultID(r.URL.Path)
		if vaultID == "" {
			WriteProblem(w, http.StatusBadRequest, "BadRequest", "Missing vault ID in path")
			return
		}

		list, err := repo.ListBackupMetadata(r.Context(), account.ID, vaultID)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "NotFound", "Vault not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "InternalError", err.Error())
			return
		}

		items := make([]BackupMetadataDTO, 0, len(list))
		for _, b := range list {
			items = append(items, BackupMetadataDTO{
				SnapshotID:       b.SnapshotID,
				VaultID:          b.VaultID,
				CiphertextSize:   b.CiphertextSize,
				CiphertextDigest: encodeBase64URLDigest(b.CiphertextHash),
				CreatedAt:        b.CreatedAt.Format(time.RFC3339),
			})
		}

		WriteJSON(w, http.StatusOK, BackupMetadataListDTO{Items: items})
	}
}
