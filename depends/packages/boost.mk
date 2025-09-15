package=boost
$(package)_version=1.77.0
$(package)_download_path=https://boostorg.jfrog.io/artifactory/main/release/$($(package)_version)/source/
$(package)_file_name=boost_$(subst .,_,$($(package)_version)).tar.bz2
$(package)_sha256_hash=fc9f85fc030e233142908241af7a846e60630aa7388de9a5fafb1f3a26840854

define $(package)_set_vars
$(package)_config_opts_release=variant=release
$(package)_config_opts_debug=variant=debug
$(package)_config_opts=--layout=system --build-type=complete --user-config=user-config.jam
$(package)_config_opts+=threading=multi link=static -sNO_BZIP2=1 -sNO_ZLIB=1
$(package)_config_opts_linux+=target-os=linux threadapi=pthread runtime-link=shared
$(package)_config_opts_darwin+=target-os=darwin runtime-link=shared
$(package)_config_opts_mingw32+=--layout=tagged target-os=windows binary-format=pe threadapi=win32 runtime-link=static

endef

define $(package)_stage_cmds
  mkdir -p $($(package)_staging_prefix_dir)/include && \
  cp -r boost $($(package)_staging_prefix_dir)/include
endef
