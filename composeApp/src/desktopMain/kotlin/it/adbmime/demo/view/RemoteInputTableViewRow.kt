package it.adbmime.demo.view

import it.adbmime.utils.RemoteInput
import javafx.beans.property.SimpleStringProperty
import javafx.beans.property.StringProperty

class RemoteInputTableViewRow(val remoteInput: RemoteInput) {
    private val iconProp = SimpleStringProperty(remoteInput.type.toString())
    private val typeProp = SimpleStringProperty(remoteInput.type.toString())
    private val cmndProp = SimpleStringProperty(remoteInput.buildCommand())

    fun getIconProp(): StringProperty = iconProp
    fun getTypeProp(): StringProperty = typeProp
    fun getCmndProp(): StringProperty = cmndProp

    companion object {
        fun getInstance(remoteInput: RemoteInput): RemoteInputTableViewRow {
            return RemoteInputTableViewRow(remoteInput)
        }
    }
}
