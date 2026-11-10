package router_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/personal-digital-vault/api/internal/auth"
	"github.com/personal-digital-vault/api/internal/database"
	"github.com/personal-digital-vault/api/internal/handlers"
	"github.com/personal-digital-vault/api/internal/router"
)

func setupTestServer() (http.Handler, *database.MockRepository) {
	repo := database.NewMockRepository()
	h := router.BuildRouter(router.Config{
		Repo:           repo,
		IsSecure:       false,
		AllowedOrigins: []string{"http://localhost:5173"},
	})
	return h, repo
}

func doRequest(h http.Handler, method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestHealthEndpoints(t *testing.T) {
	h, _ := setupTestServer()

	recLive := doRequest(h, "GET", "/health/live", nil, nil)
	if recLive.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recLive.Code)
	}

	recReady := doRequest(h, "GET", "/health/ready", nil, nil)
	if recReady.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recReady.Code)
	}
}

func TestAccountRegistrationAndLoginFlow(t *testing.T) {
	h, _ := setupTestServer()

	rawPub := []byte("synthetic-device-public-key-32b!")
	b64Pub := base64.RawURLEncoding.EncodeToString(rawPub)

	regReq := handlers.RegisterRequest{
		Email:              "user@example.com",
		DeviceLabel:        "Alice MacBook",
		Platform:           "macOS",
		Browser:            "Chrome",
		PublicKeyAlgorithm: "Ed25519",
		PublicKey:          b64Pub,
		CredentialType:     "external",
		CredentialID:       "cred-user-001",
	}

	// 1. Success registration
	recReg := doRequest(h, "POST", "/api/v1/auth/register", regReq, nil)
	if recReg.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d (body: %s)", recReg.Code, recReg.Body.String())
	}

	cookies := recReg.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != auth.SessionCookieName {
		t.Fatalf("expected pdv_session cookie in registration response")
	}
	sessionCookie := cookies[0]

	var sessionResp handlers.AccountSessionResponse
	if err := json.Unmarshal(recReg.Body.Bytes(), &sessionResp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if sessionResp.Account.Email != "user@example.com" {
		t.Errorf("expected email user@example.com, got %s", sessionResp.Account.Email)
	}
	if sessionResp.Device == nil || sessionResp.Device.Status != "active" {
		t.Errorf("expected initial device to be active, got %+v", sessionResp.Device)
	}
	firstDeviceID := sessionResp.Device.ID

	// 2. Duplicate registration conflict
	recDup := doRequest(h, "POST", "/api/v1/auth/register", regReq, nil)
	if recDup.Code != http.StatusConflict {
		t.Errorf("expected 409 Conflict for duplicate email, got %d", recDup.Code)
	}

	// 3. Validation failure
	invalidReq := regReq
	invalidReq.Email = "invalid-not-an-email"
	recInvalid := doRequest(h, "POST", "/api/v1/auth/register", invalidReq, nil)
	if recInvalid.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422 for invalid email, got %d", recInvalid.Code)
	}

	// 4. Get current session
	recSession := doRequest(h, "GET", "/api/v1/auth/session", nil, sessionCookie)
	if recSession.Code != http.StatusOK {
		t.Fatalf("expected 200 for authenticated session, got %d", recSession.Code)
	}

	// 5. Unauthenticated session check
	recNoAuth := doRequest(h, "GET", "/api/v1/auth/session", nil, nil)
	if recNoAuth.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for unauthenticated request, got %d", recNoAuth.Code)
	}

	// 6. Login with registered device & credential
	loginReq := handlers.LoginRequest{
		Email:          "user@example.com",
		DeviceID:       firstDeviceID,
		CredentialType: "external",
		CredentialID:   "cred-user-001",
	}
	recLogin := doRequest(h, "POST", "/api/v1/auth/login", loginReq, nil)
	if recLogin.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for valid login, got %d (body: %s)", recLogin.Code, recLogin.Body.String())
	}

	// 7. Login with invalid credential
	badLogin := loginReq
	badLogin.CredentialID = "wrong-cred"
	recBadLogin := doRequest(h, "POST", "/api/v1/auth/login", badLogin, nil)
	if recBadLogin.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for invalid credential, got %d", recBadLogin.Code)
	}

	// 8. Logout revokes session
	recLogout := doRequest(h, "POST", "/api/v1/auth/logout", nil, sessionCookie)
	if recLogout.Code != http.StatusNoContent {
		t.Errorf("expected 204 No Content for logout, got %d", recLogout.Code)
	}

	recPostLogout := doRequest(h, "GET", "/api/v1/auth/session", nil, sessionCookie)
	if recPostLogout.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 after logout revocation, got %d", recPostLogout.Code)
	}
}

func TestDeviceEnrollmentAndAuthorizationLifecycle(t *testing.T) {
	h, repo := setupTestServer()

	// Register account and Device 1 (active)
	rawPub1 := []byte("device-1-public-key-32b-padding!")
	regReq := handlers.RegisterRequest{
		Email:              "bob@example.com",
		DeviceLabel:        "Bob Laptop",
		Platform:           "Linux",
		Browser:            "Firefox",
		PublicKeyAlgorithm: "Ed25519",
		PublicKey:          base64.RawURLEncoding.EncodeToString(rawPub1),
		CredentialType:     "external",
		CredentialID:       "cred-bob-001",
	}
	recReg := doRequest(h, "POST", "/api/v1/auth/register", regReq, nil)
	if recReg.Code != http.StatusCreated {
		t.Fatalf("failed to register account: %d", recReg.Code)
	}
	device1Cookie := recReg.Result().Cookies()[0]

	// Device 1 lists devices -> 1 active device
	recList1 := doRequest(h, "GET", "/api/v1/devices", nil, device1Cookie)
	if recList1.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recList1.Code)
	}

	// Step 1: Start enrollment for Device 2 (new phone)
	rawPub2 := []byte("device-2-public-key-32b-padding!")
	enrReq := handlers.DeviceEnrollmentRequest{
		DeviceLabel:        "Bob Phone",
		Platform:           "Android",
		Browser:            "Chrome Mobile",
		PublicKeyAlgorithm: "Ed25519",
		PublicKey:          base64.RawURLEncoding.EncodeToString(rawPub2),
	}
	recEnr := doRequest(h, "POST", "/api/v1/device-enrollments", enrReq, device1Cookie)
	if recEnr.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for enrollment, got %d (body: %s)", recEnr.Code, recEnr.Body.String())
	}

	var enrResp handlers.DeviceEnrollmentResponse
	if err := json.Unmarshal(recEnr.Body.Bytes(), &enrResp); err != nil {
		t.Fatalf("failed to decode enrollment: %v", err)
	}
	if enrResp.Status != "pending" {
		t.Errorf("expected pending status, got %s", enrResp.Status)
	}
	device2ID := enrResp.DeviceID
	enrollmentID := enrResp.ID

	// Issue a session for Device 2 (simulating authenticated session in pending state)
	token2, _ := auth.GenerateSessionToken()
	expiresAt := time.Now().Add(auth.DefaultSessionTTL)
	_ = repo.CreateSessionForDevice("acc-0001", device2ID, token2, expiresAt)

	cookieDev2 := &http.Cookie{
		Name:  auth.SessionCookieName,
		Value: token2,
	}

	// Step 2: Device 2 is pending, so calling active-device-required endpoints MUST FAIL with 403 Forbidden!
	recPendingAccess := doRequest(h, "GET", "/api/v1/devices", nil, cookieDev2)
	if recPendingAccess.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for pending device, got %d (body: %s)", recPendingAccess.Code, recPendingAccess.Body.String())
	}

	// But Device 2 can check its enrollment details
	recCheckEnr := doRequest(h, "GET", "/api/v1/device-enrollments/"+enrollmentID, nil, cookieDev2)
	if recCheckEnr.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for enrollment check, got %d", recCheckEnr.Code)
	}

	// Step 3: Device 1 approves Device 2 enrollment
	approvalSig := []byte("synthetic-ed25519-signature-over-challenge")
	approvalReq := handlers.EnrollmentApprovalRequest{
		SignatureAlgorithm: "Ed25519",
		Signature:          base64.RawURLEncoding.EncodeToString(approvalSig),
	}
	recApprove := doRequest(h, "POST", "/api/v1/device-enrollments/"+enrollmentID+"/approve", approvalReq, device1Cookie)
	if recApprove.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content on approval, got %d (body: %s)", recApprove.Code, recApprove.Body.String())
	}

	// Step 4: Replay protection: cannot approve twice
	recReplay := doRequest(h, "POST", "/api/v1/device-enrollments/"+enrollmentID+"/approve", approvalReq, device1Cookie)
	if recReplay.Code != http.StatusConflict {
		t.Errorf("expected 409 Conflict on duplicate approval, got %d", recReplay.Code)
	}

	// Step 5: Now Device 2 is active! Calling active endpoints succeeds!
	recActiveAccess := doRequest(h, "GET", "/api/v1/devices", nil, cookieDev2)
	if recActiveAccess.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for now-active device, got %d (body: %s)", recActiveAccess.Code, recActiveAccess.Body.String())
	}

	// Step 6: Revoke Device 2 from Device 1
	recRevoke := doRequest(h, "POST", "/api/v1/devices/"+device2ID+"/revoke", nil, device1Cookie)
	if recRevoke.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content on revoke, got %d", recRevoke.Code)
	}

	// Step 7: Device 2 session is invalidated immediately!
	recPostRevoke := doRequest(h, "GET", "/api/v1/devices", nil, cookieDev2)
	if recPostRevoke.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for revoked device, got %d", recPostRevoke.Code)
	}
}

func TestTenantIsolation(t *testing.T) {
	h, _ := setupTestServer()

	// Account A
	pubA := base64.RawURLEncoding.EncodeToString([]byte("pubkey-account-a-32bytes-padding!"))
	regA := handlers.RegisterRequest{
		Email:              "alice@example.com",
		DeviceLabel:        "Alice Laptop",
		Platform:           "macOS",
		Browser:            "Safari",
		PublicKeyAlgorithm: "Ed25519",
		PublicKey:          pubA,
		CredentialType:     "external",
		CredentialID:       "cred-alice-1",
	}
	recA := doRequest(h, "POST", "/api/v1/auth/register", regA, nil)
	cookieA := recA.Result().Cookies()[0]

	// Account B
	pubB := base64.RawURLEncoding.EncodeToString([]byte("pubkey-account-b-32bytes-padding!"))
	regB := handlers.RegisterRequest{
		Email:              "eve@example.com",
		DeviceLabel:        "Eve Laptop",
		Platform:           "Windows",
		Browser:            "Edge",
		PublicKeyAlgorithm: "Ed25519",
		PublicKey:          pubB,
		CredentialType:     "external",
		CredentialID:       "cred-eve-1",
	}
	recB := doRequest(h, "POST", "/api/v1/auth/register", regB, nil)
	cookieB := recB.Result().Cookies()[0]

	// Account B creates an enrollment challenge
	enrReq := handlers.DeviceEnrollmentRequest{
		DeviceLabel:        "Eve Phone",
		Platform:           "iOS",
		Browser:            "Safari",
		PublicKeyAlgorithm: "Ed25519",
		PublicKey:          pubB,
	}
	recEnrB := doRequest(h, "POST", "/api/v1/device-enrollments", enrReq, cookieB)
	var enrRespB handlers.DeviceEnrollmentResponse
	_ = json.Unmarshal(recEnrB.Body.Bytes(), &enrRespB)

	// Account A attempts to read Account B's enrollment -> must return 404 Not Found!
	recCrossRead := doRequest(h, "GET", "/api/v1/device-enrollments/"+enrRespB.ID, nil, cookieA)
	if recCrossRead.Code != http.StatusNotFound {
		t.Errorf("expected 404 for cross-account enrollment read, got %d", recCrossRead.Code)
	}

	// Account A attempts to approve Account B's enrollment -> must return 404 Not Found!
	sig := base64.RawURLEncoding.EncodeToString([]byte("fake-sig"))
	recCrossApprove := doRequest(h, "POST", "/api/v1/device-enrollments/"+enrRespB.ID+"/approve", handlers.EnrollmentApprovalRequest{
		SignatureAlgorithm: "Ed25519",
		Signature:          sig,
	}, cookieA)
	if recCrossApprove.Code != http.StatusNotFound {
		t.Errorf("expected 404 for cross-account enrollment approval, got %d", recCrossApprove.Code)
	}

	// Account A attempts to revoke Account B's device -> must return 404 Not Found!
	recCrossRevoke := doRequest(h, "POST", "/api/v1/devices/"+enrRespB.DeviceID+"/revoke", nil, cookieA)
	if recCrossRevoke.Code != http.StatusNotFound {
		t.Errorf("expected 404 for cross-account device revocation, got %d", recCrossRevoke.Code)
	}
}
