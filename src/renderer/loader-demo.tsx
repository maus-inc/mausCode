// TEMP DEMO — visual check for the new dot-matrix page loader. NOT FOR COMMIT.
// Open the preview with #loader-demo at the end of the URL to see it.
import { useState } from "react"
import { Loader2 } from "lucide-react"
import { DotmSquare12 } from "@/components/ui/dotm-square-12"
import { AppLoader } from "@/components/ui/app-loader"

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3">
      {children}
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

export function LoaderDemo() {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : true,
  )

  const toggleTheme = () => {
    const next = !isDark
    setIsDark(next)
    document.documentElement.classList.toggle("dark", next)
  }

  return (
    <div className="min-h-screen w-screen bg-background p-8 select-none">
      <div className="mx-auto max-w-[720px] space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-base font-semibold tracking-tight">Page loader check</h1>
            <p className="text-sm text-muted-foreground">
              Temp demo — open without <span className="font-mono">#loader-demo</span> for the real
              app. Old spinner included for comparison.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="h-8 px-3 shrink-0 bg-muted text-foreground rounded-lg text-sm font-medium hover:bg-muted/80 flex items-center justify-center"
          >
            {isDark ? "Light mode" : "Dark mode"}
          </button>
        </div>

        <div className="rounded-xl border border-border bg-background p-6">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
            New dot loader (follows UI text color)
          </p>
          <div className="flex items-end gap-10">
            <Cell label="sm · 20px">
              <AppLoader size="sm" />
            </Cell>
            <Cell label="md · 24px">
              <AppLoader size="md" />
            </Cell>
            <Cell label="lg · 32px + label">
              <AppLoader label="Loading file..." />
            </Cell>
            <Cell label="old spinner">
              <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
            </Cell>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-background p-6">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
            Color options (same loader, different text color)
          </p>
          <div className="flex items-end gap-10">
            <Cell label="muted (current)">
              <DotmSquare12 size={32} dotSize={4} />
            </Cell>
            <Cell label="brand blue">
              <span className="text-primary">
                <DotmSquare12 size={32} dotSize={4} />
              </span>
            </Cell>
            <Cell label="foreground">
              <span className="text-foreground">
                <DotmSquare12 size={32} dotSize={4} />
              </span>
            </Cell>
          </div>
        </div>
      </div>
    </div>
  )
}
