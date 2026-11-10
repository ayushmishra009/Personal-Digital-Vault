package database

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/personal-digital-vault/api/internal/domain"
)

type MockRepository struct {
	mu             sync.RWMutex
	accounts       map[string]*domain.Account
	byEmail        map[string]string // email -> accountID
	credentials    map[string]*domain.AuthCredential // accountID:credentialID -> cred
	devices        map[string]*domain.Device // accountID:deviceID -> dev
	enrollments    map[string]*domain.DeviceEnrollment // accountID:enrollmentID -> enrollment
	sessions       map[string]*domain.Session // hex(tokenHash) -> session
	vaults         map[string]*domain.Vault // accountID:vaultID -> vault
	vaultEnvelopes map[string]*domain.VaultKeyEnvelope // accountID:vaultID:type -> env
	seq            int
}

func NewMockRepository() *MockRepository {
	return &MockRepository{
		accounts:       make(map[string]*domain.Account),
		byEmail:        make(map[string]string),
		credentials:    make(map[string]*domain.AuthCredential),
		devices:        make(map[string]*domain.Device),
		enrollments:    make(map[string]*domain.DeviceEnrollment),
		sessions:       make(map[string]*domain.Session),
		vaults:         make(map[string]*domain.Vault),
		vaultEnvelopes: make(map[string]*domain.VaultKeyEnvelope),
	}
}

func (m *MockRepository) nextID(prefix string) string {
	m.seq++
	return fmt.Sprintf("%s-%04d", prefix, m.seq)
}

func (m *MockRepository) CreateAccountWithDeviceAndCredential(
	ctx context.Context,
	account *domain.Account,
	device *domain.Device,
	cred *domain.AuthCredential,
) (*domain.Account, *domain.Device, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	emailNorm := strings.ToLower(account.Email)
	if _, exists := m.byEmail[emailNorm]; exists {
		return nil, nil, ErrConflict
	}

	accID := m.nextID("acc")
	now := time.Now().UTC()
	createdAcc := &domain.Account{
		ID:        accID,
		Email:     emailNorm,
		Status:    "active",
		CreatedAt: now,
	}
	m.accounts[accID] = createdAcc
	m.byEmail[emailNorm] = accID

	devID := m.nextID("dev")
	createdDev := &domain.Device{
		ID:                 devID,
		AccountID:          accID,
		PublicKeyAlgorithm: device.PublicKeyAlgorithm,
		PublicKey:          device.PublicKey,
		Label:              device.Label,
		Platform:           device.Platform,
		Browser:            device.Browser,
		Status:             "active",
		CreatedAt:          now,
	}
	m.devices[accID+":"+devID] = createdDev

	credID := m.nextID("cred")
	createdCred := &domain.AuthCredential{
		ID:              credID,
		AccountID:       accID,
		CredentialType:  cred.CredentialType,
		CredentialID:    cred.CredentialID,
		PublicKey:       cred.PublicKey,
		ExternalSubject: cred.ExternalSubject,
		CreatedAt:       now,
	}
	m.credentials[accID+":"+cred.CredentialID] = createdCred

	return createdAcc, createdDev, nil
}

func (m *MockRepository) GetAccountByEmail(ctx context.Context, email string) (*domain.Account, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	id, ok := m.byEmail[strings.ToLower(email)]
	if !ok {
		return nil, ErrNotFound
	}
	acc := m.accounts[id]
	return acc, nil
}

func (m *MockRepository) GetAccountByID(ctx context.Context, accountID string) (*domain.Account, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	acc, ok := m.accounts[accountID]
	if !ok {
		return nil, ErrNotFound
	}
	return acc, nil
}

func (m *MockRepository) GetAuthCredential(ctx context.Context, accountID string, credentialID string) (*domain.AuthCredential, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	cred, ok := m.credentials[accountID+":"+credentialID]
	if !ok {
		return nil, ErrNotFound
	}
	return cred, nil
}

func (m *MockRepository) GetDeviceByID(ctx context.Context, accountID string, deviceID string) (*domain.Device, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	dev, ok := m.devices[accountID+":"+deviceID]
	if !ok {
		return nil, ErrNotFound
	}
	return dev, nil
}

func (m *MockRepository) ListDevices(ctx context.Context, accountID string) ([]domain.Device, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []domain.Device
	for k, dev := range m.devices {
		if strings.HasPrefix(k, accountID+":") {
			list = append(list, *dev)
		}
	}
	return list, nil
}

func (m *MockRepository) CreatePendingDeviceAndEnrollment(
	ctx context.Context,
	device *domain.Device,
	challengeHash []byte,
	expiresAt time.Time,
) (*domain.Device, *domain.DeviceEnrollment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	devID := m.nextID("dev")
	createdDev := &domain.Device{
		ID:                 devID,
		AccountID:          device.AccountID,
		PublicKeyAlgorithm: device.PublicKeyAlgorithm,
		PublicKey:          device.PublicKey,
		Label:              device.Label,
		Platform:           device.Platform,
		Browser:            device.Browser,
		Status:             "pending",
		CreatedAt:          now,
	}
	m.devices[device.AccountID+":"+devID] = createdDev

	enrollID := m.nextID("enr")
	createdEnrollment := &domain.DeviceEnrollment{
		ID:            enrollID,
		AccountID:     device.AccountID,
		DeviceID:      devID,
		ChallengeHash: challengeHash,
		ExpiresAt:     expiresAt,
		Status:        "pending",
		CreatedAt:     now,
	}
	m.enrollments[device.AccountID+":"+enrollID] = createdEnrollment

	return createdDev, createdEnrollment, nil
}

func (m *MockRepository) GetDeviceEnrollment(
	ctx context.Context,
	accountID string,
	enrollmentID string,
) (*domain.DeviceEnrollment, *domain.Device, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	enr, ok := m.enrollments[accountID+":"+enrollmentID]
	if !ok {
		return nil, nil, ErrNotFound
	}
	dev, ok := m.devices[accountID+":"+enr.DeviceID]
	if !ok {
		return nil, nil, ErrNotFound
	}
	return enr, dev, nil
}

func (m *MockRepository) ApproveDeviceEnrollment(
	ctx context.Context,
	accountID string,
	enrollmentID string,
	approverDeviceID string,
	signature []byte,
) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	enr, ok := m.enrollments[accountID+":"+enrollmentID]
	if !ok {
		return ErrNotFound
	}
	if enr.Status != "pending" {
		return ErrConflict
	}
	if time.Now().After(enr.ExpiresAt) {
		enr.Status = "expired"
		return ErrConflict
	}

	now := time.Now().UTC()
	enr.Status = "approved"
	enr.ApprovalSignature = signature
	enr.ApproverDeviceID = &approverDeviceID
	enr.ApprovedAt = &now

	if dev, ok := m.devices[accountID+":"+enr.DeviceID]; ok {
		dev.Status = "active"
	}

	return nil
}

func (m *MockRepository) RevokeDevice(ctx context.Context, accountID string, deviceID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	dev, ok := m.devices[accountID+":"+deviceID]
	if !ok {
		return ErrNotFound
	}
	if dev.Status == "revoked" {
		return nil
	}

	now := time.Now().UTC()
	dev.Status = "revoked"
	dev.RevokedAt = &now

	for k, s := range m.sessions {
		if s.AccountID == accountID && s.DeviceID == deviceID {
			delete(m.sessions, k)
		}
	}
	return nil
}

func (m *MockRepository) CreateSessionForDevice(accountID, deviceID, token string, expiresAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	hash := sha256.Sum256([]byte(token))
	now := time.Now().UTC()
	sessID := m.nextID("sess")
	s := &domain.Session{
		ID:           sessID,
		AccountID:    accountID,
		DeviceID:     deviceID,
		TokenHash:    hash[:],
		ExpiresAt:    expiresAt,
		CreatedAt:    now,
		LastActiveAt: now,
	}
	m.sessions[hex.EncodeToString(hash[:])] = s
	return nil
}

func (m *MockRepository) CreateSession(ctx context.Context, session *domain.Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	session.ID = m.nextID("sess")
	session.CreatedAt = now
	session.LastActiveAt = now

	m.sessions[hex.EncodeToString(session.TokenHash)] = session
	return nil
}

func (m *MockRepository) GetSessionByTokenHash(
	ctx context.Context,
	tokenHash []byte,
) (*domain.Session, *domain.Account, *domain.Device, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	s, ok := m.sessions[hex.EncodeToString(tokenHash)]
	if !ok {
		return nil, nil, nil, ErrUnauthorized
	}
	if time.Now().After(s.ExpiresAt) {
		return nil, nil, nil, ErrUnauthorized
	}

	acc, ok := m.accounts[s.AccountID]
	if !ok {
		return nil, nil, nil, ErrUnauthorized
	}
	dev, ok := m.devices[s.AccountID+":"+s.DeviceID]
	if !ok {
		return nil, nil, nil, ErrUnauthorized
	}

	return s, acc, dev, nil
}

func (m *MockRepository) RevokeSession(ctx context.Context, tokenHash []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := hex.EncodeToString(tokenHash)
	for k := range m.sessions {
		if k == key || bytes.Equal([]byte(k), []byte(key)) {
			delete(m.sessions, k)
		}
	}
	return nil
}

func (m *MockRepository) RevokeSessionsByDevice(ctx context.Context, accountID string, deviceID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for k, s := range m.sessions {
		if s.AccountID == accountID && s.DeviceID == deviceID {
			delete(m.sessions, k)
		}
	}
	return nil
}

func (m *MockRepository) CreateVaultWithEnvelopes(
	ctx context.Context,
	accountID string,
	protocolVersion int,
	envelopes []domain.VaultKeyEnvelope,
) (*domain.Vault, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	vaultID := m.nextID("vault")
	v := &domain.Vault{
		ID:              vaultID,
		AccountID:       accountID,
		ProtocolVersion: protocolVersion,
		Status:          "active",
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	m.vaults[accountID+":"+vaultID] = v

	for _, env := range envelopes {
		stored := env
		stored.VaultID = vaultID
		stored.AccountID = accountID
		stored.CreatedAt = now
		stored.UpdatedAt = now
		m.vaultEnvelopes[accountID+":"+vaultID+":"+env.EnvelopeType] = &stored
	}

	return v, nil
}

func (m *MockRepository) ListVaults(ctx context.Context, accountID string) ([]domain.Vault, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []domain.Vault
	for k, v := range m.vaults {
		if strings.HasPrefix(k, accountID+":") && v.Status == "active" {
			list = append(list, *v)
		}
	}
	return list, nil
}

func (m *MockRepository) GetVault(ctx context.Context, accountID string, vaultID string) (*domain.Vault, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	v, ok := m.vaults[accountID+":"+vaultID]
	if !ok || v.Status != "active" {
		return nil, ErrNotFound
	}
	return v, nil
}

func (m *MockRepository) GetVaultKeyEnvelope(
	ctx context.Context,
	accountID string,
	vaultID string,
	envelopeType string,
) (*domain.VaultKeyEnvelope, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	v, ok := m.vaults[accountID+":"+vaultID]
	if !ok || v.Status != "active" {
		return nil, ErrNotFound
	}

	env, ok := m.vaultEnvelopes[accountID+":"+vaultID+":"+envelopeType]
	if !ok {
		return nil, ErrNotFound
	}
	return env, nil
}

func (m *MockRepository) PutVaultKeyEnvelope(
	ctx context.Context,
	accountID string,
	envelope *domain.VaultKeyEnvelope,
) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	v, ok := m.vaults[accountID+":"+envelope.VaultID]
	if !ok || v.Status != "active" {
		return ErrNotFound
	}

	now := time.Now().UTC()
	stored := *envelope
	stored.AccountID = accountID
	stored.UpdatedAt = now
	if existing, exists := m.vaultEnvelopes[accountID+":"+envelope.VaultID+":"+envelope.EnvelopeType]; exists {
		stored.CreatedAt = existing.CreatedAt
	} else {
		stored.CreatedAt = now
	}
	m.vaultEnvelopes[accountID+":"+envelope.VaultID+":"+envelope.EnvelopeType] = &stored
	return nil
}

func (m *MockRepository) DeleteVault(ctx context.Context, accountID string, vaultID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	v, ok := m.vaults[accountID+":"+vaultID]
	if !ok || v.Status != "active" {
		return ErrNotFound
	}

	now := time.Now().UTC()
	v.Status = "deleted"
	v.DeletedAt = &now
	return nil
}
