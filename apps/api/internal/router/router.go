package router

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	"github.com/personal-digital-vault/api/internal/database"
	"github.com/personal-digital-vault/api/internal/handlers"
	"github.com/personal-digital-vault/api/internal/middleware"
)

type Config struct {
	Repo           database.Repository
	DB             *sql.DB
	IsSecure       bool
	AllowedOrigins []string
}

func BuildRouter(cfg Config) http.Handler {
	mux := http.NewServeMux()

	// Health routes
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, _ *http.Request) {
		handlers.WriteJSON(w, http.StatusOK, map[string]string{"status": "live"})
	})
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		if cfg.DB != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			if err := cfg.DB.PingContext(ctx); err != nil {
				handlers.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready"})
				return
			}
		}
		handlers.WriteJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})

	// Public Auth routes
	mux.Handle("POST /api/v1/auth/register", handlers.RegisterHandler(cfg.Repo, cfg.IsSecure))
	mux.Handle("POST /api/v1/auth/login", handlers.LoginHandler(cfg.Repo, cfg.IsSecure))
	mux.Handle("POST /api/v1/auth/logout", handlers.LogoutHandler(cfg.Repo, cfg.IsSecure))

	// Session inspection (allows pending device to check session status)
	requireAnySession := middleware.RequireSession(cfg.Repo, false)
	mux.Handle("GET /api/v1/auth/session", requireAnySession(handlers.GetSessionHandler()))

	// Device enrollment (creation and reading enrollment allowed with valid session)
	mux.Handle("POST /api/v1/device-enrollments", requireAnySession(handlers.CreateDeviceEnrollmentHandler(cfg.Repo)))
	mux.Handle("GET /api/v1/device-enrollments/{enrollmentId}", requireAnySession(handlers.GetDeviceEnrollmentHandler(cfg.Repo)))

	// Protected routes (strictly require an active device)
	requireActiveSession := middleware.RequireSession(cfg.Repo, true)
	mux.Handle("GET /api/v1/devices", requireActiveSession(handlers.ListDevicesHandler(cfg.Repo)))
	mux.Handle("POST /api/v1/device-enrollments/{enrollmentId}/approve", requireActiveSession(handlers.ApproveDeviceEnrollmentHandler(cfg.Repo)))
	mux.Handle("POST /api/v1/devices/{deviceId}/revoke", requireActiveSession(handlers.RevokeDeviceHandler(cfg.Repo)))

	// Vault routes (strictly require an active device)
	mux.Handle("GET /api/v1/vaults", requireActiveSession(handlers.ListVaultsHandler(cfg.Repo)))
	mux.Handle("POST /api/v1/vaults", requireActiveSession(handlers.CreateVaultHandler(cfg.Repo)))
	mux.Handle("GET /api/v1/vaults/{vaultId}", requireActiveSession(handlers.GetVaultHandler(cfg.Repo)))
	mux.Handle("DELETE /api/v1/vaults/{vaultId}", requireActiveSession(handlers.DeleteVaultHandler(cfg.Repo)))
	mux.Handle("GET /api/v1/vaults/{vaultId}/envelopes/{envelopeType}", requireActiveSession(handlers.GetVaultKeyEnvelopeHandler(cfg.Repo)))
	mux.Handle("PUT /api/v1/vaults/{vaultId}/envelopes/{envelopeType}", requireActiveSession(handlers.PutVaultKeyEnvelopeHandler(cfg.Repo)))

	return middleware.Cors(cfg.AllowedOrigins)(mux)
}
