Unicode true

####
## Please note: Template replacements don't work in this file. They are provided with default defines like
## mentioned underneath.
## If the keyword is not defined, "wails_tools.nsh" will populate them.
## If they are defined here, "wails_tools.nsh" will not touch them.
####
!ifndef REQUEST_EXECUTION_LEVEL
    !define REQUEST_EXECUTION_LEVEL "user"
!endif
!ifndef WAILS_INSTALL_SCOPE
    !define WAILS_INSTALL_SCOPE     "user"
!endif

####
## Include Wails Tools
####
!include "wails_tools.nsh"

# Version Information
VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion    "${INFO_PRODUCTVERSION}.0"

VIAddVersionKey "CompanyName"      "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription"  "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"   "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"      "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"   "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"      "${INFO_PRODUCTNAME}"

# Enable HiDPI support
ManifestDPIAware true

# High performance modern compression
SetCompressor /SOLID lzma

# Modern UI 2
!include "MUI2.nsh"

# Icons & Branding Visuals
!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"

!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "resources\header.bmp"
!define MUI_HEADERIMAGE_RIGHT
!define MUI_WELCOMEFINISHPAGE_BITMAP "resources\welcome.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "resources\welcome.bmp"

!define MUI_ABORTWARNING

# Welcome Page Customization
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${INFO_PRODUCTNAME} Setup"
!define MUI_WELCOMEPAGE_TEXT "Setup will guide you through the installation of ${INFO_PRODUCTNAME} v${INFO_PRODUCTVERSION}.\r\n\r\n${INFO_PRODUCTNAME} is a fast, modern Database Management Studio featuring interactive data grid editing, multi-tab query consoles, and intelligent schema exploration.\r\n\r\nClick Next to continue."

# Directory Selection Page
!define MUI_DIRECTORYPAGE_VERIFYONLEAVE

# Finish Page Customization (Launch app option!)
!define MUI_FINISHPAGE_TITLE "${INFO_PRODUCTNAME} Installation Complete"
!define MUI_FINISHPAGE_TEXT "${INFO_PRODUCTNAME} has been successfully installed on your computer.\r\n\r\nClick Finish to close Setup."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_EXECUTABLE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${INFO_PRODUCTNAME}"
!define MUI_FINISHPAGE_RUN_CHECKED

# Uninstaller Pages Customization
!define MUI_UNCONFIRMPAGE_TEXT_TOP "Setup will uninstall ${INFO_PRODUCTNAME} from your computer."
!define MUI_UNFINISHPAGE_NOAUTOCLOSE

# Installer Pages Flow
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

# Uninstaller Pages Flow
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

# Languages
!insertmacro MUI_LANGUAGE "English"

# Setup General Settings
Name "${INFO_PRODUCTNAME}"
BrandingText "${INFO_PRODUCTNAME} v${INFO_PRODUCTVERSION} - ${INFO_COMPANYNAME}"
OutFile "..\..\..\bin\${INFO_PROJECTNAME}-${ARCH}-installer.exe"

!if "${WAILS_INSTALL_SCOPE}" == "user"
    InstallDir "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}"
!else
    InstallDir "$PROGRAMFILES64\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}"
!endif

ShowInstDetails hide
ShowUnInstDetails hide

Function .onInit
    !insertmacro wails.checkArchitecture
FunctionEnd

Section "Install"
    !insertmacro wails.setShellContext

    # Check and install WebView2 Runtime if needed
    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR
    
    # Extract application files
    !insertmacro wails.files

    # Create Program Menu & Desktop Shortcuts with App Description
    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}" "" "$INSTDIR\${PRODUCT_EXECUTABLE}" 0 "" "" "${INFO_PRODUCTNAME} - Database Management System"
    CreateShortcut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}" "" "$INSTDIR\${PRODUCT_EXECUTABLE}" 0 "" "" "${INFO_PRODUCTNAME} - Database Management System"

    # File & Protocol associations
    !insertmacro wails.associateFiles
    !insertmacro wails.associateCustomProtocols
    
    # Register uninstaller in Add/Remove Programs
    !insertmacro wails.writeUninstaller
SectionEnd

Section "Uninstall"
    !insertmacro wails.setShellContext

    # Remove WebView2 application cache
    RMDir /r "$AppData\${PRODUCT_EXECUTABLE}"

    # Remove installed directory
    RMDir /r $INSTDIR

    # Remove shortcuts
    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"

    !insertmacro wails.unassociateFiles
    !insertmacro wails.unassociateCustomProtocols

    !insertmacro wails.deleteUninstaller
SectionEnd
