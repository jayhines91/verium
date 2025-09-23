package=curl
$(package)_version=7.79.1
$(package)_download_path=https://curl.haxx.se/download/
$(package)_file_name=$(package)-$($(package)_version).tar.gz
$(package)_sha256_hash=370b11201349816287fb0ccc995e420277fbfcaf76206e309b3f60f0eda090c2
$(package)_dependencies=openssl zlib

define $(package)_set_vars
# build a static libcurl with minimal features
$(package)_config_opts=--disable-shared --with-ca-fallback
$(package)_config_opts+=--disable-cookies
$(package)_config_opts+=--disable-manual
$(package)_config_opts+=--disable-unix-sockets
$(package)_config_opts+=--disable-verbose
$(package)_config_opts+=--disable-versioned-symbols
$(package)_config_opts+=--enable-symbol-hiding
$(package)_config_opts+=--without-librtmp
$(package)_config_opts+=--disable-rtsp
$(package)_config_opts+=--disable-alt-svc

# Use OpenSSL from depends everywhere (more reproducible than Secure Transport)
$(package)_config_opts_linux=--with-openssl="$(host_prefix)"
$(package)_config_opts_darwin=--with-openssl="$(host_prefix)"
# If you *really* want Secure Transport on macOS, swap the line above for:
# $(package)_config_opts_darwin=--with-secure-transport --without-openssl

# (Optional: if you ever target mingw)
$(package)_config_opts_mingw32=--with-openssl="$(host_prefix)"

$(package)_cflags=-DCURL_STATICLIB
$(package)_cxxflags=-std=c++11
# (Optional: make min macOS explicit)
$(package)_cflags_darwin=-mmacosx-version-min=$(MACOSX_DEPLOYMENT_TARGET)
endef

# DO NOT autoreconf on macOS: use the tarball's shipped configure
define $(package)_config_cmds
  $($(package)_autoconf)
endef

define $(package)_build_cmds
  $(MAKE)
endef

define $(package)_stage_cmds
  $(MAKE) DESTDIR=$($(package)_staging_dir) install
endef
