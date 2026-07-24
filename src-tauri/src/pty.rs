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
use std::sync::Mutex;

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
pub(crate) struct TermEntry {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    // Child handle: dropped on kill. Keeping it stored prevents the child from
    // being reaped prematurely if the user closes the drawer without killing
    // the tab.
    _child: Box<dyn portable_pty::Child + Send + Sync>,
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

/// Spawn a new PTY running PowerShell, streaming bytes to `on_event`.
///
/// `cwd` is optional; when missing the PTY inherits the app's working dir.
/// `cols`/`rows` initialize the PTY size (xterm.js sends real dimensions on
/// resize via `resize_terminal`).
#[tauri::command]
pub fn spawn_terminal(
    state: tauri::State<'_, TermState>,
    on_event: Channel<PtyEvent>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
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

    // Pick the shell. PowerShell 5.1 (powershell.exe) ships with every
    // Windows 10+ install, so it's the safe default. PowerShell 7 (pwsh.exe)
    // is preferred when present because it has better ANSI + UTF-8 handling.
    //
    // The probe is defensively bounded: stdin/stdout/stderr are wired to null
    // so nothing can block waiting for input, and we run it on a worker thread
    // with a hard 1.5s join timeout so a misbehaving pwsh.exe on PATH can't
    // hang the whole spawn_terminal command. On any doubt we fall back to the
    // universally-installed powershell.exe.
    #[cfg(target_os = "windows")]
    let (program, args): (&str, Vec<&str>) = {
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
            ("pwsh.exe", vec!["-NoLogo"])
        } else {
            eprintln!("[pty] probe: using powershell.exe (Windows PowerShell 5.1)");
            ("powershell.exe", vec!["-NoLogo"])
        }
    };
    #[cfg(not(target_os = "windows"))]
    let (program, args): (&str, Vec<&str>) = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "sh".to_string());
        // Leak-safe: shell path comes from env, lifetime is the process. We
        // can't easily avoid the allocation here without rewriting the API;
        // accept the small leak per spawn.
        let leaked: &'static str = Box::leak(shell.into_boxed_str());
        (leaked, vec!["-l"])
    };

    eprintln!("[pty] spawn_command: launching {} {:?}", program, args);
    let mut cmd = CommandBuilder::new(program);
    for a in args {
        cmd.arg(a);
    }
    if let Some(dir) = cwd.as_deref().filter(|d| !d.trim().is_empty()) {
        cmd.cwd(dir);
    }

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
    // error. On exit sends one PtyEvent::Exit so the frontend can render a
    // "[process exited]" line. The thread owns its own clone of the reader;
    // dropping the master (kill_terminal / app shutdown) causes read() to
    // return 0 and the thread exits cleanly.
    let reader = master
        .try_clone_reader()
        .map_err(|e| format!("try_clone_reader failed: {e}"))?;
    let exit_chan = on_event.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let s = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = on_event.send(PtyEvent::Data(s));
                }
            }
        }
        let _ = exit_chan.send(PtyEvent::Exit(0));
    });

    let entry = TermEntry {
        master,
        writer,
        _child: child,
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

/// Kill a terminal: remove from state so the entry drops, which closes the PTY
/// and causes the reader thread to hit EOF.
#[tauri::command]
pub fn kill_terminal(state: tauri::State<'_, TermState>, id: u32) -> Result<(), String> {
    if let Some(mut entry) = state.0.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
        let _ = entry._child.kill();
    }
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
