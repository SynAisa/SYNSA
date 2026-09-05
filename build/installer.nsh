; Custom NSIS hooks for the SYNSA installer/uninstaller (electron-builder
; "include" script). Handles the choices electron-builder's own static
; nsis.* options can't express interactively, plus one cleanup step:
;   - desktop shortcut: asked, never created silently
;   - personal data (%APPDATA%\SYNSA, incl. the "data" folder with the
;     encrypted Twitch/YTMDesktop credentials, event history, log file)
;     is only ever deleted on uninstall if the user opts in
;   - the now-empty install directory itself is removed after uninstall

!macro customInstall
  MessageBox MB_YESNO "Möchtest du eine Verknüpfung für SYNSA auf dem Desktop erstellen?" IDNO skip_desktop_shortcut
    CreateShortCut "$DESKTOP\SYNSA.lnk" "$INSTDIR\SYNSA.exe"
  skip_desktop_shortcut:
!macroend

!macro customUnInstall
  MessageBox MB_YESNO "Möchtest du auch deine persönlichen SYNSA-Daten und Einstellungen löschen?$\r$\n$\r$\nDazu gehören gespeicherte Zugangsdaten, Tokens, der Verlauf und alle Einstellungen. Dieser Schritt kann nicht rückgängig gemacht werden." IDNO keep_user_data
    RMDir /r "$APPDATA\SYNSA"
  keep_user_data:
!macroend

; Plain NSIS callback (not an electron-builder macro) that fires once the
; built-in uninstall section has fully finished deleting every installed
; file (see app-builder-lib/templates/nsis/uninstaller.nsh). By then
; $INSTDIR itself is empty, but the still-running "Uninstall SYNSA.exe"
; holds its own process handle inside it, so even a plain RMDir fails with
; "access denied" here despite the folder being empty — and /REBOOTOK just
; defers the removal to the next reboot rather than doing it now. The
; standard NSIS workaround: spawn a short-lived, detached helper that
; waits ~2 seconds for this uninstaller process to fully exit (releasing
; its lock), then removes the now-unlocked, already-empty directory.
; $INSTDIR is always this exact installation's own directory (resolved
; from the registry before uninstall runs), never an arbitrary path, and
; by this point it holds nothing left to lose.
;
; (electron-builder's own "customUnInstallSection" macro was deliberately
; not used here: defining it turns on NSIS's uninstall components-picker
; page, an unwanted UI change this cleanup isn't meant to make.)
;
; This whole file is compiled into BOTH the installer and the uninstaller
; (electron-builder shares one script header between the two passes), but
; an "un."-prefixed Function is only valid in the uninstaller pass — hence
; the guard, matching how electron-builder's own uninstaller.nsh template
; is itself only included when BUILD_UNINSTALLER is defined.
!ifdef BUILD_UNINSTALLER
  Function un.onUninstSuccess
    Exec '"$SYSDIR\cmd.exe" /c ping 127.0.0.1 -n 3 >nul & rmdir /s /q "$INSTDIR"'
  FunctionEnd
!endif
