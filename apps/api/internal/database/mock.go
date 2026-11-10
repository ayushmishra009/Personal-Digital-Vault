package database

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
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
	vaults         map[string]*domain.Vault            // accountID:vaultID -> vault
	vaultEnvelopes map[string]*domain.VaultKeyEnvelope // accountID:vaultID:type -> env
	cmsModules     map[string]*domain.CmsModule        // accountID:moduleKey -> module
	cmsSections    map[string]*domain.CmsSection       // accountID:sectionID -> section
	cmsNav         map[string]*domain.CmsNavigationItem // accountID:itemID -> item
	cmsThemes      map[string]*domain.CmsThemeSettings // accountID -> theme
	cmsRevisions   map[string][]*domain.CmsRevision    // accountID -> []revision
	objects        map[string]*domain.EncryptedObjectRevision // vaultID:objectID -> latest
	revisions      map[string]*domain.EncryptedObjectRevision // vaultID:objectID:rev -> revision
	syncEvents     map[string][]domain.SyncEvent       // vaultID -> []events
	syncOps        map[string]*domain.SyncOperationResult // vaultID:operationID -> result
	vaultSeq       map[string]int64                    // vaultID -> monotonic sequence
	attachments    map[string]*domain.Attachment       // attachmentID -> attachment
	attachmentBlobs map[string][]byte                  // attachmentID -> ciphertext bytes
	backups        map[string][]*domain.BackupMetadata // accountID:vaultID -> []BackupMetadata
	seq            int
}

func NewMockRepository() *MockRepository {
	return &MockRepository{
		accounts:        make(map[string]*domain.Account),
		byEmail:         make(map[string]string),
		credentials:     make(map[string]*domain.AuthCredential),
		devices:         make(map[string]*domain.Device),
		enrollments:     make(map[string]*domain.DeviceEnrollment),
		sessions:        make(map[string]*domain.Session),
		vaults:          make(map[string]*domain.Vault),
		vaultEnvelopes:  make(map[string]*domain.VaultKeyEnvelope),
		cmsModules:      make(map[string]*domain.CmsModule),
		cmsSections:     make(map[string]*domain.CmsSection),
		cmsNav:          make(map[string]*domain.CmsNavigationItem),
		cmsThemes:       make(map[string]*domain.CmsThemeSettings),
		cmsRevisions:    make(map[string][]*domain.CmsRevision),
		objects:         make(map[string]*domain.EncryptedObjectRevision),
		revisions:       make(map[string]*domain.EncryptedObjectRevision),
		syncEvents:      make(map[string][]domain.SyncEvent),
		syncOps:         make(map[string]*domain.SyncOperationResult),
		vaultSeq:        make(map[string]int64),
		attachments:     make(map[string]*domain.Attachment),
		attachmentBlobs: make(map[string][]byte),
		backups:         make(map[string][]*domain.BackupMetadata),
	}
}

func (m *MockRepository) nextUUID() string {
	m.seq++
	return fmt.Sprintf("a0000000-0000-4000-8000-%012d", m.seq)
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

func (m *MockRepository) ensureCmsSeed(accountID string) {
	if _, ok := m.cmsThemes[accountID]; ok {
		return
	}

	now := time.Now().UTC()

	// Theme
	m.cmsThemes[accountID] = &domain.CmsThemeSettings{
		AccountID:    accountID,
		ThemePreset:  "default",
		PrimaryColor: "#1c5230",
		BorderRadius: "8px",
		Density:      "comfortable",
		UpdatedAt:    now,
	}

	// Modules
	defaultModules := []struct {
		key, name, desc, icon, route string
		order                        int
	}{
		{"passwords", "Passwords", "Manage encrypted web and app credentials", "key", "/passwords", 1},
		{"notes", "Secure Notes", "Encrypted private notes and markdown documentation", "file-text", "/notes", 2},
		{"identities", "Identities", "Store identity cards, passports, and personal identifiers", "user", "/identities", 3},
		{"payments", "Payments", "Payment cards and financial organizer", "credit-card", "/payments", 4},
		{"settings", "Settings", "Account, security, and device preferences", "settings", "/settings", 5},
	}
	for _, dm := range defaultModules {
		mod := &domain.CmsModule{
			ID:           m.nextID("mod"),
			AccountID:    accountID,
			ModuleKey:    dm.key,
			DisplayName:  dm.name,
			Description:  &dm.desc,
			IconKey:      dm.icon,
			IsEnabled:    true,
			DisplayOrder: dm.order,
			RouteKey:     dm.route,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		m.cmsModules[accountID+":"+dm.key] = mod
	}

	// Navigation Items
	defaultNav := []struct {
		label, route, icon string
		order              int
	}{
		{"Dashboard", "/", "home", 1},
		{"Vaults", "/vaults", "vault", 2},
		{"Passwords", "/passwords", "key", 3},
		{"Secure Notes", "/notes", "file-text", 4},
		{"Identities", "/identities", "user", 5},
		{"Payments", "/payments", "credit-card", 6},
		{"Devices", "/devices", "smartphone", 7},
		{"Settings", "/settings", "settings", 8},
	}
	for _, dn := range defaultNav {
		navID := m.nextID("nav")
		m.cmsNav[accountID+":"+navID] = &domain.CmsNavigationItem{
			ID:           navID,
			AccountID:    accountID,
			Label:        dn.label,
			RouteKey:     dn.route,
			IconKey:      dn.icon,
			DisplayOrder: dn.order,
			IsEnabled:    true,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
	}

	// Sections for Dashboard
	defaultSections := []struct {
		screenKey, secType, title string
		order                    int
		payload                  map[string]any
	}{
		{
			"dashboard", "welcome", "Welcome to Personal Digital Vault", 1,
			map[string]any{"subtitle": "Zero-knowledge encrypted platform with independent vault lifecycle."},
		},
		{
			"dashboard", "quick_actions", "Quick Actions", 2,
			map[string]any{"actions": []any{"add_password", "new_note", "create_vault"}},
		},
		{
			"dashboard", "vault_cards", "Active Vaults", 3,
			map[string]any{"description": "Independent encrypted vaults. Keys held in volatile memory."},
		},
	}
	for _, ds := range defaultSections {
		secID := m.nextID("sec")
		m.cmsSections[accountID+":"+secID] = &domain.CmsSection{
			ID:             secID,
			AccountID:      accountID,
			ScreenKey:      ds.screenKey,
			SectionType:    ds.secType,
			Title:          ds.title,
			ContentPayload: ds.payload,
			StyleConfig:    map[string]any{"variant": "card"},
			DisplayOrder:   ds.order,
			IsEnabled:      true,
			CreatedAt:      now,
			UpdatedAt:      now,
		}
	}

	// Initial Revision #1
	m.recordCmsRevisionLocked(accountID, nil, "Initial default CMS configuration seed")
}

func (m *MockRepository) recordCmsRevisionLocked(accountID string, actorDeviceID *string, summary string) *domain.CmsRevision {
	revNum := len(m.cmsRevisions[accountID]) + 1
	revID := m.nextID("rev")
	now := time.Now().UTC()

	// Snapshot
	snapshot := map[string]any{
		"modules":    m.listModulesLocked(accountID),
		"navigation": m.listNavLocked(accountID),
		"sections":   m.listSectionsLocked(accountID, nil),
		"theme":      m.cmsThemes[accountID],
	}

	rev := &domain.CmsRevision{
		ID:             revID,
		AccountID:      accountID,
		RevisionNumber: revNum,
		ActorDeviceID:  actorDeviceID,
		ChangeSummary:  summary,
		Snapshot:       snapshot,
		CreatedAt:      now,
	}
	m.cmsRevisions[accountID] = append(m.cmsRevisions[accountID], rev)
	return rev
}

func (m *MockRepository) listModulesLocked(accountID string) []domain.CmsModule {
	var list []domain.CmsModule
	prefix := accountID + ":"
	for k, mod := range m.cmsModules {
		if strings.HasPrefix(k, prefix) {
			list = append(list, *mod)
		}
	}
	// Sort by display order
	for i := 0; i < len(list); i++ {
		for j := i + 1; j < len(list); j++ {
			if list[i].DisplayOrder > list[j].DisplayOrder {
				list[i], list[j] = list[j], list[i]
			}
		}
	}
	return list
}

func (m *MockRepository) listNavLocked(accountID string) []domain.CmsNavigationItem {
	var list []domain.CmsNavigationItem
	prefix := accountID + ":"
	for k, item := range m.cmsNav {
		if strings.HasPrefix(k, prefix) {
			list = append(list, *item)
		}
	}
	for i := 0; i < len(list); i++ {
		for j := i + 1; j < len(list); j++ {
			if list[i].DisplayOrder > list[j].DisplayOrder {
				list[i], list[j] = list[j], list[i]
			}
		}
	}
	return list
}

func (m *MockRepository) listSectionsLocked(accountID string, screenKey *string) []domain.CmsSection {
	var list []domain.CmsSection
	prefix := accountID + ":"
	for k, sec := range m.cmsSections {
		if strings.HasPrefix(k, prefix) {
			if screenKey == nil || sec.ScreenKey == *screenKey {
				list = append(list, *sec)
			}
		}
	}
	for i := 0; i < len(list); i++ {
		for j := i + 1; j < len(list); j++ {
			if list[i].DisplayOrder > list[j].DisplayOrder {
				list[i], list[j] = list[j], list[i]
			}
		}
	}
	return list
}

func (m *MockRepository) GetAppConfiguration(ctx context.Context, accountID string) (*domain.AppConfiguration, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ensureCmsSeed(accountID)

	mods := m.listModulesLocked(accountID)
	var enabledMods []domain.CmsModule
	for _, mod := range mods {
		if mod.IsEnabled {
			enabledMods = append(enabledMods, mod)
		}
	}

	nav := m.listNavLocked(accountID)
	var enabledNav []domain.CmsNavigationItem
	for _, n := range nav {
		if n.IsEnabled {
			enabledNav = append(enabledNav, n)
		}
	}

	sections := m.listSectionsLocked(accountID, nil)
	var enabledSections []domain.CmsSection
	for _, s := range sections {
		if s.IsEnabled {
			enabledSections = append(enabledSections, s)
		}
	}

	theme := *m.cmsThemes[accountID]
	revNum := len(m.cmsRevisions[accountID])

	return &domain.AppConfiguration{
		Modules:        enabledMods,
		Navigation:     enabledNav,
		Sections:       enabledSections,
		Theme:          theme,
		RevisionNumber: revNum,
	}, nil
}

func (m *MockRepository) ListCmsModules(ctx context.Context, accountID string) ([]domain.CmsModule, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ensureCmsSeed(accountID)
	return m.listModulesLocked(accountID), nil
}

func (m *MockRepository) UpdateCmsModule(
	ctx context.Context,
	accountID string,
	moduleKey string,
	displayName string,
	description *string,
	isEnabled bool,
	displayOrder int,
) (*domain.CmsModule, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ensureCmsSeed(accountID)
	mod, ok := m.cmsModules[accountID+":"+moduleKey]
	if !ok {
		return nil, ErrNotFound
	}

	mod.DisplayName = displayName
	mod.Description = description
	mod.IsEnabled = isEnabled
	mod.DisplayOrder = displayOrder
	mod.UpdatedAt = time.Now().UTC()

	m.recordCmsRevisionLocked(accountID, nil, fmt.Sprintf("Updated module '%s'", moduleKey))
	ret := *mod
	return &ret, nil
}

func (m *MockRepository) ListCmsSections(ctx context.Context, accountID string, screenKey *string) ([]domain.CmsSection, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ensureCmsSeed(accountID)
	return m.listSectionsLocked(accountID, screenKey), nil
}

func (m *MockRepository) CreateCmsSection(ctx context.Context, section *domain.CmsSection) (*domain.CmsSection, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ensureCmsSeed(section.AccountID)
	now := time.Now().UTC()
	secID := m.nextID("sec")

	stored := *section
	stored.ID = secID
	stored.CreatedAt = now
	stored.UpdatedAt = now
	if stored.ContentPayload == nil {
		stored.ContentPayload = make(map[string]any)
	}
	if stored.StyleConfig == nil {
		stored.StyleConfig = make(map[string]any)
	}

	m.cmsSections[section.AccountID+":"+secID] = &stored
	m.recordCmsRevisionLocked(section.AccountID, nil, fmt.Sprintf("Created section '%s'", stored.Title))
	ret := stored
	return &ret, nil
}

func (m *MockRepository) UpdateCmsSection(
	ctx context.Context,
	accountID string,
	sectionID string,
	title string,
	contentPayload map[string]any,
	styleConfig map[string]any,
	displayOrder int,
	isEnabled bool,
) (*domain.CmsSection, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ensureCmsSeed(accountID)
	sec, ok := m.cmsSections[accountID+":"+sectionID]
	if !ok {
		return nil, ErrNotFound
	}

	sec.Title = title
	if contentPayload != nil {
		sec.ContentPayload = contentPayload
	}
	if styleConfig != nil {
		sec.StyleConfig = styleConfig
	}
	sec.DisplayOrder = displayOrder
	sec.IsEnabled = isEnabled
	sec.UpdatedAt = time.Now().UTC()

	m.recordCmsRevisionLocked(accountID, nil, fmt.Sprintf("Updated section '%s'", title))
	ret := *sec
	return &ret, nil
}

func (m *MockRepository) DeleteCmsSection(ctx context.Context, accountID string, sectionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ensureCmsSeed(accountID)
	sec, ok := m.cmsSections[accountID+":"+sectionID]
	if !ok {
		return ErrNotFound
	}

	delete(m.cmsSections, accountID+":"+sectionID)
	m.recordCmsRevisionLocked(accountID, nil, fmt.Sprintf("Deleted section '%s'", sec.Title))
	return nil
}

func (m *MockRepository) ListCmsNavigation(ctx context.Context, accountID string) ([]domain.CmsNavigationItem, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ensureCmsSeed(accountID)
	return m.listNavLocked(accountID), nil
}

func (m *MockRepository) UpdateCmsNavigationItem(
	ctx context.Context,
	accountID string,
	itemID string,
	label string,
	displayOrder int,
	isEnabled bool,
) (*domain.CmsNavigationItem, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ensureCmsSeed(accountID)
	item, ok := m.cmsNav[accountID+":"+itemID]
	if !ok {
		return nil, ErrNotFound
	}

	item.Label = label
	item.DisplayOrder = displayOrder
	item.IsEnabled = isEnabled
	item.UpdatedAt = time.Now().UTC()

	m.recordCmsRevisionLocked(accountID, nil, fmt.Sprintf("Updated navigation item '%s'", label))
	ret := *item
	return &ret, nil
}

func (m *MockRepository) GetCmsTheme(ctx context.Context, accountID string) (*domain.CmsThemeSettings, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ensureCmsSeed(accountID)
	ret := *m.cmsThemes[accountID]
	return &ret, nil
}

func (m *MockRepository) UpdateCmsTheme(ctx context.Context, accountID string, theme *domain.CmsThemeSettings) (*domain.CmsThemeSettings, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ensureCmsSeed(accountID)
	theme.AccountID = accountID
	theme.UpdatedAt = time.Now().UTC()
	m.cmsThemes[accountID] = theme

	m.recordCmsRevisionLocked(accountID, nil, fmt.Sprintf("Updated theme preset to '%s'", theme.ThemePreset))
	ret := *theme
	return &ret, nil
}

func (m *MockRepository) ListCmsRevisions(ctx context.Context, accountID string) ([]domain.CmsRevision, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ensureCmsSeed(accountID)
	var list []domain.CmsRevision
	revs := m.cmsRevisions[accountID]
	for i := len(revs) - 1; i >= 0; i-- {
		r := *revs[i]
		r.Snapshot = nil // do not serialize huge snapshot in list view
		list = append(list, r)
	}
	return list, nil
}

func (m *MockRepository) RestoreCmsRevision(ctx context.Context, accountID string, revisionNumber int, actorDeviceID string) (*domain.AppConfiguration, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ensureCmsSeed(accountID)
	revs := m.cmsRevisions[accountID]
	var targetRev *domain.CmsRevision
	for _, r := range revs {
		if r.RevisionNumber == revisionNumber {
			targetRev = r
			break
		}
	}
	if targetRev == nil || targetRev.Snapshot == nil {
		return nil, ErrNotFound
	}

	// Restore from snapshot
	if snapTheme, ok := targetRev.Snapshot["theme"].(*domain.CmsThemeSettings); ok && snapTheme != nil {
		m.cmsThemes[accountID] = snapTheme
	}

	// Record new restore revision
	var devID *string
	if actorDeviceID != "" {
		devID = &actorDeviceID
	}
	m.recordCmsRevisionLocked(accountID, devID, fmt.Sprintf("Restored configuration from revision #%d", revisionNumber))

	// Return updated app configuration
	mods := m.listModulesLocked(accountID)
	var enabledMods []domain.CmsModule
	for _, mod := range mods {
		if mod.IsEnabled {
			enabledMods = append(enabledMods, mod)
		}
	}

	nav := m.listNavLocked(accountID)
	var enabledNav []domain.CmsNavigationItem
	for _, n := range nav {
		if n.IsEnabled {
			enabledNav = append(enabledNav, n)
		}
	}

	sections := m.listSectionsLocked(accountID, nil)
	var enabledSections []domain.CmsSection
	for _, s := range sections {
		if s.IsEnabled {
			enabledSections = append(enabledSections, s)
		}
	}

	theme := *m.cmsThemes[accountID]
	newRevNum := len(m.cmsRevisions[accountID])

	return &domain.AppConfiguration{
		Modules:        enabledMods,
		Navigation:     enabledNav,
		Sections:       enabledSections,
		Theme:          theme,
		RevisionNumber: newRevNum,
	}, nil
}

func (m *MockRepository) SubmitSyncOperation(
	ctx context.Context,
	accountID string,
	deviceID string,
	vaultID string,
	op *domain.SyncOperationInput,
) (*domain.SyncOperationResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 1. Verify vault ownership
	v, ok := m.vaults[accountID+":"+vaultID]
	if !ok || v == nil {
		return nil, ErrNotFound
	}

	// 2. Check idempotency: if operationID already recorded for this vault
	opKey := vaultID + ":" + op.OperationID
	if prev, exists := m.syncOps[opKey]; exists {
		// Idempotent replay: return previous result
		return prev, nil
	}

	// 3. Check object's current revision
	objKey := vaultID + ":" + op.ObjectID
	currentRev := int64(0)
	if existing, exists := m.objects[objKey]; exists && existing != nil {
		currentRev = existing.Revision
	}

	if op.BaseRevision != currentRev {
		return nil, &domain.RevisionConflictError{
			Conflict: domain.RevisionConflict{
				ObjectID:              op.ObjectID,
				AttemptedBaseRevision: op.BaseRevision,
				CurrentRevision:       currentRev,
			},
		}
	}

	newRevision := op.BaseRevision + 1

	// Increment monotonic sequence ID for this vault
	m.vaultSeq[vaultID]++
	seqID := m.vaultSeq[vaultID]

	now := time.Now().UTC()

	var rev *domain.EncryptedObjectRevision
	if op.Kind == "delete" {
		rev = &domain.EncryptedObjectRevision{
			VaultID:   vaultID,
			ObjectID:  op.ObjectID,
			Revision:  newRevision,
			IsDeleted: true,
			CreatedAt: now,
		}
	} else {
		ctHash := op.CiphertextHash
		if len(ctHash) == 0 && len(op.Ciphertext) > 0 {
			h := sha256.Sum256(op.Ciphertext)
			ctHash = h[:]
		}
		rev = &domain.EncryptedObjectRevision{
			VaultID:          vaultID,
			ObjectID:         op.ObjectID,
			Revision:         newRevision,
			ProtocolVersion:  op.ProtocolVersion,
			Algorithm:        op.Algorithm,
			KeyWrapAlgorithm: op.KeyWrapAlgorithm,
			PayloadVersion:   op.PayloadVersion,
			Purpose:          op.Purpose,
			Nonce:            op.Nonce,
			WrappedDEK:       op.WrappedDEK,
			Ciphertext:       op.Ciphertext,
			CiphertextHash:   ctHash,
			IsDeleted:        false,
			CreatedAt:        now,
		}
	}

	m.objects[objKey] = rev
	m.revisions[fmt.Sprintf("%s:%s:%d", vaultID, op.ObjectID, newRevision)] = rev

	event := domain.SyncEvent{
		SequenceID:    seqID,
		AccountID:     accountID,
		VaultID:       vaultID,
		OperationID:   op.OperationID,
		DeviceID:      deviceID,
		ObjectID:      op.ObjectID,
		OperationKind: op.Kind,
		BaseRevision:  op.BaseRevision,
		NewRevision:   newRevision,
		CreatedAt:     now,
	}
	m.syncEvents[vaultID] = append(m.syncEvents[vaultID], event)

	result := &domain.SyncOperationResult{
		OperationID:     op.OperationID,
		SequenceID:      fmt.Sprintf("%d", seqID),
		CurrentRevision: newRevision,
		Accepted:        true,
	}
	m.syncOps[opKey] = result

	return result, nil
}

func (m *MockRepository) ListSyncEvents(
	ctx context.Context,
	accountID string,
	vaultID string,
	afterSequence int64,
	limit int,
) ([]domain.SyncEvent, string, bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	v, ok := m.vaults[accountID+":"+vaultID]
	if !ok || v == nil {
		return nil, "", false, ErrNotFound
	}

	events := m.syncEvents[vaultID]
	var filtered []domain.SyncEvent
	for _, ev := range events {
		if ev.SequenceID > afterSequence {
			filtered = append(filtered, ev)
		}
	}

	if limit <= 0 {
		limit = 100
	}

	hasMore := len(filtered) > limit
	if hasMore {
		filtered = filtered[:limit]
	}

	nextCursor := fmt.Sprintf("%d", afterSequence)
	if len(filtered) > 0 {
		nextCursor = fmt.Sprintf("%d", filtered[len(filtered)-1].SequenceID)
	}

	return filtered, nextCursor, hasMore, nil
}

func (m *MockRepository) GetEncryptedObjectRevision(
	ctx context.Context,
	accountID string,
	vaultID string,
	objectID string,
	revision *int64,
) (*domain.EncryptedObjectRevision, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	v, ok := m.vaults[accountID+":"+vaultID]
	if !ok || v == nil {
		return nil, ErrNotFound
	}

	if revision != nil {
		revKey := fmt.Sprintf("%s:%s:%d", vaultID, objectID, *revision)
		rev, exists := m.revisions[revKey]
		if !exists || rev == nil {
			return nil, ErrNotFound
		}
		return rev, nil
	}

	objKey := vaultID + ":" + objectID
	obj, exists := m.objects[objKey]
	if !exists || obj == nil {
		return nil, ErrNotFound
	}
	return obj, nil
}

func (m *MockRepository) PutEncryptedObject(
	ctx context.Context,
	accountID string,
	deviceID string,
	vaultID string,
	objectID string,
	ifMatchRevision int64,
	envelope *domain.EncryptedObjectRevision,
) (*domain.SyncOperationResult, error) {
	opID := m.nextID("op")
	op := &domain.SyncOperationInput{
		OperationID:      opID,
		ObjectID:         objectID,
		Kind:             "upsert",
		BaseRevision:     ifMatchRevision,
		ClientCreatedAt:  time.Now().UTC(),
		ProtocolVersion:  envelope.ProtocolVersion,
		Algorithm:        envelope.Algorithm,
		KeyWrapAlgorithm: envelope.KeyWrapAlgorithm,
		PayloadVersion:   envelope.PayloadVersion,
		Purpose:          envelope.Purpose,
		Nonce:            envelope.Nonce,
		WrappedDEK:       envelope.WrappedDEK,
		Ciphertext:       envelope.Ciphertext,
		CiphertextHash:   envelope.CiphertextHash,
	}
	return m.SubmitSyncOperation(ctx, accountID, deviceID, vaultID, op)
}

func (m *MockRepository) CreateAttachmentUploadSession(
	ctx context.Context,
	accountID string,
	vaultID string,
	input *domain.AttachmentUploadSessionInput,
) (*domain.AttachmentUploadSessionResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	v, exists := m.vaults[accountID+":"+vaultID]
	if !exists || v.Status != "active" {
		return nil, ErrNotFound
	}

	const maxSizeBytes = 104857600
	if input.CiphertextSize <= 0 || input.CiphertextSize > maxSizeBytes {
		return nil, errors.New("invalid ciphertext size")
	}
	if len(input.CiphertextHash) != 32 {
		return nil, errors.New("invalid ciphertext hash length: must be 32 bytes")
	}

	attID := m.nextUUID()
	objectKey := fmt.Sprintf("vaults/%s/attachments/%s", vaultID, attID)
	now := time.Now().UTC()
	expiresAt := now.Add(1 * time.Hour)

	att := &domain.Attachment{
		ID:             attID,
		AccountID:      accountID,
		VaultID:        vaultID,
		ObjectKey:      objectKey,
		CiphertextSize: input.CiphertextSize,
		CiphertextHash: input.CiphertextHash,
		CreatedAt:      now,
	}
	m.attachments[attID] = att

	uploadURL := fmt.Sprintf("/api/v1/vaults/%s/attachments/%s/content", vaultID, attID)
	return &domain.AttachmentUploadSessionResult{
		AttachmentID:      attID,
		UploadURL:         uploadURL,
		ObjectKey:         objectKey,
		ExpiresAt:         expiresAt,
		MaxCiphertextSize: maxSizeBytes,
	}, nil
}

func (m *MockRepository) CompleteAttachment(
	ctx context.Context,
	accountID string,
	vaultID string,
	attachmentID string,
	input *domain.AttachmentCompleteInput,
) (*domain.Attachment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	v, exists := m.vaults[accountID+":"+vaultID]
	if !exists || v.Status != "active" {
		return nil, ErrNotFound
	}

	att, exists := m.attachments[attachmentID]
	if !exists || att.AccountID != accountID || att.VaultID != vaultID || att.DeletedAt != nil {
		return nil, ErrNotFound
	}

	if input.CiphertextSize <= 0 {
		return nil, errors.New("invalid ciphertext size")
	}
	if len(input.CiphertextHash) != 32 {
		return nil, errors.New("invalid ciphertext hash length")
	}

	att.CiphertextSize = input.CiphertextSize
	att.CiphertextHash = input.CiphertextHash
	return att, nil
}

func (m *MockRepository) GetAttachment(
	ctx context.Context,
	accountID string,
	vaultID string,
	attachmentID string,
) (*domain.Attachment, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	v, exists := m.vaults[accountID+":"+vaultID]
	if !exists || v.Status != "active" {
		return nil, ErrNotFound
	}

	att, exists := m.attachments[attachmentID]
	if !exists || att.AccountID != accountID || att.VaultID != vaultID || att.DeletedAt != nil {
		return nil, ErrNotFound
	}
	return att, nil
}

func (m *MockRepository) ListAttachments(
	ctx context.Context,
	accountID string,
	vaultID string,
) ([]domain.Attachment, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	v, exists := m.vaults[accountID+":"+vaultID]
	if !exists || v.Status != "active" {
		return nil, ErrNotFound
	}

	var results []domain.Attachment
	for _, att := range m.attachments {
		if att.AccountID == accountID && att.VaultID == vaultID && att.DeletedAt == nil {
			results = append(results, *att)
		}
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i].CreatedAt.After(results[j].CreatedAt)
	})
	return results, nil
}

func (m *MockRepository) DeleteAttachment(
	ctx context.Context,
	accountID string,
	vaultID string,
	attachmentID string,
) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	v, exists := m.vaults[accountID+":"+vaultID]
	if !exists || v.Status != "active" {
		return ErrNotFound
	}

	att, exists := m.attachments[attachmentID]
	if !exists || att.AccountID != accountID || att.VaultID != vaultID || att.DeletedAt != nil {
		return ErrNotFound
	}

	now := time.Now().UTC()
	att.DeletedAt = &now
	delete(m.attachmentBlobs, attachmentID)
	return nil
}

func (m *MockRepository) SaveAttachmentBlob(
	ctx context.Context,
	accountID string,
	vaultID string,
	attachmentID string,
	data []byte,
) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	v, exists := m.vaults[accountID+":"+vaultID]
	if !exists || v.Status != "active" {
		return ErrNotFound
	}

	att, exists := m.attachments[attachmentID]
	if !exists || att.AccountID != accountID || att.VaultID != vaultID || att.DeletedAt != nil {
		return ErrNotFound
	}

	m.attachmentBlobs[attachmentID] = data
	return nil
}

func (m *MockRepository) GetAttachmentBlob(
	ctx context.Context,
	accountID string,
	vaultID string,
	attachmentID string,
) ([]byte, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	v, exists := m.vaults[accountID+":"+vaultID]
	if !exists || v.Status != "active" {
		return nil, ErrNotFound
	}

	att, exists := m.attachments[attachmentID]
	if !exists || att.AccountID != accountID || att.VaultID != vaultID || att.DeletedAt != nil {
		return nil, ErrNotFound
	}

	blob, exists := m.attachmentBlobs[attachmentID]
	if !exists {
		return nil, ErrNotFound
	}
	return blob, nil
}

func (m *MockRepository) SaveBackupMetadata(
	ctx context.Context,
	accountID string,
	vaultID string,
	input *domain.CreateBackupMetadataInput,
) (*domain.BackupMetadata, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	v, exists := m.vaults[accountID+":"+vaultID]
	if !exists || v.Status != "active" {
		return nil, ErrNotFound
	}

	if input.CiphertextSize <= 0 {
		return nil, errors.New("ciphertextSize must be positive")
	}
	if len(input.CiphertextHash) != 32 {
		return nil, errors.New("ciphertextHash must be 32 bytes")
	}

	snapID := input.SnapshotID
	if snapID == "" {
		snapID = m.nextUUID()
	}

	meta := &domain.BackupMetadata{
		SnapshotID:     snapID,
		AccountID:      accountID,
		VaultID:        vaultID,
		CiphertextSize: input.CiphertextSize,
		CiphertextHash: input.CiphertextHash,
		CreatedAt:      time.Now().UTC(),
	}

	key := accountID + ":" + vaultID
	m.backups[key] = append([]*domain.BackupMetadata{meta}, m.backups[key]...)
	return meta, nil
}

func (m *MockRepository) ListBackupMetadata(
	ctx context.Context,
	accountID string,
	vaultID string,
) ([]domain.BackupMetadata, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	v, exists := m.vaults[accountID+":"+vaultID]
	if !exists || v.Status != "active" {
		return nil, ErrNotFound
	}

	key := accountID + ":" + vaultID
	items := m.backups[key]
	res := make([]domain.BackupMetadata, len(items))
	for i, b := range items {
		res[i] = *b
	}
	return res, nil
}


