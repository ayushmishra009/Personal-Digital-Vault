package middleware

import (
	"net/http"

	"github.com/personal-digital-vault/api/internal/auth"
	"github.com/personal-digital-vault/api/internal/database"
	"github.com/personal-digital-vault/api/internal/domain"
	"github.com/personal-digital-vault/api/internal/handlers"
)

// RequireSession authenticates the request via the pdv_session cookie.
// If requireActiveDevice is true, devices with status "pending" receive 403 Forbidden.
func RequireSession(repo database.Repository, requireActiveDevice bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie(auth.SessionCookieName)
			if err != nil || cookie.Value == "" {
				handlers.WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
				return
			}

			tokenHash := auth.HashSessionToken(cookie.Value)
			session, account, device, err := repo.GetSessionByTokenHash(r.Context(), tokenHash)
			if err != nil || session == nil {
				handlers.WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Authentication required")
				return
			}

			if account.Status != "active" {
				handlers.WriteProblem(w, http.StatusForbidden, "Forbidden", "Account is suspended")
				return
			}

			if device.Status == "revoked" {
				handlers.WriteProblem(w, http.StatusUnauthorized, "Unauthorized", "Device has been revoked")
				return
			}

			if requireActiveDevice && device.Status != "active" {
				handlers.WriteProblem(w, http.StatusForbidden, "Forbidden", "Device enrollment pending approval")
				return
			}

			ctx := domain.ContextWithAccount(r.Context(), account)
			ctx = domain.ContextWithDevice(ctx, device)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// Cors handles cross-origin requests and preflight checks.
func Cors(allowedOrigins []string) func(http.Handler) http.Handler {
	originSet := make(map[string]bool)
	for _, o := range allowedOrigins {
		originSet[o] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" && (originSet[origin] || len(originSet) == 0) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key")
			}

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
