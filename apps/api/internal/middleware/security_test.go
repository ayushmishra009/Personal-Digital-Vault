package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/personal-digital-vault/api/internal/middleware"
)

func TestSecurityHeaders(t *testing.T) {
	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	t.Run("Standard insecure mode headers", func(t *testing.T) {
		handler := middleware.SecurityHeaders(false)(dummyHandler)
		req := httptest.NewRequest("GET", "/api/v1/vaults", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", rec.Code)
		}

		headers := rec.Header()

		if h := headers.Get("X-Frame-Options"); h != "DENY" {
			t.Errorf("expected X-Frame-Options 'DENY', got '%s'", h)
		}
		if h := headers.Get("Content-Security-Policy"); h != "default-src 'none'; frame-ancestors 'none'; base-uri 'none';" {
			t.Errorf("expected strict API CSP, got '%s'", h)
		}
		if h := headers.Get("X-Content-Type-Options"); h != "nosniff" {
			t.Errorf("expected X-Content-Type-Options 'nosniff', got '%s'", h)
		}
		if h := headers.Get("Referrer-Policy"); h != "strict-origin-when-cross-origin" {
			t.Errorf("expected Referrer-Policy 'strict-origin-when-cross-origin', got '%s'", h)
		}
		if h := headers.Get("Cache-Control"); h != "no-store, no-cache, must-revalidate, private" {
			t.Errorf("expected non-caching Cache-Control, got '%s'", h)
		}
		if h := headers.Get("Strict-Transport-Security"); h != "" {
			t.Errorf("expected no HSTS in insecure mode, got '%s'", h)
		}
	})

	t.Run("Production secure mode enables HSTS", func(t *testing.T) {
		handler := middleware.SecurityHeaders(true)(dummyHandler)
		req := httptest.NewRequest("GET", "/api/v1/vaults", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", rec.Code)
		}

		if h := rec.Header().Get("Strict-Transport-Security"); h != "max-age=63072000; includeSubDomains; preload" {
			t.Errorf("expected HSTS header in secure mode, got '%s'", h)
		}
	})
}
