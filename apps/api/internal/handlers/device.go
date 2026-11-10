package handlers

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/personal-digital-vault/api/internal/database"
	"github.com/personal-digital-vault/api/internal/domain"
)

type DeviceEnrollmentRequest struct {
	DeviceLabel        string `json:"deviceLabel"`
	Platform           string `json:"platform"`
	Browser            string `json:"browser"`
	PublicKeyAlgorithm string `json:"publicKeyAlgorithm"`
	PublicKey          string `json:"publicKey"`
}

type DeviceEnrollmentResponse struct {
	ID        string `json:"id"`
	DeviceID  string `json:"deviceId"`
	Challenge string `json:"challenge"`
	ExpiresAt string `json:"expiresAt"`
	Status    string `json:"status"`
}

type EnrollmentApprovalRequest struct {
	SignatureAlgorithm string `json:"signatureAlgorithm"`
	Signature          string `json:"signature"`
}

func ListDevicesHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, ok := domain.AccountFromContext(r.Context())
		if !ok || account == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		devices, err := repo.ListDevices(r.Context(), account.ID)
		if err != nil {
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to list devices")
			return
		}

		var items []*DeviceResponse
		for i := range devices {
			items = append(items, FormatDevice(&devices[i]))
		}
		if items == nil {
			items = []*DeviceResponse{}
		}

		WriteJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

func CreateDeviceEnrollmentHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, ok := domain.AccountFromContext(r.Context())
		if !ok || account == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		var req DeviceEnrollmentRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Invalid JSON payload")
			return
		}

		if req.DeviceLabel == "" || len(req.DeviceLabel) > 100 {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Valid device label required (1-100 characters)")
			return
		}
		if req.Platform == "" || len(req.Platform) > 80 {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Valid platform required (1-80 characters)")
			return
		}
		if req.Browser == "" || len(req.Browser) > 80 {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Valid browser required (1-80 characters)")
			return
		}

		pubKeyBytes, err := base64.RawURLEncoding.DecodeString(req.PublicKey)
		if err != nil || len(pubKeyBytes) == 0 {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Valid base64url public key required")
			return
		}

		challengeBytes := make([]byte, 32)
		if _, err := rand.Read(challengeBytes); err != nil {
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to generate pairing challenge")
			return
		}
		challengeHash := sha256.Sum256(challengeBytes)
		expiresAt := time.Now().Add(10 * time.Minute)

		device := &domain.Device{
			AccountID:          account.ID,
			PublicKeyAlgorithm: req.PublicKeyAlgorithm,
			PublicKey:          pubKeyBytes,
			Label:              req.DeviceLabel,
			Platform:           req.Platform,
			Browser:            req.Browser,
			Status:             "pending",
		}

		createdDevice, createdEnrollment, err := repo.CreatePendingDeviceAndEnrollment(r.Context(), device, challengeHash[:], expiresAt)
		if err != nil {
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to start enrollment")
			return
		}

		WriteJSON(w, http.StatusCreated, DeviceEnrollmentResponse{
			ID:        createdEnrollment.ID,
			DeviceID:  createdDevice.ID,
			Challenge: base64.RawURLEncoding.EncodeToString(challengeBytes),
			ExpiresAt: expiresAt.UTC().Format(time.RFC3339),
			Status:    createdEnrollment.Status,
		})
	}
}

func GetDeviceEnrollmentHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, ok := domain.AccountFromContext(r.Context())
		if !ok || account == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		enrollmentID := r.PathValue("enrollmentId")
		if enrollmentID == "" {
			WriteProblem(w, http.StatusNotFound, "Not Found", "Enrollment ID required")
			return
		}

		enrollment, device, err := repo.GetDeviceEnrollment(r.Context(), account.ID, enrollmentID)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "Not Found", "Enrollment not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to get enrollment")
			return
		}

		status := enrollment.Status
		if status == "pending" && time.Now().After(enrollment.ExpiresAt) {
			status = "expired"
		}

		WriteJSON(w, http.StatusOK, map[string]any{
			"id":        enrollment.ID,
			"deviceId":  device.ID,
			"device":    FormatDevice(device),
			"challenge": base64.RawURLEncoding.EncodeToString(enrollment.ChallengeHash),
			"expiresAt": enrollment.ExpiresAt.UTC().Format(time.RFC3339),
			"status":    status,
		})
	}
}

func ApproveDeviceEnrollmentHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, ok := domain.AccountFromContext(r.Context())
		if !ok || account == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		approverDevice, ok := domain.DeviceFromContext(r.Context())
		if !ok || approverDevice == nil || approverDevice.Status != "active" {
			WriteProblem(w, http.StatusForbidden, "Forbidden", "Only active devices can approve enrollments")
			return
		}

		enrollmentID := r.PathValue("enrollmentId")
		if enrollmentID == "" {
			WriteProblem(w, http.StatusNotFound, "Not Found", "Enrollment ID required")
			return
		}

		var req EnrollmentApprovalRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Invalid JSON payload")
			return
		}

		sigBytes, err := base64.RawURLEncoding.DecodeString(req.Signature)
		if err != nil || len(sigBytes) == 0 {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Valid base64url signature required")
			return
		}

		err = repo.ApproveDeviceEnrollment(r.Context(), account.ID, enrollmentID, approverDevice.ID, sigBytes)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "Not Found", "Enrollment not found")
				return
			}
			if errors.Is(err, database.ErrConflict) {
				WriteProblem(w, http.StatusConflict, "Conflict", "Enrollment is already approved, rejected, or expired")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to approve enrollment")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

func RevokeDeviceHandler(repo database.Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, ok := domain.AccountFromContext(r.Context())
		if !ok || account == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		currentDevice, ok := domain.DeviceFromContext(r.Context())
		if !ok || currentDevice == nil || currentDevice.Status != "active" {
			WriteProblem(w, http.StatusForbidden, "Forbidden", "Active device required")
			return
		}

		targetDeviceID := r.PathValue("deviceId")
		if targetDeviceID == "" {
			WriteProblem(w, http.StatusNotFound, "Not Found", "Device ID required")
			return
		}

		err := repo.RevokeDevice(r.Context(), account.ID, targetDeviceID)
		if err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "Not Found", "Device not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to revoke device")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
