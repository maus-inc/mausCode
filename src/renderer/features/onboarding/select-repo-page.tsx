"use client"

import { useAtom } from "jotai"
import { useState } from "react"

import { GitHubIcon } from "../../components/ui/icons"
import { Logo } from "../../components/ui/logo"
import { trpc } from "../../lib/trpc"
import { selectedProjectAtom } from "../agents/atoms"
import { OnboardingButton } from "./components/onboarding-button"
import { OnboardingCodeInput } from "./components/onboarding-code-input"
import { OnboardingHeader } from "./components/onboarding-header"
import { OnboardingShell } from "./components/onboarding-shell"

export function SelectRepoPage() {
  const [, setSelectedProject] = useAtom(selectedProjectAtom)
  const [showClonePage, setShowClonePage] = useState(false)
  const [githubUrl, setGithubUrl] = useState("")

  // Get tRPC utils for cache management
  const utils = trpc.useUtils()

  // Open folder mutation
  const openFolder = trpc.projects.openFolder.useMutation({
    onSuccess: (project) => {
      if (project) {
        // Optimistically update the projects list cache
        utils.projects.list.setData(undefined, (oldData) => {
          if (!oldData) return [project]
          const exists = oldData.some((p) => p.id === project.id)
          if (exists) {
            return oldData.map((p) =>
              p.id === project.id ? { ...p, updatedAt: project.updatedAt } : p,
            )
          }
          return [project, ...oldData]
        })

        setSelectedProject({
          id: project.id,
          name: project.name,
          path: project.path,
          gitRemoteUrl: project.gitRemoteUrl,
          gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
          gitOwner: project.gitOwner,
          gitRepo: project.gitRepo,
        })
      }
    },
  })

  // Clone from GitHub mutation
  const cloneFromGitHub = trpc.projects.cloneFromGitHub.useMutation({
    onSuccess: (project) => {
      if (project) {
        utils.projects.list.setData(undefined, (oldData) => {
          if (!oldData) return [project]
          const exists = oldData.some((p) => p.id === project.id)
          if (exists) {
            return oldData.map((p) =>
              p.id === project.id ? { ...p, updatedAt: project.updatedAt } : p,
            )
          }
          return [project, ...oldData]
        })

        setSelectedProject({
          id: project.id,
          name: project.name,
          path: project.path,
          gitRemoteUrl: project.gitRemoteUrl,
          gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
          gitOwner: project.gitOwner,
          gitRepo: project.gitRepo,
        })
        setShowClonePage(false)
        setGithubUrl("")
      }
    },
  })

  const handleOpenFolder = async () => {
    await openFolder.mutateAsync()
  }

  const handleCloneFromGitHub = async () => {
    if (!githubUrl.trim()) return
    await cloneFromGitHub.mutateAsync({ repoUrl: githubUrl.trim() })
  }

  const handleBack = () => {
    if (cloneFromGitHub.isPending) return
    setShowClonePage(false)
    setGithubUrl("")
  }

  // Clone from GitHub page
  if (showClonePage) {
    return (
      <OnboardingShell onBack={handleBack} backDisabled={cloneFromGitHub.isPending}>
        <OnboardingHeader
          icon={
            <div className="flex items-center justify-center gap-2 p-2 mx-auto w-max rounded-full border border-border">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                <Logo className="w-5 h-5 invert" />
              </div>
              <div className="w-10 h-10 rounded-full bg-foreground flex items-center justify-center">
                <GitHubIcon className="w-5 h-5 text-background" />
              </div>
            </div>
          }
          title="Clone from GitHub"
          subtitle="Enter a repository URL or owner/repo"
        />

        {/* Input */}
        <div className="space-y-4">
          <OnboardingCodeInput
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && githubUrl.trim()) {
                handleCloneFromGitHub()
              }
            }}
            placeholder="owner/repo"
            busy={cloneFromGitHub.isPending}
            mono={false}
          />
          <p className="text-xs text-muted-foreground text-center">
            Example: facebook/react or https://github.com/facebook/react
          </p>
        </div>
      </OnboardingShell>
    )
  }

  // Main select repo page
  return (
    <OnboardingShell>
      <OnboardingHeader
        icon={
          <div className="flex items-center justify-center mx-auto w-max">
            <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center">
              <Logo className="w-6 h-6 invert" />
            </div>
          </div>
        }
        title="Select a repository"
        subtitle="Choose a local folder to start working with"
      />

      {/* Content */}
      <div className="space-y-3">
        <OnboardingButton
          onClick={handleOpenFolder}
          disabled={openFolder.isPending}
          loading={openFolder.isPending}
          className="w-full px-4"
        >
          Select folder
        </OnboardingButton>
        <OnboardingButton
          variant="muted"
          ring
          onClick={() => setShowClonePage(true)}
          disabled={cloneFromGitHub.isPending}
          loading={cloneFromGitHub.isPending}
          className="w-full px-4"
        >
          Clone from GitHub
        </OnboardingButton>
      </div>
    </OnboardingShell>
  )
}
