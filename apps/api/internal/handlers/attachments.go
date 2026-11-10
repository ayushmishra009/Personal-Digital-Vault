package handlers

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/personal-digital-vault/api/internal/database"
	"github.com/personal-digital-vault/api/internal/domain"
)

type AttachmentMetadataDTO struct {
	ID               string `json:"id"`
	VaultID          string `json:"vaultId"`
	CiphertextSize   int64  `json:"ciphertextSize"`
	CiphertextDigest string `json:"ciphertextDigest"`
	CreatedAt        string `json:"createdAt"`
}

type AttachmentListDTO struct {
	Items []AttachmentMetadataDTO `json:"items"`
}

type AttachmentUploadSessionRequestDTO struct {
	CiphertextSize   int64  `json:"ciphertextSize"`
	CiphertextDigest string `json:"ciphertextDigest"`
}

type AttachmentUploadSessionResponseDTO struct {
	AttachmentID      string `json:"attachmentId"`
	UploadURL         string `json:"uploadUrl"`
	ObjectKey         string `json:"objectKey"`
	ExpiresAt         string `json:"expiresAt"`
	MaxCiphertextSize int64  `json:"maxCiphertextSize"`
}

type AttachmentCompleteRequestDTO struct {
	CiphertextSize   int64  `json:"ciphertextSize"`
	CiphertextDigest string `json:"ciphertextDigest"`
}

type AttachmentDownloadSessionResponseDTO struct {
	DownloadURL      string `json:"downloadUrl"`
	CiphertextSize   int64  `json:"ciphertextSize"`
	CiphertextDigest string `json:"ciphertextDigest"`
	ExpiresAt        string `json:"expiresAt"`
}

func decodeBase64URLDigest(s string) ([]byte, error) {
	clean := strings.TrimRight(s, "=")
	decoded, err := base64.RawURLEncoding.DecodeString(clean)
	if err != nil {
		return nil, err
	}
	if len(decoded) != 32 {
		return nil, errors.New("digest must be 32 bytes (SHA-256)")
	}
	return decoded, nil
}

func encodeBase64URLDigest(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}

func extractVaultID(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, part := range parts {
		if part == "vaults" && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}

func extractAttachmentID(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, part := range parts {
		if part == "attachments" && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}

func ListAttachmentsHandler(repo database.Repository) http.HandlerFunc {
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

		list, err := repo.ListAttachments(r.Context(), account.ID, vaultID)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "NotFound", "Vault not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "InternalError", err.Error())
			return
		}

		items := make([]AttachmentMetadataDTO, 0, len(list))
		for _, a := range list {
			items = append(items, AttachmentMetadataDTO{
				ID:               a.ID,
				VaultID:          a.VaultID,
				CiphertextSize:   a.CiphertextSize,
				CiphertextDigest: encodeBase64URLDigest(a.CiphertextHash),
				CreatedAt:        a.CreatedAt.Format(time.RFC3339),
			})
		}
		WriteJSON(w, http.StatusOK, AttachmentListDTO{Items: items})
	}
}

func CreateAttachmentUploadSessionHandler(repo database.Repository) http.HandlerFunc {
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

		var req AttachmentUploadSessionRequestDTO
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			WriteProblem(w, http.StatusBadRequest, "BadRequest", "Invalid request body")
			return
		}

		if req.CiphertextSize <= 0 || req.CiphertextSize > 104857600 {
			WriteProblem(w, http.StatusUnprocessableEntity, "UnprocessableEntity", "Ciphertext size exceeds maximum allowable limit (100MB)")
			return
		}

		hashBytes, err := decodeBase64URLDigest(req.CiphertextDigest)
		if err != nil {
			WriteProblem(w, http.StatusUnprocessableEntity, "UnprocessableEntity", "Invalid ciphertextDigest: "+err.Error())
			return
		}

		input := &domain.AttachmentUploadSessionInput{
			CiphertextSize: req.CiphertextSize,
			CiphertextHash: hashBytes,
		}

		result, err := repo.CreateAttachmentUploadSession(r.Context(), account.ID, vaultID, input)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "NotFound", "Vault not found")
				return
			}
			WriteProblem(w, http.StatusBadRequest, "BadRequest", err.Error())
			return
		}

		WriteJSON(w, http.StatusCreated, AttachmentUploadSessionResponseDTO{
			AttachmentID:      result.AttachmentID,
			UploadURL:         result.UploadURL,
			ObjectKey:         result.ObjectKey,
			ExpiresAt:         result.ExpiresAt.Format(time.RFC3339),
			MaxCiphertextSize: result.MaxCiphertextSize,
		})
	}
}

func CompleteAttachmentUploadHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, aOk := domain.AccountFromContext(r.Context())
		device, dOk := domain.DeviceFromContext(r.Context())
		if !aOk || !dOk || account == nil || device == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		vaultID := extractVaultID(r.URL.Path)
		attachmentID := extractAttachmentID(r.URL.Path)
		if vaultID == "" || attachmentID == "" {
			WriteProblem(w, http.StatusBadRequest, "BadRequest", "Missing vault or attachment ID")
			return
		}

		var req AttachmentCompleteRequestDTO
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			WriteProblem(w, http.StatusBadRequest, "BadRequest", "Invalid request body")
			return
		}

		hashBytes, err := decodeBase64URLDigest(req.CiphertextDigest)
		if err != nil {
			WriteProblem(w, http.StatusUnprocessableEntity, "UnprocessableEntity", "Invalid ciphertextDigest: "+err.Error())
			return
		}

		input := &domain.AttachmentCompleteInput{
			CiphertextSize: req.CiphertextSize,
			CiphertextHash: hashBytes,
		}

		att, err := repo.CompleteAttachment(r.Context(), account.ID, vaultID, attachmentID, input)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "NotFound", "Attachment or vault not found")
				return
			}
			WriteProblem(w, http.StatusBadRequest, "BadRequest", err.Error())
			return
		}

		WriteJSON(w, http.StatusOK, AttachmentMetadataDTO{
			ID:               att.ID,
			VaultID:          att.VaultID,
			CiphertextSize:   att.CiphertextSize,
			CiphertextDigest: encodeBase64URLDigest(att.CiphertextHash),
			CreatedAt:        att.CreatedAt.Format(time.RFC3339),
		})
	}
}

func CreateAttachmentDownloadSessionHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, aOk := domain.AccountFromContext(r.Context())
		device, dOk := domain.DeviceFromContext(r.Context())
		if !aOk || !dOk || account == nil || device == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		vaultID := extractVaultID(r.URL.Path)
		attachmentID := extractAttachmentID(r.URL.Path)
		if vaultID == "" || attachmentID == "" {
			WriteProblem(w, http.StatusBadRequest, "BadRequest", "Missing vault or attachment ID")
			return
		}

		att, err := repo.GetAttachment(r.Context(), account.ID, vaultID, attachmentID)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "NotFound", "Attachment not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "InternalError", err.Error())
			return
		}

		downloadURL := "/api/v1/vaults/" + vaultID + "/attachments/" + attachmentID + "/content"
		expiresAt := time.Now().UTC().Add(1 * time.Hour)

		WriteJSON(w, http.StatusOK, AttachmentDownloadSessionResponseDTO{
			DownloadURL:      downloadURL,
			CiphertextSize:   att.CiphertextSize,
			CiphertextDigest: encodeBase64URLDigest(att.CiphertextHash),
			ExpiresAt:        expiresAt.Format(time.RFC3339),
		})
	}
}

func GetAttachmentHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, aOk := domain.AccountFromContext(r.Context())
		device, dOk := domain.DeviceFromContext(r.Context())
		if !aOk || !dOk || account == nil || device == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		vaultID := extractVaultID(r.URL.Path)
		attachmentID := extractAttachmentID(r.URL.Path)
		if vaultID == "" || attachmentID == "" {
			WriteProblem(w, http.StatusBadRequest, "BadRequest", "Missing vault or attachment ID")
			return
		}

		att, err := repo.GetAttachment(r.Context(), account.ID, vaultID, attachmentID)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "NotFound", "Attachment not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "InternalError", err.Error())
			return
		}

		WriteJSON(w, http.StatusOK, AttachmentMetadataDTO{
			ID:               att.ID,
			VaultID:          att.VaultID,
			CiphertextSize:   att.CiphertextSize,
			CiphertextDigest: encodeBase64URLDigest(att.CiphertextHash),
			CreatedAt:        att.CreatedAt.Format(time.RFC3339),
		})
	}
}

func DeleteAttachmentHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, aOk := domain.AccountFromContext(r.Context())
		device, dOk := domain.DeviceFromContext(r.Context())
		if !aOk || !dOk || account == nil || device == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		vaultID := extractVaultID(r.URL.Path)
		attachmentID := extractAttachmentID(r.URL.Path)
		if vaultID == "" || attachmentID == "" {
			WriteProblem(w, http.StatusBadRequest, "BadRequest", "Missing vault or attachment ID")
			return
		}

		err := repo.DeleteAttachment(r.Context(), account.ID, vaultID, attachmentID)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "NotFound", "Attachment not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "InternalError", err.Error())
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

func UploadAttachmentContentHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, aOk := domain.AccountFromContext(r.Context())
		device, dOk := domain.DeviceFromContext(r.Context())
		if !aOk || !dOk || account == nil || device == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		vaultID := extractVaultID(r.URL.Path)
		attachmentID := extractAttachmentID(r.URL.Path)
		if vaultID == "" || attachmentID == "" {
			WriteProblem(w, http.StatusBadRequest, "BadRequest", "Missing vault or attachment ID")
			return
		}

		// Read up to 100MB
		const maxSizeBytes = 104857600
		r.Body = http.MaxBytesReader(w, r.Body, maxSizeBytes)
		data, err := io.ReadAll(r.Body)
		if err != nil {
			WriteProblem(w, http.StatusBadRequest, "BadRequest", "Error reading attachment body or size exceeded")
			return
		}

		if len(data) == 0 {
			WriteProblem(w, http.StatusBadRequest, "BadRequest", "Empty attachment ciphertext")
			return
		}

		if err := repo.SaveAttachmentBlob(r.Context(), account.ID, vaultID, attachmentID, data); err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "NotFound", "Attachment not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "InternalError", err.Error())
			return
		}

		hash := sha256.Sum256(data)
		_, err = repo.CompleteAttachment(r.Context(), account.ID, vaultID, attachmentID, &domain.AttachmentCompleteInput{
			CiphertextSize: int64(len(data)),
			CiphertextHash: hash[:],
		})
		if err != nil {
			WriteProblem(w, http.StatusBadRequest, "BadRequest", err.Error())
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

func DownloadAttachmentContentHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, aOk := domain.AccountFromContext(r.Context())
		device, dOk := domain.DeviceFromContext(r.Context())
		if !aOk || !dOk || account == nil || device == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		vaultID := extractVaultID(r.URL.Path)
		attachmentID := extractAttachmentID(r.URL.Path)
		if vaultID == "" || attachmentID == "" {
			WriteProblem(w, http.StatusBadRequest, "BadRequest", "Missing vault or attachment ID")
			return
		}

		data, err := repo.GetAttachmentBlob(r.Context(), account.ID, vaultID, attachmentID)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "NotFound", "Attachment not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "InternalError", err.Error())
			return
		}

		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	}
}
