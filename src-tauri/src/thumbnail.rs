//! Production thumbnail generation engine.
//!
//! Supports PNG, JPEG, WebP, BMP, GIF, TIFF, ICO (via `image`) and SVG (via
//! `resvg`).
//!
//! Cache keys encode the file's mtime, so any modification to the source file
//! transparently invalidates the cached thumbnail. Fast-path: if the cached
//! file already exists on disk the function returns immediately.
//!
//! Public API
//! ----------
//! * [`generate_thumbnail`]        — single file; used by watcher and commands
//! * [`generate_thumbnails_batch`] — rayon-parallel batch; used by scanner
//! * [`thumbnail_as_base64`]       — encode a cached JPEG as an inline data-URL

use std::fs::{self, File};
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, RgbImage};
use rayon::prelude::*;
use resvg::{tiny_skia, usvg};
use sha2::{Digest, Sha256};

// ── Constants ─────────────────────────────────────────────────────────────────

const THUMB_SIZE: u32 = 256;
const JPEG_QUALITY: u8 = 85;
/// Downscale ratio above which Lanczos3 delivers noticeably better quality
/// than the cheaper Triangle (bilinear) filter.
const LANCZOS_THRESHOLD: f32 = 4.0;

// ── Cache-key helpers ─────────────────────────────────────────────────────────

/// Derive the thumbnail cache path for a given source file + mtime.
///
/// Key = `SHA-256(path_bytes ++ mtime_le_u64)[..24].jpg`.
/// Embedding the mtime means the key rotates whenever the source file changes,
/// so stale cached thumbnails become unreachable automatically.
fn thumb_cache_path(file_path: &Path, cache_dir: &Path, mtime: u64) -> PathBuf {
    let mut h = Sha256::new();
    h.update(file_path.to_string_lossy().as_bytes());
    h.update(mtime.to_le_bytes());
    cache_dir.join(format!("{}.jpg", &hex::encode(h.finalize())[..24]))
}

fn file_mtime(path: &Path) -> u64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ── Filter selection ──────────────────────────────────────────────────────────

fn choose_filter(src_max_dim: u32) -> FilterType {
    if src_max_dim as f32 / THUMB_SIZE as f32 > LANCZOS_THRESHOLD {
        FilterType::Lanczos3
    } else {
        FilterType::Triangle
    }
}

// ── Decoders ─────────────────────────────────────────────────────────────────

fn decode_raster(path: &Path) -> Option<DynamicImage> {
    image::open(path).ok()
}

/// Rasterise an SVG to an `RgbImage` at most `THUMB_SIZE × THUMB_SIZE`.
///
/// The SVG is composited on a white background by converting the premultiplied
/// RGBA output of tiny_skia:  `out_channel = premul_channel + (255 − alpha)`.
fn decode_svg(path: &Path) -> Option<DynamicImage> {
    let data = fs::read(path).ok()?;
    let opt = usvg::Options::default();
    let tree = usvg::Tree::from_data(&data, &opt).ok()?;

    let sz = tree.size();
    let sw = sz.width();
    let sh = sz.height();
    if sw <= 0.0 || sh <= 0.0 {
        return None;
    }

    let scale = THUMB_SIZE as f32 / sw.max(sh);
    let pw = ((sw * scale).ceil() as u32).max(1);
    let ph = ((sh * scale).ceil() as u32).max(1);

    let mut pixmap = tiny_skia::Pixmap::new(pw, ph)?;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );

    // Premultiplied RGBA → RGB composited on white.
    // Stored layout: (R×A/255, G×A/255, B×A/255, A).
    // Composite on white (255, 255, 255): out = premul + (255 − A).
    let raw = pixmap.take(); // Vec<u8>, premultiplied RGBA8
    let mut rgb = Vec::with_capacity((pw * ph * 3) as usize);
    for px in raw.chunks_exact(4) {
        let inv_a = 255u8 - px[3];
        rgb.push(px[0].saturating_add(inv_a));
        rgb.push(px[1].saturating_add(inv_a));
        rgb.push(px[2].saturating_add(inv_a));
    }

    RgbImage::from_raw(pw, ph, rgb).map(DynamicImage::ImageRgb8)
}

// ── JPEG encoder ──────────────────────────────────────────────────────────────

fn save_jpeg(img: &DynamicImage, dest: &Path) -> std::io::Result<()> {
    let f = File::create(dest)?;
    let mut w = BufWriter::new(f);
    JpegEncoder::new_with_quality(&mut w, JPEG_QUALITY)
        .encode_image(img)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
}

// ── Core logic ────────────────────────────────────────────────────────────────

fn generate_inner(file_path: &Path, cache_dir: &Path) -> Option<PathBuf> {
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)?;

    let is_raster = matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp" | "tiff" | "tif" | "ico"
    );
    let is_svg = ext == "svg";

    if !is_raster && !is_svg {
        return None;
    }

    fs::create_dir_all(cache_dir).ok()?;

    // ── Fast path ────────────────────────────────────────────────────────────
    let mtime = file_mtime(file_path);
    let thumb_path = thumb_cache_path(file_path, cache_dir, mtime);
    if thumb_path.exists() {
        return Some(thumb_path);
    }

    // ── Decode ───────────────────────────────────────────────────────────────
    let img = if is_svg {
        decode_svg(file_path)?
    } else {
        decode_raster(file_path)?
    };

    // ── Resize ───────────────────────────────────────────────────────────────
    let filter = choose_filter(img.width().max(img.height()));
    let thumb = img.resize(THUMB_SIZE, THUMB_SIZE, filter);

    // ── Encode & persist ─────────────────────────────────────────────────────
    save_jpeg(&thumb, &thumb_path).ok()?;

    Some(thumb_path)
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Generate a thumbnail for `file_path` and store it under `cache_dir`.
///
/// Returns the thumbnail [`PathBuf`] on success, or `None` if the format is
/// unsupported or an I/O / decode error occurred.
///
/// Idempotent: if a valid cached thumbnail already exists (same mtime as the
/// source file), the cached path is returned immediately.
pub fn generate_thumbnail(file_path: &Path, cache_dir: &Path) -> Option<PathBuf> {
    generate_inner(file_path, cache_dir)
}

/// Generate thumbnails for a batch of `(file_path, cache_dir)` pairs in
/// parallel using Rayon.  Returns one `Option<PathBuf>` per input, in order.
pub fn generate_thumbnails_batch(entries: &[(PathBuf, PathBuf)]) -> Vec<Option<PathBuf>> {
    entries
        .par_iter()
        .map(|(f, c)| generate_inner(f, c))
        .collect()
}

/// Encode a cached thumbnail JPEG as a `data:image/jpeg;base64,...` data-URL.
pub fn thumbnail_as_base64(thumb_path: &Path) -> Option<String> {
    let bytes = fs::read(thumb_path).ok()?;
    Some(format!("data:image/jpeg;base64,{}", STANDARD.encode(&bytes)))
}
