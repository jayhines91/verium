import { ChevronDown } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { MiningThreadControls } from "@/components/MiningThreadControls";
import { MiningRewardAddressControls } from "@/components/MiningRewardAddressControls";
import type { MiningRewardAddressMode } from "@/lib/mining-reward-address";
import type { CpuTopology } from "@/lib/mining-opt";
import { clearMiningStoppedByUser } from "@/lib/mining-session";
import {
  playBlockMinedSound,
  unlockBlockMinedAudio,
} from "@/lib/block-mined-sound";
import { cn } from "@/lib/utils";

interface MiningControlsCardProps {
  autoAdjustThreads: boolean;
  manualThreads: number;
  suggestedThreads?: number;
  maxThreads: number;
  topology?: CpuTopology;
  logicalCpus?: number;
  displayThreads: number;
  isMining: boolean;
  controlsDisabled: boolean;
  rewardMode: MiningRewardAddressMode;
  rewardAddress: string;
  autoMineOnOpen: boolean;
  playSoundOnBlock: boolean;
  onAutoAdjustChange: (checked: boolean) => void;
  onManualThreadsChange: (threads: number) => void;
  onRewardModeChange: (mode: MiningRewardAddressMode) => void;
  onRewardAddressChange: (address: string) => void;
  onAutoMineOnOpenChange: (checked: boolean) => void;
  onPlaySoundChange: (checked: boolean) => void;
}

function BehaviorToggle({
  checked,
  disabled,
  title,
  description,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-md border border-border bg-bg-subtle/50 px-3 py-2.5",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded accent-accent"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="mt-0.5 block text-xs text-fg-muted">{description}</span>
      </span>
    </label>
  );
}

export function MiningControlsCard({
  autoAdjustThreads,
  manualThreads,
  suggestedThreads,
  maxThreads,
  topology,
  logicalCpus,
  displayThreads,
  isMining,
  controlsDisabled,
  rewardMode,
  rewardAddress,
  autoMineOnOpen,
  playSoundOnBlock,
  onAutoAdjustChange,
  onManualThreadsChange,
  onRewardModeChange,
  onRewardAddressChange,
  onAutoMineOnOpenChange,
  onPlaySoundChange,
}: MiningControlsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="normal-case">Configuration</CardTitle>
        <CardDescription>
          Thread count and reward destination. Stop the miner before changing
          threads or address mode.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <MiningThreadControls
          autoAdjust={autoAdjustThreads}
          manualThreads={manualThreads}
          suggestedThreads={suggestedThreads}
          maxThreads={maxThreads}
          topology={topology}
          logicalCpus={logicalCpus}
          activeThreads={displayThreads}
          isMining={isMining}
          disabled={controlsDisabled}
          onAutoAdjustChange={onAutoAdjustChange}
          onManualThreadsChange={onManualThreadsChange}
        />

        <details className="group rounded-lg border border-border bg-bg-subtle/30">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">
            <span>Mining configuration</span>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-fg-muted transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                Behavior
              </p>
              <BehaviorToggle
                checked={autoMineOnOpen}
                disabled={controlsDisabled}
                title="Auto-mine on open"
                description="Start the CPU miner when you open the wallet (unless you stopped it manually)."
                onChange={(checked) => {
                  if (checked) clearMiningStoppedByUser();
                  onAutoMineOnOpenChange(checked);
                }}
              />
              <BehaviorToggle
                checked={playSoundOnBlock}
                title="Block mined sound"
                description="Play a short chime when a block you mined is accepted."
                onChange={(checked) => {
                  void unlockBlockMinedAudio();
                  onPlaySoundChange(checked);
                  if (checked) void playBlockMinedSound();
                }}
              />
            </div>

            <MiningRewardAddressControls
              mode={rewardMode}
              address={rewardAddress}
              disabled={controlsDisabled}
              onModeChange={onRewardModeChange}
              onAddressChange={onRewardAddressChange}
            />
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
