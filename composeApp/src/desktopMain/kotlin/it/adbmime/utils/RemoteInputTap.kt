package it.adbmime.utils

class RemoteInputTap(val x: Int, val y: Int) : RemoteInput(RemoteInputType.RemoteInputTap) {
    override fun buildCommand(): String = "input tap $x $y"
    override fun send(deviceId: String) {
        AdbHelper.runAdbCommand(deviceId, "shell", "input", "tap", x.toString(), y.toString())
    }
}
