// Integrated terminal backend (v0.23.0).
//
// Spawns real pseudo-terminals via the `portable-pty` crate (ConPTY on Windows,
// openpty on Unix) and streams their bytes to the frontend over a Tauri 2
// `ipc::Channel`. The frontend (xterm.js) sends keystrokes back via the
// `write_terminal` command. This replaces the old request/response fake shell
// (`run_shell_command`), which spawned a fresh subshell per command and could
// not do streaming, colors, interactive commands, Ctrl+C, or persistent state.
//
// State model: a single `TermState` (HashMap<u32, TermEntry>) held in Tauri's
// managed state. Each live terminal tab owns one entry; dropping the entry
// (via `kill_terminal` or app shutdown) closes the PTY.

use std::collections::HashMap;
use std::io::Read;
use std::io::Write;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;

// Monotonic id generator shared by every spawn_terminal call.
static NEXT_ID: AtomicU32 = AtomicU32::new(1);

// One live terminal. Kept alive in the state map; drop closes the PTY and the
// child shell exits.
//
// `Master` is boxed because portable_pty returns a trait object whose concrete
// type differs per platform (ConPty on Windows, Unix on Linux/macOS). The same
// boxed master is used for both writing (keystrokes) and resizing.
//
// The child is shared with the reader thread (Arc<Mutex>) so that after the
// PTY reaches EOF the reader can reap it via try_wait() and report the real
// exit code to the frontend (v0.64.0 — previously Exit(0) was hardcoded).
pub(crate) struct TermEntry {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
}

/// Managed app state: a map from terminal id → live PTY entry.
#[derive(Default)]
pub struct TermState(pub(crate) Mutex<HashMap<u32, TermEntry>>);

/// Messages streamed from the PTY backend to the frontend xterm.js instance.
/// Serialized as a tagged enum `{ "t": "Data", "d": "..." }` so the JS side
/// can dispatch on `msg.t` cheaply.
#[derive(Serialize, Clone)]
#[serde(tag = "t", content = "d")]
pub enum PtyEvent {
    /// Bytes from the PTY (lossy UTF-8 decoded). xterm.js parses ANSI escapes.
    Data(String),
    /// Child process exited with this code. Exact code is best-effort.
    Exit(i32),
}

#[derive(Serialize)]
pub struct SpawnResult {
    pub id: u32,
}

/// Decode `pending` into (string-to-send, leftover-bytes-to-carry).
///
/// ConPTY output is a byte stream: a single `read()` can end in the middle of
/// a multi-byte UTF-8 sequence, and decoding that fragment with
/// `from_utf8_lossy` alone would emit U+FFFD for every split char (visible
/// mojibake for CJK/emoji output). This helper keeps incomplete trailing
/// sequences as carry-over so they complete on the next read. Invalid
/// sequences mid-stream (binary output) are replaced with one U+FFFD each.
fn decode_chunk(pending: &mut Vec<u8>) -> String {
    let mut out = String::new();
    loop {
        match std::str::from_utf8(pending) {
            Ok(s) => {
                out.push_str(s);
                pending.clear();
                return out;
            }
            Err(e) => {
                let valid = e.valid_up_to();
                if valid > 0 {
                    // from_utf8 on the valid prefix cannot fail.
                    out.push_str(unsafe { std::str::from_utf8_unchecked(&pending[..valid]) });
                }
                match e.error_len() {
                    Some(bad) => {
                        // Truly invalid sequence — replace and continue parsing
                        // the remainder in this same pass.
                        out.push('\u{FFFD}');
                        pending.drain(..valid + bad);
                    }
                    None => {
                        // Incomplete sequence at the very end — carry it.
                        pending.drain(..valid);
                        return out;
                    }
                }
            }
        }
    }
}

/// Spawn a new PTY running PowerShell, streaming bytes to `on_event`.
///
/// `cwd` is optional; when missing the PTY inherits the app's working dir.
/// `cols`/`rows` initialize the PTY size (xterm.js sends real dimensions on
/// resize via `resize_terminal`). `shell` optionally overrides the shell
/// program (used by the frontend's shell picker); empty/None probes normally.
#[tauri::command]
pub fn spawn_terminal(
    state: tauri::State<'_, TermState>,
    on_event: Channel<PtyEvent>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    shell: Option<String>,
) -> Result<SpawnResult, String> {
    eprintln!("[pty] spawn_terminal: start (cwd={:?}, cols={:?}, rows={:?})", cwd, cols, rows);
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);

    let pty_system = native_pty_system();
    eprintln!("[pty] openpty: opening ConPTY...");
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| {
            eprintln!("[pty] openpty FAILED: {e}");
            format!("openpty failed: {e}")
        })?;
    eprintln!("[pty] openpty: ok");

    // Pick the shell. An explicit override wins (the frontend shell picker).
    // Otherwise: PowerShell 5.1 (powershell.exe) ships with every Windows 10+
    // install, so it's the safe default; PowerShell 7 (pwsh.exe) is preferred
    // when present because it has better ANSI + UTF-8 handling.
    //
    // The probe is defensively bounded: stdin/stdout/stderr are wired to null
    // so nothing can block waiting for input, and we run it on a worker thread
    // with a hard 1.5s join timeout so a misbehaving pwsh.exe on PATH can't
    // hang the whole spawn_terminal command. On any doubt we fall back to the
    // universally-installed powershell.exe.
    #[cfg(target_os = "windows")]
    let (program, args): (String, Vec<&str>) = {
        if let Some(sh) = shell.as_deref().filter(|s| !s.trim().is_empty()) {
            eprintln!("[pty] override: using requested shell {sh:?}");
            (sh.trim().to_string(), vec!["-NoLogo"])
        } else {
            use std::process::Stdio;
            use std::sync::mpsc;
            use std::time::Duration;
            let (tx, rx) = mpsc::channel();
            std::thread::spawn(move || {
                let mut cmd = std::process::Command::new("pwsh.exe");
                cmd.arg("--version")
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null());
                let result = cmd
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                let _ = tx.send(result);
            });
            let pwsh7_present = rx.recv_timeout(Duration::from_millis(1500)).unwrap_or(false);
            if pwsh7_present {
                eprintln!("[pty] probe: using pwsh.exe (PowerShell 7)");
                ("pwsh.exe".to_string(), vec!["-NoLogo"])
            } else {
                eprintln!("[pty] probe: using powershell.exe (Windows PowerShell 5.1)");
                ("powershell.exe".to_string(), vec!["-NoLogo"])
            }
        }
    };
    #[cfg(not(target_os = "windows"))]
    let (program, args): (String, Vec<&str>) = {
        let shell_prog = shell
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| std::env::var("SHELL").unwrap_or_else(|_| "sh".to_string()));
        (shell_prog, vec!["-l"])
    };

    eprintln!("[pty] spawn_command: launching {} {:?}", program, args);
    let mut cmd = CommandBuilder::new(&program);
    for a in args {
        cmd.arg(a);
    }
    if let Some(dir) = cwd.as_deref().filter(|d| !d.trim().is_empty()) {
        cmd.cwd(dir);
    }
    // Advertise the terminal type so CLI tools pick color + key sequences that
    // match xterm.js (git, bat, fzf, etc. all check TERM).
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| {
            eprintln!("[pty] spawn_command FAILED: {e}");
            format!("spawn_command failed: {e}")
        })?;
    eprintln!("[pty] spawn_command: ok (pid={})", child.process_id().unwrap_or(0));

    // The slave side is no longer needed once the child is spawned — drop it
    // so the master owns the PTY fully (required by portable_pty semantics).
    drop(pair.slave);
    eprintln!("[pty] slave dropped");

    // Move the master out of the pair so we can use it without partial-move
    // issues. After this, `pair` is consumed.
    let master = pair.master;
    eprintln!("[pty] master moved out of pair");

    // Take writer once and store it in TermEntry so it remains open and reusable.
    let writer = master
        .take_writer()
        .map_err(|e| {
            eprintln!("[pty] take_writer FAILED: {e}");
            format!("take_writer failed: {e}")
        })?;
    eprintln!("[pty] take_writer: ok");

    // Reader thread: pump PTY → Channel. Runs until EOF (child exited) or
    // error. On exit it reaps the child (try_wait) and sends one PtyEvent::Exit
    // with the real exit code so the frontend can render it. The thread owns
    // its own clone of the reader; dropping the master (kill_terminal / app
    // shutdown) causes read() to return 0 and the thread exits cleanly.
    let reader = master
        .try_clone_reader()
        .map_err(|e| format!("try_clone_reader failed: {e}"))?;
    let exit_chan = on_event.clone();
    let child_handle: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>> =
        Arc::new(Mutex::new(child));
    let reap = Arc::clone(&child_handle);
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let s = decode_chunk(&mut pending);
                    if !s.is_empty() {
                        let _ = on_event.send(PtyEvent::Data(s));
                    }
                }
            }
        }
        // Reap the child for its real exit code. At EOF the process has (or is
        // about to have) exited, so try_wait resolves without blocking in the
        // common case. If the lock is held by a concurrent kill, or the status
        // isn't observable, fall back to 0 — the exact code is best-effort.
        let code = reap
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .try_wait()
            .ok()
            .flatten()
            .map(|s| s.exit_code() as i32)
            .unwrap_or(0);
        let _ = exit_chan.send(PtyEvent::Exit(code));
    });

    let entry = TermEntry {
        master,
        writer,
        child: child_handle,
    };
    state.0.lock().unwrap_or_else(|e| e.into_inner()).insert(id, entry);
    eprintln!("[pty] spawn_terminal: returning id={id}");

    Ok(SpawnResult { id })
}

/// Send keystrokes (or pasted text) from the frontend to the PTY.
#[tauri::command]
pub fn write_terminal(
    state: tauri::State<'_, TermState>,
    id: u32,
    data: String,
) -> Result<(), String> {
    let mut map = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let entry = map.get_mut(&id).ok_or_else(|| format!("no terminal with id {id}"))?;
    entry
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write_all failed: {e}"))?;
    let _ = entry.writer.flush();
    Ok(())
}

/// Kill a terminal: remove it from state (fast, under the lock) and perform
/// the actual `child.kill()` on a worker thread. On Windows ConPTY,
/// `TerminateProcess` can stall briefly (interactive PowerShell, AV scan,
/// profile unload); running it off the IPC thread means a slow kill can't
/// block other terminal commands queueing on the same state mutex — which was
/// the root cause of the "Not Responding on close" symptom.
#[tauri::command]
pub fn kill_terminal(state: tauri::State<'_, TermState>, id: u32) -> Result<(), String> {
    let entry = state.0.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    if let Some(entry) = entry {
        std::thread::spawn(move || {
            let _ = entry
                .child
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .kill();
        });
    }
    Ok(())
}

/// Drain and kill every live terminal in one shot. Used by the frontend's
/// shutdown path (`destroyAll`) so that `app.exit(0)` drops an already-empty
/// `TermState` — no reader thread is mid-`read()`, no child teardown collides
/// with WebView2 shutdown. All kills run on a single worker thread.
#[tauri::command]
pub fn kill_all_terminals(state: tauri::State<'_, TermState>) -> Result<(), String> {
    let entries: Vec<TermEntry> = state
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .drain()
        .map(|(_, v)| v)
        .collect();
    std::thread::spawn(move || {
        for entry in entries {
            let _ = entry
                .child
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .kill();
        }
    });
    Ok(())
}

/// Resize the PTY when the xterm.js viewport changes.
#[tauri::command]
pub fn resize_terminal(
    state: tauri::State<'_, TermState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let entry = map.get(&id).ok_or_else(|| format!("no terminal with id {id}"))?;
    entry
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize failed: {e}"))?;
    Ok(())
}
