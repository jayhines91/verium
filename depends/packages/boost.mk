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

# Libraries we actually need
$(package)_config_libraries=filesystem,system,chrono,thread

# Default C++ std per target (override below where necessary)
$(package)_cxxstd=17

# Address model / arch helpers
$(package)_config_opts_x86_64=architecture=x86 address-model=64
$(package)_config_opts_i686=architecture=x86 address-model=32
$(package)_config_opts_aarch64=address-model=64
$(package)_config_opts_armv7a=address-model=32

# Baseline compiler flags
$(package)_cxxflags=-fvisibility=hidden -D_GNU_SOURCE
$(package)_cxxflags_linux=-fPIC
$(package)_cxxflags_android=-fPIC

# Target-specific b2 options
$(package)_config_opts_linux=target-os=linux threadapi=pthread runtime-link=shared cxxstd=$($(package)_cxxstd)
$(package)_config_opts_mingw32=target-os=windows binary-format=pe threadapi=win32 runtime-link=static cxxstd=$($(package)_cxxstd)

# macOS tweaks: libc++, min version, silence enum constexpr warning
$(package)_config_opts_darwin=target-os=darwin threadapi=pthread runtime-link=shared cxxstd=14
$(package)_config_opts_darwin+= cxxflags="-stdlib=libc++ -mmacosx-version-min=$(MACOSX_DEPLOYMENT_TARGET) -pthread -Wno-enum-constexpr-conversion -Wno-error=enum-constexpr-conversion -DBOOST_MPL_CFG_NO_NESTED_VALUE_ARITHMETIC"
$(package)_config_opts_darwin+= linkflags="-stdlib=libc++ -mmacosx-version-min=$(MACOSX_DEPLOYMENT_TARGET) -pthread"

# Toolset selection (by host)
# - MinGW targets always gcc (brings Win headers/CRT)
# - else: pick clang if the actual C++ compiler name contains 'clang'
ifneq (,$(findstring w64-mingw32,$(host)))
  $(package)_toolset_$(host_os)=gcc
else
  ifneq (,$(findstring clang,$($(package)_cxx)))
    $(package)_toolset_$(host_os)=clang
  else
    $(package)_toolset_$(host_os)=gcc
  endif
endif
endef

define $(package)_preprocess_cmds
  if echo "$(host)" | grep -q "w64-mingw32"; then \
    echo "using gcc : mingw : $(host)-g++ : <rc>$(host)-windres <archiver>$(host)-ar <ranlib>$(host)-ranlib ;" > user-config.jam; \
  else \
    echo "using $($(package)_toolset_$(host_os)) : : $($(package)_cxx) : <cflags>\"$($(package)_cflags)\" <cxxflags>\"$($(package)_cxxflags) $($(package)_cppflags)\" <linkflags>\"$($(package)_ldflags)\" <archiver>\"$($(package)_ar)\" <ranlib>\"$(host_RANLIB)\" ;" > user-config.jam; \
  fi; \
  if [ -f boost/thread/pthread/thread_data.hpp ]; then \
    sed -i -E 's/#if[[:space:]]+PTHREAD_STACK_MIN[[:space:]]*>[[:space:]]*0/#ifdef PTHREAD_STACK_MIN/' boost/thread/pthread/thread_data.hpp; \
  fi; \
  if [ -f libs/thread/src/pthread/thread.cpp ]; then \
    sed -i -E 's/#if[[:space:]]+PTHREAD_STACK_MIN[[:space:]]*>[[:space:]]*0/#ifdef PTHREAD_STACK_MIN/' libs/thread/src/pthread/thread.cpp; \
  fi
endef

define $(package)_config_cmds
  ./bootstrap.sh --without-icu --with-libraries=$($(package)_config_libraries) --with-toolset=$($(package)_toolset_$(host_os))
endef

define $(package)_build_cmds
  ./b2 -d2 -j2(nproc) \
    --prefix=$($(package)_staging_prefix_dir) \
    $($(package)_config_opts) \
    $($(package)_config_opts_$(host_os)) \
    $($(package)_config_opts_$(host_arch)) \
    toolset=$($(package)_toolset_$(host_os)) \
    stage
endef

define $(package)_stage_cmds
  ./b2 -d0 -j$$(nproc) \
    --prefix=$($(package)_staging_prefix_dir) \
    $($(package)_config_opts) \
    $($(package)_config_opts_$(host_os)) \
    $($(package)_config_opts_$(host_arch)) \
    toolset=$($(package)_toolset_$(host_os)) \
    install
endef
