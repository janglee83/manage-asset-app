use std::path::{Path, PathBuf};
use std::fs;
use image::imageops::FilterType;
use base64::{engine::general_purpose::STANDARD, Engine as _};

const THUMB_SIZE: u32 = 200;

/// Generate a thumbnail for image files and save to cache_dir.
/// Returns the path to the saved thumbnail on success.
pub fn generate_thumbnail(file_path: &Path, cache_dir: &Path) -> Option<PathBuf> {
    // Only attempt for image files
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())?;

    let image_exts = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif", "ico"];
    if !image_exts.contains(&ext.as_str()) {
        return None;
    }

    let img = image::open(file_path).ok()?;
    let thumb = img.resize(THUMB_SIZE, THUMB_SIZE, FilterType::Triangle);

    fs::create_dir_all(cache_dir).ok()?;

    // Use hash of path as filename to avoid collisions
    let digest = {
        use sha2::{Sha256, Digest as _};
        let mut h = Sha256::new();
        h.update(file_path.to_string_lossy().as_bytes());
        hex::encode(h.finalize())
    };

    let thumb_name = format!("{}.jpg", &digest[..16]);
    let thumb_path = cache_dir.join(&thumb_name);

    thumb.save_with_format(&thumb_path, image::ImageFormat::Jpeg).ok()?;
    Some(thumb_path)
}

/// Return thumbnail as base64-encoded JPEG string for fast inline preview
pub fn thumbnail_as_base64(thumb_path: &Path) -> Option<String> {
    let bytes = fs::read(thumb_path).ok()?;
    Some(format!("data:image/jpeg;base64,{}", STANDARD.encode(&bytes)))
}
