export {
  type FileChange,
  type FileChangeType,
  type GitWatchEvent,
  GitWatcher,
  gitWatcherRegistry,
} from "./git-watcher"

export {
  cleanupGitWatchers,
  registerGitWatcherIPC,
} from "./ipc-bridge"
