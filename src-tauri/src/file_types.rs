use std::path::Path;

/// Exactly the extensions the scanner is asked to index (Phase 1 target set).
/// Stored lowercase; comparison must use `.to_lowercase()`.
/// NOTE: kept for reference — the scanner now uses `is_supported()` so that
/// every file type tracked by the watcher is also indexed on first scan.
pub const SCAN_TARGETS: &[&str] = &["png", "jpg", "jpeg", "svg", "webp", "fig"];

/// Broader image set used for thumbnail generation decisions.
pub const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif", "svg", "ico", "heic", "heif",
    "avif",
];

pub const DESIGN_EXTENSIONS: &[&str] = &[
    "fig", "sketch", "xd", "psd", "ai", "eps", "indd", "pdf",
];

pub const REFERENCE_EXTENSIONS: &[&str] = &["pdf", "doc", "docx", "ppt", "pptx", "txt", "md"];

pub const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mov", "avi", "mkv", "webm"];

pub const FONT_EXTENSIONS: &[&str] = &["ttf", "otf", "woff", "woff2"];
/// Returns true if this is a design-tool file (fig, sketch, xd, psd, ai, eps, indd).
pub fn is_design_file(path: &Path) -> bool {
    ext_matches(path, DESIGN_EXTENSIONS)
}
/// Returns true when the file should be included in a scan.
pub fn is_scan_target(path: &Path) -> bool {
    ext_matches(path, SCAN_TARGETS)
}

/// Broader supported check (used by the file watcher).
pub fn is_supported(path: &Path) -> bool {
    ext_matches(path, IMAGE_EXTENSIONS)
        || ext_matches(path, DESIGN_EXTENSIONS)
        || ext_matches(path, REFERENCE_EXTENSIONS)
        || ext_matches(path, VIDEO_EXTENSIONS)
        || ext_matches(path, FONT_EXTENSIONS)
}

/// Returns true if the file is a raster/vector image that can be thumbnailed.
pub fn is_image(path: &Path) -> bool {
    ext_matches(path, IMAGE_EXTENSIONS)
}

fn ext_matches(path: &Path, list: &[&str]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| list.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

