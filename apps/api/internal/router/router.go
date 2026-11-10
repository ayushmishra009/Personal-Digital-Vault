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

	// Sync Engine & Object routes (strictly require an active device)
	mux.Handle("GET /api/v1/vaults/{vaultId}/sync", requireActiveSession(handlers.ListSyncEventsHandler(cfg.Repo)))
	mux.Handle("POST /api/v1/vaults/{vaultId}/sync/operations", requireActiveSession(handlers.SubmitSyncOperationHandler(cfg.Repo)))
	mux.Handle("GET /api/v1/vaults/{vaultId}/objects/{objectId}", requireActiveSession(handlers.GetEncryptedObjectHandler(cfg.Repo)))
	mux.Handle("PUT /api/v1/vaults/{vaultId}/objects/{objectId}", requireActiveSession(handlers.PutEncryptedObjectHandler(cfg.Repo)))

	// Attachment routes (strictly require an active device)
	mux.Handle("GET /api/v1/vaults/{vaultId}/attachments", requireActiveSession(handlers.ListAttachmentsHandler(cfg.Repo)))
	mux.Handle("POST /api/v1/vaults/{vaultId}/attachments/upload-session", requireActiveSession(handlers.CreateAttachmentUploadSessionHandler(cfg.Repo)))
	mux.Handle("POST /api/v1/vaults/{vaultId}/attachments/{attachmentId}/complete", requireActiveSession(handlers.CompleteAttachmentUploadHandler(cfg.Repo)))
	mux.Handle("GET /api/v1/vaults/{vaultId}/attachments/{attachmentId}/download-session", requireActiveSession(handlers.CreateAttachmentDownloadSessionHandler(cfg.Repo)))
	mux.Handle("GET /api/v1/vaults/{vaultId}/attachments/{attachmentId}", requireActiveSession(handlers.GetAttachmentHandler(cfg.Repo)))
	mux.Handle("DELETE /api/v1/vaults/{vaultId}/attachments/{attachmentId}", requireActiveSession(handlers.DeleteAttachmentHandler(cfg.Repo)))
	mux.Handle("PUT /api/v1/vaults/{vaultId}/attachments/{attachmentId}/content", requireActiveSession(handlers.UploadAttachmentContentHandler(cfg.Repo)))
	mux.Handle("GET /api/v1/vaults/{vaultId}/attachments/{attachmentId}/content", requireActiveSession(handlers.DownloadAttachmentContentHandler(cfg.Repo)))

	// Backup metadata routes (strictly require an active device)
	mux.Handle("POST /api/v1/vaults/{vaultId}/backup/metadata", requireActiveSession(handlers.CreateBackupMetadataHandler(cfg.Repo)))
	mux.Handle("GET /api/v1/vaults/{vaultId}/backup/metadata", requireActiveSession(handlers.ListBackupMetadataHandler(cfg.Repo)))

	// CMS & Dynamic App Configuration routes (strictly require an active device)
	cmsH := &handlers.CmsHandler{Repo: cfg.Repo}
	mux.Handle("GET /api/v1/app/configuration", requireActiveSession(http.HandlerFunc(cmsH.GetAppConfiguration)))
	mux.Handle("GET /api/v1/admin/cms/modules", requireActiveSession(http.HandlerFunc(cmsH.ListModules)))
	mux.Handle("PUT /api/v1/admin/cms/modules/{moduleKey}", requireActiveSession(http.HandlerFunc(cmsH.UpdateModule)))
	mux.Handle("GET /api/v1/admin/cms/sections", requireActiveSession(http.HandlerFunc(cmsH.ListSections)))
	mux.Handle("POST /api/v1/admin/cms/sections", requireActiveSession(http.HandlerFunc(cmsH.CreateSection)))
	mux.Handle("PUT /api/v1/admin/cms/sections/{sectionId}", requireActiveSession(http.HandlerFunc(cmsH.UpdateSection)))
	mux.Handle("DELETE /api/v1/admin/cms/sections/{sectionId}", requireActiveSession(http.HandlerFunc(cmsH.DeleteSection)))
	mux.Handle("GET /api/v1/admin/cms/navigation", requireActiveSession(http.HandlerFunc(cmsH.ListNavigation)))
	mux.Handle("PUT /api/v1/admin/cms/navigation/{itemId}", requireActiveSession(http.HandlerFunc(cmsH.UpdateNavigationItem)))
	mux.Handle("GET /api/v1/admin/cms/theme", requireActiveSession(http.HandlerFunc(cmsH.GetTheme)))
	mux.Handle("PUT /api/v1/admin/cms/theme", requireActiveSession(http.HandlerFunc(cmsH.UpdateTheme)))
	mux.Handle("GET /api/v1/admin/cms/revisions", requireActiveSession(http.HandlerFunc(cmsH.ListRevisions)))
	mux.Handle("POST /api/v1/admin/cms/revisions/{revisionNumber}/restore", requireActiveSession(http.HandlerFunc(cmsH.RestoreRevision)))

	return middleware.Cors(cfg.AllowedOrigins)(mux)
}
