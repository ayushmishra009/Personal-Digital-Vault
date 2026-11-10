package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"time"
)

const SessionCookieName = "pdv_session"
const DefaultSessionTTL = 24 * time.Hour

// GenerateSessionToken creates 32 cryptographically secure random bytes, base64url encoded.
func GenerateSessionToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

// HashSessionToken hashes the raw session token with SHA-256 for database storage.
func HashSessionToken(token string) []byte {
	hash := sha256.Sum256([]byte(token))
	return hash[:]
}

// SetSessionCookie sets a secure, HttpOnly, SameSite=Strict session cookie.
func SetSessionCookie(w http.ResponseWriter, token string, expiresAt time.Time, isSecure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		HttpOnly: true,
		Secure:   isSecure,
		SameSite: http.SameSiteStrictMode,
	})
}

// ClearSessionCookie sets an expired cookie to clear the session.
func ClearSessionCookie(w http.ResponseWriter, isSecure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
		Secure:   isSecure,
		SameSite: http.SameSiteStrictMode,
	})
}
