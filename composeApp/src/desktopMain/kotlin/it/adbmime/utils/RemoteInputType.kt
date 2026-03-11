package it.adbmime.utils

enum class RemoteInputType(val description: String) {
    RemoteInputTap("Tap"),
    RemoteInputSwipe("Swipe"),
    RemoteInputText("Text"),
    RemoteInputKeycode("Keycode"),
    RemoteInputAppOpen("App Open"),
    RemoteInputAppHide("App Hide"),
    RemoteInputAppUnhide("App Unhide"),
    RemoteInputAppInstall("App Install"),
    RemoteInputAppUninstall("App Uninstall"),
    RemoteInputAppClear("App Clear"),
    RemoteInputComment("Comment"),
    RemoteInputEmpty("Empty"),
    RemoteInputSleep("Sleep"),
    RemoteInputUnknown("Unknown");

    override fun toString(): String = description
}
