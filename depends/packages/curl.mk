package=curl
$(package)_version=7.79.1
$(package)_download_path=https://curl.haxx.se/download/
$(package)_file_name=$(package)-$($(package)_version).tar.gz
$(package)_sha256_hash=370b11201349816287fb0ccc995e420277fbfcaf76206e309b3f60f0eda090c2
$(package)_dependencies=openssl zlib

define $(package)_set_vars
# Build a static libcurl with minimal features
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

# Tell curl which TLS backend to use
$(package)_config_opts_linux=--with-openssl="$(host_prefix)"
$(package)_config_opts_darwin=--with-openssl="$(host_prefix)"
$(package)_config_opts_mingw32=--with-openssl="$(host_prefix)"

# Flags: use CPPFLAGS for the macro; make min OS explicit on macOS
$(package)_cppflags=-DCURL_STATICLIB
$(package)_cflags_darwin=-mmacosx-version-min=$(MACOSX_DEPLOYMENT_TARGET)
$(package)_cxxflags=-std=c++11
$(package)_cxxflags_darwin=-mmacosx-version-min=$(MACOSX_DEPLOYMENT_TARGET)
endef

# Use the tarball’s configure; DO NOT autoreconf on macOS (it broke earlier)
define $(package)_config_cmds
  $($(package)_autoconf)
endef

define $(package)_build_cmds
  $(MAKE)
endef

define $(package)_stage_cmds
  $(MAKE) DESTDIR=$($(package)_staging_dir) install
endef
