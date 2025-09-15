package=freetype
$(package)_version=2.7.1
$(package)_download_path=https://download.savannah.gnu.org/releases/$(package)
$(package)_file_name=$(package)-$($(package)_version).tar.bz2
$(package)_sha256_hash=3a3bb2c4e15ffb433f2032f50a5b5a92558206822e22bfe8cbe339af4aa82f88

define $(package)_set_vars
  # Build static only; enable PIC on Linux. (Avoids libtool weirdness with shared;
  # static is what the depends toolchain expects.)
  $(package)_config_opts=--without-zlib --without-png --without-harfbuzz --without-bzip2 --enable-static --disable-shared
  $(package)_config_opts += --enable-option-checking
  $(package)_config_opts_linux=--with-pic
endef

define $(package)_config_cmds
  $($(package)_autoconf)
endef

# IMPORTANT: compile via libtool so .lo files are valid libtool objects
define $(package)_build_cmds
  $(MAKE) CC="./builds/unix/libtool --mode=compile $($(package)_cc)"
endef

define $(package)_stage_cmds
  $(MAKE) DESTDIR=$($(package)_staging_dir) install
endef

define $(package)_postprocess_cmds
  rm -f lib/*.la
endef
