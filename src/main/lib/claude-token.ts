/**
 * NOTE (transplant): the OAuth refresh flow below (correct Claude Code token
 * endpoint + client id + scopes, `getValidExistingClaudeToken` with
 * refresh-and-persist, expiry guards, execFileSync hardening,
 * subscription/rate-limit fields) was transplanted from erenbertr/1code
 * (Apache-2.0, © the 1Code contributors).
 */
import { execFileSync, execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { buildExtendedPath, isWindows } from "./platform";

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
    subscriptionType?: string | null;
    rateLimitTier?: string | null;
  };
}

export interface ClaudeOAuthCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  subscriptionType?: string | null;
  rateLimitTier?: string | null;
}

const CLAUDE_CODE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_CODE_OAUTH_SCOPES = [
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
];

/**
 * Read Claude OAuth credentials from system credential store
 * Dispatches to platform-specific implementation
 */
function readFromKeychain(): ClaudeOAuthCredential | null {
  if (process.platform === 'darwin') {
    return readFromMacOSKeychain();
  } else if (process.platform === 'win32') {
    return readFromWindowsCredentialManager();
  } else if (process.platform === 'linux') {
    return readFromLinuxSecretService();
  }
  return null;
}

/**
 * Read Claude OAuth credentials from macOS Keychain
 */
function readFromMacOSKeychain(): ClaudeOAuthCredential | null {
  try {
    const result = execFileSync(
      "security",
      [
        "find-generic-password",
        "-a",
        process.env.USER || userInfo().username,
        "-s",
        "Claude Code-credentials",
        "-w",
      ],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();

    if (result) {
      const credentials: ClaudeCredentials = JSON.parse(result);
      if (credentials.claudeAiOauth) {
        return {
          accessToken: credentials.claudeAiOauth.accessToken,
          refreshToken: credentials.claudeAiOauth.refreshToken,
          expiresAt: credentials.claudeAiOauth.expiresAt,
          scopes: credentials.claudeAiOauth.scopes,
          subscriptionType: credentials.claudeAiOauth.subscriptionType,
          rateLimitTier: credentials.claudeAiOauth.rateLimitTier,
        };
      }
    }
  } catch {
    // Keychain entry not found or parse error
  }
  return null;
}

/**
 * Read Claude OAuth credentials from Windows Credential Manager
 * Falls back to credentials file which Claude Code uses on Windows
 */
function readFromWindowsCredentialManager(): ClaudeOAuthCredential | null {
  try {
    // Read from the credentials file location that Claude Code uses on Windows
    const credentialsPath = join(homedir(), '.claude', '.credentials.json');
    if (existsSync(credentialsPath)) {
      const content = readFileSync(credentialsPath, 'utf-8');
      const credentials: ClaudeCredentials = JSON.parse(content);
      if (credentials.claudeAiOauth) {
        return {
          accessToken: credentials.claudeAiOauth.accessToken,
          refreshToken: credentials.claudeAiOauth.refreshToken,
          expiresAt: credentials.claudeAiOauth.expiresAt,
          scopes: credentials.claudeAiOauth.scopes,
          subscriptionType: credentials.claudeAiOauth.subscriptionType,
          rateLimitTier: credentials.claudeAiOauth.rateLimitTier,
        };
      }
    }
  } catch {
    // Credential Manager read failed
  }
  return null;
}

/**
 * Read Claude OAuth credentials from Linux Secret Service (libsecret)
 * Uses secret-tool CLI which interfaces with GNOME Keyring or KDE Wallet
 */
function readFromLinuxSecretService(): ClaudeOAuthCredential | null {
  try {
    // Try secret-tool (works with GNOME Keyring, KDE Wallet via libsecret)
    const result = execSync(
      'secret-tool lookup service "Claude Code" account "credentials" 2>/dev/null',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (result) {
      const credentials: ClaudeCredentials = JSON.parse(result);
      if (credentials.claudeAiOauth) {
        return {
          accessToken: credentials.claudeAiOauth.accessToken,
          refreshToken: credentials.claudeAiOauth.refreshToken,
          expiresAt: credentials.claudeAiOauth.expiresAt,
          scopes: credentials.claudeAiOauth.scopes,
          subscriptionType: credentials.claudeAiOauth.subscriptionType,
          rateLimitTier: credentials.claudeAiOauth.rateLimitTier,
        };
      }
    }
  } catch {
    // secret-tool not available or entry not found
  }

  // Fallback: try pass (password-store)
  try {
    const result = execSync(
      'pass show claude-code/credentials 2>/dev/null',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (result) {
      const credentials: ClaudeCredentials = JSON.parse(result);
      if (credentials.claudeAiOauth) {
        return {
          accessToken: credentials.claudeAiOauth.accessToken,
          refreshToken: credentials.claudeAiOauth.refreshToken,
          expiresAt: credentials.claudeAiOauth.expiresAt,
          scopes: credentials.claudeAiOauth.scopes,
          subscriptionType: credentials.claudeAiOauth.subscriptionType,
          rateLimitTier: credentials.claudeAiOauth.rateLimitTier,
        };
      }
    }
  } catch {
    // pass not available or entry not found
  }

  return null;
}

/**
 * Read Claude OAuth credentials from credentials file (Linux/fallback)
 */
function readFromCredentialsFile(): ClaudeOAuthCredential | null {
  const credentialsPath = join(homedir(), '.claude', '.credentials.json');

  try {
    if (existsSync(credentialsPath)) {
      const content = readFileSync(credentialsPath, 'utf-8');
      const credentials: ClaudeCredentials = JSON.parse(content);
      if (credentials.claudeAiOauth) {
        return {
          accessToken: credentials.claudeAiOauth.accessToken,
          refreshToken: credentials.claudeAiOauth.refreshToken,
          expiresAt: credentials.claudeAiOauth.expiresAt,
          scopes: credentials.claudeAiOauth.scopes,
          subscriptionType: credentials.claudeAiOauth.subscriptionType,
          rateLimitTier: credentials.claudeAiOauth.rateLimitTier,
        };
      }
    }
  } catch {
    // File not found or parse error
  }
  return null;
}

/**
 * Get existing Claude OAuth credentials from keychain or credentials file
 */
export function getExistingClaudeCredentials(): ClaudeOAuthCredential | null {
  // Try keychain first (macOS, Windows, Linux)
  const keychainCreds = readFromKeychain();
  if (keychainCreds) {
    return keychainCreds;
  }

  // Fall back to credentials file
  return readFromCredentialsFile();
}

/**
 * Get existing Claude OAuth token from keychain or credentials file
 * @deprecated Use getValidExistingClaudeToken() for auth paths that can await.
 */
export function getExistingClaudeToken(): string | null {
  const creds = getExistingClaudeCredentials();
  if (!creds?.accessToken) return null;
  return isPastExpiresAt(creds.expiresAt) ? null : creds.accessToken;
}

function serializeCredentials(creds: ClaudeOAuthCredential): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      expiresAt: creds.expiresAt,
      scopes: creds.scopes,
      subscriptionType: creds.subscriptionType,
      rateLimitTier: creds.rateLimitTier,
    },
  });
}

function writeToMacOSKeychain(creds: ClaudeOAuthCredential): boolean {
  try {
    execFileSync(
      "security",
      [
        "add-generic-password",
        "-a",
        process.env.USER || userInfo().username,
        "-s",
        "Claude Code-credentials",
        "-w",
        serializeCredentials(creds),
        "-U",
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    return true;
  } catch (error) {
    console.warn("[claude-token] Failed to update macOS Keychain:", error);
    return false;
  }
}

function writeToCredentialsFile(creds: ClaudeOAuthCredential): boolean {
  try {
    const credentialsPath = join(homedir(), ".claude", ".credentials.json");
    mkdirSync(join(homedir(), ".claude"), { recursive: true });
    writeFileSync(credentialsPath, serializeCredentials(creds), { mode: 0o600 });
    return true;
  } catch (error) {
    console.warn("[claude-token] Failed to update credentials file:", error);
    return false;
  }
}

function writeExistingClaudeCredentials(creds: ClaudeOAuthCredential): boolean {
  if (process.platform === "darwin") {
    return writeToMacOSKeychain(creds);
  }
  return writeToCredentialsFile(creds);
}

/**
 * Return a Claude OAuth token that is valid enough for SDK use.
 * Refreshes near-expired local Claude Code credentials and persists the
 * refreshed token so the desktop app does not fail after the CLI token rotates.
 */
export async function getValidExistingClaudeToken(): Promise<string | null> {
  const creds = getExistingClaudeCredentials();
  if (!creds) return null;

  if (!isTokenExpired(creds.expiresAt)) {
    return creds.accessToken;
  }

  if (!creds.refreshToken) {
    console.warn("[claude-token] Local Claude token is expired and has no refresh token");
    return isPastExpiresAt(creds.expiresAt) ? null : creds.accessToken;
  }

  try {
    console.log("[claude-token] Refreshing local Claude Code OAuth token");
    const refreshed = await refreshClaudeToken(creds.refreshToken, creds.scopes);
    const nextCreds: ClaudeOAuthCredential = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || creds.refreshToken,
      expiresAt: refreshed.expiresAt,
      scopes: refreshed.scopes || creds.scopes,
      subscriptionType: refreshed.subscriptionType ?? creds.subscriptionType,
      rateLimitTier: refreshed.rateLimitTier ?? creds.rateLimitTier,
    };
    writeExistingClaudeCredentials(nextCreds);
    return nextCreds.accessToken;
  } catch (error) {
    console.warn("[claude-token] Failed to refresh Claude OAuth token:", error);
    return isPastExpiresAt(creds.expiresAt) ? null : creds.accessToken;
  }
}

/**
 * Refresh Claude OAuth token using refresh token
 * Uses the Claude Code OAuth token endpoint
 */
export async function refreshClaudeToken(
  refreshToken: string,
  scopes: string[] = CLAUDE_CODE_OAUTH_SCOPES,
): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  subscriptionType?: string | null;
  rateLimitTier?: string | null;
}> {
  const requestedScopes =
    scopes.length > 0 ? scopes : CLAUDE_CODE_OAUTH_SCOPES;
  const response = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CLAUDE_CODE_CLIENT_ID,
      refresh_token: refreshToken,
      scope: requestedScopes.join(" "),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to refresh Claude token: ${error}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    subscription_type?: string | null;
    rate_limit_tier?: string | null;
    token_type?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    scopes: data.scope?.split(" ").filter(Boolean),
    subscriptionType: data.subscription_type,
    rateLimitTier: data.rate_limit_tier,
  };
}

/**
 * Check if a token is expired or will expire soon (within 5 minutes)
 */
export function isTokenExpired(expiresAt?: number): boolean {
  if (!expiresAt) {
    // If no expiry, assume token is still valid
    return false;
  }
  // Consider expired if less than 5 minutes remaining
  const bufferMs = 5 * 60 * 1000;
  return Date.now() + bufferMs >= expiresAt;
}

function isPastExpiresAt(expiresAt?: number): boolean {
  return !!expiresAt && Date.now() >= expiresAt;
}

/**
 * Build extended PATH with common installation locations
 * This is necessary because when running from Finder/Dock (macOS) or
 * Start Menu (Windows), the PATH may not include directories where
 * claude CLI is installed
 *
 * Delegates to platform provider for cross-platform support.
 */
function getExtendedPath(): string {
  return buildExtendedPath(process.env.PATH);
}

/**
 * Check if Claude CLI is installed (cross-platform)
 * Uses extended PATH to find claude even when running from Finder/Dock
 */
export function isClaudeCliInstalled(): boolean {
  try {
    // Use 'where' on Windows, 'which' on Unix-like systems
    const command = isWindows() ? 'where claude' : 'which claude';
    const fullPath = getExtendedPath();

    execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: fullPath }
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `claude setup-token` to authenticate with Claude
 * Returns a promise that resolves when the process completes
 *
 * Note: Uses pipe for stdio instead of inherit to prevent hanging in non-TTY
 * environments (like Electron apps launched from Finder/Dock)
 */
export function runClaudeSetupToken(
  onStatus: (message: string) => void
): Promise<{ success: boolean; token?: string; error?: string }> {
  return new Promise((resolve) => {
    onStatus('Starting Claude setup-token...');

    const fullPath = getExtendedPath();

    const child = spawn('claude', ['setup-token'], {
      // Don't use 'inherit' - it causes hang in non-TTY environments
      // Use 'ignore' for stdin and 'pipe' for stdout/stderr
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, PATH: fullPath },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      onStatus(text.trim());
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Timeout after 2 minutes to prevent indefinite hang
    const timeout = setTimeout(() => {
      child.kill();
      resolve({
        success: false,
        error: 'Authentication timed out after 2 minutes. Please try again.',
      });
    }, 120000);

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        error: `Failed to start claude setup-token: ${err.message}`,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);

      if (code === 0) {
        // Wait a moment for the token to be written to keychain
        setTimeout(() => {
          const token = getExistingClaudeToken();
          if (token) {
            resolve({ success: true, token });
          } else {
            resolve({
              success: false,
              error: 'Token not found after setup. The authentication may have failed.',
            });
          }
        }, 500);
      } else {
        const errorDetail = stderr.trim() || `Process exited with code ${code}`;
        resolve({
          success: false,
          error: errorDetail,
        });
      }
    });
  });
}
