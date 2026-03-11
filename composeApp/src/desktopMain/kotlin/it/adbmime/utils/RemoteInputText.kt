package it.adbmime.utils

class RemoteInputText(val text: String) : RemoteInput(RemoteInputType.RemoteInputText) {
    override fun buildCommand(): String = "input text $text"
    override fun send(deviceId: String) {
        AdbHelper.runAdbCommand(deviceId, "shell", "input", "text", text)
    }
}
