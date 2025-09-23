package=bdb
$(package)_version=4.8.30
$(package)_download_path=https://download.oracle.com/berkeley-db
$(package)_file_name=db-$($(package)_version).NC.tar.gz
$(package)_sha256_hash=12edc0df75bf9abd7f82f821795bcee50f42cb2e5f76a6a281b85732798364ef
$(package)_build_subdir=build_unix

define $(package)_set_vars
# original config knobs
$(package)_config_opts=--disable-shared --enable-cxx --disable-replication
$(package)_config_opts_mingw32=--enable-mingw
$(package)_config_opts_linux=--with-pic
$(package)_config_opts_darwin=--with-pic

$(package)_cxxflags=-std=c++11
$(package)_cppflags_mingw32=-DUNICODE -D_UNICODE


$(package)_cflags=
$(package)_cflags_darwin+=-O2 -fPIC -mmacosx-version-min=$(MACOSX_DEPLOYMENT_TARGET) -isysroot $(SDKROOT) \
  -Wno-implicit-int -Wno-implicit-function-declaration -Wno-deprecated-non-prototype
$(package)_cppflags_darwin+=-D_DARWIN_C_SOURCE
$(package)_ldflags_darwin+=-mmacosx-version-min=$(MACOSX_DEPLOYMENT_TARGET) -isysroot $(SDKROOT)
endef

define $(package)_preprocess_cmds
  sed -i.old 's/__atomic_compare_exchange/__atomic_compare_exchange_db/' dbinc/atomic.h && \
  sed -i.old 's/atomic_init/atomic_init_db/' dbinc/atomic.h mp/mp_region.c mp/mp_mvcc.c mp/mp_fget.c mutex/mut_method.c mutex/mut_tas.c && \
  cp -f $(BASEDIR)/config.guess $(BASEDIR)/config.sub dist
endef

define $(package)_config_cmds
  CC="$(CC)" CXX="$(CXX)" \
  CFLAGS="$(CFLAGS) $($(package)_cflags) $($(package)_cflags_darwin)" \
  CPPFLAGS="$(CPPFLAGS) $($(package)_cppflags_darwin)" \
  LDFLAGS="$(LDFLAGS) $($(package)_ldflags_darwin)" \
  ../dist/$($(package)_autoconf)
endef

define $(package)_build_cmds
  $(MAKE) libdb_cxx-4.8.a libdb-4.8.a
endef

define $(package)_stage_cmds
  $(MAKE) DESTDIR=$($(package)_staging_dir) install_lib install_include
endef
