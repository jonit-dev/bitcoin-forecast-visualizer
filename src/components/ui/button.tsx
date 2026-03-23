import * as React from "react"
import { cn } from "@/lib/utils"

const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-300 disabled:pointer-events-none disabled:opacity-50",
      "bg-emerald-500 text-zinc-950 hover:bg-emerald-400 shadow-sm h-9 px-4 py-2",
      className
    )}
    {...props}
  />
))
Button.displayName = "Button"
export { Button }
