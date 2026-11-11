package database

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/personal-digital-vault/api/internal/domain"
)

func newUUID() string {
	var u [16]byte
	_, _ = rand.Read(u[:])
	u[6] = (u[6] & 0x0f) | 0x40 // Version 4
	u[8] = (u[8] & 0x3f) | 0x80 // Variant 10
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", u[0:4], u[4:6], u[6:8], u[8:10], u[10:])
}

type PostgresRepository struct {
	db *sql.DB
}

func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (r *PostgresRepository) CreateAccountWithDeviceAndCredential(
	ctx context.Context,
	account *domain.Account,
	device *domain.Device,
	cred *domain.AuthCredential,
) (*domain.Account, *domain.Device, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()

	createdAccount := &domain.Account{
		Email:  strings.ToLower(account.Email),
		Status: "active",
	}
	err = tx.QueryRowContext(
		ctx,
		`INSERT INTO accounts (email_normalized, status) VALUES ($1, $2) RETURNING id, created_at`,
		createdAccount.Email,
		createdAccount.Status,
	).Scan(&createdAccount.ID, &createdAccount.CreatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, nil, ErrConflict
		}
		return nil, nil, err
	}

	createdDevice := &domain.Device{
		AccountID:          createdAccount.ID,
		PublicKeyAlgorithm: device.PublicKeyAlgorithm,
		PublicKey:          device.PublicKey,
		Label:              device.Label,
		Platform:           device.Platform,
		Browser:            device.Browser,
		Status:             "active",
	}
	err = tx.QueryRowContext(
		ctx,
		`INSERT INTO devices (account_id, public_key_algorithm, public_key, label, platform, browser, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
		createdDevice.AccountID,
		createdDevice.PublicKeyAlgorithm,
		createdDevice.PublicKey,
		createdDevice.Label,
		createdDevice.Platform,
		createdDevice.Browser,
		createdDevice.Status,
	).Scan(&createdDevice.ID, &createdDevice.CreatedAt)
	if err != nil {
		return nil, nil, err
	}

	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO auth_credentials (account_id, credential_type, credential_id, public_key, external_subject)
		 VALUES ($1, $2, $3, $4, $5)`,
		createdAccount.ID,
		cred.CredentialType,
		cred.CredentialID,
		cred.PublicKey,
		cred.ExternalSubject,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, nil, ErrConflict
		}
		return nil, nil, err
	}

	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO audit_events (account_id, device_id, event_type, resource_id)
		 VALUES ($1, $2, 'account_created', $3)`,
		createdAccount.ID,
		createdDevice.ID,
		createdAccount.ID,
	)
	if err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}

	return createdAccount, createdDevice, nil
}

func (r *PostgresRepository) GetAccountByEmail(ctx context.Context, email string) (*domain.Account, error) {
	acc := &domain.Account{}
	err := r.db.QueryRowContext(
		ctx,
		`SELECT id, email_normalized, status, created_at FROM accounts WHERE email_normalized = $1`,
		strings.ToLower(email),
	).Scan(&acc.ID, &acc.Email, &acc.Status, &acc.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return acc, nil
}

func (r *PostgresRepository) GetAccountByID(ctx context.Context, accountID string) (*domain.Account, error) {
	acc := &domain.Account{}
	err := r.db.QueryRowContext(
		ctx,
		`SELECT id, email_normalized, status, created_at FROM accounts WHERE id = $1`,
		accountID,
	).Scan(&acc.ID, &acc.Email, &acc.Status, &acc.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return acc, nil
}

func (r *PostgresRepository) GetAuthCredential(
	ctx context.Context,
	accountID string,
	credentialID string,
) (*domain.AuthCredential, error) {
	cred := &domain.AuthCredential{}
	err := r.db.QueryRowContext(
		ctx,
		`SELECT id, account_id, credential_type, credential_id, public_key, external_subject, created_at, last_used_at
		 FROM auth_credentials WHERE account_id = $1 AND credential_id = $2`,
		accountID,
		credentialID,
	).Scan(
		&cred.ID,
		&cred.AccountID,
		&cred.CredentialType,
		&cred.CredentialID,
		&cred.PublicKey,
		&cred.ExternalSubject,
		&cred.CreatedAt,
		&cred.LastUsedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return cred, nil
}

func (r *PostgresRepository) GetDeviceByID(
	ctx context.Context,
	accountID string,
	deviceID string,
) (*domain.Device, error) {
	dev := &domain.Device{}
	err := r.db.QueryRowContext(
		ctx,
		`SELECT id, account_id, public_key_algorithm, public_key, label, platform, browser, status, created_at, last_seen_at, revoked_at
		 FROM devices WHERE account_id = $1 AND id = $2`,
		accountID,
		deviceID,
	).Scan(
		&dev.ID,
		&dev.AccountID,
		&dev.PublicKeyAlgorithm,
		&dev.PublicKey,
		&dev.Label,
		&dev.Platform,
		&dev.Browser,
		&dev.Status,
		&dev.CreatedAt,
		&dev.LastSeenAt,
		&dev.RevokedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return dev, nil
}

func (r *PostgresRepository) ListDevices(ctx context.Context, accountID string) ([]domain.Device, error) {
	rows, err := r.db.QueryContext(
		ctx,
		`SELECT id, account_id, public_key_algorithm, public_key, label, platform, browser, status, created_at, last_seen_at, revoked_at
		 FROM devices WHERE account_id = $1 ORDER BY created_at DESC`,
		accountID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var devices []domain.Device
	for rows.Next() {
		var dev domain.Device
		if err := rows.Scan(
			&dev.ID,
			&dev.AccountID,
			&dev.PublicKeyAlgorithm,
			&dev.PublicKey,
			&dev.Label,
			&dev.Platform,
			&dev.Browser,
			&dev.Status,
			&dev.CreatedAt,
			&dev.LastSeenAt,
			&dev.RevokedAt,
		); err != nil {
			return nil, err
		}
		devices = append(devices, dev)
	}
	return devices, rows.Err()
}

func (r *PostgresRepository) CreatePendingDeviceAndEnrollment(
	ctx context.Context,
	device *domain.Device,
	challengeHash []byte,
	expiresAt time.Time,
) (*domain.Device, *domain.DeviceEnrollment, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()

	createdDevice := &domain.Device{
		AccountID:          device.AccountID,
		PublicKeyAlgorithm: device.PublicKeyAlgorithm,
		PublicKey:          device.PublicKey,
		Label:              device.Label,
		Platform:           device.Platform,
		Browser:            device.Browser,
		Status:             "pending",
	}
	err = tx.QueryRowContext(
		ctx,
		`INSERT INTO devices (account_id, public_key_algorithm, public_key, label, platform, browser, status)
		 VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING id, created_at`,
		createdDevice.AccountID,
		createdDevice.PublicKeyAlgorithm,
		createdDevice.PublicKey,
		createdDevice.Label,
		createdDevice.Platform,
		createdDevice.Browser,
	).Scan(&createdDevice.ID, &createdDevice.CreatedAt)
	if err != nil {
		return nil, nil, err
	}

	enrollment := &domain.DeviceEnrollment{
		AccountID:     device.AccountID,
		DeviceID:      createdDevice.ID,
		ChallengeHash: challengeHash,
		ExpiresAt:     expiresAt,
		Status:        "pending",
	}
	err = tx.QueryRowContext(
		ctx,
		`INSERT INTO device_enrollments (account_id, device_id, challenge_hash, expires_at, status)
		 VALUES ($1, $2, $3, $4, 'pending') RETURNING id, created_at`,
		enrollment.AccountID,
		enrollment.DeviceID,
		enrollment.ChallengeHash,
		enrollment.ExpiresAt,
	).Scan(&enrollment.ID, &enrollment.CreatedAt)
	if err != nil {
		return nil, nil, err
	}

	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO audit_events (account_id, device_id, event_type, resource_id)
		 VALUES ($1, $2, 'device_enrollment_started', $3)`,
		enrollment.AccountID,
		enrollment.DeviceID,
		enrollment.ID,
	)
	if err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}

	return createdDevice, enrollment, nil
}

func (r *PostgresRepository) GetDeviceEnrollment(
	ctx context.Context,
	accountID string,
	enrollmentID string,
) (*domain.DeviceEnrollment, *domain.Device, error) {
	e := &domain.DeviceEnrollment{}
	d := &domain.Device{}

	err := r.db.QueryRowContext(
		ctx,
		`SELECT e.id, e.account_id, e.device_id, e.challenge_hash, e.expires_at, e.status, e.approval_signature, e.approver_device_id, e.approved_at, e.created_at,
		        d.id, d.public_key_algorithm, d.public_key, d.label, d.platform, d.browser, d.status, d.created_at, d.last_seen_at, d.revoked_at
		 FROM device_enrollments e
		 JOIN devices d ON d.account_id = e.account_id AND d.id = e.device_id
		 WHERE e.account_id = $1 AND e.id = $2`,
		accountID,
		enrollmentID,
	).Scan(
		&e.ID,
		&e.AccountID,
		&e.DeviceID,
		&e.ChallengeHash,
		&e.ExpiresAt,
		&e.Status,
		&e.ApprovalSignature,
		&e.ApproverDeviceID,
		&e.ApprovedAt,
		&e.CreatedAt,
		&d.ID,
		&d.PublicKeyAlgorithm,
		&d.PublicKey,
		&d.Label,
		&d.Platform,
		&d.Browser,
		&d.Status,
		&d.CreatedAt,
		&d.LastSeenAt,
		&d.RevokedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, ErrNotFound
		}
		return nil, nil, err
	}
	d.AccountID = e.AccountID
	return e, d, nil
}

func (r *PostgresRepository) ApproveDeviceEnrollment(
	ctx context.Context,
	accountID string,
	enrollmentID string,
	approverDeviceID string,
	signature []byte,
) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var (
		status    string
		expiresAt time.Time
		deviceID  string
	)
	err = tx.QueryRowContext(
		ctx,
		`SELECT status, expires_at, device_id FROM device_enrollments
		 WHERE account_id = $1 AND id = $2 FOR UPDATE`,
		accountID,
		enrollmentID,
	).Scan(&status, &expiresAt, &deviceID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}

	if status != "pending" {
		return ErrConflict
	}
	if time.Now().After(expiresAt) {
		_, _ = tx.ExecContext(
			ctx,
			`UPDATE device_enrollments SET status = 'expired' WHERE account_id = $1 AND id = $2`,
			accountID,
			enrollmentID,
		)
		_ = tx.Commit()
		return ErrConflict
	}

	now := time.Now()
	_, err = tx.ExecContext(
		ctx,
		`UPDATE device_enrollments
		 SET status = 'approved', approval_signature = $1, approver_device_id = $2, approved_at = $3
		 WHERE account_id = $4 AND id = $5`,
		signature,
		approverDeviceID,
		now,
		accountID,
		enrollmentID,
	)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(
		ctx,
		`UPDATE devices SET status = 'active' WHERE account_id = $1 AND id = $2`,
		accountID,
		deviceID,
	)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO audit_events (account_id, device_id, event_type, resource_id)
		 VALUES ($1, $2, 'device_enrollment_approved', $3)`,
		accountID,
		approverDeviceID,
		deviceID,
	)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (r *PostgresRepository) RevokeDevice(ctx context.Context, accountID string, deviceID string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var status string
	err = tx.QueryRowContext(
		ctx,
		`SELECT status FROM devices WHERE account_id = $1 AND id = $2 FOR UPDATE`,
		accountID,
		deviceID,
	).Scan(&status)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}

	if status == "revoked" {
		return nil
	}

	now := time.Now()
	_, err = tx.ExecContext(
		ctx,
		`UPDATE devices SET status = 'revoked', revoked_at = $1 WHERE account_id = $2 AND id = $3`,
		now,
		accountID,
		deviceID,
	)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(
		ctx,
		`DELETE FROM sessions WHERE account_id = $1 AND device_id = $2`,
		accountID,
		deviceID,
	)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO audit_events (account_id, device_id, event_type, resource_id)
		 VALUES ($1, $2, 'device_revoked', $2)`,
		accountID,
		deviceID,
	)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (r *PostgresRepository) CreateSession(ctx context.Context, session *domain.Session) error {
	return r.db.QueryRowContext(
		ctx,
		`INSERT INTO sessions (account_id, device_id, token_hash, expires_at)
		 VALUES ($1, $2, $3, $4) RETURNING id, created_at, last_active_at`,
		session.AccountID,
		session.DeviceID,
		session.TokenHash,
		session.ExpiresAt,
	).Scan(&session.ID, &session.CreatedAt, &session.LastActiveAt)
}

func (r *PostgresRepository) GetSessionByTokenHash(
	ctx context.Context,
	tokenHash []byte,
) (*domain.Session, *domain.Account, *domain.Device, error) {
	s := &domain.Session{}
	a := &domain.Account{}
	d := &domain.Device{}

	err := r.db.QueryRowContext(
		ctx,
		`SELECT s.id, s.account_id, s.device_id, s.token_hash, s.expires_at, s.created_at, s.last_active_at,
		        a.id, a.email_normalized, a.status, a.created_at,
		        d.id, d.public_key_algorithm, d.public_key, d.label, d.platform, d.browser, d.status, d.created_at, d.last_seen_at, d.revoked_at
		 FROM sessions s
		 JOIN accounts a ON a.id = s.account_id
		 JOIN devices d ON d.account_id = s.account_id AND d.id = s.device_id
		 WHERE s.token_hash = $1`,
		tokenHash,
	).Scan(
		&s.ID,
		&s.AccountID,
		&s.DeviceID,
		&s.TokenHash,
		&s.ExpiresAt,
		&s.CreatedAt,
		&s.LastActiveAt,
		&a.ID,
		&a.Email,
		&a.Status,
		&a.CreatedAt,
		&d.ID,
		&d.PublicKeyAlgorithm,
		&d.PublicKey,
		&d.Label,
		&d.Platform,
		&d.Browser,
		&d.Status,
		&d.CreatedAt,
		&d.LastSeenAt,
		&d.RevokedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, nil, ErrUnauthorized
		}
		return nil, nil, nil, err
	}

	d.AccountID = a.ID
	if time.Now().After(s.ExpiresAt) {
		return nil, nil, nil, ErrUnauthorized
	}

	return s, a, d, nil
}

func (r *PostgresRepository) RevokeSession(ctx context.Context, tokenHash []byte) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash)
	return err
}

func (r *PostgresRepository) RevokeSessionsByDevice(ctx context.Context, accountID string, deviceID string) error {
	_, err := r.db.ExecContext(
		ctx,
		`DELETE FROM sessions WHERE account_id = $1 AND device_id = $2`,
		accountID,
		deviceID,
	)
	return err
}

func (r *PostgresRepository) CreateVaultWithEnvelopes(
	ctx context.Context,
	accountID string,
	protocolVersion int,
	envelopes []domain.VaultKeyEnvelope,
) (*domain.Vault, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	v := &domain.Vault{
		AccountID:       accountID,
		ProtocolVersion: protocolVersion,
		Status:          "active",
	}

	err = tx.QueryRowContext(
		ctx,
		`INSERT INTO vaults (account_id, protocol_version, status)
		 VALUES ($1, $2, 'active')
		 RETURNING id, created_at, updated_at`,
		accountID,
		protocolVersion,
	).Scan(&v.ID, &v.CreatedAt, &v.UpdatedAt)
	if err != nil {
		return nil, err
	}

	for _, env := range envelopes {
		paramsJSON, err := json.Marshal(env.KDFParameters)
		if err != nil {
			return nil, err
		}

		_, err = tx.ExecContext(
			ctx,
			`INSERT INTO vault_key_envelopes (
				account_id, vault_id, envelope_type, protocol_version,
				key_wrap_algorithm, kdf_algorithm, kdf_parameters, salt, wrapped_vek
			 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			accountID,
			v.ID,
			env.EnvelopeType,
			env.ProtocolVersion,
			env.KeyWrapAlgorithm,
			env.KDFAlgorithm,
			paramsJSON,
			env.Salt,
			env.WrappedVEK,
		)
		if err != nil {
			return nil, err
		}
	}

	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO audit_events (account_id, event_type, resource_id)
		 VALUES ($1, 'vault_created', $2)`,
		accountID,
		v.ID,
	)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return v, nil
}

func (r *PostgresRepository) ListVaults(ctx context.Context, accountID string) ([]domain.Vault, error) {
	rows, err := r.db.QueryContext(
		ctx,
		`SELECT id, account_id, protocol_version, status, created_at, updated_at, deleted_at
		 FROM vaults
		 WHERE account_id = $1 AND status = 'active'
		 ORDER BY created_at DESC`,
		accountID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.Vault
	for rows.Next() {
		var v domain.Vault
		if err := rows.Scan(
			&v.ID,
			&v.AccountID,
			&v.ProtocolVersion,
			&v.Status,
			&v.CreatedAt,
			&v.UpdatedAt,
			&v.DeletedAt,
		); err != nil {
			return nil, err
		}
		list = append(list, v)
	}
	return list, rows.Err()
}

func (r *PostgresRepository) GetVault(ctx context.Context, accountID string, vaultID string) (*domain.Vault, error) {
	v := &domain.Vault{}
	err := r.db.QueryRowContext(
		ctx,
		`SELECT id, account_id, protocol_version, status, created_at, updated_at, deleted_at
		 FROM vaults
		 WHERE account_id = $1 AND id = $2 AND status = 'active'`,
		accountID,
		vaultID,
	).Scan(
		&v.ID,
		&v.AccountID,
		&v.ProtocolVersion,
		&v.Status,
		&v.CreatedAt,
		&v.UpdatedAt,
		&v.DeletedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return v, nil
}

func (r *PostgresRepository) GetVaultKeyEnvelope(
	ctx context.Context,
	accountID string,
	vaultID string,
	envelopeType string,
) (*domain.VaultKeyEnvelope, error) {
	env := &domain.VaultKeyEnvelope{}
	var paramsJSON []byte

	err := r.db.QueryRowContext(
		ctx,
		`SELECT vault_id, account_id, envelope_type, protocol_version,
		        key_wrap_algorithm, kdf_algorithm, kdf_parameters, salt, wrapped_vek,
		        created_at, updated_at
		 FROM vault_key_envelopes
		 WHERE account_id = $1 AND vault_id = $2 AND envelope_type = $3`,
		accountID,
		vaultID,
		envelopeType,
	).Scan(
		&env.VaultID,
		&env.AccountID,
		&env.EnvelopeType,
		&env.ProtocolVersion,
		&env.KeyWrapAlgorithm,
		&env.KDFAlgorithm,
		&paramsJSON,
		&env.Salt,
		&env.WrappedVEK,
		&env.CreatedAt,
		&env.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	if len(paramsJSON) > 0 {
		_ = json.Unmarshal(paramsJSON, &env.KDFParameters)
	}
	if env.KDFParameters == nil {
		env.KDFParameters = make(map[string]int64)
	}

	return env, nil
}

func (r *PostgresRepository) PutVaultKeyEnvelope(
	ctx context.Context,
	accountID string,
	envelope *domain.VaultKeyEnvelope,
) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var status string
	err = tx.QueryRowContext(
		ctx,
		`SELECT status FROM vaults WHERE account_id = $1 AND id = $2 AND status = 'active' FOR UPDATE`,
		accountID,
		envelope.VaultID,
	).Scan(&status)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}

	paramsJSON, err := json.Marshal(envelope.KDFParameters)
	if err != nil {
		return err
	}

	now := time.Now()
	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO vault_key_envelopes (
			account_id, vault_id, envelope_type, protocol_version,
			key_wrap_algorithm, kdf_algorithm, kdf_parameters, salt, wrapped_vek, updated_at
		 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		 ON CONFLICT (account_id, vault_id, envelope_type) DO UPDATE
		 SET protocol_version = EXCLUDED.protocol_version,
		     key_wrap_algorithm = EXCLUDED.key_wrap_algorithm,
		     kdf_algorithm = EXCLUDED.kdf_algorithm,
		     kdf_parameters = EXCLUDED.kdf_parameters,
		     salt = EXCLUDED.salt,
		     wrapped_vek = EXCLUDED.wrapped_vek,
		     updated_at = EXCLUDED.updated_at`,
		accountID,
		envelope.VaultID,
		envelope.EnvelopeType,
		envelope.ProtocolVersion,
		envelope.KeyWrapAlgorithm,
		envelope.KDFAlgorithm,
		paramsJSON,
		envelope.Salt,
		envelope.WrappedVEK,
		now,
	)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO audit_events (account_id, event_type, resource_id)
		 VALUES ($1, 'key_envelope_changed', $2)`,
		accountID,
		envelope.VaultID,
	)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (r *PostgresRepository) DeleteVault(ctx context.Context, accountID string, vaultID string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var status string
	err = tx.QueryRowContext(
		ctx,
		`SELECT status FROM vaults WHERE account_id = $1 AND id = $2 AND status = 'active' FOR UPDATE`,
		accountID,
		vaultID,
	).Scan(&status)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}

	now := time.Now()
	_, err = tx.ExecContext(
		ctx,
		`UPDATE vaults SET status = 'deleted', deleted_at = $1 WHERE account_id = $2 AND id = $3`,
		now,
		accountID,
		vaultID,
	)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO audit_events (account_id, event_type, resource_id)
		 VALUES ($1, 'vault_deleted', $2)`,
		accountID,
		vaultID,
	)
	if err != nil {
		return err
	}

	return tx.Commit()
}


func (r *PostgresRepository) ensureCmsSeed(ctx context.Context, accountID string) error {
	var count int
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM cms_theme_settings WHERE account_id = $1`, accountID).Scan(&count)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Theme
	_, err = tx.ExecContext(ctx, `
		INSERT INTO cms_theme_settings (account_id, theme_preset, primary_color, border_radius, density)
		VALUES ($1, 'default', '#1c5230', '8px', 'comfortable')
		ON CONFLICT DO NOTHING
	`, accountID)
	if err != nil {
		return err
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
		_, err = tx.ExecContext(ctx, `
			INSERT INTO cms_modules (id, account_id, module_key, display_name, description, icon_key, is_enabled, display_order, route_key)
			VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
			ON CONFLICT DO NOTHING
		`, newUUID(), accountID, dm.key, dm.name, dm.desc, dm.icon, dm.order, dm.route)
		if err != nil {
			return err
		}
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
		_, err = tx.ExecContext(ctx, `
			INSERT INTO cms_navigation_items (id, account_id, label, route_key, icon_key, display_order, is_enabled)
			VALUES ($1, $2, $3, $4, $5, $6, true)
		`, newUUID(), accountID, dn.label, dn.route, dn.icon, dn.order)
		if err != nil {
			return err
		}
	}

	// Sections
	defaultSections := []struct {
		screenKey, secType, title string
		order                    int
		payload                  string
	}{
		{
			"dashboard", "welcome", "Welcome to Personal Digital Vault", 1,
			`{"subtitle": "Zero-knowledge encrypted platform with independent vault lifecycle."}`,
		},
		{
			"dashboard", "quick_actions", "Quick Actions", 2,
			`{"actions": ["add_password", "new_note", "create_vault"]}`,
		},
		{
			"dashboard", "vault_cards", "Active Vaults", 3,
			`{"description": "Independent encrypted vaults. Keys held in volatile memory."}`,
		},
	}
	for _, ds := range defaultSections {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO cms_sections (id, account_id, screen_key, section_type, title, content_payload, style_config, display_order, is_enabled)
			VALUES ($1, $2, $3, $4, $5, $6::jsonb, '{"variant": "card"}'::jsonb, $7, true)
		`, newUUID(), accountID, ds.screenKey, ds.secType, ds.title, ds.payload, ds.order)
		if err != nil {
			return err
		}
	}

	// Revision 1
	_, err = tx.ExecContext(ctx, `
		INSERT INTO cms_revisions (id, account_id, revision_number, change_summary, snapshot)
		VALUES ($1, $2, 1, 'Initial default CMS configuration seed', '{}'::jsonb)
		ON CONFLICT DO NOTHING
	`, newUUID(), accountID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (r *PostgresRepository) GetAppConfiguration(ctx context.Context, accountID string) (*domain.AppConfiguration, error) {
	if err := r.ensureCmsSeed(ctx, accountID); err != nil {
		return nil, err
	}

	// Modules
	modRows, err := r.db.QueryContext(ctx, `
		SELECT id, account_id, module_key, display_name, description, icon_key, is_enabled, display_order, route_key, created_at, updated_at
		FROM cms_modules
		WHERE account_id = $1 AND is_enabled = true
		ORDER BY display_order ASC
	`, accountID)
	if err != nil {
		return nil, err
	}
	defer modRows.Close()

	var modules []domain.CmsModule
	for modRows.Next() {
		var m domain.CmsModule
		if err := modRows.Scan(&m.ID, &m.AccountID, &m.ModuleKey, &m.DisplayName, &m.Description, &m.IconKey, &m.IsEnabled, &m.DisplayOrder, &m.RouteKey, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, err
		}
		modules = append(modules, m)
	}

	// Nav
	navRows, err := r.db.QueryContext(ctx, `
		SELECT id, account_id, label, route_key, icon_key, display_order, is_enabled, created_at, updated_at
		FROM cms_navigation_items
		WHERE account_id = $1 AND is_enabled = true
		ORDER BY display_order ASC
	`, accountID)
	if err != nil {
		return nil, err
	}
	defer navRows.Close()

	var nav []domain.CmsNavigationItem
	for navRows.Next() {
		var n domain.CmsNavigationItem
		if err := navRows.Scan(&n.ID, &n.AccountID, &n.Label, &n.RouteKey, &n.IconKey, &n.DisplayOrder, &n.IsEnabled, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		nav = append(nav, n)
	}

	// Sections
	secRows, err := r.db.QueryContext(ctx, `
		SELECT id, account_id, screen_key, section_type, title, content_payload, style_config, display_order, is_enabled, created_at, updated_at
		FROM cms_sections
		WHERE account_id = $1 AND is_enabled = true
		ORDER BY display_order ASC
	`, accountID)
	if err != nil {
		return nil, err
	}
	defer secRows.Close()

	var sections []domain.CmsSection
	for secRows.Next() {
		var s domain.CmsSection
		var payloadBytes, styleBytes []byte
		if err := secRows.Scan(&s.ID, &s.AccountID, &s.ScreenKey, &s.SectionType, &s.Title, &payloadBytes, &styleBytes, &s.DisplayOrder, &s.IsEnabled, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(payloadBytes, &s.ContentPayload)
		_ = json.Unmarshal(styleBytes, &s.StyleConfig)
		sections = append(sections, s)
	}

	// Theme
	var theme domain.CmsThemeSettings
	err = r.db.QueryRowContext(ctx, `
		SELECT account_id, theme_preset, primary_color, border_radius, density, updated_at
		FROM cms_theme_settings
		WHERE account_id = $1
	`, accountID).Scan(&theme.AccountID, &theme.ThemePreset, &theme.PrimaryColor, &theme.BorderRadius, &theme.Density, &theme.UpdatedAt)
	if err != nil {
		return nil, err
	}

	// Latest Revision Number
	var revNum int
	err = r.db.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(revision_number), 1)
		FROM cms_revisions
		WHERE account_id = $1
	`, accountID).Scan(&revNum)
	if err != nil {
		return nil, err
	}

	return &domain.AppConfiguration{
		Modules:        modules,
		Navigation:     nav,
		Sections:       sections,
		Theme:          theme,
		RevisionNumber: revNum,
	}, nil
}

func (r *PostgresRepository) ListCmsModules(ctx context.Context, accountID string) ([]domain.CmsModule, error) {
	if err := r.ensureCmsSeed(ctx, accountID); err != nil {
		return nil, err
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT id, account_id, module_key, display_name, description, icon_key, is_enabled, display_order, route_key, created_at, updated_at
		FROM cms_modules
		WHERE account_id = $1
		ORDER BY display_order ASC
	`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.CmsModule
	for rows.Next() {
		var m domain.CmsModule
		if err := rows.Scan(&m.ID, &m.AccountID, &m.ModuleKey, &m.DisplayName, &m.Description, &m.IconKey, &m.IsEnabled, &m.DisplayOrder, &m.RouteKey, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, m)
	}
	return list, nil
}

func (r *PostgresRepository) UpdateCmsModule(
	ctx context.Context,
	accountID string,
	moduleKey string,
	displayName string,
	description *string,
	isEnabled bool,
	displayOrder int,
) (*domain.CmsModule, error) {
	if err := r.ensureCmsSeed(ctx, accountID); err != nil {
		return nil, err
	}

	var m domain.CmsModule
	err := r.db.QueryRowContext(ctx, `
		UPDATE cms_modules
		SET display_name = $1, description = $2, is_enabled = $3, display_order = $4, updated_at = NOW()
		WHERE account_id = $5 AND module_key = $6
		RETURNING id, account_id, module_key, display_name, description, icon_key, is_enabled, display_order, route_key, created_at, updated_at
	`, displayName, description, isEnabled, displayOrder, accountID, moduleKey).Scan(
		&m.ID, &m.AccountID, &m.ModuleKey, &m.DisplayName, &m.Description, &m.IconKey, &m.IsEnabled, &m.DisplayOrder, &m.RouteKey, &m.CreatedAt, &m.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	return &m, nil
}

func (r *PostgresRepository) ListCmsSections(ctx context.Context, accountID string, screenKey *string) ([]domain.CmsSection, error) {
	if err := r.ensureCmsSeed(ctx, accountID); err != nil {
		return nil, err
	}

	var query string
	var args []any
	if screenKey != nil && *screenKey != "" {
		query = `SELECT id, account_id, screen_key, section_type, title, content_payload, style_config, display_order, is_enabled, created_at, updated_at
		         FROM cms_sections WHERE account_id = $1 AND screen_key = $2 ORDER BY display_order ASC`
		args = []any{accountID, *screenKey}
	} else {
		query = `SELECT id, account_id, screen_key, section_type, title, content_payload, style_config, display_order, is_enabled, created_at, updated_at
		         FROM cms_sections WHERE account_id = $1 ORDER BY display_order ASC`
		args = []any{accountID}
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.CmsSection
	for rows.Next() {
		var s domain.CmsSection
		var payloadBytes, styleBytes []byte
		if err := rows.Scan(&s.ID, &s.AccountID, &s.ScreenKey, &s.SectionType, &s.Title, &payloadBytes, &styleBytes, &s.DisplayOrder, &s.IsEnabled, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(payloadBytes, &s.ContentPayload)
		_ = json.Unmarshal(styleBytes, &s.StyleConfig)
		list = append(list, s)
	}
	return list, nil
}

func (r *PostgresRepository) CreateCmsSection(ctx context.Context, section *domain.CmsSection) (*domain.CmsSection, error) {
	if err := r.ensureCmsSeed(ctx, section.AccountID); err != nil {
		return nil, err
	}

	id := newUUID()
	payloadBytes, _ := json.Marshal(section.ContentPayload)
	styleBytes, _ := json.Marshal(section.StyleConfig)

	var s domain.CmsSection
	var outPayload, outStyle []byte
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO cms_sections (id, account_id, screen_key, section_type, title, content_payload, style_config, display_order, is_enabled)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
		RETURNING id, account_id, screen_key, section_type, title, content_payload, style_config, display_order, is_enabled, created_at, updated_at
	`, id, section.AccountID, section.ScreenKey, section.SectionType, section.Title, payloadBytes, styleBytes, section.DisplayOrder, section.IsEnabled).Scan(
		&s.ID, &s.AccountID, &s.ScreenKey, &s.SectionType, &s.Title, &outPayload, &outStyle, &s.DisplayOrder, &s.IsEnabled, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(outPayload, &s.ContentPayload)
	_ = json.Unmarshal(outStyle, &s.StyleConfig)
	return &s, nil
}

func (r *PostgresRepository) UpdateCmsSection(
	ctx context.Context,
	accountID string,
	sectionID string,
	title string,
	contentPayload map[string]any,
	styleConfig map[string]any,
	displayOrder int,
	isEnabled bool,
) (*domain.CmsSection, error) {
	if err := r.ensureCmsSeed(ctx, accountID); err != nil {
		return nil, err
	}

	payloadBytes, _ := json.Marshal(contentPayload)
	styleBytes, _ := json.Marshal(styleConfig)

	var s domain.CmsSection
	var outPayload, outStyle []byte
	err := r.db.QueryRowContext(ctx, `
		UPDATE cms_sections
		SET title = $1, content_payload = $2::jsonb, style_config = $3::jsonb, display_order = $4, is_enabled = $5, updated_at = NOW()
		WHERE account_id = $6 AND id = $7
		RETURNING id, account_id, screen_key, section_type, title, content_payload, style_config, display_order, is_enabled, created_at, updated_at
	`, title, payloadBytes, styleBytes, displayOrder, isEnabled, accountID, sectionID).Scan(
		&s.ID, &s.AccountID, &s.ScreenKey, &s.SectionType, &s.Title, &outPayload, &outStyle, &s.DisplayOrder, &s.IsEnabled, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	_ = json.Unmarshal(outPayload, &s.ContentPayload)
	_ = json.Unmarshal(outStyle, &s.StyleConfig)
	return &s, nil
}

func (r *PostgresRepository) DeleteCmsSection(ctx context.Context, accountID string, sectionID string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM cms_sections WHERE account_id = $1 AND id = $2`, accountID, sectionID)
	if err != nil {
		return err
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) ListCmsNavigation(ctx context.Context, accountID string) ([]domain.CmsNavigationItem, error) {
	if err := r.ensureCmsSeed(ctx, accountID); err != nil {
		return nil, err
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT id, account_id, label, route_key, icon_key, display_order, is_enabled, created_at, updated_at
		FROM cms_navigation_items
		WHERE account_id = $1
		ORDER BY display_order ASC
	`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.CmsNavigationItem
	for rows.Next() {
		var n domain.CmsNavigationItem
		if err := rows.Scan(&n.ID, &n.AccountID, &n.Label, &n.RouteKey, &n.IconKey, &n.DisplayOrder, &n.IsEnabled, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, n)
	}
	return list, nil
}

func (r *PostgresRepository) UpdateCmsNavigationItem(
	ctx context.Context,
	accountID string,
	itemID string,
	label string,
	displayOrder int,
	isEnabled bool,
) (*domain.CmsNavigationItem, error) {
	var n domain.CmsNavigationItem
	err := r.db.QueryRowContext(ctx, `
		UPDATE cms_navigation_items
		SET label = $1, display_order = $2, is_enabled = $3, updated_at = NOW()
		WHERE account_id = $4 AND id = $5
		RETURNING id, account_id, label, route_key, icon_key, display_order, is_enabled, created_at, updated_at
	`, label, displayOrder, isEnabled, accountID, itemID).Scan(
		&n.ID, &n.AccountID, &n.Label, &n.RouteKey, &n.IconKey, &n.DisplayOrder, &n.IsEnabled, &n.CreatedAt, &n.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &n, nil
}

func (r *PostgresRepository) GetCmsTheme(ctx context.Context, accountID string) (*domain.CmsThemeSettings, error) {
	if err := r.ensureCmsSeed(ctx, accountID); err != nil {
		return nil, err
	}

	var theme domain.CmsThemeSettings
	err := r.db.QueryRowContext(ctx, `
		SELECT account_id, theme_preset, primary_color, border_radius, density, updated_at
		FROM cms_theme_settings
		WHERE account_id = $1
	`, accountID).Scan(&theme.AccountID, &theme.ThemePreset, &theme.PrimaryColor, &theme.BorderRadius, &theme.Density, &theme.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &theme, nil
}

func (r *PostgresRepository) UpdateCmsTheme(ctx context.Context, accountID string, theme *domain.CmsThemeSettings) (*domain.CmsThemeSettings, error) {
	var out domain.CmsThemeSettings
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO cms_theme_settings (account_id, theme_preset, primary_color, border_radius, density, updated_at)
		VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (account_id) DO UPDATE
		SET theme_preset = EXCLUDED.theme_preset, primary_color = EXCLUDED.primary_color, border_radius = EXCLUDED.border_radius, density = EXCLUDED.density, updated_at = NOW()
		RETURNING account_id, theme_preset, primary_color, border_radius, density, updated_at
	`, accountID, theme.ThemePreset, theme.PrimaryColor, theme.BorderRadius, theme.Density).Scan(
		&out.AccountID, &out.ThemePreset, &out.PrimaryColor, &out.BorderRadius, &out.Density, &out.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (r *PostgresRepository) ListCmsRevisions(ctx context.Context, accountID string) ([]domain.CmsRevision, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, account_id, revision_number, actor_device_id, change_summary, created_at
		FROM cms_revisions
		WHERE account_id = $1
		ORDER BY revision_number DESC
	`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.CmsRevision
	for rows.Next() {
		var rev domain.CmsRevision
		if err := rows.Scan(&rev.ID, &rev.AccountID, &rev.RevisionNumber, &rev.ActorDeviceID, &rev.ChangeSummary, &rev.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, rev)
	}
	return list, nil
}

func (r *PostgresRepository) RestoreCmsRevision(ctx context.Context, accountID string, revisionNumber int, actorDeviceID string) (*domain.AppConfiguration, error) {
	var snapshotBytes []byte
	err := r.db.QueryRowContext(ctx, `
		SELECT snapshot FROM cms_revisions WHERE account_id = $1 AND revision_number = $2
	`, accountID, revisionNumber).Scan(&snapshotBytes)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	// Bump revision
	var nextRev int
	_ = r.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(revision_number), 0) + 1 FROM cms_revisions WHERE account_id = $1`, accountID).Scan(&nextRev)
	_, _ = r.db.ExecContext(ctx, `
		INSERT INTO cms_revisions (id, account_id, revision_number, actor_device_id, change_summary, snapshot)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, newUUID(), accountID, nextRev, actorDeviceID, fmt.Sprintf("Restored configuration from revision #%d", revisionNumber), snapshotBytes)

	return r.GetAppConfiguration(ctx, accountID)
}

func (r *PostgresRepository) SubmitSyncOperation(
	ctx context.Context,
	accountID string,
	deviceID string,
	vaultID string,
	op *domain.SyncOperationInput,
) (*domain.SyncOperationResult, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// 1. Verify vault ownership
	var vID string
	err = tx.QueryRowContext(ctx, `SELECT id FROM vaults WHERE account_id = $1 AND id = $2`, accountID, vaultID).Scan(&vID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	// 2. Check idempotency: if operation_id already recorded for this vault
	var existingSeq int64
	var existingRev int64
	err = tx.QueryRowContext(ctx, `
		SELECT sequence_id, new_revision FROM sync_events WHERE vault_id = $1 AND operation_id = $2
	`, vaultID, op.OperationID).Scan(&existingSeq, &existingRev)
	if err == nil {
		// Idempotent replay: return earlier accepted result
		return &domain.SyncOperationResult{
			OperationID:     op.OperationID,
			SequenceID:      fmt.Sprintf("%d", existingSeq),
			CurrentRevision: existingRev,
			Accepted:        true,
		}, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	// 3. Row-lock vault_objects to check current revision
	var currentRev int64
	err = tx.QueryRowContext(ctx, `
		SELECT current_revision FROM vault_objects WHERE account_id = $1 AND vault_id = $2 AND object_id = $3 FOR UPDATE
	`, accountID, vaultID, op.ObjectID).Scan(&currentRev)

	if errors.Is(err, sql.ErrNoRows) {
		// Object doesn't exist yet -> current revision is 0
		if op.BaseRevision != 0 {
			return nil, &domain.RevisionConflictError{
				Conflict: domain.RevisionConflict{
					ObjectID:              op.ObjectID,
					AttemptedBaseRevision: op.BaseRevision,
					CurrentRevision:       0,
				},
			}
		}
		newRevision := int64(1)
		_, err = tx.ExecContext(ctx, `
			INSERT INTO vault_objects (account_id, vault_id, object_id, current_revision)
			VALUES ($1, $2, $3, $4)
		`, accountID, vaultID, op.ObjectID, newRevision)
		if err != nil {
			return nil, err
		}
		currentRev = 0
	} else if err != nil {
		return nil, err
	} else {
		// Object exists -> check base revision matches
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
		_, err = tx.ExecContext(ctx, `
			UPDATE vault_objects SET current_revision = $1, updated_at = now()
			WHERE account_id = $2 AND vault_id = $3 AND object_id = $4
		`, newRevision, accountID, vaultID, op.ObjectID)
		if err != nil {
			return nil, err
		}
	}

	newRevision := op.BaseRevision + 1

	// 4. Insert into vault_object_revisions
	if op.Kind == "delete" {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO vault_object_revisions (account_id, vault_id, object_id, revision, is_deleted)
			VALUES ($1, $2, $3, $4, true)
		`, accountID, vaultID, op.ObjectID, newRevision)
		if err != nil {
			return nil, err
		}
	} else {
		ctHash := op.CiphertextHash
		if len(ctHash) == 0 && len(op.Ciphertext) > 0 {
			h := sha256.Sum256(op.Ciphertext)
			ctHash = h[:]
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO vault_object_revisions (
				account_id, vault_id, object_id, revision, is_deleted,
				protocol_version, algorithm, key_wrap_algorithm, payload_version, purpose,
				nonce, wrapped_dek, ciphertext, ciphertext_hash
			) VALUES ($1, $2, $3, $4, false, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		`, accountID, vaultID, op.ObjectID, newRevision,
			op.ProtocolVersion, op.Algorithm, op.KeyWrapAlgorithm, op.PayloadVersion, op.Purpose,
			op.Nonce, op.WrappedDEK, op.Ciphertext, ctHash)
		if err != nil {
			return nil, err
		}
	}

	// 5. Insert into sync_events
	var seqID int64
	err = tx.QueryRowContext(ctx, `
		INSERT INTO sync_events (
			account_id, vault_id, operation_id, device_id, object_id,
			operation_kind, base_revision, new_revision
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING sequence_id
	`, accountID, vaultID, op.OperationID, deviceID, op.ObjectID, op.Kind, op.BaseRevision, newRevision).Scan(&seqID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return &domain.SyncOperationResult{
		OperationID:     op.OperationID,
		SequenceID:      fmt.Sprintf("%d", seqID),
		CurrentRevision: newRevision,
		Accepted:        true,
	}, nil
}

func (r *PostgresRepository) ListSyncEvents(
	ctx context.Context,
	accountID string,
	vaultID string,
	afterSequence int64,
	limit int,
) ([]domain.SyncEvent, string, bool, error) {
	var vID string
	err := r.db.QueryRowContext(ctx, `SELECT id FROM vaults WHERE account_id = $1 AND id = $2`, accountID, vaultID).Scan(&vID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, "", false, ErrNotFound
		}
		return nil, "", false, err
	}

	if limit <= 0 {
		limit = 100
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT sequence_id, operation_id, device_id, object_id, operation_kind, base_revision, new_revision, created_at
		FROM sync_events
		WHERE account_id = $1 AND vault_id = $2 AND sequence_id > $3
		ORDER BY sequence_id ASC
		LIMIT $4
	`, accountID, vaultID, afterSequence, limit+1)
	if err != nil {
		return nil, "", false, err
	}
	defer rows.Close()

	var events []domain.SyncEvent
	for rows.Next() {
		var ev domain.SyncEvent
		ev.AccountID = accountID
		ev.VaultID = vaultID
		if err := rows.Scan(
			&ev.SequenceID,
			&ev.OperationID,
			&ev.DeviceID,
			&ev.ObjectID,
			&ev.OperationKind,
			&ev.BaseRevision,
			&ev.NewRevision,
			&ev.CreatedAt,
		); err != nil {
			return nil, "", false, err
		}
		events = append(events, ev)
	}

	hasMore := len(events) > limit
	if hasMore {
		events = events[:limit]
	}

	nextCursor := fmt.Sprintf("%d", afterSequence)
	if len(events) > 0 {
		nextCursor = fmt.Sprintf("%d", events[len(events)-1].SequenceID)
	}

	return events, nextCursor, hasMore, nil
}

func (r *PostgresRepository) GetEncryptedObjectRevision(
	ctx context.Context,
	accountID string,
	vaultID string,
	objectID string,
	revision *int64,
) (*domain.EncryptedObjectRevision, error) {
	var vID string
	err := r.db.QueryRowContext(ctx, `SELECT id FROM vaults WHERE account_id = $1 AND id = $2`, accountID, vaultID).Scan(&vID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	var rev domain.EncryptedObjectRevision
	var query string
	var args []any

	if revision != nil {
		query = `
			SELECT vault_id, object_id, revision, protocol_version, algorithm, key_wrap_algorithm,
			       payload_version, purpose, nonce, wrapped_dek, ciphertext, ciphertext_hash, is_deleted, created_at
			FROM vault_object_revisions
			WHERE account_id = $1 AND vault_id = $2 AND object_id = $3 AND revision = $4
		`
		args = []any{accountID, vaultID, objectID, *revision}
	} else {
		query = `
			SELECT r.vault_id, r.object_id, r.revision, r.protocol_version, r.algorithm, r.key_wrap_algorithm,
			       r.payload_version, r.purpose, r.nonce, r.wrapped_dek, r.ciphertext, r.ciphertext_hash, r.is_deleted, r.created_at
			FROM vault_object_revisions r
			JOIN vault_objects o ON r.account_id = o.account_id AND r.vault_id = o.vault_id AND r.object_id = o.object_id AND r.revision = o.current_revision
			WHERE o.account_id = $1 AND o.vault_id = $2 AND o.object_id = $3
		`
		args = []any{accountID, vaultID, objectID}
	}

	var protoVer, payloadVer sql.NullInt64
	var alg, kwAlg, purpose sql.NullString
	var nonce, wrappedDEK, ct, ctHash []byte

	err = r.db.QueryRowContext(ctx, query, args...).Scan(
		&rev.VaultID,
		&rev.ObjectID,
		&rev.Revision,
		&protoVer,
		&alg,
		&kwAlg,
		&payloadVer,
		&purpose,
		&nonce,
		&wrappedDEK,
		&ct,
		&ctHash,
		&rev.IsDeleted,
		&rev.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	if protoVer.Valid {
		rev.ProtocolVersion = int(protoVer.Int64)
	}
	if alg.Valid {
		rev.Algorithm = alg.String
	}
	if kwAlg.Valid {
		rev.KeyWrapAlgorithm = kwAlg.String
	}
	if payloadVer.Valid {
		rev.PayloadVersion = int(payloadVer.Int64)
	}
	if purpose.Valid {
		rev.Purpose = purpose.String
	}
	rev.Nonce = nonce
	rev.WrappedDEK = wrappedDEK
	rev.Ciphertext = ct
	rev.CiphertextHash = ctHash

	return &rev, nil
}

func (r *PostgresRepository) PutEncryptedObject(
	ctx context.Context,
	accountID string,
	deviceID string,
	vaultID string,
	objectID string,
	ifMatchRevision int64,
	envelope *domain.EncryptedObjectRevision,
) (*domain.SyncOperationResult, error) {
	op := &domain.SyncOperationInput{
		OperationID:      newUUID(),
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
	return r.SubmitSyncOperation(ctx, accountID, deviceID, vaultID, op)
}

func (r *PostgresRepository) CreateAttachmentUploadSession(
	ctx context.Context,
	accountID string,
	vaultID string,
	input *domain.AttachmentUploadSessionInput,
) (*domain.AttachmentUploadSessionResult, error) {
	var activeVaultID string
	err := r.db.QueryRowContext(
		ctx,
		`SELECT id FROM vaults WHERE account_id = $1 AND id = $2 AND status = 'active'`,
		accountID,
		vaultID,
	).Scan(&activeVaultID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	const maxSizeBytes = 104857600
	if input.CiphertextSize <= 0 || input.CiphertextSize > maxSizeBytes {
		return nil, errors.New("invalid ciphertext size")
	}
	if len(input.CiphertextHash) != 32 {
		return nil, errors.New("invalid ciphertext hash length: must be 32 bytes")
	}

	attID := newUUID()
	objectKey := fmt.Sprintf("vaults/%s/attachments/%s", vaultID, attID)
	now := time.Now().UTC()
	expiresAt := now.Add(1 * time.Hour)

	_, err = r.db.ExecContext(
		ctx,
		`INSERT INTO attachments (id, account_id, vault_id, object_key, ciphertext_size, ciphertext_hash, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		attID,
		accountID,
		vaultID,
		objectKey,
		input.CiphertextSize,
		input.CiphertextHash,
		now,
	)
	if err != nil {
		return nil, err
	}

	uploadURL := fmt.Sprintf("/api/v1/vaults/%s/attachments/%s/content", vaultID, attID)
	return &domain.AttachmentUploadSessionResult{
		AttachmentID:      attID,
		UploadURL:         uploadURL,
		ObjectKey:         objectKey,
		ExpiresAt:         expiresAt,
		MaxCiphertextSize: maxSizeBytes,
	}, nil
}

func (r *PostgresRepository) CompleteAttachment(
	ctx context.Context,
	accountID string,
	vaultID string,
	attachmentID string,
	input *domain.AttachmentCompleteInput,
) (*domain.Attachment, error) {
	if input.CiphertextSize <= 0 {
		return nil, errors.New("invalid ciphertext size")
	}
	if len(input.CiphertextHash) != 32 {
		return nil, errors.New("invalid ciphertext hash length")
	}

	var att domain.Attachment
	err := r.db.QueryRowContext(
		ctx,
		`UPDATE attachments
		 SET ciphertext_size = $1, ciphertext_hash = $2
		 WHERE account_id = $3 AND vault_id = $4 AND id = $5 AND deleted_at IS NULL
		 RETURNING id, account_id, vault_id, object_key, ciphertext_size, ciphertext_hash, created_at, deleted_at`,
		input.CiphertextSize,
		input.CiphertextHash,
		accountID,
		vaultID,
		attachmentID,
	).Scan(
		&att.ID,
		&att.AccountID,
		&att.VaultID,
		&att.ObjectKey,
		&att.CiphertextSize,
		&att.CiphertextHash,
		&att.CreatedAt,
		&att.DeletedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &att, nil
}

func (r *PostgresRepository) GetAttachment(
	ctx context.Context,
	accountID string,
	vaultID string,
	attachmentID string,
) (*domain.Attachment, error) {
	var att domain.Attachment
	err := r.db.QueryRowContext(
		ctx,
		`SELECT id, account_id, vault_id, object_key, ciphertext_size, ciphertext_hash, created_at, deleted_at
		 FROM attachments
		 WHERE account_id = $1 AND vault_id = $2 AND id = $3 AND deleted_at IS NULL`,
		accountID,
		vaultID,
		attachmentID,
	).Scan(
		&att.ID,
		&att.AccountID,
		&att.VaultID,
		&att.ObjectKey,
		&att.CiphertextSize,
		&att.CiphertextHash,
		&att.CreatedAt,
		&att.DeletedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &att, nil
}

func (r *PostgresRepository) ListAttachments(
	ctx context.Context,
	accountID string,
	vaultID string,
) ([]domain.Attachment, error) {
	var activeVaultID string
	err := r.db.QueryRowContext(
		ctx,
		`SELECT id FROM vaults WHERE account_id = $1 AND id = $2 AND status = 'active'`,
		accountID,
		vaultID,
	).Scan(&activeVaultID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	rows, err := r.db.QueryContext(
		ctx,
		`SELECT id, account_id, vault_id, object_key, ciphertext_size, ciphertext_hash, created_at, deleted_at
		 FROM attachments
		 WHERE account_id = $1 AND vault_id = $2 AND deleted_at IS NULL
		 ORDER BY created_at DESC`,
		accountID,
		vaultID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.Attachment
	for rows.Next() {
		var a domain.Attachment
		if err := rows.Scan(
			&a.ID,
			&a.AccountID,
			&a.VaultID,
			&a.ObjectKey,
			&a.CiphertextSize,
			&a.CiphertextHash,
			&a.CreatedAt,
			&a.DeletedAt,
		); err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, rows.Err()
}

func (r *PostgresRepository) DeleteAttachment(
	ctx context.Context,
	accountID string,
	vaultID string,
	attachmentID string,
) error {
	res, err := r.db.ExecContext(
		ctx,
		`UPDATE attachments
		 SET deleted_at = now()
		 WHERE account_id = $1 AND vault_id = $2 AND id = $3 AND deleted_at IS NULL`,
		accountID,
		vaultID,
		attachmentID,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) SaveAttachmentBlob(
	ctx context.Context,
	accountID string,
	vaultID string,
	attachmentID string,
	data []byte,
) error {
	_, err := r.GetAttachment(ctx, accountID, vaultID, attachmentID)
	return err
}

func (r *PostgresRepository) GetAttachmentBlob(
	ctx context.Context,
	accountID string,
	vaultID string,
	attachmentID string,
) ([]byte, error) {
	_, err := r.GetAttachment(ctx, accountID, vaultID, attachmentID)
	if err != nil {
		return nil, err
	}
	return nil, errors.New("blob storage not configured for postgres direct retrieval")
}

func (r *PostgresRepository) SaveBackupMetadata(
	ctx context.Context,
	accountID string,
	vaultID string,
	input *domain.CreateBackupMetadataInput,
) (*domain.BackupMetadata, error) {
	var activeVaultID string
	err := r.db.QueryRowContext(
		ctx,
		`SELECT id FROM vaults WHERE account_id = $1 AND id = $2 AND status = 'active'`,
		accountID,
		vaultID,
	).Scan(&activeVaultID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	if input.CiphertextSize <= 0 {
		return nil, errors.New("ciphertextSize must be positive")
	}
	if len(input.CiphertextHash) != 32 {
		return nil, errors.New("ciphertextHash must be 32 bytes")
	}

	snapID := input.SnapshotID
	if snapID == "" {
		snapID = newUUID()
	}

	var meta domain.BackupMetadata
	meta.SnapshotID = snapID
	meta.AccountID = accountID
	meta.VaultID = vaultID
	meta.CiphertextSize = input.CiphertextSize
	meta.CiphertextHash = input.CiphertextHash

	err = r.db.QueryRowContext(
		ctx,
		`INSERT INTO vault_backups (snapshot_id, account_id, vault_id, ciphertext_size, ciphertext_hash, created_at)
		 VALUES ($1, $2, $3, $4, $5, now())
		 RETURNING created_at`,
		snapID,
		accountID,
		vaultID,
		input.CiphertextSize,
		input.CiphertextHash,
	).Scan(&meta.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &meta, nil
}

func (r *PostgresRepository) ListBackupMetadata(
	ctx context.Context,
	accountID string,
	vaultID string,
) ([]domain.BackupMetadata, error) {
	var activeVaultID string
	err := r.db.QueryRowContext(
		ctx,
		`SELECT id FROM vaults WHERE account_id = $1 AND id = $2 AND status = 'active'`,
		accountID,
		vaultID,
	).Scan(&activeVaultID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	rows, err := r.db.QueryContext(
		ctx,
		`SELECT snapshot_id, account_id, vault_id, ciphertext_size, ciphertext_hash, created_at
		 FROM vault_backups
		 WHERE account_id = $1 AND vault_id = $2
		 ORDER BY created_at DESC`,
		accountID,
		vaultID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.BackupMetadata
	for rows.Next() {
		var b domain.BackupMetadata
		if err := rows.Scan(
			&b.SnapshotID,
			&b.AccountID,
			&b.VaultID,
			&b.CiphertextSize,
			&b.CiphertextHash,
			&b.CreatedAt,
		); err != nil {
			return nil, err
		}
		list = append(list, b)
	}
	return list, rows.Err()
}

func (r *PostgresRepository) DeleteAccount(ctx context.Context, accountID string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx, `DELETE FROM accounts WHERE id = $1`, accountID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}

	return tx.Commit()
}

func (r *PostgresRepository) PurgeExpiredTombstones(ctx context.Context, olderThan time.Duration) (int64, error) {
	cutoff := time.Now().Add(-olderThan)
	res, err := r.db.ExecContext(
		ctx,
		`DELETE FROM sync_events WHERE kind = 'delete' AND created_at < $1`,
		cutoff,
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (r *PostgresRepository) PurgeSoftDeletedVaults(ctx context.Context, olderThan time.Duration) (int64, error) {
	cutoff := time.Now().Add(-olderThan)
	res, err := r.db.ExecContext(
		ctx,
		`DELETE FROM vaults WHERE status = 'deleted' AND deleted_at < $1`,
		cutoff,
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

