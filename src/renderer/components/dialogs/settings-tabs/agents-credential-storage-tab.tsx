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
import {
  browserRow,
  type ProtectionVerdict,
  protectionDetail,
  protectionHeadline,
  protectionVerdict,
  type RowState,
  type StatusData,
  storedDetail,
  storedState,
  UNKNOWN_DETAIL,
} from "./credential-storage-state"

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
    onSuccess: (result) => {
      // The mutation answers with the state it wrote, so the page shows that
      // answer rather than the cached one while the status query refetches.
      utils.secretStorage.status.setData(undefined, (old) => (old ? { ...old, ...result } : old))
      void utils.secretStorage.status.invalidate()
      void utils.secretStorage.rendererSecrets.invalidate()
    },
  })

  const data: StatusData | undefined = status.data
  // The page states a verdict only from a status the main process confirmed.
  const verdict = protectionVerdict(data, status.error)

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col space-y-1.5 text-center sm:text-left">
        <h3 className="text-sm font-semibold text-foreground">Credential storage</h3>
        <p className="text-xs text-muted-foreground">
          Where this app keeps your sign-in and provider keys, and whether the operating system
          protects them.
        </p>
      </div>

      <ProtectionCard
        isLoading={status.isLoading}
        verdict={verdict}
        loadError={status.error instanceof Error ? status.error.message : null}
        data={data}
        pending={setConsent.isPending}
        onEnable={() => setConfirmOpen(true)}
        onDisable={() => setConsent.mutate({ consent: false })}
      />

      <InventoryCard verdict={verdict} data={data} />

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
        <p className="text-xs text-red-600 dark:text-red-400">
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
        aria-busy={status.isFetching}
      >
        <RefreshCw className={cn("mr-2 h-4 w-4", status.isFetching && "animate-spin")} />
        Check again
      </Button>
    </div>
  )
}

function ProtectionCard({
  isLoading,
  verdict,
  loadError,
  data,
  pending,
  onEnable,
  onDisable,
}: {
  readonly isLoading: boolean
  /** The state the main process confirmed, with no verdict while it has not. */
  readonly verdict: ProtectionVerdict
  /** Message from a failed status query, which is not a keyring verdict. */
  readonly loadError: string | null
  readonly data: StatusData | undefined
  readonly pending: boolean
  readonly onEnable: () => void
  readonly onDisable: () => void
}) {
  const { unknown, protectedByOs, consentOn } = verdict
  const headline = protectionHeadline(isLoading, verdict)
  const detail = protectionDetail(isLoading, verdict, loadError, data)

  return (
    <div className="bg-background rounded-lg border border-border overflow-hidden">
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
              keyringTileClass(verdict),
            )}
          >
            {protectedByOs ? (
              <ShieldCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
            ) : (
              <ShieldOff
                className={cn(
                  "h-4 w-4",
                  unknown ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400",
                )}
              />
            )}
          </div>
          <div className="flex min-w-0 flex-col space-y-1">
            {/* `<output>` carries the implicit status role, which is what the
                announcement needs, and it is the element SonarCloud's S6819 asks
                for in place of the explicit attribute. */}
            <output className="text-sm font-medium text-foreground">{headline}</output>
            <span className="text-xs text-muted-foreground break-words">{detail}</span>
          </div>
        </div>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border p-4">
        <div className="flex min-w-0 flex-col space-y-1">
          <label htmlFor="plaintext-consent" className="text-sm font-medium text-foreground">
            Allow plaintext when encryption is not available
          </label>
          <span id="plaintext-consent-description" className="text-xs text-muted-foreground">
            Without this, a credential that cannot be encrypted is not saved at all and the app
            tells you why. With it, that credential is written in the clear.
          </span>
        </div>
        {/* Without a status there is no answer to show and no verdict to act on,
            so the switch waits for one rather than display a state the app has
            not read. */}
        <Switch
          id="plaintext-consent"
          checked={consentOn}
          disabled={pending || unknown}
          aria-describedby="plaintext-consent-description"
          onCheckedChange={(checked) => (checked ? onEnable() : onDisable())}
        />
      </div>

      {consentOn && (
        <div className="border-t border-border bg-amber-500/10 p-4">
          {/* Sign-out removes the session files and their plaintext companion.
              Provider files written under this permission are untouched, so the
              sentence names which files sign-out reaches. */}
          <p className="text-xs text-foreground break-words">
            Plaintext permission is on
            {data?.plaintextConsentAt
              ? `, granted ${new Date(data.plaintextConsentAt).toLocaleString()}`
              : ""}
            . Files written under this permission stay on disk after you turn it off. Signing out
            removes the sign-in files; provider keys stay until you remove them.
          </p>
        </div>
      )}
    </div>
  )
}

function InventoryCard({
  verdict,
  data,
}: {
  /** The state the main process confirmed, with no verdict while it has not. */
  readonly verdict: ProtectionVerdict
  readonly data: StatusData | undefined
}) {
  const { unknown } = verdict
  const store = browserRow(data, verdict)
  // A failed status query keeps the last answer in the cache, so every row reads
  // its own failure only from a status the main process confirmed.
  const providerReadErrors = unknown ? [] : (data?.providerReadErrors ?? [])
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
            unknown
              ? UNKNOWN_DETAIL
              : (data?.signInFailure ??
                storedDetail(
                  verdict,
                  "The next sign-in is encrypted by the OS keyring.",
                  "The next sign-in is written in plaintext, because you allowed it.",
                  "A new sign-in is not written when it cannot be encrypted.",
                ))
          }
          state={storedState(verdict, unknown ? null : (data?.signInFailure ?? null), "Failed")}
        />
        <StorageRow
          label="Provider keys and accounts"
          detail={
            unknown
              ? UNKNOWN_DETAIL
              : (providerIssue ??
                storedDetail(
                  verdict,
                  "New keys are encrypted by the OS keyring.",
                  "New keys are written in plaintext, because you allowed it.",
                  "Existing keys stay readable; new ones are refused.",
                ))
          }
          state={storedState(verdict, unknown ? null : providerIssue, "Unreadable")}
        />
        <StorageRow
          label="Claude CLI credentials"
          detail="Owned by the Claude CLI. Renewal writes to its own store, and a plaintext credential file is only updated when plaintext storage is allowed."
          state={{ tone: "mute", label: "CLI-owned" }}
        />
        {/* The app clears this folder before the daemon starts and after it
            stops, but a daemon the manager restarts after a crash is not cleared
            again, so this sentence claims only the bound that holds every time. */}
        <StorageRow
          label="Runtime provider files"
          detail="The native runtime writes a key it is handed as a plaintext file in the app's private folder. The app clears that folder before the runtime starts and after it stops. If the runtime restarts itself after a crash, that file can stay until you quit the app."
          state={{ tone: "warn", label: "Plaintext during a run" }}
        />
        <StorageRow label="App credential store" detail={store.detail} state={store.state} />
      </ul>
    </div>
  )
}

/**
 * The wash behind the keyring icon. It is muted while the status is not known,
 * because neither the protected nor the unprotected wash is true then.
 */
function keyringTileClass(verdict: ProtectionVerdict): string {
  if (verdict.unknown) return "bg-muted"
  return verdict.protectedByOs ? "bg-emerald-500/10" : "bg-amber-500/10"
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
      <div className="flex min-w-0 flex-col space-y-1">
        <span className="text-sm text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground break-words">{detail}</span>
      </div>
      <StatusPill tone={state.tone} className="mt-0.5 shrink-0">
        {state.label}
      </StatusPill>
    </li>
  )
}
