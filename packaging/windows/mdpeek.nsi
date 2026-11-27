Unicode true
ManifestDPIAware true
ManifestDPIAwareness PerMonitorV2
SetCompressor /SOLID lzma

!include MUI2.nsh
!include FileFunc.nsh
!include LogicLib.nsh
!include x64.nsh

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef OUTFILE
  !define OUTFILE "mdpeek-setup.exe"
!endif
!ifndef BINARY
  !define BINARY "mdpeek.exe"
!endif
!ifndef ICONFILE
  !define ICONFILE "icon.ico"
!endif
!ifndef PLUGINSDIR_EXTRA
  !define PLUGINSDIR_EXTRA "plugins"
!endif

!addplugindir "${PLUGINSDIR_EXTRA}"

!define PRODUCTNAME "mdpeek"
!define MAINBINARYNAME "mdpeek.exe"
!define WINDOWSUNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall"
!define UNINSTKEY "${WINDOWSUNINSTKEY}\${PRODUCTNAME}"
!define MANUKEY "Software\mdpeek"
!define MANUPRODUCTKEY "${MANUKEY}\${PRODUCTNAME}"
!define HOMEPAGE "https://github.com/sanketpatel32/Mdpeek"

!macro MPEEK_ASSOCIATE EXT FILECLASS DESCRIPTION
  ReadRegStr $R0 HKCR ".${EXT}" "${FILECLASS}_backup"
  ${If} $R0 == ""
    ReadRegStr $R0 HKCR ".${EXT}" ""
    WriteRegStr HKCR ".${EXT}" "${FILECLASS}_backup" "$R0"
  ${EndIf}
  WriteRegStr HKCR ".${EXT}" "" "${FILECLASS}"
  WriteRegStr HKCR "${FILECLASS}" "" "${DESCRIPTION}"
  WriteRegStr HKCR "${FILECLASS}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}$\",0"
  WriteRegStr HKCR "${FILECLASS}\shell" "" "open"
  WriteRegStr HKCR "${FILECLASS}\shell\open" "" "Open with mdpeek"
  WriteRegStr HKCR "${FILECLASS}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}$\" $\"%1$\""
!macroend

!macro MPEEK_UNASSOCIATE EXT FILECLASS
  ReadRegStr $R0 HKCR ".${EXT}" ""
  ${If} $R0 == "${FILECLASS}"
    ReadRegStr $R1 HKCR ".${EXT}" "${FILECLASS}_backup"
    WriteRegStr HKCR ".${EXT}" "" "$R1"
  ${EndIf}
  DeleteRegKey HKCR "${FILECLASS}"
!macroend

!macro MPEEK_REMOVE_V2_OPENWITH_ENTRIES
  DeleteRegValue HKCR ".md\OpenWithProgIDs" "mdpeek.md"
  DeleteRegValue HKCR ".markdown\OpenWithProgIDs" "mdpeek.md"
  DeleteRegValue HKCR ".mdx\OpenWithProgIDs" "mdpeek.md"
  DeleteRegValue HKCR ".txt\OpenWithProgIDs" "mdpeek.txt"
  DeleteRegKey HKCR "mdpeek.md"
  DeleteRegKey HKCR "mdpeek.txt"
!macroend

!macro MPEEK_REMOVE_LEGACY_ASSOCIATIONS
  !insertmacro MPEEK_UNASSOCIATE "pdf" "PDF"
  !insertmacro MPEEK_UNASSOCIATE "excalidraw" "Excalidraw"
  !insertmacro MPEEK_UNASSOCIATE "tldr" "TLDraw"
  !insertmacro MPEEK_UNASSOCIATE "ipynb" "Jupyter Notebook"
  !insertmacro MPEEK_UNASSOCIATE "mp3" "Audio"
  !insertmacro MPEEK_UNASSOCIATE "wav" "Audio"
  !insertmacro MPEEK_UNASSOCIATE "ogg" "Audio"
  !insertmacro MPEEK_UNASSOCIATE "flac" "Audio"
  !insertmacro MPEEK_UNASSOCIATE "m4a" "Audio"
  !insertmacro MPEEK_UNASSOCIATE "aac" "Audio"
  !insertmacro MPEEK_UNASSOCIATE "mp4" "Video"
  !insertmacro MPEEK_UNASSOCIATE "webm" "Video"
  !insertmacro MPEEK_UNASSOCIATE "mov" "Video"
  !insertmacro MPEEK_UNASSOCIATE "avi" "Video"
  !insertmacro MPEEK_UNASSOCIATE "m4v" "Video"
  !insertmacro MPEEK_UNASSOCIATE "mkv" "Video"
!macroend

!macro MPEEK_CONTEXT_MENUS
  WriteRegStr HKCR "*\shell\mdpeek" "" "Open with mdpeek"
  WriteRegStr HKCR "*\shell\mdpeek" "Icon" "$INSTDIR\${MAINBINARYNAME}"
  WriteRegStr HKCR "*\shell\mdpeek\command" "" "$\"$INSTDIR\${MAINBINARYNAME}$\" $\"%1$\""
  WriteRegStr HKCR "Directory\shell\mdpeek" "" "Open folder in mdpeek"
  WriteRegStr HKCR "Directory\shell\mdpeek" "Icon" "$INSTDIR\${MAINBINARYNAME}"
  WriteRegStr HKCR "Directory\shell\mdpeek\command" "" "$\"$INSTDIR\${MAINBINARYNAME}$\" $\"%1$\""
!macroend

!macro MPEEK_REMOVE_CONTEXT_MENUS
  DeleteRegKey HKCR "*\shell\mdpeek"
  DeleteRegKey HKCR "Directory\shell\mdpeek"
!macroend

Var PassiveMode
Var UpdateMode
Var SilentMode
Var LaunchArgs

Name "${PRODUCTNAME}"
BrandingText "mdpeek"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\${PRODUCTNAME}"
RequestExecutionLevel admin
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${PRODUCTNAME}"
VIAddVersionKey "FileDescription" "mdpeek installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "MIT"

!define MUI_ICON "${ICONFILE}"
!define MUI_UNICON "${ICONFILE}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${MAINBINARYNAME}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch mdpeek"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchMdpeek

!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Function LaunchMdpeek
  nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}" ""
  Pop $0
FunctionEnd

Function SkipIfPassive
  ${If} $PassiveMode = 1
  ${OrIf} $SilentMode = 1
    Abort
  ${EndIf}
FunctionEnd

Function EnsureMdpeekWritable
  ${IfNot} ${FileExists} "$INSTDIR\${MAINBINARYNAME}"
    Return
  ${EndIf}

  mdpeek_check_lock:
    ClearErrors
    FileOpen $0 "$INSTDIR\${MAINBINARYNAME}" a
    ${If} ${Errors}
      ${If} $PassiveMode = 1
      ${OrIf} $SilentMode = 1
        Abort
      ${EndIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "mdpeek is currently running. Close it, then choose Retry." IDRETRY mdpeek_check_lock
      Abort
    ${EndIf}
    FileClose $0
FunctionEnd

Function .onInit
  StrCpy $PassiveMode 0
  StrCpy $UpdateMode 0
  StrCpy $SilentMode 0

  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}

  IfSilent silent_mode
  Goto silent_done
  silent_mode:
    StrCpy $SilentMode 1
  silent_done:

  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "mdpeek requires 64-bit Windows."
    Abort
  ${EndIf}

  SetShellVarContext all
  SetRegView 64

  ReadRegStr $0 HKLM "${MANUPRODUCTKEY}" ""
  ${If} $0 <> ""
    StrCpy $INSTDIR $0
  ${EndIf}
FunctionEnd

Section "Install"
  SetOutPath $INSTDIR
  SetOverwrite on

  Call EnsureMdpeekWritable
  File "${BINARY}"
  File "${ICONFILE}"
  WriteUninstaller "$INSTDIR\uninstall.exe"

  WriteRegStr HKLM "${MANUPRODUCTKEY}" "" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\icon.ico$\""
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINSTKEY}" "Publisher" "mdpeek"
  WriteRegStr HKLM "${UNINSTKEY}" "InstallLocation" "$\"$INSTDIR$\""
  WriteRegStr HKLM "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr HKLM "${UNINSTKEY}" "URLInfoAbout" "${HOMEPAGE}"
  WriteRegStr HKLM "${UNINSTKEY}" "URLUpdateInfo" "${HOMEPAGE}"
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\${PRODUCTNAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}" "" "$INSTDIR\icon.ico" 0

  !insertmacro MPEEK_ASSOCIATE "md" "Markdown" "Markdown document"
  !insertmacro MPEEK_ASSOCIATE "markdown" "Markdown" "Markdown document"
  !insertmacro MPEEK_ASSOCIATE "mdx" "Markdown" "Markdown document"
  !insertmacro MPEEK_ASSOCIATE "txt" "Plain Text" "Plain text document"
  !insertmacro MPEEK_REMOVE_LEGACY_ASSOCIATIONS
  !insertmacro MPEEK_REMOVE_V2_OPENWITH_ENTRIES
  !insertmacro MPEEK_CONTEXT_MENUS
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'

  ${If} $PassiveMode = 1
  ${OrIf} $SilentMode = 1
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}" "" "$INSTDIR\icon.ico" 0
    SetAutoClose true
  ${EndIf}
SectionEnd

Function .onInstSuccess
  ${If} $PassiveMode = 1
  ${OrIf} $SilentMode = 1
    ${GetOptions} $CMDLINE "/R" $LaunchArgs
    ${IfNot} ${Errors}
      ${GetOptions} $CMDLINE "/ARGS" $LaunchArgs
      nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}" "$LaunchArgs"
      Pop $0
    ${EndIf}
  ${EndIf}
FunctionEnd

Section "Uninstall"
  SetShellVarContext all
  SetRegView 64

  ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}"
    ClearErrors
    Delete "$INSTDIR\${MAINBINARYNAME}"
    ${If} ${Errors}
      MessageBox MB_ICONSTOP "Could not remove mdpeek because it is still running or locked. Close all mdpeek windows and try uninstalling again."
      Abort
    ${EndIf}
  ${EndIf}

  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCTNAME}"
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"

  !insertmacro MPEEK_UNASSOCIATE "md" "Markdown"
  !insertmacro MPEEK_UNASSOCIATE "markdown" "Markdown"
  !insertmacro MPEEK_UNASSOCIATE "mdx" "Markdown"
  !insertmacro MPEEK_UNASSOCIATE "txt" "Plain Text"
  !insertmacro MPEEK_REMOVE_LEGACY_ASSOCIATIONS
  !insertmacro MPEEK_REMOVE_V2_OPENWITH_ENTRIES
  !insertmacro MPEEK_REMOVE_CONTEXT_MENUS
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'

  DeleteRegKey HKLM "${UNINSTKEY}"
  DeleteRegKey /ifempty HKLM "${MANUPRODUCTKEY}"
  DeleteRegKey /ifempty HKLM "${MANUKEY}"
SectionEnd
