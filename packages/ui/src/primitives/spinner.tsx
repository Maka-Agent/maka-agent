import { cn } from "../utils.js";
import { Loader2Icon } from "../icons.js";
import type React from "react";

export function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof Loader2Icon>): React.ReactElement {
  return (
    <Loader2Icon
      aria-label="加载中"
      className={cn("animate-spin", className)}
      role="status"
      {...props}
    />
  );
}
