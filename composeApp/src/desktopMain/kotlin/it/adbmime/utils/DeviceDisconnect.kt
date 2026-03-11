package it.adbmime.utils

object DeviceDisconnect : RemoteInput(RemoteInputType.RemoteInputUnknown) {
    override fun buildCommand(): String = "Disconnect All"
    override fun send(deviceId: String) {
        // Just a placeholder for disconnection logic if needed
    }
}
