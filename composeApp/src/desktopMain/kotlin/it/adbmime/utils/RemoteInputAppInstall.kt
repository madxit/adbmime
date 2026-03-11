package it.adbmime.utils

class RemoteInputAppInstall(val filePath: String) : RemoteInput(RemoteInputType.RemoteInputAppInstall) {
    override fun buildCommand(): String = "install $filePath"
    override fun send(deviceId: String) {
        AdbHelper.runAdbCommand(deviceId, "install", filePath)
    }
}
