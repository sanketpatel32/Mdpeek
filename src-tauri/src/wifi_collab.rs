use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const IPAD_APP_HTML: &str = include_str!("ipad_app.html");

/// Discovers the computer's LAN / Wi-Fi IP address by querying the OS routing table.
/// Connects a UDP socket to common gateways (no network traffic is actually transmitted).
pub fn get_local_ip() -> String {
    let probes = [
        "8.8.8.8:80",
        "1.1.1.1:80",
        "192.168.1.1:80",
        "192.168.0.1:80",
        "10.0.0.1:80",
        "172.16.0.1:80",
    ];
    for probe in probes {
        if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
            if socket.connect(probe).is_ok() {
                if let Ok(addr) = socket.local_addr() {
                    let ip = addr.ip().to_string();
                    if ip != "0.0.0.0" && !ip.starts_with("127.") {
                        return ip;
                    }
                }
            }
        }
    }
    "127.0.0.1".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WifiCollabInfo {
    pub active: bool,
    pub ip: String,
    pub port: u16,
    pub url: String,
    pub peer_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WifiCollabInboundPayload {
    #[serde(rename = "type")]
    pub event_type: String, // "text" | "canvas"
    pub content: Option<String>,
    pub elements: Option<serde_json::Value>,
    pub caret: Option<usize>,
    pub peer_name: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WifiCollabOutboundPayload {
    #[serde(rename = "type")]
    pub event_type: String, // "text_change" | "canvas_change" | "doc_update"
    pub content: Option<String>,
    pub elements: Option<serde_json::Value>,
    pub title: Option<String>,
    pub language: Option<String>,
    pub caret: Option<usize>,
    pub selection_end: Option<usize>,
}

pub struct WifiCollabServer {
    pub active: bool,
    pub ip: String,
    pub port: u16,
    pub url: String,
    pub title: String,
    pub language: String,
    pub content: String,
    pub elements: serde_json::Value,
    pub sse_clients: Arc<Mutex<Vec<Arc<Mutex<TcpStream>>>>>,
    pub shutdown: Arc<AtomicBool>,
}

impl Default for WifiCollabServer {
    fn default() -> Self {
        Self {
            active: false,
            ip: String::new(),
            port: 0,
            url: String::new(),
            title: "Shared Note".to_string(),
            language: "markdown".to_string(),
            content: String::new(),
            elements: serde_json::json!([]),
            sse_clients: Arc::new(Mutex::new(Vec::new())),
            shutdown: Arc::new(AtomicBool::new(false)),
        }
    }
}

pub struct WifiCollabState(pub Mutex<WifiCollabServer>);

impl Default for WifiCollabState {
    fn default() -> Self {
        Self(Mutex::new(WifiCollabServer::default()))
    }
}

/// Broadcasts an SSE event to all connected clients and prunes disconnected ones.
fn broadcast_sse(clients: &Arc<Mutex<Vec<Arc<Mutex<TcpStream>>>>>, data: &str) -> usize {
    let mut guard = match clients.lock() {
        Ok(g) => g,
        Err(_) => return 0,
    };

    let msg = format!("data: {}\n\n", data);
    let mut retained = Vec::new();

    for client in guard.iter() {
        if let Ok(mut stream) = client.lock() {
            if stream.write_all(msg.as_bytes()).is_ok() && stream.flush().is_ok() {
                retained.push(Arc::clone(client));
            }
        }
    }

    *guard = retained;
    guard.len()
}

/// Reads HTTP request line and headers from a TCP stream.
fn parse_http_request<R: Read>(
    reader: &mut R,
) -> Result<(String, String, HashMap<String, String>, Vec<u8>), String> {
    let mut buffer = Vec::new();
    let mut byte_buf = [0u8; 1];
    let mut header_end_idx = None;

    // Read headers up to \r\n\r\n (capped at 16KB)
    while buffer.len() < 16384 {
        if reader.read_exact(&mut byte_buf).is_err() {
            break;
        }
        buffer.push(byte_buf[0]);
        if buffer.ends_with(b"\r\n\r\n") {
            header_end_idx = Some(buffer.len());
            break;
        }
    }

    let end_idx = header_end_idx.ok_or_else(|| "Incomplete HTTP request headers".to_string())?;
    let header_str = String::from_utf8_lossy(&buffer[..end_idx]);
    let mut lines = header_str.lines();

    let request_line = lines.next().ok_or_else(|| "Missing request line".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("GET").to_uppercase();
    let path = parts.next().unwrap_or("/").to_string();

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_lowercase(), v.trim().to_string());
        }
    }

    // Read remaining body based on Content-Length
    let content_length: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let mut body = Vec::with_capacity(content_length);
    if content_length > 0 {
        let mut chunk = vec![0u8; content_length];
        if reader.read_exact(&mut chunk).is_ok() {
            body = chunk;
        }
    }

    Ok((method, path, headers, body))
}

#[tauri::command]
pub fn start_wifi_collab(
    app: AppHandle,
    state: tauri::State<WifiCollabState>,
    port: Option<u16>,
) -> Result<WifiCollabInfo, String> {
    let mut s = state.0.lock().map_err(|e| e.to_string())?;

    // If already active, return current info
    if s.active {
        let clients_count = s.sse_clients.lock().map(|c| c.len()).unwrap_or(0);
        return Ok(WifiCollabInfo {
            active: true,
            ip: s.ip.clone(),
            port: s.port,
            url: s.url.clone(),
            peer_count: clients_count,
        });
    }

    let local_ip = get_local_ip();
    let target_port = port.unwrap_or(4789);

    // Try target port first, then bind port 0 (OS picks available port)
    let listener = TcpListener::bind(("0.0.0.0", target_port))
        .or_else(|_| TcpListener::bind(("0.0.0.0", 0)))
        .map_err(|e| format!("Could not bind Wi-Fi collaboration listener: {}", e))?;

    let bound_port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    let url = format!("http://{}:{}", local_ip, bound_port);

    s.active = true;
    s.ip = local_ip.clone();
    s.port = bound_port;
    s.url = url.clone();
    s.shutdown = Arc::new(AtomicBool::new(false));
    s.sse_clients = Arc::new(Mutex::new(Vec::new()));

    let sse_clients = Arc::clone(&s.sse_clients);
    let shutdown_signal = Arc::clone(&s.shutdown);
    let app_clone = app.clone();

    // Heartbeat thread (pings SSE clients every 10 seconds)
    let sse_clients_hb = Arc::clone(&s.sse_clients);
    let shutdown_hb = Arc::clone(&s.shutdown);
    let app_hb = app.clone();
    thread::spawn(move || {
        while !shutdown_hb.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_secs(10));
            if shutdown_hb.load(Ordering::Relaxed) {
                break;
            }
            let count = broadcast_sse(&sse_clients_hb, "{\"type\":\"ping\"}");
            let _ = app_hb.emit("wifi-collab-peers", count);
        }
    });

    // Request listener thread
    thread::spawn(move || {
        listener
            .set_nonblocking(true)
            .expect("Failed to set non-blocking");

        while !shutdown_signal.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _peer_addr)) => {
                    let sse_clients_worker = Arc::clone(&sse_clients);
                    let app_worker = app_clone.clone();

                    thread::spawn(move || {
                        handle_client_connection(stream, sse_clients_worker, app_worker);
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50));
                }
                Err(_) => {
                    break;
                }
            }
        }
    });

    Ok(WifiCollabInfo {
        active: true,
        ip: local_ip,
        port: bound_port,
        url,
        peer_count: 0,
    })
}

fn handle_client_connection(
    mut stream: TcpStream,
    sse_clients: Arc<Mutex<Vec<Arc<Mutex<TcpStream>>>>>,
    app: AppHandle,
) {
    let (method, path, _headers, body) = match parse_http_request(&mut stream) {
        Ok(req) => req,
        Err(_) => return,
    };

    if method == "OPTIONS" {
        let resp = "HTTP/1.1 204 No Content\r\n\
                    Access-Control-Allow-Origin: *\r\n\
                    Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
                    Access-Control-Allow-Headers: Content-Type\r\n\
                    Access-Control-Max-Age: 86400\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    if method == "GET" {
        let clean_path = path.split('?').next().unwrap_or("/");

        if clean_path == "/" || clean_path == "/index.html" {
            let html_bytes = IPAD_APP_HTML.as_bytes();
            let headers = format!(
                "HTTP/1.1 200 OK\r\n\
                 Content-Type: text/html; charset=utf-8\r\n\
                 Content-Length: {}\r\n\
                 Access-Control-Allow-Origin: *\r\n\
                 Connection: close\r\n\r\n",
                html_bytes.len()
            );
            let _ = stream.write_all(headers.as_bytes());
            let _ = stream.write_all(html_bytes);
            return;
        }

        if clean_path == "/api/session" || clean_path == "/api/status" {
            let state_info = if let Some(state) = app.try_state::<WifiCollabState>() {
                if let Ok(s) = state.0.lock() {
                    serde_json::json!({
                        "active": s.active,
                        "title": s.title,
                        "language": s.language,
                        "content": s.content,
                        "elements": s.elements,
                        "peer_count": s.sse_clients.lock().map(|c| c.len()).unwrap_or(0),
                    })
                } else {
                    serde_json::json!({ "active": false })
                }
            } else {
                serde_json::json!({ "active": false })
            };

            let payload = state_info.to_string();
            let resp = format!(
                "HTTP/1.1 200 OK\r\n\
                 Content-Type: application/json; charset=utf-8\r\n\
                 Content-Length: {}\r\n\
                 Access-Control-Allow-Origin: *\r\n\
                 Connection: close\r\n\r\n{}",
                payload.len(),
                payload
            );
            let _ = stream.write_all(resp.as_bytes());
            return;
        }

        if clean_path == "/api/events" {
            // Establish Server-Sent Events stream
            let headers = "HTTP/1.1 200 OK\r\n\
                           Content-Type: text/event-stream\r\n\
                           Cache-Control: no-cache\r\n\
                           Connection: keep-alive\r\n\
                           Access-Control-Allow-Origin: *\r\n\r\n";
            if stream.write_all(headers.as_bytes()).is_err() {
                return;
            }

            // Immediately send current document state as initial event
            let initial_event = if let Some(state) = app.try_state::<WifiCollabState>() {
                if let Ok(s) = state.0.lock() {
                    serde_json::json!({
                        "type": "init",
                        "title": s.title,
                        "language": s.language,
                        "content": s.content,
                        "elements": s.elements,
                    })
                    .to_string()
                } else {
                    "{\"type\":\"init\"}".to_string()
                }
            } else {
                "{\"type\":\"init\"}".to_string()
            };

            let init_msg = format!("data: {}\n\n", initial_event);
            if stream.write_all(init_msg.as_bytes()).is_err() {
                return;
            }
            let _ = stream.flush();

            // Register this client stream
            let stream_ref = Arc::new(Mutex::new(stream));
            let peer_count = if let Ok(mut clients) = sse_clients.lock() {
                clients.push(stream_ref);
                clients.len()
            } else {
                0
            };

            let _ = app.emit("wifi-collab-peers", peer_count);
            return;
        }

        // 404 for unknown paths
        let not_found = "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\nNot Found";
        let _ = stream.write_all(not_found.as_bytes());
        return;
    }

    if method == "POST" && path.starts_with("/api/edit") {
        if let Ok(inbound) = serde_json::from_slice::<WifiCollabInboundPayload>(&body) {
            // Update cached server state
            if let Some(state) = app.try_state::<WifiCollabState>() {
                if let Ok(mut s) = state.0.lock() {
                    if inbound.event_type == "text" {
                        if let Some(ref text) = inbound.content {
                            s.content = text.clone();
                        }
                    } else if inbound.event_type == "canvas" {
                        if let Some(ref elems) = inbound.elements {
                            s.elements = elems.clone();
                        }
                    }
                }
            }

            // Emit inbound edit to Tauri desktop frontend
            let _ = app.emit("wifi-collab-inbound", inbound.clone());

            // Broadcast edit to any other SSE clients
            let broadcast_payload = serde_json::json!({
                "type": if inbound.event_type == "text" { "text_change" } else { "canvas_change" },
                "content": inbound.content,
                "elements": inbound.elements,
                "caret": inbound.caret,
                "peer": inbound.peer_name.unwrap_or_else(|| "iPad".to_string()),
            }).to_string();

            broadcast_sse(&sse_clients, &broadcast_payload);

            let resp = "HTTP/1.1 200 OK\r\n\
                        Content-Type: application/json\r\n\
                        Access-Control-Allow-Origin: *\r\n\
                        Content-Length: 11\r\n\r\n\
                        {\"ok\":true}";
            let _ = stream.write_all(resp.as_bytes());
            return;
        }

        let bad_request = "HTTP/1.1 400 Bad Request\r\nContent-Length: 11\r\n\r\nBad Request";
        let _ = stream.write_all(bad_request.as_bytes());
    }
}

#[tauri::command]
pub fn stop_wifi_collab(
    app: AppHandle,
    state: tauri::State<WifiCollabState>,
) -> Result<(), String> {
    let mut s = state.0.lock().map_err(|e| e.to_string())?;
    s.shutdown.store(true, Ordering::Relaxed);
    s.active = false;

    // Notify connected SSE streams that the session has ended
    broadcast_sse(&s.sse_clients, "{\"type\":\"stopped\"}");
    if let Ok(mut clients) = s.sse_clients.lock() {
        clients.clear();
    }

    let _ = app.emit("wifi-collab-peers", 0);
    Ok(())
}

#[tauri::command]
pub fn get_wifi_collab_status(
    state: tauri::State<WifiCollabState>,
) -> Result<WifiCollabInfo, String> {
    let s = state.0.lock().map_err(|e| e.to_string())?;
    let count = s.sse_clients.lock().map(|c| c.len()).unwrap_or(0);
    Ok(WifiCollabInfo {
        active: s.active,
        ip: s.ip.clone(),
        port: s.port,
        url: s.url.clone(),
        peer_count: count,
    })
}

#[tauri::command]
pub fn update_wifi_collab_doc(
    state: tauri::State<WifiCollabState>,
    title: String,
    language: String,
    content: String,
    elements: Option<serde_json::Value>,
) -> Result<(), String> {
    let mut s = state.0.lock().map_err(|e| e.to_string())?;
    s.title = title.clone();
    s.language = language.clone();
    s.content = content.clone();
    if let Some(elems) = elements {
        s.elements = elems;
    }

    if s.active {
        let payload = serde_json::json!({
            "type": "doc_update",
            "title": s.title,
            "language": s.language,
            "content": s.content,
            "elements": s.elements,
        })
        .to_string();
        broadcast_sse(&s.sse_clients, &payload);
    }

    Ok(())
}

#[tauri::command]
pub fn sync_wifi_collab_outbound(
    state: tauri::State<WifiCollabState>,
    payload: WifiCollabOutboundPayload,
) -> Result<(), String> {
    let mut s = state.0.lock().map_err(|e| e.to_string())?;
    if !s.active {
        return Ok(());
    }

    if payload.event_type == "text_change" {
        if let Some(ref text) = payload.content {
            s.content = text.clone();
        }
    } else if payload.event_type == "canvas_change" {
        if let Some(ref elems) = payload.elements {
            s.elements = elems.clone();
        }
    }

    let json_str = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    broadcast_sse(&s.sse_clients, &json_str);
    Ok(())
}
