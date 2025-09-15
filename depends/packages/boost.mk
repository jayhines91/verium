package=boost
$(package)_version=1_70_0
$(package)_download_path=https://boostorg.jfrog.io/artifactory/main/release/1.70.0/source/
$(package)_file_name=boost_$($(package)_version).tar.bz2
$(package)_sha256_hash=430ae8354789de4fd19ee52f3b1f739e1fba576f0aded0897c3c2bc00fb38778

# IMPORTANT: define all patches on ONE line (or use +=). Using '=' multiple times overwrote previous ones.
$(package)_patches=unused_var_in_process.patch disable-predef-tools-check.patch fix_pthread_stack_min.patch

define $(package)_set_vars
$(package)_config_opts_release=variant=release
$(package)_config_opts_debug=variant=debug
$(package)_config_opts=--layout=tagged --build-type=complete --user-config=user-config.jam
$(package)_config_opts+=threading=multi link=static -sNO_BZIP2=1 -sNO_ZLIB=1
# keep b2 from touching Boost.Test anywhere, belt & suspenders
$(package)_config_opts+=--without-test

$(package)_config_opts_linux=target-os=linux threadapi=pthread runtime-link=shared
$(package)_config_opts_darwin=target-os=darwin runtime-link=shared
$(package)_config_opts_mingw32=target-os=windows binary-format=pe threadapi=win32 runtime-link=static
$(package)_config_opts_x86_64_mingw32=address-model=64
$(package)_config_opts_i686_mingw32=address-model=32
$(package)_config_opts_i686_linux=address-model=32 architecture=x86
$(package)_config_opts_i686_android=address-model=32
$(package)_config_opts_aarch64_android=address-model=64
$(package)_config_opts_x86_64_android=address-model=64
$(package)_config_opts_armv7a_android=address-model=32

$(package)_toolset_$(host_os)=gcc
$(package)_toolset_darwin=clang
ifneq (,$(findstring clang,$($(package)_cxx)))
   $(package)_toolset_$(host_os)=clang
endif
$(package)_archiver_$(host_os)=$($(package)_ar)

# Only what we need; drop 'test' so it never builds
$(package)_config_libraries=filesystem,system,thread

$(package)_cxxflags=-std=c++11 -fvisibility=hidden
# PTHREAD_STACK_MIN & GNU extensions needed by old Boost.Thread on glibc
$(package)_cxxflags+=-D_GNU_SOURCE -DPTHREAD_STACK_MIN=16384
$(package)_cxxflags_linux=-fPIC
$(package)_cxxflags_android=-fPIC
endef

define $(package)_preprocess_cmds
  patch --batch -N -p1 < $($(package)_patch_dir)/unused_var_in_process.patch || true && \
  patch --batch -N -p1 < $($(package)_patch_dir)/disable-predef-tools-check.patch || true && \
  patch --batch -N -p1 < $($(package)_patch_dir)/fix_pthread_stack_min.patch || true && \
  echo 'int main(){return 0;}' > libs/predef/tools/check/predef_check_cc_as_cpp.cpp && \
  echo 'int main(){return 0;}' > libs/predef/tools/check/predef_check_cc.cpp && \
  echo 'int main(){return 0;}' > libs/predef/tools/check.cpp && \
  echo "using $($(package)_toolset_$(host_os)) : : $($(package)_cxx) : <cxxflags>\"$($(package)_cxxflags) $($(package)_cppflags)\" <linkflags>\"$($(package)_ldflags)\" <archiver>\"$($(package)_archiver_$(host_os))\" <striper>\"$(host_STRIP)\"  <ranlib>\"$(host_RANLIB)\" <rc>\"$(host_WINDRES)\" : ;" > user-config.jam
endef

define $(package)_build_cmds
  ./b2 -d2 -j2 -d1 --prefix=$($(package)_staging_prefix_dir) $($(package)_config_opts) toolset=$($(package)_toolset_$(host_os)) stage
endef

define $(package)_stage_cmds
  ./b2 -d0 -j4 --prefix=$($(package)_staging_prefix_dir) $($(package)_config_opts) toolset=$($(package)_toolset_$(host_os)) install
endef
