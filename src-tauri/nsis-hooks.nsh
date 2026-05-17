; Parking.OS NSIS Installer Hooks
; W v2026.1.01 runtime kamer jest zawsze instalowany,
; żeby aplikacja działała poprawnie na gołym systemie i po update.

!include "LogicLib.nsh"

; Zmienna zachowana dla kompatybilności starszych hooków
Var WantCameras

; ============================================================
; PREINSTALL: kamery są zawsze instalowane
; ============================================================
!macro NSIS_HOOK_PREINSTALL
  StrCpy $WantCameras "1"
!macroend


; ============================================================
; POSTINSTALL: brak usuwania runtime kamer
; ============================================================
!macro NSIS_HOOK_POSTINSTALL
!macroend


; ============================================================
; PREUNINSTALL / POSTUNINSTALL – puste (obsługiwane przez Tauri)
; ============================================================
!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
