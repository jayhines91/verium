#!/bin/bash
# Script to prepare codebase for transfer to Linux

set -e

echo "=== Preparing Verium codebase for Linux transfer ==="
echo ""

# Check git status
if [ -d ".git" ]; then
    echo "📦 Git repository detected"
    UNCOMMITTED=$(git status --porcelain | wc -l | tr -d ' ')
    if [ "$UNCOMMITTED" -gt 0 ]; then
        echo "⚠️  Warning: $UNCOMMITTED uncommitted changes detected"
        echo "   Consider committing before transfer:"
        echo "   git add ."
        echo "   git commit -m 'Prepare for Linux build'"
        echo ""
    else
        echo "✅ All changes committed"
    fi
    
    CURRENT_BRANCH=$(git branch --show-current)
    echo "📍 Current branch: $CURRENT_BRANCH"
    echo ""
fi

# Create summary of what will be transferred
echo "=== Files to Transfer ==="
echo ""
echo "✅ Source code:"
find src -type f -name "*.cpp" -o -name "*.h" | wc -l | xargs echo "   - Source files:"
echo ""
echo "✅ Build scripts:"
[ -f "build-linux-x86.sh" ] && echo "   - build-linux-x86.sh" || echo "   ❌ Missing build-linux-x86.sh"
[ -f "build-linux-arm.sh" ] && echo "   - build-linux-arm.sh" || echo "   ❌ Missing build-linux-arm.sh"
echo ""
echo "✅ Configuration:"
[ -f "configure.ac" ] && echo "   - configure.ac" || echo "   ❌ Missing configure.ac"
[ -d "depends" ] && echo "   - depends/ directory" || echo "   ❌ Missing depends/"
echo ""
echo "✅ Documentation:"
[ -d "release-binaries/linux" ] && echo "   - release-binaries/linux/" || echo "   ❌ Missing release-binaries/linux/"
[ -f "TRANSFER_TO_LINUX.md" ] && echo "   - TRANSFER_TO_LINUX.md" || echo "   ❌ Missing TRANSFER_TO_LINUX.md"
echo ""

# Calculate size
echo "=== Size Estimate ==="
SIZE=$(du -sh . 2>/dev/null | cut -f1)
echo "   Total size: $SIZE"
echo ""

echo "=== Transfer Options ==="
echo ""
echo "1. Git Push/Pull (if repo is synced):"
echo "   git push origin $CURRENT_BRANCH"
echo ""
echo "2. Create tarball:"
echo "   cd .. && tar -czf verium-transfer.tar.gz verium/"
echo ""
echo "3. rsync (for direct transfer):"
echo "   rsync -avz --exclude='*.o' --exclude='*.a' . user@linux-box:/path/"
echo ""
echo "✅ Ready for transfer!"
