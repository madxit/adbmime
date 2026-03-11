package it.adbmime.utils

class RemoteInputSleep(val millis: Long) : RemoteInput(RemoteInputType.RemoteInputSleep) {
    override fun buildCommand(): String = "Sleep $millis ms"
    override fun send(deviceId: String) {
        try {
            Thread.sleep(millis)
        } catch (e: InterruptedException) {
            e.printStackTrace()
        }
    }
}
