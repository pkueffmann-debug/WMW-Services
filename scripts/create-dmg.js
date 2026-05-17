#!/usr/bin/env node
// Creates a macOS DMG using hdiutil (built into macOS — no external tools needed)
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const ROOT     = path.join(__dirname, '..');
// Look for arch-suffixed dirs first (electron-builder produces dist/mac-arm64
// or dist/mac-x64 when --arm64/--x64 is passed explicitly), then fall back to
// the unsuffixed dist/mac that --mac --dir creates by default.
const APP_DIR = ['mac-arm64', 'mac-x64', 'mac']
  .map(d => path.join(ROOT, 'dist', d))
  .find(d => fs.existsSync(path.join(d, 'JARVIS.app'))) || path.join(ROOT, 'dist', 'mac');
const APP      = path.join(APP_DIR, 'JARVIS.app');
const OUT_DIR  = path.join(ROOT, 'dist');
const VERSION  = require(path.join(ROOT, 'package.json')).version;
const DMG      = path.join(OUT_DIR, `JARVIS-${VERSION}.dmg`);
const TMP_DMG  = path.join(OUT_DIR, `jarvis_tmp_${Date.now()}.dmg`);
const VOLNAME  = 'JARVIS';
// Use a safe build-time name that doesn't conflict with /Applications/JARVIS.app
const BUILD_VOL = 'JARVIS_BUILD';

if (!fs.existsSync(APP)) {
  console.error(`✗ App bundle not found: ${APP}`);
  console.error('  Run `npm run dist:dir` first.');
  process.exit(1);
}

run();

async function run() {
  console.log(`Building DMG for JARVIS ${VERSION}…\n`);

  // Determine size: app size + 20% headroom, minimum 600 MB
  const appSizeMB = parseInt(exec(`du -sm "${APP}"`).split('\t')[0] || '537', 10);
  const dmgSizeMB = Math.max(600, Math.ceil(appSizeMB * 1.2));

  // 1. Create a blank writable DMG with a safe volume name (not "JARVIS" to avoid TCC conflicts)
  console.log(`1/4 Creating writable image (${dmgSizeMB} MB)…`);
  exec(`hdiutil create \
    -megabytes ${dmgSizeMB} \
    -volname "${BUILD_VOL}" \
    -fs HFS+ \
    "${TMP_DMG}"`);

  // 2. Mount it
  console.log('2/4 Mounting and copying app…');
  const attachOut = exec(`hdiutil attach -readwrite -noverify -noautoopen "${TMP_DMG}"`);
  const device = attachOut.split('\n').find(l => l.startsWith('/dev/'))?.split(/\s/)[0];
  if (!device) { fs.unlinkSync(TMP_DMG); throw new Error('Could not mount DMG'); }

  const buildMountPath = `/Volumes/${BUILD_VOL}`;

  try {
    // Copy app bundle (ditto preserves all metadata and extended attributes)
    const dittoResult = exec(`ditto "${APP}" "${buildMountPath}/JARVIS.app" 2>&1`);
    if (dittoResult.includes('Operation not permitted') || dittoResult.includes('nicht zugelassen')) {
      throw new Error(`ditto failed: ${dittoResult}`);
    }

    // Add Applications symlink
    exec(`ln -sf /Applications "${buildMountPath}/Applications"`);

    // Copy volume icon
    const icns = path.join(ROOT, 'assets', 'jarvis.icns');
    if (fs.existsSync(icns)) {
      exec(`cp "${icns}" "${buildMountPath}/.VolumeIcon.icns" 2>/dev/null || true`);
      exec(`SetFile -a C "${buildMountPath}" 2>/dev/null || true`);
    }

    // Rename volume to final name (must happen AFTER copying the app)
    exec(`diskutil rename "${BUILD_VOL}" "${VOLNAME}"`);
    const mountPath = `/Volumes/${VOLNAME}`;

    // Set window layout via AppleScript
    exec(`osascript -e '
      tell application "Finder"
        tell disk "${VOLNAME}"
          open
          set current view of container window to icon view
          set toolbar visible of container window to false
          set statusbar visible of container window to false
          set bounds of container window to {400, 100, 940, 480}
          set icon size of icon view options of container window to 100
          set arrangement of icon view options of container window to not arranged
          set position of item "JARVIS.app" of container window to {150, 185}
          set position of item "Applications" of container window to {390, 185}
          close
          open
          update without registering applications
          delay 2
          close
        end tell
      end tell
    ' 2>/dev/null || true`);

  } finally {
    // Detach whichever volume name is mounted
    exec(`hdiutil detach "${device}" -force`);
  }

  // 4. Convert to compressed read-only DMG
  console.log('3/4 Compressing…');
  if (fs.existsSync(DMG)) fs.unlinkSync(DMG);
  exec(`hdiutil convert "${TMP_DMG}" -format UDZO -imagekey zlib-level=9 -o "${DMG}"`);
  fs.unlinkSync(TMP_DMG);

  const sizeMB = (fs.statSync(DMG).size / 1024 / 1024).toFixed(1);
  console.log(`4/4 Done!\n\n✓ ${path.basename(DMG)} (${sizeMB} MB)`);
  console.log(`   ${DMG}`);
}

function exec(cmd) {
  const result = spawnSync('sh', ['-c', cmd], { encoding: 'utf8' });
  if (result.status !== 0 && !cmd.includes('2>/dev/null')) {
    const err = (result.stderr || '').trim();
    if (err) console.warn('  warn:', err.slice(0, 300));
  }
  return (result.stdout || '').trim();
}
