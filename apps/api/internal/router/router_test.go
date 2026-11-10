package router_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/personal-digital-vault/api/internal/auth"
	"github.com/personal-digital-vault/api/internal/database"
	"github.com/personal-digital-vault/api/internal/domain"
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

func sampleEnvelopes() []handlers.VaultKeyEnvelopeDTO {
	salt := base64.RawURLEncoding.EncodeToString(make([]byte, 16))
	wrappedVek := base64.RawURLEncoding.EncodeToString(make([]byte, 40))

	return []handlers.VaultKeyEnvelopeDTO{
		{
			EnvelopeType:     "password",
			ProtocolVersion:  1,
			KeyWrapAlgorithm: "AES-256-KW",
			KDFAlgorithm:     "argon2id13",
			KDFParameters: map[string]int64{
				"version":     19,
				"memoryKiB":   65536,
				"iterations":  3,
				"parallelism": 4,
			},
			Salt:       salt,
			WrappedVEK: wrappedVek,
		},
		{
			EnvelopeType:     "recovery",
			ProtocolVersion:  1,
			KeyWrapAlgorithm: "AES-256-KW",
			KDFAlgorithm:     "hkdf-sha256",
			KDFParameters:    map[string]int64{},
			Salt:             salt,
			WrappedVEK:       wrappedVek,
		},
	}
}

func TestVaultLifecycle(t *testing.T) {
	h, repo := setupTestServer()

	// Register account & active device
	pub := base64.RawURLEncoding.EncodeToString([]byte("pubkey-32bytes-for-vault-tester!"))
	regReq := handlers.RegisterRequest{
		Email:              "vaultuser@example.com",
		DeviceLabel:        "Vault Laptop",
		Platform:           "macOS",
		Browser:            "Safari",
		PublicKeyAlgorithm: "Ed25519",
		PublicKey:          pub,
		CredentialType:     "external",
		CredentialID:       "cred-vault-1",
	}
	recReg := doRequest(h, "POST", "/api/v1/auth/register", regReq, nil)
	activeCookie := recReg.Result().Cookies()[0]

	// 1. Create Vault with valid envelopes
	createReq := handlers.CreateVaultRequest{
		ProtocolVersion: 1,
		Envelopes:       sampleEnvelopes(),
	}
	recCreate := doRequest(h, "POST", "/api/v1/vaults", createReq, activeCookie)
	if recCreate.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for vault, got %d (body: %s)", recCreate.Code, recCreate.Body.String())
	}

	var vaultResp handlers.VaultMetadataResponse
	if err := json.Unmarshal(recCreate.Body.Bytes(), &vaultResp); err != nil {
		t.Fatalf("failed to parse vault response: %v", err)
	}
	if vaultResp.Status != "active" || vaultResp.ProtocolVersion != 1 {
		t.Errorf("unexpected vault metadata: %+v", vaultResp)
	}
	vaultID := vaultResp.ID

	// 2. Reject invalid envelopes
	// Duplicate password envelope
	badReq := handlers.CreateVaultRequest{
		ProtocolVersion: 1,
		Envelopes: []handlers.VaultKeyEnvelopeDTO{
			sampleEnvelopes()[0],
			sampleEnvelopes()[0],
		},
	}
	recBad := doRequest(h, "POST", "/api/v1/vaults", badReq, activeCookie)
	if recBad.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422 for duplicate envelope, got %d", recBad.Code)
	}

	// Password envelope with disallowed KDF parameters (parallelism 1)
	badKdf := sampleEnvelopes()
	badKdf[0].KDFParameters["parallelism"] = 1
	recBadKdf := doRequest(h, "POST", "/api/v1/vaults", handlers.CreateVaultRequest{ProtocolVersion: 1, Envelopes: badKdf}, activeCookie)
	if recBadKdf.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422 for non-p=4 password envelope, got %d", recBadKdf.Code)
	}

	// 3. List Vaults
	recList := doRequest(h, "GET", "/api/v1/vaults", nil, activeCookie)
	if recList.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for list vaults, got %d", recList.Code)
	}
	var listResp struct {
		Items []handlers.VaultMetadataResponse `json:"items"`
	}
	_ = json.Unmarshal(recList.Body.Bytes(), &listResp)
	if len(listResp.Items) != 1 || listResp.Items[0].ID != vaultID {
		t.Fatalf("expected 1 vault with ID %s, got %+v", vaultID, listResp.Items)
	}

	// 4. Get Vault by ID
	recGet := doRequest(h, "GET", "/api/v1/vaults/"+vaultID, nil, activeCookie)
	if recGet.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for get vault, got %d", recGet.Code)
	}

	// 5. Read Key Envelopes
	recPassEnv := doRequest(h, "GET", "/api/v1/vaults/"+vaultID+"/envelopes/password", nil, activeCookie)
	if recPassEnv.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for password envelope, got %d", recPassEnv.Code)
	}
	var passEnvDTO handlers.VaultKeyEnvelopeDTO
	_ = json.Unmarshal(recPassEnv.Body.Bytes(), &passEnvDTO)
	if passEnvDTO.EnvelopeType != "password" || passEnvDTO.KDFAlgorithm != "argon2id13" {
		t.Errorf("unexpected password envelope: %+v", passEnvDTO)
	}

	recRecovEnv := doRequest(h, "GET", "/api/v1/vaults/"+vaultID+"/envelopes/recovery", nil, activeCookie)
	if recRecovEnv.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for recovery envelope, got %d", recRecovEnv.Code)
	}

	// 6. Password Change: Rewrap VEK
	newSalt := base64.RawURLEncoding.EncodeToString(make([]byte, 16))
	newWrapped := base64.RawURLEncoding.EncodeToString(make([]byte, 40))
	updateEnv := handlers.VaultKeyEnvelopeDTO{
		EnvelopeType:     "password",
		ProtocolVersion:  1,
		KeyWrapAlgorithm: "AES-256-KW",
		KDFAlgorithm:     "argon2id13",
		KDFParameters: map[string]int64{
			"version":     19,
			"memoryKiB":   65536,
			"iterations":  3,
			"parallelism": 4,
		},
		Salt:       newSalt,
		WrappedVEK: newWrapped,
	}
	recPut := doRequest(h, "PUT", "/api/v1/vaults/"+vaultID+"/envelopes/password", updateEnv, activeCookie)
	if recPut.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for envelope rewrap, got %d (body: %s)", recPut.Code, recPut.Body.String())
	}

	recUpdatedPass := doRequest(h, "GET", "/api/v1/vaults/"+vaultID+"/envelopes/password", nil, activeCookie)
	var updatedDTO handlers.VaultKeyEnvelopeDTO
	_ = json.Unmarshal(recUpdatedPass.Body.Bytes(), &updatedDTO)
	if updatedDTO.Salt != newSalt || updatedDTO.WrappedVEK != newWrapped {
		t.Errorf("expected updated salt and wrappedVek, got %+v", updatedDTO)
	}

	// 7. Verify pending device cannot access vaults (403 Forbidden)
	tokenPending, _ := auth.GenerateSessionToken()
	pendingDev, _, err := repo.CreatePendingDeviceAndEnrollment(t.Context(), &domain.Device{
		AccountID: "acc-0001",
		Label:     "Pending Phone",
		Status:    "pending",
	}, make([]byte, 32), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("failed to create pending device: %v", err)
	}

	_ = repo.CreateSessionForDevice("acc-0001", pendingDev.ID, tokenPending, time.Now().Add(time.Hour))
	pendingCookie := &http.Cookie{Name: auth.SessionCookieName, Value: tokenPending}

	recPendingList := doRequest(h, "GET", "/api/v1/vaults", nil, pendingCookie)
	if recPendingList.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for pending device on vaults, got %d", recPendingList.Code)
	}

	// 8. Delete Vault
	recDel := doRequest(h, "DELETE", "/api/v1/vaults/"+vaultID, nil, activeCookie)
	if recDel.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for vault delete, got %d", recDel.Code)
	}

	recPostDel := doRequest(h, "GET", "/api/v1/vaults/"+vaultID, nil, activeCookie)
	if recPostDel.Code != http.StatusNotFound {
		t.Errorf("expected 404 Not Found after deletion, got %d", recPostDel.Code)
	}
}

func TestVaultTenantIsolation(t *testing.T) {
	h, _ := setupTestServer()

	// Account A
	pubA := base64.RawURLEncoding.EncodeToString([]byte("pubkey-acc-a-32bytes-for-vaults!"))
	recA := doRequest(h, "POST", "/api/v1/auth/register", handlers.RegisterRequest{
		Email:              "usera@example.com",
		DeviceLabel:        "UserA Device",
		Platform:           "Web",
		Browser:            "Chrome",
		PublicKeyAlgorithm: "Ed25519",
		PublicKey:          pubA,
		CredentialType:     "external",
		CredentialID:       "cred-a",
	}, nil)
	cookieA := recA.Result().Cookies()[0]

	// Account B
	pubB := base64.RawURLEncoding.EncodeToString([]byte("pubkey-acc-b-32bytes-for-vaults!"))
	recB := doRequest(h, "POST", "/api/v1/auth/register", handlers.RegisterRequest{
		Email:              "userb@example.com",
		DeviceLabel:        "UserB Device",
		Platform:           "Web",
		Browser:            "Firefox",
		PublicKeyAlgorithm: "Ed25519",
		PublicKey:          pubB,
		CredentialType:     "external",
		CredentialID:       "cred-b",
	}, nil)
	cookieB := recB.Result().Cookies()[0]

	// Account A creates a vault
	recCreateA := doRequest(h, "POST", "/api/v1/vaults", handlers.CreateVaultRequest{
		ProtocolVersion: 1,
		Envelopes:       sampleEnvelopes(),
	}, cookieA)
	var vaultA handlers.VaultMetadataResponse
	_ = json.Unmarshal(recCreateA.Body.Bytes(), &vaultA)

	// Account B attempts to read Account A's vault -> 404
	recCrossGet := doRequest(h, "GET", "/api/v1/vaults/"+vaultA.ID, nil, cookieB)
	if recCrossGet.Code != http.StatusNotFound {
		t.Errorf("expected 404 for cross-account vault read, got %d", recCrossGet.Code)
	}

	// Account B attempts to read Account A's envelopes -> 404
	recCrossEnv := doRequest(h, "GET", "/api/v1/vaults/"+vaultA.ID+"/envelopes/password", nil, cookieB)
	if recCrossEnv.Code != http.StatusNotFound {
		t.Errorf("expected 404 for cross-account envelope read, got %d", recCrossEnv.Code)
	}

	// Account B attempts to delete Account A's vault -> 404
	recCrossDel := doRequest(h, "DELETE", "/api/v1/vaults/"+vaultA.ID, nil, cookieB)
	if recCrossDel.Code != http.StatusNotFound {
		t.Errorf("expected 404 for cross-account vault delete, got %d", recCrossDel.Code)
	}
}

func TestCmsEndpointsAndSeeding(t *testing.T) {
	h, _ := setupTestServer()

	pub := base64.RawURLEncoding.EncodeToString([]byte("pubkey-for-cms-testing-32bytes!!"))
	recReg := doRequest(h, "POST", "/api/v1/auth/register", handlers.RegisterRequest{
		Email:              "cmsuser@example.com",
		DeviceLabel:        "CMS Test Device",
		Platform:           "Web",
		Browser:            "Chrome",
		PublicKeyAlgorithm: "Ed25519",
		PublicKey:          pub,
		CredentialType:     "external",
		CredentialID:       "cred-cms-001",
	}, nil)
	if recReg.Code != http.StatusCreated {
		t.Fatalf("failed to register user for CMS test: %d", recReg.Code)
	}
	cookie := recReg.Result().Cookies()[0]

	// 1. Get initial seeded app configuration
	recConfig := doRequest(h, "GET", "/api/v1/app/configuration", nil, cookie)
	if recConfig.Code != http.StatusOK {
		t.Fatalf("expected 200 for app config, got %d: %s", recConfig.Code, recConfig.Body.String())
	}
	var config domain.AppConfiguration
	if err := json.Unmarshal(recConfig.Body.Bytes(), &config); err != nil {
		t.Fatalf("failed to unmarshal app configuration: %v", err)
	}
	if len(config.Modules) == 0 {
		t.Fatalf("expected seeded modules, got none")
	}
	if len(config.Sections) == 0 {
		t.Fatalf("expected seeded sections, got none")
	}
	if len(config.Navigation) == 0 {
		t.Fatalf("expected seeded navigation, got none")
	}
	if config.Theme.ThemePreset == "" {
		t.Fatalf("expected seeded theme preset, got empty")
	}

	// 2. List & Update Modules
	recModules := doRequest(h, "GET", "/api/v1/admin/cms/modules", nil, cookie)
	if recModules.Code != http.StatusOK {
		t.Fatalf("expected 200 for cms modules, got %d", recModules.Code)
	}
	var modules []domain.CmsModule
	_ = json.Unmarshal(recModules.Body.Bytes(), &modules)
	if len(modules) == 0 {
		t.Fatalf("expected module list to have items")
	}

	targetModule := modules[0].ModuleKey
	desc := "Customized generator module"
	recUpdateMod := doRequest(h, "PUT", "/api/v1/admin/cms/modules/"+targetModule, handlers.UpdateCmsModuleRequest{
		DisplayName:  "Custom Generator",
		Description:  &desc,
		IsEnabled:    true,
		DisplayOrder: 10,
	}, cookie)
	if recUpdateMod.Code != http.StatusOK {
		t.Fatalf("expected 200 for update module, got %d: %s", recUpdateMod.Code, recUpdateMod.Body.String())
	}

	// 3. Sections: List, Create, Update, Delete
	recSections := doRequest(h, "GET", "/api/v1/admin/cms/sections?screenKey=vault_overview", nil, cookie)
	if recSections.Code != http.StatusOK {
		t.Fatalf("expected 200 for cms sections, got %d", recSections.Code)
	}

	recCreateSec := doRequest(h, "POST", "/api/v1/admin/cms/sections", handlers.CreateCmsSectionRequest{
		ScreenKey:   "vault_overview",
		SectionType: "quick_actions",
		Title:       "Dynamic Quick Actions",
		ContentPayload: map[string]any{
			"actions": []string{"add_password", "generate_pass"},
		},
		StyleConfig: map[string]any{
			"variant": "compact",
		},
		DisplayOrder: 99,
		IsEnabled:    true,
	}, cookie)
	if recCreateSec.Code != http.StatusCreated {
		t.Fatalf("expected 201 for create section, got %d: %s", recCreateSec.Code, recCreateSec.Body.String())
	}
	var createdSec domain.CmsSection
	_ = json.Unmarshal(recCreateSec.Body.Bytes(), &createdSec)
	if createdSec.ID == "" {
		t.Fatalf("expected created section to have an ID")
	}

	recUpdateSec := doRequest(h, "PUT", "/api/v1/admin/cms/sections/"+createdSec.ID, handlers.UpdateCmsSectionRequest{
		Title: "Updated Quick Actions Title",
		ContentPayload: map[string]any{
			"actions": []string{"add_password"},
		},
		StyleConfig:  map[string]any{},
		DisplayOrder: 5,
		IsEnabled:    true,
	}, cookie)
	if recUpdateSec.Code != http.StatusOK {
		t.Fatalf("expected 200 for update section, got %d", recUpdateSec.Code)
	}

	// 4. Navigation: List & Update
	recNav := doRequest(h, "GET", "/api/v1/admin/cms/navigation", nil, cookie)
	if recNav.Code != http.StatusOK {
		t.Fatalf("expected 200 for navigation list, got %d", recNav.Code)
	}
	var navItems []domain.CmsNavigationItem
	_ = json.Unmarshal(recNav.Body.Bytes(), &navItems)
	if len(navItems) == 0 {
		t.Fatalf("expected navigation items")
	}

	targetNav := navItems[0]
	recUpdateNav := doRequest(h, "PUT", "/api/v1/admin/cms/navigation/"+targetNav.ID, handlers.UpdateCmsNavigationItemRequest{
		Label:        "My Secure Vaults",
		DisplayOrder: targetNav.DisplayOrder,
		IsEnabled:    true,
	}, cookie)
	if recUpdateNav.Code != http.StatusOK {
		t.Fatalf("expected 200 for update navigation item, got %d", recUpdateNav.Code)
	}

	// 5. Theme Settings
	recTheme := doRequest(h, "GET", "/api/v1/admin/cms/theme", nil, cookie)
	if recTheme.Code != http.StatusOK {
		t.Fatalf("expected 200 for cms theme, got %d", recTheme.Code)
	}

	recUpdateTheme := doRequest(h, "PUT", "/api/v1/admin/cms/theme", handlers.UpdateCmsThemeRequest{
		ThemePreset:  "emerald",
		PrimaryColor: "#10b981",
		BorderRadius: "0.75rem",
		Density:      "compact",
	}, cookie)
	if recUpdateTheme.Code != http.StatusOK {
		t.Fatalf("expected 200 for update theme, got %d: %s", recUpdateTheme.Code, recUpdateTheme.Body.String())
	}

	// 6. Revisions & Restore
	recRev := doRequest(h, "GET", "/api/v1/admin/cms/revisions", nil, cookie)
	if recRev.Code != http.StatusOK {
		t.Fatalf("expected 200 for revisions list, got %d", recRev.Code)
	}
	var revs []domain.CmsRevision
	_ = json.Unmarshal(recRev.Body.Bytes(), &revs)
	if len(revs) < 2 {
		t.Fatalf("expected at least 2 revisions after changes, got %d", len(revs))
	}

	// Restore revision 1
	recRestore := doRequest(h, "POST", "/api/v1/admin/cms/revisions/1/restore", nil, cookie)
	if recRestore.Code != http.StatusOK {
		t.Fatalf("expected 200 for restore revision, got %d: %s", recRestore.Code, recRestore.Body.String())
	}
	var restoredConfig domain.AppConfiguration
	_ = json.Unmarshal(recRestore.Body.Bytes(), &restoredConfig)
	if restoredConfig.Theme.ThemePreset != "default" {
		t.Errorf("expected restored theme to be default, got %s", restoredConfig.Theme.ThemePreset)
	}

	// 7. Delete Section
	recDelSec := doRequest(h, "DELETE", "/api/v1/admin/cms/sections/"+createdSec.ID, nil, cookie)
	if recDelSec.Code != http.StatusNoContent {
		t.Fatalf("expected 204 for delete section, got %d", recDelSec.Code)
	}
}

func TestCmsTenantIsolation(t *testing.T) {
	h, _ := setupTestServer()

	// Account A
	pubA := base64.RawURLEncoding.EncodeToString([]byte("pubkey-acc-a-32bytes-for-cms-iso!"))
	recA := doRequest(h, "POST", "/api/v1/auth/register", handlers.RegisterRequest{
		Email:              "usera-cms@example.com",
		DeviceLabel:        "UserA Device",
		Platform:           "Web",
		Browser:            "Chrome",
		PublicKeyAlgorithm: "Ed25519",
		PublicKey:          pubA,
		CredentialType:     "external",
		CredentialID:       "cred-a-cms",
	}, nil)
	cookieA := recA.Result().Cookies()[0]

	// Account B
	pubB := base64.RawURLEncoding.EncodeToString([]byte("pubkey-acc-b-32bytes-for-cms-iso!"))
	recB := doRequest(h, "POST", "/api/v1/auth/register", handlers.RegisterRequest{
		Email:              "userb-cms@example.com",
		DeviceLabel:        "UserB Device",
		Platform:           "Web",
		Browser:            "Firefox",
		PublicKeyAlgorithm: "Ed25519",
		PublicKey:          pubB,
		CredentialType:     "external",
		CredentialID:       "cred-b-cms",
	}, nil)
	cookieB := recB.Result().Cookies()[0]

	// Account A creates a custom section
	recCreateA := doRequest(h, "POST", "/api/v1/admin/cms/sections", handlers.CreateCmsSectionRequest{
		ScreenKey:      "dashboard",
		SectionType:    "custom_info",
		Title:          "User A Confidential Notice",
		ContentPayload: map[string]any{"text": "Only for user A"},
		StyleConfig:    map[string]any{},
		DisplayOrder:   1,
		IsEnabled:      true,
	}, cookieA)
	if recCreateA.Code != http.StatusCreated {
		t.Fatalf("expected 201 for Account A section creation, got %d", recCreateA.Code)
	}
	var secA domain.CmsSection
	_ = json.Unmarshal(recCreateA.Body.Bytes(), &secA)

	// Account B gets app configuration -> must not see User A's section
	recConfigB := doRequest(h, "GET", "/api/v1/app/configuration", nil, cookieB)
	var configB domain.AppConfiguration
	_ = json.Unmarshal(recConfigB.Body.Bytes(), &configB)
	for _, sec := range configB.Sections {
		if sec.ID == secA.ID || sec.Title == "User A Confidential Notice" {
			t.Fatalf("cross-tenant data leak: Account B sees Account A's section!")
		}
	}

	// Account B attempts to update Account A's section -> 404
	recCrossUpdate := doRequest(h, "PUT", "/api/v1/admin/cms/sections/"+secA.ID, handlers.UpdateCmsSectionRequest{
		Title:          "Malicious Overwrite",
		ContentPayload: map[string]any{},
		StyleConfig:    map[string]any{},
		DisplayOrder:   1,
		IsEnabled:      true,
	}, cookieB)
	if recCrossUpdate.Code != http.StatusNotFound {
		t.Errorf("expected 404 for cross-tenant section update, got %d", recCrossUpdate.Code)
	}

	// Account B attempts to delete Account A's section -> 404
	recCrossDelete := doRequest(h, "DELETE", "/api/v1/admin/cms/sections/"+secA.ID, nil, cookieB)
	if recCrossDelete.Code != http.StatusNotFound {
		t.Errorf("expected 404 for cross-tenant section delete, got %d", recCrossDelete.Code)
	}
}

func registerAndGetCookie(t *testing.T, h http.Handler, email string) (*http.Cookie, string) {
	t.Helper()
	pub := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{42}, 32))
	regReq := handlers.RegisterRequest{
		Email:              email,
		DeviceLabel:        "Test Device",
		Platform:           "Web",
		Browser:            "Chrome",
		PublicKeyAlgorithm: "Ed25519",
		PublicKey:          pub,
		CredentialType:     "external",
		CredentialID:       "cred-" + email,
	}
	rec := doRequest(h, "POST", "/api/v1/auth/register", regReq, nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("failed to register account %s: %d", email, rec.Code)
	}
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatalf("no cookie returned for registration")
	}
	return cookies[0], pub
}

func TestSyncEngineAndConflictResolution(t *testing.T) {
	h, _ := setupTestServer()

	cookie, _ := registerAndGetCookie(t, h, "sync-user@example.com")

	// Create Vault
	salt := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, 16))
	wrapped := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{2}, 40))
	vaultReq := handlers.CreateVaultRequest{
		ProtocolVersion: 1,
		Envelopes: []handlers.VaultKeyEnvelopeDTO{
			{
				EnvelopeType:     "password",
				ProtocolVersion:  1,
				KeyWrapAlgorithm: "AES-256-KW",
				KDFAlgorithm:     "argon2id13",
				KDFParameters: map[string]int64{
					"parallelism": 4,
					"memoryKiB":   65536,
					"iterations":  3,
					"version":     19,
				},
				Salt:       salt,
				WrappedVEK: wrapped,
			},
			{
				EnvelopeType:     "recovery",
				ProtocolVersion:  1,
				KeyWrapAlgorithm: "AES-256-KW",
				KDFAlgorithm:     "hkdf-sha256",
				Salt:             salt,
				WrappedVEK:       wrapped,
			},
		},
	}
	recVault := doRequest(h, "POST", "/api/v1/vaults", vaultReq, cookie)
	if recVault.Code != http.StatusCreated {
		t.Fatalf("expected 201 for vault creation, got %d", recVault.Code)
	}
	var createdVault domain.Vault
	_ = json.Unmarshal(recVault.Body.Bytes(), &createdVault)
	vaultID := createdVault.ID

	nonce := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{3}, 12))
	wrappedDek := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{4}, 40))
	ct1 := base64.RawURLEncoding.EncodeToString([]byte("encrypted-payload-revision-1"))

	// 1. Submit initial upsert (baseRevision: 0)
	upsertReq1 := handlers.SyncOperationDTO{
		OperationID:     "op-0001",
		ObjectID:        "obj-0001",
		Kind:            "upsert",
		BaseRevision:    0,
		ClientCreatedAt: time.Now().UTC().Format(time.RFC3339),
		Envelope: &handlers.EncryptedObjectEnvelopeDTO{
			ProtocolVersion:  1,
			Algorithm:        "AES-256-GCM",
			KeyWrapAlgorithm: "AES-256-KW",
			PayloadVersion:   1,
			Purpose:          "vault-record",
			Nonce:            nonce,
			WrappedDEK:       wrappedDek,
			Ciphertext:       ct1,
		},
	}
	recOp1 := doRequest(h, "POST", "/api/v1/vaults/"+vaultID+"/sync/operations", upsertReq1, cookie)
	if recOp1.Code != http.StatusCreated {
		t.Fatalf("expected 201 for upsert op1, got %d: %s", recOp1.Code, recOp1.Body.String())
	}
	var res1 domain.SyncOperationResult
	_ = json.Unmarshal(recOp1.Body.Bytes(), &res1)
	if !res1.Accepted || res1.CurrentRevision != 1 || res1.SequenceID != "1" {
		t.Fatalf("unexpected res1: %+v", res1)
	}

	// 2. Idempotency replay with same operationID -> must return 201 with identical result
	recReplay := doRequest(h, "POST", "/api/v1/vaults/"+vaultID+"/sync/operations", upsertReq1, cookie)
	if recReplay.Code != http.StatusCreated {
		t.Fatalf("expected 201 for idempotent replay, got %d", recReplay.Code)
	}
	var resReplay domain.SyncOperationResult
	_ = json.Unmarshal(recReplay.Body.Bytes(), &resReplay)
	if resReplay.CurrentRevision != 1 || resReplay.SequenceID != "1" {
		t.Fatalf("unexpected resReplay: %+v", resReplay)
	}

	// 3. Conflict detection: submitting with baseRevision: 0 when object is already at revision 1 -> 409 Conflict
	conflictReq := handlers.SyncOperationDTO{
		OperationID:     "op-0002",
		ObjectID:        "obj-0001",
		Kind:            "upsert",
		BaseRevision:    0, // Mismatch!
		ClientCreatedAt: time.Now().UTC().Format(time.RFC3339),
		Envelope: &handlers.EncryptedObjectEnvelopeDTO{
			ProtocolVersion:  1,
			Algorithm:        "AES-256-GCM",
			KeyWrapAlgorithm: "AES-256-KW",
			PayloadVersion:   1,
			Purpose:          "vault-record",
			Nonce:            nonce,
			WrappedDEK:       wrappedDek,
			Ciphertext:       ct1,
		},
	}
	recConflict := doRequest(h, "POST", "/api/v1/vaults/"+vaultID+"/sync/operations", conflictReq, cookie)
	if recConflict.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict for stale baseRevision, got %d: %s", recConflict.Code, recConflict.Body.String())
	}
	var prob handlers.Problem
	_ = json.Unmarshal(recConflict.Body.Bytes(), &prob)
	if prob.Error == nil || prob.Error.Details == nil || *prob.Error.Details.CurrentRevision != 1 {
		t.Fatalf("expected conflict details in problem response, got: %+v", prob)
	}

	// 4. Progress revision: submit with baseRevision: 1
	ct2 := base64.RawURLEncoding.EncodeToString([]byte("encrypted-payload-revision-2"))
	upsertReq2 := handlers.SyncOperationDTO{
		OperationID:     "op-0003",
		ObjectID:        "obj-0001",
		Kind:            "upsert",
		BaseRevision:    1,
		ClientCreatedAt: time.Now().UTC().Format(time.RFC3339),
		Envelope: &handlers.EncryptedObjectEnvelopeDTO{
			ProtocolVersion:  1,
			Algorithm:        "AES-256-GCM",
			KeyWrapAlgorithm: "AES-256-KW",
			PayloadVersion:   1,
			Purpose:          "vault-record",
			Nonce:            nonce,
			WrappedDEK:       wrappedDek,
			Ciphertext:       ct2,
		},
	}
	recOp2 := doRequest(h, "POST", "/api/v1/vaults/"+vaultID+"/sync/operations", upsertReq2, cookie)
	if recOp2.Code != http.StatusCreated {
		t.Fatalf("expected 201 for upsert op2, got %d", recOp2.Code)
	}
	var res2 domain.SyncOperationResult
	_ = json.Unmarshal(recOp2.Body.Bytes(), &res2)
	if res2.CurrentRevision != 2 || res2.SequenceID != "2" {
		t.Fatalf("expected rev 2 and seq 2, got: %+v", res2)
	}

	// 5. Get encrypted object revision
	recGetObj := doRequest(h, "GET", "/api/v1/vaults/"+vaultID+"/objects/obj-0001", nil, cookie)
	if recGetObj.Code != http.StatusOK {
		t.Fatalf("expected 200 for get object, got %d", recGetObj.Code)
	}
	var envDTO handlers.EncryptedObjectEnvelopeDTO
	_ = json.Unmarshal(recGetObj.Body.Bytes(), &envDTO)
	if envDTO.Ciphertext != ct2 {
		t.Fatalf("expected latest ciphertext ct2, got: %s", envDTO.Ciphertext)
	}

	// Get historical revision 1
	recGetRev1 := doRequest(h, "GET", "/api/v1/vaults/"+vaultID+"/objects/obj-0001?revision=1", nil, cookie)
	if recGetRev1.Code != http.StatusOK {
		t.Fatalf("expected 200 for historical revision 1, got %d", recGetRev1.Code)
	}
	var envRev1 handlers.EncryptedObjectEnvelopeDTO
	_ = json.Unmarshal(recGetRev1.Body.Bytes(), &envRev1)
	if envRev1.Ciphertext != ct1 {
		t.Fatalf("expected historical ciphertext ct1, got: %s", envRev1.Ciphertext)
	}

	// 6. Optimistic direct PUT object
	reqPut := handlers.EncryptedObjectEnvelopeDTO{
		ProtocolVersion:  1,
		Algorithm:        "AES-256-GCM",
		KeyWrapAlgorithm: "AES-256-KW",
		PayloadVersion:   1,
		Purpose:          "vault-record",
		Nonce:            nonce,
		WrappedDEK:       wrappedDek,
		Ciphertext:       ct1,
	}
	reqPutHTTP := httptest.NewRequest("PUT", "/api/v1/vaults/"+vaultID+"/objects/obj-0002", bytes.NewBufferString(`{
		"protocolVersion": 1,
		"algorithm": "AES-256-GCM",
		"keyWrapAlgorithm": "AES-256-KW",
		"payloadVersion": 1,
		"purpose": "vault-record",
		"nonce": "`+nonce+`",
		"wrappedDek": "`+wrappedDek+`",
		"ciphertext": "`+ct1+`"
	}`))
	reqPutHTTP.Header.Set("Content-Type", "application/json")
	reqPutHTTP.Header.Set("If-Match-Revision", "0")
	reqPutHTTP.AddCookie(cookie)
	recPut := httptest.NewRecorder()
	h.ServeHTTP(recPut, reqPutHTTP)
	if recPut.Code != http.StatusOK {
		t.Fatalf("expected 200 for direct PUT object, got %d: %s", recPut.Code, recPut.Body.String())
	}

	// 7. Delete tombstone operation
	deleteReq := handlers.SyncOperationDTO{
		OperationID:     "op-0004",
		ObjectID:        "obj-0001",
		Kind:            "delete",
		BaseRevision:    2,
		ClientCreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	recDel := doRequest(h, "POST", "/api/v1/vaults/"+vaultID+"/sync/operations", deleteReq, cookie)
	if recDel.Code != http.StatusCreated {
		t.Fatalf("expected 201 for delete tombstone, got %d", recDel.Code)
	}
	var resDel domain.SyncOperationResult
	_ = json.Unmarshal(recDel.Body.Bytes(), &resDel)
	if resDel.CurrentRevision != 3 {
		t.Fatalf("expected rev 3 for tombstone, got %d", resDel.CurrentRevision)
	}

	// Deleted object lookup returns 404
	recGetDeleted := doRequest(h, "GET", "/api/v1/vaults/"+vaultID+"/objects/obj-0001", nil, cookie)
	if recGetDeleted.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for deleted object, got %d", recGetDeleted.Code)
	}

	// 8. List sync events with cursor pagination
	recSyncPage1 := doRequest(h, "GET", "/api/v1/vaults/"+vaultID+"/sync?after=0&limit=2", nil, cookie)
	if recSyncPage1.Code != http.StatusOK {
		t.Fatalf("expected 200 for sync page 1, got %d", recSyncPage1.Code)
	}
	var page1 handlers.SyncPageDTO
	_ = json.Unmarshal(recSyncPage1.Body.Bytes(), &page1)
	if len(page1.Items) != 2 || !page1.HasMore || page1.NextCursor != "2" {
		t.Fatalf("unexpected sync page 1: %+v", page1)
	}

	recSyncPage2 := doRequest(h, "GET", "/api/v1/vaults/"+vaultID+"/sync?after=2&limit=10", nil, cookie)
	if recSyncPage2.Code != http.StatusOK {
		t.Fatalf("expected 200 for sync page 2, got %d", recSyncPage2.Code)
	}
	var page2 handlers.SyncPageDTO
	_ = json.Unmarshal(recSyncPage2.Body.Bytes(), &page2)
	if len(page2.Items) != 2 || page2.HasMore {
		t.Fatalf("unexpected sync page 2: %+v", page2)
	}
	_ = reqPut
}

func TestSyncTenantIsolation(t *testing.T) {
	h, _ := setupTestServer()

	cookieA, _ := registerAndGetCookie(t, h, "user-a@example.com")
	cookieB, _ := registerAndGetCookie(t, h, "user-b@example.com")

	salt := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, 16))
	wrapped := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{2}, 40))
	recVaultA := doRequest(h, "POST", "/api/v1/vaults", handlers.CreateVaultRequest{
		ProtocolVersion: 1,
		Envelopes: []handlers.VaultKeyEnvelopeDTO{
			{
				EnvelopeType:     "password",
				ProtocolVersion:  1,
				KeyWrapAlgorithm: "AES-256-KW",
				KDFAlgorithm:     "argon2id13",
				KDFParameters: map[string]int64{
					"parallelism": 4,
					"memoryKiB":   65536,
					"iterations":  3,
					"version":     19,
				},
				Salt:       salt,
				WrappedVEK: wrapped,
			},
			{
				EnvelopeType:     "recovery",
				ProtocolVersion:  1,
				KeyWrapAlgorithm: "AES-256-KW",
				KDFAlgorithm:     "hkdf-sha256",
				Salt:             salt,
				WrappedVEK:       wrapped,
			},
		},
	}, cookieA)
	var vaultA domain.Vault
	_ = json.Unmarshal(recVaultA.Body.Bytes(), &vaultA)

	// User B attempts to access User A's sync events -> 404
	recSyncB := doRequest(h, "GET", "/api/v1/vaults/"+vaultA.ID+"/sync", nil, cookieB)
	if recSyncB.Code != http.StatusNotFound {
		t.Errorf("expected 404 for cross-tenant sync events, got %d", recSyncB.Code)
	}

	// User B attempts to submit sync operation on User A's vault -> 404
	recSubmitB := doRequest(h, "POST", "/api/v1/vaults/"+vaultA.ID+"/sync/operations", handlers.SyncOperationDTO{
		OperationID:     "op-b-malicious",
		ObjectID:        "obj-b-malicious",
		Kind:            "delete",
		BaseRevision:    0,
		ClientCreatedAt: time.Now().UTC().Format(time.RFC3339),
	}, cookieB)
	if recSubmitB.Code != http.StatusNotFound {
		t.Errorf("expected 404 for cross-tenant sync submission, got %d", recSubmitB.Code)
	}

	// User B attempts to fetch object from User A's vault -> 404
	recGetObjB := doRequest(h, "GET", "/api/v1/vaults/"+vaultA.ID+"/objects/any-obj", nil, cookieB)
	if recGetObjB.Code != http.StatusNotFound {
		t.Errorf("expected 404 for cross-tenant get object, got %d", recGetObjB.Code)
	}
}

func TestAttachmentLifecycle(t *testing.T) {
	h, _ := setupTestServer()

	cookie, _ := registerAndGetCookie(t, h, "att-owner@example.com")

	salt := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, 16))
	wrapped := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{2}, 40))

	recVault := doRequest(h, "POST", "/api/v1/vaults", handlers.CreateVaultRequest{
		ProtocolVersion: 1,
		Envelopes: []handlers.VaultKeyEnvelopeDTO{
			{
				EnvelopeType:     "password",
				ProtocolVersion:  1,
				KeyWrapAlgorithm: "AES-256-KW",
				KDFAlgorithm:     "argon2id13",
				KDFParameters:    map[string]int64{"parallelism": 4, "memoryKiB": 65536, "iterations": 3, "version": 19},
				Salt:             salt,
				WrappedVEK:       wrapped,
			},
			{
				EnvelopeType:     "recovery",
				ProtocolVersion:  1,
				KeyWrapAlgorithm: "AES-256-KW",
				KDFAlgorithm:     "hkdf-sha256",
				KDFParameters:    map[string]int64{},
				Salt:             salt,
				WrappedVEK:       wrapped,
			},
		},
	}, cookie)
	if recVault.Code != http.StatusCreated {
		t.Fatalf("expected 201 for vault creation, got %d: %s", recVault.Code, recVault.Body.String())
	}
	var vault domain.Vault
	_ = json.Unmarshal(recVault.Body.Bytes(), &vault)

	// 1. Create upload session
	fakePayload := []byte("confidential-encrypted-stream-data")
	hash := sha256.Sum256(fakePayload)
	hashB64 := base64.RawURLEncoding.EncodeToString(hash[:])

	recUploadSess := doRequest(h, "POST", "/api/v1/vaults/"+vault.ID+"/attachments/upload-session", handlers.AttachmentUploadSessionRequestDTO{
		CiphertextSize:   int64(len(fakePayload)),
		CiphertextDigest: hashB64,
	}, cookie)
	if recUploadSess.Code != http.StatusCreated {
		t.Fatalf("expected 201 for upload session, got %d: %s", recUploadSess.Code, recUploadSess.Body.String())
	}
	var uploadSess handlers.AttachmentUploadSessionResponseDTO
	_ = json.Unmarshal(recUploadSess.Body.Bytes(), &uploadSess)

	if uploadSess.AttachmentID == "" || uploadSess.UploadURL == "" {
		t.Fatalf("invalid upload session response: %+v", uploadSess)
	}

	// 2. Upload raw ciphertext directly
	reqUpload, _ := http.NewRequest("PUT", uploadSess.UploadURL, bytes.NewReader(fakePayload))
	reqUpload.AddCookie(cookie)
	reqUpload.Header.Set("Content-Type", "application/octet-stream")
	recUpload := httptest.NewRecorder()
	h.ServeHTTP(recUpload, reqUpload)
	if recUpload.Code != http.StatusNoContent {
		t.Fatalf("expected 204 for raw ciphertext upload, got %d: %s", recUpload.Code, recUpload.Body.String())
	}

	// 3. Complete attachment
	recComplete := doRequest(h, "POST", "/api/v1/vaults/"+vault.ID+"/attachments/"+uploadSess.AttachmentID+"/complete", handlers.AttachmentCompleteRequestDTO{
		CiphertextSize:   int64(len(fakePayload)),
		CiphertextDigest: hashB64,
	}, cookie)
	if recComplete.Code != http.StatusOK {
		t.Fatalf("expected 200 for complete, got %d: %s", recComplete.Code, recComplete.Body.String())
	}
	var attMeta handlers.AttachmentMetadataDTO
	_ = json.Unmarshal(recComplete.Body.Bytes(), &attMeta)
	if attMeta.CiphertextSize != int64(len(fakePayload)) || attMeta.CiphertextDigest != hashB64 {
		t.Fatalf("unexpected attachment metadata: %+v", attMeta)
	}

	// 4. List attachments
	recList := doRequest(h, "GET", "/api/v1/vaults/"+vault.ID+"/attachments", nil, cookie)
	if recList.Code != http.StatusOK {
		t.Fatalf("expected 200 for list attachments, got %d", recList.Code)
	}
	var listResp handlers.AttachmentListDTO
	_ = json.Unmarshal(recList.Body.Bytes(), &listResp)
	if len(listResp.Items) != 1 || listResp.Items[0].ID != uploadSess.AttachmentID {
		t.Fatalf("expected 1 attachment in list, got %+v", listResp)
	}

	// 5. Create download session
	recDownloadSess := doRequest(h, "GET", "/api/v1/vaults/"+vault.ID+"/attachments/"+uploadSess.AttachmentID+"/download-session", nil, cookie)
	if recDownloadSess.Code != http.StatusOK {
		t.Fatalf("expected 200 for download session, got %d", recDownloadSess.Code)
	}
	var downloadSess handlers.AttachmentDownloadSessionResponseDTO
	_ = json.Unmarshal(recDownloadSess.Body.Bytes(), &downloadSess)
	if downloadSess.DownloadURL == "" || downloadSess.CiphertextDigest != hashB64 {
		t.Fatalf("invalid download session: %+v", downloadSess)
	}

	// 6. Download ciphertext
	reqDownload, _ := http.NewRequest("GET", downloadSess.DownloadURL, nil)
	reqDownload.AddCookie(cookie)
	recDownload := httptest.NewRecorder()
	h.ServeHTTP(recDownload, reqDownload)
	if recDownload.Code != http.StatusOK {
		t.Fatalf("expected 200 for download content, got %d", recDownload.Code)
	}
	if !bytes.Equal(recDownload.Body.Bytes(), fakePayload) {
		t.Fatalf("downloaded bytes mismatch")
	}

	// 7. Delete attachment
	recDelete := doRequest(h, "DELETE", "/api/v1/vaults/"+vault.ID+"/attachments/"+uploadSess.AttachmentID, nil, cookie)
	if recDelete.Code != http.StatusNoContent {
		t.Fatalf("expected 204 for delete attachment, got %d", recDelete.Code)
	}

	// 8. Subsequent GET returns 404
	recAfterDelete := doRequest(h, "GET", "/api/v1/vaults/"+vault.ID+"/attachments/"+uploadSess.AttachmentID, nil, cookie)
	if recAfterDelete.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after delete, got %d", recAfterDelete.Code)
	}
}

func TestAttachmentTenantIsolation(t *testing.T) {
	h, _ := setupTestServer()

	cookieA, _ := registerAndGetCookie(t, h, "att-tenant-a@example.com")
	cookieB, _ := registerAndGetCookie(t, h, "att-tenant-b@example.com")

	salt := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, 16))
	wrapped := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{2}, 40))

	recVaultA := doRequest(h, "POST", "/api/v1/vaults", handlers.CreateVaultRequest{
		ProtocolVersion: 1,
		Envelopes: []handlers.VaultKeyEnvelopeDTO{
			{
				EnvelopeType:     "password",
				ProtocolVersion:  1,
				KeyWrapAlgorithm: "AES-256-KW",
				KDFAlgorithm:     "argon2id13",
				KDFParameters:    map[string]int64{"parallelism": 4, "memoryKiB": 65536, "iterations": 3, "version": 19},
				Salt:             salt,
				WrappedVEK:       wrapped,
			},
			{
				EnvelopeType:     "recovery",
				ProtocolVersion:  1,
				KeyWrapAlgorithm: "AES-256-KW",
				KDFAlgorithm:     "hkdf-sha256",
				KDFParameters:    map[string]int64{},
				Salt:             salt,
				WrappedVEK:       wrapped,
			},
		},
	}, cookieA)
	var vaultA domain.Vault
	_ = json.Unmarshal(recVaultA.Body.Bytes(), &vaultA)

	fakePayload := []byte("secret-tenant-a")
	hash := sha256.Sum256(fakePayload)
	hashB64 := base64.RawURLEncoding.EncodeToString(hash[:])

	recUploadSess := doRequest(h, "POST", "/api/v1/vaults/"+vaultA.ID+"/attachments/upload-session", handlers.AttachmentUploadSessionRequestDTO{
		CiphertextSize:   int64(len(fakePayload)),
		CiphertextDigest: hashB64,
	}, cookieA)
	var uploadSess handlers.AttachmentUploadSessionResponseDTO
	_ = json.Unmarshal(recUploadSess.Body.Bytes(), &uploadSess)

	// User B attempts to list attachments on User A's vault -> 404
	recListB := doRequest(h, "GET", "/api/v1/vaults/"+vaultA.ID+"/attachments", nil, cookieB)
	if recListB.Code != http.StatusNotFound {
		t.Errorf("expected 404 for cross-tenant attachment list, got %d", recListB.Code)
	}

	// User B attempts to access User A's upload session / attachment -> 404
	recGetAttB := doRequest(h, "GET", "/api/v1/vaults/"+vaultA.ID+"/attachments/"+uploadSess.AttachmentID, nil, cookieB)
	if recGetAttB.Code != http.StatusNotFound {
		t.Errorf("expected 404 for cross-tenant get attachment, got %d", recGetAttB.Code)
	}

	// User B attempts to delete User A's attachment -> 404
	recDelAttB := doRequest(h, "DELETE", "/api/v1/vaults/"+vaultA.ID+"/attachments/"+uploadSess.AttachmentID, nil, cookieB)
	if recDelAttB.Code != http.StatusNotFound {
		t.Errorf("expected 404 for cross-tenant delete attachment, got %d", recDelAttB.Code)
	}
}
