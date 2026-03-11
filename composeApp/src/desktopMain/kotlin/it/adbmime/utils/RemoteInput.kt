package it.adbmime.utils

abstract class RemoteInput(val type: RemoteInputType) {
    abstract fun buildCommand(): String
    abstract fun send(deviceId: String)
}
