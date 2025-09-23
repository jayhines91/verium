package=curl
$(package)_version=7.79.1
$(package)_download_path=https://curl.haxx.se/download/
$(package)_file_name=$(package)-$($(package)_version).tar.gz
$(package)_sha256_hash=370b11201349816287fb0ccc995e420277fbfcaf76206e309b3f60f0eda090c2
$(package)_dependencies=openssl zlib

# Use a separate build dir when using CMake (Darwin)
$(package)_build_subdir=build-cmake

define $(package)_set_vars
# --- common (feature-minimal, static) ---
$(package)_cflags=-DCURL_STATICLIB
$(package)_cxxflags=-std=c++11

# autotools flags for non-Darwin
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
# Link against depends OpenSSL everywhere (more reproducible than Secure Transport)
$(package)_config_opts_linux=--with-openssl="$(host_prefix)"
$(package)_config_opts_mingw32=--with-openssl="$(host_prefix)"
# (Darwin uses CMake path below; autotools not used on Darwin)
endef

# ---------- non-Darwin: keep autotools path ----------
define $(package)_config_cmds
  $($(package)_autoconf)
endef

define $(package)_build_cmds
  $(MAKE)
endef

define $(package)_stage_cmds
  $(MAKE) DESTDIR=$($(package)_staging_dir) install
endef

# ---------- Darwin: CMake build to avoid broken configure ----------
define $(package)_config_cmds_darwin
  mkdir -p $($(package)_build_subdir) && cd $($(package)_build_subdir) && \
  CC="$(host_CC)" CXX="$(host_CXX)" AR="$(host_AR)" RANLIB="$(host_RANLIB)" \
  cmake -G "Unix Makefiles" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$(host_prefix)" \
    -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
    -DCMAKE_OSX_DEPLOYMENT_TARGET="$(MACOSX_DEPLOYMENT_TARGET)" \
    -DCMAKE_OSX_ARCHITECTURES=x86_64 \
    -DCMAKE_OSX_SYSROOT="$(SDKROOT)" \
    -DBUILD_SHARED_LIBS=OFF \
    -DBUILD_TESTING=OFF \
    -DBUILD_CURL_EXE=OFF \
    -DCURL_STATICLIB=ON \
    -DCURL_USE_OPENSSL=ON \
    -DOPENSSL_ROOT_DIR="$(host_prefix)" \
    -DOPENSSL_USE_STATIC_LIBS=ON \
    -DCURL_ZLIB=ON \
    -DZLIB_ROOT="$(host_prefix)" \
    -DZLIB_LIBRARY="$(host_prefix)/lib/libz.a" \
    -DZLIB_INCLUDE_DIR="$(host_prefix)/include" \
    -DCURL_DISABLE_LDAP=ON \
    -DCURL_DISABLE_RTSP=ON \
    -DCURL_DISABLE_PROXY=ON \
    -DCURL_DISABLE_TFTP=ON \
    -DCURL_DISABLE_POP3=ON \
    -DCURL_DISABLE_IMAP=ON \
    -DCURL_DISABLE_SMTP=ON \
    -DCURL_DISABLE_GOPHER=ON \
    -DCURL_DISABLE_DICT=ON \
    -DENABLE_MANUAL=OFF \
    -DENABLE_UNIX_SOCKETS=OFF
endef

define $(package)_build_cmds_darwin
  $(MAKE) -C $($(package)_build_subdir)
endef

define $(package)_stage_cmds_darwin
  $(MAKE) -C $($(package)_build_subdir) DESTDIR=$($(package)_staging_dir) install
endef
