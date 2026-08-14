Mozilla CA bundle for Verium
============================

Static Linux builds link OpenSSL/curl without relying on the host's CA store.
Verium ships a Mozilla-derived CA bundle so HTTPS (bootstrap, updates) works even
when the `ca-certificates` package is not installed.

Files
-----
- `src/certs/cacert.pem` — PEM file copied into Linux release tarballs
- `src/certs/cacert_pem.inc` — same bundle compiled into the binary (final fallback)

Refresh (before releases)
-------------------------
```bash
./contrib/certs/update-cacert.sh
```

Source: https://curl.se/docs/caextract.html

Trust order at runtime
----------------------
1. `SSL_CERT_FILE` / `SSL_CERT_DIR` environment variables
2. Common system paths (`/etc/ssl/certs/...`, etc.)
3. `cacert.pem` next to the executable (release tarball layout)
4. Embedded Mozilla bundle (always present in the binary)
