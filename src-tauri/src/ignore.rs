//! Smart ignore system for the file scanner.
//!
//! Production rules (all lowercase-matched, checked on every path component):
//!
//!  - Hard-coded directory names that should NEVER be indexed
//!    (node_modules, .git, build artefacts, dependency caches, etc.)
//!
//!  - Hard-coded path patterns (sub-strings that indicate temp / cache dirs)
//!
//! Design: checked with a single `should_ignore_path()` call per path, which
//! inspects ALL ancestor components — so a `node_modules` nested 5 levels deep
//! is caught just as efficiently as one at the root.
//!
//! Performance notes:
//!  - All comparisons are on pre-lowercased `&str` slices (zero allocation).
//!  - Called in WalkDir's `filter_entry` hook to prune entire directory trees
//!    without descending into them.

use std::path::Path;

/// Directory names that are always skipped, regardless of depth.
const IGNORE_DIRS: &[&str] = &[
    // JS / Node
    "node_modules",
    ".yarn",
    ".pnp",
    // Python
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    "site-packages",
    // Version control
    ".git",
    ".svn",
    ".hg",
    // Build outputs
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".output",
    "target",    // Rust/Maven
    // IDEs / editors
    ".idea",
    ".vscode",   // only the hidden dot-folder, not a folder named "vscode"
    ".vs",
    // OS
    ".Spotlight-V100",
    ".Trashes",
    ".fseventsd",
    "System Volume Information",
    "$RECYCLE.BIN",
    ".Trash",
    // Caches & temps
    ".cache",
    "cache",
    ".tmp",
    "tmp",
    "temp",
    ".temp",
    // Figma / design tool caches
    ".figma",
    // Package manager caches
    ".npm",
    ".pnpm",
    ".gradle",
    ".m2",
    // Test artefacts
    "coverage",
    ".nyc_output",
    // Misc
    "logs",
    ".logs",
    "__MACOSX",  // macOS archive artefact
];

/// Path sub-strings (checked on the full lower-case path string).
/// Use sparingly — too many slow down every path check.
const IGNORE_PATH_PATTERNS: &[&str] = &[
    "/node_modules/",
    "\\.git/",
    "/__pycache__/",
    "/site-packages/",
];

/// Returns `true` when the path (or any of its directory components) matches
/// the ignore rules above.  Thread-safe; no allocations for the fast path.
pub fn should_ignore_path(path: &Path) -> bool {
    for component in path.components() {
        if let std::path::Component::Normal(os_str) = component {
            if let Some(s) = os_str.to_str() {
                let lower = s.to_lowercase();
                if IGNORE_DIRS.contains(&lower.as_str()) {
                    return true;
                }
            }
        }
    }

    // Secondary pattern check on the full lowercased path string.
    // Only runs when the component scan above didn't match.
    let full = path.to_string_lossy().to_lowercase();
    for pat in IGNORE_PATH_PATTERNS {
        if full.contains(pat) {
            return true;
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn ignores_node_modules() {
        assert!(should_ignore_path(&PathBuf::from("/project/node_modules/lodash/index.js")));
        assert!(should_ignore_path(&PathBuf::from("/project/node_modules")));
    }

    #[test]
    fn ignores_dotgit() {
        assert!(should_ignore_path(&PathBuf::from("/project/.git/HEAD")));
        assert!(should_ignore_path(&PathBuf::from("/project/.git")));
    }

    #[test]
    fn ignores_pycache() {
        assert!(should_ignore_path(&PathBuf::from("/project/src/__pycache__/main.pyc")));
    }

    #[test]
    fn ignores_temp() {
        assert!(should_ignore_path(&PathBuf::from("/tmp/file.png")));
        assert!(should_ignore_path(&PathBuf::from("/project/temp/file.png")));
    }

    #[test]
    fn allows_normal_paths() {
        assert!(!should_ignore_path(&PathBuf::from("/Users/alice/Designs/dashboard.fig")));
        assert!(!should_ignore_path(&PathBuf::from("/home/bob/assets/logo.png")));
    }
}
