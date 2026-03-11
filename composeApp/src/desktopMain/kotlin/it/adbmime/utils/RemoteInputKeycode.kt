package it.adbmime.utils

class RemoteInputKeycode(val keycode: Int) : RemoteInput(RemoteInputType.RemoteInputKeycode) {
    override fun buildCommand(): String = "input keyevent $keycode"
    override fun send(deviceId: String) {
        AdbHelper.runAdbCommand(deviceId, "shell", "input", "keyevent", keycode.toString())
    }
}
