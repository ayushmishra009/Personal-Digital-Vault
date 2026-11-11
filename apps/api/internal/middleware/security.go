package middleware

import (
	"net/http"
)

// SecurityHeaders applies browser defense-in-depth headers to all API responses.
// Since the API only serves JSON and binary streams, strict non-rendering CSP is enforced.
func SecurityHeaders(isSecure bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()

			// Disallow framing and clickjacking completely
			h.Set("X-Frame-Options", "DENY")
			h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none';")

			// Prevent MIME sniffing
			h.Set("X-Content-Type-Options", "nosniff")

			// Restrict referrer leakage
			h.Set("Referrer-Policy", "strict-origin-when-cross-origin")

			// Restrict browser hardware APIs
			h.Set("Permissions-Policy", "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()")

			// Prevent caching of sensitive cryptographic or personal data across caches
			h.Set("Cache-Control", "no-store, no-cache, must-revalidate, private")
			h.Set("Pragma", "no-cache")

			// Enforce HTTPS HSTS when in production/secure mode
			if isSecure {
				h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
			}

			next.ServeHTTP(w, r)
		})
	}
}
