package it.adbmime.utils

class RemoteInputAppUninstall(val packageName: String) : RemoteInput(RemoteInputType.RemoteInputAppUninstall) {
    override fun buildCommand(): String = "pm uninstall $packageName"
    override fun send(deviceId: String) {
        AdbHelper.runAdbCommand(deviceId, "uninstall", packageName)
    }
}
