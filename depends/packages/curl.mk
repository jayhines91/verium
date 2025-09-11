package=curl
$(package)_version=7.62.0
$(package)_download_path=https://curl.haxx.se/download/
$(package)_file_name=$(package)-$($(package)_version).tar.gz
$(package)_sha256_hash=55ccd5b5209f8cc53d4250e2a9fd87e6f67dd323ae8bd7d06b072cfcbb7836cb
$(package)_dependencies=openssl zlib

define $(package)_set_vars
$(package)_config_opts=--disable-shared --with-ca-fallback
# Avoid runtime/rt checks that fail under cross-compiling
$(package)_config_opts += --disable-rt
# Skip features that trigger extra detection (harmless for our use)
$(package)_config_opts += --disable-ldap --disable-ldaps
# Windows/Darwin TLS backends (explicit to avoid extra probes)
$(package)_config_opts_mingw32=--enable-sspi --without-ssl --with-winssl --with-schannel
$(package)_config_opts_darwin=--enable-sspi --without-ssl --with-darwinssl --with-secure-transport
# Preseed autoconf cache so configure won't try to RUN probes
$(package)_config_env += ac_cv_func_clock_gettime=no ac_cv_search_clock_gettime=no curl_cv_clock_gettime_monotonic=no
$(package)_cflags=-DCURL_STATICLIB
$(package)_cxxflags=-std=c++11
endef

define $(package)_config_cmds
  ./buildconf && \
  $($(package)_autoconf)
endef

define $(package)_build_cmds
  $(MAKE)
endef

define $(package)_stage_cmds
  $(MAKE) DESTDIR=$($(package)_staging_dir) install
endef
