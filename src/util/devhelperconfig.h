// Copyright (c) 2026 The Verium developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#ifndef BITCOIN_UTIL_DEVHELPERCONFIG_H
#define BITCOIN_UTIL_DEVHELPERCONFIG_H

/**
 * Developer Edition build switch.
 *
 * Debug machine (this repo): keep at 1 and recompile with:
 *   ./Build-Scripts/build-windows-dev-docker.sh
 *   ./Build-Scripts/recompile-dev-windows.sh          (alias)
 *
 * That produces out-windows-dev/ binaries plus a Developer Edition NSIS installer
 * (installs to Program Files\Verium Developer Edition — not the release path).
 *
 * Holder/release: set to 0, then Build-Scripts/build-windows-docker.sh → out-windows/
 */
#define ENABLE_DEV_HELPER_WINDOW 0

/** Display version on splash screen, window title, and About dialog. */
#define DEV_EDITION_VERSION_STRING "2.2"
#define DEV_EDITION_LABEL "Dev Edition"

/**
 * SHA-256 hex digest of the master dev-tools password (lowercase).
 * Change this hash after changing the password (see util/devedition.cpp).
 *
 * Default password: VeriDev225!
 */
#define DEV_EDITION_MASTER_PASSWORD_HASH "8f91808ab85fa927c86f28d112bd00674de9b35919c1936155706eb347388bec"

/**
 * Optional runtime switch: when 1, dev edition branding/tools require -devedition
 * on the command line in addition to the compile flag above.
 * Set to 0 so a Developer Edition build always identifies itself on the splash screen.
 */
#define DEV_EDITION_REQUIRE_CMDLINE_SWITCH 0

#if ENABLE_DEV_HELPER_WINDOW
#define DEV_HELPER_IF_ENABLED(code) code
#else
#define DEV_HELPER_IF_ENABLED(code)
#endif

#endif // BITCOIN_UTIL_DEVHELPERCONFIG_H
