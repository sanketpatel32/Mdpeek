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

Function CloseRunningMdpeek
  nsis_tauri_utils::FindProcessCurrentUser "${MAINBINARYNAME}"
  Pop $0
  ${If} $0 = 0
    ${If} $PassiveMode = 1
    ${OrIf} $UpdateMode = 1
    ${OrIf} $SilentMode = 1
      Goto kill_mdpeek
    ${EndIf}

    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "mdpeek is currently running. Close it to continue installation." IDOK kill_mdpeek IDCANCEL cancel_install

    kill_mdpeek:
      nsis_tauri_utils::KillProcessCurrentUser "${MAINBINARYNAME}"
      Pop $0
      ${If} $0 = 1
        ${If} $SilentMode <> 1
        ${AndIf} $PassiveMode <> 1
          MessageBox MB_ICONSTOP "Could not close mdpeek. Close it manually and run the installer again."
        ${EndIf}
        Abort
      ${EndIf}
      Goto close_done

    cancel_install:
      Abort
  ${EndIf}
  close_done:
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

  Call CloseRunningMdpeek

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

  nsis_tauri_utils::KillProcessCurrentUser "${MAINBINARYNAME}"
  Pop $0

  Delete "$INSTDIR\${MAINBINARYNAME}"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCTNAME}"
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"

  DeleteRegKey HKLM "${UNINSTKEY}"
  DeleteRegKey /ifempty HKLM "${MANUPRODUCTKEY}"
  DeleteRegKey /ifempty HKLM "${MANUKEY}"
SectionEnd
