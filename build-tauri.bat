@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
cd /d "C:\Users\sanpa\OneDrive\Desktop\Fun projects\Makedown-preview"

set "WINSDK=C:\Program Files (x86)\Windows Kits\10"
set "SDKVER=10.0.18362.0"
set "LIB=%LIB%;%WINSDK%\lib\%SDKVER%\um\x64"
set "PATH=C:\Program Files (x86)\NSIS;%PATH%"

npx tauri build --bundles nsis
