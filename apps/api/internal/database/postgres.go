package database

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/personal-digital-vault/api/internal/domain"
)

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
