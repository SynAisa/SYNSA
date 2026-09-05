; Custom NSIS hooks for the SYNSA installer/uninstaller (electron-builder
; "include" script). Handles the choices electron-builder's own static
; nsis.* options can't express interactively, plus one cleanup step:
;   - desktop shortcut: asked, never created silently
;   - personal data (%APPDATA%\SYNSA, incl. the "data" folder with the
;     encrypted Twitch/YTMDesktop credentials, event history, log file)
;     is only ever deleted on uninstall if the user opts in
;   - the now-empty install directory itself is removed after uninstall
;
; THE ONE RULE THIS FILE EXISTS TO ENFORCE: an update is not an install.
; electron-builder inserts both custom macros below unconditionally into the
; installer's and uninstaller's main sections, and updating SYNSA runs BOTH
; of them (installing a new version first runs the old version's uninstaller
; -- see app-builder-lib's installUtil.nsh, uninstallOldVersion()). Neither
; NSIS's /S (silent) flag nor electron-updater's silent mode suppresses a
; plain MessageBox instruction, so without the explicit guards below an
; unattended background update pops up interactive install questions and can
; touch personal data. Every prompt here is therefore gated on "this is a
; real, user-initiated install or uninstall", never on an update.

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

; "1" when this installer/uninstaller run is a step of updating SYNSA, "0"
; when a user started it themselves. electron-builder passes a bare
; "--updated" flag in exactly the update case: the new installer hands it to
; the old uninstaller (installUtil.nsh, uninstallOldVersion()), and
; electron-updater hands it to the new installer (electron-updater's
; NsisUpdater.doInstall(), args = ["--updated", ...]). So one flag covers
; both halves of an update.
Var /GLOBAL synsaIsUpdate

; ClearErrors first, exactly like electron-builder's own uninstaller.nsh does
; before the same call: ${GetOptions} reports "not found" by *setting* the
; error flag, so a stale flag left over from any earlier operation would
; otherwise read as "no --updated" and turn an update back into an install.
!macro synsaDetectUpdateContext
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "--updated" $R1
  ${If} ${Errors}
    StrCpy $synsaIsUpdate "0"
  ${Else}
    StrCpy $synsaIsUpdate "1"
  ${EndIf}
!macroend

; Inserted unconditionally into the installer's main section (see
; app-builder-lib/templates/nsis/installSection.nsh, "!ifmacrodef
; customInstall"), so it runs during an update too. Asking an unattended
; background update whether it would like a desktop shortcut is exactly the
; "why is my update behaving like a fresh installation?" experience this
; guard removes; the existing shortcut is left alone either way, since
; createDesktopShortcut:false makes electron-builder define
; DO_NOT_CREATE_DESKTOP_SHORTCUT, which is what its uninstaller checks
; before deleting a desktop link (uninstaller.nsh). ${Silent} is checked as
; well so that a plain silent install (SYNSA-Setup.exe /S), which no one is
; sitting in front of either, can never block on this prompt.
!macro customInstall
  !insertmacro synsaDetectUpdateContext
  ${If} $synsaIsUpdate == "0"
  ${AndIfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION "Möchtest du eine Verknüpfung für SYNSA auf dem Desktop erstellen?" /SD IDNO IDNO skip_desktop_shortcut
      CreateShortCut "$DESKTOP\SYNSA.lnk" "$INSTDIR\SYNSA.exe"
    skip_desktop_shortcut:
  ${EndIf}
!macroend

; Inserted unconditionally into the uninstaller's main section (see
; uninstaller.nsh, "!ifmacrodef customUnInstall") — completely independent of
; un.onUninstSuccess further down, which is why guarding only that one was
; not enough. During an update the whole block is skipped, so %APPDATA%\SYNSA
; (credentials, tokens, history, settings) is not merely kept by answering
; "no" — the deleting instruction is never reached at all.
;
; electron-builder's own app-data deletion is separate and already safe here:
; it only fires on an explicit "--delete-app-data" flag or when
; deleteAppDataOnUninstall is true (we set it to false), and never when
; updating (uninstaller.nsh's ${ifNot} ${isUpdated} guard).
;
; The desktop shortcut is ours to remove as well: customInstall above creates
; it directly, and because DO_NOT_CREATE_DESKTOP_SHORTCUT is defined,
; electron-builder's uninstaller deliberately never touches a desktop link —
; so without this, a real uninstall would leave a dead SYNSA icon behind. It
; is removed only on a real uninstall, never on the uninstaller run that is
; part of an update, where the shortcut has to survive untouched.
!macro customUnInstall
  !insertmacro synsaDetectUpdateContext
  ${If} $synsaIsUpdate == "0"
    Delete "$DESKTOP\SYNSA.lnk"

    ${IfNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONEXCLAMATION "Möchtest du auch deine persönlichen SYNSA-Daten und Einstellungen löschen?$\r$\n$\r$\nDazu gehören gespeicherte Zugangsdaten, Tokens, der Verlauf und alle Einstellungen. Dieser Schritt kann nicht rückgängig gemacht werden." /SD IDNO IDNO keep_user_data
        RMDir /r "$APPDATA\SYNSA"
      keep_user_data:
    ${EndIf}
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
; version's uninstaller as a step of installing the NEW one, so this same
; hook fired mid-update, scheduled its delayed rmdir, exited, and the NEW
; installer's freshly-written files got deleted a couple seconds later by
; a timer that no longer had anything to do with an abandoned empty
; directory.
;   1. Skip the cleanup entirely when this uninstaller was invoked as part
;      of an update (the shared --updated check above). This cleanup is
;      only ever meant for a real standalone uninstall.
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
    !insertmacro synsaDetectUpdateContext
    ${If} $synsaIsUpdate == "1"
      ; This run is a step of installing a new version, not a real
      ; standalone uninstall. Leave $INSTDIR alone.
      Return
    ${EndIf}
    Exec '"$SYSDIR\cmd.exe" /c ping 127.0.0.1 -n 3 >nul & rmdir "$INSTDIR"'
  FunctionEnd
!endif
