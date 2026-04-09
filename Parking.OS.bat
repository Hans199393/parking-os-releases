@echo off
set MSVC=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64
set SDK_LIB=C:\Program Files (x86)\Windows Kits\10\Lib\10.0.26100.0
set SDK_INC=C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.0
set MSVC_LIB=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\lib\x64
set CARGO=%USERPROFILE%\.cargo\bin

set PATH=%MSVC%;%CARGO%;%PATH%
set LIB=%MSVC_LIB%;%SDK_LIB%\um\x64;%SDK_LIB%\ucrt\x64
set INCLUDE=%SDK_INC%\um;%SDK_INC%\ucrt;%SDK_INC%\shared

cd /d G:\parking_2026\parking_os
npm run tauri dev
