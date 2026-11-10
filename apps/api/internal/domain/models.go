package domain

import (
	"fmt"
	"time"
)

// These are server-side metadata and ciphertext models only. Decrypted vault
// records and client key material must never be added to this package.
type Account struct {
	ID        string
	Email     string
	Status    string
	CreatedAt time.Time
}

type AuthCredential struct {
	ID              string
	AccountID       string
	CredentialType  string
	CredentialID    string
	PublicKey       []byte
	ExternalSubject *string
	CreatedAt       time.Time
	LastUsedAt      *time.Time
}

type Device struct {
	ID                 string
	AccountID          string
	PublicKeyAlgorithm string
	PublicKey          []byte
	Label              string
	Platform           string
	Browser            string
	Status             string
	CreatedAt          time.Time
	LastSeenAt         *time.Time
	RevokedAt          *time.Time
}

type DeviceEnrollment struct {
	ID                string
	AccountID         string
	DeviceID          string
	ChallengeHash     []byte
	ExpiresAt         time.Time
	Status            string
	ApprovalSignature []byte
	ApproverDeviceID  *string
	ApprovedAt        *time.Time
	CreatedAt         time.Time
}

type Session struct {
	ID           string
	AccountID    string
	DeviceID     string
	TokenHash    []byte
	ExpiresAt    time.Time
	CreatedAt    time.Time
	LastActiveAt time.Time
}

type Vault struct {
	ID              string
	AccountID       string
	ProtocolVersion int
	Status          string
	CreatedAt       time.Time
	UpdatedAt       time.Time
	DeletedAt       *time.Time
}

type VaultKeyEnvelope struct {
	VaultID           string
	AccountID         string
	EnvelopeType      string
	ProtocolVersion   int
	KeyWrapAlgorithm  string
	KDFAlgorithm      string
	KDFParameters     map[string]int64
	Salt              []byte
	WrappedVEK        []byte
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type EncryptedObjectRevision struct {
	VaultID          string
	ObjectID         string
	Revision         int64
	ProtocolVersion  int
	Algorithm        string
	KeyWrapAlgorithm string
	PayloadVersion   int
	Purpose          string
	Nonce            []byte
	WrappedDEK       []byte
	Ciphertext       []byte
	CiphertextHash   []byte
	IsDeleted        bool
	CreatedAt        time.Time
}

type SyncEvent struct {
	SequenceID      int64
	AccountID       string
	VaultID         string
	OperationID     string
	DeviceID        string
	ObjectID        string
	OperationKind   string
	BaseRevision    int64
	NewRevision     int64
	CreatedAt       time.Time
}

type Attachment struct {
	ID             string
	AccountID      string
	VaultID        string
	ObjectKey      string
	CiphertextSize int64
	CiphertextHash []byte
	CreatedAt      time.Time
	DeletedAt      *time.Time
}

type AttachmentUploadSessionInput struct {
	CiphertextSize int64
	CiphertextHash []byte
}

type AttachmentUploadSessionResult struct {
	AttachmentID      string
	UploadURL         string
	ObjectKey         string
	ExpiresAt         time.Time
	MaxCiphertextSize int64
}

type AttachmentDownloadSessionResult struct {
	DownloadURL    string
	CiphertextSize int64
	CiphertextHash []byte
	ExpiresAt      time.Time
}

type AttachmentCompleteInput struct {
	CiphertextSize int64
	CiphertextHash []byte
}

type AuditEvent struct {
	ID        string
	AccountID string
	DeviceID  string
	EventType string
	ResourceID string
	RequestID string
	CreatedAt time.Time
}

type SyncOperationInput struct {
	OperationID     string
	ObjectID        string
	Kind            string // "upsert" or "delete"
	BaseRevision    int64
	ClientCreatedAt time.Time

	// Fields for upsert
	ProtocolVersion  int
	Algorithm        string
	KeyWrapAlgorithm string
	PayloadVersion   int
	Purpose          string
	Nonce            []byte
	WrappedDEK       []byte
	Ciphertext       []byte
	CiphertextHash   []byte
}

type SyncOperationResult struct {
	OperationID     string `json:"operationId"`
	SequenceID      string `json:"sequenceId"`
	CurrentRevision int64  `json:"currentRevision"`
	Accepted        bool   `json:"accepted"`
}

type RevisionConflict struct {
	ObjectID              string `json:"objectId"`
	AttemptedBaseRevision int64  `json:"attemptedBaseRevision"`
	CurrentRevision       int64  `json:"currentRevision"`
}

type RevisionConflictError struct {
	Conflict RevisionConflict
}

func (e *RevisionConflictError) Error() string {
	return fmt.Sprintf("revision conflict on object %s: attempted base %d, current is %d",
		e.Conflict.ObjectID, e.Conflict.AttemptedBaseRevision, e.Conflict.CurrentRevision)
}
