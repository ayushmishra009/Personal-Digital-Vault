package handlers

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/personal-digital-vault/api/internal/database"
	"github.com/personal-digital-vault/api/internal/domain"
)

type VaultMetadataResponse struct {
	ID              string `json:"id"`
	ProtocolVersion int    `json:"protocolVersion"`
	Status          string `json:"status"`
	CreatedAt       string `json:"createdAt"`
	UpdatedAt       string `json:"updatedAt"`
}

type VaultKeyEnvelopeDTO struct {
	EnvelopeType     string           `json:"envelopeType"`
	ProtocolVersion  int              `json:"protocolVersion"`
	KeyWrapAlgorithm string           `json:"keyWrapAlgorithm"`
	KDFAlgorithm     string           `json:"kdfAlgorithm"`
	KDFParameters    map[string]int64 `json:"kdfParameters"`
	Salt             string           `json:"salt"`
	WrappedVEK       string           `json:"wrappedVek"`
}

type CreateVaultRequest struct {
	ProtocolVersion int                   `json:"protocolVersion"`
	Envelopes       []VaultKeyEnvelopeDTO `json:"envelopes"`
}

func FormatVault(v *domain.Vault) VaultMetadataResponse {
	return VaultMetadataResponse{
		ID:              v.ID,
		ProtocolVersion: v.ProtocolVersion,
		Status:          v.Status,
		CreatedAt:       v.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:       v.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func validateEnvelope(env *VaultKeyEnvelopeDTO, expectedType string) ([]byte, []byte, error) {
	if env.EnvelopeType != expectedType {
		return nil, nil, errors.New("envelopeType mismatch")
	}
	if env.ProtocolVersion != 1 {
		return nil, nil, errors.New("unsupported protocolVersion")
	}
	if env.KeyWrapAlgorithm != "AES-256-KW" {
		return nil, nil, errors.New("unsupported keyWrapAlgorithm")
	}

	saltBytes, err := base64.RawURLEncoding.DecodeString(env.Salt)
	if err != nil || len(saltBytes) != 16 {
		return nil, nil, errors.New("salt must be exactly 16 bytes base64url")
	}

	wrappedBytes, err := base64.RawURLEncoding.DecodeString(env.WrappedVEK)
	if err != nil || len(wrappedBytes) != 40 {
		return nil, nil, errors.New("wrappedVek must be exactly 40 bytes base64url")
	}

	if expectedType == "password" {
		if env.KDFAlgorithm != "argon2id13" {
			return nil, nil, errors.New("password envelope requires argon2id13")
		}
		if env.KDFParameters["parallelism"] != 4 ||
			env.KDFParameters["memoryKiB"] != 65536 ||
			env.KDFParameters["iterations"] != 3 ||
			env.KDFParameters["version"] != 19 {
			return nil, nil, errors.New("password envelope requires proposed p=4 Argon2id tuple")
		}
	} else if expectedType == "recovery" {
		if env.KDFAlgorithm != "hkdf-sha256" {
			return nil, nil, errors.New("recovery envelope requires hkdf-sha256")
		}
	}

	return saltBytes, wrappedBytes, nil
}

func ListVaultsHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, ok := domain.AccountFromContext(r.Context())
		if !ok || account == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		vaults, err := repo.ListVaults(r.Context(), account.ID)
		if err != nil {
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to list vaults")
			return
		}

		items := make([]VaultMetadataResponse, 0, len(vaults))
		for i := range vaults {
			items = append(items, FormatVault(&vaults[i]))
		}

		WriteJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

func CreateVaultHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, ok := domain.AccountFromContext(r.Context())
		if !ok || account == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		var req CreateVaultRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Invalid JSON payload")
			return
		}

		if req.ProtocolVersion != 1 {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Only protocolVersion 1 is supported")
			return
		}
		if len(req.Envelopes) != 2 {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Exactly two envelopes (password and recovery) are required")
			return
		}

		var hasPassword, hasRecovery bool
		var domainEnvelopes []domain.VaultKeyEnvelope

		for _, env := range req.Envelopes {
			var salt, wrapped []byte
			var err error

			if env.EnvelopeType == "password" {
				if hasPassword {
					WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Duplicate password envelope")
					return
				}
				hasPassword = true
				salt, wrapped, err = validateEnvelope(&env, "password")
			} else if env.EnvelopeType == "recovery" {
				if hasRecovery {
					WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Duplicate recovery envelope")
					return
				}
				hasRecovery = true
				salt, wrapped, err = validateEnvelope(&env, "recovery")
			} else {
				WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Invalid envelopeType")
				return
			}

			if err != nil {
				WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", err.Error())
				return
			}

			domainEnvelopes = append(domainEnvelopes, domain.VaultKeyEnvelope{
				EnvelopeType:     env.EnvelopeType,
				ProtocolVersion:  env.ProtocolVersion,
				KeyWrapAlgorithm: env.KeyWrapAlgorithm,
				KDFAlgorithm:     env.KDFAlgorithm,
				KDFParameters:    env.KDFParameters,
				Salt:             salt,
				WrappedVEK:       wrapped,
			})
		}

		if !hasPassword || !hasRecovery {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Both password and recovery envelopes are required")
			return
		}

		createdVault, err := repo.CreateVaultWithEnvelopes(r.Context(), account.ID, req.ProtocolVersion, domainEnvelopes)
		if err != nil {
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to create vault")
			return
		}

		WriteJSON(w, http.StatusCreated, FormatVault(createdVault))
	}
}

func GetVaultHandler(repo database.Repository) http.HandlerFunc {
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

		v, err := repo.GetVault(r.Context(), account.ID, vaultID)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "Not Found", "Vault not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to get vault")
			return
		}

		WriteJSON(w, http.StatusOK, FormatVault(v))
	}
}

func GetVaultKeyEnvelopeHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, ok := domain.AccountFromContext(r.Context())
		if !ok || account == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		vaultID := r.PathValue("vaultId")
		envelopeType := r.PathValue("envelopeType")
		if vaultID == "" || (envelopeType != "password" && envelopeType != "recovery") {
			WriteProblem(w, http.StatusNotFound, "Not Found", "Valid vault ID and envelopeType required")
			return
		}

		env, err := repo.GetVaultKeyEnvelope(r.Context(), account.ID, vaultID, envelopeType)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "Not Found", "Envelope not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to get envelope")
			return
		}

		WriteJSON(w, http.StatusOK, VaultKeyEnvelopeDTO{
			EnvelopeType:     env.EnvelopeType,
			ProtocolVersion:  env.ProtocolVersion,
			KeyWrapAlgorithm: env.KeyWrapAlgorithm,
			KDFAlgorithm:     env.KDFAlgorithm,
			KDFParameters:    env.KDFParameters,
			Salt:             base64.RawURLEncoding.EncodeToString(env.Salt),
			WrappedVEK:       base64.RawURLEncoding.EncodeToString(env.WrappedVEK),
		})
	}
}

func PutVaultKeyEnvelopeHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, ok := domain.AccountFromContext(r.Context())
		if !ok || account == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		vaultID := r.PathValue("vaultId")
		envelopeType := r.PathValue("envelopeType")
		if vaultID == "" || (envelopeType != "password" && envelopeType != "recovery") {
			WriteProblem(w, http.StatusNotFound, "Not Found", "Valid vault ID and envelopeType required")
			return
		}

		var req VaultKeyEnvelopeDTO
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Invalid JSON payload")
			return
		}

		salt, wrapped, err := validateEnvelope(&req, envelopeType)
		if err != nil {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", err.Error())
			return
		}

		domainEnv := &domain.VaultKeyEnvelope{
			VaultID:          vaultID,
			EnvelopeType:     envelopeType,
			ProtocolVersion:  req.ProtocolVersion,
			KeyWrapAlgorithm: req.KeyWrapAlgorithm,
			KDFAlgorithm:     req.KDFAlgorithm,
			KDFParameters:    req.KDFParameters,
			Salt:             salt,
			WrappedVEK:       wrapped,
		}

		err = repo.PutVaultKeyEnvelope(r.Context(), account.ID, domainEnv)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "Not Found", "Vault not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to update envelope")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

func DeleteVaultHandler(repo database.Repository) http.HandlerFunc {
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

		err := repo.DeleteVault(r.Context(), account.ID, vaultID)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "Not Found", "Vault not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to delete vault")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
