Mozilla CA bundle for Verium
============================

Static Linux builds link OpenSSL/curl without relying on the host OpenSSL
default store. Verium compiles a Mozilla-derived CA bundle into the binary so
HTTPS (bootstrap, updates) works without shipping a separate cert file in release
tarballs.

Files
-----
- `src/certs/cacert.pem` — source PEM used to regenerate the embedded bundle
- `src/certs/cacert_pem.inc` — same bundle compiled into the binary

Refresh (before releases)
-------------------------
```bash
./contrib/certs/update-cacert.sh
```

Source: https://curl.se/docs/caextract.html

Trust order at runtime
----------------------
1. `SSL_CERT_FILE` / `SSL_CERT_DIR` environment variables
2. Common system paths (`/etc/ssl/certs/...`, etc.) when `ca-certificates` is installed
3. Embedded Mozilla bundle in the binary (fallback)

Normal desktop Linux already has (2). Minimal systems use (3). No separate
`cacert.pem` is required next to the executable in release packages.
