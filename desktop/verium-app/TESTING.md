# Release QA Checklist

Run through this checklist on a clean machine for every `desktop-v*` tag
before promoting the GitHub Release out of draft.

## Environments

- Fresh Windows 10/11 VM (no prior Verium install)
- Fresh macOS account (Intel + Apple Silicon)
- Fresh Ubuntu 22.04 container/VM
- Existing machine with a populated `Verium` data directory and encrypted
  wallet (regression smoke)

## 1. Installer

- [ ] Download the platform installer from the draft release.
- [ ] Installer runs without prompting for `veriumd` or extra components.
- [ ] App launches and lands on the Setup wizard.

## 2. First-run wizard

- [ ] Welcome screen renders, Continue button works.
- [ ] **Start node** step shows automatic progress (no RPC username/password fields).
- [ ] The node connects without manual "Test RPC" or "Create RPC login" steps.
- [ ] **Start node** shows **Ready** or **Syncing** after ≤ 90s on a typical machine.
- [ ] When no wallet exists, the **Create wallet** form is shown.
- [ ] Strength meter changes from Weak to Strong as you type.
- [ ] **Create encrypted wallet** completes successfully even when the
      daemon restarts (the form waits for it to come back up).
- [ ] On wizard exit you land on the Dashboard.

## 3. Wallet basics

- [ ] **Wallet** page shows balance, immature, unconfirmed.
- [ ] **Receive** generates a new address, copy-to-clipboard works.
- [ ] **Send** dialog with a single recipient triggers the confirmation
      modal; the **Yes** button has a 3-second delay.
- [ ] **Coin control** modal lists UTXOs; selecting two and sending uses
      the createraw/fundraw/signraw/sendraw pipeline (one txid in the
      result toast).
- [ ] **Fee editor** updates the transaction fee and persists across
      restarts (check `prefs.json` after).
- [ ] **Address book** add / edit / delete / picker integration.

## 4. Incoming VRM

- [ ] Receive a small amount from another wallet — toast appears with the
      amount, chime plays (if the preference is on).
- [ ] Burst send (4+ outputs) is grouped into one "Received X VRM ·
      4 transactions" toast.

## 5. Mining

- [ ] **Start mining** button starts the built-in CPU miner.
- [ ] Hashrate chart populates within a minute.
- [ ] Revenue card scales between day / week / month / year.
- [ ] Cost / Net / Gross USD figures update when you change watts and
      $/kWh.
- [ ] Finding a block triggers the **You mined!** badge and chime.
- [ ] **Stop mining** stops the miner and prevents auto-restart.

## 6. Backup and restore

- [ ] **Settings → Wallet backup &amp; passphrase → Back up wallet.dat** writes
      to the chosen destination and surfaces success.
- [ ] **Change passphrase** updates credentials and the wallet still
      unlocks afterwards.
- [ ] Restore: close wallet, swap `wallet.dat` for the backup, re-open,
      unlock with original passphrase.

## 7. Bootstrap

- [ ] On a fresh datadir with `headers - blocks > 50_000`, the
      dashboard offers bootstrap import. Importing completes, the daemon
      restarts, and `getblockchaininfo` jumps forward.

## 8. Update check

- [ ] **Settings → Updates → Check for updates** compares CDN +
      manifest. When the CDN feed is unavailable it falls back to
      manifest gracefully.

## 9. Sign / verify

- [ ] Sign a message with a known address; verifying the same address /
      message / signature returns valid.
- [ ] Tampering with the message returns invalid.

## 10. RPC console

- [ ] `getblockchaininfo` returns JSON.
- [ ] Up-arrow recalls the previous command; history persists across
      reloads.

## 11. Diagnostics

- [ ] Force a render error in dev (`throw new Error("test")` in any
      page). The error boundary renders, **Copy diagnostic bundle**
      writes to the clipboard, and **Try again** clears the error.

## 12. Smoke tests

- [ ] App reload (Ctrl+R / Cmd+R) keeps the wallet unlocked.
- [ ] Close the wallet window — veriumd stops and releases the data directory lock.
- [ ] Re-open the wallet and start the node — only one veriumd instance runs.
- [ ] Kill `veriumd` externally while the app is open — the app recovers within ~30s (supervisor).
- [ ] Lock wallet, restart machine, re-open — wallet is locked again and unlocks with the passphrase.

## 13. Automated tests (dev)

- [ ] `npm run test` — Vitest status mapping (`src/lib/node/status.test.ts`).
- [ ] `cargo test node::` — Rust node module unit tests (auth, diagnostics, state).

## 14. Uninstall

- [ ] Windows: NSIS uninstaller removes the app but leaves the data
      directory intact.
- [ ] macOS: dragging to Trash leaves the data directory intact.
- [ ] Linux .deb: `apt remove verium` removes the app; `apt purge` also
      removes config (but never wallet.dat in the user data dir).

When everything above is green, promote the draft release.
