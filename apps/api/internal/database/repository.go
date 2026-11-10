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

	CreateSession(ctx context.Context, session *domain.Session) error
	GetSessionByTokenHash(ctx context.Context, tokenHash []byte) (*domain.Session, *domain.Account, *domain.Device, error)
	RevokeSession(ctx context.Context, tokenHash []byte) error
	RevokeSessionsByDevice(ctx context.Context, accountID string, deviceID string) error
}
