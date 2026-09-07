!include LogicLib.nsh
!include nsDialogs.nsh
!include MUI2.nsh

!define WEKI_FORM_GROUP_X 0
!define WEKI_FORM_GROUP_Y 70u
!define WEKI_FORM_GROUP_W -7u
!define WEKI_FORM_GROUP_H 34u
!define WEKI_FORM_INPUT_X 10u
!define WEKI_FORM_INPUT_Y 82u
!define WEKI_FORM_INPUT_W 210u
!define WEKI_FORM_INPUT_H 12u
!define WEKI_FORM_BROWSE_X 222u
!define WEKI_FORM_BROWSE_W 60u

Var WekiDataDir

!ifndef BUILD_UNINSTALLER
!include FileFunc.nsh
!include StrContains.nsh
Var WekiInstallDirInput
Var WekiInstallDirBrowse
Var WekiInstallSpaceRequired
Var WekiInstallSpaceAvailable
Var WekiDataDirInput
Var WekiDataDirBrowse
Var WekiMyboxToken
Var WekiMyboxTokenInput
!macro customPageAfterChangeDir
  Page custom WekiInstallDirPageCreate WekiInstallDirPageLeave
  Page custom WekiDataPageCreate WekiDataPageLeave
  Page custom WekiMyboxTokenPageCreate WekiMyboxTokenPageLeave
!macroend

Function WekiInstallDirPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "설치 위치 선택" "Weki(을)를 설치할 폴더를 선택해 주세요."
  ${NSD_CreateLabel} 0 0 310u 20u "Weki(을)를 다음 폴더에 설치할 예정입니다."
  Pop $0
  ${NSD_CreateLabel} 0 24u 310u 30u "설치 폴더를 변경하려면 찾아보기를 눌러 주세요.$\r$\n계속하려면 다음 버튼을 눌러 주세요."
  Pop $0
  ${NSD_CreateGroupBox} ${WEKI_FORM_GROUP_X} ${WEKI_FORM_GROUP_Y} ${WEKI_FORM_GROUP_W} ${WEKI_FORM_GROUP_H} "설치 폴더"
  Pop $0
  ${NSD_CreateDirRequest} ${WEKI_FORM_INPUT_X} ${WEKI_FORM_INPUT_Y} ${WEKI_FORM_INPUT_W} ${WEKI_FORM_INPUT_H} "$INSTDIR"
  Pop $WekiInstallDirInput
  ${NSD_CreateBrowseButton} ${WEKI_FORM_BROWSE_X} ${WEKI_FORM_INPUT_Y} ${WEKI_FORM_BROWSE_W} ${WEKI_FORM_INPUT_H} "찾아보기..."
  Pop $WekiInstallDirBrowse
  ${NSD_OnClick} $WekiInstallDirBrowse WekiBrowseInstallDir
  ${NSD_OnChange} $WekiInstallDirInput WekiInstallDirChanged
  ${NSD_CreateLabel} ${WEKI_FORM_INPUT_X} 109u 280u 12u ""
  Pop $WekiInstallSpaceRequired
  ${NSD_CreateLabel} ${WEKI_FORM_INPUT_X} 123u 280u 12u ""
  Pop $WekiInstallSpaceAvailable
  Call WekiUpdateInstallSpace
  nsDialogs::Show
FunctionEnd

Function WekiFormatMegabytes
  ${If} $0 < 1024
    StrCpy $1 "$0 MB"
  ${ElseIf} $0 < 1048576
    IntOp $0 $0 + 1023
    IntOp $0 $0 / 1024
    StrCpy $1 "$0 GB"
  ${Else}
    IntOp $0 $0 + 1048575
    IntOp $0 $0 / 1048576
    StrCpy $1 "$0 TB"
  ${EndIf}
FunctionEnd

Function WekiUpdateInstallSpace
  ; electron-builder's assisted installer declares the application section first.
  SectionGetSize 0 $0
  ${If} $0 < 1024
    StrCpy $1 "$0 KB"
  ${Else}
    IntOp $0 $0 + 1023
    IntOp $0 $0 / 1024
    Call WekiFormatMegabytes
  ${EndIf}
  StrCpy $2 "$(^SpaceRequired)$1"
  ${NSD_SetText} $WekiInstallSpaceRequired $2

  ${GetRoot} "$INSTDIR" $3
  ${DriveSpace} "$3" "/D=F /S=M" $4
  ${If} ${Errors}
    StrCpy $4 "확인할 수 없음"
  ${Else}
    StrCpy $0 $4
    Call WekiFormatMegabytes
    StrCpy $4 $1
  ${EndIf}
  StrCpy $2 "$(^SpaceAvailable)$4"
  ${NSD_SetText} $WekiInstallSpaceAvailable $2
FunctionEnd

Function WekiInstallDirChanged
  ${NSD_GetText} $WekiInstallDirInput $INSTDIR
  Call WekiUpdateInstallSpace
FunctionEnd

Function WekiBrowseInstallDir
  nsDialogs::SelectFolderDialog "Weki 설치 위치 선택" "$INSTDIR"
  Pop $0
  ${If} $0 != "error"
    StrCpy $INSTDIR $0
    ${NSD_SetText} $WekiInstallDirInput $INSTDIR
    Call WekiUpdateInstallSpace
  ${EndIf}
FunctionEnd

Function WekiInstallDirPageLeave
  ${NSD_GetText} $WekiInstallDirInput $INSTDIR
  ${If} $INSTDIR == ""
    MessageBox MB_ICONSTOP "Weki 설치 위치를 선택해야 합니다."
    Abort
  ${EndIf}
  ${StrContains} $0 "${APP_FILENAME}" $INSTDIR
  ${If} $0 == ""
    StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
  ${EndIf}
FunctionEnd

Function WekiDataPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 310u 20u "Weki 문서 데이터 저장 위치"
  Pop $0
  ${NSD_CreateLabel} 0 24u 310u 30u "문서 원본과 검색 색인을 저장할 폴더입니다.$\r$\n설치 위치와 별도로 지정할 수 있습니다."
  Pop $0
  StrCpy $WekiDataDir "$INSTDIR\data"
  ReadRegStr $0 HKCU "Software\Weki" "DataDir"
  ${If} $0 != ""
    IfFileExists "$INSTDIR\Weki.exe" 0 weki_data_use_install_default
    StrCpy $WekiDataDir $0
    weki_data_use_install_default:
  ${EndIf}
  ; Keep the editable row on the same vertical baseline as the built-in
  ; installation-directory page, even when this page's description is shorter.
  !insertmacro MUI_HEADER_TEXT "Weki 문서 데이터 저장 위치" "원본과 검색 색인을 저장할 폴더를 선택해 주세요."
  ${NSD_CreateGroupBox} ${WEKI_FORM_GROUP_X} ${WEKI_FORM_GROUP_Y} ${WEKI_FORM_GROUP_W} ${WEKI_FORM_GROUP_H} "설치 폴더"
  Pop $0
  ${NSD_CreateDirRequest} ${WEKI_FORM_INPUT_X} ${WEKI_FORM_INPUT_Y} ${WEKI_FORM_INPUT_W} ${WEKI_FORM_INPUT_H} "$WekiDataDir"
  Pop $WekiDataDirInput
  ${NSD_CreateBrowseButton} ${WEKI_FORM_BROWSE_X} ${WEKI_FORM_INPUT_Y} ${WEKI_FORM_BROWSE_W} ${WEKI_FORM_INPUT_H} "찾아보기..."
  Pop $WekiDataDirBrowse
  ${NSD_OnClick} $WekiDataDirBrowse WekiBrowseDataDir
  nsDialogs::Show
FunctionEnd

Function WekiBrowseDataDir
  nsDialogs::SelectFolderDialog "Weki 데이터 저장 위치 선택" "$WekiDataDir"
  Pop $0
  ${If} $0 != "error"
    StrCpy $WekiDataDir $0
    ${NSD_SetText} $WekiDataDirInput $WekiDataDir
  ${EndIf}
FunctionEnd

Function WekiDataPageLeave
  ${NSD_GetText} $WekiDataDirInput $WekiDataDir
  ${If} $WekiDataDir == ""
    MessageBox MB_ICONSTOP "Weki 데이터 저장 위치를 선택해야 합니다."
    Abort
  ${EndIf}
  WriteRegStr HKCU "Software\Weki" "DataDir" "$WekiDataDir"
FunctionEnd

Function WekiMyboxTokenPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 310u 20u "MYBOX 토큰(선택)"
  Pop $0
  ${NSD_CreateLabel} 0 24u 310u 42u "설치 PC의 선택된 Weki 데이터 저장소에$\r$\nWindows 보안 저장소로 암호화해 보관합니다."
  Pop $0
  !insertmacro MUI_HEADER_TEXT "MYBOX 토큰" "MYBOX 연결에 사용할 토큰을 입력해 주세요."
  ${NSD_CreateGroupBox} ${WEKI_FORM_GROUP_X} ${WEKI_FORM_GROUP_Y} ${WEKI_FORM_GROUP_W} ${WEKI_FORM_GROUP_H} "MYBOX 토큰"
  Pop $0
  ${NSD_CreatePassword} ${WEKI_FORM_INPUT_X} ${WEKI_FORM_INPUT_Y} 272u ${WEKI_FORM_INPUT_H} ""
  Pop $WekiMyboxTokenInput
  nsDialogs::Show
FunctionEnd

Function WekiMyboxTokenPageLeave
  ${NSD_GetText} $WekiMyboxTokenInput $WekiMyboxToken
  Delete "$WekiDataDir\credentials\.mybox-token.bootstrap"
  ${If} $WekiMyboxToken != ""
    CreateDirectory "$WekiDataDir\credentials"
    FileOpen $0 "$WekiDataDir\credentials\.mybox-token.bootstrap" w
    FileWrite $0 "$WekiMyboxToken"
    FileClose $0
  ${EndIf}
FunctionEnd
!endif

; Silent installs do not display the custom location page. Keep the same
; deterministic default and preserve an existing pointer during updates.
!macro customInstall
  ReadRegStr $WekiDataDir HKCU "Software\Weki" "DataDir"
  ${If} $WekiDataDir == ""
    StrCpy $WekiDataDir "$INSTDIR\data"
    WriteRegStr HKCU "Software\Weki" "DataDir" "$WekiDataDir"
  ${EndIf}
!macroend

!ifdef BUILD_UNINSTALLER
Var WekiRootIndex
Var WekiRootCount
!macro customUnInstall
  ReadRegStr $WekiRootCount HKCU "Software\Weki" "ManagedRootCount"
  ${If} $WekiRootCount == ""
    StrCpy $WekiRootCount "0"
  ${EndIf}
  StrCpy $WekiRootIndex "1"
  weki_remove_managed_root:
    ${If} $WekiRootIndex > $WekiRootCount
      Goto weki_remove_legacy
    ${EndIf}
    ReadRegStr $WekiDataDir HKCU "Software\Weki" "ManagedRoot$WekiRootIndex"
    IfFileExists "$WekiDataDir\.weki-storage-root" 0 weki_next_managed_root
      RMDir /r "$WekiDataDir\originals"
      RMDir /r "$WekiDataDir\incoming"
      RMDir /r "$WekiDataDir\backups"
      RMDir /r "$WekiDataDir\tessdata"
      RMDir /r "$WekiDataDir\credentials"
      RMDir /r "$WekiDataDir\.runtime"
      Delete "$WekiDataDir\knowledge-base.json"
      Delete "$WekiDataDir\storage-location.json"
      Delete "$WekiDataDir\.weki-storage-root"
      RMDir "$WekiDataDir"
    weki_next_managed_root:
    IntOp $WekiRootIndex $WekiRootIndex + 1
    Goto weki_remove_managed_root
  weki_remove_legacy:
  ReadRegStr $WekiDataDir HKCU "Software\Weki" "DataDir"
  IfFileExists "$WekiDataDir\.weki-storage-root" 0 weki_remove_legacy_done
    RMDir /r "$WekiDataDir\originals"
    RMDir /r "$WekiDataDir\incoming"
    RMDir /r "$WekiDataDir\backups"
    RMDir /r "$WekiDataDir\tessdata"
    RMDir /r "$WekiDataDir\credentials"
    RMDir /r "$WekiDataDir\.runtime"
    Delete "$WekiDataDir\knowledge-base.json"
    Delete "$WekiDataDir\storage-location.json"
    Delete "$WekiDataDir\.weki-storage-root"
    RMDir "$WekiDataDir"
  weki_remove_legacy_done:
  IfFileExists "$INSTDIR\data\.weki-storage-root" 0 weki_remove_install_data_done
    RMDir /r "$INSTDIR\data\originals"
    RMDir /r "$INSTDIR\data\incoming"
    RMDir /r "$INSTDIR\data\backups"
    RMDir /r "$INSTDIR\data\tessdata"
    RMDir /r "$INSTDIR\data\credentials"
    RMDir /r "$INSTDIR\data\.runtime"
    Delete "$INSTDIR\data\knowledge-base.json"
    Delete "$INSTDIR\data\storage-location.json"
    Delete "$INSTDIR\data\.weki-storage-root"
    RMDir "$INSTDIR\data"
  weki_remove_install_data_done:
  RMDir /r "$LOCALAPPDATA\Weki"
  RMDir /r "$LOCALAPPDATA\Weki-runtime-cache"
  RMDir /r "$APPDATA\Weki"
  RMDir /r "$TEMP\Weki-electron"
  RMDir /r "$TEMP\Weki-runtime-cache"
  DeleteRegKey HKCU "Software\Weki"
!macroend
!endif
