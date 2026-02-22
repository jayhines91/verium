#ifndef BITCOIN_UTIL_MINIUNZ_H
#define BITCOIN_UTIL_MINIUNZ_H

#include <boost/filesystem.hpp>
#include <minizip/unzip.h>
#include <fs.h>

/** Get the first entry name in the zip (positions at first file). Returns false on error. */
bool zip_get_first_entry_name(unzFile uf, char* buffer, size_t size);

/** Extract all files. If dest_subdir is non-null, entries are extracted under root_file_path/dest_subdir/ (for zips with top-level blocks/chainstate). */
int zip_extract_all(unzFile uf, const fs::path& root_file_path, const char * allowed_dir, const char * dest_subdir = nullptr);

#endif // BITCOIN_UTIL_MINIUNZ_H
