# Minimal Markdown Editor Icon

## Files
- `icon.svg`: editable, resolution-independent vector master
- `icon.png`: 512×512 PNG
- `icon-16.png` … `icon-1024.png`: common raster sizes
- `icon.ico`: Windows multi-size icon

## Platform guidance
- **Linux:** use `icon.svg` or `icon.png` for desktop entries / app metadata.
- **Windows:** use `icon.ico` for executable/window icons; keep PNGs for installer/UI assets.
- **macOS:** use a macOS `.icns` asset in the app bundle. Convert the supplied 1024×1024 PNG to ICNS using macOS `iconutil` / your packaging toolchain. The PNG is the source image; macOS apps may also need a proper asset catalog.
- **Web:** use `icon-32.png` or `icon-16.png` as favicon; SVG can also be used where supported.

This is a minimalist neutral-white design with a charcoal `M↓` mark and gray document lines. For dark mode or platforms that mask icons into circles, test contrast and safe margins before release.
