import type * as React from "react"
import logoUrl from "../../assets/logo-mauscode.png"
import { cn } from "../../lib/utils"

interface LogoProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  className?: string
}

/**
 * mausCode brand glyph.
 *
 * Single brand asset (256px palette PNG from the official logo, ~5 KB).
 * The glyph ships in black; `dark:invert` flips it to white in dark mode
 * (the app uses class-based dark mode — see tailwind.config.js).
 */
export function Logo({ className, ...props }: LogoProps) {
  return (
    <img
      src={logoUrl}
      alt="mausCode logo"
      aria-label="mausCode logo"
      draggable={false}
      className={cn("w-full h-full dark:invert select-none", className)}
      {...props}
    />
  )
}
