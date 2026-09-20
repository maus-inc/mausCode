## ADDED Requirements

### Requirement: One app secret owner

The application SHALL delegate encryption and app-held secret persistence policy to `src/main/auth-store.ts`. Provider wrappers SHALL NOT import Electron safeStorage directly. The token-crypto import path SHALL remain a thin re-export.

#### Scenario: Provider saves a credential

- **WHEN** any in-scope provider requests a secret write
- **THEN** the shared owner checks the storage policy and encodes the value
- **AND** the provider does not choose an independent plaintext fallback

### Requirement: Plaintext requires explicit consent

The owner SHALL refuse new, replacement, copied, and refreshed secret persistence without protected encryption or explicit persisted plaintext consent. Linux basic_text SHALL be treated as unprotected. Encryption errors SHALL NOT silently fall back to plaintext.

#### Scenario: No protected keyring and no consent

- **WHEN** a secret write is requested with no protected keyring and no valid consent
- **THEN** the owner refuses it without changing existing credential files or rows
- **AND** the application exposes a concrete storage failure and a route to credential settings

#### Scenario: Consent is revoked

- **WHEN** the user revokes plaintext permission
- **THEN** future plaintext writes are refused
- **AND** existing credentials are neither deleted nor automatically re-encrypted

#### Scenario: Permission cannot be persisted

- **WHEN** the consent metadata write fails
- **THEN** the operation does not grant in-memory permission that differs from the durable setting
- **AND** a pending credential write remains refused

### Requirement: Legacy reads preserve data

The owner SHALL read supported legacy file and database representations without rewriting or deleting them on read. A ciphertext decryption failure SHALL NOT be reinterpreted as plaintext.

#### Scenario: A keyring becomes available

- **WHEN** an existing legacy plaintext credential is read after keyring recovery
- **THEN** the owner reads it according to its stored representation
- **AND** it does not claim that the saved value became encrypted

#### Scenario: A keyring becomes unavailable

- **WHEN** existing ciphertext cannot be decrypted
- **THEN** the application reports that the credential is unavailable
- **AND** it preserves the stored bytes rather than returning them as a token or deleting them

### Requirement: Settings report policy and saved state separately

The application SHALL expose storage backend or failure reason, current new-write policy, and persisted consent through tRPC to a dedicated Credential storage settings page. Saved-credential storage labels SHALL describe the record rather than infer its mode from current keyring availability.

#### Scenario: Encryption recovers after a plaintext save

- **WHEN** a keyring becomes available after a credential was saved without encryption
- **THEN** settings reports encrypted policy for future writes
- **AND** the existing plaintext credential retains its unencrypted label until an explicit replacement or removal changes it

### Requirement: Secret references cross persistence boundaries

New renderer persistence SHALL contain credential references or non-secret metadata, not raw keys. Runtime and provider handoffs SHALL NOT create secondary plaintext stores for app-held secrets. Untouched legacy stores SHALL remain readable through a documented compatibility path.

#### Scenario: A renderer saves a replacement key

- **WHEN** the user saves a new or replacement key
- **THEN** the renderer sends it to the owner through the bounded secret-input procedure
- **AND** only a confirmed credential reference is persisted in renderer settings
- **AND** a refusal leaves the previously saved credential intact

#### Scenario: Native runtime receives an app credential

- **WHEN** the app authorizes a native runtime session with an app-held credential
- **THEN** the runtime uses a verified memory-only credential contract
- **AND** no provider credential config file is written as a side effect
- **AND** concurrent sessions cannot silently replace one another's credential selection

### Requirement: Refresh checks persistence policy before rotation

App-owned refresh SHALL check write authorization before sending a request that can rotate a token. It SHALL serialize refresh for a credential and preserve a recoverable result when storage fails after a response. External CLI refresh behavior SHALL follow the explicit ownership decision recorded before implementation.

#### Scenario: Refresh is not authorized to persist

- **WHEN** a refresh would require an unauthorized plaintext write
- **THEN** the app does not start that refresh request
- **AND** the existing credential remains untouched and usable until its actual expiry

### Requirement: Logs redact credentials at the sink

The application SHALL redact credentials before console, file-log, and error-boundary serialization. It SHALL NOT log token prefixes or lengths as diagnostics.

#### Scenario: A credential record reaches a log boundary

- **WHEN** a credential record or an error containing credential fields is logged
- **THEN** the serialized output contains redacted fields and no credential value
- **AND** regression tests exercise the actual log boundary
