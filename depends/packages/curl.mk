package=curl
$(package)_version=7.79.1
$(package)_download_path=https://curl.haxx.se/download/
$(package)_file_name=$(package)-$($(package)_version).tar.gz
$(package)_sha256_hash=370b11201349816287fb0ccc995e420277fbfcaf76206e309b3f60f0eda090c2
$(package)_dependencies=openssl zlib

define $(package)_set_vars
$(package)_config_opts=--disable-shared --with-ca-fallback
$(package)_config_opts+= --disable-ldap --disable-ldaps
$(package)_config_opts+=--disable-cookies
$(package)_config_opts+=--disable-manual
$(package)_config_opts+=--disable-unix-sockets
$(package)_config_opts+=--disable-verbose
$(package)_config_opts+=--disable-versioned-symbols
$(package)_config_opts+=--enable-symbol-hiding
$(package)_config_opts+=--without-librtmp
$(package)_config_opts+=--disable-rtsp
$(package)_config_opts+=--disable-alt-svc
$(package)_config_opts+=--disable-shared --enable-static
$(package)_config_opts +=--without-libpsl --without-libidn2 --without-nghttp2 --without-ngtcp2
$(package)_config_opts +=--without-brotli --without-zstd --without-gsasl
$(package)_config_opts +=--disable-ldap --disable-ldaps --disable-rtsp
$(package)_config_opts+=--host=$(host) --prefix=$(host_prefix)
$(package)_config_opts+=--with-ssl=$(host_prefix) --with-zlib=$(host_prefix)

$(package)_config_opts_mingw32=--enable-sspi --without-ssl --with-nss --with-schannel
$(package)_config_opts_darwin=--enable-sspi --without-ssl --with-secure-transport
$(package)_config_opts_linux=--with-ssl
$(package)_cppflags+=-DCURL_STATICLIB
$(package)_cxxflags=-std=c++11
endef

define $(package)_preprocess_cmds
  sed -i.old 's/^[[:space:]]*;;[[:space:]]*$$/  : ;;/g' configure && true
endef

define $(package)_config_cmds
  $($(package)_autoconf)
endef

define $(package)_build_cmds
  $(MAKE)
endef

define $(package)_stage_cmds
  $(MAKE) DESTDIR=$($(package)_staging_dir) install
endef

# CI: cross-compile opts for Windows
$(package)_config_opts += --disable-debug --disable-curldebug --disable-ldap --disable-ldaps --without-libidn2 --without-libpsl --without-brotli --without-zstd --without-nghttp2 --without-ssh --without-libssh2 --without-rtmp
$(package)_config_opts_mingw32 += --with-winssl
$(package)_config_opts_mingw64 += --with-winssl
$(package)_conf_env += ac_cv_func_strerror_r=no ac_cv_strerror_r_char_p=no ac_cv_func_clock_gettime=no ac_cv_header_dlfcn_h=no ac_cv_have_decl_strerror_r=yes

# CI: cross-compile opts for Windows
$(package)_config_opts += --disable-debug --disable-curldebug --disable-ldap --disable-ldaps --without-libidn2 --without-libpsl --without-brotli --without-zstd --without-nghttp2 --without-ssh --without-libssh2 --without-rtmp
$(package)_config_opts_mingw32 += --with-winssl
$(package)_config_opts_mingw64 += --with-winssl
$(package)_conf_env += ac_cv_func_strerror_r=no ac_cv_strerror_r_char_p=no ac_cv_func_clock_gettime=no ac_cv_header_dlfcn_h=no ac_cv_have_decl_strerror_r=yes

# CI: cross-compile opts for Windows
$(package)_config_opts += --disable-debug --disable-curldebug --disable-ldap --disable-ldaps --without-libidn2 --without-libpsl --without-brotli --without-zstd --without-nghttp2 --without-ssh --without-libssh2 --without-rtmp
$(package)_config_opts_mingw32 += --with-winssl
$(package)_config_opts_mingw64 += --with-winssl
$(package)_conf_env += ac_cv_func_strerror_r=no ac_cv_strerror_r_char_p=no ac_cv_func_clock_gettime=no ac_cv_header_dlfcn_h=no ac_cv_have_decl_strerror_r=yes

# CI: cross-compile opts for Windows
$(package)_config_opts += --disable-debug --disable-curldebug --disable-ldap --disable-ldaps --without-libidn2 --without-libpsl --without-brotli --without-zstd --without-nghttp2 --without-ssh --without-libssh2 --without-rtmp
$(package)_config_opts_mingw32 += --with-winssl
$(package)_config_opts_mingw64 += --with-winssl
$(package)_conf_env += ac_cv_func_strerror_r=no ac_cv_strerror_r_char_p=no ac_cv_func_clock_gettime=no ac_cv_header_dlfcn_h=no ac_cv_have_decl_strerror_r=yes

# CI: cross-compile opts for Windows
$(package)_config_opts += --disable-debug --disable-curldebug --disable-ldap --disable-ldaps --without-libidn2 --without-libpsl --without-brotli --without-zstd --without-nghttp2 --without-ssh --without-libssh2 --without-rtmp
$(package)_config_opts_mingw32 += --with-winssl
$(package)_config_opts_mingw64 += --with-winssl
$(package)_conf_env += ac_cv_func_strerror_r=no ac_cv_strerror_r_char_p=no ac_cv_func_clock_gettime=no ac_cv_header_dlfcn_h=no ac_cv_have_decl_strerror_r=yes

# CI: cross-compile opts for Windows
$(package)_config_opts += --disable-debug --disable-curldebug --disable-ldap --disable-ldaps --without-libidn2 --without-libpsl --without-brotli --without-zstd --without-nghttp2 --without-ssh --without-libssh2 --without-rtmp
$(package)_config_opts_mingw32 += --with-winssl
$(package)_config_opts_mingw64 += --with-winssl
$(package)_conf_env += ac_cv_func_strerror_r=no ac_cv_strerror_r_char_p=no ac_cv_func_clock_gettime=no ac_cv_header_dlfcn_h=no ac_cv_have_decl_strerror_r=yes

# CI: cross-compile opts for Windows
$(package)_config_opts += --disable-debug --disable-curldebug --disable-ldap --disable-ldaps --without-libidn2 --without-libpsl --without-brotli --without-zstd --without-nghttp2 --without-ssh --without-libssh2 --without-rtmp
$(package)_config_opts_mingw32 += --with-winssl
$(package)_config_opts_mingw64 += --with-winssl
$(package)_conf_env += ac_cv_func_strerror_r=no ac_cv_strerror_r_char_p=no ac_cv_func_clock_gettime=no ac_cv_header_dlfcn_h=no ac_cv_have_decl_strerror_r=yes

# CI: cross-compile opts for Windows
$(package)_config_opts += --disable-debug --disable-curldebug --disable-ldap --disable-ldaps --without-libidn2 --without-libpsl --without-brotli --without-zstd --without-nghttp2 --without-ssh --without-libssh2 --without-rtmp
$(package)_config_opts_mingw32 += --with-winssl
$(package)_config_opts_mingw64 += --with-winssl
$(package)_conf_env += ac_cv_func_strerror_r=no ac_cv_strerror_r_char_p=no ac_cv_func_clock_gettime=no ac_cv_header_dlfcn_h=no ac_cv_have_decl_strerror_r=yes

# CI: cross-compile opts for Windows
$(package)_config_opts += --disable-debug --disable-curldebug --disable-ldap --disable-ldaps --without-libidn2 --without-libpsl --without-brotli --without-zstd --without-nghttp2 --without-ssh --without-libssh2 --without-rtmp
$(package)_config_opts_mingw32 += --with-winssl
$(package)_config_opts_mingw64 += --with-winssl
$(package)_conf_env += ac_cv_func_strerror_r=no ac_cv_strerror_r_char_p=no ac_cv_func_clock_gettime=no ac_cv_header_dlfcn_h=no ac_cv_have_decl_strerror_r=yes
