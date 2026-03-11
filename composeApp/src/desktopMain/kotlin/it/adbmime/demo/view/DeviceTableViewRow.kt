package it.adbmime.demo.view

import javafx.beans.property.SimpleStringProperty
import javafx.beans.property.StringProperty

data class Device(val id: String, val status: String)

class DeviceTableViewRow(val device: Device) {
    private val idProp = SimpleStringProperty(device.id)
    private val statusProp = SimpleStringProperty(device.status)

    fun getIdProp(): StringProperty = idProp
    fun getStatusProp(): StringProperty = statusProp

    companion object {
        fun getInstance(id: String, status: String): DeviceTableViewRow {
            return DeviceTableViewRow(Device(id, status))
        }
    }
}
