import { useState, useEffect, useCallback, useRef } from "react"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { Button } from "../../ui/button"
import { IconSpinner } from "../../../icons"
import { toast } from "sonner"
import { trpc } from "../../../lib/trpc"

// Hook to detect narrow screen
function useIsNarrowScreen(): boolean {
  const [isNarrow, setIsNarrow] = useState(false)

  useEffect(() => {
    const checkWidth = () => {
      setIsNarrow(window.innerWidth <= 768)
    }

    checkWidth()
    window.addEventListener("resize", checkWidth)
    return () => window.removeEventListener("resize", checkWidth)
  }, [])

  return isNarrow
}

interface DesktopUser {
  id: string
  email: string
  name: string | null
  imageUrl: string | null
  username: string | null
}

export function AgentsProfileTab() {
  const [user, setUser] = useState<DesktopUser | null>(null)
  const [fullName, setFullName] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const isNarrowScreen = useIsNarrowScreen()
  const savedNameRef = useRef("")

  const utils = trpc.useUtils()
  const { data: githubAuth } = trpc.github.getAuthStatus.useQuery()
  const setGithubToken = trpc.github.setToken.useMutation()
  const clearGithubToken = trpc.github.clearToken.useMutation()
  const [githubTokenInput, setGithubTokenInput] = useState("")
  const [githubBusy, setGithubBusy] = useState(false)

  const handleSaveGithubToken = useCallback(async () => {
    const trimmed = githubTokenInput.trim()
    if (!trimmed) return
    setGithubBusy(true)
    try {
      await setGithubToken.mutateAsync({ token: trimmed })
      setGithubTokenInput("")
      toast.success("GitHub token saved")
      await utils.github.getAuthStatus.invalidate()
      await utils.github.commitStats.invalidate()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save token",
      )
    } finally {
      setGithubBusy(false)
    }
  }, [githubTokenInput, setGithubToken, utils])

  const handleClearGithubToken = useCallback(async () => {
    setGithubBusy(true)
    try {
      await clearGithubToken.mutateAsync()
      toast.success("GitHub token removed")
      await utils.github.getAuthStatus.invalidate()
      await utils.github.commitStats.invalidate()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to clear token",
      )
    } finally {
      setGithubBusy(false)
    }
  }, [clearGithubToken, utils])

  // Fetch real user data from desktop API
  useEffect(() => {
    async function fetchUser() {
      if (window.desktopApi?.getUser) {
        const userData = await window.desktopApi.getUser()
        setUser(userData)
        setFullName(userData?.name || "")
        savedNameRef.current = userData?.name || ""
      }
      setIsLoading(false)
    }
    fetchUser()
  }, [])

  const handleBlurSave = useCallback(async () => {
    const trimmed = fullName.trim()
    if (trimmed === savedNameRef.current) return
    try {
      if (window.desktopApi?.updateUser) {
        const updatedUser = await window.desktopApi.updateUser({ name: trimmed })
        if (updatedUser) {
          setUser(updatedUser)
          savedNameRef.current = updatedUser.name || ""
          setFullName(updatedUser.name || "")
        }
      }
    } catch (error) {
      console.error("Error updating profile:", error)
      toast.error(
        error instanceof Error ? error.message : "Failed to update profile"
      )
    }
  }, [fullName])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <IconSpinner className="h-6 w-6" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Profile Settings Card */}
      <div className="space-y-2">
        {/* Header - hidden on narrow screens since it's in the navigation bar */}
        {!isNarrowScreen && (
          <div className="flex items-center justify-between pb-3 mb-4">
            <h3 className="text-sm font-medium text-foreground">Account</h3>
          </div>
        )}
        <div className="bg-background rounded-lg border border-border overflow-hidden">
          {/* Full Name Field */}
          <div className="flex items-center justify-between p-4">
            <div className="flex-1">
              <Label className="text-sm font-medium">Full Name</Label>
              <p className="text-sm text-muted-foreground">
                This is your display name
              </p>
            </div>
            <div className="flex-shrink-0 w-80">
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                onBlur={handleBlurSave}
                className="w-full"
                placeholder="Enter your name"
              />
            </div>
          </div>

          {/* Email Field (read-only) */}
          <div className="flex items-center justify-between p-4 border-t border-border">
            <div className="flex-1">
              <Label className="text-sm font-medium">Email</Label>
              <p className="text-sm text-muted-foreground">
                Your account email
              </p>
            </div>
            <div className="flex-shrink-0 w-80">
              <Input
                value={user?.email || ""}
                disabled
                className="w-full opacity-60"
              />
            </div>
          </div>

          {/* GitHub Token Field */}
          <div className="flex items-start justify-between p-4 border-t border-border gap-4">
            <div className="flex-1 min-w-0">
              <Label className="text-sm font-medium">GitHub Token</Label>
              <p className="text-sm text-muted-foreground">
                Personal access token with{" "}
                <span className="font-mono text-xs">read:user</span> scope.
                Used to count your commits in the sidebar.
              </p>
              {githubAuth?.ok && githubAuth.hasToken && (
                <p className="text-xs text-muted-foreground mt-1">
                  Saved:{" "}
                  <span className="font-mono">{githubAuth.maskedToken}</span>
                </p>
              )}
            </div>
            <div className="flex-shrink-0 w-80 space-y-2">
              <Input
                type="password"
                value={githubTokenInput}
                onChange={(e) => setGithubTokenInput(e.target.value)}
                placeholder={
                  githubAuth?.ok && githubAuth.hasToken
                    ? "Enter new token to replace"
                    : "ghp_..."
                }
                className="w-full"
                disabled={githubBusy}
              />
              <div className="flex gap-2 justify-end">
                {githubAuth?.ok && githubAuth.hasToken && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearGithubToken}
                    disabled={githubBusy}
                  >
                    Remove
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={handleSaveGithubToken}
                  disabled={githubBusy || !githubTokenInput.trim()}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>

        </div>
      </div>

    </div>
  )
}
