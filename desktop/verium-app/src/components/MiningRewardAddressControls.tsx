import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { coinQueryKey } from "@/lib/coin/profile";
import {
  rpcGetNewAddress,
  rpcListAddressGroupings,
} from "@/lib/rpc/client";
import type { MiningRewardAddressMode } from "@/lib/mining-reward-address";
import { cn } from "@/lib/utils";

const VERIUM = "verium" as const;

interface MiningRewardAddressControlsProps {
  mode: MiningRewardAddressMode;
  address: string;
  disabled?: boolean;
  compact?: boolean;
  onModeChange: (mode: MiningRewardAddressMode) => void;
  onAddressChange: (address: string) => void;
}

export function MiningRewardAddressControls({
  mode,
  address,
  disabled,
  compact,
  onModeChange,
  onAddressChange,
}: MiningRewardAddressControlsProps) {
  const staticMode = mode === "static";

  const addresses = useQuery({
    queryKey: coinQueryKey(VERIUM, "listaddressgroupings"),
    queryFn: () => rpcListAddressGroupings(VERIUM),
    staleTime: 30_000,
    enabled: staticMode,
  });

  const knownAddresses = addresses.data ?? [];

  const newAddress = useMutation({
    mutationFn: () => rpcGetNewAddress(VERIUM),
    onSuccess: (addr) => onAddressChange(addr),
  });

  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        compact ? "text-xs" : "text-sm",
      )}
    >
      <p className={cn("font-medium text-fg", compact && "text-xs")}>
        Mining reward address
      </p>
      <div className="flex flex-col gap-2">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="mining-reward-mode"
            checked={!staticMode}
            disabled={disabled}
            onChange={() => onModeChange("dynamic")}
            className="mt-0.5 accent-accent"
          />
          <span>
            <span className="font-medium text-fg">Dynamic</span>
            <span className="mt-0.5 block text-fg-muted">
              Reserve a new internal address each time mining starts.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="mining-reward-mode"
            checked={staticMode}
            disabled={disabled}
            onChange={() => onModeChange("static")}
            className="mt-0.5 accent-accent"
          />
          <span>
            <span className="font-medium text-fg">Static</span>
            <span className="mt-0.5 block text-fg-muted">
              Always pay block rewards to one wallet address you choose.
            </span>
          </span>
        </label>
      </div>

      {staticMode && (
        <div className="flex flex-col gap-2 pl-6">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={address}
              disabled={disabled}
              onChange={(e) => onAddressChange(e.target.value)}
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-bg-panel px-2 text-xs outline-none focus:border-accent disabled:opacity-60"
              aria-label="Wallet address for mining rewards"
            >
              <option value="">Select a wallet address…</option>
              {address && !knownAddresses.includes(address) && (
                <option value={address}>{address}</option>
              )}
              {knownAddresses.map((addr) => (
                <option key={addr} value={addr}>
                  {addr}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled || newAddress.isPending}
              onClick={() => newAddress.mutate()}
              className="shrink-0"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              New
            </Button>
          </div>
          {staticMode && !address.trim() && (
            <p className="text-xs text-warning">
              Choose an address before starting mining in static mode.
            </p>
          )}
        </div>
      )}
    </div>
  );
}