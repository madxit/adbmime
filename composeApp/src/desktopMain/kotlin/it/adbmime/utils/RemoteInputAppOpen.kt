package it.adbmime.utils

class RemoteInputAppOpen(val packageName: String) : RemoteInput(RemoteInputType.RemoteInputAppOpen) {
    override fun buildCommand(): String = "monkey -p $packageName -c android.intent.category.LAUNCHER 1"
    override fun send(deviceId: String) {
        AdbHelper.runAdbCommand(deviceId, "shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1")
    }
}
