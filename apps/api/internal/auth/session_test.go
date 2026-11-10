package auth_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/personal-digital-vault/api/internal/auth"
)

func TestSessionTokenGenerationAndHashing(t *testing.T) {
	token1, err := auth.GenerateSessionToken()
	if err != nil {
		t.Fatalf("unexpected error generating token: %v", err)
	}
	if len(token1) == 0 {
		t.Fatalf("expected non-empty token")
	}

	token2, err := auth.GenerateSessionToken()
	if err != nil {
		t.Fatalf("unexpected error generating token: %v", err)
	}
	if token1 == token2 {
		t.Fatalf("expected distinct random tokens, got identical")
	}

	hash1 := auth.HashSessionToken(token1)
	hash2 := auth.HashSessionToken(token2)
	if bytes.Equal(hash1, hash2) {
		t.Fatalf("expected distinct hashes for distinct tokens")
	}
	if len(hash1) != 32 {
		t.Fatalf("expected 32-byte sha256 hash, got %d bytes", len(hash1))
	}

	hash1Repeat := auth.HashSessionToken(token1)
	if !bytes.Equal(hash1, hash1Repeat) {
		t.Fatalf("expected deterministic hash output")
	}
}

func TestSessionCookieHandling(t *testing.T) {
	rec := httptest.NewRecorder()
	expiresAt := time.Now().Add(auth.DefaultSessionTTL)
	auth.SetSessionCookie(rec, "synthetic-token-xyz", expiresAt, true)

	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected 1 cookie, got %d", len(cookies))
	}
	cookie := cookies[0]
	if cookie.Name != auth.SessionCookieName {
		t.Errorf("expected cookie name %s, got %s", auth.SessionCookieName, cookie.Name)
	}
	if cookie.Value != "synthetic-token-xyz" {
		t.Errorf("expected cookie value synthetic-token-xyz, got %s", cookie.Value)
	}
	if !cookie.HttpOnly {
		t.Errorf("expected HttpOnly cookie")
	}
	if !cookie.Secure {
		t.Errorf("expected Secure cookie")
	}
	if cookie.SameSite != http.SameSiteStrictMode {
		t.Errorf("expected SameSite=Strict cookie")
	}

	clearRec := httptest.NewRecorder()
	auth.ClearSessionCookie(clearRec, true)
	clearedCookies := clearRec.Result().Cookies()
	if len(clearedCookies) != 1 {
		t.Fatalf("expected 1 cleared cookie, got %d", len(clearedCookies))
	}
	cleared := clearedCookies[0]
	if cleared.MaxAge != -1 {
		t.Errorf("expected MaxAge=-1 for cleared cookie, got %d", cleared.MaxAge)
	}
}
