// Copyright (c) 2026 The Vericoin developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#ifndef BITCOIN_UTIL_DEVEDITION_H
#define BITCOIN_UTIL_DEVEDITION_H

#include <string>

/** True when this binary was built with ENABLE_DEV_HELPER_WINDOW. */
bool IsDeveloperEditionBuild();

/** True when -devedition was passed (if required) and compile flag is set. */
bool IsDeveloperEditionActive();

/** Session unlock state for dev tools (requires master password). */
bool IsDevToolsUnlocked();

/** Verify master password and unlock dev tools for this session. */
bool UnlockDevToolsWithPassword(const std::string& password);

void LockDevTools();

/** True after the one-time startup dev trace prompt has been answered. */
bool IsDevStartupPromptComplete();

/** Mark startup dev trace prompt as finished (yes or no). */
void MarkDevStartupPromptComplete();

/** e.g. "2.2.5 Developer Edition" */
std::string GetDeveloperEditionVersionString();

/** e.g. "Vericoin 2.2.5 Developer Edition" */
std::string GetDeveloperEditionTitle();

#endif // BITCOIN_UTIL_DEVEDITION_H
