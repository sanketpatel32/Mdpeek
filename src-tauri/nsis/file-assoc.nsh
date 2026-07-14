; mdpeek — file association NSIS hook
; Registered via bundle.windows.nsis.installerHooks in tauri.conf.json.
; Registers mdpeek in the Windows "Open with" menu for .md / .markdown / .mdx
; and .txt, WITHOUT force-claiming default (user picks default via Windows
; Settings).
;
; Tauri injects these macros into installer.nsi at hook points:
;   !insertmacro NSIS_HOOK_POSTINSTALL  — runs after files are installed
;   !insertmacro NSIS_HOOK_PREUNINSTALL — runs before files are removed

!define PROGID "mdpeek.md"
!define PROGID_TXT "mdpeek.txt"
!define PROGID_PDF "mdpeek.pdf"
!define PROGID_EXC "mdpeek.excalidraw"

; Helper: register one extension in the Open With list + point at our ProgID
!macro _MPEEK_ASSOC_EXT EXT
  ; Add mdpeek to the "Open with" programs for this extension.
  WriteRegStr HKCR ".${EXT}\OpenWithProgIDs" "${PROGID}" ""
  ; Make sure our ProgID exists with an open command.
  WriteRegStr HKCR "${PROGID}" "" "Markdown Document"
  WriteRegStr HKCR "${PROGID}\DefaultIcon" "" "$INSTDIR\mdpeek.exe,0"
  WriteRegStr HKCR "${PROGID}\shell\open\command" "" '"$INSTDIR\mdpeek.exe" "%1"'
!macroend

; Helper: register .txt under its own ProgID (labelled "Plain Text", not
; "Markdown Document", so it shows correctly in the Open With menu).
!macro _MPEEK_ASSOC_TXT
  WriteRegStr HKCR ".txt\OpenWithProgIDs" "${PROGID_TXT}" ""
  WriteRegStr HKCR "${PROGID_TXT}" "" "Plain Text Document"
  WriteRegStr HKCR "${PROGID_TXT}\DefaultIcon" "" "$INSTDIR\mdpeek.exe,0"
  WriteRegStr HKCR "${PROGID_TXT}\shell\open\command" "" '"$INSTDIR\mdpeek.exe" "%1"'
!macroend

; Helper: register .pdf under its own ProgID (labelled "PDF Document").
!macro _MPEEK_ASSOC_PDF
  WriteRegStr HKCR ".pdf\OpenWithProgIDs" "${PROGID_PDF}" ""
  WriteRegStr HKCR "${PROGID_PDF}" "" "PDF Document"
  WriteRegStr HKCR "${PROGID_PDF}\DefaultIcon" "" "$INSTDIR\mdpeek.exe,0"
  WriteRegStr HKCR "${PROGID_PDF}\shell\open\command" "" '"$INSTDIR\mdpeek.exe" "%1"'
!macroend

; Helper: register .excalidraw under its own ProgID.
!macro _MPEEK_ASSOC_EXC
  WriteRegStr HKCR ".excalidraw\OpenWithProgIDs" "${PROGID_EXC}" ""
  WriteRegStr HKCR "${PROGID_EXC}" "" "Excalidraw Canvas"
  WriteRegStr HKCR "${PROGID_EXC}\DefaultIcon" "" "$INSTDIR\mdpeek.exe,0"
  WriteRegStr HKCR "${PROGID_EXC}\shell\open\command" "" '"$INSTDIR\mdpeek.exe" "%1"'
!macroend

; Helper: unregister one extension
!macro _MPEEK_UNASSOC_EXT EXT
  DeleteRegValue HKCR ".${EXT}\OpenWithProgIDs" "${PROGID}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Register the three Markdown extensions.
  !insertmacro _MPEEK_ASSOC_EXT "md"
  !insertmacro _MPEEK_ASSOC_EXT "markdown"
  !insertmacro _MPEEK_ASSOC_EXT "mdx"
  ; Register .txt under its own ProgID.
  !insertmacro _MPEEK_ASSOC_TXT
  ; Register .pdf under its own ProgID.
  !insertmacro _MPEEK_ASSOC_PDF
  ; Register .excalidraw under its own ProgID.
  !insertmacro _MPEEK_ASSOC_EXC
  ; Notify Explorer that the file-association database changed so icons/menus refresh.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro _MPEEK_UNASSOC_EXT "md"
  !insertmacro _MPEEK_UNASSOC_EXT "markdown"
  !insertmacro _MPEEK_UNASSOC_EXT "mdx"
  DeleteRegValue HKCR ".txt\OpenWithProgIDs" "${PROGID_TXT}"
  DeleteRegValue HKCR ".pdf\OpenWithProgIDs" "${PROGID_PDF}"
  DeleteRegValue HKCR ".excalidraw\OpenWithProgIDs" "${PROGID_EXC}"
  DeleteRegKey HKCR "${PROGID}"
  DeleteRegKey HKCR "${PROGID_TXT}"
  DeleteRegKey HKCR "${PROGID_PDF}"
  DeleteRegKey HKCR "${PROGID_EXC}"
!macroend
