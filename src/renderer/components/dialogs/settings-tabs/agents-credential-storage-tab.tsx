import { KeyRound, Loader2, ShieldCheck, ShieldOff } from "lucide-react"
import { useState } from "react"
import { clearRendererSecretFailure } from "../../../lib/renderer-secrets"
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
import { Switch } from "../../ui/switch"

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
      clearRendererSecretFailure()
      void utils.secretStorage.status.invalidate()
      void utils.secretStorage.rendererSecrets.invalidate()
    },
  })

  const data = status.data
  const protection = data?.protection ?? "plaintext"
  const protectedByOs = protection === "os-encryption" && data?.encryptionAvailable === true
  const consentOn = data?.plaintextConsent === true
  const refusalReason = data?.metadataError ?? data?.reason ?? null

  return (
    <div className="space-y-6">
      <div className="flex flex-col space-y-1">
        <h3 className="text-sm font-semibold text-foreground">Credential storage</h3>
        <p className="text-xs text-muted-foreground">
          Where this app keeps your sign-in and provider keys, and whether the operating system
          protects them.
        </p>
      </div>

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
              <span className="text-sm font-medium text-foreground">
                {status.isLoading
                  ? "Checking the OS keyring..."
                  : protectedByOs
                    ? "New credentials are encrypted by the operating system"
                    : "The operating system cannot encrypt new credentials"}
              </span>
              <span className="text-xs text-muted-foreground">
                {protectedByOs
                  ? "The app writes sign-in tokens and provider keys through the OS keyring. Existing credentials keep working."
                  : describeRefusal(data?.reason, data?.backend, refusalReason)}
              </span>
            </div>
          </div>
          {status.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border p-4">
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">
              Allow plaintext when encryption is not available
            </span>
            <span className="text-xs text-muted-foreground">
              Without this, a credential that cannot be encrypted is not saved at all and the app
              tells you why. With it, that credential is written in the clear.
            </span>
          </div>
          <Switch
            checked={consentOn}
            disabled={setConsent.isPending}
            onCheckedChange={(checked) => {
              if (checked) {
                setConfirmOpen(true)
                return
              }
              setConsent.mutate({ consent: false })
            }}
          />
        </div>

        {consentOn && (
          <div className="border-t border-border bg-amber-500/5 p-4">
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

      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div className="p-4">
          <h4 className="text-sm font-medium text-foreground">What is protected right now</h4>
        </div>
        <ul className="divide-y divide-border border-t border-border">
          <StorageRow
            label="Sign-in session"
            detail={
              data?.signInFailure
                ? data.signInFailure
                : protectedByOs
                  ? "Encrypted by the OS keyring"
                  : consentOn
                    ? "Plaintext, because you allowed it"
                    : "Not written when a new session cannot be encrypted"
            }
            ok={protectedByOs}
          />
          <StorageRow
            label="Provider keys and accounts"
            detail={
              protectedByOs
                ? "Encrypted by the OS keyring"
                : consentOn
                  ? "Plaintext, because you allowed it"
                  : "Existing keys stay readable; new ones are refused"
            }
            ok={protectedByOs}
          />
          <StorageRow
            label="Claude CLI credentials"
            detail="Owned by the Claude CLI. Renewal writes to its own store, and a plaintext credential file is only updated when plaintext storage is allowed."
            ok={false}
          />
          <StorageRow
            label="Runtime provider files"
            detail="The native runtime writes a key it is handed as a plaintext file in the app's private folder. The app clears that folder before the runtime starts and after it stops, so a key does not survive a run."
            ok={false}
          />
          <StorageRow
            label="Browser storage"
            detail={
              data?.rendererError
                ? data.rendererError
                : (data?.rendererKeysStored?.length ?? 0) > 0
                  ? `${data?.rendererKeysStored?.length} value(s) moved out of browser storage into this app's store`
                  : "No provider key is kept in browser storage"
            }
            ok={!data?.rendererError}
          />
        </ul>
      </div>

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

      <Button variant="ghost" size="sm" onClick={() => void status.refetch()}>
        Check again
      </Button>
    </div>
  )
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

function StorageRow({ label, detail, ok }: { label: string; detail: string; ok: boolean }) {
  return (
    <li className="flex items-start justify-between gap-4 p-4">
      <div className="flex flex-col space-y-1">
        <span className="text-sm text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </div>
      <span
        className={cn(
          "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
          ok
            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            : "bg-muted text-muted-foreground",
        )}
      >
        {ok ? "Encrypted" : "See notes"}
      </span>
    </li>
  )
}
