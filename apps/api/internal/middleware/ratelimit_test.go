package middleware_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/personal-digital-vault/api/internal/middleware"
)

func TestRateLimiter(t *testing.T) {
	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	t.Run("Enforces rate limits when threshold exceeded", func(t *testing.T) {
		cfg := middleware.RateLimiterConfig{
			AuthRequestsPerMinute:       3,
			EnrollmentRequestsPerMinute: 5,
			DefaultRequestsPerMinute:    10,
			Enabled:                     true,
		}
		rl := middleware.NewRateLimiter(cfg)
		defer rl.Stop()

		handler := rl.Middleware()(dummyHandler)

		// First 3 auth requests should pass
		for i := 0; i < 3; i++ {
			req := httptest.NewRequest("POST", "/api/v1/auth/login", nil)
			req.RemoteAddr = "192.0.2.1:12345"
			rec := httptest.NewRecorder()

			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("expected request %d to succeed with 200, got %d", i+1, rec.Code)
			}
		}

		// 4th request must be rate limited with 429
		req := httptest.NewRequest("POST", "/api/v1/auth/login", nil)
		req.RemoteAddr = "192.0.2.1:12345"
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusTooManyRequests {
			t.Fatalf("expected 4th request to receive 429, got %d", rec.Code)
		}

		if rec.Header().Get("Retry-After") != "60" {
			t.Errorf("expected Retry-After header '60', got '%s'", rec.Header().Get("Retry-After"))
		}

		var prob struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&prob); err != nil {
			t.Fatalf("failed to decode RFC 7807 problem json: %v", err)
		}
		if prob.Error.Code != "Too Many Requests" {
			t.Errorf("expected problem code 'Too Many Requests', got '%s'", prob.Error.Code)
		}

		// Different IP should still succeed
		otherReq := httptest.NewRequest("POST", "/api/v1/auth/login", nil)
		otherReq.RemoteAddr = "192.0.2.2:12345"
		otherRec := httptest.NewRecorder()
		handler.ServeHTTP(otherRec, otherReq)
		if otherRec.Code != http.StatusOK {
			t.Fatalf("expected different client IP to succeed, got %d", otherRec.Code)
		}
	})

	t.Run("Health endpoints bypass rate limiting", func(t *testing.T) {
		cfg := middleware.RateLimiterConfig{
			AuthRequestsPerMinute:    1,
			DefaultRequestsPerMinute: 1,
			Enabled:                  true,
		}
		rl := middleware.NewRateLimiter(cfg)
		defer rl.Stop()

		handler := rl.Middleware()(dummyHandler)

		for i := 0; i < 5; i++ {
			req := httptest.NewRequest("GET", "/health/live", nil)
			req.RemoteAddr = "192.0.2.100:12345"
			rec := httptest.NewRecorder()

			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("expected health endpoint to bypass rate limits, got %d on request %d", rec.Code, i+1)
			}
		}
	})
}
