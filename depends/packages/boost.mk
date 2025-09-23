package=boost
$(package)_version=1_71_0
$(package)_download_path=https://boostorg.jfrog.io/artifactory/main/release/$(subst _,.,$($(package)_version))/source/
$(package)_file_name=boost_$($(package)_version).tar.bz2
$(package)_sha256_hash=d73a8da01e8bf8c7eda40b4c84915071a8c8a0df4a6734537ddde4a8580524ee

define $(package)_set_vars
$(package)_config_opts_release=variant=release
$(package)_config_opts_debug=variant=debug
$(package)_config_opts=--layout=tagged --build-type=complete --user-config=user-config.jam
$(package)_config_opts+=threading=multi link=static -sNO_BZIP2=1 -sNO_ZLIB=1
$(package)_config_opts+=toolset=clang

# Per-OS cxxstd (do NOT set cxxstd globally)
$(package)_config_opts_linux=target-os=linux threadapi=pthread runtime-link=shared cxxstd=17
$(package)_config_opts_mingw32=target-os=windows binary-format=pe threadapi=win32 runtime-link=static cxxstd=17

# macOS: use C++14 to avoid Boost 1.71 + Apple clang 16 hiccups
$(package)_config_opts_darwin=target-os=darwin runtime-link=shared cxxstd=14
$(package)_config_opts_darwin+=cxxflags="-stdlib=libc++ -fvisibility=hidden -mmacosx-version-min=$(MACOSX_DEPLOYMENT_TARGET)"
$(package)_config_opts_darwin+=linkflags="-stdlib=libc++ -mmacosx-version-min=$(MACOSX_DEPLOYMENT_TARGET)"
# Optional if SDK availability warnings bite:
# $(package)_config_opts_darwin+=cxxflags+="-D_LIBCPP_DISABLE_AVAILABILITY"
# (Optional) keep b2 from injecting 10.10 defaults:
# $(package)_config_opts_darwin+=macosx-version=$(MACOSX_DEPLOYMENT_TARGET)

$(package)_config_opts_x86_64=architecture=x86 address-model=64
$(package)_config_opts_i686=architecture=x86 address-model=32
$(package)_config_opts_aarch64=address-model=64
$(package)_config_opts_armv7a=address-model=32

ifneq (,$(findstring clang,$($(package)_cxx)))
  $(package)_toolset_$(host_os)=clang
else
  $(package)_toolset_$(host_os)=gcc
endif

$(package)_config_libraries=filesystem,system,chrono,thread

# Do NOT force a -std here; let cxxstd above control it
$(package)_cxxflags=-fvisibility=hidden -D_GNU_SOURCE
$(package)_cxxflags_linux=-fPIC
$(package)_cxxflags_android=-fPIC
endef


define $(package)_preprocess_cmds
  echo "using $($(package)_toolset_$(host_os)) : : $($(package)_cxx) : <cflags>\"$($(package)_cflags)\" <cxxflags>\"$($(package)_cxxflags) $($(package)_cppflags)\" <linkflags>\"$($(package)_ldflags)\" <archiver>\"$($(package)_ar)\" <striper>\"$(host_STRIP)\" <ranlib>\"$(host_RANLIB)\" <rc>\"$(host_WINDRES)\" : ;" > user-config.jam && \
  [ -f boost/thread/pthread/thread_data.hpp ] && \
    sed -i -E 's/#if[[:space:]]+PTHREAD_STACK_MIN[[:space:]]*>[[:space:]]*0/#ifdef PTHREAD_STACK_MIN/' boost/thread/pthread/thread_data.hpp || true && \
  [ -f libs/thread/src/pthread/thread.cpp ] && \
    sed -i -E 's/#if[[:space:]]+PTHREAD_STACK_MIN[[:space:]]*>[[:space:]]*0/#ifdef PTHREAD_STACK_MIN/' libs/thread/src/pthread/thread.cpp || true
endef

define $(package)_config_cmds
  ./bootstrap.sh --without-icu --with-libraries=$($(package)_config_libraries) --with-toolset=$($(package)_toolset_$(host_os))
endef

define $(package)_build_cmds
  ./b2 -d2 -j2 -d1 --prefix=$($(package)_staging_prefix_dir) $($(package)_config_opts) toolset=$($(package)_toolset_$(host_os)) stage
endef

define $(package)_stage_cmds
  ./b2 -d0 -j4 --prefix=$($(package)_staging_prefix_dir) $($(package)_config_opts) toolset=$($(package)_toolset_$(host_os)) install
endef
