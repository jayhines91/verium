package=bdb
$(package)_version=4.8.30
$(package)_download_path=https://download.oracle.com/berkeley-db
$(package)_file_name=db-$($(package)_version).NC.tar.gz
$(package)_sha256_hash=12edc0df75bf9abd7f82f821795bcee50f42cb2e5f76a6a281b85732798364ef
$(package)_build_subdir=build_unix
$(package)_dependencies=

define $(package)_set_vars
# Install prefix for this package only
$(package)_config_opts=--disable-shared --enable-static --enable-cxx --disable-replication --with-pic
# Cross hints added in config_cmds per-host
endef

# Make sure we always use bash for configure
define $(package)_preprocess_cmds
  true
endef

# -----------------------------
# Configure (force cross tools)
# -----------------------------
define $(package)_config_cmds
  mkdir -p $($(package)_build_subdir) && \
  cd $($(package)_build_subdir) && \
  CC="$(host)-gcc" CXX="$(host)-g++" AR="$(host)-ar" RANLIB="$(host)-ranlib" STRIP="$(host)-strip" \
  CPPFLAGS="-I$($(package)_staging_prefix_dir)/include" \
  CFLAGS="-O2" CXXFLAGS="-O2 -fno-exceptions -fno-rtti" \
  LDFLAGS="-L$($(package)_staging_prefix_dir)/lib" \
  ../dist/configure \
    --prefix=$($(package)_staging_prefix_dir) \
    --build=$(build) --host=$(host) \
    $($(package)_config_opts) \
    $(if $(findstring w64-mingw32,$(host)),--enable-mingw,--disable-mingw)
endef

# -----------------------------
# Build / Install
# -----------------------------
define $(package)_build_cmds
  $(MAKE) -C $($(package)_build_subdir) library_build
endef

define $(package)_stage_cmds
  $(MAKE) -C $($(package)_build_subdir) install_include install_lib
endef
