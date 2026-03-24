use std::fs;
use std::io::Read;
use std::path::Path;
use sha2::{Sha256, Digest};

/// Compute SHA-256 hash of a file (first 512KB for speed)
pub fn hash_file(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    let mut bytes_read = 0usize;
    loop {
        let n = file.read(&mut buffer).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
        bytes_read += n;
        if bytes_read >= 524288 {
            break;
        }
    }
    Some(hex::encode(hasher.finalize()))
}
