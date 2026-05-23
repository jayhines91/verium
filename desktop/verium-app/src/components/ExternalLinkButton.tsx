import { ExternalLink } from "lucide-react";
import { type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/Button";
import { openExternal } from "@/lib/open-external";
import { cn } from "@/lib/utils";

interface ExternalLinkButtonProps extends Omit<ButtonProps, "onClick"> {
  href: string;
  showIcon?: boolean;
  children: ReactNode;
}

export function ExternalLinkButton({
  href,
  showIcon = true,
  className,
  children,
  variant = "secondary",
  size = "sm",
  ...rest
}: ExternalLinkButtonProps) {
  return (
    <Button
      {...rest}
      variant={variant}
      size={size}
      className={cn(className)}
      onClick={() => {
        void openExternal(href);
      }}
    >
      {children}
      {showIcon && <ExternalLink className="h-3.5 w-3.5 opacity-70" />}
    </Button>
  );
}
