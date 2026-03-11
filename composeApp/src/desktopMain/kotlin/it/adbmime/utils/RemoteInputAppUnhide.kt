package it.adbmime.utils

class RemoteInputAppUnhide(val packageName: String) : RemoteInput(RemoteInputType.RemoteInputAppUnhide) {
    override fun buildCommand(): String = "pm unhide $packageName"
    override fun send(deviceId: String) {
        AdbHelper.runAdbCommand(deviceId, "shell", "pm", "unhide", packageName)
    }
}
