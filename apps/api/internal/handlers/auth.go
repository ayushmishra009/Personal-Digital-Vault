package handlers

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/personal-digital-vault/api/internal/auth"
	"github.com/personal-digital-vault/api/internal/database"
	"github.com/personal-digital-vault/api/internal/domain"
)

type RegisterRequest struct {
	Email               string `json:"email"`
	DeviceLabel         string `json:"deviceLabel"`
	Platform            string `json:"platform"`
	Browser             string `json:"browser"`
	PublicKeyAlgorithm  string `json:"publicKeyAlgorithm"`
	PublicKey           string `json:"publicKey"`
	CredentialType      string `json:"credentialType"`
	CredentialID        string `json:"credentialId"`
	CredentialPublicKey string `json:"credentialPublicKey,omitempty"`
	ExternalSubject     string `json:"externalSubject,omitempty"`
}

type LoginRequest struct {
	Email             string `json:"email"`
	DeviceID          string `json:"deviceId"`
	CredentialType    string `json:"credentialType"`
	CredentialID      string `json:"credentialId"`
	ClientDataJSON    string `json:"clientDataJson,omitempty"`
	AuthenticatorData string `json:"authenticatorData,omitempty"`
	Signature         string `json:"signature,omitempty"`
}

type AccountResponse struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
}

type DeviceResponse struct {
	ID         string  `json:"id"`
	Label      string  `json:"label"`
	Platform   string  `json:"platform"`
	Browser    string  `json:"browser"`
	Status     string  `json:"status"`
	CreatedAt  string  `json:"createdAt"`
	LastSeenAt *string `json:"lastSeenAt,omitempty"`
	RevokedAt  *string `json:"revokedAt,omitempty"`
}

type AccountSessionResponse struct {
	Account         AccountResponse `json:"account"`
	Device          *DeviceResponse `json:"device,omitempty"`
	AuthenticatedAt string          `json:"authenticatedAt"`
	ExpiresAt       string          `json:"expiresAt"`
}

func FormatAccount(a *domain.Account) AccountResponse {
	return AccountResponse{
		ID:        a.ID,
		Email:     a.Email,
		Status:    a.Status,
		CreatedAt: a.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func FormatDevice(d *domain.Device) *DeviceResponse {
	if d == nil {
		return nil
	}
	res := &DeviceResponse{
		ID:        d.ID,
		Label:     d.Label,
		Platform:  d.Platform,
		Browser:   d.Browser,
		Status:    d.Status,
		CreatedAt: d.CreatedAt.UTC().Format(time.RFC3339),
	}
	if d.LastSeenAt != nil {
		s := d.LastSeenAt.UTC().Format(time.RFC3339)
		res.LastSeenAt = &s
	}
	if d.RevokedAt != nil {
		s := d.RevokedAt.UTC().Format(time.RFC3339)
		res.RevokedAt = &s
	}
	return res
}

func RegisterHandler(repo database.Repository, isSecure bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req RegisterRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Invalid JSON payload")
			return
		}

		req.Email = strings.TrimSpace(req.Email)
		if req.Email == "" || !strings.Contains(req.Email, "@") {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Valid email is required")
			return
		}
		if req.DeviceLabel == "" || len(req.DeviceLabel) > 100 {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Valid device label is required (1-100 characters)")
			return
		}
		if req.CredentialType != "webauthn" && req.CredentialType != "external" {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Credential type must be webauthn or external")
			return
		}
		if req.CredentialID == "" {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Credential ID is required")
			return
		}

		pubKeyBytes, err := base64.RawURLEncoding.DecodeString(req.PublicKey)
		if err != nil {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Device public key must be valid base64url")
			return
		}

		var credPubKeyBytes []byte
		if req.CredentialPublicKey != "" {
			credPubKeyBytes, err = base64.RawURLEncoding.DecodeString(req.CredentialPublicKey)
			if err != nil {
				WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Credential public key must be valid base64url")
				return
			}
		}

		var externalSub *string
		if req.ExternalSubject != "" {
			s := req.ExternalSubject
			externalSub = &s
		}

		account := &domain.Account{
			Email: req.Email,
		}
		device := &domain.Device{
			PublicKeyAlgorithm: req.PublicKeyAlgorithm,
			PublicKey:          pubKeyBytes,
			Label:              req.DeviceLabel,
			Platform:           req.Platform,
			Browser:            req.Browser,
		}
		cred := &domain.AuthCredential{
			CredentialType:  req.CredentialType,
			CredentialID:    req.CredentialID,
			PublicKey:       credPubKeyBytes,
			ExternalSubject: externalSub,
		}

		createdAccount, createdDevice, err := repo.CreateAccountWithDeviceAndCredential(r.Context(), account, device, cred)
		if err != nil {
			if errors.Is(err, database.ErrConflict) {
				WriteProblem(w, http.StatusConflict, "Conflict", "Account or credential already exists")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to create account")
			return
		}

		token, err := auth.GenerateSessionToken()
		if err != nil {
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to generate session")
			return
		}

		expiresAt := time.Now().Add(auth.DefaultSessionTTL)
		session := &domain.Session{
			AccountID: createdAccount.ID,
			DeviceID:  createdDevice.ID,
			TokenHash: auth.HashSessionToken(token),
			ExpiresAt: expiresAt,
		}
		if err := repo.CreateSession(r.Context(), session); err != nil {
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to establish session")
			return
		}

		auth.SetSessionCookie(w, token, expiresAt, isSecure)

		WriteJSON(w, http.StatusCreated, AccountSessionResponse{
			Account:         FormatAccount(createdAccount),
			Device:          FormatDevice(createdDevice),
			AuthenticatedAt: time.Now().UTC().Format(time.RFC3339),
			ExpiresAt:       expiresAt.UTC().Format(time.RFC3339),
		})
	}
}

func LoginHandler(repo database.Repository, isSecure bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req LoginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			WriteProblem(w, http.StatusUnprocessableEntity, "Unprocessable Entity", "Invalid JSON payload")
			return
		}

		account, err := repo.GetAccountByEmail(r.Context(), req.Email)
		if err != nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Invalid credentials")
			return
		}

		cred, err := repo.GetAuthCredential(r.Context(), account.ID, req.CredentialID)
		if err != nil || cred == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Invalid credentials")
			return
		}

		device, err := repo.GetDeviceByID(r.Context(), account.ID, req.DeviceID)
		if err != nil || device == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Device not registered for this account")
			return
		}

		if device.Status == "revoked" {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Device has been revoked")
			return
		}

		token, err := auth.GenerateSessionToken()
		if err != nil {
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to generate session")
			return
		}

		expiresAt := time.Now().Add(auth.DefaultSessionTTL)
		session := &domain.Session{
			AccountID: account.ID,
			DeviceID:  device.ID,
			TokenHash: auth.HashSessionToken(token),
			ExpiresAt: expiresAt,
		}
		if err := repo.CreateSession(r.Context(), session); err != nil {
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to establish session")
			return
		}

		auth.SetSessionCookie(w, token, expiresAt, isSecure)

		WriteJSON(w, http.StatusOK, AccountSessionResponse{
			Account:         FormatAccount(account),
			Device:          FormatDevice(device),
			AuthenticatedAt: time.Now().UTC().Format(time.RFC3339),
			ExpiresAt:       expiresAt.UTC().Format(time.RFC3339),
		})
	}
}

func GetSessionHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, ok := domain.AccountFromContext(r.Context())
		if !ok || account == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}
		device, _ := domain.DeviceFromContext(r.Context())

		WriteJSON(w, http.StatusOK, AccountSessionResponse{
			Account:         FormatAccount(account),
			Device:          FormatDevice(device),
			AuthenticatedAt: time.Now().UTC().Format(time.RFC3339),
			ExpiresAt:       time.Now().Add(auth.DefaultSessionTTL).UTC().Format(time.RFC3339),
		})
	}
}

func LogoutHandler(repo database.Repository, isSecure bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(auth.SessionCookieName)
		if err == nil && cookie.Value != "" {
			tokenHash := auth.HashSessionToken(cookie.Value)
			_ = repo.RevokeSession(r.Context(), tokenHash)
		}
		auth.ClearSessionCookie(w, isSecure)
		w.WriteHeader(http.StatusNoContent)
	}
}

func DeleteAccountHandler(repo database.Repository, isSecure bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, ok := domain.AccountFromContext(r.Context())
		if !ok || account == nil {
			WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
			return
		}

		cookie, err := r.Cookie(auth.SessionCookieName)
		if err == nil && cookie.Value != "" {
			tokenHash := auth.HashSessionToken(cookie.Value)
			_ = repo.RevokeSession(r.Context(), tokenHash)
		}

		if err := repo.DeleteAccount(r.Context(), account.ID); err != nil {
			if errors.Is(err, database.ErrNotFound) {
				WriteProblem(w, http.StatusNotFound, "Not Found", "Account not found")
				return
			}
			WriteProblem(w, http.StatusInternalServerError, "Internal Server Error", "Failed to delete account")
			return
		}

		auth.ClearSessionCookie(w, isSecure)
		w.WriteHeader(http.StatusNoContent)
	}
}

