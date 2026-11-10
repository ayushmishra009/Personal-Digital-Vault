package database

import (
	"context"
	"errors"
	"time"

	"github.com/personal-digital-vault/api/internal/domain"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrConflict       = errors.New("conflict")
	ErrUnauthorized   = errors.New("unauthorized")
	ErrDevicePending  = errors.New("device enrollment pending approval")
	ErrDeviceRevoked  = errors.New("device revoked")
)

type Repository interface {
	CreateAccountWithDeviceAndCredential(
		ctx context.Context,
		account *domain.Account,
		device *domain.Device,
		cred *domain.AuthCredential,
	) (*domain.Account, *domain.Device, error)

	GetAccountByEmail(ctx context.Context, email string) (*domain.Account, error)
	GetAccountByID(ctx context.Context, accountID string) (*domain.Account, error)

	GetAuthCredential(ctx context.Context, accountID string, credentialID string) (*domain.AuthCredential, error)
	GetDeviceByID(ctx context.Context, accountID string, deviceID string) (*domain.Device, error)
	ListDevices(ctx context.Context, accountID string) ([]domain.Device, error)

	CreatePendingDeviceAndEnrollment(
		ctx context.Context,
		device *domain.Device,
		challengeHash []byte,
		expiresAt time.Time,
	) (*domain.Device, *domain.DeviceEnrollment, error)

	GetDeviceEnrollment(ctx context.Context, accountID string, enrollmentID string) (*domain.DeviceEnrollment, *domain.Device, error)

	ApproveDeviceEnrollment(
		ctx context.Context,
		accountID string,
		enrollmentID string,
		approverDeviceID string,
		signature []byte,
	) error

	RevokeDevice(ctx context.Context, accountID string, deviceID string) error

	CreateVaultWithEnvelopes(
		ctx context.Context,
		accountID string,
		protocolVersion int,
		envelopes []domain.VaultKeyEnvelope,
	) (*domain.Vault, error)

	ListVaults(ctx context.Context, accountID string) ([]domain.Vault, error)
	GetVault(ctx context.Context, accountID string, vaultID string) (*domain.Vault, error)
	GetVaultKeyEnvelope(ctx context.Context, accountID string, vaultID string, envelopeType string) (*domain.VaultKeyEnvelope, error)
	PutVaultKeyEnvelope(ctx context.Context, accountID string, envelope *domain.VaultKeyEnvelope) error
	DeleteVault(ctx context.Context, accountID string, vaultID string) error

	CreateSession(ctx context.Context, session *domain.Session) error
	GetSessionByTokenHash(ctx context.Context, tokenHash []byte) (*domain.Session, *domain.Account, *domain.Device, error)
	RevokeSession(ctx context.Context, tokenHash []byte) error
	RevokeSessionsByDevice(ctx context.Context, accountID string, deviceID string) error

	// CMS & Dynamic Configuration
	GetAppConfiguration(ctx context.Context, accountID string) (*domain.AppConfiguration, error)
	ListCmsModules(ctx context.Context, accountID string) ([]domain.CmsModule, error)
	UpdateCmsModule(ctx context.Context, accountID string, moduleKey string, displayName string, description *string, isEnabled bool, displayOrder int) (*domain.CmsModule, error)
	ListCmsSections(ctx context.Context, accountID string, screenKey *string) ([]domain.CmsSection, error)
	CreateCmsSection(ctx context.Context, section *domain.CmsSection) (*domain.CmsSection, error)
	UpdateCmsSection(ctx context.Context, accountID string, sectionID string, title string, contentPayload map[string]any, styleConfig map[string]any, displayOrder int, isEnabled bool) (*domain.CmsSection, error)
	DeleteCmsSection(ctx context.Context, accountID string, sectionID string) error
	ListCmsNavigation(ctx context.Context, accountID string) ([]domain.CmsNavigationItem, error)
	UpdateCmsNavigationItem(ctx context.Context, accountID string, itemID string, label string, displayOrder int, isEnabled bool) (*domain.CmsNavigationItem, error)
	GetCmsTheme(ctx context.Context, accountID string) (*domain.CmsThemeSettings, error)
	UpdateCmsTheme(ctx context.Context, accountID string, theme *domain.CmsThemeSettings) (*domain.CmsThemeSettings, error)
	ListCmsRevisions(ctx context.Context, accountID string) ([]domain.CmsRevision, error)
	RestoreCmsRevision(ctx context.Context, accountID string, revisionNumber int, actorDeviceID string) (*domain.AppConfiguration, error)

	// Sync Engine & Object Operations
	SubmitSyncOperation(ctx context.Context, accountID string, deviceID string, vaultID string, op *domain.SyncOperationInput) (*domain.SyncOperationResult, error)
	ListSyncEvents(ctx context.Context, accountID string, vaultID string, afterSequence int64, limit int) ([]domain.SyncEvent, string, bool, error)
	GetEncryptedObjectRevision(ctx context.Context, accountID string, vaultID string, objectID string, revision *int64) (*domain.EncryptedObjectRevision, error)
	PutEncryptedObject(ctx context.Context, accountID string, deviceID string, vaultID string, objectID string, ifMatchRevision int64, envelope *domain.EncryptedObjectRevision) (*domain.SyncOperationResult, error)
}
