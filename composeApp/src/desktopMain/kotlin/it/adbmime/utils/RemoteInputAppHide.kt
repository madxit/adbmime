package it.adbmime.utils

class RemoteInputAppHide(val packageName: String) : RemoteInput(RemoteInputType.RemoteInputAppHide) {
    override fun buildCommand(): String = "pm hide $packageName"
    override fun send(deviceId: String) {
        AdbHelper.runAdbCommand(deviceId, "shell", "pm", "hide", packageName)
    }
}
