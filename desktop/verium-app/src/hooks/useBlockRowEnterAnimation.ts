import { useEffect, useRef, useState } from "react";

const ROW_ANIM_MS = 480;

/**
 * When the chain tip hash changes, flags the entering row and nudges existing
 * rows so the table feels like it pushes down for the new block.
 */
export function useBlockRowEnterAnimation(tipHash: string | undefined) {
  const prevHashRef = useRef<string | undefined>(undefined);
  const [enteringHash, setEnteringHash] = useState<string | null>(null);
  const [nudgeOthers, setNudgeOthers] = useState(false);

  useEffect(() => {
    if (!tipHash || tipHash === prevHashRef.current) return;

    prevHashRef.current = tipHash;
    setEnteringHash(tipHash);
    setNudgeOthers(true);

    const id = window.setTimeout(() => {
      setEnteringHash(null);
      setNudgeOthers(false);
    }, ROW_ANIM_MS);

    return () => window.clearTimeout(id);
  }, [tipHash]);

  return { enteringHash, nudgeOthers };
}
