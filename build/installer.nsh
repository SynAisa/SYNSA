; Custom NSIS hooks for the SYNSA installer/uninstaller (electron-builder
; "include" script). Handles the choices electron-builder's own static
; nsis.* options can't express interactively, plus one cleanup step:
;   - desktop shortcut: asked, never created silently
;   - personal data (%APPDATA%\SYNSA, incl. the "data" folder with the
;     encrypted Twitch/YTMDesktop credentials, event history, log file)
;     is only ever deleted on uninstall if the user opts in
;   - the now-empty install directory itself is removed after uninstall

; Needed for ${If}/${IfNot} and ${GetParameters}/${GetOptions} below — this
; file is included very early (electron-builder's shared installer/
; uninstaller script header, before installer.nsi's own !include "MUI2.nsh"
; and before its own !addplugindir for StdUtils has necessarily run yet).
; electron-builder's own ${isUpdated} flag depends on the StdUtils plugin
; and isn't reliably usable this early (confirmed: "Plugin not found,
; cannot call StdUtils::TestParameter" when tried here) — FileFunc.nsh's
; GetParameters/GetOptions are plain NSIS script macros with no plugin
; directory dependency, so they work regardless of load order. Both
; headers are safe to include here even if included again later.
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!macro customInstall
  MessageBox MB_YESNO "Möchtest du eine Verknüpfung für SYNSA auf dem Desktop erstellen?" IDNO skip_desktop_shortcut
    CreateShortCut "$DESKTOP\SYNSA.lnk" "$INSTDIR\SYNSA.exe"
  skip_desktop_shortcut:
!macroend

; electron-builder inserts this macro's body unconditionally into the main
; uninstall Section (see app-builder-lib's uninstaller.nsh) — it runs every
; time that Section runs, including when the OLD version's uninstaller is
; invoked as a step of a NEW version's installation (uninstallOldVersion()
; in installUtil.nsh always passes a bare "--updated" flag for that case,
; the same one un.onUninstSuccess above already checks for). "/S" (silent)
; does NOT suppress a plain MessageBox call by itself — only an explicit
; check like this one does. Without it, this dialog appeared — and could
; delete %APPDATA%\SYNSA, credentials and all — during a silent
; electron-updater update, never asking anything, whichever branch a
; MessageBox defaults to with no one there to click it. Personal data must
; never even be a possibility of being touched by an update, so this skips
; the whole prompt (not just defaults it to "no") whenever --updated is
; present, exactly like un.onUninstSuccess above.
!macro customUnInstall
  ${GetParameters} $R0
  ${GetOptions} $R0 "--updated" $R1
  ${If} ${Errors}
    ; No --updated flag: a real standalone uninstall. Ask, as before.
    MessageBox MB_YESNO "Möchtest du auch deine persönlichen SYNSA-Daten und Einstellungen löschen?$\r$\n$\r$\nDazu gehören gespeicherte Zugangsdaten, Tokens, der Verlauf und alle Einstellungen. Dieser Schritt kann nicht rückgängig gemacht werden." IDNO keep_user_data
      RMDir /r "$APPDATA\SYNSA"
    keep_user_data:
  ${EndIf}
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
; from the registry before uninstall runs), never an arbitrary path.
;
; TWO SAFETY LAYERS — an electron-updater production update reproducibly
; destroyed a freshly-installed 0.1.2 this way: updating runs the OLD
; version's uninstaller as a step of installing the NEW one (see
; app-builder-lib's installUtil.nsh, uninstallOldVersion(), which invokes
; the old "Uninstall SYNSA.exe" with an "--updated" flag), so this same
; hook fired mid-update, scheduled its delayed rmdir, exited, and the NEW
; installer's freshly-written files got deleted a couple seconds later by
; a timer that no longer had anything to do with an abandoned empty
; directory.
;   1. Skip the cleanup entirely when this uninstaller was invoked as part
;      of an update. electron-builder always passes a bare "--updated"
;      command-line flag in exactly that case (see installUtil.nsh,
;      uninstallOldVersion()) — checked here directly via GetParameters/
;      GetOptions rather than electron-builder's own ${isUpdated}, which
;      wraps the same check through a StdUtils plugin call that isn't
;      reliably available this early (see the include note above). This
;      cleanup is only ever meant for a real standalone uninstall.
;   2. Even so, the delayed delete itself no longer uses /s /q (force,
;      recursive): plain `rmdir` fails harmlessly if $INSTDIR is not
;      empty, so even a future timing surprise can only ever remove a
;      genuinely empty leftover directory, never one a fresh install (or
;      anything else) has since put files into.
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
    ${GetParameters} $R0
    ${GetOptions} $R0 "--updated" $R1
    ${IfNot} ${Errors}
      ; "--updated" was present -- this run is a step of installing a new
      ; version, not a real standalone uninstall. Leave $INSTDIR alone.
      Return
    ${EndIf}
    Exec '"$SYSDIR\cmd.exe" /c ping 127.0.0.1 -n 3 >nul & rmdir "$INSTDIR"'
  FunctionEnd
!endif
