; mdpeek — file association NSIS hook
; Registered via bundle.windows.nsis.installerHooks in tauri.conf.json.
; Registers mdpeek in the Windows "Open with" menu for .md / .markdown / .mdx,
; WITHOUT force-claiming default (user picks default via Windows Settings).
;
; Tauri injects these macros into installer.nsi at hook points:
;   !insertmacro NSIS_HOOK_POSTINSTALL  — runs after files are installed
;   !insertmacro NSIS_HOOK_PREUNINSTALL — runs before files are removed

!define PROGID "mdpeek.md"

; Helper: register one extension in the Open With list + point at our ProgID
!macro _MPEEK_ASSOC_EXT EXT
  ; Add mdpeek to the "Open with" programs for this extension.
  WriteRegStr HKCR ".${EXT}\OpenWithProgIDs" "${PROGID}" ""
  ; Make sure our ProgID exists with an open command.
  WriteRegStr HKCR "${PROGID}" "" "Markdown Document"
  WriteRegStr HKCR "${PROGID}\DefaultIcon" "" "$INSTDIR\mdpeek.exe,0"
  WriteRegStr HKCR "${PROGID}\shell\open\command" "" '"$INSTDIR\mdpeek.exe" "%1"'
!macroend

; Helper: unregister one extension
!macro _MPEEK_UNASSOC_EXT EXT
  DeleteRegValue HKCR ".${EXT}\OpenWithProgIDs" "${PROGID}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Register the three extensions.
  !insertmacro _MPEEK_ASSOC_EXT "md"
  !insertmacro _MPEEK_ASSOC_EXT "markdown"
  !insertmacro _MPEEK_ASSOC_EXT "mdx"
  ; Notify Explorer that the file-association database changed so icons/menus refresh.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro _MPEEK_UNASSOC_EXT "md"
  !insertmacro _MPEEK_UNASSOC_EXT "markdown"
  !insertmacro _MPEEK_UNASSOC_EXT "mdx"
  DeleteRegKey HKCR "${PROGID}"
!macroend
