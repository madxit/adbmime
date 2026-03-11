package it.adbmime.utils

class RemoteInputAppClear(val packageName: String) : RemoteInput(RemoteInputType.RemoteInputAppClear) {
    override fun buildCommand(): String = "pm clear $packageName"
    override fun send(deviceId: String) {
        AdbHelper.runAdbCommand(deviceId, "shell", "pm", "clear", packageName)
    }
}
