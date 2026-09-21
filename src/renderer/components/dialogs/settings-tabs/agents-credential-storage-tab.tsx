import { KeyRound, Loader2, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react"
import { useState } from "react"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../ui/alert-dialog"
import { Button } from "../../ui/button"
import { StatusPill } from "../../ui/status-pill"
import { Switch } from "../../ui/switch"

/**
 * What this page reads from the status query. The assignment in the component
 * is a compile-time check: a field the router stops returning fails there.
 */
type StatusData = {
  protection: "os-encryption" | "hardcoded-key" | "plaintext"
  encryptionAvailable: boolean
  plaintextConsent: boolean
  plaintextConsentAt?: string | null
  reason: string
  backend: string | null
  metadataError: string | null
  signInFailure: string | null
  providerReadErrors: { provider: string; error: string }[]
  rendererError: string | null
  rendererKeysStored: string[]
}

/**
 * One page for every credential the app holds and how it is protected.
 *
 * The status comes from the main process, which owns the only encryption call,
 * so this page never claims protection it cannot see. Plaintext storage is a
 * choice the user makes here, and the choice is what the writers check.
 */
export function AgentsCredentialStorageTab() {
  const utils = trpc.useUtils()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const status = trpc.secretStorage.status.useQuery()
  const setConsent = trpc.secretStorage.setPlaintextConsent.useMutation({
    onSuccess: () => {
      void utils.secretStorage.status.invalidate()
      void utils.secretStorage.rendererSecrets.invalidate()
    },
  })

  const data: StatusData | undefined = status.data
  const protectedByOs = data?.protection === "os-encryption" && data.encryptionAvailable === true
  const consentOn = data?.plaintextConsent === true

  return (
    <div className="space-y-6">
      <div className="flex flex-col space-y-1">
        <h3 className="text-sm font-semibold text-foreground">Credential storage</h3>
        <p className="text-xs text-muted-foreground">
          Where this app keeps your sign-in and provider keys, and whether the operating system
          protects them.
        </p>
      </div>

      <ProtectionCard
        isLoading={status.isLoading}
        protectedByOs={protectedByOs}
        consentOn={consentOn}
        data={data}
        pending={setConsent.isPending}
        onEnable={() => setConfirmOpen(true)}
        onDisable={() => setConsent.mutate({ consent: false })}
      />

      <InventoryCard protectedByOs={protectedByOs} consentOn={consentOn} data={data} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Allow plaintext credential storage?</AlertDialogTitle>
            <AlertDialogDescription>
              Credentials that cannot be encrypted will be written in the clear on this computer.
              Any program running as you can read them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogBody>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li>Existing encrypted credentials are not changed or removed.</li>
              <li>Nothing is deleted if you turn this off later.</li>
              <li>Files already written in the clear stay until you remove them.</li>
            </ul>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConsent.mutate({ consent: true })
                setConfirmOpen(false)
              }}
            >
              Allow plaintext
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <KeyRound className="h-3.5 w-3.5" />
        <span>
          The app never deletes a saved credential because encryption is unavailable. If a
          credential cannot be read, it is left in place and reported here.
        </span>
      </div>

      {setConsent.isError && (
        <p className="text-xs text-destructive">
          {setConsent.error instanceof Error
            ? setConsent.error.message
            : "The plaintext setting could not be changed."}
        </p>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={() => void status.refetch()}
        disabled={status.isFetching}
      >
        <RefreshCw className={cn("mr-2 h-4 w-4", status.isFetching && "animate-spin")} />
        Check again
      </Button>
    </div>
  )
}

function ProtectionCard({
  isLoading,
  protectedByOs,
  consentOn,
  data,
  pending,
  onEnable,
  onDisable,
}: {
  readonly isLoading: boolean
  readonly protectedByOs: boolean
  readonly consentOn: boolean
  readonly data: StatusData | undefined
  readonly pending: boolean
  readonly onEnable: () => void
  readonly onDisable: () => void
}) {
  const headline = protectionHeadline(isLoading, protectedByOs, consentOn)
  const detail = protectedByOs
    ? "The app writes sign-in tokens and provider keys through the OS keyring. Existing credentials keep working."
    : describeRefusal(data?.reason, data?.backend, data?.metadataError ?? null)

  return (
    <div className="bg-background rounded-lg border border-border overflow-hidden">
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "mt-0.5 flex h-8 w-8 items-center justify-center rounded-md",
              protectedByOs ? "bg-emerald-500/10" : "bg-amber-500/10",
            )}
          >
            {protectedByOs ? (
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <ShieldOff className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            )}
          </div>
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">{headline}</span>
            <span className="text-xs text-muted-foreground">{detail}</span>
          </div>
        </div>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border p-4">
        <div className="flex flex-col space-y-1">
          <label htmlFor="plaintext-consent" className="text-sm font-medium text-foreground">
            Allow plaintext when encryption is not available
          </label>
          <span id="plaintext-consent-description" className="text-xs text-muted-foreground">
            Without this, a credential that cannot be encrypted is not saved at all and the app
            tells you why. With it, that credential is written in the clear.
          </span>
        </div>
        <Switch
          id="plaintext-consent"
          checked={consentOn}
          disabled={pending}
          aria-describedby="plaintext-consent-description"
          onCheckedChange={(checked) => (checked ? onEnable() : onDisable())}
        />
      </div>

      {consentOn && (
        <div className="border-t border-border bg-amber-500/10 p-4">
          <p className="text-xs text-muted-foreground">
            Plaintext permission is on
            {data?.plaintextConsentAt
              ? `, granted ${new Date(data.plaintextConsentAt).toLocaleString()}`
              : ""}
            . Files written under this permission stay on disk after you turn it off, until you
            remove them or sign out.
          </p>
        </div>
      )}
    </div>
  )
}

function protectionHeadline(
  isLoading: boolean,
  protectedByOs: boolean,
  consentOn: boolean,
): string {
  if (isLoading) return "Checking the OS keyring..."
  if (protectedByOs) return "New credentials are encrypted by the operating system"
  if (consentOn) return "New credentials are stored in plaintext because you allowed it"
  return "The operating system cannot encrypt new credentials"
}

function InventoryCard({
  protectedByOs,
  consentOn,
  data,
}: {
  readonly protectedByOs: boolean
  readonly consentOn: boolean
  readonly data: StatusData | undefined
}) {
  const stored = data?.rendererKeysStored?.length ?? 0
  const rendererDetail = describeRendererStorage(data?.rendererError ?? null, stored)
  const providerReadErrors = data?.providerReadErrors ?? []
  const providerIssue =
    providerReadErrors.length > 0
      ? providerReadErrors.map(({ provider, error }) => `${provider}: ${error}`).join(" ")
      : null

  return (
    <div className="bg-background rounded-lg border border-border overflow-hidden">
      <div className="p-4">
        <h4 className="text-sm font-medium text-foreground">What is protected right now</h4>
      </div>
      <ul className="divide-y divide-border border-t border-border">
        <StorageRow
          label="Sign-in session"
          detail={
            data?.signInFailure ??
            storedDetail(
              protectedByOs,
              consentOn,
              "The next sign-in is encrypted by the OS keyring.",
              "The next sign-in is written in plaintext, because you allowed it.",
              "A new sign-in is not written when it cannot be encrypted.",
            )
          }
          state={storedState(protectedByOs, consentOn, data?.signInFailure ?? null)}
        />
        <StorageRow
          label="Provider keys and accounts"
          detail={
            providerIssue ??
            storedDetail(
              protectedByOs,
              consentOn,
              "New keys are encrypted by the OS keyring.",
              "New keys are written in plaintext, because you allowed it.",
              "Existing keys stay readable; new ones are refused.",
            )
          }
          state={storedState(protectedByOs, consentOn, providerIssue)}
        />
        <StorageRow
          label="Claude CLI credentials"
          detail="Owned by the Claude CLI. Renewal writes to its own store, and a plaintext credential file is only updated when plaintext storage is allowed."
          state={{ tone: "mute", label: "CLI-owned" }}
        />
        <StorageRow
          label="Runtime provider files"
          detail="The native runtime writes a key it is handed as a plaintext file in the app's private folder. The app clears that folder before the runtime starts and after it stops, so a key does not survive a run."
          state={{ tone: "warn", label: "Plaintext during a run" }}
        />
        <StorageRow
          label="Browser storage"
          detail={rendererDetail}
          state={browserState(data?.rendererError ?? null, stored)}
        />
      </ul>
    </div>
  )
}

/** One pill for every row: the tone names the state, the label names it in words. */
type RowState = { tone: "ok" | "warn" | "bad" | "mute"; label: string }

/**
 * The state of the next write, not a claim about what is already saved: the
 * main process reports stored read errors rather than a protection level per
 * file, and a value written before this policy existed keeps working.
 */
function storedState(protectedByOs: boolean, consentOn: boolean, error: string | null): RowState {
  if (error) return { tone: "bad", label: "Unreadable" }
  if (protectedByOs) return { tone: "ok", label: "New: encrypted" }
  return consentOn
    ? { tone: "warn", label: "New: plaintext" }
    : { tone: "warn", label: "New: refused" }
}

function browserState(error: string | null, stored: number): RowState {
  if (error) return { tone: "bad", label: "Unreadable" }
  return stored > 0
    ? { tone: "ok", label: "Moved to the app store" }
    : { tone: "ok", label: "Not in use" }
}

function describeRendererStorage(error: string | null, stored: number): string {
  if (error) return error
  if (stored > 0) return `${stored} value(s) moved out of browser storage into this app's store`
  return "No provider key is kept in browser storage"
}

function storedDetail(
  protectedByOs: boolean,
  consentOn: boolean,
  encrypted: string,
  allowed: string,
  refused: string,
): string {
  if (protectedByOs) return encrypted
  return consentOn ? allowed : refused
}

function describeRefusal(
  reason: string | undefined,
  backend: string | null | undefined,
  detail: string | null,
): string {
  switch (reason) {
    case "hardcoded-key-backend":
      return "This Linux session uses the keyring's basic_text backend, which encrypts with a fixed key that is not a secret. New credentials are treated as unprotected."
    case "metadata-unreadable":
      return detail ?? "The plaintext setting could not be read, so no new credential is written."
    case "encryption-unavailable":
      return backend
        ? `The OS keyring (${backend}) is not available right now. Unlock it and check again; saved credentials are untouched.`
        : "No OS keyring is available right now. Sign in to the keyring and check again; saved credentials are untouched."
    case "ready":
      return "The OS keyring is available."
    default:
      return "The state of the OS keyring could not be read."
  }
}

function StorageRow({
  label,
  detail,
  state,
}: {
  readonly label: string
  readonly detail: string
  readonly state: RowState
}) {
  return (
    <li className="flex items-start justify-between gap-4 p-4">
      <div className="flex flex-col space-y-1">
        <span className="text-sm text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </div>
      <StatusPill tone={state.tone} className="mt-0.5 shrink-0">
        {state.label}
      </StatusPill>
    </li>
  )
}
