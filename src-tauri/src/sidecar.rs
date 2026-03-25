//! Manages the lifetime of the Python semantic-search sidecar process and
//! provides an async JSON-RPC client over its stdin/stdout pipes.
//!
//! Transport: newline-delimited JSON
//!   Request  → {"id": <u64>, "method": "<name>", "params": {...}}
//!   Response ← {"id": <u64>, "result": {...}}            (success)
//!            ← {"id": <u64>, "error": "<msg>"}           (error)
//!   Push     ← {"id": null,  "result": {"event": "...", "data": {...}}}
//!
//! # Crash safety
//! * `call()` applies a 30-second per-request timeout — a hung/dead sidecar
//!   will not block Tauri commands indefinitely.
//! * The reader thread detects EOF and wakes all pending callers with an error
//!   so they can surface a `Sidecar` `AppError` to the frontend immediately.
//! * `SidecarHandle::health_check()` sends a lightweight `{"method":"health"}`
//!   ping; callers can use this to decide whether to restart.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use tokio::time::timeout;

/// Default timeout for a single sidecar RPC call that is expected to be fast
/// (semantic search, tag lookup, design understanding, health, etc.).
pub const CALL_TIMEOUT: Duration = Duration::from_secs(120);

/// Timeout used for methods that load the CLIP model on first invocation
/// (image encoding + FAISS search).  Model download is excluded because that
/// only happens on first ever run outside this call; loading from the
/// sentence-transformers cache still takes 30–90 s on slow hardware.
pub const SEARCH_TIMEOUT: Duration = Duration::from_secs(300); // 5 min

/// Timeout for embedding pipelines that process the whole library.
/// 32 images/batch × ~0.5 s/image × worst-case 2000 images = ~30 s, but
/// a large library on slow hardware may take several minutes.
pub const EMBED_TIMEOUT: Duration = Duration::from_secs(1800); // 30 min

/// Timeout for OCR batch runs.
pub const OCR_BATCH_TIMEOUT: Duration = Duration::from_secs(600); // 10 min

/// Timeout for the lightweight health-check ping.
const HEALTH_TIMEOUT: Duration = Duration::from_secs(5);

// ── Internal response shape ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct RpcResponse {
    id: Option<u64>,
    result: Option<Value>,
    error: Option<String>,
}

// ── Pending-call registry ─────────────────────────────────────────────────────

type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

// ── Public handle ─────────────────────────────────────────────────────────────

/// Cloneable (via `Arc`) handle to the running Python sidecar process.
pub struct SidecarHandle {
    stdin:   Arc<Mutex<BufWriter<ChildStdin>>>,
    next_id: Arc<AtomicU64>,
    pending: PendingMap,
    /// Set to `true` by the reader thread when the process exits.
    pub dead: Arc<AtomicBool>,
    // Kept alive so the process is not waited/killed until the handle is dropped.
    _child: Arc<Mutex<Child>>,
}

impl SidecarHandle {
    /// Spawn the sidecar process and start the background reader thread.
    ///
    /// `python_exe`  — path to the Python interpreter (e.g. `.venv/bin/python` or `"python3"`).
    /// `script_path` — absolute path to `python-service/main.py`.
    /// `cwd`         — working directory for the child process (the `python-service/` dir);
    ///                 Python adds `cwd` to `sys.path[0]` so `from embedder import …` works.
    pub fn spawn(python_exe: &str, script_path: &str, cwd: &str, app: AppHandle) -> Result<Self, String> {
        let mut child = Command::new(python_exe)
            .arg(script_path)
            .current_dir(cwd)
            // Guarantee the script's own directory is on sys.path even when the
            // interpreter is invoked with an absolute path from a different cwd.
            .env("PYTHONPATH", cwd)
            // ── Thread-count limits ──────────────────────────────────────────
            // On macOS, OpenBLAS/OpenMP create shared semaphores for their
            // thread pool.  If the process exits before cleaning them up, macOS
            // resource_tracker warns and may kill the process.  Forcing all
            // scientific libraries to a single thread prevents semaphore creation
            // and eliminates the over-subscription crash on Python 3.9.
            .env("OMP_NUM_THREADS",        "1")
            .env("OPENBLAS_NUM_THREADS",   "1")
            .env("MKL_NUM_THREADS",        "1")
            .env("VECLIB_MAXIMUM_THREADS", "1")
            .env("NUMEXPR_NUM_THREADS",    "1")
            // Prevents HuggingFace fast-tokenizers from spawning child processes.
            .env("TOKENIZERS_PARALLELISM", "false")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Failed to spawn Python sidecar: {e}"))?;

        let stdin  = child.stdin.take()
            .ok_or_else(|| "sidecar process did not attach stdin — OS spawn config error".to_string())?;
        let stdout = child.stdout.take()
            .ok_or_else(|| "sidecar process did not attach stdout — OS spawn config error".to_string())?;

        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let pending_reader = pending.clone();
        let dead_flag: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));
        let dead_reader = dead_flag.clone();

        // ── Background reader thread ──────────────────────────────────────────
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let s = match line {
                    Ok(s)  => s,
                    Err(e) => {
                        tracing::error!("[sidecar] stdout read error: {e}");
                        break;
                    }
                };
                if s.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<RpcResponse>(&s) {
                    Ok(resp) => match resp.id {
                        Some(id) => {
                            // Route response to the waiting async caller.
                            let tx = pending_reader.lock().unwrap().remove(&id);
                            if let Some(tx) = tx {
                                let val = match resp.error {
                                    Some(e) => Err(e),
                                    None    => Ok(resp.result.unwrap_or(Value::Null)),
                                };
                                let _ = tx.send(val);
                            }
                        }
                        None => {
                            // Push notification → Tauri event
                            if let Some(data) = resp.result {
                                let _ = app.emit("sidecar_event", data);
                            }
                        }
                    },
                    Err(e) => {
                        tracing::warn!("[sidecar] malformed JSON: {e} — raw: {s}");
                    }
                }
            }

            // EOF: the process has died; wake all pending callers with an error.
            dead_reader.store(true, Ordering::SeqCst);
            let mut map = pending_reader.lock().unwrap();
            for (_, tx) in map.drain() {
                let _ = tx.send(Err("Sidecar process terminated unexpectedly".into()));
            }
            tracing::error!("[sidecar] reader thread exited — process has stopped");
            // Notify the frontend so it can show a user-visible warning.
            let _ = app.emit("sidecar_dead", ());
        });

        Ok(SidecarHandle {
            stdin:   Arc::new(Mutex::new(BufWriter::new(stdin))),
            next_id: Arc::new(AtomicU64::new(1)),
            pending,
            dead:    dead_flag,
            _child:  Arc::new(Mutex::new(child)),
        })
    }

    /// Spawn a *compiled* sidecar executable directly — no script arg.
    ///
    /// Used on Windows production builds where the Python service is bundled as a
    /// PyInstaller `--onedir` binary (e.g. `asset-vault-sidecar.exe`). The
    /// executable communicates via the same stdin/stdout JSON-RPC protocol.
    pub fn spawn_exe(exe_path: &str, cwd: &str, app: AppHandle) -> Result<Self, String> {
        let mut child = Command::new(exe_path)
            .current_dir(cwd)
            .env("OMP_NUM_THREADS",        "1")
            .env("OPENBLAS_NUM_THREADS",   "1")
            .env("MKL_NUM_THREADS",        "1")
            .env("VECLIB_MAXIMUM_THREADS", "1")
            .env("NUMEXPR_NUM_THREADS",    "1")
            .env("TOKENIZERS_PARALLELISM", "false")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Failed to spawn compiled sidecar: {e}"))?;

        let stdin  = child.stdin.take()
            .ok_or_else(|| "sidecar process did not attach stdin — OS spawn config error".to_string())?;
        let stdout = child.stdout.take()
            .ok_or_else(|| "sidecar process did not attach stdout — OS spawn config error".to_string())?;

        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let pending_reader = pending.clone();
        let dead_flag: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));
        let dead_reader = dead_flag.clone();

        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let s = match line {
                    Ok(s)  => s,
                    Err(e) => { tracing::error!("[sidecar] stdout read error: {e}"); break; }
                };
                if s.trim().is_empty() { continue; }
                match serde_json::from_str::<RpcResponse>(&s) {
                    Ok(resp) => match resp.id {
                        Some(id) => {
                            let tx = pending_reader.lock().unwrap().remove(&id);
                            if let Some(tx) = tx {
                                let val = match resp.error {
                                    Some(e) => Err(e),
                                    None    => Ok(resp.result.unwrap_or(Value::Null)),
                                };
                                let _ = tx.send(val);
                            }
                        }
                        None => {
                            if let Some(data) = resp.result {
                                let _ = app.emit("sidecar_event", data);
                            }
                        }
                    },
                    Err(e) => tracing::warn!("[sidecar] malformed JSON: {e} — raw: {s}"),
                }
            }
            dead_reader.store(true, Ordering::SeqCst);
            let mut map = pending_reader.lock().unwrap();
            for (_, tx) in map.drain() {
                let _ = tx.send(Err("Sidecar process terminated unexpectedly".into()));
            }
            tracing::error!("[sidecar] reader thread exited — process has stopped");
            let _ = app.emit("sidecar_dead", ());
        });

        Ok(SidecarHandle {
            stdin:   Arc::new(Mutex::new(BufWriter::new(stdin))),
            next_id: Arc::new(AtomicU64::new(1)),
            pending,
            dead:    dead_flag,
            _child:  Arc::new(Mutex::new(child)),
        })
    }

    /// Send a request and await its response using the default `CALL_TIMEOUT`.
    ///
    /// For long-running methods (embed_batch, search_by_image, extract_ocr_batch)
    /// use `call_with_timeout` with an appropriate duration instead.
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        self.call_with_timeout(method, params, CALL_TIMEOUT).await
    }

    /// Send a request and await its response with a caller-supplied deadline.
    pub async fn call_with_timeout(
        &self,
        method: &str,
        params: Value,
        deadline: Duration,
    ) -> Result<Value, String> {
        if self.dead.load(Ordering::SeqCst) {
            return Err("Sidecar process is not running".into());
        }

        let id   = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req  = json!({ "id": id, "method": method, "params": params });
        let line = serde_json::to_string(&req).map_err(|e| e.to_string())?;

        let (tx, rx) = oneshot::channel::<Result<Value, String>>();
        self.pending.lock().unwrap().insert(id, tx);

        // Write then release the lock before awaiting.
        let write_result = {
            let mut stdin = self.stdin.lock().unwrap();
            writeln!(stdin, "{line}").and_then(|_| stdin.flush())
        };
        if let Err(e) = write_result {
            self.pending.lock().unwrap().remove(&id);
            return Err(format!("Failed to write to sidecar stdin: {e}"));
        }

        match timeout(deadline, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_))     => Err("Sidecar response channel dropped".into()),
            Err(_)         => {
                // Timed out — remove the pending entry so the slot is freed
                // even though we no longer care about the reply.
                self.pending.lock().unwrap().remove(&id);
                tracing::error!(method, "sidecar call timed out after {}s", deadline.as_secs());
                Err(format!("Sidecar call '{method}' timed out after {}s", deadline.as_secs()))
            }
        }
    }

    /// Lightweight liveness probe — calls the sidecar's `health` method with a
    /// short timeout.  Returns `Ok(())` if the sidecar replied in time.
    pub async fn health_check(&self) -> Result<(), String> {
        if self.dead.load(Ordering::SeqCst) {
            return Err("Sidecar is dead".into());
        }
        let id   = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req  = json!({ "id": id, "method": "health", "params": {} });
        let line = serde_json::to_string(&req).map_err(|e| e.to_string())?;

        let (tx, rx) = oneshot::channel::<Result<Value, String>>();
        self.pending.lock().unwrap().insert(id, tx);

        {
            let mut stdin = self.stdin.lock().unwrap();
            if writeln!(stdin, "{line}").and_then(|_| stdin.flush()).is_err() {
                self.pending.lock().unwrap().remove(&id);
                return Err("Failed to write health-check to sidecar stdin".into());
            }
        }

        match timeout(HEALTH_TIMEOUT, rx).await {
            Ok(Ok(_))  => Ok(()),
            Ok(Err(_)) => Err("Health-check channel dropped".into()),
            Err(_)     => {
                self.pending.lock().unwrap().remove(&id);
                Err("Sidecar health-check timed out".into())
            }
        }
    }
}
