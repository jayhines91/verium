Verium Vault version 1.3.5.2 is now available from:

  https://vericonomy.com

This is a patch release, bringing bug fixes and build improvements.

Please report bugs using the issue tracker at github:

  https://github.com/VeriumReserve/Verium

Upgrading and downgrading
=========================

How to Upgrade
--------------

If you are running an older version, shut it down. Wait until it has completely
shut down (which might take a few minutes for older versions), uninstall all
earlier versions of Verium, then run the installer.

We recommend before any upgrade that you backup your wallet.

If you are upgrading from version 1.2 or earlier, the first time you run
1.3.5.2 your blockchain files will be re-indexed, which will take anywhere from
5 minutes to several hours, depending on the speed of your machine.

Downgrading warnings
--------------------

The 'chainstate' for this release is not always compatible with previous
releases, so if you run 1.3.x and then decide to switch back to a
1.2.x release you might get a blockchain validation error when starting the
old release (due to 'pruned outputs' being omitted from the index of
unspent transaction outputs).

Running the old release with the -reindex option will rebuild the chainstate
data structures and correct the problem.

Also, the first time you run a 1.2.x release on a 1.3.x wallet it will rescan
the blockchain for missing spent coins, which will take a long time (tens
of minutes on a typical machine).

Notable changes
===============

Testnet enabled
---------------

Verium testnet is now fully supported in this release and onward. Use -testnet
or -chain=test with veriumd, verium-qt, verium-cli, verium-tx, and verium-wallet
to connect to the test network. Testnet uses port 36989 (P2P) and 33988 (RPC).
See verium-testnet(1) for details.

Documentation
-------------

- New manpage: verium-testnet(1) explains testnet usage
- Manpages (veriumd, verium-qt, verium-cli, verium-tx, verium-wallet) are included
  in release packages

In-wallet bootstrap (mainnet)
-----------------------

Fixed the in-wallet "Bootstrap the Chain" feature for mainnet. Bootstrap zip files
are now extracted correctly with proper directory layout detection and parent
directory creation. This affects only mainnet; testnet behavior is unchanged.

Windows build support
--------------------

- Restored and fixed Windows x64 cross-compilation (MinGW)
- Fixed gmtime_r shim for Windows compatibility
- Fixed linking when cross-compiling (removed Linux-only -lrt dependency)
- Added GitHub Actions workflow for automated Windows builds
- Windows binaries: verium-qt.exe, veriumd.exe, verium-cli.exe, verium-tx.exe, verium-wallet.exe

Linux build improvements
-----------------------

- Fixed depends build with GCC 9 for compatibility
- Fixed Boost filesystem API compatibility (copy_option)

CI/CD
-----

- Linux 64-bit build workflow (push to testnet)
- Windows 64-bit build workflow (push to testnet or manual trigger)
- Job parallelism tuned to reduce OOM risk in containerized builds

1.3.5.2 Change log
==================

Testnet and documentation:

- Testnet fully enabled and documented
- New manpage: verium-testnet(1)
- Manpages included in release packages (share/man/man1/)

Bootstrap:

- Fix in-wallet bootstrap zip extraction for mainnet
- Proper parent directory creation and zip layout detection

Build system:

- Windows: gmtime_r compat shim (gmtime_s)
- Windows: ac_cv_search_clock_gettime=no for cross-compile
- Linux: Boost copy_option compatibility
- Linux: GCC 9 for depends build

Credits
-------

Thanks to everyone who contributed to this release:
- Bitcoin Core Team
- Verium Reserve / Vericonomy community

And thanks to the community for their continued support.
