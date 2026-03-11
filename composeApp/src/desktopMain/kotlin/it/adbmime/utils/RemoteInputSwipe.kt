package it.adbmime.utils

class RemoteInputSwipe(val x1: Int, val y1: Int, val x2: Int, val y2: Int, val duration: Int = 300) : 
    RemoteInput(RemoteInputType.RemoteInputSwipe) {
    override fun buildCommand(): String = "input swipe $x1 $y1 $x2 $y2 $duration"
    override fun send(deviceId: String) {
        AdbHelper.runAdbCommand(deviceId, "shell", "input", "swipe", x1.toString(), y1.toString(), x2.toString(), y2.toString(), duration.toString())
    }
}
