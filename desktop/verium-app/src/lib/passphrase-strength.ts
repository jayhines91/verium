/** Lightweight passphrase strength heuristic. No external dependency. */

export type PassphraseStrength = "weak" | "fair" | "good" | "strong";

export interface PassphraseScore {
  score: number; // 0..4
  label: PassphraseStrength;
  hint: string;
}

const MIN_LENGTH = 10;

export function scorePassphrase(passphrase: string): PassphraseScore {
  if (!passphrase) {
    return { score: 0, label: "weak", hint: "Enter a passphrase." };
  }

  const len = passphrase.length;
  let score = 0;
  if (len >= MIN_LENGTH) score += 1;
  if (len >= 16) score += 1;
  if (/[a-z]/.test(passphrase) && /[A-Z]/.test(passphrase)) score += 1;
  if (/\d/.test(passphrase)) score += 1;
  if (/[^A-Za-z0-9]/.test(passphrase)) score += 1;

  score = Math.min(4, score);

  let label: PassphraseStrength = "weak";
  let hint = "Use at least 10 characters, mix cases, numbers, symbols.";
  if (score >= 4) {
    label = "strong";
    hint = "Strong passphrase.";
  } else if (score === 3) {
    label = "good";
    hint = "Good passphrase. Consider adding a symbol or more length.";
  } else if (score === 2) {
    label = "fair";
    hint = "Fair. Mix uppercase, numbers, and symbols, and lengthen it.";
  }

  if (len < MIN_LENGTH) {
    return {
      score: Math.min(score, 1),
      label: "weak",
      hint: `Use at least ${MIN_LENGTH} characters.`,
    };
  }
  return { score, label, hint };
}
